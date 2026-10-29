// ===================== VERSION =====================
// Bump this string whenever a change ships. Shown in the header badge and footer,
// logged to the console on load, and compared against the last-seen version stored
// per browser/machine so an "updated" notice can be shown after an update (see
// loadPersisted()). This is purely a tracking label — it has no effect on parsing
// or matching logic.
const APP_VERSION = 'v7.0';
// The branch's formulas (branch-ekm.js or branch-clt.js) are loaded just before this file.

// Web build: Claude's window.storage doesn't exist on GitHub Pages, so this shim stores the same
// keys in the browser's localStorage under this branch's own prefix (BRANCH.storagePrefix), so
// each branch's settings and logs stay apart even though they share one website. If storage is blocked, saving silently does nothing, as before.
window.storage = {
  async get(key){ try{ const v = localStorage.getItem(BRANCH.storagePrefix + key); return v === null ? null : { key, value: v }; }catch(e){ return null; } },
  async set(key, value){ try{ localStorage.setItem(BRANCH.storagePrefix + key, value); }catch(e){} return { key, value }; }
};

console.log('Invoice Audit — ' + BRANCH.name + ' — ' + APP_VERSION);

const excelZone = document.getElementById('excelZone');
const excelInput = document.getElementById('excelInput');
const excelStatus = document.getElementById('excelStatus');
const tallyBar = document.getElementById('tallyBar');
const screenshotToggle = document.getElementById('screenshotToggle');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const processingEl = document.getElementById('processing');
const resultsEl = document.getElementById('results');
const rulesToggle = document.getElementById('rulesToggle');
const rulesPanel = document.getElementById('rulesPanel');
const codesToggle = document.getElementById('codesToggle');
const codesPanel = document.getElementById('codesPanel');
const logToggle = document.getElementById('logToggle');
const logPanel = document.getElementById('logPanel');
const parserReportToggle = document.getElementById('parserReportToggle');
const parserReportPanel = document.getElementById('parserReportPanel');
const exportBar = document.getElementById('exportBar');
const exportBtn = document.getElementById('exportBtn');
const masterToggle = document.getElementById('masterToggle');
const masterPanel = document.getElementById('masterPanel');
const syncPanel = document.getElementById('syncPanel');

screenshotToggle.addEventListener('click', () => {
  document.body.classList.toggle('screenshot-mode');
  screenshotToggle.style.background = document.body.classList.contains('screenshot-mode') ? 'var(--ink)' : '';
  screenshotToggle.style.color = document.body.classList.contains('screenshot-mode') ? 'var(--paper-raised)' : '';
  document.querySelectorAll('.invoice-card').forEach(card => recalcCard(card));
});

function renderTally(){
  scheduleOverview();
  scheduleSessionSave();
  if(!excelWorkbookData || !excelWorkbookData.blocks.length){
    tallyBar.classList.remove('show');
    return;
  }
  const billed = new Set(window.__records.filter(r => r.selectedBlockName).map(r => r.selectedBlockName));
  const blockNames = excelWorkbookData.blocks.map(b => b.customerName);
  const missing = blockNames.filter(name => !billed.has(name));
  tallyBar.classList.add('show');
  tallyBar.innerHTML = `${billed.size} of ${blockNames.length} Excel customers billed` +
    (missing.length ? `<br><span class="missing">Not yet given for checking: ${missing.map(escapeHtml).join(', ')}</span>` : '');
}

// ---- Persisted state (survives reload, via artifact storage) ----
// Party matches are intentionally NOT remembered across bills — every bill gets a fresh human check,
// on both the party name and the item lines, every time.
let excelWorkbookData = null; // { blocks: [{customerName, rows:[{code,qty,rate}]}] }

// ---- Discrepancy log: persists across reloads (unlike bill records), just Date/Party/Count ----
// Deliberately NOT used for party-name matching or any other functional purpose — plain audit text only.
let checkLog = [];
// Every file processed gets one entry here: which path read it (direct/AI/failed) and, for
// anything other than a clean direct read, why. This is the "why report" — a persistent,
// no-devtools-required answer to "why did this bill use the API" or "why did this bill fail",
// so a pattern across a batch (e.g. several files rejected for the same reason) is visible at a
// glance instead of requiring the console to be open at the moment it happened.
let parserReport = [];
const PARSER_REPORT_CAP = 500;
// path: 'deterministic' (clean read) | 'direct-warn' (read, but the self-check found figures that
// don't agree) | 'delivery-note' | 'duplicate' | 'failed' | 'ai' (only in entries from older versions)
// extra: { code, warnings[], batch, defer } — defer skips the save so a 50-file batch saves once.
function logParserEvent(filename, path, reason, extra){
  extra = extra || {};
  parserReport.push({
    id: 'pr' + Date.now() + Math.random().toString(36).slice(2, 7),
    filename,
    date: fmtDateTime(new Date()),
    path,
    code: extra.code || null,
    reason: reason || null,
    warnings: extra.warnings || [],
    batch: extra.batch || null
  });
  if(parserReport.length > PARSER_REPORT_CAP) parserReport = parserReport.slice(-PARSER_REPORT_CAP);
  if(extra.defer) return;
  savePersisted();
  if(parserReportPanel.classList.contains('open')) renderParserReportPanel();
}

// What each failure code means and what to do — shown in the report so a code can be acted on
// without needing to remember them.
const PARSER_CODE_HELP = {
  READ_CHECK:        'Read, but figures disagree — compare the listed lines with the PDF. If the PDF is right, the reader misread it: send the file in.',
  NO_TABLE:          'No item table found. Different print format, or not a sales invoice — send the file in if it should have been read.',
  NO_ROWS:           'Item table found but rows not recognised — the column layout differs. Send the file in.',
  NOT_JAINWIRE:      'Not a Jain Wire sales invoice (no Jain Wire name, no item table).',
  NO_TEXT:           'Scanned or photographed PDF — no text to read. Export the bill from Tally instead.',
  PASSWORD:          'Password-protected PDF — export again without a password.',
  DAMAGED:           'Damaged PDF — export again from Tally.',
  TIMEOUT:           'Took too long to read — likely damaged. Export again.',
  NOT_PDF:           'Not a PDF file.',
  EMPTY:             'Empty file (0 bytes).',
  UNREADABLE:        'Browser could not open the file.',
  LIB_MISSING:       'PDF reader did not load — reload the page (needs internet once).',
  OPEN_ERROR:        'PDF could not be opened.',
  TEXT_ERROR:        'PDF text could not be extracted.',
  PARSER_ERROR:      'Reader crashed on this layout — send the file in.',
  INTERNAL:          'Unexpected error — send the file in.',
  DUPLICATE_FILE:    'Same file dropped twice — skipped.',
  DUPLICATE_INVOICE: 'Same invoice number already loaded — skipped.',
  DELIVERY_NOTE:     'Delivery note — no rate check needed.',
};

// The help text is shown inline only where it says something the reason doesn't (what to do next);
// for the rest it's on the code chips' hover text.
const PR_HELP_INLINE = new Set(['READ_CHECK', 'NO_TABLE', 'NO_ROWS', 'PARSER_ERROR', 'INTERNAL']);
let parserReportFilter = 'problems';
const PARSER_BADGES = {
  'deterministic': '<span style="color:var(--green);">✓ read</span>',
  'direct-warn':   '<span style="color:#b8860b;">⚠ read check</span>',
  'delivery-note': '<span style="color:var(--ink-soft);">▫ DN skip</span>',
  'duplicate':     '<span style="color:var(--ink-soft);">⧉ duplicate</span>',
  'ai':            '<span style="color:#b8860b;">⚠ AI (old)</span>',
  'failed':        '<span style="color:var(--red);">✕ not read</span>',
};
function isProblemEntry(e){ return e.path === 'failed' || e.path === 'direct-warn' || e.path === 'ai'; }

// Shows, newest first, every file processed: how it was read and, when it wasn't a clean read, why.
// This is the "why report" — the to-do list for improving the reader: anything under "Problems" is
// either a bill to check by hand today, or a layout the reader should be taught.
function renderParserReportPanel(){
  let html = `<h3>Parser report</h3><p class="desc">Every file you've dropped in and how it was read: <b>✓ read</b> (clean — every self-check passed), <b>⚠ read check</b> (read, but some figures on the bill didn't agree with each other — possible misread), <b>✕ not read</b> (couldn't be read — check by hand), <b>▫ DN skip</b> and <b>⧉ duplicate</b> (skipped on purpose). "Problems" is the list to work through: check those bills by hand today, and send the files in so the reader can be fixed.</p>`;
  if(!parserReport.length){
    parserReportPanel.innerHTML = html + `<p class="desc">No files processed yet.</p>`;
    return;
  }
  const counts = {};
  parserReport.forEach(e => { counts[e.path] = (counts[e.path] || 0) + 1; });
  const codeCounts = {};
  parserReport.filter(isProblemEntry).forEach(e => { const c = e.code || (e.path === 'ai' ? 'AI_FALLBACK' : 'UNKNOWN'); codeCounts[c] = (codeCounts[c] || 0) + 1; });
  const lastBatch = [...parserReport].reverse().find(e => e.batch);
  const lastBatchId = lastBatch ? lastBatch.batch : null;
  const filters = [
    ['problems', 'Problems', parserReport.filter(isProblemEntry).length],
    ['batch', 'Last batch', lastBatchId ? parserReport.filter(e => e.batch === lastBatchId).length : 0],
    ['all', 'All', parserReport.length],
  ];
  const shown = parserReport.filter(e => parserReportFilter === 'all' ? true : parserReportFilter === 'batch' ? (lastBatchId && e.batch === lastBatchId) : isProblemEntry(e));

  html += `<div class="pr-summary">${Object.keys(PARSER_BADGES).filter(k => counts[k]).map(k => `${PARSER_BADGES[k]} <b>${counts[k]}</b>`).join(' &nbsp;·&nbsp; ')}</div>`;
  if(Object.keys(codeCounts).length){
    html += `<div class="pr-codes">Problems by reason: ${Object.entries(codeCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span class="code-tag" title="${escapeHtml(PARSER_CODE_HELP[c] || '')}">${escapeHtml(c)} × ${n}</span>`).join(' ')}</div>`;
  }
  html += `<div class="row pr-actions">
    ${filters.map(([k, label, n]) => `<button class="ov-chip ${parserReportFilter === k ? 'active' : ''}" data-pr-filter="${k}">${label} <span class="n">${n}</span></button>`).join('')}
    <span style="flex:1"></span>
    <span class="fill-btn" id="copyParserReportBtn" style="cursor:pointer;">Copy problems</span>
    <span class="fill-btn" id="csvParserReportBtn" style="cursor:pointer;">⬇ CSV</span>
    <span class="fill-btn" id="clearParserReportBtn" style="cursor:pointer;">Clear report</span>
  </div>`;
  html += `<div class="code-scroll"><table class="code-table"><thead><tr><th style="width:92px;">Result</th><th>File</th><th>Why / what was found</th><th style="width:110px;">When</th></tr></thead><tbody>`;
  if(!shown.length) html += `<tr><td colspan="4" style="color:var(--ink-soft);">Nothing here${parserReportFilter === 'problems' ? ' — no problems recorded ✓' : ''}.</td></tr>`;
  shown.slice().reverse().forEach(entry => {
    const help = entry.code && PR_HELP_INLINE.has(entry.code) ? `<div class="pr-help">${escapeHtml(PARSER_CODE_HELP[entry.code])}</div>` : '';
    const warnings = (entry.warnings || []).length ? `<ul class="pr-warn">${entry.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '';
    html += `<tr>
      <td>${PARSER_BADGES[entry.path] || escapeHtml(entry.path)}${entry.code ? `<div class="code-tag">${escapeHtml(entry.code)}</div>` : ''}</td>
      <td>${escapeHtml(entry.filename)}</td>
      <td style="color:var(--ink-soft);">${entry.reason ? escapeHtml(entry.reason) : '—'}${warnings}${help}</td>
      <td class="code" style="font-size:10.5px;">${escapeHtml(entry.date)}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  parserReportPanel.innerHTML = html;

  parserReportPanel.querySelectorAll('[data-pr-filter]').forEach(b => b.addEventListener('click', () => { parserReportFilter = b.dataset.prFilter; renderParserReportPanel(); }));
  document.getElementById('clearParserReportBtn').addEventListener('click', () => {
    if(!confirm('Clear the whole Parser report?')) return;
    parserReport = [];
    savePersisted();
    renderParserReportPanel();
  });
  document.getElementById('csvParserReportBtn').addEventListener('click', () => {
    const rows = [['When', 'File', 'Result', 'Code', 'Reason', 'Self-check findings']];
    parserReport.forEach(e => rows.push([e.date, e.filename, e.path, e.code || '', e.reason || '', (e.warnings || []).join(' | ')]));
    downloadCsv(rows, 'parser-report-' + fmtDate(new Date()) + '.csv');
  });
  document.getElementById('copyParserReportBtn').addEventListener('click', e => {
    const probs = parserReport.filter(isProblemEntry);
    const text = probs.length
      ? `Parser report — ${probs.length} problem file(s), ${APP_VERSION}\n\n` + probs.map(p => `${p.filename}\n  ${p.code || p.path}: ${p.reason || ''}` + ((p.warnings || []).length ? '\n' + p.warnings.map(w => '   - ' + w).join('\n') : '')).join('\n\n')
      : 'No problems in the Parser report.';
    const btn = e.target;
    const done = () => { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = 'Copy problems'; }, 1400); };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy this text:', text));
    else window.prompt('Copy this text:', text);
  });
}

function renderLogPanel(){
  let html = `<h3>Discrepancy log</h3><p class="desc">A running record of bills you've checked — date, party, and how many discrepancies were found. Kept only for your own reference; nothing here is used for matching or remembered against future bills. Persists across reloads. Add entries from the "+ Add to log" button on a confirmed bill.</p>`;
  if(!checkLog.length){
    html += `<p class="desc">No entries yet.</p>`;
  }else{
    html += `<div class="code-scroll"><table class="code-table"><thead><tr><th style="width:20px;"></th><th>Date</th><th>Party</th><th>Discrepancies</th><th></th></tr></thead><tbody>`;
    checkLog.slice().reverse().forEach(entry => {
      const hasDetail = !!(entry.discrepancies && entry.discrepancies.length);
      html += `<tr>
        <td>${hasDetail ? `<span class="fill-btn" data-toggle-log="${entry.id}" style="cursor:pointer;">▶</span>` : ''}</td>
        <td class="code">${escapeHtml(entry.date)}</td>
        <td>${escapeHtml(entry.party)}</td>
        <td class="code">${entry.discrepancyCount}</td>
        <td style="white-space:nowrap;">
          <span class="fill-btn" data-copy-log="${entry.id}" style="cursor:pointer;">Copy</span>
          <span class="fill-btn" data-remove-log="${entry.id}" style="cursor:pointer; margin-left:4px;">✕</span>
        </td>
      </tr>`;
      if(hasDetail){
        html += `<tr data-log-detail="${entry.id}" style="display:none;">
          <td></td>
          <td colspan="4" style="font-size:11px; color:var(--ink-soft); padding:2px 6px 12px; line-height:1.6;">
            ${entry.discrepancies.map(d => '• ' + escapeHtml(d)).join('<br>')}
          </td>
        </tr>`;
      }
    });
    html += `</tbody></table></div>`;
  }
  logPanel.innerHTML = html;

  logPanel.querySelectorAll('[data-toggle-log]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.toggleLog;
      const detailRow = logPanel.querySelector(`[data-log-detail="${id}"]`);
      if(!detailRow) return;
      const showing = detailRow.style.display !== 'none';
      detailRow.style.display = showing ? 'none' : 'table-row';
      el.textContent = showing ? '▶' : '▼';
    });
  });
  logPanel.querySelectorAll('[data-copy-log]').forEach(el => {
    el.addEventListener('click', () => {
      const entry = checkLog.find(e => e.id === el.dataset.copyLog);
      if(!entry) return;
      let text = `${entry.date} — ${entry.party} — ${entry.discrepancyCount} discrepanc${entry.discrepancyCount === 1 ? 'y' : 'ies'}`;
      if(entry.discrepancies && entry.discrepancies.length){
        text += '\n' + entry.discrepancies.map(d => '• ' + d).join('\n');
      }
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text);
      }
    });
  });
  logPanel.querySelectorAll('[data-remove-log]').forEach(el => {
    el.addEventListener('click', () => {
      checkLog = checkLog.filter(e => e.id !== el.dataset.removeLog);
      savePersisted();
      renderLogPanel();
    });
  });
}

// Gathers every discrepancy on a bill as plain-text lines — party mismatch, missing e-Way Bill,
// subtotal mismatch, items dispatched but never billed, and every flagged line's own issue(s).
// Shared by the discrepancy log (so an entry can be expanded to show what was actually wrong)
// and could equally back the CSV export's per-row issue text — one source of truth for "what
// counts as wrong with this bill" instead of two copies that can quietly drift apart.
function gatherBillDiscrepancies(record){
  const issues = [];
  if(record.partyMismatch) issues.push('Party name mismatch');
  if(record.ewayPresent === false) issues.push('e-Way Bill missing');
  (record.billIssues || []).forEach(x => issues.push(x));
  if(record.subtotalOk === false) issues.push('Subtotal mismatch — extraction may have missed/misread a line');

  const block = (record.selectedBlockName && excelWorkbookData)
    ? excelWorkbookData.blocks.find(b => b.customerName === record.selectedBlockName)
    : null;
  if(block){
    const claimedCodes = new Set(record.items.map(r => r.excelCode).filter(Boolean).map(normalize));
    block.activeRows.filter(r => !claimedCodes.has(normalize(r.code))).forEach(r => {
      const label = findCodeLabel(r.code);
      issues.push(`Item dispatched but not billed — Excel: ${r.code}${label ? ' — ' + label : ''} (qty ${r.qty !== null && r.qty !== undefined ? fmtQty(r.qty) : '—'})`);
    });
  }

  record.items.forEach(row => {
    const result = computeRow(row);
    if(!result.flagged) return;
    const lineIssues = [];
    if(result.rateMismatch) lineIssues.push(result.rateWarning);
    if(result.qtyMismatch) lineIssues.push(result.qtyWarning);
    if(result.bundleWarning) lineIssues.push(result.bundleWarning);
    if(result.itemMismatch) lineIssues.push(result.itemMismatchWarning);
    if(result.notDispatched) lineIssues.push(result.notDispatchedWarning);
    (result.otherIssues || []).forEach(x => lineIssues.push(x));
    issues.push(`${row.description}: ${lineIssues.join('; ')}`);
  });

  return issues;
}

function addToLog(record){
  const entry = {
    id: 'log' + Date.now() + Math.random().toString(36).slice(2,7),
    date: fmtDate(new Date()),
    party: record.parsed.partyName || record.filename,
    discrepancyCount: record.currentDiscrepancyCount || 0,
    discrepancies: gatherBillDiscrepancies(record)
  };
  checkLog.push(entry);
  savePersisted();
  if(logPanel.classList.contains('open')) renderLogPanel();
  sendBillsToSheetLog([record]);
}


function ceilTo(value, decimals){
  const f = Math.pow(10, decimals);
  return Math.ceil((value - 1e-9) * f) / f;
}
function normalize(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
// One panel open at a time.
function openOnly(panel){
  const wasOpen = panel.classList.contains('open');
  [masterPanel, rulesPanel, codesPanel, logPanel, parserReportPanel, syncPanel].forEach(p => p.classList.remove('open'));
  if(!wasOpen) panel.classList.add('open');
  return !wasOpen;
}
rulesToggle.addEventListener('click', () => openOnly(rulesPanel));
codesToggle.addEventListener('click', () => openOnly(codesPanel));
logToggle.addEventListener('click', () => { if(openOnly(logPanel)) renderLogPanel(); });
parserReportToggle.addEventListener('click', () => { if(openOnly(parserReportPanel)) renderParserReportPanel(); });
masterToggle.addEventListener('click', () => { if(openOnly(masterPanel)) renderMasterPanel(); });

// ===================== PERSISTENCE =====================
async function savePersisted(){
  noteRulesMaybeChanged();
  try{
    await branchSavePersisted();   // this branch's own rules and code tables
    await window.storage.set('btc_check_log', JSON.stringify(checkLog), false);
    // Capped to the most recent 300 — this is a rolling diagnostic feed, not a permanent record
    // like the discrepancy log, so it doesn't need unbounded growth.
    await window.storage.set('btc_parser_report', JSON.stringify(parserReport.slice(-PARSER_REPORT_CAP)), false);
  }catch(e){}
}
async function loadPersisted(){
  await branchLoadPersisted();   // this branch's own rules and code tables
  try{
    const l = await window.storage.get('btc_check_log', false);
    if(l && l.value){ const p = JSON.parse(l.value); if(Array.isArray(p)) checkLog = p; }
  }catch(e){}
  try{
    const pr = await window.storage.get('btc_parser_report', false);
    if(pr && pr.value){ const p = JSON.parse(pr.value); if(Array.isArray(p)) parserReport = p; }
  }catch(e){}
  try{
    const badge = document.getElementById('versionBadge');
    if(badge) badge.textContent = APP_VERSION;
    const fv = document.getElementById('footerVersion');
    if(fv) fv.textContent = 'Invoice Audit ' + APP_VERSION + ' · ' + BRANCH.name;
    const v = await window.storage.get('btc_tool_version', false);
    const lastVersion = (v && v.value) ? v.value : null;
    if(lastVersion && lastVersion !== APP_VERSION){
      const banner = document.createElement('div');
      banner.style.cssText = 'max-width:900px;margin:0 auto 16px;padding:8px 14px;border:1px solid var(--gold);border-radius:4px;background:var(--accent-bg);color:var(--ink);font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;text-align:center;';
      banner.textContent = 'Tool updated: ' + lastVersion + ' → ' + APP_VERSION;
      const wrap = document.querySelector('.wrap');
      if(wrap) wrap.insertBefore(banner, wrap.firstChild);
    }
    await window.storage.set('btc_tool_version', APP_VERSION, false);
  }catch(e){}
  renderRulesPanel();
  renderCodesPanel();
}

excelZone.addEventListener('click', () => excelInput.click());
excelZone.addEventListener('dragover', e => { e.preventDefault(); excelZone.classList.add('drag'); });
excelZone.addEventListener('dragleave', () => excelZone.classList.remove('drag'));
excelZone.addEventListener('drop', e => {
  e.preventDefault(); excelZone.classList.remove('drag');
  const f = Array.from(e.dataTransfer.files).find(f => /\.xlsx?$/i.test(f.name));
  if(f) loadExcelFile(f);
});
excelInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if(f) loadExcelFile(f);
  excelInput.value = '';
});

// The loaded sheet stays (also across closing the app) until "Clear all" — dropping a new one replaces it.
let excelFileName = null, excelLoadedAt = null;
function showExcelStatus(){
  if(!excelWorkbookData){ excelStatus.classList.remove('show'); excelStatus.innerHTML = ''; return; }
  const data = excelWorkbookData;
  excelStatus.className = 'excel-status show';
  excelStatus.style.background=''; excelStatus.style.borderColor=''; excelStatus.style.color='';
  const totalItems = data.blocks.reduce((s,b) => s + b.rows.length, 0);
  const skippedTotal = data.blocks.reduce((s,b) => s + (b.skippedRows || []).length, 0);
  excelStatus.innerHTML = `✓ Loaded <b>${escapeHtml(excelFileName || 'rate sheet')}</b>${excelLoadedAt ? ` (${escapeHtml(excelLoadedAt)})` : ''} — ${data.blocks.length} customers, ${totalItems} rate lines${skippedTotal ? ` (${skippedTotal} marked 0 qty — not dispatched)` : ''}. Drop another file to replace it. <span class="clear-link" id="clearAllLink">Clear all</span>`;
  document.getElementById('clearAllLink').addEventListener('click', clearAllBills);
}
function loadExcelFile(file){
  if(!window.XLSX){
    excelStatus.className = 'excel-status show';
    excelStatus.style.background = 'var(--red-bg)'; excelStatus.style.borderColor='var(--red)'; excelStatus.style.color='var(--red)';
    excelStatus.textContent = `Couldn't read ${file.name}: the Excel reader didn't load (no internet when the page was opened, or the CDN is blocked). Reload the page and try again.`;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = parseExcelWorkbook(reader.result);
      if(!data.blocks.length){
        excelStatus.className = 'excel-status show';
        excelStatus.style.background = 'var(--red-bg)'; excelStatus.style.borderColor='var(--red)'; excelStatus.style.color='var(--red)';
        excelStatus.textContent = `Couldn't find any customer blocks in ${file.name} — check the sheet layout.`;
        return;
      }
      excelWorkbookData = data;
      excelFileName = file.name;
      excelLoadedAt = fmtDateTime(new Date());
      showExcelStatus();
      // Re-apply the freshly loaded sheet to every bill already on screen — this used to only
      // re-render the match box, which for a bill that already had a customer picked meant the
      // OLD rate/qty numbers silently stuck around even though the underlying Excel had changed.
      // Now: re-find that same customer in the new data and fully recompute against it. If the
      // customer name isn't in the new sheet at all (e.g. a typo got fixed), fall back to a fresh
      // auto-guess instead of leaving a stale match in place. Already-confirmed bills get sent
      // back to review, since "was correct against the old sheet" doesn't mean "correct now."
      window.__records.forEach(record => {
        if(record.selectedBlockName){
          const newBlock = data.blocks.find(b => b.customerName === record.selectedBlockName);
          record.itemMismatches = {};
          if(newBlock){
            applyExcelMatch(record, newBlock);
          }else{
            record.selectedBlockName = null;
            record._autoGuessTried = false;
            resetItemsToUnmatched(record);
          }
        }
        const card = document.querySelector(`.invoice-card[data-record-id="${record.id}"]`);
        if(card){ refreshMatchBox(record, card); recalcCard(card); }
      });
      renderTally();
    }catch(err){
      excelStatus.className = 'excel-status show';
      excelStatus.style.background = 'var(--red-bg)'; excelStatus.style.borderColor='var(--red)'; excelStatus.style.color='var(--red)';
      excelStatus.textContent = `Could not read ${file.name}: ` + (err.message || 'unknown error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// Height ft and Length ft feed the qty conversion above, but only at the moment a row gets
// matched to an Excel line — editing either field afterward used to just recompute the rate,
// leaving the Actual Qty box showing a stale number derived from the old (often auto-guessed,
// sometimes wrong) height. This re-derives it from the same matched Excel row's raw qty every
// time either field changes, so correcting the height/length actually corrects the qty too.
// A no-op if this line isn't matched to an Excel row at all — never touches a value the person
// typed into Actual Qty directly for an unmatched line.
function refreshOrderedQtyFromExcel(record, row){
  if(!row.excelCode || !record.selectedBlockName || !excelWorkbookData) return;
  const block = excelWorkbookData.blocks.find(b => b.customerName === record.selectedBlockName);
  if(!block) return;
  const allExcelRows = [...block.activeRows, ...(block.skippedRows || [])];
  const exRow = allExcelRows.find(r => normalize(r.code) === normalize(row.excelCode));
  if(!exRow) return;
  const converted = convertExcelQtyToBilledUnit(exRow.qty, row, exRow);
  if(converted !== null) row.orderedQty = converted;
}

function applyExcelMatch(record, block){
  const { assignment, candidates } = assignExcelRowsToBillLines(record, block);
  record.items.forEach((row, idx) => {
    const ci = assignment[idx];
    const cand = ci === null || ci === undefined ? null : candidates[ci];
    const exRow = cand ? cand.row : null;
    row.excelCode = exRow ? exRow.code : null;
    // A line paired with a qty=0/blank Excel row was billed despite being marked not-dispatched —
    // flagged straight off its own matched row now, rather than inferred by a separate scan.
    row.notDispatchedButBilled = !!(cand && cand.skipped);
    row.notDispatchedCode = cand && cand.skipped ? exRow.code : null;
    row.quotedRate = null;
    row.orderedQty = null;
    if(exRow){
      if(exRow.rate !== null && !isNaN(exRow.rate)) row.quotedRate = exRow.rate;
      const converted = convertExcelQtyToBilledUnit(exRow.qty, row, exRow);
      if(converted !== null) row.orderedQty = converted;
    }
    // itemNameMismatch is intentionally left alone here — it's an independent human/system flag
    // (set in updateItemPreview), never a gate on whether the rate/qty auto-fill happens.
  });
  checkNotDispatchedButBilled(record, block);
}

function updateItemPreview(card, record){
  const tbody = card.querySelector('[data-tbody]');
  if(!tbody) return;
  const block = (record.selectedBlockName && excelWorkbookData)
    ? excelWorkbookData.blocks.find(b => b.customerName === record.selectedBlockName)
    : null;

  record.items.forEach((row, idx) => {
    const tr = tbody.querySelector(`tr[data-idx="${idx}"]`);
    if(!tr) return;
    const holder = tr.querySelector('[data-preview]');
    if(!holder) return;

    if(!block){ holder.innerHTML = ''; return; } // no customer picked → nothing to compare against (hidden in screenshot mode by CSS)

    // The matched row is whatever content-based assignment (or a manual "did you mean" swap) put on
    // this line — looked up by code across both active and skipped rows, since a billed-anyway
    // qty=0 item legitimately matches a skipped row. No positional fallback: an unmatched line
    // shows as unmatched rather than borrowing whichever row happened to sit at this index.
    const allExcelRows = [...block.activeRows, ...(block.skippedRows || [])];
    const exRow = row.excelCode
      ? allExcelRows.find(r => normalize(r.code) === normalize(row.excelCode)) || null
      : null;
    const code = exRow ? exRow.code : null;
    const label = code ? findCodeLabel(code) : null;

    const bindCheckbox = () => {
      holder.querySelector(`[data-mismatch-idx="${idx}"]`).addEventListener('change', e => {
        record.itemMismatches[idx] = e.target.checked;
        row.itemNameMismatch = e.target.checked;
        recalcCard(card);
      });
    };
    const checkboxHtml = label => `<label class="mismatch-toggle"><input type="checkbox" data-mismatch-idx="${idx}" ${record.itemMismatches[idx] ? 'checked' : ''}> ${label}</label>`;

    // Looks for a better content match among this customer's Excel rows — for a line the automatic
    // assignment left unmatched or got wrong. Rows already claimed by another bill line are excluded
    // so a suggestion can't quietly duplicate an assignment. One-click, never auto-applied.
    const findSuggestion = () => {
      const claimed = new Set(
        record.items
          .filter((r, i) => i !== idx && r.excelCode)
          .map(r => normalize(r.excelCode))
      );
      for(const candidate of allExcelRows){
        if(claimed.has(normalize(candidate.code))) continue;
        if(exRow && normalize(candidate.code) === normalize(exRow.code)) continue;
        if(matchExcelRowToDescription(candidate, row.description) === 'match') return candidate;
      }
      return null;
    };
    const suggestionHtml = () => {
      const suggestion = findSuggestion();
      if(!suggestion) return '';
      const suggestionLabel = findCodeLabel(suggestion.code);
      return `<div class="excel-code-hint spec-match-box" style="margin-top:4px;">💡 Did you mean Excel row "${escapeHtml(suggestion.code)}"${suggestionLabel ? ' — ' + escapeHtml(suggestionLabel) : ''}? <span class="fill-btn" data-use-suggestion="${idx}" style="cursor:pointer; margin-left:4px;">Use this instead</span></div>`;
    };
    const bindSuggestion = () => {
      const btn = holder.querySelector(`[data-use-suggestion="${idx}"]`);
      if(!btn) return;
      btn.addEventListener('click', () => {
        const suggestion = findSuggestion();
        if(!suggestion) return;
        row.excelCode = suggestion.code;
        if(suggestion.rate !== null && !isNaN(suggestion.rate)) row.quotedRate = suggestion.rate;
        const converted = convertExcelQtyToBilledUnit(suggestion.qty, row, suggestion);
        if(converted !== null) row.orderedQty = converted;
        record.itemMismatches[idx] = false;
        row.itemNameMismatch = false;
        updateItemPreview(card, record);
        recalcCard(card);
      });
    };

    // Full manual override: every Excel row for this customer, active or skipped, collapsed behind
    // a ▶ toggle so it doesn't clutter the common case where the automatic match is already right.
    // Selecting one always wins, regardless of what the automatic content-matching decided —
    // this is the escape hatch for whenever that matching isn't confident enough to pick on its own.
    const manualPickHtml = () => {
      const claimed = new Set(
        record.items.filter((r, i) => i !== idx && r.excelCode).map(r => normalize(r.excelCode))
      );
      const skippedSet = new Set((block.skippedRows || []).map(r => normalize(r.code)));
      const options = allExcelRows.map(r => {
        const rLabel = findCodeLabel(r.code);
        const isSelected = exRow && normalize(exRow.code) === normalize(r.code);
        let suffix = '';
        if(skippedSet.has(normalize(r.code))) suffix += ' (qty 0)';
        if(claimed.has(normalize(r.code)) && !isSelected) suffix += ' (used by another line)';
        return `<option value="${escapeHtml(r.code)}" ${isSelected ? 'selected' : ''}>${escapeHtml(r.code)}${rLabel ? ' — ' + escapeHtml(rLabel) : ''}${suffix}</option>`;
      }).join('');
      return `<div class="manual-pick" style="margin-top:4px;">
        <span class="fill-btn" data-toggle-pick="${idx}" style="cursor:pointer;">▶ pick manually</span>
        <select class="manual-pick-select" data-pick-idx="${idx}" style="display:none; margin-top:4px; width:100%; font-family:'IBM Plex Mono',monospace; font-size:11.5px; padding:4px;">
          <option value="">— select Excel item —</option>
          ${options}
        </select>
      </div>`;
    };
    const bindManualPick = () => {
      const toggle = holder.querySelector(`[data-toggle-pick="${idx}"]`);
      const select = holder.querySelector(`[data-pick-idx="${idx}"]`);
      if(!toggle || !select) return;
      toggle.addEventListener('click', () => {
        const showing = select.style.display !== 'none';
        select.style.display = showing ? 'none' : 'block';
        toggle.textContent = (showing ? '▶' : '▼') + ' pick manually';
      });
      select.addEventListener('change', () => {
        const chosen = select.value ? allExcelRows.find(r => normalize(r.code) === normalize(select.value)) : null;
        if(!chosen){
          row.excelCode = null;
          row.quotedRate = null;
          row.orderedQty = null;
          row.notDispatchedButBilled = false;
          row.notDispatchedCode = null;
        }else{
          row.excelCode = chosen.code;
          row.quotedRate = (chosen.rate !== null && !isNaN(chosen.rate)) ? chosen.rate : null;
          const converted = convertExcelQtyToBilledUnit(chosen.qty, row, chosen);
          row.orderedQty = converted !== null ? converted : null;
          const isSkipped = (block.skippedRows || []).some(s => normalize(s.code) === normalize(chosen.code));
          row.notDispatchedButBilled = isSkipped;
          row.notDispatchedCode = isSkipped ? chosen.code : null;
        }
        record.itemMismatches[idx] = false;
        row.itemNameMismatch = false;
        updateItemPreview(card, record);
        recalcCard(card);
      });
    };

    if(!code){
      if(record.itemMismatches[idx] === undefined) record.itemMismatches[idx] = true;
      row.itemNameMismatch = record.itemMismatches[idx];
      holder.innerHTML = `<div class="excel-code-hint" style="color:var(--red);">No confident Excel match for this item — pick one manually</div>` + checkboxHtml('✕ mark item mismatch') + suggestionHtml() + manualPickHtml();
      bindCheckbox(); bindSuggestion(); bindManualPick();
      return;
    }

    const specResult = matchExcelRowToDescription(exRow, row.description);

    if(specResult === 'match'){
      if(record.itemMismatches[idx] === undefined) record.itemMismatches[idx] = false;
      row.itemNameMismatch = record.itemMismatches[idx];
      holder.innerHTML = `<div class="excel-code-hint spec-match-box">✓ matches item code — Excel: ${escapeHtml(code)}${label ? ' — ' + escapeHtml(label) : ''}</div>` + checkboxHtml('✕ flag anyway') + manualPickHtml();
      bindCheckbox(); bindManualPick();
      return;
    }

    if(specResult === null){
      if(record.itemMismatches[idx] === undefined) record.itemMismatches[idx] = false;
      row.itemNameMismatch = record.itemMismatches[idx];
      holder.innerHTML = `<div class="excel-code-hint">Excel: ${escapeHtml(code)}</div>` + checkboxHtml('✕ mark item mismatch') + suggestionHtml() + manualPickHtml();
      bindCheckbox(); bindSuggestion(); bindManualPick();
      return;
    }

    // specResult === 'mismatch' — the system itself spotted a disagreement; pre-flag it before the human has to
    if(record.itemMismatches[idx] === undefined) record.itemMismatches[idx] = true;
    row.itemNameMismatch = record.itemMismatches[idx];
    holder.innerHTML = `<div class="excel-code-hint spec-mismatch-box">⚠ Possible item mismatch — Excel: ${escapeHtml(code)}${label ? ' — ' + escapeHtml(label) : ''}</div>` + checkboxHtml('✕ mark item mismatch') + suggestionHtml() + manualPickHtml();
    bindCheckbox(); bindSuggestion(); bindManualPick();
  });
}

function resetItemsToUnmatched(record){
  record.items.forEach(row => {
    row.quotedRate = null;
    row.orderedQty = row.quantity;
    row.excelCode = null;
    row.itemNameMismatch = false;
  });
  record.itemMismatches = {};
}

function refreshMatchBox(record, card){
  const box = card.querySelector('.match-box');
  if(!excelWorkbookData){
    box.className = 'match-box';
    box.innerHTML = `<span class="no-excel-note">No rate Excel loaded yet — drop it above to auto-fill quoted rates for this bill. Until then, enter rates manually below.</span>`;
    renderLineCountNote(card, record, null);
    updateItemPreview(card, record);
    return;
  }
  const buyerName = record.parsed.partyName || '';
  const blocks = excelWorkbookData.blocks;

  // First time this bill sees an Excel sheet: auto-pick a best guess, live — but guessBestBlock
  // itself now gates on confidence + runner-up margin, so this only auto-applies when it's
  // genuinely confident; otherwise it returns null and the dropdown is left for a manual pick.
  if(record.selectedBlockName === null && !record._autoGuessTried){
    record._autoGuessTried = true;
    const guess = guessBlockWithParties(buyerName, blocks);
    if(guess){
      record.selectedBlockName = guess.customerName;
      record.partyAuto = true;
      record.partyNote = guess._matchNote || null;
      record.itemMismatches = {};
      applyExcelMatch(record, guess);
    }
  }

  // v6.3: no separate "Confirm names" step. A confident automatic match counts straight away; an
  // uncertain one leaves the dropdown on "select customer" and the bill waits for a pick. The
  // dropdown stays live either way, so a wrong match is one change away.
  box.className = 'match-box' + (record.selectedBlockName ? ' confirmed' : '');
  const statusTag = record.selectedBlockName
    ? `<span class="confirmed-tag">✓ ${record.partyAuto ? 'Matched automatically' : 'Picked by hand'}</span>${record.partyAuto && record.partyNote ? ` <span class="info-note" style="display:inline;">ⓘ ${escapeHtml(record.partyNote)}</span>` : ''}`
    : `<span class="party-mismatch-tag">Pick the customer this bill belongs to</span>`;
  box.innerHTML = `
    <div class="row match-edit">
      <div class="field"><b>Order Name (Excel)</b>
        <select id="blockSelect">
          <option value="">— select customer —</option>
          ${blocks.map(b => `<option value="${escapeHtml(b.customerName)}" ${record.selectedBlockName === b.customerName ? 'selected' : ''}>${escapeHtml(b.customerName)}</option>`).join('')}
        </select>
      </div>
      <div class="match-status">${statusTag}</div>
      <label class="mismatch-toggle"><input type="checkbox" id="partyMismatchBox" ${record.partyMismatch ? 'checked' : ''}> ✕ mark party name mismatch</label>
    </div>
    <div class="row ss-only">
      <span class="confirmed-tag">${record.selectedBlockName ? '✓ Matched: ' + escapeHtml(record.selectedBlockName) : 'Customer not picked'}</span>
      ${record.partyMismatch ? '<span class="party-mismatch-tag" style="margin-left:14px;">⚠ Party name Mismatch</span>' : ''}
    </div>
  `;
  box.querySelector('#blockSelect').addEventListener('change', e => {
    const val = e.target.value || null;
    record.selectedBlockName = val;
    record.partyAuto = false;
    record.itemMismatches = {};
    if(val){
      const block = blocks.find(b => b.customerName === val);
      if(block) applyExcelMatch(record, block);
    }else{
      resetItemsToUnmatched(record);
    }
    refreshMatchBox(record, card);
    recalcCard(card);
  });
  box.querySelector('#partyMismatchBox').addEventListener('change', e => {
    record.partyMismatch = e.target.checked;
    refreshMatchBox(record, card);
    recalcCard(card);
  });
  renderLineCountNote(card, record, record.selectedBlockName ? blocks.find(b => b.customerName === record.selectedBlockName) : null);
  updateItemPreview(card, record);
}

// ===================== EXTRACTION =====================
function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmt(n){
  if(n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// For quantities: whole numbers show clean ("16", not "16.00"); genuine fractions still show their decimals.
function fmtQty(n){
  if(n === null || n === undefined || isNaN(n)) return '—';
  const num = Number(n);
  if(Math.abs(num - Math.round(num)) < 1e-9) return Math.round(num).toLocaleString('en-IN');
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ===================== DIRECT (NON-AI) INVOICE PARSER =====================
// The only read path. Built specifically for Jain Wire's own
// Tally-generated invoice template. Reads exact text positions off the PDF (via pdf.js) and
// locates every field by its fixed column position or label anchor — no model call, no chance
// of a digit being misread, either the expected text is exactly where the template puts it or
// it isn't. Validated field-for-field, line-for-line against two real invoices before being
// wired in below.
//
// Anything that doesn't match this exact layout is reported in the Parser report with the reason,
// so it can be checked by hand on the day and the reader taught the new layout later.
function detParseMoney(s){
  if(!s) return null;
  const m = String(s).replace(/,/g,'').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function detLineText(line){ return line.items.map(i => i.text).join(' '); }

// Delivery notes come out of Tally with the same letterhead and item table as a tax invoice, but
// they aren't bills and don't need a rate check. Returns { number, party } for a delivery note,
// or null for anything else. Deliberately strict: if "Tax Invoice" appears anywhere in the PDF it
// is never treated as a delivery note, so a real invoice can't be skipped by accident. The number
// and party are only for the on-screen note — if either can't be read, the skip still happens.
function detectDeliveryNote(lines){
  const texts = lines.map(detLineText);
  if(texts.some(t => /Tax\s+Invoice/i.test(t))) return null;
  const isDN = texts.some(t => /^\s*DELIVERY\s+NOTE\s*$/i.test(t)) || texts.some(t => /Delivery\s+Note\s+No/i.test(t));
  if(!isDN) return null;
  const valueBelow = (labelRe, width) => {
    for(let i = 0; i < lines.length; i++){
      const label = lines[i].items.find(it => labelRe.test(it.text));
      if(!label) continue;
      for(let j = i + 1; j < lines.length && j <= i + 3; j++){
        const inCol = lines[j].items.filter(it => it.x >= label.x - 10 && it.x < label.x + width);
        if(inCol.length) return inCol.map(it => it.text).join(' ').trim();
      }
      return null;
    }
    return null;
  };
  return {
    number: valueBelow(/Delivery\s+Note\s+No/i, 60),
    party: valueBelow(/Buyer\s*\(Bill\s*to\)/i, 260) || valueBelow(/Consignee/i, 260)
  };
}


// Text items grouped into visual lines, kept strictly separate PER PAGE (never clustered across
// a page boundary) — two different pages' content can share numerically similar y-coordinates
// since each page's y resets to its own top, so merging them here would silently interleave
// unrelated rows from different pages into the same "line".
async function extractPdfLinesForParsing(pdfjsDoc){
  const allLines = [];
  const perPage = [];
  const TOL = 2.5;
  for(let p = 1; p <= pdfjsDoc.numPages; p++){
    const page = await pdfjsDoc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter(it => it.str && it.str.trim())
      // "(cid:299)" is an unmapped font glyph (usually the rupee sign) — never real content, and left in
      // place its number could be read instead of the figure beside it.
      .map(it => ({ x: it.transform[4], y: it.transform[5], w: it.width || 0, text: it.str.replace(/\(cid:\d+\)/g, ' ').replace(/\s+/g, ' ').trim() }))
      .filter(it => it.text);
    items.sort((a,b) => b.y - a.y || a.x - b.x); // pdf.js y increases upward: descending y = top to bottom
    const pageLines = [];
    const pageText = content.items.map(it => it.str).join(' ');
    items.forEach(it => {
      let line = pageLines.find(l => Math.abs(l.y - it.y) <= TOL);
      if(!line){ line = { y: it.y, items: [] }; pageLines.push(line); }
      line.items.push(it);
    });
    pageLines.forEach(l => l.items.sort((a,b) => a.x - b.x));
    pageLines.sort((a,b) => b.y - a.y);
    perPage.push({
      lines: pageLines,
      // An e-Way Bill page with no item table on it.
      ewayOnly: /e-?\s*way\s*bill/i.test(pageText) && !/description of goods/i.test(pageText),
      isCopy: /\(\s*(DUPLICATE|TRIPLICATE)\s+FOR\b/i.test(pageText)
    });
  }
  // A PDF can also carry a second full copy of the invoice ("DUPLICATE FOR TRANSPORTER",
  // "TRIPLICATE FOR SUPPLIER"). Everything from the first such page onward is a copy of what was
  // already read — reading it again would list every line twice. Only cut when an earlier page
  // exists, so a PDF that is ONLY a duplicate copy still reads normally.
  const copyAt = perPage.findIndex((p, i) => i > 0 && p.isCopy);
  if(copyAt > 0) perPage.length = copyAt;
  // e-Way-only pages are skipped here (the direct parser used to receive an already-trimmed PDF;
  // the trim now only runs for the AI fallback). Never drops every page — if all pages look
  // e-Way-only, all are kept and the parser decides.
  const keep = perPage.filter(p => !p.ewayOnly);
  const use = (perPage.length > 1 && keep.length && keep.length < perPage.length) ? keep : perPage;
  use.forEach(p => allLines.push(...p.lines));
  return allLines;
}

// Returns { data, code, reason }. data is the parsed bill, or null
// if this PDF doesn't match the expected template closely enough to trust. reason is a plain-English
// explanation whenever data is null — never used for logic, only so a person can see WHY a bill
// fell back to the AI path (or failed outright) without having to open the browser console.
function parseInvoiceDeterministic(lines){
  const fullTextLines = lines.map(detLineText);
  const findVal = (re) => {
    for(const t of fullTextLines){ const m = t.match(re); if(m) return m[1].trim(); }
    return null;
  };
  const invoiceNumber = findVal(/Invoice\s*No\.?:?\s*(\S+)/i);
  const invoiceDate = findVal(/\bDated:?\s*(\S+)/i);
  const eWayBillNumber = findVal(/e-?\s*Way\s*Bill\s*No\.?:?\s*(\d+)/i);

  // Party name: the line right below the "Buyer" label, restricted to THAT label's own text
  // column — anchored on the "Buyer" word itself (not the whole row's leftmost x), since that
  // row is shared with "Invoice No.:" on the left half of the same visual line.
  let partyName = null;
  const buyerIdx = lines.findIndex(l => l.items.some(it => /Buyer/i.test(it.text)));
  if(buyerIdx >= 0){
    const buyerItem = lines[buyerIdx].items.find(it => /Buyer/i.test(it.text));
    const colX = buyerItem.x;
    for(let i = buyerIdx + 1; i < lines.length; i++){
      const inCol = lines[i].items.filter(it => it.x >= colX - 10 && it.x < colX + 260);
      if(inCol.length){ partyName = inCol.map(it => it.text).join(' '); break; }
    }
  }

  let grandTotal = null;
  for(const l of lines){
    const t = detLineText(l).trim();
    if(/^Total\b/.test(t) && /\d/.test(t)){
      // The Total row also carries the total QUANTITY ("Total 10.00 NOS ₹ 33,225.00"), and the
      // rupee sign can come through as a "(cid:299)" glyph — so take the LAST number on the
      // line (the amount always prints last), never the first.
      const nums = t.replace(/\(cid:\d+\)/g, ' ').match(/-?[\d,]+(?:\.\d+)?/g) || [];
      grandTotal = nums.length ? detParseMoney(nums[nums.length - 1]) : null;
      break;
    }
  }

  const items = [];
  let taxableTotal = null, inTable = false, sawHeader = false;
  // v6.2 self-check data: the tax rows (CGST/SGST/IGST/Round Off) between the item table and the
  // Total row are added up, so the read can be checked as subtotal + tax + round-off = total.
  let taxSum = 0, taxLines = 0, roundOff = 0;
  const lastNum = (s) => {
    const nums = String(s).replace(/\(cid:\d+\)/g, ' ').match(/-?[\d,]+(?:\.\d+)?/g) || [];
    return nums.length ? detParseMoney(nums[nums.length - 1]) : null;
  };
  for(const l of lines){
    const t = detLineText(l);
    const tt = t.trim();
    if(/Description\s+of\s+Goods/i.test(t)){ sawHeader = true; inTable = true; continue; }
    if(!sawHeader) continue;
    if(/^Total\b/.test(tt)) break;
    if(/^(CGST|SGST|IGST)\b/i.test(tt)){
      inTable = false;
      const n = lastNum(tt);
      if(n !== null){ taxSum += n; taxLines++; }
      continue;
    }
    if(/Round\s*Off/i.test(tt)){
      inTable = false;
      const n = lastNum(tt);
      if(n !== null) roundOff += (/Less|\(-\)/i.test(tt) || n < 0) ? -Math.abs(n) : n;
      continue;
    }
    if(!inTable) continue;

    const bucket = { slno:[], desc:[], hsn:[], qty:[], rate:[], per:[], amt:[] };
    l.items.forEach(it => { const c = detColOf(it); if(c) bucket[c].push(it.text); });
    const slnoText = bucket.slno.join('');
    const isNewRow = /^\d+$/.test(slnoText);

    if(isNewRow){
      items.push({ slno: parseInt(slnoText, 10), description: bucket.desc.join(' '), qtyRaw: bucket.qty.join(' '), rateRaw: bucket.rate.join(' '), perRaw: bucket.per.join(' '), amtRaw: bucket.amt.join(' ') });
    }else if(bucket.desc.length && !bucket.amt.length && !bucket.hsn.length && !bucket.qty.length && items.length){
      const cont = bucket.desc.join(' ').trim();
      // v6.2: a line holding ONLY a number under an item ("2" under "GI Wire 18g", "5" under a
      // chainlink line) is Tally's bundle/roll count, not part of the item name. Gluing it on gave
      // "GI Wire 18g 2", which no longer matched the rate-sheet code — a false "item mismatch" plus
      // a false "dispatched but not billed". Real wrapped text ("100ft", "65X65X2.5X2FT") still joins.
      if(/^\d+(\.\d+)?$/.test(cont)) items[items.length - 1].countNote = cont;
      else items[items.length - 1].description += ' ' + cont; // wrapped continuation, e.g. a trailing "100ft"
    }else if(bucket.amt.length && !bucket.desc.length && !bucket.slno.length && !bucket.hsn.length){
      taxableTotal = detParseMoney(bucket.amt.join(' ')); // the unlabeled subtotal row above CGST/SGST
    }
  }
  const sellerFound = fullTextLines.some(t => /JAIN\s*WIRE/i.test(t));
  // The seller's GSTIN is the first one printed on the page (the buyer's comes later, under Buyer).
  const sellerGstin = (findVal(/GSTIN\/UIN\s*:?\s*([0-9A-Z]{15})/i) || '').toUpperCase() || null;
  if(!sawHeader){
    if(!sellerFound){
      return { data: null, code: 'NOT_JAINWIRE', reason: 'Neither "Jain Wire" nor a "Description of Goods" item table was found — this is probably not a Jain Wire sales invoice (a purchase bill, quotation, or another company\'s document).' };
    }
    return { data: null, code: 'NO_TABLE', reason: 'No "Description of Goods" item-table header found on any page — this may not be a Jain Wire tax invoice (e.g. a packing slip, quotation, or a different Tally print format).' };
  }
  if(items.length === 0){
    return { data: null, code: 'NO_ROWS', reason: 'Found the item-table header, but no row underneath it had a recognizable serial-number column — the row layout on this file doesn\'t match what\'s expected.' };
  }

  const parsedItems = items.map(it => {
    // Strip thousands separators first: a quantity like "1,250.000 sq.ft" would otherwise match
    // just the "1" before the comma and leave ", sq.ft" as the unit.
    const qtyClean = it.qtyRaw.replace(/,/g, '');
    const qm = qtyClean.match(/-?\d+(\.\d+)?/);
    // Unit is printed after the quantity ("3 PICS"); when it isn't, fall back to the "per" column.
    const unit = qtyClean.replace(/-?\d+(\.\d+)?/, '').trim() || String(it.perRaw || '').trim();
    // On some layouts the HSN code lands just inside the description column ("… 12x5 73142010").
    // No real description ends in a bare 6–8 digit run, so it's dropped from the tail.
    const desc = it.description.replace(/\s+/g, ' ').trim().replace(/\s+\d{6,8}$/, '').trim();
    return { slno: it.slno, description: BRANCH.descMaxChars ? desc.slice(0, BRANCH.descMaxChars) : desc, quantity: qm ? parseFloat(qm[0]) : null, unit: unit || null, rate: detParseMoney(it.rateRaw), amount: detParseMoney(it.amtRaw) };
  });

  return {
    data: { partyName, invoiceNumber, invoiceDate, taxableTotal, grandTotal, eWayBillNumber, sellerGstin, items: parsedItems,
            _check: { taxSum, taxLines, roundOff, sellerFound } },
    code: null, reason: null
  };
}

// ===================== READ SELF-CHECK (v6.2) =====================
// A bill can be "read" and still be read WRONG — a digit lost, a line skipped, two lines merged.
// Rather than trust the reader blindly, every bill it reads is checked against itself, using
// arithmetic the printed bill must satisfy. None of this compares against the rate sheet; it only
// asks "do the numbers on this PDF agree with each other as read?" Anything that doesn't is listed
// on the bill card and in the Parser report, so a misread is caught on the day and the reader can
// be fixed later from the report. Returns a list of plain-English warnings (empty = read is sound).
function sanityCheckInvoice(data){
  const w = [];
  if(!data) return w;
  const chk = data._check || {};
  if(!data.partyName) w.push('Party (Buyer) name not found on the bill');
  if(!data.invoiceNumber) w.push('Invoice number not found');
  if(!data.invoiceDate) w.push('Invoice date not found');
  if(chk.sellerFound === false) w.push('Seller name "Jain Wire" not found — check this is one of our invoices');

  const items = data.items || [];
  // Serial numbers must run 1, 2, 3 … with no gaps — a jump means a row was skipped or merged.
  for(let i = 0; i < items.length; i++){
    const expected = i + 1;
    if(items[i].slno !== undefined && items[i].slno !== expected){
      const prev = i > 0 ? items[i - 1].slno : 'start';
      w.push(`Serial numbers jump from ${prev} to ${items[i].slno} — a line may have been skipped or merged`);
      break;
    }
  }
  items.forEach((it, i) => {
    const n = it.slno || (i + 1);
    const missing = [];
    if(it.quantity === null || it.quantity === undefined || isNaN(it.quantity)) missing.push('quantity');
    if(it.rate === null || it.rate === undefined || isNaN(it.rate)) missing.push('rate');
    if(it.amount === null || it.amount === undefined || isNaN(it.amount)) missing.push('amount');
    if(!it.unit) missing.push('unit');
    if(missing.length){ w.push(`Line ${n}: ${missing.join(', ')} not read`); return; }
    // Tally computes amount = qty × rate. The printed rate is rounded to 2 decimals, so allow for
    // that rounding (half a paisa per unit) — anything bigger means a figure was misread, or the
    // amount was typed over by hand in Tally. Either way a person should look.
    const calc = it.quantity * it.rate;
    const tol = Math.max(1, Math.abs(it.amount) * 0.001, Math.abs(it.quantity) * 0.006);
    if(Math.abs(calc - it.amount) > tol){
      w.push(`Line ${n}: ${fmtQty(it.quantity)} × ₹${fmt(it.rate)} = ₹${fmt(calc)}, but the amount printed is ₹${fmt(it.amount)}`);
    }
  });

  const lineSum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  if(data.taxableTotal === null || data.taxableTotal === undefined){
    w.push('Subtotal (before tax) not found');
  }else if(Math.abs(lineSum - data.taxableTotal) > 1){
    w.push(`Lines add up to ₹${fmt(lineSum)}, but the subtotal printed is ₹${fmt(data.taxableTotal)} — a line may be missing or misread`);
  }
  if(data.grandTotal === null || data.grandTotal === undefined){
    w.push('Grand total not found');
  }else if(data.taxableTotal !== null && data.taxableTotal !== undefined){
    if(!chk.taxLines){
      w.push('No CGST / SGST / IGST lines found under the items');
    }else{
      const built = data.taxableTotal + chk.taxSum + (chk.roundOff || 0);
      if(Math.abs(built - data.grandTotal) > 1){
        w.push(`Subtotal ₹${fmt(data.taxableTotal)} + tax ₹${fmt(chk.taxSum)} + round-off ₹${fmt(chk.roundOff || 0)} = ₹${fmt(built)}, but the total printed is ₹${fmt(data.grandTotal)}`);
      }
    }
  }
  return w;
}

// ===================== RENDERING =====================
function renderCard(record, container, prepend){
  const { parsed } = record;
  const card = document.createElement('div');
  card.className = 'card invoice-card';
  card.dataset.recordId = record.id;

  const sumBilledRaw = record.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  let totalCheckHtml = '<span class="total-check na">No subtotal read from this bill to cross-check against.</span>';
  record.subtotalOk = null;
  if(parsed.taxableTotal !== null && parsed.taxableTotal !== undefined){
    const diff = Math.abs(sumBilledRaw - parsed.taxableTotal);
    const ok = diff <= Math.max(2, parsed.taxableTotal * 0.002);
    record.subtotalOk = ok;
    totalCheckHtml = `<span class="total-check ${ok ? 'ok' : 'bad'}">Subtotal (before tax) ₹${fmt(parsed.taxableTotal)} vs sum of lines ₹${fmt(sumBilledRaw)} ${ok ? '— matches ✓' : '— MISMATCH ✗ (extraction may have missed/misread a line)'}</span>`;
    if(parsed.grandTotal !== null && parsed.grandTotal !== undefined){
      totalCheckHtml += `<span class="total-check na" style="margin-left:14px;">Grand total (incl. tax): ₹${fmt(parsed.grandTotal)}</span>`;
    }
  }
  record.ewayPresent = !!(parsed.eWayBillNumber && String(parsed.eWayBillNumber).trim());
  totalCheckHtml += record.ewayPresent
    ? `<span class="total-check ok" style="margin-left:14px;">✓ e-Way Bill present</span>`
    : `<span class="total-check bad" style="margin-left:14px;">✗ e-Way Bill missing</span>`;

  card.innerHTML = `
    <div class="stamp pending" data-stamp>Awaiting rates</div>
    <div class="meta">
      <p class="vendor">${escapeHtml(parsed.partyName || record.filename)}</p>
      <p class="subline"><span class="seq-tag">#${record.seq}</span> ${escapeHtml(parsed.invoiceNumber || 'No invoice #')} · ${escapeHtml(parsed.invoiceDate || 'no date read')} · <span class="file-tag" title="File name">${escapeHtml(record.filename)}</span>${sellerEntityLabel(parsed) && Object.keys(BRANCH.gstins).length > 1 ? ` · <span class="entity-tag" title="Seller GSTIN ${escapeHtml(parsed.sellerGstin)}">${escapeHtml(sellerEntityLabel(parsed))}</span>` : ''}</p>
    </div>
    <div class="total-check-row">${totalCheckHtml}</div>
    <div data-read-check></div>
    <div class="match-box"></div>
    <div data-discrepancy-summary></div>
    <div class="items-table">
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Actual Qty</th>
          <th class="num">Billed Qty</th>
          <th>Unit</th>
          <th class="num">Billed Rate</th>
          <th class="num">Expected Rate</th>
          <th>Category</th>
          <th class="num">Height ft</th>
          <th class="num">Length ft</th>
          <th class="num">Quoted Rate</th>
          <th class="num">Billed Amount</th>
          <th class="num">✓</th>
        </tr>
      </thead>
      <tbody data-tbody></tbody>
      <tfoot data-tfoot></tfoot>
    </table>
    </div>
    <div data-missing-items></div>
    <div data-line-count-note></div>
    <div class="card-actions">
      <button data-action="log">📋 Add to log</button>
      <button data-action="remove">✕ Remove this bill</button>
    </div>
  `;
  if(prepend) container.prepend(card); else container.appendChild(card);

  card.querySelector('[data-action="log"]').addEventListener('click', (e) => {
    addToLog(record);
    const btn = e.target;
    const original = btn.textContent;
    btn.textContent = '✓ Logged';
    setTimeout(() => { btn.textContent = original; }, 1200);
  });

  card.querySelector('[data-action="remove"]').addEventListener('click', () => {
    window.__records = window.__records.filter(r => r.id !== record.id);
    card.remove();
    updateExportBarVisibility();
    renderTally();
    renderOverview();
  });

  const tbody = card.querySelector('[data-tbody]');
  record.items.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;
    tr.innerHTML = `
      <td class="desc">${escapeHtml(row.description)}${row.masterName ? `<span class="src-tag" title="Found in the item list: ${escapeHtml(row.masterName)}">item list ✓</span>` : ''}<div data-preview></div></td>
      <td class="num"><input class="cell-input" data-field="orderedQty" value="${row.orderedQty !== null ? row.orderedQty : ''}" style="width:64px;"><div class="qty-calc" data-qty-calc></div></td>
      <td class="num">${row.quantity}</td>
      <td>${escapeHtml(row.unit || '')}</td>
      <td class="num">${fmt(row.rate)}</td>
      <td class="num" data-field="expectedRate">—</td>
      <td><select class="cell-select" data-field="category">
            ${Object.keys(rules).map(k => `<option value="${k}" ${row.category===k?'selected':''}>${rules[k].label}</option>`).join('')}
          </select></td>
      <td class="num"><input class="cell-input" data-field="heightFt" value="${row.heightFt !== null ? row.heightFt : ''}" style="width:52px;"></td>
      <td class="num"><input class="cell-input" data-field="customLengthFt" value="${row.customLengthFt !== null ? row.customLengthFt : ''}" placeholder="${(rules[row.category] || rules.direct).lengthFt || ''}" title="Leave blank to use the category default (12ft sheets, 50ft rolls). Fill in only for a non-standard length, e.g. a 100ft roll." style="width:60px;"></td>
      <td class="num"><div class="rate-cell"><input class="cell-input" data-field="quotedRate" value="${row.quotedRate !== null ? row.quotedRate : ''}" placeholder="rate" style="width:68px;"><button type="button" class="fill-btn" data-action="fill" title="Copy this rate to every other row in the same category">↧all</button></div></td>
      <td class="num">${fmt(row.amount)}</td>
      <td class="num status" data-field="status">—</td>
    `;
    tbody.appendChild(tr);

    tr.querySelector('[data-field="orderedQty"]').addEventListener('input', e => {
      row.orderedQty = e.target.value === '' ? null : parseFloat(e.target.value);
      recalcCard(card);
    });
    tr.querySelector('[data-field="category"]').addEventListener('change', e => {
      row.category = e.target.value;
      if(BRANCH.qtyFollowsCategory) refreshOrderedQtyFromExcel(record, row);
      recalcCard(card);
    });
    tr.querySelector('[data-field="heightFt"]').addEventListener('input', e => {
      row.heightFt = e.target.value === '' ? null : parseFloat(e.target.value);
      refreshOrderedQtyFromExcel(record, row);
      recalcCard(card);
    });
    tr.querySelector('[data-field="customLengthFt"]').addEventListener('input', e => {
      row.customLengthFt = e.target.value === '' ? null : parseFloat(e.target.value);
      refreshOrderedQtyFromExcel(record, row);
      recalcCard(card);
    });
    tr.querySelector('[data-field="quotedRate"]').addEventListener('input', e => {
      row.quotedRate = e.target.value === '' ? null : parseFloat(e.target.value);
      recalcCard(card);
    });
    tr.querySelector('[data-action="fill"]').addEventListener('click', () => {
      if(row.quotedRate === null || row.quotedRate === '' || isNaN(row.quotedRate)) return;
      record.items.forEach(other => {
        if(other !== row && other.category === row.category) other.quotedRate = row.quotedRate;
      });
      recalcCard(card);
    });
  });

  renderReadCheck(card, record);
  refreshMatchBox(record, card);
  recalcCard(card);
}

// The read self-check result for this bill (see sanityCheckInvoice). Shown right under the totals
// so it's seen BEFORE anyone trusts the rate check: if the reader got a figure wrong, the rate
// check below is checking the wrong number. Once a person has compared the listed lines with the
// PDF they tick it off, and the bill can then be marked Verified.
function renderReadCheck(card, record){
  const holder = card.querySelector('[data-read-check]');
  if(!holder) return;
  const w = record.readWarnings || [];
  if(!w.length){ holder.innerHTML = ''; return; }
  if(record.readWarningsAck){
    holder.innerHTML = `<div class="read-check acked">✓ Read check: ${w.length} item${w.length === 1 ? '' : 's'} compared with the PDF. <span class="change-link" data-action="unack">undo</span></div>`;
    holder.querySelector('[data-action="unack"]').addEventListener('click', () => { record.readWarningsAck = false; renderReadCheck(card, record); recalcCard(card); });
    return;
  }
  holder.innerHTML = `<div class="read-check">
    <div class="read-check-head">⚠ Read check — the bill was read, but these figures don't agree with each other. Compare them with the PDF before trusting the rate check:</div>
    ${w.map(x => `<div class="read-check-line">• ${escapeHtml(x)}</div>`).join('')}
    <button type="button" data-action="ack">✓ I've checked these against the PDF</button>
  </div>`;
  holder.querySelector('[data-action="ack"]').addEventListener('click', () => { record.readWarningsAck = true; renderReadCheck(card, record); recalcCard(card); });
}

// Looks for Excel rows that were expected to be dispatched (qty > 0) but never got claimed by any
// billed line at all — the inverse of the "not dispatched but billed" check.
function renderMissingItems(card, record){
  const container = card.querySelector('[data-missing-items]');
  if(!container) return [];
  const block = (record.selectedBlockName && excelWorkbookData)
    ? excelWorkbookData.blocks.find(b => b.customerName === record.selectedBlockName)
    : null;
  if(!block){ container.innerHTML = ''; return []; }

  const claimedCodes = new Set(record.items.map(r => r.excelCode).filter(Boolean).map(normalize));
  const missing = block.activeRows.filter(r => !claimedCodes.has(normalize(r.code)));

  if(!missing.length){ container.innerHTML = ''; return []; }
  container.innerHTML = `<div class="missing-items-box">` + missing.map(r => {
    const label = findCodeLabel(r.code);
    return `<div class="missing-item-row">⚠ Item dispatched but not billed — Excel: ${escapeHtml(r.code)}${label ? ' — ' + escapeHtml(label) : ''} (qty ${r.qty !== null && r.qty !== undefined ? fmtQty(r.qty) : '—'})</div>`;
  }).join('') + `</div>`;
  return missing;
}

// Renders the top-of-bill summary banner. Uses the same gatherBillDiscrepancies() that backs the
// discrepancy log and CSV export, so all three always say exactly the same thing about a bill.
// The "Excel has N expected lines vs bill has M" note. Lives at the BOTTOM of the bill now:
// it's context about how the sheet lines up, not a discrepancy in itself, so it shouldn't
// compete with the party name and the actual discrepancy summary at the top.
function renderLineCountNote(card, record, block){
  const holder = card.querySelector('[data-line-count-note]');
  if(!holder) return;
  if(!block || block.activeRows.length === record.items.length){ holder.innerHTML = ''; return; }
  holder.innerHTML = `<div class="line-count-note">⚠ Excel has ${block.activeRows.length} expected line(s) for this customer (${block.skippedRows.length ? block.skippedRows.length + ' marked not-dispatched' : 'none marked not-dispatched'}), bill has ${record.items.length}. Items are matched by content, not order, so any line that can't be matched confidently is marked for a manual pick.</div>`;
}

function renderDiscrepancySummary(card, record){
  const holder = card.querySelector('[data-discrepancy-summary]');
  if(!holder) return;
  const issues = gatherBillDiscrepancies(record);
  if(!issues.length){ holder.innerHTML = ''; return; }
  holder.innerHTML = `<div class="discrepancy-summary">
    <div class="discrepancy-summary-head">⚠ ${issues.length} discrepanc${issues.length === 1 ? 'y' : 'ies'} on this bill</div>
    ${issues.map(i => `<div class="discrepancy-summary-line">• ${escapeHtml(i)}</div>`).join('')}
  </div>`;
}

function recalcCard(card){
  const record = window.__records.find(r => r.id === card.dataset.recordId);
  if(!record) return;
  const tbody = card.querySelector('[data-tbody]');
  let anyFlag = !!record.partyMismatch, anyPending = false;
  let sumBilled = 0, sumExpected = 0, allComputed = true;
  let discrepancyCount = record.partyMismatch ? 1 : 0;

  record.items.forEach((row, idx) => {
    const tr = tbody.querySelector(`tr[data-idx="${idx}"]`);
    const result = computeRow(row);
    sumBilled += row.amount;
    if(result.expectedRate !== null) sumExpected += result.expectedRate * row.quantity;
    else allComputed = false;

    const quotedInput = tr.querySelector('[data-field="quotedRate"]');
    const currentVal = row.quotedRate === null ? '' : String(row.quotedRate);
    if(document.activeElement !== quotedInput && quotedInput.value !== currentVal) quotedInput.value = currentVal;
    const orderedInput = tr.querySelector('[data-field="orderedQty"]');
    const currentOrdered = row.orderedQty === null ? '' : String(row.orderedQty);
    if(document.activeElement !== orderedInput && orderedInput.value !== currentOrdered) orderedInput.value = currentOrdered;

    tr.classList.toggle('flag', result.flagged);
    tr.classList.toggle('pending', result.pending && !result.qtyMismatch);
    tr.querySelector('[data-field="expectedRate"]').textContent = result.expectedRate !== null ? fmt(result.expectedRate) : '—';
    const statusCell = tr.querySelector('[data-field="status"]');
    const showPending = result.pending && !result.qtyMismatch;
    statusCell.className = 'num status ' + (showPending ? 'pending' : (result.flagged ? 'bad' : 'ok'));
    statusCell.textContent = showPending ? '…' : (result.flagged ? '✗' : '✓');

    const calcEl = tr.querySelector('[data-qty-calc]');
    if(calcEl) calcEl.textContent = result.qtyCalc || '';
    tr.querySelectorAll('.other-note, .info-note').forEach(n => n.remove());
    (result.infoNotes || []).forEach(x => {
      const n = document.createElement('div'); n.className = 'info-note'; n.textContent = 'ⓘ ' + x;
      tr.querySelector('.desc').appendChild(n);
    });
    (result.otherIssues || []).forEach(x => {
      const n = document.createElement('div'); n.className = 'other-note'; n.textContent = '⚠ ' + x;
      tr.querySelector('.desc').appendChild(n);
    });

    let noteEl = tr.querySelector('.bundle-note');
    if(result.bundleWarning){
      if(!noteEl){ noteEl = document.createElement('div'); noteEl.className = 'bundle-note'; tr.querySelector('.desc').appendChild(noteEl); }
      noteEl.textContent = '⚠ ' + result.bundleWarning;
    }else if(noteEl){ noteEl.remove(); }

    let qtyNoteEl = tr.querySelector('.qty-note');
    if(result.qtyWarning){
      if(!qtyNoteEl){ qtyNoteEl = document.createElement('div'); qtyNoteEl.className = 'qty-note'; tr.querySelector('.desc').appendChild(qtyNoteEl); }
      qtyNoteEl.textContent = '⚠ ' + result.qtyWarning;
    }else if(qtyNoteEl){ qtyNoteEl.remove(); }

    let rateNoteEl = tr.querySelector('.rate-note');
    if(result.rateWarning){
      if(!rateNoteEl){ rateNoteEl = document.createElement('div'); rateNoteEl.className = 'rate-note'; tr.querySelector('.desc').appendChild(rateNoteEl); }
      rateNoteEl.textContent = '⚠ ' + result.rateWarning;
    }else if(rateNoteEl){ rateNoteEl.remove(); }

    let itemNoteEl = tr.querySelector('.item-mismatch-note');
    if(result.itemMismatchWarning){
      if(!itemNoteEl){ itemNoteEl = document.createElement('div'); itemNoteEl.className = 'item-mismatch-note'; tr.querySelector('.desc').appendChild(itemNoteEl); }
      itemNoteEl.textContent = '⚠ ' + result.itemMismatchWarning;
    }else if(itemNoteEl){ itemNoteEl.remove(); }

    let notDispatchedNoteEl = tr.querySelector('.not-dispatched-note');
    if(result.notDispatchedWarning){
      if(!notDispatchedNoteEl){ notDispatchedNoteEl = document.createElement('div'); notDispatchedNoteEl.className = 'not-dispatched-note'; tr.querySelector('.desc').appendChild(notDispatchedNoteEl); }
      notDispatchedNoteEl.textContent = '⚠ ' + result.notDispatchedWarning;
    }else if(notDispatchedNoteEl){ notDispatchedNoteEl.remove(); }

    if(result.flagged) anyFlag = true;
    if(result.flagged) discrepancyCount++;
    if(result.pending && !result.qtyMismatch) anyPending = true;
  });

  const missingItems = renderMissingItems(card, record);
  if(missingItems.length){ anyFlag = true; discrepancyCount += missingItems.length; }
  if(record.subtotalOk === false) discrepancyCount++;
  if(record.ewayPresent === false) discrepancyCount++;
  discrepancyCount += (record.billIssues || []).length;

  // Summary banner at the top of the bill: every discrepancy on this bill collected into one
  // block, right under the party name. This is what makes a single screenshot readable — the
  // party and the full list of what's wrong sit together, instead of the reader having to scroll
  // the item table hunting for red rows. Line rows themselves stay in printed bill order, which
  // is what you want when actually checking against the paper invoice.
  renderDiscrepancySummary(card, record);

  // Each line's amount may differ from rate × qty by its rounding (large sq.ft quantities times a
  // 2-decimal rate), so the totals get the same allowance summed — ₹1 at least.
  const totalTol = Math.max(1, record.items.reduce((t, r) => t + Math.abs(Number(r.quantity) || 0) * 0.005, 0));
  const tfoot = card.querySelector('[data-tfoot]');
  tfoot.innerHTML = `
    <tr><td colspan="9">Billed total (line items)</td><td class="num">${fmt(sumBilled)}</td><td></td></tr>
    ${allComputed ? `<tr>
      <td colspan="9">Expected total</td>
      <td class="num">${fmt(sumExpected)}</td>
      <td class="num status ${Math.abs(sumBilled-sumExpected) > totalTol ? 'bad' : 'ok'}">${Math.abs(sumBilled-sumExpected) > totalTol ? '✗' : '✓'}</td>
    </tr>` : ''}
  `;

  const stamp = card.querySelector('[data-stamp]');
  stamp.classList.remove('ok','bad','pending');
  const nameCheckPending = !!excelWorkbookData && !record.selectedBlockName;
  // A missing e-Way Bill or a subtotal mismatch is a discrepancy in its own right: it's already in
  // the count and the summary banner, so the stamp must not say "Verified" while it stands.
  if(record.subtotalOk === false || record.ewayPresent === false || (record.billIssues || []).length) anyFlag = true;
  const readCheckOpen = (record.readWarnings || []).length > 0 && !record.readWarningsAck;
  let statusKind;
  if(nameCheckPending){ stamp.classList.add('pending'); stamp.textContent = 'Pick customer'; statusKind = 'name'; }
  else if(anyPending){ stamp.classList.add('pending'); stamp.textContent = 'Awaiting rates'; statusKind = 'rates'; }
  else if(anyFlag){ stamp.classList.add('bad'); stamp.textContent = `Discrepancy (${discrepancyCount}) ⚠`; statusKind = 'discrepancy'; }
  else if(readCheckOpen){ stamp.classList.add('pending'); stamp.textContent = 'Check the read ⚠'; statusKind = 'readcheck'; }
  else{ stamp.classList.add('ok'); stamp.textContent = 'Verified ✓'; statusKind = 'verified'; }

  const isClean = statusKind === 'verified';
  record.statusKind = statusKind;
  record.currentDiscrepancyCount = discrepancyCount;
  record.currentlyClean = isClean;
  card.classList.toggle('clean-bill', isClean);
  renderTally();
}


function updateExportBarVisibility(){
  exportBar.style.display = window.__records.length ? 'block' : 'none';
}
exportBtn.addEventListener('click', () => {
  const rows = [['Bill', 'Invoice #', 'Description', 'Category', 'Billed Qty', 'Actual Qty', 'Unit', 'Billed Rate', 'Expected Rate', 'Billed Amount', 'Issue']];
  window.__records.forEach(record => {
    if(record.partyMismatch){
      rows.push([record.filename, record.parsed.invoiceNumber || '', '(whole bill)', '', '', '', '', '', '', '', 'Party name Mismatch']);
    }
    if(record.ewayPresent === false){
      rows.push([record.filename, record.parsed.invoiceNumber || '', '(whole bill)', '', '', '', '', '', '', '', 'e-Way Bill missing']);
    }
    (record.billIssues || []).forEach(x => rows.push([record.filename, record.parsed.invoiceNumber || '', '(whole bill)', '', '', '', '', '', '', '', x]));
    const block = (record.selectedBlockName && excelWorkbookData)
      ? excelWorkbookData.blocks.find(b => b.customerName === record.selectedBlockName)
      : null;
    if(block){
      const claimedCodes = new Set(record.items.map(r => r.excelCode).filter(Boolean).map(normalize));
      block.activeRows.filter(r => !claimedCodes.has(normalize(r.code))).forEach(r => {
        rows.push([record.filename, record.parsed.invoiceNumber || '', '(Excel: ' + r.code + ')', '', '', r.qty ?? '', '', '', '', '', 'Item dispatched but not billed']);
      });
    }
    record.items.forEach(row => {
      const result = computeRow(row);
      if(!result.flagged) return;
      const issues = [];
      if(result.rateMismatch) issues.push(result.rateWarning);
      if(result.qtyMismatch) issues.push(result.qtyWarning);
      if(result.bundleWarning) issues.push(result.bundleWarning);
      if(result.itemMismatch) issues.push(result.itemMismatchWarning);
      if(result.notDispatched) issues.push(result.notDispatchedWarning);
      (result.otherIssues || []).forEach(x => issues.push(x));
      rows.push([record.filename, record.parsed.invoiceNumber || '', row.description, rules[row.category]?.label || row.category, row.quantity, row.orderedQty, row.unit, row.rate, result.expectedRate ?? '', row.amount, issues.join('; ')]);
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'flagged-lines-' + fmtDate(new Date()) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
});

window.__records = [];
// v6.2: every file that was dropped in but did NOT become a bill card (couldn't be read, delivery
// note, duplicate) is kept here, so the Bill overview accounts for every single file in a batch —
// with 50 bills at once, "did all 50 get checked?" has to be answerable at a glance.
window.__skipped = [];
let uploadSeq = 0;          // running #1, #2, #3 … shown on every card and overview row
let lastBatchSummary = null;
let batchInProgress = false;

const READ_TIMEOUT_MS = 20000; // a damaged PDF can hang pdf.js; never let one file stall the batch

const skippedArea = document.getElementById('skippedArea');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('drag');
  // Everything dropped is passed on — non-PDFs are no longer silently ignored, they're reported.
  const files = Array.from(e.dataTransfer.files);
  if(files.length) handleFiles(files);
});
fileInput.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if(files.length) handleFiles(files);
  fileInput.value = '';
});

function isPdfFile(f){ return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; }
function isExcelFile(f){ return /\.(xlsx|xls)$/i.test(f.name); }
function fileKeyOf(f){ return f.name + '|' + f.size; }
function naturalCompare(a, b){ return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

function withTimeout(promise, ms){
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => { const e = new Error('timeout'); e.code = 'TIMEOUT'; reject(e); }, ms); })
  ]).finally(() => clearTimeout(timer));
}

// Reads ONE file end to end and returns its outcome. Never throws: every way a file can go wrong
// comes back as { kind:'failed', code, reason }, so one bad file can never stop the rest of a batch.
// The code is a short fixed label (for counting/filtering in the Parser report); the reason is the
// plain-English explanation of what was wrong and what to do about it.
async function readBillFile(file){
  if(!file.size) return { kind: 'failed', code: 'EMPTY', reason: 'The file is empty (0 bytes) — it may not have finished downloading or copying.' };
  let bytes;
  try{ bytes = new Uint8Array(await file.arrayBuffer()); }
  catch(e){ return { kind: 'failed', code: 'UNREADABLE', reason: 'The browser could not open this file (' + ((e && e.message) || e) + '). Copy it to the desktop and drop it again.' }; }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if(!head.includes('%PDF')) return { kind: 'failed', code: 'NOT_PDF', reason: 'Named .pdf, but the contents are not a PDF (for example an image or a web page saved with a .pdf name).' };
  if(!window.pdfjsLib) return { kind: 'failed', code: 'LIB_MISSING', reason: 'The PDF reader did not load (no internet when the page was opened, or the CDN is blocked). Reload the page and drop the bills again.' };

  let doc = null;
  try{
    try{
      doc = await withTimeout(pdfjsLib.getDocument({ data: bytes.slice(0) }).promise, READ_TIMEOUT_MS);
    }catch(e){
      if(e && e.code === 'TIMEOUT') return { kind: 'failed', code: 'TIMEOUT', reason: `Opening the PDF took longer than ${READ_TIMEOUT_MS / 1000}s — the file may be damaged.` };
      const msg = String((e && e.message) || e || '');
      if(e && (e.name === 'PasswordException' || /password/i.test(msg))) return { kind: 'failed', code: 'PASSWORD', reason: 'The PDF is password-protected. Export it from Tally again without a password.' };
      if(e && (e.name === 'InvalidPDFException' || /invalid pdf|missing pdf|unexpected end/i.test(msg))) return { kind: 'failed', code: 'DAMAGED', reason: 'The PDF is damaged or incomplete and cannot be opened. Export it from Tally again.' };
      return { kind: 'failed', code: 'OPEN_ERROR', reason: 'The PDF could not be opened: ' + msg + (e && e.name ? ` (${e.name})` : '') };
    }
    let lines;
    try{ lines = await withTimeout(extractPdfLinesForParsing(doc), READ_TIMEOUT_MS); }
    catch(e){
      if(e && e.code === 'TIMEOUT') return { kind: 'failed', code: 'TIMEOUT', reason: `Reading the text took longer than ${READ_TIMEOUT_MS / 1000}s — the file may be damaged.` };
      return { kind: 'failed', code: 'TEXT_ERROR', reason: 'The PDF opened, but its text could not be read: ' + ((e && e.message) || e) };
    }
    if(!lines.length){
      return { kind: 'failed', code: 'NO_TEXT', reason: `No text on ${doc.numPages} page(s) — this looks like a scanned or photographed bill. The reader needs the PDF exported straight from Tally.` };
    }

    // Delivery notes first: they share the invoice letterhead but don't need a rate check.
    const dn = detectDeliveryNote(lines);
    if(dn){
      return { kind: 'dn', deliveryNote: dn, code: 'DELIVERY_NOTE',
        reason: 'Delivery note' + (dn.number ? ` No. ${dn.number}` : '') + (dn.party ? ` (${dn.party})` : '') + ' — not a tax invoice, rate check skipped.' };
    }

    let res;
    try{ res = parseInvoiceDeterministic(lines); }
    catch(e){ return { kind: 'failed', code: 'PARSER_ERROR', reason: 'The reader hit an internal error on this layout: ' + ((e && e.message) || e) + '. Keep this file — it is needed to fix the reader.' }; }
    if(!res.data || !res.data.items || !res.data.items.length){
      return { kind: 'failed', code: res.code || 'NO_ROWS', reason: res.reason || 'Layout not recognised.' };
    }
    return { kind: 'bill', parsed: res.data, warnings: sanityCheckInvoice(res.data), pages: doc.numPages };
  }finally{
    // pdf.js runs without an isolated Worker here, so an undestroyed document is leftover state that
    // could disturb the files after it in the same batch. Always clean up, success or failure.
    if(doc){ try{ doc.destroy(); }catch(e){} }
  }
}

// Seller GSTIN must be one of this branch's own (BRANCH.gstins). A bill from another entity in the
// batch is flagged rather than checked silently against the wrong rate sheet.
function sellerGstinIssues(parsed){
  const g = parsed.sellerGstin;
  if(!g) return [];
  if(BRANCH.gstins[g]) return [];
  return [`Seller GSTIN ${g} is not a ${BRANCH.name} GSTIN — check this bill belongs to this branch`];
}
function sellerEntityLabel(parsed){
  const g = parsed.sellerGstin;
  return g && BRANCH.gstins[g] ? BRANCH.gstins[g] : null;
}

function buildRecord(file, outcome, seq, key){
  const parsed = outcome.parsed;
  if(parsed.invoiceDate) parsed.invoiceDate = toDDMMYYYY(parsed.invoiceDate);
  const items = (parsed.items || []).map(it => ({
    description: it.description || '—',
    quantity: Number(it.quantity) || 0,
    unit: it.unit || '',
    rate: Number(it.rate) || 0,
    amount: Number(it.amount) || 0,
    category: guessCategory(it.unit, it.description),
    heightFt: guessHeightFt(it.description),
    customLengthFt: null,
    quotedRate: null,
    orderedQty: Number(it.quantity) || 0,
    excelCode: null,
    itemNameMismatch: false,
    notDispatchedButBilled: false,
    notDispatchedCode: null
  }));
  items.forEach(branchInitRow);   // branch hook: sets up per-line size fields from the description
  items.forEach(applyMasterToRow); // v7: the Google Sheet item list knows this item → its category / size
  return {
    id: 'r' + Date.now() + Math.random().toString(36).slice(2, 7),
    seq, fileKey: key, filename: file.name, parsed, items,
    billIssues: sellerGstinIssues(parsed),
    selectedBlockName: null, partyMismatch: false, itemMismatches: {}, _autoGuessTried: false,
    extractionPath: 'deterministic',
    readWarnings: outcome.warnings || [], readWarningsAck: false
  };
}

// Batches are queued: dropping a second set of bills while the first is still being read simply
// waits its turn, instead of two batches interleaving and fighting over the progress bar.
let batchChain = Promise.resolve();
function handleFiles(files){
  const list = Array.from(files);
  batchChain = batchChain.then(() => processBatch(list)).catch(e => {
    console.error('[batch] unexpected error', e);
    processingEl.innerHTML = `<div class="error-box"><strong>Something went wrong while reading this batch</strong>${escapeHtml((e && e.message) || String(e))}</div>`;
    batchInProgress = false;
  });
  return batchChain;
}

function renderProgress(done, total, name, counts){
  const pct = total ? Math.round(done / total * 100) : 100;
  processingEl.innerHTML = `<div class="batch-progress">
    <div class="bp-text"><div class="spinner"></div>${done < total ? `Reading ${done + 1} of ${total} — ${escapeHtml(name || '')}` : `Laying out ${total} file(s)…`}</div>
    <div class="bp-bar"><div class="bp-fill" style="width:${pct}%"></div></div>
    <div class="bp-counts">${batchCountsText(counts)}</div>
  </div>`;
}
function batchCountsText(c){
  const parts = [`${c.read} read`];
  if(c.warn) parts.push(`${c.warn} need a read check`);
  if(c.dn) parts.push(`${c.dn} delivery note${c.dn === 1 ? '' : 's'}`);
  if(c.dup) parts.push(`${c.dup} duplicate${c.dup === 1 ? '' : 's'}`);
  if(c.failed) parts.push(`${c.failed} not read`);
  return parts.join(' · ');
}

async function processBatch(files){
  // A rate sheet dropped on the bills box by mistake is loaded as the rate sheet, not rejected.
  const excelFiles = files.filter(isExcelFile);
  if(excelFiles.length) loadExcelFile(excelFiles[excelFiles.length - 1]);
  files = files.filter(f => !isExcelFile(f)).sort((a, b) => naturalCompare(a.name, b.name));
  if(!files.length) return;

  batchInProgress = true;
  const batchId = 'b' + Date.now();
  const counts = { total: files.length, read: 0, warn: 0, dn: 0, dup: 0, failed: 0 };
  const newRecords = [], newSkipped = [];
  // Files already on screen (as a bill or a delivery note) are recognised if dropped again.
  // Files that FAILED are not remembered, so dropping one again is a retry.
  const seenKeys = new Set([
    ...window.__records.map(r => r.fileKey),
    ...window.__skipped.filter(s => s.kind === 'dn').map(s => s.fileKey)
  ]);

  for(let i = 0; i < files.length; i++){
    const file = files[i];
    renderProgress(i, files.length, file.name, counts);
    await new Promise(r => setTimeout(r, 0)); // let the progress bar paint between files

    const seq = ++uploadSeq;
    const key = fileKeyOf(file);
    let outcome;
    if(!isPdfFile(file)){
      const ext = (file.name.includes('.') ? file.name.split('.').pop() : 'no extension');
      outcome = { kind: 'failed', code: 'NOT_PDF', reason: `Not a PDF (.${ext} file) — only PDF bills can be read.` };
    }else if(seenKeys.has(key)){
      outcome = { kind: 'duplicate', code: 'DUPLICATE_FILE', reason: 'The same file (same name and size) is already loaded — skipped.' };
    }else{
      try{ outcome = await readBillFile(file); }
      catch(e){ outcome = { kind: 'failed', code: 'INTERNAL', reason: 'Unexpected error: ' + ((e && e.message) || e) }; }
    }
    seenKeys.add(key);

    // Same invoice number already loaded (e.g. the same bill saved twice under different names):
    // skip it, so it isn't checked — and counted — twice.
    if(outcome.kind === 'bill' && outcome.parsed.invoiceNumber){
      const inv = normalize(outcome.parsed.invoiceNumber);
      const prior = [...window.__records, ...newRecords].find(r => r.parsed.invoiceNumber && normalize(r.parsed.invoiceNumber) === inv);
      if(prior){
        outcome = { kind: 'duplicate', code: 'DUPLICATE_INVOICE',
          reason: `Invoice ${outcome.parsed.invoiceNumber} is already loaded as #${prior.seq} ("${prior.filename}") — skipped so it isn't checked twice.` };
      }
    }

    if(outcome.kind === 'bill'){
      const record = buildRecord(file, outcome, seq, key);
      window.__records.push(record);
      newRecords.push(record);
      counts.read++;
      if(record.readWarnings.length){
        counts.warn++;
        logParserEvent(file.name, 'direct-warn', 'Read, but the self-check found figures that don\'t agree — compare with the PDF.',
          { code: 'READ_CHECK', warnings: record.readWarnings, batch: batchId, defer: true });
      }else{
        logParserEvent(file.name, 'deterministic', null, { batch: batchId, defer: true });
      }
    }else{
      const entry = {
        id: 's' + seq + Math.random().toString(36).slice(2, 6), seq, file, fileKey: key, filename: file.name,
        kind: outcome.kind, code: outcome.code, reason: outcome.reason, deliveryNote: outcome.deliveryNote || null
      };
      window.__skipped.push(entry);
      newSkipped.push(entry);
      const path = outcome.kind === 'dn' ? 'delivery-note' : outcome.kind === 'duplicate' ? 'duplicate' : 'failed';
      logParserEvent(file.name, path, outcome.reason, { code: outcome.code, batch: batchId, defer: true });
      counts[outcome.kind === 'dn' ? 'dn' : outcome.kind === 'duplicate' ? 'dup' : 'failed']++;
      console.log(`[parser] #${seq} ${file.name}: ${outcome.code} — ${outcome.reason}`);
    }
  }

  renderProgress(files.length, files.length, null, counts);
  await new Promise(r => setTimeout(r, 0));
  // Cards are built in one go after reading (not one per file) — building a card is the slow part,
  // and doing it per file made a batch visibly trickle in. New cards go BELOW existing ones, in
  // the same #order as the overview, so the overview and the page read top to bottom alike.
  newSkipped.forEach(renderSkippedEntry);
  newRecords.forEach(record => renderCard(record, resultsEl, false));

  lastBatchSummary = { ...counts, at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) };
  savePersisted();
  if(parserReportPanel.classList.contains('open')) renderParserReportPanel();
  updateExportBarVisibility();
  processingEl.innerHTML = '';
  batchInProgress = false;
  renderOverview();
}

// ---- Not-read / skipped files: one compact box each, grouped above the bill cards ----
// "Try again" only where a retry can actually change the result (a hiccup, not a wrong file).
const RETRYABLE = new Set(['TIMEOUT', 'LIB_MISSING', 'UNREADABLE', 'OPEN_ERROR', 'TEXT_ERROR', 'INTERNAL', 'EMPTY']);
// Failures that are probably a real sales bill the reader couldn't handle → a person must check it.
const LIKELY_A_BILL = new Set(['NO_TABLE', 'NO_ROWS', 'PARSER_ERROR', 'NO_TEXT', 'PASSWORD', 'DAMAGED', 'TIMEOUT', 'OPEN_ERROR', 'TEXT_ERROR', 'INTERNAL', 'LIB_MISSING', 'UNREADABLE']);
function renderSkippedEntry(entry){
  const box = document.createElement('div');
  box.dataset.entryId = entry.id;
  if(entry.kind === 'dn'){
    box.className = 'dn-box';
    const dn = entry.deliveryNote || {};
    const bits = [];
    if(dn.number) bits.push(`No. ${escapeHtml(dn.number)}`);
    if(dn.party) bits.push(escapeHtml(dn.party));
    box.innerHTML = `<span class="dn-tag">#${entry.seq} DELIVERY NOTE</span>
      <span class="dn-text"><b>${escapeHtml(entry.filename)}</b>${bits.length ? ' — ' + bits.join(' · ') : ''}<br>Not a tax invoice, so no rate check needed.</span>
      <span class="dn-close" title="Hide this note (it stays in the overview)">✕</span>`;
  }else{
    const isDup = entry.kind === 'duplicate';
    box.className = isDup ? 'dn-box' : 'error-box skipped-error';
    box.innerHTML = isDup
      ? `<span class="dn-tag">#${entry.seq} DUPLICATE</span><span class="dn-text"><b>${escapeHtml(entry.filename)}</b><br>${escapeHtml(entry.reason)}</span><span class="dn-close" title="Hide">✕</span>`
      : `<div class="skipped-main"><strong>#${entry.seq} · ${escapeHtml(entry.filename)} — not read <span class="code-tag">${escapeHtml(entry.code)}</span></strong>${escapeHtml(entry.reason)}${
           LIKELY_A_BILL.has(entry.code) ? `<span class="skipped-hint">Check this bill by hand — it's in the Parser report so the reader can be fixed.</span>` : ''}</div>
         <div class="skipped-btns">${RETRYABLE.has(entry.code) && entry.file ? '<button data-action="retry">↻ Try again</button>' : ''}<button data-action="hide">Hide</button></div>`;
  }
  const close = box.querySelector('.dn-close, [data-action="hide"]');
  if(close) close.addEventListener('click', () => box.remove());
  const retry = box.querySelector('[data-action="retry"]');
  if(retry) retry.addEventListener('click', () => {
    window.__skipped = window.__skipped.filter(s => s.id !== entry.id);
    box.remove();
    renderOverview();
    handleFiles([entry.file]);
  });
  skippedArea.appendChild(box);
}

// ===================== BILL OVERVIEW (v6.2) =====================
// One row per file in this session — bills, delivery notes, duplicates and files that couldn't be
// read — in the same #order as the cards below. Click a row to jump to that bill. Built for a
// 50-bill day: filter to just what still needs a person, step through with "Next", and export the
// whole day's result as one CSV.
const overviewEl = document.getElementById('overview');
let overviewFilter = 'attention';
let overviewScheduled = false;
let lastJumpSeq = 0;

function scheduleOverview(){
  if(overviewScheduled || batchInProgress) return;
  overviewScheduled = true;
  setTimeout(() => { overviewScheduled = false; renderOverview(); }, 30);
}

const STATUS_META = {
  verified:    { label: 'Verified ✓',          cls: 'ok' },
  discrepancy: { label: 'Discrepancy',         cls: 'bad' },
  name:        { label: 'Customer not picked', cls: 'pending' },
  rates:       { label: 'Awaiting rates',      cls: 'pending' },
  readcheck:   { label: 'Check the read',      cls: 'pending' },
  failed:      { label: 'Not read',            cls: 'bad' },
  dn:          { label: 'Delivery note',       cls: 'muted' },
  duplicate:   { label: 'Duplicate — skipped', cls: 'muted' },
};

function overviewRows(){
  const blockCounts = {};
  window.__records.forEach(r => { if(r.selectedBlockName) blockCounts[r.selectedBlockName] = (blockCounts[r.selectedBlockName] || 0) + 1; });
  const rows = window.__records.map(r => {
    const kind = r.statusKind || 'name';
    return {
      seq: r.seq, kind, isRecord: true, ref: r,
      file: r.filename,
      party: r.parsed.partyName || '—',
      customer: r.selectedBlockName || '',
      sharedCustomer: r.selectedBlockName && blockCounts[r.selectedBlockName] > 1
        ? window.__records.filter(o => o !== r && o.selectedBlockName === r.selectedBlockName).map(o => '#' + o.seq) : null,
      invoice: r.parsed.invoiceNumber || '—',
      lines: r.items.length,
      total: r.parsed.grandTotal,
      discrepancies: r.currentDiscrepancyCount || 0,
      readWarn: (r.readWarnings || []).length && !r.readWarningsAck ? r.readWarnings.length : 0,
    };
  });
  window.__skipped.forEach(s => rows.push({
    seq: s.seq, kind: s.kind, isRecord: false, ref: s,
    file: s.filename, party: s.deliveryNote && s.deliveryNote.party ? s.deliveryNote.party : '—', customer: '', sharedCustomer: null,
    invoice: '—', lines: null, total: null, discrepancies: 0, readWarn: 0, reason: s.reason, code: s.code
  }));
  rows.sort((a, b) => a.seq - b.seq);
  return rows;
}
function needsAttention(row){
  return row.kind !== 'verified' && row.kind !== 'dn' && row.kind !== 'duplicate';
}
const OVERVIEW_FILTERS = [
  ['attention',   'Needs attention', needsAttention],
  ['discrepancy', 'Discrepancies',   r => r.kind === 'discrepancy'],
  ['pending',     'Pending check',   r => r.kind === 'name' || r.kind === 'rates' || r.kind === 'readcheck'],
  ['verified',    'Verified',        r => r.kind === 'verified'],
  ['skipped',     'Not read / skipped', r => r.kind === 'failed' || r.kind === 'dn' || r.kind === 'duplicate'],
  ['all',         'All',             () => true],
];

function renderOverview(){
  const rows = overviewRows();
  if(!rows.length){ overviewEl.innerHTML = ''; overviewEl.classList.remove('show'); toTopBtn.classList.remove('show'); return; }
  overviewEl.classList.add('show');
  toTopBtn.classList.add('show');
  const filterFn = (OVERVIEW_FILTERS.find(f => f[0] === overviewFilter) || OVERVIEW_FILTERS[0])[2];
  const shown = rows.filter(filterFn);
  const bills = rows.filter(r => r.isRecord).length;
  const verified = rows.filter(r => r.kind === 'verified').length;
  const attention = rows.filter(needsAttention).length;

  const chips = OVERVIEW_FILTERS.map(([key, label, fn]) => {
    const n = rows.filter(fn).length;
    return `<button class="ov-chip ${overviewFilter === key ? 'active' : ''}" data-filter="${key}">${label} <span class="n">${n}</span></button>`;
  }).join('');

  const body = shown.map(r => {
    const meta = STATUS_META[r.kind] || STATUS_META.name;
    let status = meta.label;
    if(r.kind === 'discrepancy') status = `Discrepancy (${r.discrepancies})`;
    const extra = [];
    if(r.readWarn && r.kind !== 'readcheck') extra.push(`<span class="ov-tag warn" title="${escapeHtml((r.ref.readWarnings || []).join('\n'))}">⚠ read check</span>`);
    if(r.sharedCustomer) extra.push(`<span class="ov-tag warn" title="More than one bill is matched to this Excel customer — fine if they really were billed twice today, otherwise one match is wrong.">⚠ also ${r.sharedCustomer.join(', ')}</span>`);
    const customer = r.isRecord
      ? (r.customer ? escapeHtml(r.customer) : '<span class="ov-muted">— not matched</span>')
      : '';
    return `<tr data-seq="${r.seq}" class="ov-row ${needsAttention(r) ? 'attn' : ''}">
      <td class="code">#${r.seq}</td>
      <td class="ov-file" title="${escapeHtml(r.file)}">${escapeHtml(r.file)}</td>
      <td>${escapeHtml(r.party)}</td>
      <td>${customer}</td>
      <td class="code">${escapeHtml(r.invoice)}</td>
      <td class="num">${r.lines !== null ? r.lines : ''}</td>
      <td class="num">${r.total !== null && r.total !== undefined ? fmt(r.total) : ''}</td>
      <td><span class="ov-status ${meta.cls}" ${r.reason ? `title="${escapeHtml(r.reason)}"` : ''}>${status}</span>${r.kind === 'failed' && r.code ? ` <span class="code-tag" title="${escapeHtml(r.reason || '')}">${escapeHtml(r.code)}</span>` : ''} ${extra.join(' ')}</td>
    </tr>`;
  }).join('');

  const batchLine = lastBatchSummary
    ? `<div class="ov-batch">Last batch (${escapeHtml(lastBatchSummary.at)}): ${lastBatchSummary.total} file${lastBatchSummary.total === 1 ? '' : 's'} — ${batchCountsText(lastBatchSummary)}</div>` : '';

  overviewEl.innerHTML = `
    <div class="ov-head">
      <div>
        <h3>Bill overview</h3>
        <div class="ov-sub">${bills} bill${bills === 1 ? '' : 's'} · <b>${verified}</b> verified · <b>${attention}</b> need${attention === 1 ? 's' : ''} attention</div>
        ${batchLine}
      </div>
      <div class="ov-actions">
        <button id="ovNext" ${attention ? '' : 'disabled'} title="Shortcut: press N">Next needing attention →</button>
        <button id="ovExport">⬇ Day summary (CSV)</button>
        <button id="ovSendLog" title="Write every bill's current result to the Audit Log tab of the Google Sheet">📤 Send all to Audit Log</button>
        <label class="ov-collapse"><input type="checkbox" id="ovCollapse" ${document.body.classList.contains('collapse-verified') ? 'checked' : ''}> Fold verified bills</label>
        <button id="ovClear" class="ov-danger" title="Removes every bill and the rate sheet / loading plan">Clear all</button>
      </div>
    </div>
    <div class="ov-chips">${chips}</div>
    <div class="ov-scroll">
      <table class="ov-table">
        <thead><tr><th>#</th><th>File</th><th>Party on bill</th><th>Excel customer</th><th>Invoice</th><th class="num">Lines</th><th class="num">Total ₹</th><th>Status</th></tr></thead>
        <tbody>${body || `<tr><td colspan="8" class="ov-empty">Nothing in this view${overviewFilter === 'attention' ? ' — every bill is verified or skipped ✓' : ''}.</td></tr>`}</tbody>
      </table>
    </div>`;

  overviewEl.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { overviewFilter = b.dataset.filter; renderOverview(); }));
  overviewEl.querySelectorAll('tr[data-seq]').forEach(tr => tr.addEventListener('click', () => jumpToSeq(parseInt(tr.dataset.seq, 10))));
  overviewEl.querySelector('#ovNext').addEventListener('click', jumpToNextAttention);
  overviewEl.querySelector('#ovExport').addEventListener('click', exportDaySummary);
  overviewEl.querySelector('#ovSendLog').addEventListener('click', e => {
    const n = sendBillsToSheetLog(window.__records.slice());
    e.target.textContent = n ? `✓ ${n} queued for the sheet` : 'Nothing to send';
    setTimeout(() => { e.target.textContent = '📤 Send all to Audit Log'; }, 2200);
  });
  overviewEl.querySelector('#ovCollapse').addEventListener('change', e => document.body.classList.toggle('collapse-verified', e.target.checked));
  overviewEl.querySelector('#ovClear').addEventListener('click', clearAllBills);
}

function elementForSeq(seq){
  const rec = window.__records.find(r => r.seq === seq);
  if(rec) return document.querySelector(`.invoice-card[data-record-id="${rec.id}"]`);
  const s = window.__skipped.find(x => x.seq === seq);
  if(s){
    let el = skippedArea.querySelector(`[data-entry-id="${s.id}"]`);
    if(!el){ renderSkippedEntry(s); el = skippedArea.querySelector(`[data-entry-id="${s.id}"]`); } // re-show if it was hidden
    return el;
  }
  return null;
}
function jumpToSeq(seq){
  const el = elementForSeq(seq);
  if(!el) return;
  lastJumpSeq = seq;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function jumpToNextAttention(){
  const list = overviewRows().filter(needsAttention);
  if(!list.length) return;
  const next = list.find(r => r.seq > lastJumpSeq) || list[0];
  jumpToSeq(next.seq);
}

function exportDaySummary(){
  const out = [['#', 'File', 'Party on bill', 'Excel customer', 'Invoice #', 'Invoice date', 'Lines', 'Subtotal', 'Grand total', 'Status', 'Discrepancies', 'Read check', 'Reason (not read / skipped)']];
  overviewRows().forEach(r => {
    const meta = STATUS_META[r.kind] || STATUS_META.name;
    if(r.isRecord){
      const rec = r.ref;
      out.push(['#' + r.seq, r.file, r.party, r.customer, rec.parsed.invoiceNumber || '', rec.parsed.invoiceDate || '', r.lines,
        rec.parsed.taxableTotal ?? '', rec.parsed.grandTotal ?? '',
        r.kind === 'discrepancy' ? `Discrepancy (${r.discrepancies})` : meta.label,
        gatherBillDiscrepancies(rec).join(' | '),
        (rec.readWarnings || []).length ? (rec.readWarningsAck ? '(checked) ' : '') + rec.readWarnings.join(' | ') : '',
        '']);
    }else{
      out.push(['#' + r.seq, r.file, r.party === '—' ? '' : r.party, '', '', '', '', '', '', meta.label, '', '', `${r.code}: ${r.reason}`]);
    }
  });
  downloadCsv(out, 'bill-summary-' + fmtDate(new Date()) + '.csv');
}
function downloadCsv(rows, filename){
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearAllBills(){
  const n = window.__records.length + window.__skipped.length;
  if(!n && !excelWorkbookData) return;
  if(!confirm(`Clear all — remove ${n} bill file(s) and the ${BRANCH.text.excelMain.replace(/^Drop /, '').replace(/ here$/, '')} and start fresh?\n\nThe discrepancy log, Parser report, rules and the Google Sheet data are kept.`)) return;
  window.__records = [];
  window.__skipped = [];
  excelWorkbookData = null; excelFileName = null; excelLoadedAt = null;
  showExcelStatus();
  document.getElementById('restoredNote').innerHTML = '';
  uploadSeq = 0; lastJumpSeq = 0; lastBatchSummary = null;
  resultsEl.innerHTML = '';
  skippedArea.innerHTML = '';
  updateExportBarVisibility();
  renderTally();
  renderOverview();
  saveSessionNow();
}

// Floating "back to overview" button + N shortcut, for moving around a long page of bills.
const toTopBtn = document.getElementById('toOverviewBtn');
toTopBtn.addEventListener('click', () => overviewEl.scrollIntoView({ behavior: 'smooth', block: 'start' }));
document.addEventListener('keydown', e => {
  if(e.key !== 'n' && e.key !== 'N') return;
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if(t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  jumpToNextAttention();
});

// =====================================================================================
//  v7 — ONE APP FOR BOTH BRANCHES · GOOGLE SHEET SYNC · WORK KEPT ACROSS CLOSING · INSTALLABLE
//  Everything below is new in v7. The checking itself (reading, matching, formulas) is unchanged;
//  this part feeds it the item and party lists from the Google Sheet, keeps the day's bills and
//  rate sheet in this browser until "Clear all", and makes the page an installable app.
// =====================================================================================

// ---- Dates: DD-MM-YYYY everywhere ------------------------------------------------------------
function pad2(n){ return String(n).padStart(2, '0'); }
function fmtDate(d){ return pad2(d.getDate()) + '-' + pad2(d.getMonth() + 1) + '-' + d.getFullYear(); }
// Bill dates as printed ("1-Sep-26", "01/09/2026") → 01-09-2026. Anything unrecognised is left as is.
function toDDMMYYYY(text){
  const t = String(text || '').trim();
  const MON = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  let m = /^(\d{1,2})[-\/. ]([A-Za-z]{3})[A-Za-z]*[-\/. ,]+(\d{2}|\d{4})$/.exec(t);
  if(m && MON[m[2].toLowerCase()]){ const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return pad2(+m[1]) + '-' + pad2(MON[m[2].toLowerCase()]) + '-' + y; }
  m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/.exec(t);
  if(m){ const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return pad2(+m[1]) + '-' + pad2(+m[2]) + '-' + y; }
  return t;
}
function fmtDateTime(d){ return fmtDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

// ---- Small storage helper: IndexedDB (big, survives closing), in-memory if it is blocked -------
var idbMemory = {};
var idbPromise = null;
function idbOpen(){
  if(idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    try{
      const req = indexedDB.open('invoice-audit', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }catch(e){ reject(e); }
  });
  return idbPromise;
}
async function idbGet(key){
  try{
    const db = await idbOpen();
    return await new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }catch(e){ return idbMemory[key]; }
}
async function idbSet(key, value){
  idbMemory[key] = value;
  try{
    const db = await idbOpen();
    await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }catch(e){ console.warn('[storage] could not save ' + key, e); }
}

// ---- Text keys used for matching ---------------------------------------------------------------
// A cell may hold several entries: separated by commas, semicolons, | or new lines.
function splitList(s){ return String(s || '').split(/[,;|\n]+/).map(x => x.trim()).filter(Boolean); }
// Item names: case, spaces and punctuation ignored ("Gi Weldmesh 40mm x 40mm" = "GI WELDMESH 40MMX40MM").
function nameKey(s){ return String(s || '').toLowerCase().replace(/[\u00d7\u2715]/g, 'x').replace(/[^a-z0-9]+/g, ''); }
// Rate-sheet / plan codes: the usual shorthand variants are treated as one ("1 x 1" = "1x1",
// ".5" = "1/2", "lit" = "lite", feet marks).
function codeKey(s){
  let v = String(s || '').toLowerCase();
  v = v.replace(/[‘’“”]/g, "'").replace(/[×✕]/g, 'x');
  v = v.replace(/\bhalf\s*inch\b/g, '1/2x1/2');
  v = v.replace(/(\d)\s*\/\s*(\d)/g, '$1/$2');
  v = v.replace(/(^|[^0-9])0?\.5(?![0-9])/g, '$11/2');
  v = v.replace(/\s*x\s*/g, 'x');
  v = v.replace(/\blit\b/g, 'lite').replace(/\bhvy\b/g, 'heavy').replace(/\bgauge\b/g, 'g');
  v = v.replace(/\bfeet\b/g, 'ft').replace(/'/g, 'ft');
  return v.replace(/[^a-z0-9/.]+/g, '');
}

// ---- The item and party lists (from the Google Sheet) -----------------------------------------
var MASTER_ALL = null;                    // the whole pull, both branches — kept in this browser
var MASTER = { items: [], parties: [] };  // this branch's part
var masterIdx = { byCode: new Map(), byName: new Map(), names: [] };
var masterDescCache = new Map();

function setMaster(branchData){
  MASTER = { items: (branchData && branchData.items) || [], parties: (branchData && branchData.parties) || [] };
  const byCode = new Map(), byName = new Map();
  const add = (map, k, it) => { if(!k) return; let a = map.get(k); if(!a) map.set(k, a = []); if(!a.includes(it)) a.push(it); };
  MASTER.items.forEach(it => {
    const others = splitList(it.other);
    [it.code, ...others].forEach(c => add(byCode, codeKey(c), it));
    // "Other codes / spellings" also holds OLD Tally names after a rename, so they count as names too.
    [it.name, ...others].forEach(n => { const k = nameKey(n); if(k.length >= 6) add(byName, k, it); });
  });
  masterIdx = { byCode, byName, names: [...byName.keys()] };
  masterDescCache = new Map();
  branchApplyMaster(MASTER.items);
}

// The list rows whose Tally name is this bill line's description. Bills can print a long name cut
// short, so a description that is the start of exactly one name also counts.
function masterItemsForDescription(desc){
  if(!MASTER.items.length) return [];
  const k = nameKey(desc);
  if(!k) return [];
  if(masterDescCache.has(k)) return masterDescCache.get(k);
  let hit = masterIdx.byName.get(k) || [];
  if(!hit.length && k.length >= 16){
    const found = new Set();
    for(const n of masterIdx.names){
      if(n.length > k.length && n.startsWith(k)) masterIdx.byName.get(n).forEach(it => found.add(it));
      if(found.size > 4) break;
    }
    hit = [...found];
  }
  masterDescCache.set(k, hit);
  return hit;
}
function masterSingleForDescription(desc){
  const a = masterItemsForDescription(desc);
  if(a.length === 1) return a[0];
  if(a.length > 1 && a.every(x => nameKey(x.name) === nameKey(a[0].name))) return a[0];
  return null;
}
function masterItemsForCode(code){ return masterIdx.byCode.get(codeKey(code)) || []; }
function masterSingleForCode(code){
  const a = masterItemsForCode(code);
  if(a.length === 1) return a[0];
  if(a.length > 1 && a.every(x => nameKey(x.name) === nameKey(a[0].name))) return a[0];
  return null;
}
// 'same' — the bill line and the rate-sheet code are the same item on the list;
// 'different' — both are on the list, as different items; null — the list can't tell.
function masterCodeRelation(desc, code){
  if(!MASTER.items.length || !code || !desc) return null;
  const d = masterItemsForDescription(desc);
  if(!d.length) return null;
  const c = masterItemsForCode(code);
  if(!c.length) return null;
  if(c.some(x => d.includes(x))) return 'same';
  const names = new Set(d.map(x => nameKey(x.name)));
  if(c.some(x => names.has(nameKey(x.name)))) return 'same';
  return 'different';
}
// "Sheet", "Roll mesh", "Direct 5%"… or the app's own category keys.
function mapMasterCategory(cat, unit){
  const t = String(cat || '').toLowerCase().trim();
  if(!t) return null;
  if(rules[t]) return t;
  const keys = BRANCH.categoryKeys || {};
  const byLabel = Object.keys(rules).find(k => normalize(rules[k].label) === normalize(t));
  if(byLabel) return byLabel;
  if(/5\s*%|five|velcro|shade/.test(t)) return keys.five || null;
  if(/sheet|pics?\b|pcs/.test(t)) return keys.sheet || null;
  if(/roll|coil/.test(t)) return keys.roll || null;
  if(/flat|nos|piece/.test(t)) return keys.nos || null;
  if(/kg|weight/.test(t)) return keys.kg || null;
  return null;   // "Direct" etc. — the unit decides, as before
}
// New bill line whose item is on the list: take its category, height, length from the list.
function applyMasterToRow(row){
  const it = masterSingleForDescription(row.description);
  row.masterName = it ? it.name : null;
  if(!it) return;
  const cat = mapMasterCategory(it.category, row.unit);
  if(cat && rules[cat]) row.category = cat;
  if(it.ht != null) row.heightFt = it.ht;
  if(it.len != null){
    const def = (rules[row.category] || {}).lengthFt;
    row.customLengthFt = (def === it.len && BRANCH.key === 'ekm') ? null : it.len;
  }
}

// ---- Party list: Tally party name ↔ the name used on the rate sheet / loading plan ------------
function samePartyName(a, b){
  const x = normalize(a), y = normalize(b);
  if(!x || !y) return false;
  if(x === y) return true;
  // a bill often adds the place after the name ("ABC Traders, Feroke")
  return (y.startsWith(x + ' ') && x.length >= 6) || (x.startsWith(y + ' ') && y.length >= 6);
}
function partyListBlock(buyerName, blocks){
  if(!MASTER.parties.length || !buyerName) return null;
  const rowsHit = MASTER.parties.filter(p => [p.name, ...splitList(p.aliases)].some(n => samePartyName(n, buyerName)));
  if(!rowsHit.length) return null;
  const names = [];
  rowsHit.forEach(p => [p.name, ...splitList(p.aliases)].forEach(n => names.push(n)));
  const hits = blocks.filter(bl => names.some(n => samePartyName(n, bl.customerName)));
  return hits.length === 1 ? hits[0] : null;
}
function guessBlockWithParties(buyerName, blocks){
  const viaList = partyListBlock(buyerName, blocks);
  if(viaList){ viaList._matchNote = 'matched through the party list'; return viaList; }
  const g = guessBestBlock(buyerName, blocks);
  if(g && BRANCH.key === 'ekm') g._matchNote = null;
  return g;
}

// ---- Google Sheet connection --------------------------------------------------------------------
var SYNC_KEY = 'ia.sync';
var syncState = { busy: false, lastError: null };
var outbox = [];            // rules and log rows waiting to be sent (kept across closing)
var lastRulesJson = null;   // this branch's rules as last saved/received — a change is sent to the sheet
var flushing = false, flushTimer = null;

function syncSaved(){ try{ return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null') || {}; }catch(e){ return {}; } }
function syncCfg(){ const c = syncSaved(); return c.url && c.user && c.hash ? c : null; }
async function sha256Hex(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function api(action, payload, cfg){
  cfg = cfg || syncCfg();
  if(!cfg) throw new Error('The Google Sheet is not connected.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let res;
  try{
    // text/plain keeps this a "simple" request, which Apps Script web apps accept from any site.
    res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, user: cfg.user, hash: cfg.hash }, payload || {})), signal: ctrl.signal });
  }catch(e){
    throw new Error(navigator.onLine === false ? 'No internet connection.' : 'Could not reach the Google Sheet (' + (e.name === 'AbortError' ? 'timed out' : 'network error') + ').');
  }finally{ clearTimeout(timer); }
  let j;
  try{ j = await res.json(); }
  catch(e){ throw new Error('The Web app URL did not answer like the Invoice Audit script — check that it is the /exec URL and that access is "Anyone".'); }
  if(!j.ok) throw new Error(j.error || 'The sheet refused the request.');
  return j;
}

function rulesJsonNow(){ try{ return JSON.stringify(branchRulesSnapshot()); }catch(e){ return null; } }
// Called on every save: if this branch's rules changed, the new rules go to the sheet.
function noteRulesMaybeChanged(){
  if(lastRulesJson === null) return;          // still starting up
  const now = rulesJsonNow();
  if(!now || now === lastRulesJson) return;
  lastRulesJson = now;
  if(syncCfg()) queueOutbox({ type: 'rules', branch: BRANCH.key, rules: JSON.parse(now) });
}
function queueOutbox(item){
  if(item.type === 'rules') outbox = outbox.filter(o => !(o.type === 'rules' && o.branch === item.branch));
  outbox.push(item);
  idbSet('outbox', outbox);
  updateSyncStatus();
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushOutbox, 1200);
}
async function flushOutbox(){
  if(flushing || !syncCfg() || !outbox.length) return true;
  flushing = true;
  let ok = true;
  try{
    while(outbox.length){
      const item = outbox[0];
      if(item.type === 'rules') await api('saveRules', { branch: item.branch, rules: item.rules });
      else if(item.type === 'log') await api('log', { entries: item.entries });
      outbox.shift();
      await idbSet('outbox', outbox);
    }
    if(!syncState.busy) syncState.lastError = null;
  }catch(e){
    ok = false;
    syncState.lastError = e.message;
  }finally{
    flushing = false;
    updateSyncStatus();
  }
  return ok;
}

// Bills' results → the Audit Log tab (one row per invoice; sending again updates that row).
function sendBillsToSheetLog(records){
  if(!syncCfg()) return 0;
  const entries = records.filter(r => r && r.parsed).map(r => ({
    branch: BRANCH.name,
    invoiceNo: r.parsed.invoiceNumber || '',
    invoiceDate: r.parsed.invoiceDate || '',
    party: r.parsed.partyName || '',
    customer: r.selectedBlockName || '',
    file: r.filename,
    status: r.statusKind === 'discrepancy' ? `Discrepancy (${r.currentDiscrepancyCount || 0})` : (STATUS_META[r.statusKind] || STATUS_META.name).label,
    count: r.currentDiscrepancyCount || 0,
    details: gatherBillDiscrepancies(r),
    version: APP_VERSION
  }));
  if(!entries.length) return 0;
  queueOutbox({ type: 'log', entries });
  return entries.length;
}

// Once each time the app opens (and on ⟳ Sync now): send anything waiting, then fetch everything.
async function fullSync(){
  if(!syncCfg() || syncState.busy) return;
  syncState.busy = true; syncState.lastError = null;
  updateSyncStatus();
  try{
    await flushOutbox();
    const data = await api('pull');
    MASTER_ALL = { at: data.at, user: data.user, displayName: data.displayName, branches: data.branches || {} };
    await idbSet('master', MASTER_ALL);
    const saved = syncSaved();
    if(data.displayName && saved.displayName !== data.displayName){ saved.displayName = data.displayName; localStorage.setItem(SYNC_KEY, JSON.stringify(saved)); }
    applyMasterAll(true);
    if(outbox.length) await flushOutbox();
  }catch(e){
    syncState.lastError = e.message;
  }finally{
    syncState.busy = false;
    updateSyncStatus();
    if(masterPanel.classList.contains('open')) renderMasterPanel();
  }
}
function applyMasterAll(fromSheet){
  const b = MASTER_ALL && MASTER_ALL.branches ? MASTER_ALL.branches[BRANCH.key] : null;
  setMaster(b);
  // Rules from the sheet win — unless this browser changed them and hasn't sent them yet.
  const pendingRules = outbox.some(o => o.type === 'rules' && o.branch === BRANCH.key);
  if(b && b.rules && !pendingRules){
    const before = rulesJsonNow();
    branchApplyRules(b.rules);
    lastRulesJson = rulesJsonNow();
    if(lastRulesJson !== before){
      savePersisted();
      renderRulesPanel();
      renderCodesPanel();
      if(fromSheet) document.querySelectorAll('.invoice-card').forEach(c => recalcCard(c));
    }
  }
  codesToggle.hidden = BRANCH.key === 'ekm' && MASTER.items.length > 0;
  if(codesToggle.hidden) codesPanel.classList.remove('open');
}

function updateSyncStatus(){
  const el = document.getElementById('syncStatus');
  const btn = document.getElementById('syncNowBtn');
  if(!el) return;
  const cfg = syncCfg();
  btn.hidden = !cfg;
  btn.disabled = syncState.busy;
  const pending = outbox.length ? ` · ${outbox.length} waiting to send` : '';
  const counts = `${MASTER.items.length} item${MASTER.items.length === 1 ? '' : 's'} · ${MASTER.parties.length} part${MASTER.parties.length === 1 ? 'y' : 'ies'}`;
  el.className = 'sync-status';
  el.title = '';
  if(!cfg){
    el.classList.add('warn');
    el.textContent = MASTER_ALL ? `☁ Logged out — using the sheet copy from ${MASTER_ALL.at}` : '☁ Google Sheet not connected';
    return;
  }
  if(syncState.busy){ el.classList.add('busy'); el.textContent = 'Syncing with the Google Sheet…'; return; }
  if(syncState.lastError){
    el.classList.add(MASTER_ALL ? 'warn' : 'bad');
    el.textContent = '⚠ ' + (MASTER_ALL ? `Not synced — using the copy from ${MASTER_ALL.at}` : 'Not synced') + pending;
    el.title = syncState.lastError;
    return;
  }
  if(MASTER_ALL){ el.classList.add('ok'); el.textContent = `☁ Synced ${MASTER_ALL.at} · ${cfg.displayName || cfg.user} · ${counts}${pending}`; return; }
  el.textContent = '☁ Connected — not synced yet' + pending;
}

function renderSyncPanel(msg, kind){
  const saved = syncSaved();
  const cfg = syncCfg();
  syncPanel.innerHTML = `<h3>Google Sheet sync</h3>
    <p class="desc">The item lists, party lists, rules and the audit log live in one Google Sheet shared by every PC. The app syncs once each time it is opened (and whenever you press ⟳ Sync now), then keeps a copy in this browser, so it also works without internet. Bills and the rate sheet never leave this computer.</p>
    <div class="sync-form">
      <label for="syncUrl">Web app URL</label><input id="syncUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${escapeHtml(saved.url || '')}">
      <label for="syncUser">User name</label><input id="syncUser" autocomplete="username" value="${escapeHtml(saved.user || '')}">
      <label for="syncPass">Password</label><input id="syncPass" type="password" autocomplete="current-password" placeholder="${cfg ? '(saved — type only to change)' : ''}">
      <div class="actions">
        <button type="button" class="bar-btn primary" id="syncLoginBtn">Log in &amp; sync</button>
        ${cfg ? '<button type="button" class="bar-btn" id="syncLogoutBtn">Log out of this browser</button>' : ''}
      </div>
    </div>
    <div class="sync-msg ${kind || ''}" id="syncMsg">${msg ? escapeHtml(msg) : (syncState.lastError ? '⚠ ' + escapeHtml(syncState.lastError) : '')}</div>`;
  const msgEl = document.getElementById('syncMsg');
  document.getElementById('syncLoginBtn').addEventListener('click', async () => {
    const url = document.getElementById('syncUrl').value.trim();
    const user = document.getElementById('syncUser').value.trim();
    const pass = document.getElementById('syncPass').value;
    if(!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)){ msgEl.className = 'sync-msg bad'; msgEl.textContent = 'Paste the Web app URL from Apps Script (it starts with https://script.google.com/ and ends in /exec).'; return; }
    if(!user){ msgEl.className = 'sync-msg bad'; msgEl.textContent = 'Type your user name.'; return; }
    let hash = null;
    if(pass) hash = await sha256Hex(pass.trim());
    else if(saved.hash && saved.user === user) hash = saved.hash;
    if(!hash){ msgEl.className = 'sync-msg bad'; msgEl.textContent = 'Type your password.'; return; }
    msgEl.className = 'sync-msg'; msgEl.textContent = 'Checking…';
    try{
      const r = await api('login', {}, { url, user, hash });
      localStorage.setItem(SYNC_KEY, JSON.stringify({ url, user, hash, displayName: r.displayName || user }));
      renderSyncPanel(`✓ Logged in as ${r.displayName || user}. Syncing…`, 'ok');
      await fullSync();
      renderSyncPanel(syncState.lastError ? '⚠ ' + syncState.lastError : `✓ Logged in as ${r.displayName || user} and synced.`, syncState.lastError ? 'bad' : 'ok');
    }catch(e){
      msgEl.className = 'sync-msg bad'; msgEl.textContent = '⚠ ' + e.message;
    }
  });
  const lo = document.getElementById('syncLogoutBtn');
  if(lo) lo.addEventListener('click', () => {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ url: saved.url || '' }));
    syncState.lastError = null;
    updateSyncStatus();
    renderSyncPanel('Logged out. The last synced copy stays in use on this computer.', 'ok');
  });
}

// ---- Items & parties panel ---------------------------------------------------------------------
var masterTab = 'items';
function renderMasterPanel(){
  const cfg = syncCfg();
  const B = BRANCH.key.toUpperCase();
  const builtIn = branchBuiltInItems();
  const when = MASTER_ALL ? `Copy from the sheet: ${escapeHtml(MASTER_ALL.at)}` : 'Not synced with the sheet yet';
  let html = `<h3>Items &amp; parties — ${escapeHtml(BRANCH.name)}</h3>
    <p class="desc">Kept in the <b>${B} Items</b> and <b>${B} Parties</b> tabs of the Google Sheet — edit them there, then press ⟳ Sync now.
    A bill line whose Tally item name is on the list is paired with the ${BRANCH.key === 'ekm' ? 'rate-sheet' : 'loading-plan'} row carrying one of that item's codes, with no guessing from sizes, and takes its category, height, length${BRANCH.key === 'ekm' ? ' and bundle weight' : ''} from the list.
    A bill party on the party list is paired with the ${BRANCH.key === 'ekm' ? 'rate-sheet' : 'plan'} customer named on its row.
    <b>After a mass rename in Tally</b>, paste the new names into "Tally stock item name" and keep the old names in "Other codes / spellings" — both are recognised.</p>
    <div class="row pr-actions">
      <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink-soft);">${when} · ${MASTER.items.length} items · ${MASTER.parties.length} parties</span>
      <span style="flex:1"></span>
      ${cfg ? '<button type="button" class="bar-btn" id="mpSync">⟳ Sync now</button>' : '<button type="button" class="bar-btn" id="mpConnect">☁ Connect the Google Sheet</button>'}
      <button type="button" class="bar-btn" id="mpRematch" title="Match every open bill again using the current lists">↻ Re-match open bills</button>
    </div>`;
  if(cfg && MASTER_ALL && !MASTER.items.length && builtIn.length){
    html += `<p class="master-note">The ${B} Items tab is empty. <span class="fill-btn" id="mpSeed" style="cursor:pointer;">Fill it with the built-in list (${builtIn.length} items)</span> — you can then correct and extend it in the sheet.</p>`;
  }
  if(!MASTER.items.length){
    html += `<p class="master-note">${BRANCH.key === 'ekm' ? 'No item list from the sheet yet — the built-in code list is used meanwhile.' : 'No item list from the sheet yet — items are recognised from the plan shorthand (aperture and size) meanwhile.'}</p>`;
  }
  html += `<div class="master-tabs">
      <button class="ov-chip ${masterTab === 'items' ? 'active' : ''}" data-mtab="items">Items <span class="n">${MASTER.items.length}</span></button>
      <button class="ov-chip ${masterTab === 'parties' ? 'active' : ''}" data-mtab="parties">Parties <span class="n">${MASTER.parties.length}</span></button>
    </div>
    <div class="code-search-row"><input type="text" id="masterSearch" placeholder="Search…"></div>
    <div class="code-scroll" style="max-height:340px;"><table class="code-table" id="masterTable"></table></div>`;
  masterPanel.innerHTML = html;

  masterPanel.querySelectorAll('[data-mtab]').forEach(b => b.addEventListener('click', () => { masterTab = b.dataset.mtab; renderMasterPanel(); }));
  const search = document.getElementById('masterSearch');
  search.addEventListener('input', () => renderMasterRows(search.value));
  renderMasterRows('');
  const s = document.getElementById('mpSync'); if(s) s.addEventListener('click', () => fullSync());
  const c = document.getElementById('mpConnect'); if(c) c.addEventListener('click', () => { openOnly(syncPanel); renderSyncPanel(); });
  document.getElementById('mpRematch').addEventListener('click', rematchOpenBills);
  const seed = document.getElementById('mpSeed');
  if(seed) seed.addEventListener('click', async () => {
    if(!confirm(`Write the built-in list (${builtIn.length} items) into the empty ${B} Items tab of the Google Sheet?`)) return;
    seed.textContent = 'Writing…';
    try{ const r = await api('seedItems', { branch: BRANCH.key, items: builtIn }); if(!r.ok) throw new Error(r.error); await fullSync(); }
    catch(e){ seed.textContent = '⚠ ' + e.message; }
  });
}
function renderMasterRows(q){
  const table = document.getElementById('masterTable');
  if(!table) return;
  q = (q || '').trim().toLowerCase();
  const LIMIT = 400;
  if(masterTab === 'items'){
    const list = MASTER.items.filter(it => !q || [it.code, it.name, it.other, it.category].join(' ').toLowerCase().includes(q));
    table.innerHTML = `<colgroup><col style="width:200px;"><col><col style="width:90px;"><col style="width:50px;"><col style="width:50px;"><col style="width:60px;"></colgroup>
      <thead><tr><th>Code</th><th>Tally stock item name · other codes / spellings</th><th>Category</th><th>Ht</th><th>Len</th><th>Bundle</th></tr></thead><tbody>${
      list.slice(0, LIMIT).map(it => `<tr><td class="code" style="white-space:normal;word-break:break-word;">${escapeHtml(it.code)}</td><td>${escapeHtml(it.name)}${it.other ? `<div style="color:var(--ink-soft);font-size:11px;">${escapeHtml(it.other)}</div>` : ''}</td><td>${escapeHtml(it.category || '')}</td><td>${it.ht ?? ''}</td><td>${it.len ?? ''}</td><td>${it.bundleKg ?? ''}</td></tr>`).join('')
      || `<tr><td colspan="6" style="color:var(--ink-soft);">${MASTER.items.length ? 'Nothing matches.' : 'No items yet.'}</td></tr>`}
      ${list.length > LIMIT ? `<tr><td colspan="6" style="color:var(--ink-soft);">… ${list.length - LIMIT} more — type to search.</td></tr>` : ''}</tbody>`;
  }else{
    const list = MASTER.parties.filter(p => !q || [p.name, p.aliases, p.place].join(' ').toLowerCase().includes(q));
    table.innerHTML = `<colgroup><col style="width:38%;"><col><col style="width:120px;"></colgroup>
      <thead><tr><th>Tally party name</th><th>Names on the ${BRANCH.key === 'ekm' ? 'rate sheet' : 'loading plan'} / other spellings</th><th>Place</th></tr></thead><tbody>${
      list.slice(0, LIMIT).map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.aliases)}</td><td>${escapeHtml(p.place || '')}</td></tr>`).join('')
      || `<tr><td colspan="3" style="color:var(--ink-soft);">${MASTER.parties.length ? 'Nothing matches.' : 'No parties yet.'}</td></tr>`}
      ${list.length > LIMIT ? `<tr><td colspan="3" style="color:var(--ink-soft);">… ${list.length - LIMIT} more — type to search.</td></tr>` : ''}</tbody>`;
  }
}
// Matches every open bill again with the current lists (party first, then the item lines).
function rematchOpenBills(){
  if(!window.__records.length) return;
  if(!confirm('Match every open bill again with the current item and party lists?\n\nCustomers and items picked by hand on those bills are picked again automatically.')) return;
  window.__records.forEach(record => {
    record.items.forEach(row => { row._sizedFor = null; applyMasterToRow(row); });
    record.itemMismatches = {};
    if(!excelWorkbookData) return;
    if(!record.selectedBlockName || record.partyAuto){
      record.selectedBlockName = null; record._autoGuessTried = false; record.partyNote = null;
      resetItemsToUnmatched(record);
    }else{
      const block = excelWorkbookData.blocks.find(b => b.customerName === record.selectedBlockName);
      if(block) applyExcelMatch(record, block);
    }
  });
  resultsEl.innerHTML = '';
  window.__records.forEach(r => renderCard(r, resultsEl, false));
  renderOverview();
  scheduleSessionSave();
}

// ---- Work kept across closing: bills + rate sheet, per branch, until "Clear all" ---------------
var sessionTimer = null, sessionRestoring = false;
function scheduleSessionSave(){
  if(sessionRestoring) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSessionNow, 700);
}
function sessionSnapshot(){
  return JSON.stringify({
    v: 1, savedAt: fmtDateTime(new Date()),
    records: window.__records,
    skipped: window.__skipped.map(x => Object.assign({}, x, { file: undefined })),
    excel: excelWorkbookData, excelName: excelFileName, excelAt: excelLoadedAt,
    uploadSeq, lastBatchSummary
  });
}
async function saveSessionNow(){
  clearTimeout(sessionTimer);
  if(sessionRestoring) return;
  try{ await idbSet('session.' + BRANCH.key, sessionSnapshot()); }
  catch(e){ console.warn('[session] not saved', e); }
}
async function restoreSession(){
  let raw = null;
  try{ raw = await idbGet('session.' + BRANCH.key); }catch(e){}
  if(!raw) return;
  let s;
  try{ s = JSON.parse(raw); }catch(e){ return; }
  sessionRestoring = true;
  try{
    if(s.excel && s.excel.blocks){ excelWorkbookData = s.excel; excelFileName = s.excelName || null; excelLoadedAt = s.excelAt || null; showExcelStatus(); }
    window.__records = Array.isArray(s.records) ? s.records : [];
    window.__skipped = Array.isArray(s.skipped) ? s.skipped : [];
    uploadSeq = s.uploadSeq || Math.max(0, ...window.__records.map(r => r.seq || 0), ...window.__skipped.map(r => r.seq || 0));
    lastBatchSummary = s.lastBatchSummary || null;
    window.__skipped.forEach(e => { if(e.kind !== 'duplicate') renderSkippedEntry(e); });
    window.__records.forEach(r => {
      try{ renderCard(r, resultsEl, false); }
      catch(e){ console.warn('[session] bill could not be shown again', r && r.filename, e); }
    });
    updateExportBarVisibility();
    renderTally();
    renderOverview();
    const n = window.__records.length + window.__skipped.length;
    if(n || excelWorkbookData){
      document.getElementById('restoredNote').innerHTML = `<div class="restored-note">↺ Carried on from ${escapeHtml(s.savedAt || 'last time')}: ${n} file${n === 1 ? '' : 's'}${excelWorkbookData ? ' and the ' + escapeHtml(excelFileName || 'rate sheet') : ''}. They stay until you press "Clear all".</div>`;
    }
  }finally{
    sessionRestoring = false;
  }
}
window.addEventListener('pagehide', () => { if(!sessionRestoring) idbSet('session.' + BRANCH.key, sessionSnapshot()); });
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') saveSessionNow(); });

// ---- Branch switch ------------------------------------------------------------------------------
function applyBranchTexts(){
  const t = BRANCH.text || {};
  document.title = 'Invoice Audit — ' + (BRANCH.key === 'clt' ? 'Calicut · Kannur' : BRANCH.name);
  const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v || ''; };
  set('eyebrowText', t.eyebrow); set('ledeText', t.lede);
  set('excelMainText', t.excelMain); set('excelSubText', t.excelSub);
  set('footerNote', t.footerNote); set('versionBadge', APP_VERSION);
  rulesToggle.textContent = t.rulesToggle || '⚙ Rules';
  codesToggle.textContent = t.codesToggle || '📖 Codes';
  document.querySelectorAll('[data-branch-btn]').forEach(b => {
    const on = b.dataset.branchBtn === BRANCH.key;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', async () => {
      if(on) return;
      await saveSessionNow();     // this branch's bills wait here until you come back
      try{ localStorage.setItem('ia.branch', b.dataset.branchBtn); }catch(e){}
      location.href = location.pathname;
    });
  });
}

// ---- Installable app (PWA) -------------------------------------------------------------------
var reloadingForUpdate = false;
function initPwa(){
  const installBtn = document.getElementById('installBtn');
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const offer = e => { if(standalone) return; window.__installEvt = e; installBtn.hidden = false; };
  if(window.__installEvt) offer(window.__installEvt);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); offer(e); });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; window.__installEvt = null; });
  installBtn.addEventListener('click', async () => {
    const e = window.__installEvt;
    if(!e) return;
    e.prompt();
    try{ await e.userChoice; }catch(err){}
    window.__installEvt = null; installBtn.hidden = true;
  });
  if(!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const watch = w => {
      if(!w) return;
      w.addEventListener('statechange', () => { if(w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(w); });
    };
    if(reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch(e => console.warn('[pwa] service worker not registered', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if(reloadingForUpdate) location.reload(); });
}
function showUpdateBanner(worker){
  if(document.getElementById('updateBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'updateBanner';
  banner.className = 'restored-note';
  banner.style.borderStyle = 'solid';
  banner.style.borderColor = 'var(--gold)';
  banner.innerHTML = `A new version of Invoice Audit is ready. <span class="fill-btn" style="cursor:pointer;margin-left:8px;">Reload now</span> <span style="color:var(--ink-soft);">— your bills stay.</span>`;
  banner.querySelector('.fill-btn').addEventListener('click', async () => {
    await saveSessionNow();
    reloadingForUpdate = true;
    worker.postMessage('skipWaiting');
  });
  const wrap = document.querySelector('.wrap');
  wrap.insertBefore(banner, wrap.firstChild);
}

// ---- Start ---------------------------------------------------------------------------------------
(async function bootV7(){
  applyBranchTexts();
  document.getElementById('syncSettingsBtn').addEventListener('click', () => { if(openOnly(syncPanel)) renderSyncPanel(); });
  document.getElementById('syncNowBtn').addEventListener('click', () => fullSync());
  await loadPersisted();                         // this browser's rules, log, parser report
  try{ outbox = (await idbGet('outbox')) || []; }catch(e){ outbox = []; }
  try{ MASTER_ALL = (await idbGet('master')) || null; }catch(e){ MASTER_ALL = null; }
  lastRulesJson = rulesJsonNow();
  applyMasterAll(false);                         // last synced copy, until the sync below finishes
  await restoreSession();                        // yesterday's / this morning's work, if not cleared
  updateSyncStatus();
  initPwa();
  if(syncCfg()) fullSync();                      // once per opening
})();

