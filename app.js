// ===================== VERSION =====================
// Bump this string whenever a change ships. Shown in the header badge and footer,
// logged to the console on load, and compared against the last-seen version stored
// per browser/machine so an "updated" notice can be shown after an update (see
// loadPersisted()). This is purely a tracking label — it has no effect on parsing
// or matching logic.
const APP_VERSION = 'v8.8';
// The Invoice Audit Google Sheet — opened from "Sync & login", the sidebar and the master screens.
// The sheet script also reports its own address on every sync, which takes over if it ever moves.
// v8.3: the company's Apps Script web app is built in — nobody has to paste it. (Redeploy with
// Manage deployments → ✎ → New version so this address stays the same.)
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyLhcyswGUxwwlv9NeXs8ZoAJAKMjyvpBD3OdMkfprhem1qjpFl3xRVInl406soekw-/exec';
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1R1vM0mbMXfcjk0cgz99r-IkSOwHPvW9cWZFx1dJHTSI/edit';
function sheetUrl(){ return (typeof MASTER_ALL !== 'undefined' && MASTER_ALL && MASTER_ALL.sheetUrl) || DEFAULT_SHEET_URL; }
function updateSheetLinks(){ document.querySelectorAll('[data-sheet-link]').forEach(a => { a.href = sheetUrl(); }); }
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
  if(typeof updateSlabStatus === 'function') updateSlabStatus();
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
    const lc = lineCheck(row, record);
    if(!lc.flagged) return;
    issues.push(`${row.description}: ${lc.issues.join('; ')}`);
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
// v8: the ☰ sidebar picks one view at a time — "Check bills" or one of the masters / panels.
var currentView = 'bills';
const VIEW_PANELS = { items: 'masterPanel', parties: 'masterPanel', slab: 'masterPanel', itemcats: 'itemCatPanel', rules: 'rulesPanel', codes: 'codesPanel', log: 'logPanel', parser: 'parserReportPanel', sync: 'syncPanel' };
function setView(v){
  if(!VIEW_PANELS[v] && v !== 'local') v = 'bills';
  const tabChanged = (v === 'bills' || v === 'local') && v !== currentView;
  currentView = v;
  document.body.dataset.view = v;
  [masterPanel, rulesPanel, codesPanel, logPanel, parserReportPanel, syncPanel, document.getElementById('itemCatPanel')].forEach(p => p.classList.remove('open'));
  if(v === 'bills' || v === 'local'){
    try{ localStorage.setItem('ia.tab', v); }catch(e){}
    applyTabTexts();
    if(tabChanged && typeof renderOverview === 'function'){ overviewFilter = 'attention'; renderOverview(); updateExportBarVisibility(); }
  }else{
    document.getElementById(VIEW_PANELS[v]).classList.add('open');
    if(v === 'items' || v === 'parties' || v === 'slab'){ if(masterTab !== v){ masterSearch = ''; masterEdit = null; } masterTab = v; renderMasterPanel(); }
    else if(v === 'log') renderLogPanel();
    else if(v === 'parser') renderParserReportPanel();
    else if(v === 'sync') renderSyncPanel();
    else if(v === 'itemcats') renderItemCatPanel();
  }
  const inSettings = ['sync', 'itemcats', 'rules', 'codes', 'parser'].includes(v);
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v || (inSettings && b.hasAttribute('data-settings-nav'))));
  document.querySelectorAll('.set-tab[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  window.scrollTo(0, 0);
}
// Older code opens a panel with openOnly(panel): routed to the matching view.
function applyTabTexts(){
  const t = BRANCH.text || {};
  const local = currentView === 'local';
  const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v || ''; };
  set('eyebrowText', local ? (BRANCH.key === 'clt' ? 'Calicut · Kannur' : 'Ernakulam') + ' · Local sales · Rate slab check' : t.eyebrow);
  set('ledeText', local
    ? 'Drop the local sales bills (consumer rates, no loading list). Every line is checked against the rate slab after GST: below the minimum is flagged as a loss in ₹ and %, above the maximum as billed too high. Lines with no slab rate show ❓.'
    : t.lede);
}
function openOnly(panel){
  const v = Object.keys(VIEW_PANELS).find(k => VIEW_PANELS[k] === panel.id && (panel !== masterPanel || k === masterTab)) || 'bills';
  setView(v);
  return true;
}
document.querySelectorAll('.nav-btn[data-view], .set-tab[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
try{ if(localStorage.getItem('ia.tab') === 'local'){ currentView = 'local'; document.body.dataset.view = 'local'; document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === 'local')); } }catch(e){}
document.getElementById('sideToggle').addEventListener('click', () => {
  const c = document.documentElement.classList.toggle('side-collapsed');
  try{ localStorage.setItem('ia.side', c ? 'collapsed' : 'open'); }catch(e){}
});

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
  if(record.local){
    box.className = 'match-box confirmed';
    box.innerHTML = `<span class="local-tag">🏪 Local sale</span> <span class="no-excel-note" style="margin-left:8px;">No loading list — each line is checked against the rate slab only.</span>`;
    return;
  }
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
  card.className = 'card invoice-card' + (record.local ? ' local' : '');
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
          <th class="num plan-col">Actual Qty</th>
          <th class="num">Billed Qty</th>
          <th>Unit</th>
          <th class="num">Billed Rate</th>
          <th class="num" title="Billed rate incl GST, and the rate slab (minimum – maximum, incl GST)">Slab (incl GST)</th>
          <th class="num plan-col">Expected Rate</th>
          <th class="plan-col">Category</th>
          <th class="num plan-col">Height ft</th>
          <th class="num plan-col">Length ft</th>
          <th class="num plan-col">Quoted Rate</th>
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
      <button data-action="wa" class="wa-btn" title="Copies a picture of this bill's check — paste it into WhatsApp with Ctrl+V">📱 Copy for WhatsApp</button>
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

  card.querySelector('[data-action="wa"]').addEventListener('click', e => copyBillImage(record, e.currentTarget));
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
      <td class="num plan-col"><input class="cell-input" data-field="orderedQty" value="${row.orderedQty !== null ? row.orderedQty : ''}" style="width:64px;"><div class="qty-calc" data-qty-calc></div></td>
      <td class="num">${row.quantity}</td>
      <td>${escapeHtml(row.unit || '')}</td>
      <td class="num">${fmt(row.rate)}</td>
      <td class="num slab-cell" data-field="slab">—</td>
      <td class="num plan-col" data-field="expectedRate">—</td>
      <td class="plan-col"><select class="cell-select" data-field="category">
            ${Object.keys(rules).map(k => `<option value="${k}" ${row.category===k?'selected':''}>${rules[k].label}</option>`).join('')}
          </select></td>
      <td class="num plan-col"><input class="cell-input" data-field="heightFt" value="${row.heightFt !== null ? row.heightFt : ''}" style="width:52px;"></td>
      <td class="num plan-col"><input class="cell-input" data-field="customLengthFt" value="${row.customLengthFt !== null ? row.customLengthFt : ''}" placeholder="${(rules[row.category] || rules.direct).lengthFt || ''}" title="Leave blank to use the category default (12ft sheets, 50ft rolls). Fill in only for a non-standard length, e.g. a 100ft roll." style="width:60px;"></td>
      <td class="num plan-col"><div class="rate-cell"><input class="cell-input" data-field="quotedRate" value="${row.quotedRate !== null ? row.quotedRate : ''}" placeholder="rate" style="width:68px;"><button type="button" class="fill-btn" data-action="fill" title="Copy this rate to every other row in the same category">↧all</button></div></td>
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
  const gaps = gatherSlabGaps(record);
  const loss = record.items.reduce((t, row) => { const sl = lineCheck(row, record).slab; return t + (sl && sl.status === 'below' ? sl.total : 0); }, 0);
  holder.innerHTML = (issues.length ? `<div class="discrepancy-summary">
    <div class="discrepancy-summary-head">⚠ ${issues.length} discrepanc${issues.length === 1 ? 'y' : 'ies'} on this bill${loss > 0 ? `<span class="loss-chip">Loss vs slab ₹${fmt(loss)}</span>` : ''}</div>
    ${issues.map(i => `<div class="discrepancy-summary-line">• ${escapeHtml(i)}</div>`).join('')}
  </div>` : '') + (gaps.length ? `<div class="slab-gaps">${gaps.map(g => `<div>❓ ${escapeHtml(g)}</div>`).join('')}</div>` : '');
}

function recalcCard(card){
  const record = window.__records.find(r => r.id === card.dataset.recordId);
  if(!record) return;
  const tbody = card.querySelector('[data-tbody]');
  let anyFlag = !!record.partyMismatch, anyPending = false;
  let sumBilled = 0, sumExpected = 0, allComputed = true;
  let discrepancyCount = record.partyMismatch ? 1 : 0;

  let slabGaps = 0, slabLoss = 0;
  record.items.forEach((row, idx) => {
    const tr = tbody.querySelector(`tr[data-idx="${idx}"]`);
    const lc = lineCheck(row, record);
    const result = lc.result;
    const sl = lc.slab;
    sumBilled += row.amount;
    if(result.expectedRate !== null) sumExpected += result.expectedRate * row.quantity;
    else allComputed = false;

    const quotedInput = tr.querySelector('[data-field="quotedRate"]');
    const currentVal = row.quotedRate === null ? '' : String(row.quotedRate);
    if(document.activeElement !== quotedInput && quotedInput.value !== currentVal) quotedInput.value = currentVal;
    const orderedInput = tr.querySelector('[data-field="orderedQty"]');
    const currentOrdered = row.orderedQty === null ? '' : String(row.orderedQty);
    if(document.activeElement !== orderedInput && orderedInput.value !== currentOrdered) orderedInput.value = currentOrdered;

    tr.classList.toggle('flag', lc.flagged);
    tr.classList.toggle('pending', result.pending && !result.qtyMismatch && !lc.flagged);
    tr.querySelector('[data-field="expectedRate"]').textContent = result.expectedRate !== null ? fmt(result.expectedRate) : '—';
    const statusCell = tr.querySelector('[data-field="status"]');
    const showPending = result.pending && !result.qtyMismatch && !lc.flagged;
    const gap = lc.slabGap && !lc.flagged && !showPending;
    statusCell.className = 'num status ' + (showPending ? 'pending' : lc.flagged ? 'bad' : gap ? 'pending' : 'ok');
    if(gap) statusCell.innerHTML = '<span class="shot-hide">❓</span><span class="shot-only st-ok">✓</span>';
    else statusCell.textContent = showPending ? '…' : lc.flagged ? '✗' : '✓';
    statusCell.title = gap ? 'No rate slab to check this line against' : '';
    renderSlabCell(tr, sl);
    if(lc.slabGap) slabGaps++;
    if(sl && sl.status === 'below') slabLoss += sl.total;

    const calcEl = tr.querySelector('[data-qty-calc]');
    if(calcEl) calcEl.textContent = result.qtyCalc || '';
    tr.querySelectorAll('.other-note, .info-note, .slab-note, .slab-gap-note').forEach(n => n.remove());
    if(sl && (sl.status === 'below' || sl.status === 'above')){
      const n = document.createElement('div'); n.className = 'slab-note' + (sl.status === 'above' ? ' above' : ''); n.textContent = (sl.status === 'below' ? '▼ ' : '▲ ') + sl.message;
      tr.querySelector('.desc').appendChild(n);
    }else if(sl && sl.gap){
      const n = document.createElement('div'); n.className = 'slab-gap-note'; n.textContent = '❓ ' + sl.message;
      tr.querySelector('.desc').appendChild(n);
    }
    if(sl && sl.planNote){
      const n = document.createElement('div'); n.className = 'slab-note'; n.textContent = '▼ ' + sl.planNote;
      tr.querySelector('.desc').appendChild(n);
    }
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

    if(lc.flagged){ anyFlag = true; discrepancyCount++; }
    if(result.pending && !result.qtyMismatch && !lc.flagged) anyPending = true;
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
  const span = record.local ? 5 : 11;
  record.slabLoss = Math.round(slabLoss * 100) / 100;
  record.slabGaps = slabGaps;
  tfoot.innerHTML = `
    <tr><td colspan="${span}">Billed total (line items)</td><td class="num">${fmt(sumBilled)}</td><td></td></tr>
    ${record.slabLoss > 0 ? `<tr><td colspan="${span}" style="color:var(--red);">Loss against the rate slab (incl GST)</td><td class="num" style="color:var(--red);font-weight:600;">${fmt(record.slabLoss)}</td><td class="num status bad">✗</td></tr>` : ''}
    ${allComputed && !record.local ? `<tr>
      <td colspan="${span}">Expected total</td>
      <td class="num">${fmt(sumExpected)}</td>
      <td class="num status ${Math.abs(sumBilled-sumExpected) > totalTol ? 'bad' : 'ok'}">${Math.abs(sumBilled-sumExpected) > totalTol ? '✗' : '✓'}</td>
    </tr>` : ''}
  `;

  const stamp = card.querySelector('[data-stamp]');
  stamp.classList.remove('ok','bad','pending');
  const nameCheckPending = !record.local && !!excelWorkbookData && !record.selectedBlockName;
  // A missing e-Way Bill or a subtotal mismatch is a discrepancy in its own right: it's already in
  // the count and the summary banner, so the stamp must not say "Verified" while it stands.
  if(record.subtotalOk === false || record.ewayPresent === false || (record.billIssues || []).length) anyFlag = true;
  const readCheckOpen = (record.readWarnings || []).length > 0 && !record.readWarningsAck;
  let statusKind;
  if(nameCheckPending && !anyFlag){ stamp.classList.add('pending'); stamp.textContent = 'Pick customer'; statusKind = 'name'; }
  else if(anyPending){ stamp.classList.add('pending'); stamp.textContent = 'Awaiting rates'; statusKind = 'rates'; }
  else if(anyFlag){ stamp.classList.add('bad'); stamp.textContent = `Discrepancy (${discrepancyCount}) ⚠`; statusKind = 'discrepancy'; }
  else if(readCheckOpen){ stamp.classList.add('pending'); stamp.textContent = 'Check the read ⚠'; statusKind = 'readcheck'; }
  else if(slabGaps && SLAB_SET.missingBlocks){ stamp.classList.add('pending', 'slab-only'); stamp.innerHTML = `<span class="shot-hide">Slab missing (${slabGaps}) ❓</span><span class="shot-only">Verified ✓</span>`; statusKind = 'slab'; }
  else{ stamp.classList.add('ok'); stamp.textContent = 'Verified ✓'; statusKind = 'verified'; }

  const isClean = statusKind === 'verified';
  record.statusKind = statusKind;
  record.currentDiscrepancyCount = discrepancyCount;
  record.currentlyClean = isClean;
  card.classList.toggle('clean-bill', isClean);
  card.classList.toggle('slab-only', statusKind === 'slab');   // screenshot mode shows it as verified
  renderTally();
}


function updateExportBarVisibility(){
  exportBar.style.display = tabRecords().length ? 'block' : 'none';
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
      const lc = lineCheck(row, record), result = lc.result;
      if(!lc.flagged) return;
      const issues = lc.issues;
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
// v8: local sales — no loading list; every line is checked against the rate slab only.
const localZone = document.getElementById('localZone');
const localInput = document.getElementById('localInput');
localZone.addEventListener('click', () => localInput.click());
localZone.addEventListener('dragover', e => { e.preventDefault(); localZone.classList.add('drag'); });
localZone.addEventListener('dragleave', () => localZone.classList.remove('drag'));
localZone.addEventListener('drop', e => {
  e.preventDefault(); localZone.classList.remove('drag');
  const files = Array.from(e.dataTransfer.files).filter(f => !isExcelFile(f));
  if(files.length) handleFiles(files, { local: true });
});
localInput.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if(files.length) handleFiles(files, { local: true });
  localInput.value = '';
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

function buildRecord(file, outcome, seq, key, local){
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
    seq, fileKey: key, filename: file.name, parsed, items, local: !!local,
    billIssues: sellerGstinIssues(parsed),
    selectedBlockName: null, partyMismatch: false, itemMismatches: {}, _autoGuessTried: false,
    extractionPath: 'deterministic',
    readWarnings: outcome.warnings || [], readWarningsAck: false
  };
}

// Batches are queued: dropping a second set of bills while the first is still being read simply
// waits its turn, instead of two batches interleaving and fighting over the progress bar.
let batchChain = Promise.resolve();
function handleFiles(files, opts){
  const list = Array.from(files);
  batchChain = batchChain.then(() => processBatch(list, opts || {})).catch(e => {
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

async function processBatch(files, opts){
  opts = opts || {};
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
      const record = buildRecord(file, outcome, seq, key, !!opts.local);
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
        kind: outcome.kind, code: outcome.code, reason: outcome.reason, deliveryNote: outcome.deliveryNote || null, local: !!opts.local
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
  if(!!opts.local !== (currentView === 'local') && (currentView === 'bills' || currentView === 'local')) setView(opts.local ? 'local' : 'bills');
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
  box.dataset.local = entry.local ? '1' : '0';
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
  slab:        { label: 'Slab missing ❓',      cls: 'pending' },
  failed:      { label: 'Not read',            cls: 'bad' },
  dn:          { label: 'Delivery note',       cls: 'muted' },
  duplicate:   { label: 'Duplicate — skipped', cls: 'muted' },
};

// v8: "Check dispatch list" and "Check local bills" are two tabs; each shows and counts only its own bills.
function inTab(x){ return !!(x && x.local) === (currentView === 'local'); }
function tabRecords(){ return window.__records.filter(inTab); }
function overviewRows(){
  const blockCounts = {};
  tabRecords().forEach(r => { if(r.selectedBlockName) blockCounts[r.selectedBlockName] = (blockCounts[r.selectedBlockName] || 0) + 1; });
  const rows = tabRecords().map(r => {
    const kind = r.statusKind || 'name';
    return {
      seq: r.seq, kind, isRecord: true, ref: r,
      file: r.filename,
      party: r.parsed.partyName || '—',
      customer: r.local ? '🏪 Local sale' : (r.selectedBlockName || ''),
      sharedCustomer: r.selectedBlockName && blockCounts[r.selectedBlockName] > 1
        ? window.__records.filter(o => o !== r && o.selectedBlockName === r.selectedBlockName).map(o => '#' + o.seq) : null,
      invoice: r.parsed.invoiceNumber || '—',
      lines: r.items.length,
      total: r.parsed.grandTotal,
      discrepancies: r.currentDiscrepancyCount || 0,
      readWarn: (r.readWarnings || []).length && !r.readWarningsAck ? r.readWarnings.length : 0,
    };
  });
  window.__skipped.filter(inTab).forEach(s => rows.push({
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
  ['pending',     'Pending check',   r => r.kind === 'name' || r.kind === 'rates' || r.kind === 'readcheck' || r.kind === 'slab'],
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
      <td>${r.kind === 'slab' ? `<span class="ov-status pending shot-hide">${status}</span><span class="ov-status ok shot-only">Verified ✓</span>` : `<span class="ov-status ${meta.cls}" ${r.reason ? `title="${escapeHtml(r.reason)}"` : ''}>${status}</span>`}${r.kind === 'failed' && r.code ? ` <span class="code-tag" title="${escapeHtml(r.reason || '')}">${escapeHtml(r.code)}</span>` : ''} ${extra.join(' ')}</td>
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
        <button id="ovWa" class="wa-btn" title="A picture of the whole day's results — paste it into WhatsApp">📱 Day summary for WhatsApp</button>
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
  overviewEl.querySelector('#ovWa').addEventListener('click', e => copyCanvasToClipboard(drawDayImage, e.currentTarget, 'day-summary-' + fmtDate(new Date()) + '.png'));
  overviewEl.querySelector('#ovSendLog').addEventListener('click', e => {
    const n = sendBillsToSheetLog(tabRecords());
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
  const local = currentView === 'local';
  const n = tabRecords().length + window.__skipped.filter(inTab).length;
  if(!n && (local || !excelWorkbookData)) return;
  const what = local ? `${n} local sales bill file(s)` : `${n} bill file(s) and the ${BRANCH.text.excelMain.replace(/^Drop /, '').replace(/ here$/, '')}`;
  if(!confirm(`Clear all — remove ${what} and start fresh?\n\nThe ${local ? 'dispatch-list bills' : 'local sales bills'}, discrepancy log, Parser report, rules and the Google Sheet data are kept.`)) return;
  const gone = new Set(tabRecords().map(r => r.id));
  window.__records = window.__records.filter(r => !gone.has(r.id));
  window.__skipped = window.__skipped.filter(x => !inTab(x));
  document.querySelectorAll('.invoice-card').forEach(c => { if(gone.has(c.dataset.recordId)) c.remove(); });
  skippedArea.querySelectorAll('[data-entry-id]').forEach(b => { if((b.dataset.local === '1') === local) b.remove(); });
  if(!local){ excelWorkbookData = null; excelFileName = null; excelLoadedAt = null; showExcelStatus(); }
  document.getElementById('restoredNote').innerHTML = '';
  if(!window.__records.length && !window.__skipped.length) uploadSeq = 0;
  lastJumpSeq = 0; lastBatchSummary = null;
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
  let cat = mapMasterCategory(it.category, row.unit);
  // Never let the list turn a line billed per sq.ft / kg into a sheet or roll (height × length) line.
  const bu = unitKey(row.unit);
  if(cat && /sheet|roll/.test(cat) && ['sqft', 'kg', 'sqmtr', 'mtr'].includes(bu)) cat = null;
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

function syncSaved(){
  let c; try{ c = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null') || {}; }catch(e){ c = {}; }
  if(!c.custom || !c.url) c.url = DEFAULT_SCRIPT_URL;   // built-in address unless an admin set another one
  return c;
}
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
  if(!j.ok){ const err = new Error(j.error || 'The sheet refused the request.'); err.code = j.code || null; throw err; }
  return j;
}

function rulesJsonNow(){ try{ return JSON.stringify(branchRulesSnapshot()); }catch(e){ return null; } }
// Called on every save: if this branch's rules changed, the new rules go to the sheet.
function noteRulesMaybeChanged(){
  if(lastRulesJson === null) return;          // still starting up
  const now = rulesJsonNow();
  if(!now || now === lastRulesJson) return;
  lastRulesJson = now;
  if(syncCfg() && isAdmin()) queueOutbox({ type: 'rules', branch: BRANCH.key, rules: JSON.parse(now) });
}
function queueOutbox(item){
  // Many quick edits on one tab go to the sheet together (one call instead of one per cell).
  if(item.type === 'rows'){
    const last = outbox[outbox.length - 1];
    if(last && last.type === 'rows' && last.tab === item.tab && !(flushing && last === outbox[0]) && last.rows.length + item.rows.length <= 300){
      item.rows.forEach(nr => {
        const same = last.rows.find(o => JSON.stringify(o.match) === JSON.stringify(nr.match));
        if(same) Object.assign(same.values, nr.values); else last.rows.push(nr);
      });
      idbSet('outbox', outbox); updateSyncStatus();
      clearTimeout(flushTimer); flushTimer = setTimeout(flushOutbox, 1200);
      return;
    }
  }
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
      try{
        if(item.type === 'rules') await api('saveRules', { branch: item.branch, rules: item.rules });
        else if(item.type === 'log') await api('log', { entries: item.entries });
        else if(item.type === 'rows') await api('saveRows', { tab: item.tab, rows: item.rows });
        else if(item.type === 'delete') await api('deleteRows', { tab: item.tab, matches: item.matches });
        else if(item.type === 'learn') await api('learn', { branch: item.branch, parties: item.parties, items: item.items });
      }catch(err){
        // An admin-only change made by a checker can never succeed: drop it, say so, carry on.
        if(err.code !== 'ROLE') throw err;
        syncState.roleNote = err.message;
      }
      outbox.shift();
      await idbSet('outbox', outbox);
    }
    if(!syncState.busy) syncState.lastError = null;
  }catch(e){
    ok = false;
    syncState.lastError = e.message;
    if(e.code === 'AUTH') lockApp('Your password was changed or your user was switched off in the sheet — log in again.');
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
    customer: r.local ? '' : (r.selectedBlockName || ''),
    file: r.filename,
    status: shareKind(r) === 'discrepancy' ? `Discrepancy (${r.currentDiscrepancyCount || 0})` : (STATUS_META[shareKind(r)] || STATUS_META.name).label,
    count: r.currentDiscrepancyCount || 0,
    details: gatherBillDiscrepancies(r),
    slabLoss: r.slabLoss || 0,
    type: r.local ? 'Local sale' : 'Loading list',
    version: APP_VERSION
  }));
  if(!entries.length) return 0;
  queueOutbox({ type: 'log', entries });
  queueLearning(records);
  return entries.length;
}
// Learning: what a checked bill confirms is added to the Party and Item masters, so the next bill
// matches straight away. Only from correct matches: a bill whose party is marked as mismatched
// teaches no party, and a line teaches its code only when its loading-list check passed.
function queueLearning(records){
  const parties = [], items = [], seenP = new Set(), seenI = new Set();
  records.forEach(r => {
    if(!r || r.local || !r.parsed) return;
    if(r.selectedBlockName && !r.partyMismatch && r.parsed.partyName){
      const k = normalize(r.parsed.partyName) + '|' + normalize(r.selectedBlockName);
      const known = MASTER.parties.some(p => normalize(p.name) === normalize(r.parsed.partyName) && [p.name, ...splitList(p.aliases)].some(a => normalize(a) === normalize(r.selectedBlockName)));
      if(!known && !seenP.has(k)){ seenP.add(k); parties.push({ name: r.parsed.partyName, alias: r.selectedBlockName }); }
    }
    r.items.forEach(row => {
      if(!row.excelCode || row.itemNameMismatch || row.notDispatchedButBilled) return;
      const res = computeRow(row);
      if(res.flagged || res.pending || res.expectedRate === null) return;
      if(masterCodeRelation(row.description, row.excelCode) === 'same') return;
      const k = nameKey(row.description) + '|' + codeKey(row.excelCode);
      if(seenI.has(k)) return;
      seenI.add(k); items.push({ name: row.description, code: row.excelCode });
    });
  });
  if(parties.length || items.length) queueOutbox({ type: 'learn', branch: BRANCH.key, parties, items });
}

// Once each time the app opens (and on ⟳ Sync now): send anything waiting, then fetch everything.
async function fullSync(){
  if(!syncCfg() || syncState.busy) return;
  syncState.busy = true; syncState.lastError = null;
  updateSyncStatus();
  try{
    await flushOutbox();
    const data = await api('pull');
    MASTER_ALL = { at: data.at, user: data.user, displayName: data.displayName, role: data.role || 'admin', branches: data.branches || {}, slab: data.slab || [], slabSettings: data.slabSettings || null, appSettings: data.appSettings || {}, sheetUrl: data.sheetUrl || null };
    updateSheetLinks();
    await idbSet('master', MASTER_ALL);
    const saved = syncSaved();
    if(data.displayName && saved.displayName !== data.displayName){ saved.displayName = data.displayName; localStorage.setItem(SYNC_KEY, JSON.stringify(saved)); }
    applyMasterAll(true);
    if(outbox.length) await flushOutbox();
  }catch(e){
    syncState.lastError = e.message;
    // Password changed or user switched off in the sheet: this PC is locked until a new login.
    if(e.code === 'AUTH') lockApp('Your password was changed or your user was switched off in the sheet — log in again.');
  }finally{
    syncState.busy = false;
    updateSyncStatus();
    if(masterPanel.classList.contains('open') && !masterEdit) renderMasterPanel();
  }
}
function isAdmin(){ return !MASTER_ALL || MASTER_ALL.role !== 'checker'; }
function applyMasterAll(fromSheet){
  const b = MASTER_ALL && MASTER_ALL.branches ? MASTER_ALL.branches[BRANCH.key] : null;
  setMaster(b);
  setSlab(MASTER_ALL ? MASTER_ALL.slab : [], MASTER_ALL ? MASTER_ALL.slabSettings : null);
  updateSlabStatus();
  if(fromSheet) recalcAllCards();
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
    <p class="desc">The item lists, party lists, rate slab, rules and the audit log live in one Google Sheet shared by every PC. The app syncs once each time it is opened (and whenever you press ⟳ Sync now), then keeps a copy in this browser, so it also works without internet. Bills and the rate sheet never leave this computer.</p>
    <p style="margin:0 0 16px;"><a class="bar-btn primary" data-sheet-link href="${escapeHtml(sheetUrl())}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;">📊 Open the Google Sheet</a>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--ink-soft);margin-left:8px;">Users · Items · Parties · Rate Slab · Rules · Audit Log — opens in a new tab (needs access to the sheet)</span></p>
    <div class="sync-form">
      <label for="syncUser">User name</label><input id="syncUser" autocomplete="username" value="${escapeHtml(saved.user || '')}">
      <label for="syncPass">Password</label><input id="syncPass" type="password" autocomplete="current-password" placeholder="${cfg ? '(saved — type only to change)' : ''}">
      <div class="actions">
        <button type="button" class="bar-btn primary" id="syncLoginBtn">Log in &amp; sync</button>
        ${cfg ? '<button type="button" class="bar-btn" id="syncLogoutBtn">Log out of this browser</button>' : ''}
      </div>
    </div>
    <details style="margin-top:14px;font-size:12px;color:var(--ink-soft);"><summary style="cursor:pointer;">Advanced — sheet connection</summary>
      <p style="margin:8px 0;">The company sheet's address is built into the app, so nobody has to enter it. Change it only if the Apps Script was deployed as a brand-new deployment (a new address).</p>
      <div class="sync-form"><label for="syncUrl">Web app URL</label><input id="syncUrl" value="${escapeHtml(saved.url)}">
        <div class="actions"><button type="button" class="bar-btn" id="syncUrlReset">Use the built-in address</button></div></div>
    </details>
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
      const r = await loginWith(url, user, hash);
      renderSyncPanel(`✓ Logged in as ${r.displayName || user}. Syncing…`, 'ok');
      await fullSync();
      renderSyncPanel(syncState.lastError ? '⚠ ' + syncState.lastError : `✓ Logged in as ${r.displayName || user} and synced.`, syncState.lastError ? 'bad' : 'ok');
    }catch(e){
      msgEl.className = 'sync-msg bad'; msgEl.textContent = '⚠ ' + e.message;
    }
  });
  document.getElementById('syncUrlReset').addEventListener('click', () => { document.getElementById('syncUrl').value = DEFAULT_SCRIPT_URL; });
  const lo = document.getElementById('syncLogoutBtn');
  if(lo) lo.addEventListener('click', () => logOut());
}

// ---- Login screen: nothing in the app is shown until a user from the sheet's Users tab logs in ----
// The login is checked by the sheet itself (needs internet the first time); after that this PC
// stays logged in — also offline — until "Log out", or until the sheet refuses the saved login
// (password changed / user switched off), which locks it again at the next sync.
async function loginWith(url, user, hash){
  const r = await api('login', {}, { url, user, hash });
  localStorage.setItem(SYNC_KEY, JSON.stringify({ url, custom: url !== DEFAULT_SCRIPT_URL, user, hash, displayName: r.displayName || user }));
  return r;
}
function lockApp(message){
  const saved = syncSaved();
  localStorage.setItem(SYNC_KEY, JSON.stringify({ url: saved.url || '', custom: !!saved.custom, user: saved.user || '' }));
  saveSessionNow();
  [masterPanel, rulesPanel, codesPanel, logPanel, parserReportPanel, syncPanel, document.getElementById('itemCatPanel')].forEach(p => p.classList.remove('open'));
  document.documentElement.classList.add('locked');
  renderLockScreen(message || '', message ? 'bad' : '');
}
function logOut(){
  if(!confirm('Log out of Invoice Audit on this PC?\n\nThe next person has to log in. Open bills and the rate sheet stay.')) return;
  syncState.lastError = null;
  lockApp('');
  renderLockScreen('Logged out.', 'ok');
}
function renderLockScreen(msg, kind){
  const saved = syncSaved();
  const urlBox = document.getElementById('lockUrlBox'), urlNote = document.getElementById('lockUrlNote');
  const hasUrl = true;   // v8.3: built in
  urlBox.hidden = true; urlNote.hidden = true;
  document.getElementById('lockUrl').value = saved.url || '';
  if(saved.user && !document.getElementById('lockUser').value) document.getElementById('lockUser').value = saved.user;
  document.getElementById('lockPass').value = '';
  document.getElementById('lockVersion').textContent = APP_VERSION;
  const m = document.getElementById('lockMsg');
  m.className = 'lock-msg ' + (kind || ''); m.textContent = msg || '';
  setTimeout(() => document.getElementById(hasUrl && saved.user ? 'lockPass' : hasUrl ? 'lockUser' : 'lockUrl').focus(), 30);
}
function initLockScreen(){
  document.getElementById('lockUrlChange').addEventListener('click', () => {
    document.getElementById('lockUrlBox').hidden = false; document.getElementById('lockUrlNote').hidden = true;
    document.getElementById('lockUrl').focus();
  });
  document.getElementById('logoutBtn').addEventListener('click', logOut);
  document.getElementById('lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const m = document.getElementById('lockMsg'), btn = document.getElementById('lockBtn');
    const url = document.getElementById('lockUrl').value.trim();
    const user = document.getElementById('lockUser').value.trim();
    const pass = document.getElementById('lockPass').value.trim();
    const bad = t => { m.className = 'lock-msg bad'; m.textContent = t; };
    if(!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return bad('Paste the Web app URL from the sheet\'s Apps Script (it ends in /exec).');
    if(!user) return bad('Type your user name.');
    if(!pass) return bad('Type your password.');
    btn.disabled = true; m.className = 'lock-msg'; m.textContent = 'Checking…';
    try{
      await loginWith(url, user, await sha256Hex(pass));
      document.documentElement.classList.remove('locked');
      document.getElementById('lockPass').value = '';
      m.textContent = '';
      updateSyncStatus();
      fullSync();
    }catch(err){
      bad(err.code === 'AUTH' ? 'Wrong user name or password, or this user is switched off.' : err.message);
    }finally{ btn.disabled = false; }
  });
  if(!syncCfg()){ document.documentElement.classList.add('locked'); renderLockScreen(); }
}

// ---- Items & parties panel ---------------------------------------------------------------------
var masterTab = 'items';
// ---- v8: Item / Party / Rate slab masters, edited right here and saved to the Google Sheet ------
function numOrNull(v){ const t = String(v == null ? '' : v).replace(/[₹,\s]/g, ''); if(t === '') return null; const n = parseFloat(t); return isFinite(n) ? n : NaN; }
const MASTER_DEFS = {
  items: {
    label: 'Item master', sheet: () => (BRANCH.key === 'clt' ? 'CLT' : 'EKM') + ' Items', tab: () => BRANCH.key + 'Items',
    list: () => MASTER_ALL.branches[BRANCH.key].items,
    desc: () => `This branch's Tally stock items. A bill line whose Tally name (or an old name under "Other codes / spellings") is here is paired with the ${BRANCH.key === 'ekm' ? 'rate-sheet' : 'loading-plan'} row carrying one of its codes, and takes its category, size${BRANCH.key === 'ekm' ? ', bundle weight' : ''} and GST % from here. Lines confirmed on checked bills are added automatically (Source = learned).`,
    fields: [
      { k: 'code', h: 'Code', w: 140 }, { k: 'name', h: 'Tally stock item name', req: true },
      { k: 'group', h: 'Item category', w: 120 }, { k: 'category', h: 'Category', label: 'Rate category', w: 110 }, { k: 'unit', h: 'Unit', w: 64 },
      { k: 'ht', h: 'Ht ft', w: 52, num: true }, { k: 'len', h: 'Len ft', w: 52, num: true },
      { k: 'bundleKg', h: 'Bundle kg', w: 64, num: true }, { k: 'gst', h: 'GST %', w: 52, num: true },
      { k: 'other', h: 'Other codes / spellings', wide: true }, { k: 'source', h: 'Source', w: 120, ro: true }],
    key: r => ({ 'Tally stock item name': r.name }),
    same: (a, b) => normalize(a.name) === normalize(b.name),
  },
  parties: {
    label: 'Party master', sheet: () => (BRANCH.key === 'clt' ? 'CLT' : 'EKM') + ' Parties', tab: () => BRANCH.key + 'Parties',
    list: () => MASTER_ALL.branches[BRANCH.key].parties,
    desc: () => `Each Tally party name with the name(s) used on the ${BRANCH.key === 'ekm' ? 'rate sheet' : 'loading plan'} (separate several with commas). A bill whose party is here is paired with that customer straight away. Parties confirmed on checked bills are added automatically (Source = learned).`,
    fields: [
      { k: 'name', h: 'Tally party name', req: true },
      { k: 'aliases', h: () => BRANCH.key === 'clt' ? 'Names on the loading plan / other spellings' : 'Names on the rate sheet / other spellings', label: 'Names on the plan / other spellings', wide: true },
      { k: 'place', h: 'Place', w: 120 }, { k: 'source', h: 'Source', w: 120, ro: true }],
    key: r => ({ 'Tally party name': r.name }),
    same: (a, b) => normalize(a.name) === normalize(b.name),
  },
  slab: {
    label: 'Rate slab', sheet: () => 'Rate Slab', tab: () => 'slab',
    list: () => MASTER_ALL.slab,
    desc: () => `ONE safety slab for every branch, rates INCLUDING GST. Every bill line — loading-list and local sales — is checked against it: below the minimum is flagged as a loss, above the maximum as billed too high. The maximum is the minimum + the item's Max % (blank = the default below). Like the loading list, the slab follows each item's rate rule: for sheet and roll items type the rate <b>per sq.ft</b> — a bill per piece / roll is checked against rate × height × length from the Item master. To change a rate and keep the history, use "＋ New rate": old bills keep being checked against the rate valid on their date.`,
    fields: [
      { k: 'item', h: 'Tally item name', req: true }, { k: 'unit', h: 'Unit', w: 64 },
      { k: 'gst', h: 'GST %', w: 52, num: true }, { k: 'min', h: 'Minimum rate (incl GST)', label: 'Minimum ₹ (incl GST)', w: 90, num: true },
      { k: 'maxPct', h: 'Max %', w: 56, num: true, placeholder: () => String(SLAB_SET.maxPct) },
      { k: 'max', h: 'Maximum rate (incl GST)', label: 'Maximum ₹', w: 84, ro: true, calc: r => (isFinite(r.min) && r.min !== null) ? fmt(slabMaxOf(r)) : '' },
      { k: 'from', h: 'Effective from', label: 'From (DD-MM-YYYY)', w: 92, placeholder: () => 'always' },
      { k: 'other', h: 'Other names / spellings', wide: true },
      { k: 'by', h: 'Updated by', w: 110, ro: true, calc: r => [r.by, r.at].filter(Boolean).join(' · ') }],
    key: r => ({ 'Tally item name': r.item, 'Unit': r.unit || '', 'Effective from': r.from || '' }),
    same: (a, b) => normalize(a.item) === normalize(b.item) && unitKey(a.unit) === unitKey(b.unit) && (a.from || '') === (b.from || ''),
  },
};
var masterSearch = '', masterEdit = null;
var masterSort = {}, masterFilter = {}, masterAttention = {};   // per master tab
// What each master can be filtered by, and how it can be sorted.
const MASTER_VIEW = {
  items:   { filters: [['group', 'Item category'], ['category', 'Rate category']],
             sorts: [['grp', 'Item category (my order)'], ['az', 'Name A → Z'], ['za', 'Name Z → A'], ['cat', 'Rate category'], ['code', 'Code A → Z'], ['new', 'Newest first']] },
  parties: { filters: [['place', 'Place']], sorts: [['az', 'Name A → Z'], ['za', 'Name Z → A'], ['cat', 'Place, then name'], ['new', 'Newest first']] },
  slab:    { filters: [['__group', 'Item category'], ['unit', 'Unit']],
             sorts: [['grp', 'Item category (my order)'], ['az', 'Item A → Z'], ['za', 'Item Z → A'], ['cat', 'Unit, then item'], ['new', 'Newest first']] },
};
function masterNameOf(r){ return normalize(r.name || r.item || ''); }
function defaultSort(tab){ return tab === 'items' || tab === 'slab' ? 'grp' : 'az'; }
// A rate slab row's item category comes from the Item master (this branch first, then the other).
var _grpMap = null;
function slabGroupOf(r){
  if(!_grpMap){
    _grpMap = new Map();
    [BRANCH.key, BRANCH.key === 'ekm' ? 'clt' : 'ekm'].forEach(b => ((MASTER_ALL.branches[b] || {}).items || []).forEach(it => {
      const k = nameKey(it.name); if(k && !_grpMap.has(k) && it.group) _grpMap.set(k, it.group);
    }));
  }
  return _grpMap.get(nameKey(r.item)) || '';
}
const UNIT_LABEL = { sqft: 'sq.ft', kg: 'kg', nos: 'PCS / NOS', roll: 'ROLL', bundle: 'bundle', mtr: 'mtr', sqmtr: 'sq.mtr', ft: 'ft', box: 'box', set: 'set' };
// The value a filter / the category sort looks at (units grouped: PCS, PC, PICS, NOS are one).
function masterVal(r, fk){
  if(fk === '__group') return slabGroupOf(r);
  if(fk === 'group') return masterTab === 'slab' ? slabGroupOf(r) : (r.group || '');
  if(fk === 'unit'){ const u = String(r.unit || '').trim(); return u ? (UNIT_LABEL[unitKey(u)] || u) : ''; }
  return r[fk] ?? '';
}
function masterFilterValues(fk){
  const seen = new Map();
  let blank = 0;
  MASTER_DEFS[masterTab].list().forEach(r => {
    const v = String(masterVal(r, fk)).trim();
    if(!v){ blank++; return; }
    const k = v.toLowerCase();
    if(!seen.has(k)) seen.set(k, { v, n: 0 });
    seen.get(k).n++;
  });
  let vals = [...seen.values()];
  if(fk === 'group' || fk === '__group'){ const pos = itemCatPos(); vals.sort((a, b) => pos(a.v) - pos(b.v) || a.v.localeCompare(b.v)); }
  else vals.sort((a, b) => a.v.localeCompare(b.v));
  return { vals, blank };
}
function masterControlsHtml(){
  const mv = MASTER_VIEW[masterTab]; if(!mv) return '';
  const cf = masterFilter[masterTab] || {}, srt = masterSort[masterTab] || defaultSort(masterTab);
  const sel = 'font-size:12.5px;border:1px solid var(--rule-strong);border-radius:3px;padding:6px 8px;background:#fff;max-width:230px;';
  const need = masterTab === 'parties' ? 0 : def_needCount();
  return mv.filters.map(([fk, fl]) => {
    const { vals, blank } = masterFilterValues(fk), cur = cf[fk] || '';
    return `<label style="font-size:12px;color:var(--ink-soft);display:flex;align-items:center;gap:5px;">${fl}
      <select data-mfilter="${fk}" style="${sel}"><option value="">All</option>${blank ? `<option value="__blank" ${cur === '__blank' ? 'selected' : ''}>— not set — (${blank})</option>` : ''}${vals.map(x => `<option value="${escapeHtml(x.v.toLowerCase())}" ${cur === x.v.toLowerCase() ? 'selected' : ''}>${escapeHtml(x.v)} (${x.n})</option>`).join('')}</select></label>`;
  }).join('') + `<label style="font-size:12px;color:var(--ink-soft);display:flex;align-items:center;gap:5px;">Sort
      <select id="mSort" style="${sel}">${mv.sorts.map(([k, l]) => `<option value="${k}" ${srt === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
    + (masterTab === 'parties' ? '' : `<button type="button" class="bar-btn${masterAttention[masterTab] ? ' primary' : ''}" id="mNeed" title="Show only the rows that are missing something the checks need" ${need || masterAttention[masterTab] ? '' : 'disabled'}>⚠ Needs attention (${need})</button>`);
}
// Suggestions for the Rate category box: the app's own pricing categories plus any already used.
function categorySuggestions(){
  const out = new Map();
  const add = c => { c = String(c || '').trim(); if(c && !out.has(c.toLowerCase())) out.set(c.toLowerCase(), c); };
  Object.keys(rules).forEach(k => add(rules[k].label));
  MASTER_ALL.branches[BRANCH.key].items.forEach(r => add(r.category));
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}
// ---- Item categories (product groups such as Sheet weldmesh, Roll weldmesh, Chainlink) ------------
// Their display order is set in App settings → Item categories and kept in the sheet's Rules tab.
function appSettings(){ if(!MASTER_ALL.appSettings) MASTER_ALL.appSettings = {}; return MASTER_ALL.appSettings; }
function itemCatOrder(){ const o = (appSettings().itemCatOrder || {})[BRANCH.key]; return Array.isArray(o) ? o : []; }
function itemCatPos(){
  const m = new Map(itemCatOrder().map((c, i) => [String(c).trim().toLowerCase(), i]));
  return v => { v = String(v || '').trim().toLowerCase(); return !v ? 1e9 : m.has(v) ? m.get(v) : 1e6; };
}
function itemCatSuggestions(){
  const out = new Map();
  const add = c => { c = String(c || '').trim(); if(c && !out.has(c.toLowerCase())) out.set(c.toLowerCase(), c); };
  itemCatOrder().forEach(add);
  MASTER_ALL.branches[BRANCH.key].items.forEach(r => add(r.group));
  return [...out.values()];
}
// App settings → Item categories: the order items are listed in (Item master, sorted by item category).
var icDraft = null;
function renderItemCatPanel(msg, kind){
  const panel = document.getElementById('itemCatPanel');
  if(!MASTER_ALL || !MASTER_ALL.branches || !MASTER_ALL.branches[BRANCH.key]){ panel.innerHTML = '<h3>Item categories</h3><p class="desc">Not synced with the Google Sheet yet.</p>'; return; }
  const admin = isAdmin(), items = MASTER_ALL.branches[BRANCH.key].items;
  if(!icDraft || icDraft.branch !== BRANCH.key) icDraft = { branch: BRANCH.key, list: itemCatSuggestions(), dirty: false };
  const count = c => items.filter(r => String(r.group || '').trim().toLowerCase() === c.toLowerCase()).length;
  const unset = items.filter(r => !String(r.group || '').trim()).length;
  const saved = itemCatOrder().map(c => c.toLowerCase());
  panel.innerHTML = `<h3>Item categories <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink-soft);font-weight:400;">· ${BRANCH.key === 'clt' ? 'Calicut · Kannur' : 'Ernakulam'}</span></h3>
    <p class="desc">Your own product groups (e.g. Sheet weldmesh, Roll weldmesh, Chainlink). The Item master lists items in this order when sorted by "Item category (my order)". This is separate from the <b>rate category</b>, which decides the pricing formula. Give items a category with ✎ in the Item master, or filter/search there and use "🏷 Set item category for shown".</p>
    <ol class="ic-list">${icDraft.list.map((c, i) => `<li${saved.includes(c.toLowerCase()) ? '' : ' class="ic-new"'}><span class="ic-n">${i + 1}</span><span class="ic-name">${escapeHtml(c)}</span><span class="ic-count">${count(c)} item${count(c) === 1 ? '' : 's'}</span>
      ${admin ? `<button type="button" class="fill-btn" data-ic="up" data-i="${i}" ${i ? '' : 'disabled'} title="Move up">↑</button><button type="button" class="fill-btn" data-ic="down" data-i="${i}" ${i < icDraft.list.length - 1 ? '' : 'disabled'} title="Move down">↓</button><button type="button" class="fill-btn" data-ic="del" data-i="${i}" ${count(c) ? 'disabled title="Still used by items — change those items first"' : 'title="Remove"'}>🗑</button>` : ''}</li>`).join('')
      || '<li style="color:var(--ink-soft);">No item categories yet — add the first one below.</li>'}
      ${unset ? `<li style="background:transparent;color:var(--ink-soft);"><span class="ic-n">—</span><span class="ic-name" style="font-weight:400;">Not set yet (always listed last)</span><span class="ic-count">${unset} items</span></li>` : ''}</ol>
    ${admin ? `<div class="row" style="gap:8px;margin:12px 0;flex-wrap:wrap;">
      <input id="icNew" placeholder="New item category, e.g. Sheet weldmesh" style="min-width:260px;font-size:13px;border:1px solid var(--rule-strong);border-radius:3px;padding:7px 9px;">
      <button type="button" class="bar-btn" id="icAdd">＋ Add</button>
      <button type="button" class="bar-btn primary" id="icSave" ${icDraft.dirty ? '' : 'disabled'}>Save order</button>
      ${icDraft.dirty ? '<button type="button" class="bar-btn" id="icUndo">Undo changes</button>' : ''}</div>` : '<p class="master-note">Only an admin can change the order.</p>'}
    <div class="sync-msg ${kind || ''}">${msg ? escapeHtml(msg) : ''}</div>`;
  panel.querySelectorAll('[data-ic]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.i, L = icDraft.list;
    if(b.dataset.ic === 'up' && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
    else if(b.dataset.ic === 'down' && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
    else if(b.dataset.ic === 'del') L.splice(i, 1);
    icDraft.dirty = true; renderItemCatPanel();
  }));
  const add = () => {
    const inp = document.getElementById('icNew'), v = inp.value.trim().replace(/\s+/g, ' ');
    if(!v) return;
    if(icDraft.list.some(c => c.toLowerCase() === v.toLowerCase())){ renderItemCatPanel(`"${v}" is already in the list.`, 'bad'); return; }
    icDraft.list.push(v); icDraft.dirty = true; renderItemCatPanel();
    setTimeout(() => { const n = document.getElementById('icNew'); if(n) n.focus(); }, 0);
  };
  const ab = document.getElementById('icAdd'); if(ab) ab.addEventListener('click', add);
  const ni = document.getElementById('icNew'); if(ni) ni.addEventListener('keydown', e => { if(e.key === 'Enter') add(); });
  const ub = document.getElementById('icUndo'); if(ub) ub.addEventListener('click', () => { icDraft = null; renderItemCatPanel(); });
  const sb = document.getElementById('icSave'); if(sb) sb.addEventListener('click', () => {
    const st = appSettings();
    st.itemCatOrder = Object.assign({}, st.itemCatOrder, { [BRANCH.key]: icDraft.list.slice() });
    queueOutbox({ type: 'rules', branch: 'app', rules: st });
    idbSet('master', MASTER_ALL);
    icDraft = null;
    renderItemCatPanel('✓ Saved — sending to the Google Sheet.', 'ok');
  });
}
// ---- Needs attention: details a row is missing that the checks rely on --------------------------
function masterNeeds(tab, r){
  const out = [];
  if(tab === 'items'){
    if(!String(r.group || '').trim()) out.push('no item category');
    if(!String(r.category || '').trim()) out.push('no rate category');
    if(!String(r.unit || '').trim()) out.push('no unit');
    if(r.gst === null || r.gst === undefined || r.gst === '') out.push('no GST %');
    const k = mapMasterCategory(r.category, r.unit), keys = BRANCH.categoryKeys || {};
    // Height / length: the item master, else read from the name the same way a bill line is.
    const ht = r.ht > 0 ? r.ht : (typeof guessHeightFt === 'function' ? guessHeightFt(r.name) : null);
    if(k && (k === keys.sheet || k === keys.roll) && !(ht > 0)) out.push('no height');
    if(k && k === keys.sheet && !(r.len > 0) && !((rules[k] || {}).lengthFt > 0)) out.push('no length');
  }else if(tab === 'slab'){
    const n = nameKey(r.item);
    const it = ['ekm', 'clt'].map(b => ((MASTER_ALL.branches[b] || {}).items || []).find(x => nameKey(x.name) === n)).find(Boolean);
    if(!it) out.push('not found in an item master — check the Tally name');
    if((r.gst === null || r.gst === undefined || r.gst === '') && !(it && it.gst !== null && it.gst !== undefined && it.gst !== '')) out.push('no GST %');
  }
  return out;
}
function def_needCount(){ return MASTER_DEFS[masterTab].list().filter(r => masterNeeds(masterTab, r).length).length; }
// masterEdit: { row (original or null), draft }
function hdr(f){ return typeof f.h === 'function' ? f.h() : f.h; }

function renderMasterPanel(){
  _grpMap = null;
  const def = MASTER_DEFS[masterTab];
  if(!def){ masterPanel.innerHTML = ''; return; }
  if(!MASTER_ALL || !MASTER_ALL.branches || !MASTER_ALL.branches[BRANCH.key]){
    masterPanel.innerHTML = `<h3>${def.label}</h3><p class="desc">Not synced with the Google Sheet yet — press ⟳ Sync now at the top.</p>`;
    return;
  }
  if(masterTab === 'slab' && !Array.isArray(MASTER_ALL.slab)) MASTER_ALL.slab = [];
  const admin = isAdmin();
  const list = def.list();
  const branchTxt = masterTab === 'slab' ? 'all branches' : (BRANCH.key === 'clt' ? 'Calicut · Kannur' : 'Ernakulam');
  let html = `<h3>${def.label} <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink-soft);font-weight:400;">· ${branchTxt} · "${escapeHtml(def.sheet())}" tab · <a data-sheet-link href="${escapeHtml(sheetUrl())}" target="_blank" rel="noopener" style="color:var(--gold);">open the sheet ↗</a> · ${list.length} row${list.length === 1 ? '' : 's'}</span></h3>
    <p class="desc">${def.desc()}</p>`;
  if(masterTab === 'slab') html += slabSettingsHtml(admin) + `<div id="slabChecks">${slabChecksHtml()}</div>`;
  html += `<div class="row pr-actions" style="gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      <input type="text" id="mSearch" placeholder="Search…" value="${escapeHtml(masterSearch)}" style="flex:1;min-width:200px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;border:1px solid var(--rule-strong);border-radius:3px;padding:7px 9px;">
      ${masterControlsHtml()}
      ${admin && masterTab === 'items' ? `<button type="button" class="bar-btn" id="mBulkGroup" title="Give every item now on screen (after search / filters) the same item category">🏷 Set item category for shown</button>` : ''}
      ${admin ? `<button type="button" class="bar-btn primary" id="mAdd">＋ Add</button><button type="button" class="bar-btn" id="mPaste">📋 Paste from Excel</button>` : ''}
      <button type="button" class="bar-btn" id="mExport">⬇ Export (CSV)</button>
      ${masterTab === 'items' && admin && !list.length && branchBuiltInItems().length ? `<button type="button" class="bar-btn" id="mSeed">Fill with the built-in list (${branchBuiltInItems().length})</button>` : ''}
      ${masterTab !== 'slab' && admin ? `<button type="button" class="bar-btn" id="mTsImport" title="Fill this list from a TallySync backup (.json) — only adds and fills gaps">⇪ Import TallySync backup</button><input type="file" id="mTsFile" accept=".json,application/json" hidden>` : ''}
      ${masterTab !== 'slab' ? `<button type="button" class="bar-btn" id="mRematch" title="Match every open bill again using the current lists">↻ Re-match open bills</button>` : ''}
    </div>
    ${admin ? '' : `<p class="master-note">You are logged in as a checker — only an admin can change this list.</p>`}
    ${syncState.roleNote ? `<p class="master-note" style="color:var(--red);">⚠ ${escapeHtml(syncState.roleNote)}</p>` : ''}
    <div id="mForm"></div>
    ${admin ? '<div class="sync-msg" id="mInlineMsg" style="margin:0 0 6px;min-height:18px;">Click any cell to type — it is saved when you click away or press Enter (Enter also moves down). Esc undoes.</div>' : ''}
    <div class="m-scroll"><table class="m-table" id="mTable"></table></div>`;
  masterPanel.innerHTML = html;

  const search = document.getElementById('mSearch');
  search.addEventListener('input', () => { masterSearch = search.value; renderMasterTable(); });
  masterPanel.querySelectorAll('select[data-mfilter]').forEach(sel => sel.addEventListener('change', () => {
    masterFilter[masterTab] = Object.assign({}, masterFilter[masterTab], { [sel.dataset.mfilter]: sel.value }); renderMasterTable(); }));
  const ms = document.getElementById('mSort');
  if(ms) ms.addEventListener('change', () => { masterSort[masterTab] = ms.value; renderMasterTable(); });

  const on = (id, fn) => { const el = document.getElementById(id); if(el) el.addEventListener('click', fn); };
  on('mAdd', () => openMasterForm(null));
  on('mNeed', () => { masterAttention[masterTab] = !masterAttention[masterTab]; renderMasterPanel(); });
  on('mBulkGroup', bulkSetItemCategory);
  on('mPaste', openPasteBox);
  on('mExport', exportMaster);
  on('mRematch', rematchOpenBills);
  on('mTsImport', () => document.getElementById('mTsFile').click());
  const tsf = document.getElementById('mTsFile');
  if(tsf) tsf.addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if(f) readTallySyncBackup(f); });
  on('mSeed', async e => {
    const builtIn = branchBuiltInItems();
    if(!confirm(`Write the built-in list (${builtIn.length} items) into the empty ${def.sheet()} tab?`)) return;
    e.target.textContent = 'Writing…';
    try{ await api('seedItems', { branch: BRANCH.key, items: builtIn }); await fullSync(); renderMasterPanel(); }
    catch(err){ e.target.textContent = '⚠ ' + err.message; }
  });
  if(masterTab === 'slab') wireSlabSettings();
  renderMasterTable();
  if(masterEdit) renderMasterForm();
}
// ---- Column widths: fitted to what is in the column (capped, long text wraps); drag a header
// edge to resize — remembered on this PC; double-click the edge to fit again.
var _measureCtx = null, _cellFonts = null;
// The fonts the table really uses (read once from a hidden sample row).
function cellFonts(){
  if(_cellFonts) return _cellFonts;
  const t = document.createElement('table'); t.className = 'm-table'; t.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;';
  t.innerHTML = '<thead><tr><th>X</th></tr></thead><tbody><tr><td>x</td><td class="main">x</td><td class="mono">x</td><td class="num">x</td></tr></tbody>';
  (document.getElementById('masterPanel') || document.body).appendChild(t);
  const f = el => getComputedStyle(el).font;
  const tds = t.querySelectorAll('td');
  _cellFonts = { plain: f(tds[0]), main: f(tds[1]), mono: f(tds[2]), num: f(tds[3]), head: f(t.querySelector('th')) };
  t.remove();
  if(document.fonts && document.fonts.status !== 'loaded') _cellFonts = Object.assign({ temp: true }, _cellFonts);
  const out = _cellFonts; if(out.temp) _cellFonts = null;
  return out;
}
function textPx(t, kind){
  if(!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = cellFonts()[kind] || cellFonts().plain;
  return _measureCtx.measureText(String(t)).width;
}
function colWidthsSaved(){ try{ return JSON.parse(localStorage.getItem('ia.colw') || '{}'); }catch(e){ return {}; } }
function smartColWidths(def, rows){
  const saved = colWidthsSaved()[masterTab] || {}, out = {};
  const cap = f => (f.k === 'name' || f.k === 'item') ? 460 : f.wide ? 360 : f.k === 'code' ? 240 : f.k === 'source' || f.k === 'by' ? 190 : 230;
  const sample = rows.slice(0, 300);
  def.fields.forEach(f => {
    if(saved[f.k]){ out[f.k] = saved[f.k]; return; }
    const head = textPx(String(f.label || hdr(f)).toUpperCase(), 'head') * 1.12 + 30;
    const kind = (f.k === 'name' || f.k === 'item') ? 'main' : (f.num || f.k === 'max') ? 'num' : ['code', 'from', 'unit'].includes(f.k) ? 'mono' : 'plain';
    let w = 0;
    sample.forEach(r => {
      const v = f.calc ? f.calc(r) : r[f.k];
      if(v === null || v === undefined || v === '') return;
      const t = textPx(v, kind);
      if(t > w) w = t;
    });
    const needW = (f.k === 'name' || f.k === 'item') && masterTab !== 'parties' ? 200 : 0;   // room for the ⚠ tag
    out[f.k] = Math.round(Math.max(head, Math.min(cap(f), Math.max(w, needW) + 24), f.num ? 56 : 70));
  });
  return f => out[f.k];
}
function wireColGrips(table){
  table.querySelectorAll('.col-grip').forEach(g => {
    g.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const col = table.querySelectorAll('col')[+g.dataset.ci];
      const startX = e.clientX, startW = col.getBoundingClientRect().width || parseFloat(col.style.width), startT = table.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      const move = ev => { const w = Math.max(50, Math.round(startW + ev.clientX - startX)); col.style.width = w + 'px'; table.style.minWidth = Math.round(startT + w - startW) + 'px'; };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = '';
        const all = colWidthsSaved(); all[masterTab] = Object.assign({}, all[masterTab], { [g.dataset.k]: Math.round(parseFloat(col.style.width)) });
        try{ localStorage.setItem('ia.colw', JSON.stringify(all)); }catch(err){}
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    g.addEventListener('dblclick', e => {
      e.stopPropagation();
      const all = colWidthsSaved(); if(all[masterTab]) delete all[masterTab][g.dataset.k];
      try{ localStorage.setItem('ia.colw', JSON.stringify(all)); }catch(err){}
      renderMasterTable();
    });
  });
}
// The rows the current search, filters and "Needs attention" leave on screen.
function masterShownRows(all){
  const def = MASTER_DEFS[masterTab], q = masterSearch.trim().toLowerCase(), cf = masterFilter[masterTab] || {};
  all = all || def.list().map((r, i) => ({ r, i }));
  return all.filter(({ r }) => {
    for(const fk of Object.keys(cf)){
      const fv = cf[fk]; if(!fv) continue;
      const v = String(masterVal(r, fk)).trim().toLowerCase();
      if(fv === '__blank' ? v !== '' : v !== fv) return false;
    }
    if(masterAttention[masterTab] && !masterNeeds(masterTab, r).length) return false;
    return !q || def.fields.some(f => String(r[f.k] ?? '').toLowerCase().includes(q));
  });
}
// ---- Inline editing: type in a cell, click away (or Enter) and the row is saved to the sheet. ----
function wireInlineEdit(table){
  const def = MASTER_DEFS[masterTab];
  const toStr = (f, v) => v === null || v === undefined ? '' : String(v);
  table.addEventListener('focusin', e => { const ed = e.target.closest('.m-ed'); if(ed) ed.dataset.orig = ed.textContent; });
  table.addEventListener('keydown', e => {
    const ed = e.target.closest('.m-ed'); if(!ed) return;
    if(e.key === 'Escape'){ ed.textContent = ed.dataset.orig || ''; ed.blur(); return; }
    if(e.key === 'Enter' || (e.key === 'Tab' && false)){
      e.preventDefault();
      // Enter: save and go to the same column on the next row — quick for typing a column of rates.
      const tr = ed.closest('tr'), next = tr.nextElementSibling && tr.nextElementSibling.querySelector(`.m-ed[data-k="${ed.dataset.k}"]`);
      if(next){ next.focus(); const sel = getSelection(); sel.selectAllChildren(next); } else ed.blur();
    }
  });
  table.addEventListener('focusout', e => {
    const ed = e.target.closest('.m-ed'); if(!ed) return;
    const txt = ed.textContent.replace(/\s+/g, ' ').trim();
    if(txt === (ed.dataset.orig || '').trim()) return;
    const tr = ed.closest('tr'), row = def.list()[+tr.dataset.i];
    if(!row) return;
    const draft = {};
    def.fields.forEach(f => { if(!f.ro) draft[f.k] = toStr(f, row[f.k]); });
    draft[ed.dataset.k] = txt;
    const err = saveMasterRow(row, draft);
    const td = ed.closest('td'), msg = document.getElementById('mInlineMsg');
    if(err){
      td.classList.add('m-err'); td.title = err;
      if(msg){ msg.className = 'sync-msg bad'; msg.textContent = '⚠ ' + err + ' — fix it or press Esc in the cell to undo.'; }
      return;
    }
    td.classList.remove('m-err'); td.title = '';
    ed.textContent = toStr(null, row[ed.dataset.k]);
    ed.dataset.orig = ed.textContent;
    if(msg){ msg.className = 'sync-msg ok'; msg.textContent = `✓ Saved "${row.name || row.item}" — sending to the Google Sheet.`; }
    // refresh what depends on the row: the calculated cells and the ⚠ tag
    def.fields.forEach((f, ci) => {
      if(!f.calc) return;
      const c = tr.querySelector(`td[data-calc="${f.k}"]`); if(c) c.textContent = toStr(f, f.calc(row));
    });
    const sc = document.getElementById('slabChecks'); if(sc && masterTab === 'slab') sc.innerHTML = slabChecksHtml();
    const nb = document.getElementById('mNeed'); if(nb) nb.textContent = `⚠ Needs attention (${def_needCount()})`;
    const nameTd = tr.querySelector('.m-ed[data-k="name"], .m-ed[data-k="item"]');
    if(nameTd && masterTab !== 'parties'){
      const cellTd = nameTd.closest('td'), old = cellTd.querySelector('.need-tag'), need = masterNeeds(masterTab, row);
      if(old) old.remove();
      if(need.length) cellTd.insertAdjacentHTML('beforeend', `<span class="need-tag">⚠ ${escapeHtml(need.join(' · '))}</span>`);
    }
  });
}
// Item master: give every row now on screen the same item category (one save to the sheet).
function bulkSetItemCategory(){
  const shown = masterShownRows();
  if(!shown.length) return;
  const cats = itemCatSuggestions();
  const v = prompt(`Item category for the ${shown.length} item${shown.length === 1 ? '' : 's'} now shown${cats.length ? '\n\nExisting: ' + cats.join(' · ') : ''}\n\n(Leave blank to clear it.)`, '');
  if(v === null) return;
  const val = (cats.find(c => c.toLowerCase() === v.trim().toLowerCase()) || v.trim());
  if(!confirm(`Set the item category of ${shown.length} item${shown.length === 1 ? '' : 's'} to "${val || '(blank)'}"?`)) return;
  const def = MASTER_DEFS.items, rows = [];
  shown.forEach(({ r }) => { rows.push({ match: def.key(r), values: { 'Item category': val } }); r.group = val; });
  for(let i = 0; i < rows.length; i += 200) queueOutbox({ type: 'rows', tab: def.tab(), rows: rows.slice(i, i + 200) });
  afterMasterChange();
  renderMasterPanel();
}
function renderMasterTable(){
  const def = MASTER_DEFS[masterTab], table = document.getElementById('mTable');
  if(!table) return;
  const admin = isAdmin();
  const q = masterSearch.trim().toLowerCase();
  const all = def.list().map((r, i) => ({ r, i }));
  const list = masterShownRows(all);
  const mv = MASTER_VIEW[masterTab], srt = masterSort[masterTab] || defaultSort(masterTab);
  const sortKey = masterTab === 'items' ? 'category' : masterTab === 'slab' ? 'unit' : mv.filters[0][0];
  const pos = itemCatPos();
  const grpOf = r => masterTab === 'slab' ? slabGroupOf(r) : (r.group || '');
  const byName = (a, b) => masterNameOf(a.r).localeCompare(masterNameOf(b.r)) || (dateNum(a.r.from) || 0) - (dateNum(b.r.from) || 0);
  const blankLast = (x, y) => (x ? 0 : 1) - (y ? 0 : 1) || String(x).toLowerCase().localeCompare(String(y).toLowerCase());
  list.sort(srt === 'za' ? (a, b) => byName(b, a)
    : srt === 'grp' ? (a, b) => pos(grpOf(a.r)) - pos(grpOf(b.r)) || blankLast(String(grpOf(a.r)).trim(), String(grpOf(b.r)).trim()) || byName(a, b)
    : srt === 'cat' ? (a, b) => blankLast(String(masterVal(a.r, sortKey)).trim(), String(masterVal(b.r, sortKey)).trim()) || byName(a, b)
    : srt === 'code' ? (a, b) => blankLast(String(a.r.code ?? '').trim(), String(b.r.code ?? '').trim()) || byName(a, b)
    : srt === 'new' ? (a, b) => b.i - a.i
    : byName);
  const LIMIT = 500;
  const shown = list.slice(0, LIMIT);
  const cell = (f, r) => {
    const v = f.calc ? f.calc(r) : r[f.k];
    const txt = v === null || v === undefined ? '' : (f.num && isFinite(v) ? String(v) : String(v));
    const cls = [f.num || f.k === 'max' ? 'num' : '', f.k === 'code' || f.k === 'from' || f.k === 'unit' ? 'mono' : '', f.k === 'name' || f.k === 'item' ? 'main' : '', f.ro ? 'muted' : ''].filter(Boolean).join(' ');
    const need = (f.k === 'name' || f.k === 'item') && masterTab !== 'parties' ? masterNeeds(masterTab, r) : [];
    const tag = need.length ? `<span class="need-tag" title="Type the missing details straight into this row">⚠ ${escapeHtml(need.join(' · '))}</span>` : '';
    if(admin && !f.ro)   // typed straight into the table; saved when you click away / press Enter
      return `<td class="${cls} m-edt"><div class="m-ed" contenteditable="plaintext-only" spellcheck="false" data-k="${f.k}"${f.k === 'maxPct' ? ` data-ph="${SLAB_SET.maxPct}"` : f.k === 'from' ? ' data-ph="always"' : ''}>${escapeHtml(txt)}</div>${tag}</td>`;
    return `<td${cls ? ` class="${cls}"` : ''}${f.calc ? ` data-calc="${f.k}"` : ''}>${escapeHtml(txt)}${f.k === 'maxPct' && txt === '' ? `<span class="muted">${SLAB_SET.maxPct}</span>` : ''}${tag}</td>`;
  };
  const colPx = smartColWidths(def, shown.map(x => x.r));
  const actPx = admin ? (masterTab === 'slab' ? 170 : 84) : 0;
  table.style.minWidth = (def.fields.reduce((t, f) => t + colPx(f), 0) + actPx) + 'px';
  table.innerHTML = `<colgroup>${def.fields.map(f => `<col style="width:${colPx(f)}px">`).join('')}${admin ? `<col style="width:${actPx}px">` : ''}</colgroup>
    <thead><tr>${def.fields.map((f, ci) => `<th class="${f.num || f.k === 'max' ? 'num' : ''}">${escapeHtml(f.label || hdr(f))}<span class="col-grip" data-ci="${ci}" data-k="${f.k}" title="Drag to resize · double-click to fit"></span></th>`).join('')}${admin ? '<th></th>' : ''}</tr></thead>
    <tbody>${shown.map(({ r, i }) => `<tr data-i="${i}">${def.fields.map(f => cell(f, r)).join('')}${admin ? `<td class="act">
        <button type="button" class="fill-btn" data-act="edit" title="Edit">✎</button>
        ${masterTab === 'slab' ? '<button type="button" class="fill-btn" data-act="newrate" title="New rate from today — keeps this one for older bills">＋ New rate</button>' : ''}
        <button type="button" class="fill-btn" data-act="del" title="Delete">🗑</button></td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${def.fields.length + 1}" style="color:var(--ink-soft);">${all.length ? 'Nothing matches.' : 'Nothing here yet.'}</td></tr>`}
    ${list.length > LIMIT ? `<tr><td colspan="${def.fields.length + 1}" style="color:var(--ink-soft);">… ${list.length - LIMIT} more — type to search.</td></tr>` : ''}</tbody>`;
  wireColGrips(table);
  if(admin) wireInlineEdit(table);
  table.querySelectorAll('tr[data-i]').forEach(tr => {
    const row = def.list()[+tr.dataset.i];
    tr.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      if(b.dataset.act === 'edit') openMasterForm(row);
      else if(b.dataset.act === 'del') deleteMasterRow(row);
      else if(b.dataset.act === 'newrate') openMasterForm(null, Object.assign({}, row, { from: fmtDate(new Date()), min: null, by: '', at: '' }));
    }));
  });
}
function openMasterForm(row, prefill){
  masterEdit = { row, draft: Object.assign({}, row || prefill || {}) };
  renderMasterForm();
  const f = document.getElementById('mForm'); if(f) f.scrollIntoView({ block: 'nearest' });
}
function renderMasterForm(){
  const def = MASTER_DEFS[masterTab], box = document.getElementById('mForm');
  if(!box || !masterEdit) return;
  const d = masterEdit.draft;
  box.innerHTML = `<div class="sync-form" style="max-width:none;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));display:grid;gap:10px 14px;background:var(--paper-raised);border:1px solid var(--gold);border-radius:4px;padding:14px;margin-bottom:12px;">
    ${def.fields.filter(f => !f.ro).map(f => `<label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--ink-soft);${f.wide || f.req && !f.w ? 'grid-column:span 2;' : ''}">${escapeHtml(f.label || hdr(f))}${f.req ? ' *' : ''}
      <input data-k="${f.k}"${masterTab === 'items' && f.k === 'category' ? ' list="mCatList"' : masterTab === 'items' && f.k === 'group' ? ' list="mGrpList"' : ''} value="${escapeHtml(d[f.k] === null || d[f.k] === undefined ? '' : String(d[f.k]))}" placeholder="${f.placeholder ? escapeHtml(f.placeholder()) : ''}"></label>`).join('')}
    ${masterTab === 'items' ? `<datalist id="mCatList">${categorySuggestions().map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist><datalist id="mGrpList">${itemCatSuggestions().map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>` : ''}
    <div style="grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <button type="button" class="bar-btn primary" id="mSave">${masterEdit.row ? 'Save changes' : 'Add'}</button>
      <button type="button" class="bar-btn" id="mCancel">Cancel</button>
      <span id="mMsg" class="sync-msg" style="margin:0;"></span>
    </div></div>`;
  box.querySelector('#mCancel').addEventListener('click', () => { masterEdit = null; box.innerHTML = ''; });
  box.querySelector('#mSave').addEventListener('click', () => {
    const draft = {};
    box.querySelectorAll('input[data-k]').forEach(i => { draft[i.dataset.k] = i.value.trim(); });
    const err = saveMasterRow(masterEdit.row, draft);
    const m = box.querySelector('#mMsg');
    if(err){ m.className = 'sync-msg bad'; m.textContent = '⚠ ' + err; return; }
    masterEdit = null;
    renderMasterPanel();
  });
  const first = box.querySelector('input[data-k]'); if(first && !masterEdit.row) first.focus();
}
// Checks and stores one row. Returns an error text, or null when saved.
function cleanMasterRow(draft){
  const def = MASTER_DEFS[masterTab], out = {};
  for(const f of def.fields){
    if(f.ro) continue;
    let v = draft[f.k] === undefined ? '' : String(draft[f.k]).trim();
    if(f.req && !v) return { err: `"${f.label || hdr(f)}" is required.` };
    if(f.num){
      const n = numOrNull(v);
      if(Number.isNaN(n)) return { err: `"${f.label || hdr(f)}" must be a number (got "${v}").` };
      out[f.k] = n;
    }else out[f.k] = v;
  }
  if(masterTab === 'slab'){
    if(out.min !== null && !(out.min > 0)) return { err: 'The minimum rate must be more than 0 (or blank).' };
    if(out.maxPct !== null && out.maxPct < 0) return { err: 'Max % cannot be negative.' };
    if(out.from && dateNum(out.from) === null) return { err: 'Effective from must be a date like 01-12-2026, or blank for "always".' };
    if(out.from){ const m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(out.from); out.from = pad2(+m[1]) + '-' + pad2(+m[2]) + '-' + m[3]; }
  }
  return { row: out };
}
function toSheetValues(row){
  const def = MASTER_DEFS[masterTab], v = {};
  def.fields.forEach(f => { if(!f.ro) v[hdr(f)] = row[f.k] === null || row[f.k] === undefined ? '' : row[f.k]; });
  if(masterTab === 'slab') v['Maximum rate (incl GST)'] = row.min > 0 ? slabMaxOf(row) : '';
  return v;
}
function saveMasterRow(original, draft){
  const def = MASTER_DEFS[masterTab];
  const c = cleanMasterRow(draft);
  if(c.err) return c.err;
  const row = c.row, list = def.list();
  const clash = list.find(r => r !== original && def.same(r, row));
  if(clash) return masterTab === 'slab' ? 'This item already has a rate with the same unit and start date — edit that one, or give a different "From" date.' : 'That name is already in the list — edit that row instead.';
  const matchKey = original ? def.key(original) : null;   // the sheet row is found by its key BEFORE this edit
  if(original){ Object.assign(original, row); if(masterTab === 'slab'){ original.by = MASTER_ALL.displayName || ''; original.at = fmtDateTime(new Date()); } }
  else list.push(Object.assign(row, masterTab === 'slab' ? { by: MASTER_ALL.displayName || '', at: fmtDateTime(new Date()) } : {}));
  queueOutbox({ type: 'rows', tab: def.tab(), rows: [{ match: matchKey, values: toSheetValues(original || row) }] });
  afterMasterChange();
  return null;
}
function deleteMasterRow(row){
  const def = MASTER_DEFS[masterTab];
  const name = row.name || row.item;
  if(!confirm(`Delete "${name}"${masterTab === 'slab' ? ` (${row.unit}${row.from ? ', from ' + row.from : ''})` : ''} from the ${def.label}?`)) return;
  const list = def.list();
  list.splice(list.indexOf(row), 1);
  queueOutbox({ type: 'delete', tab: def.tab(), matches: [def.key(row)] });
  afterMasterChange();
  renderMasterPanel();
}
function afterMasterChange(){
  _grpMap = null;
  idbSet('master', MASTER_ALL);
  applyMasterAll(false);
  recalcAllCards();
}
function openPasteBox(){
  const def = MASTER_DEFS[masterTab], box = document.getElementById('mForm');
  const cols = def.fields.filter(f => !f.ro);
  masterEdit = null;
  box.innerHTML = `<div style="background:var(--paper-raised);border:1px solid var(--gold);border-radius:4px;padding:14px;margin-bottom:12px;">
    <p class="desc" style="margin:0 0 8px;">Copy rows from Excel (or the Google Sheet) and paste them here — columns in this order:<br><b>${cols.map(f => escapeHtml(f.label || hdr(f))).join(' · ')}</b>. A header row is skipped. Rows whose ${masterTab === 'slab' ? 'item, unit and start date' : 'name'} already exist are updated.</p>
    <textarea id="mPasteText" style="width:100%;min-height:150px;font-family:'IBM Plex Mono',monospace;font-size:12px;"></textarea>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;"><button type="button" class="bar-btn primary" id="mPasteSave">Check &amp; save</button><button type="button" class="bar-btn" id="mPasteCancel">Cancel</button><span id="mPasteMsg" class="sync-msg" style="margin:0;"></span></div></div>`;
  box.querySelector('#mPasteCancel').addEventListener('click', () => { box.innerHTML = ''; });
  box.querySelector('#mPasteSave').addEventListener('click', () => {
    const msg = box.querySelector('#mPasteMsg');
    const text = box.querySelector('#mPasteText').value.replace(/\r/g, '');
    const lines = text.split('\n').filter(l => l.trim());
    if(!lines.length){ msg.className = 'sync-msg bad'; msg.textContent = 'Nothing pasted.'; return; }
    if(!lines.some(l => l.includes('\t'))){ msg.className = 'sync-msg bad'; msg.textContent = 'Copy the cells from Excel or Google Sheets so the columns are kept (tab-separated).'; return; }
    const cleaned = [], errors = [];
    lines.forEach((l, n) => {
      const cells = l.split('\t');
      if(n === 0 && normalize(cells[0]) === normalize(cols[0].label || hdr(cols[0]))) return;
      const draft = {}; cols.forEach((f, i) => draft[f.k] = cells[i] || '');
      const c = cleanMasterRow(draft);
      if(c.err) errors.push(`line ${n + 1}: ${c.err}`); else cleaned.push(c.row);
    });
    if(errors.length){ msg.className = 'sync-msg bad'; msg.textContent = `⚠ Nothing saved — ${errors.length} line(s) need fixing: ` + errors.slice(0, 3).join(' · ') + (errors.length > 3 ? ' …' : ''); return; }
    const list = def.list(), rowsOut = [];
    let added = 0, changed = 0;
    cleaned.forEach(row => {
      const ex = list.find(r => def.same(r, row));
      if(ex){ const key = def.key(ex); Object.assign(ex, row); rowsOut.push({ match: key, values: toSheetValues(ex) }); changed++; }
      else{ if(masterTab === 'slab') Object.assign(row, { by: MASTER_ALL.displayName || '', at: fmtDateTime(new Date()) }); list.push(row); rowsOut.push({ match: null, values: toSheetValues(row) }); added++; }
    });
    queueOutbox({ type: 'rows', tab: def.tab(), rows: rowsOut });
    afterMasterChange();
    renderMasterPanel();
    const m2 = document.getElementById('mForm');
    if(m2) m2.innerHTML = `<p class="sync-msg ok">✓ ${added} added, ${changed} updated — being saved to the sheet.</p>`;
  });
}
// ---- TallySync backup (.json) → Item master, Party master and bundle weights -------------------
const TS_CAT = {
  ekm: { sheet_pcs: 'sheet_pics', roll_mesh: 'roll_mesh', chainlink: 'roll_mesh', sqft: 'direct', kg_bundle: 'direct', kg_direct: 'direct', flat: 'direct_flat', flat_5: 'direct_5pct' },
  clt: { sheet_pcs: 'sheet', roll_mesh: 'roll', chainlink: 'roll', kg_bundle: 'directKg', kg_direct: 'directKg', flat: 'directNos', flat_5: 'direct5' },
};
// An item priced as a sheet or roll in TallySync but BILLED per sq.ft or kg is a direct item here:
// the bill's rate is already per sq.ft / kg, so no height × length multiplying.
function tsCategoryLabel(i, catMap){
  let key = catMap[i.cat];
  const u = unitKey(i.unit);
  if(['sqft', 'kg', 'sqmtr', 'mtr'].includes(u) && key && /sheet|roll/.test(key)) key = BRANCH.key === 'ekm' ? (u === 'kg' || u === 'sqft' ? 'direct' : 'direct_flat') : null;
  return key && rules[key] ? rules[key].label : '';
}
function readTallySyncBackup(file){
  const box = document.getElementById('mForm');
  const fr = new FileReader();
  fr.onload = () => {
    let d;
    try{ d = JSON.parse(fr.result); }catch(e){ box.innerHTML = `<p class="sync-msg bad">⚠ "${escapeHtml(file.name)}" is not a TallySync backup (not JSON).</p>`; return; }
    if(!d || (!Array.isArray(d.items) && !Array.isArray(d.parties))){ box.innerHTML = `<p class="sync-msg bad">⚠ "${escapeHtml(file.name)}" has no items or parties — is it the TallySync backup?</p>`; return; }
    showTallySyncPreview(d, file.name);
  };
  fr.readAsText(file);
}
function tsBundleNew(d){
  if(BRANCH.key !== 'ekm' || typeof bundleRules === 'undefined' || !Array.isArray(d.bundleRules)) return [];
  const have = new Set(bundleRules.map(r => normalizeForMatch(r.match)));
  return d.bundleRules.filter(r => r && r.match && isFinite(r.weight) && !have.has(normalizeForMatch(r.match)))
    .map(r => ({ label: String(r.label || r.match), match: normalizeForMatch(r.match), weight: +r.weight }));
}
function tsRuleDiffs(d){
  if(!d.rules) return [];
  const out = [];
  Object.keys(d.rules).forEach(k => {
    const key = (TS_CAT[BRANCH.key] || {})[k], mine = key && rules[key];
    if(!mine) return;
    const t = d.rules[k];
    const myTax = mine.tax !== undefined ? mine.tax : mine.taxPct;
    if(isFinite(t.tax) && +t.tax !== +myTax) out.push(`${t.label || k}: TallySync tax ${t.tax}% vs here ${myTax}%`);
    if(t.dim && isFinite(t.lengthFt) && mine.lengthFt && +t.lengthFt !== +mine.lengthFt && k !== 'chainlink') out.push(`${t.label || k}: TallySync length ${t.lengthFt} ft vs here ${mine.lengthFt} ft`);
  });
  return out;
}
function showTallySyncPreview(d, fileName){
  const box = document.getElementById('mForm');
  const s = d.settings || {};
  const items = Array.isArray(d.items) ? d.items.filter(i => i && i.name) : [];
  const parties = Array.isArray(d.parties) ? d.parties.filter(p => p && p.name) : [];
  const bNew = tsBundleNew(d), diffs = tsRuleDiffs(d);
  const otherBranch = s.gstin && !BRANCH.gstins[s.gstin];
  box.innerHTML = `<div style="background:var(--paper-raised);border:1px solid var(--gold);border-radius:4px;padding:14px 16px;margin-bottom:12px;font-size:13px;line-height:1.6;">
    <b>TallySync backup</b> · ${escapeHtml(fileName)}${s.company ? ` · ${escapeHtml(s.company)}` : ''}${s.gstin ? ` (${escapeHtml(s.gstin)})` : ''}<br>
    ${otherBranch ? `<span style="color:var(--red);">⚠ This backup's GSTIN is not one of ${escapeHtml(BRANCH.name)}'s — check you are on the right branch.</span><br>` : ''}
    Into <b>${escapeHtml(BRANCH.key === 'clt' ? 'Calicut · Kannur' : 'Ernakulam')}</b>. It only adds and fills empty cells — nothing typed in the sheet is overwritten. If TallySync has the same code under a new name (a rename in Tally), the new name becomes the item name and the old one is kept under "Other codes / spellings".
    <div style="margin:8px 0;">
      <label><input type="checkbox" id="tsItems" ${items.length ? 'checked' : 'disabled'}> ${items.length} items → Item master (code, name, category, unit, size, bundle kg, GST %, other spellings)</label><br>
      <label><input type="checkbox" id="tsParties" ${parties.length ? 'checked' : 'disabled'}> ${parties.length} parties → Party master (name, rate-sheet names, place)</label><br>
      <label><input type="checkbox" id="tsBundle" ${bNew.length ? 'checked' : 'disabled'}> ${bNew.length ? `${bNew.length} new bundle weight${bNew.length === 1 ? '' : 's'} → Rules (${bNew.map(b => escapeHtml(b.label) + ' ' + b.weight + ' kg').join(', ')})` : 'Bundle weights: nothing new'}</label>
    </div>
    <div style="color:var(--ink-soft);">Category rules: ${diffs.length ? '<span style="color:var(--amber);">differ — not changed, check them in Rules: ' + diffs.map(escapeHtml).join(' · ') + '</span>' : 'the same as here ✓ (tax %, sheet/roll lengths)'}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;"><button type="button" class="bar-btn primary" id="tsGo">Import</button><button type="button" class="bar-btn" id="tsCancel">Cancel</button><span id="tsMsg" class="sync-msg" style="margin:0;"></span></div>
  </div>`;
  box.querySelector('#tsCancel').addEventListener('click', () => { box.innerHTML = ''; });
  box.querySelector('#tsGo').addEventListener('click', async e => {
    const msg = box.querySelector('#tsMsg'), btn = e.currentTarget;
    btn.disabled = true;
    const report = [];
    try{
      if(box.querySelector('#tsItems').checked){
        msg.textContent = 'Importing items…';
        const codeCount = {};
        items.forEach(i => { const k = codeKey(i.code); if(k) codeCount[k] = (codeCount[k] || 0) + 1; });
        const catMap = TS_CAT[BRANCH.key] || {};
        const rowsOut = items.map(i => ({
          name: String(i.name).trim(),
          code: codeCount[codeKey(i.code)] === 1 ? String(i.code).trim() : null,
          values: { 'Code': i.code ? String(i.code).trim() : '', 'Category': tsCategoryLabel(i, catMap),
            'Unit': i.unit || '', 'Ht ft': i.h ?? '', 'Len ft': i.l ?? '', 'Bundle kg': i.bundle ?? '', 'GST %': i.gst ?? '' },
          lists: splitList(i.variants)
        }));
        const r = await api('importRows', { tab: BRANCH.key + 'Items', rows: rowsOut, opts: { source: 'TallySync' } });
        report.push(`Items: ${r.added} added, ${r.updated} filled in${r.renamed ? `, ${r.renamed} renamed` : ''}, ${r.unchanged} already complete`);
      }
      if(box.querySelector('#tsParties').checked){
        const chunk = 1200; let a = 0, u = 0, same = 0;
        for(let k = 0; k < parties.length; k += chunk){
          msg.textContent = `Importing parties… ${Math.min(k + chunk, parties.length)} / ${parties.length}`;
          const rowsOut = parties.slice(k, k + chunk).map(p => ({ name: String(p.name).trim(), values: { 'Place': p.place || '' }, lists: splitList(p.alias) }));
          const r = await api('importRows', { tab: BRANCH.key + 'Parties', rows: rowsOut, opts: { source: 'TallySync' } });
          a += r.added; u += r.updated; same += r.unchanged;
        }
        report.push(`Parties: ${a} added, ${u} filled in, ${same} already complete`);
      }
      if(box.querySelector('#tsBundle').checked && bNew.length){
        bNew.forEach(b => bundleRules.push(b));
        savePersisted();
        renderRulesPanel();
        report.push(`Bundle weights: ${bNew.length} added`);
      }
      msg.textContent = 'Syncing…';
      await fullSync();
      box.innerHTML = `<p class="sync-msg ok">✓ ${report.map(escapeHtml).join(' · ') || 'Nothing selected.'}</p>`;
      renderMasterPanel();
      const b2 = document.getElementById('mForm'); if(b2) b2.innerHTML = `<p class="sync-msg ok">✓ ${report.map(escapeHtml).join(' · ')}</p>`;
    }catch(err){
      msg.className = 'sync-msg bad'; msg.textContent = '⚠ ' + err.message + (report.length ? ' (done so far: ' + report.join(' · ') + ')' : '');
      btn.disabled = false;
    }
  });
}
function exportMaster(){
  const def = MASTER_DEFS[masterTab];
  const rows = [def.fields.map(f => f.label || hdr(f))].concat(def.list().map(r => def.fields.map(f => f.calc ? f.calc(r) : (r[f.k] ?? ''))));
  downloadCsv(rows, def.label.toLowerCase().replace(/\s+/g, '-') + '-' + fmtDate(new Date()) + '.csv');
}
// ---- Rate slab: settings + sheet check --------------------------------------------------------
function slabSettingsHtml(admin){
  return `<div class="row" style="gap:16px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:10px 12px;border:1px solid var(--rule);border-radius:4px;background:var(--paper-raised);font-size:12.5px;">
    <label>Default max % above the minimum <input id="ssPct" value="${SLAB_SET.maxPct}" style="width:56px;" ${admin ? '' : 'disabled'}></label>
    <label title="Rates are rounded to paise when GST is added; differences up to this are ignored">Rounding allowance ₹ <input id="ssTol" value="${SLAB_SET.tol}" style="width:56px;" ${admin ? '' : 'disabled'}></label>
    <label><input type="checkbox" id="ssBlock" ${SLAB_SET.missingBlocks ? 'checked' : ''} ${admin ? '' : 'disabled'}> A line with no slab keeps the bill from "Verified" (shows ❓)</label>
    ${admin ? '<button type="button" class="bar-btn" id="ssSave">Save settings</button><span id="ssMsg" class="sync-msg" style="margin:0;"></span>' : ''}
  </div>`;
}
function wireSlabSettings(){
  const b = document.getElementById('ssSave');
  if(!b) return;
  b.addEventListener('click', () => {
    const pct = numOrNull(document.getElementById('ssPct').value), tol = numOrNull(document.getElementById('ssTol').value);
    const m = document.getElementById('ssMsg');
    if(!(pct >= 0) || !(tol >= 0) || tol > 5){ m.className = 'sync-msg bad'; m.textContent = 'Max % must be 0 or more; the allowance between 0 and 5.'; return; }
    SLAB_SET = { maxPct: pct, tol, missingBlocks: document.getElementById('ssBlock').checked };
    MASTER_ALL.slabSettings = Object.assign({}, SLAB_SET);
    queueOutbox({ type: 'rules', branch: 'slab', rules: MASTER_ALL.slabSettings });
    afterMasterChange();
    renderMasterPanel();
  });
}
function slabChecksHtml(){
  const rows = MASTER_ALL.slab || [];
  const warn = [];
  const seen = new Map();
  rows.forEach(r => {
    const k = normalize(r.item) + '|' + unitKey(r.unit) + '|' + (r.from || '');
    if(seen.has(k)) warn.push(`"${r.item}" (${r.unit || 'no unit'}${r.from ? ', from ' + r.from : ''}) is listed twice.`);
    seen.set(k, r);
    if(!(r.min > 0)) warn.push(`"${r.item}" has no minimum rate.`);
    if(!r.unit) warn.push(`"${r.item}" has no unit — it is compared with any unit.`);
    if(r.from && dateNum(r.from) === null) warn.push(`"${r.item}" has an unreadable "Effective from" date "${r.from}".`);
  });
  const owner = new Map();
  rows.forEach(r => [r.item, ...splitList(r.other)].forEach(n => {
    const k = nameKey(n), o = owner.get(k);
    if(o && nameKey(o) !== nameKey(r.item)) warn.push(`The name "${n}" points to two items: "${o}" and "${r.item}".`);
    else owner.set(k, r.item);
  }));
  if(!warn.length) return '';
  const uniq = [...new Set(warn)];
  return `<div class="slab-gaps" style="margin-bottom:12px;"><b>Sheet check — ${uniq.length} thing${uniq.length === 1 ? '' : 's'} to fix:</b>${uniq.slice(0, 12).map(w => `<div>⚠ ${escapeHtml(w)}</div>`).join('')}${uniq.length > 12 ? `<div>… and ${uniq.length - 12} more</div>` : ''}</div>`;
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
  rulesToggle.title = (t.rulesToggle || 'Rules').replace(/^\S+\s/, '');
  codesToggle.title = (t.codesToggle || 'Codes').replace(/^\S+\s/, '');
  set('sideBranch', BRANCH.key === 'clt' ? 'CALICUT · KANNUR' : 'ERNAKULAM');
  applyTabTexts();
  set('sideFoot', APP_VERSION + ' · ' + (BRANCH.key === 'clt' ? 'Calicut · Kannur' : 'Ernakulam'));
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

// =====================================================================================
//  v8 — RATE SLAB (one safety slab for every branch, rates AFTER GST) and per-line checks
//  Every bill line ends as exactly one of: ✓ checked and fine · ✗ discrepancy · ❓ could not be
//  checked (no slab / different unit / slab not yet valid on the invoice date). Nothing is guessed:
//  a slab rate is found only by the exact Tally item name printed on the bill (or a spelling listed
//  on the slab row), in the same unit, valid on the invoice date.
// =====================================================================================
var SLAB = [];
var SLAB_SET = { maxPct: 15, tol: 0.01, missingBlocks: true };
var slabIdx = new Map(), slabNames = [];

function r2(x){ return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }
function fmtPct(p){ return (Math.abs(p) < 1 ? p.toFixed(2) : p.toFixed(1)) + '%'; }
// Units written many ways on bills and in the slab: compared on one spelling each.
function unitKey(u){
  const t = String(u || '').toLowerCase().replace(/[.\s]/g, '');
  if(!t) return '';
  if(/^(sqft|sft|sqfeet|squarefeet|sqfts)$/.test(t)) return 'sqft';
  if(/^(kg|kgs|kilo|kilogram|kilograms)$/.test(t)) return 'kg';
  if(/^(nos|no|pcs|pc|pics|pic|piece|pieces|number|numbers)$/.test(t)) return 'nos';
  if(/^(roll|rolls|rol)$/.test(t)) return 'roll';
  if(/^(bundle|bundles|bdl|bdls)$/.test(t)) return 'bundle';
  if(/^(mtr|mtrs|m|meter|meters|metre|metres|rmt)$/.test(t)) return 'mtr';
  if(/^(sqmtr|sqm|sqmt|sqmeter|sqmetre|sqmtrs)$/.test(t)) return 'sqmtr';
  if(/^(ft|feet|rft|runningfeet)$/.test(t)) return 'ft';
  if(/^(box|boxes)$/.test(t)) return 'box';
  if(/^(set|sets)$/.test(t)) return 'set';
  return t;
}
// "DD-MM-YYYY" → 20261125 for comparing; blank = valid from the start (0); unreadable → null.
function dateNum(s){
  const t = String(s || '').trim();
  if(!t) return 0;
  const m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(t);
  return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : null;
}
function todayNum(){ const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

function setSlab(rows, settings){
  SLAB = (rows || []).filter(r => r && r.item);
  if(settings){
    if(isFinite(settings.maxPct)) SLAB_SET.maxPct = +settings.maxPct;
    if(isFinite(settings.tol)) SLAB_SET.tol = +settings.tol;
    if(typeof settings.missingBlocks === 'boolean') SLAB_SET.missingBlocks = settings.missingBlocks;
  }
  slabIdx = new Map();
  SLAB.forEach(r => {
    [r.item, ...splitList(r.other)].forEach(n => {
      const k = nameKey(n);
      if(!k) return;
      if(!slabIdx.has(k)) slabIdx.set(k, []);
      if(!slabIdx.get(k).includes(r)) slabIdx.get(k).push(r);
    });
  });
  slabNames = [...slabIdx.keys()];
}
function slabMaxOf(r){
  const pct = (r.maxPct !== null && r.maxPct !== undefined && r.maxPct !== '' && isFinite(r.maxPct)) ? +r.maxPct : SLAB_SET.maxPct;
  return r2(r.min * (1 + pct / 100));
}
// Bills print long names cut short: a description that is the start of exactly ONE slab item counts.
function slabCandidates(desc){
  const k = nameKey(desc);
  if(!k) return [];
  if(slabIdx.has(k)) return slabIdx.get(k);
  if(k.length < 16) return [];
  const hits = new Set();
  slabNames.forEach(n => { if(n.length > k.length && n.startsWith(k)) slabIdx.get(n).forEach(r => hits.add(r)); });
  const items = new Set([...hits].map(r => nameKey(r.item)));
  return items.size === 1 ? [...hits] : [];
}
function gstForLine(row, s){
  if(s && s.gst !== null && s.gst !== undefined && isFinite(s.gst)) return +s.gst;
  const mi = typeof masterSingleForDescription === 'function' ? masterSingleForDescription(row.description) : null;
  if(mi && mi.gst !== null && mi.gst !== undefined && isFinite(mi.gst)) return +mi.gst;
  const cat = rules[row.category];
  if(cat && isFinite(cat.tax)) return +cat.tax;
  if(cat && isFinite(cat.taxPct)) return +cat.taxPct;
  return 18;
}
// The slab rate follows the item's rate rule, like the loading-list rate: sheets and rolls are
// rated per sq.ft, so for a bill per piece / roll the slab becomes rate × height × length (the
// height and length from the item master or the bill, the default length from Rules).
function slabConversion(row){
  const keys = BRANCH.categoryKeys || {};
  if(!(row.category && (row.category === keys.sheet || row.category === keys.roll))) return null;
  const uk = unitKey(row.unit);
  if(uk === 'sqft' || uk === 'kg') return null;          // already billed per sq.ft
  const rule = rules[row.category] || {};
  const L = (row.customLengthFt !== null && row.customLengthFt !== undefined && row.customLengthFt !== '' && !isNaN(row.customLengthFt)) ? +row.customLengthFt : +rule.lengthFt;
  const H = row.heightFt !== null && row.heightFt !== undefined && row.heightFt !== '' ? +row.heightFt : NaN;
  if(!(H > 0) || !(L > 0)) return { missing: true };
  return { factor: H * L, H, L };
}
function slabFor(row, record, result){
  if(!SLAB.length) return null;
  const unitTxt = row.unit || 'unit';
  const cands = slabCandidates(row.description);
  if(!cands.length) return { status: 'none', gap: true, message: 'No rate slab for this item — add it in Rate slab.' };
  const uk = unitKey(row.unit);
  const conv = slabConversion(row);
  const keys = BRANCH.categoryKeys || {}, sheetRoll = row.category && (row.category === keys.sheet || row.category === keys.roll);
  // Sheet / roll items: the slab is per sq.ft whatever unit was typed (PCS, ROLL, sq.ft).
  const sameUnit = cands.filter(r => !unitKey(r.unit) || unitKey(r.unit) === uk || (sheetRoll && ['sqft', 'nos', 'roll'].includes(unitKey(r.unit))));
  if(!sameUnit.length) return { status: 'unit', gap: true, message: `Rate slab is per ${cands[0].unit}, bill is per ${unitTxt} — can't compare.` };
  let d = dateNum(record.parsed.invoiceDate);
  if(!d) d = todayNum();
  const valid = sameUnit.filter(r => { const f = dateNum(r.from); return f !== null && f <= d; });
  if(!valid.length){
    const firstFrom = sameUnit.map(r => r.from).filter(Boolean).sort((a, b) => dateNum(a) - dateNum(b))[0];
    return { status: 'notyet', gap: true, message: `Rate slab starts ${firstFrom || '(unreadable date)'}, after this bill's date.` };
  }
  const latest = Math.max(...valid.map(r => dateNum(r.from)));
  const pick = valid.filter(r => dateNum(r.from) === latest);
  if(new Set(pick.map(r => nameKey(r.item))).size > 1)
    return { status: 'ambiguous', gap: true, message: 'Two rate slab items share this name — fix the "Other names" in Rate slab.' };
  const s = pick[pick.length - 1];
  if(s.min === null || s.min === undefined || !isFinite(s.min)) return { status: 'none', gap: true, message: 'The rate slab row for this item has no minimum rate.' };

  if(conv && conv.missing) return { status: 'none', gap: true, message: `The rate slab is per sq.ft but this ${unitTxt} has no height/length — set them in the Item master.` };
  const g = gstForLine(row, s);
  const billedIncl = r2(row.rate * (1 + g / 100));
  const f = conv ? conv.factor : 1;
  const min = r2(s.min * f), max = r2(slabMaxOf(s) * f);
  const basis = conv ? ` (₹${fmt(r2(s.min))}–${fmt(slabMaxOf(s))}/sq.ft × ${fmtQty(conv.H)} × ${fmtQty(conv.L)} ft)` : '';
  const tol = SLAB_SET.tol;
  const qty = Number(row.quantity) || 0;
  const out = { status: 'ok', gap: false, gst: g, billedIncl, min, max, unit: unitTxt, slab: s, diff: 0, pct: 0, total: 0, basis, conv };
  if(billedIncl < min - tol - 1e-9){
    out.status = 'below'; out.diff = r2(min - billedIncl); out.pct = out.diff / min * 100; out.total = r2(out.diff * qty);
    out.message = `Below rate slab: billed ₹${fmt(billedIncl)} vs minimum ₹${fmt(min)} per ${unitTxt}${basis} (incl GST ${g}%) — ₹${fmt(out.diff)} less (${fmtPct(out.pct)}) · loss ₹${fmt(out.total)} on ${fmtQty(qty)} ${unitTxt}`;
  }else if(billedIncl > max + tol + 1e-9){
    out.status = 'above'; out.diff = r2(billedIncl - max); out.pct = out.diff / max * 100; out.total = r2(out.diff * qty);
    out.message = `Above rate slab: billed ₹${fmt(billedIncl)} vs maximum ₹${fmt(max)} per ${unitTxt}${basis} (incl GST ${g}%) — ₹${fmt(out.diff)} more (${fmtPct(out.pct)}) · ₹${fmt(out.total)} on ${fmtQty(qty)} ${unitTxt}`;
  }
  // The loading-list rate itself below the slab: the order was wrong, not only the bill.
  if(result && result.expectedRate !== null && result.expectedRate !== undefined){
    out.planIncl = r2(result.expectedRate * (1 + g / 100));
    if(out.planIncl < min - tol - 1e-9) out.planNote = `Loading-list rate ₹${fmt(out.planIncl)} (incl GST) is itself below the slab minimum ₹${fmt(min)} — ₹${fmt(r2(min - out.planIncl))} less (${fmtPct((min - out.planIncl) / min * 100)})`;
  }
  return out;
}

const LOCAL_RESULT = { flagged: false, pending: false, expectedRate: null, qtyMismatch: false, rateMismatch: false, otherIssues: [], infoNotes: [] };
function lineCheck(row, record){
  const result = record.local ? LOCAL_RESULT : computeRow(row);
  const slab = slabFor(row, record, result);
  const slabFlag = !!slab && (slab.status === 'below' || slab.status === 'above');
  const issues = [];
  if(slabFlag) issues.push(slab.message);
  if(!record.local && result.flagged){
    if(result.rateMismatch) issues.push(result.rateWarning);
    if(result.qtyMismatch) issues.push(result.qtyWarning);
    if(result.bundleWarning) issues.push(result.bundleWarning);
    if(result.itemMismatch) issues.push(result.itemMismatchWarning);
    if(result.notDispatched) issues.push(result.notDispatchedWarning);
    (result.otherIssues || []).forEach(x => issues.push(x));
  }
  const flagged = slabFlag || (!record.local && !!result.flagged);
  if(flagged && slab && slab.planNote) issues.push(slab.planNote);
  return { result, slab, flagged, issues, slabGap: !!(slab && slab.gap) };
}
// "after GST" wording for the loading-list rate check, used by both branches' formulas.
function gstRateWarning(row, expectedRate, taxPct){
  const k = 1 + (Number(taxPct) || 0) / 100;
  const b = r2(row.rate * k), e = r2(expectedRate * k), diff = r2(b - e);
  const pct = e !== 0 ? Math.abs(diff / e * 100) : 0;
  const qty = Number(row.quantity) || 0;
  return `Billed ₹${fmt(b)} vs loading list ₹${fmt(e)} per ${row.unit || 'unit'} (incl GST) — ${diff > 0 ? 'over' : 'short'} by ₹${fmt(Math.abs(diff))} (${fmtPct(pct)}) · ₹${fmt(r2(Math.abs(diff) * qty))} on ${fmtQty(qty)} ${row.unit || ''}`.trim();
}
function gatherSlabGaps(record){
  const out = [];
  record.items.forEach(row => { const sl = lineCheck(row, record).slab; if(sl && sl.gap) out.push(`${row.description}: ${sl.message}`); });
  return out;
}
function renderSlabCell(tr, sl){
  const cell = tr.querySelector('[data-field="slab"]');
  if(!cell) return;
  cell.className = 'num slab-cell';
  if(!sl){ cell.innerHTML = '—'; cell.title = SLAB.length ? '' : 'The rate slab is empty'; return; }
  if(sl.gap){ cell.classList.add('gap'); cell.innerHTML = '<span class="shot-hide">❓</span>'; cell.title = sl.message; return; }
  const range = `<span class="sl-range">${fmt(sl.min)} – ${fmt(sl.max)}</span>`;
  if(sl.status === 'ok'){ cell.classList.add('ok'); cell.innerHTML = `✓ ${fmt(sl.billedIncl)}${range}`; }
  else{ cell.classList.add('bad'); cell.innerHTML = `${sl.status === 'below' ? '▼' : '▲'} ${fmt(sl.billedIncl)}${range}`; }
  cell.title = `Billed ${fmt(sl.billedIncl)} incl GST ${sl.gst}% · slab ${fmt(sl.min)} – ${fmt(sl.max)} per ${sl.unit}${sl.basis || ''}`;
}
function updateSlabStatus(){
  const el = document.getElementById('slabStatus');
  if(el) el.textContent = SLAB.length ? `💰 Rate slab: ${new Set(SLAB.map(r => nameKey(r.item))).size} items · max +${SLAB_SET.maxPct}%` : '💰 Rate slab is empty — slab check is off';
  const nav = (id, n) => { const e = document.getElementById(id); if(e) e.textContent = n ? String(n) : ''; };
  nav('navItems', MASTER.items.length);
  try{ const ni = MASTER_ALL && MASTER_ALL.branches && MASTER_ALL.branches[BRANCH.key] ? MASTER_ALL.branches[BRANCH.key].items.filter(r => masterNeeds('items', r).length).length : 0;
    const e = document.getElementById('navItems'); if(e && ni) e.innerHTML = `${MASTER.items.length} · <span class="nc-need" title="${ni} items need attention">⚠${ni}</span>`; }catch(err){} nav('navParties', MASTER.parties.length);
  nav('navSlab', new Set(SLAB.map(r => nameKey(r.item))).size);
  nav('navBills', window.__records.filter(r => !r.local).length + window.__skipped.filter(x => !x.local).length);
  nav('navLocal', window.__records.filter(r => r.local).length + window.__skipped.filter(x => x.local).length);
}
function recalcAllCards(){
  document.querySelectorAll('.invoice-card').forEach(c => recalcCard(c));
  renderOverview();
}

// =====================================================================================
//  v8 — ONE-CLICK WHATSAPP PICTURE
//  The picture is DRAWN from the bill's data (not a screen capture), so nothing is ever cut off:
//  party, invoice, every discrepancy in words, every line with billed / slab / loading-list rates
//  (all incl GST), the loss, and who checked it when. Copied to the clipboard → Ctrl+V in WhatsApp.
// =====================================================================================
const WA = { W: 1000, PAD: 34, scale: 2,
  ink: '#1E2A38', soft: '#5D6B78', rule: '#D9DEE3', red: '#B3261E', redBg: '#FBEAE8', amber: '#9A5B00', amberBg: '#FFF4DF', green: '#1E7B45', greenBg: '#E6F4EC' };
function waAccent(){ return getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#A9832E'; }
function waWrap(ctx, text, maxW){
  const out = [];
  String(text || '').split('\n').forEach(par => {
    const words = par.split(/\s+/);
    let line = '';
    words.forEach(w => {
      const t = line ? line + ' ' + w : w;
      if(ctx.measureText(t).width <= maxW || !line){
        if(ctx.measureText(t).width > maxW && !line){   // one very long word: cut it
          let cut = w; while(cut.length > 1 && ctx.measureText(cut).width > maxW) cut = cut.slice(0, -1);
          out.push(cut); line = w.slice(cut.length);
        }else line = t;
      }else{ out.push(line); line = w; }
    });
    out.push(line);
  });
  return out;
}
function waCanvas(heightGuess){
  const c = document.createElement('canvas');
  c.width = WA.W * WA.scale; c.height = Math.min(30000, heightGuess * WA.scale);
  const ctx = c.getContext('2d');
  ctx.scale(WA.scale, WA.scale);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, WA.W, heightGuess);
  ctx.textBaseline = 'top';
  return { c, ctx };
}
function waCrop(c, h){
  const out = document.createElement('canvas');
  out.width = c.width; out.height = Math.ceil(h * WA.scale);
  out.getContext('2d').drawImage(c, 0, 0);
  return out;
}
function waHeader(ctx, title, stampText, stampKind){
  ctx.fillStyle = waAccent(); ctx.fillRect(0, 0, WA.W, 58);
  ctx.fillStyle = '#FFFFFF'; ctx.font = '600 15px "IBM Plex Mono", monospace';
  ctx.fillText(title, WA.PAD, 21);
  if(stampText){
    ctx.font = '700 15px Inter, sans-serif';
    const w = ctx.measureText(stampText).width + 28;
    const col = stampKind === 'ok' ? WA.green : stampKind === 'bad' ? WA.red : WA.amber;
    ctx.fillStyle = '#FFFFFF'; waRound(ctx, WA.W - WA.PAD - w, 12, w, 34, 6); ctx.fill();
    ctx.fillStyle = col; ctx.fillText(stampText, WA.W - WA.PAD - w + 14, 21);
  }
  return 58;
}
function waRound(ctx, x, y, w, h, r){
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function waBox(ctx, y, lines, kind, head){
  const fg = kind === 'bad' ? WA.red : WA.amber, bg = kind === 'bad' ? WA.redBg : WA.amberBg;
  const innerW = WA.W - WA.PAD * 2 - 28;
  ctx.font = '500 15px Inter, sans-serif';
  const wrapped = lines.map(l => waWrap(ctx, '• ' + l, innerW));
  const h = 18 + (head ? 26 : 0) + wrapped.reduce((t, w) => t + w.length * 21 + 5, 0) + 10;
  ctx.fillStyle = bg; waRound(ctx, WA.PAD, y, WA.W - WA.PAD * 2, h, 6); ctx.fill();
  ctx.strokeStyle = fg; ctx.lineWidth = 1.5; ctx.stroke();
  let yy = y + 14;
  if(head){ ctx.fillStyle = fg; ctx.font = '700 17px Inter, sans-serif'; ctx.fillText(head, WA.PAD + 14, yy); yy += 26; }
  ctx.font = '500 15px Inter, sans-serif'; ctx.fillStyle = kind === 'bad' ? '#7A1A14' : '#6B4200';
  wrapped.forEach(w => { w.forEach(t => { ctx.fillText(t, WA.PAD + 14, yy); yy += 21; }); yy += 5; });
  return y + h + 14;
}
// What other people see (WhatsApp pictures, discrepancy log): a missing slab rate is only a note
// for the person checking, so a bill whose only open point is that counts as verified.
function shareKind(r){ return r.statusKind === 'slab' ? 'verified' : r.statusKind; }
function waStamp(record){
  const k = shareKind(record);
  if(k === 'verified') return ['VERIFIED ✓', 'ok'];
  if(k === 'discrepancy') return [`DISCREPANCY (${record.currentDiscrepancyCount || 0})`, 'bad'];
  if(k === 'slab') return ['SLAB MISSING ❓', 'warn'];
  if(k === 'readcheck') return ['CHECK THE READ', 'warn'];
  if(k === 'name') return ['CUSTOMER NOT PICKED', 'warn'];
  return ['AWAITING RATES', 'warn'];
}
function drawBillImage(record){
  const local = !!record.local;
  const rowsData = record.items.map(row => {
    const lc = lineCheck(row, record), sl = lc.slab, res = lc.result;
    const g = sl && sl.gst !== undefined ? sl.gst : gstForLine(row, null);
    const billed = sl && sl.billedIncl !== undefined ? sl.billedIncl : r2(row.rate * (1 + g / 100));
    const plan = !local && res.expectedRate !== null && res.expectedRate !== undefined ? r2(res.expectedRate * (1 + g / 100)) : null;
    const mark = lc.flagged ? '✗' : (res.pending && !res.qtyMismatch) ? '…' : '✓';
    return { row, sl, billed, plan, mark, flagged: lc.flagged, gap: false };   // missing slab: not shown in the picture
  });
  const { c, ctx } = waCanvas(1400 + record.items.length * 90 + 60 * gatherBillDiscrepancies(record).length);
  const [stampText, stampKind] = waStamp(record);
  let y = waHeader(ctx, `INVOICE AUDIT · ${(BRANCH.key === 'clt' ? 'CALICUT · KANNUR' : 'ERNAKULAM')}${local ? ' · LOCAL SALE' : ''}`, stampText, stampKind) + 22;
  // party + invoice
  ctx.fillStyle = WA.ink; ctx.font = '700 26px Fraunces, Georgia, serif';
  waWrap(ctx, record.parsed.partyName || record.filename, WA.W - WA.PAD * 2).forEach(t => { ctx.fillText(t, WA.PAD, y); y += 33; });
  ctx.font = '500 15px "IBM Plex Mono", monospace'; ctx.fillStyle = WA.soft;
  const sub = [record.parsed.invoiceNumber || 'No invoice no', record.parsed.invoiceDate || 'no date', local ? 'Local sale — checked against the rate slab' : (record.selectedBlockName ? 'Loading list: ' + record.selectedBlockName : 'Loading list: not matched')].join('  ·  ');
  waWrap(ctx, sub, WA.W - WA.PAD * 2).forEach(t => { ctx.fillText(t, WA.PAD, y); y += 21; });
  y += 14;
  // what is wrong, in words
  const issues = gatherBillDiscrepancies(record), gaps = [];
  if(issues.length) y = waBox(ctx, y, issues, 'bad', `⚠ ${issues.length} discrepanc${issues.length === 1 ? 'y' : 'ies'}${record.slabLoss > 0 ? `  ·  Loss vs rate slab ₹${fmt(record.slabLoss)}` : ''}`);
  if(gaps.length) y = waBox(ctx, y, gaps, 'warn', '❓ Not checked — no rate slab');
  if(!issues.length && shareKind(record) === 'verified'){
    ctx.fillStyle = WA.greenBg; waRound(ctx, WA.PAD, y, WA.W - WA.PAD * 2, 44, 6); ctx.fill();
    ctx.fillStyle = WA.green; ctx.font = '700 17px Inter, sans-serif'; ctx.fillText('✓ Every line checked — rates within the slab' + (local ? '' : ' and the loading list'), WA.PAD + 14, y + 13);
    y += 58;
  }
  // line table
  const cols = local
    ? [['#', 34, 'l'], ['Item', 0, 'l'], ['Qty', 118, 'r'], ['Billed ₹', 104, 'r'], ['Slab min – max ₹', 170, 'r'], ['', 34, 'c']]
    : [['#', 34, 'l'], ['Item', 0, 'l'], ['Qty', 112, 'r'], ['Billed ₹', 98, 'r'], ['Loading list ₹', 112, 'r'], ['Slab min – max ₹', 158, 'r'], ['', 34, 'c']];
  const fixed = cols.reduce((t, c2) => t + c2[1], 0) + (cols.length - 1) * 10;
  cols[1][1] = WA.W - WA.PAD * 2 - fixed;
  const xs = []; let x = WA.PAD; cols.forEach(c2 => { xs.push(x); x += c2[1] + 10; });
  const cellText = (i, txt, yy, font, color) => {
    ctx.font = font; ctx.fillStyle = color;
    const [, w, al] = cols[i];
    const tw = ctx.measureText(txt).width;
    ctx.fillText(txt, al === 'r' ? xs[i] + w - tw : al === 'c' ? xs[i] + (w - tw) / 2 : xs[i], yy);
  };
  ctx.fillStyle = '#EEF1F4'; ctx.fillRect(WA.PAD - 8, y, WA.W - WA.PAD * 2 + 16, 30);
  cols.forEach((c2, i) => cellText(i, c2[0], y + 8, '700 12.5px Inter, sans-serif', WA.soft));
  ctx.font = '500 12px Inter, sans-serif'; ctx.fillStyle = WA.soft;
  y += 30;
  rowsData.forEach((d, n) => {
    ctx.font = '500 15px Inter, sans-serif';
    const nameLines = waWrap(ctx, d.row.description, cols[1][1]);
    const h = Math.max(1, nameLines.length) * 20 + 16;
    if(d.flagged || d.gap){ ctx.fillStyle = d.flagged ? WA.redBg : WA.amberBg; ctx.fillRect(WA.PAD - 8, y, WA.W - WA.PAD * 2 + 16, h); }
    ctx.strokeStyle = WA.rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(WA.PAD - 8, y + h); ctx.lineTo(WA.W - WA.PAD + 8, y + h); ctx.stroke();
    const col = d.flagged ? WA.red : d.gap ? WA.amber : WA.ink;
    cellText(0, String(n + 1), y + 8, '500 14px "IBM Plex Mono", monospace', WA.soft);
    nameLines.forEach((t, k) => cellText(1, t, y + 8 + k * 20, '500 15px Inter, sans-serif', WA.ink));
    cellText(2, `${fmtQty(d.row.quantity)} ${d.row.unit || ''}`.trim(), y + 8, '500 14px "IBM Plex Mono", monospace', WA.ink);
    const belowOrAbove = d.sl && (d.sl.status === 'below' || d.sl.status === 'above');
    cellText(3, fmt(d.billed), y + 8, `${belowOrAbove ? 700 : 500} 14px "IBM Plex Mono", monospace`, belowOrAbove ? WA.red : WA.ink);
    let ci = 4;
    if(!local){ cellText(4, d.plan !== null ? fmt(d.plan) : '—', y + 8, '500 14px "IBM Plex Mono", monospace', WA.ink); ci = 5; }
    const slabTxt = !d.sl || d.sl.gap ? '—' : `${fmt(d.sl.min)} – ${fmt(d.sl.max)}`;
    cellText(ci, slabTxt, y + 8, '500 14px "IBM Plex Mono", monospace', WA.soft);
    if(d.sl && (d.sl.status === 'below' || d.sl.status === 'above'))
      cellText(ci, `${d.sl.status === 'below' ? '▼' : '▲'} ₹${fmt(d.sl.diff)} (${fmtPct(d.sl.pct)})`, y + 28, '700 12.5px Inter, sans-serif', WA.red);
    cellText(ci + 1, d.mark, y + 6, '700 18px Inter, sans-serif', col);
    y += Math.max(h, d.sl && (d.sl.status === 'below' || d.sl.status === 'above') ? 48 : h);
  });
  y += 12;
  ctx.font = '500 13px Inter, sans-serif'; ctx.fillStyle = WA.soft;
  ctx.fillText('All rates per unit, including GST.', WA.PAD, y);
  // totals
  const tot = [];
  const lines = record.items.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  tot.push(['Taxable value', '₹' + fmt(record.parsed.taxableTotal !== null && record.parsed.taxableTotal !== undefined ? record.parsed.taxableTotal : lines)]);
  if(record.parsed.grandTotal !== null && record.parsed.grandTotal !== undefined) tot.push(['Bill total (incl GST)', '₹' + fmt(record.parsed.grandTotal)]);
  if(record.slabLoss > 0) tot.push(['Loss vs rate slab', '₹' + fmt(record.slabLoss)]);
  tot.forEach(([k, v], i) => {
    ctx.font = (i === tot.length - 1 && record.slabLoss > 0 ? '700 ' : '600 ') + '16px Inter, sans-serif';
    ctx.fillStyle = k === 'Loss vs rate slab' ? WA.red : WA.ink;
    const vw = ctx.measureText(v).width;
    ctx.fillText(k, WA.W - WA.PAD - 360, y); ctx.fillText(v, WA.W - WA.PAD - vw, y);
    y += 26;
  });
  y += 14;
  ctx.strokeStyle = WA.rule; ctx.beginPath(); ctx.moveTo(WA.PAD, y); ctx.lineTo(WA.W - WA.PAD, y); ctx.stroke();
  y += 12;
  ctx.font = '500 12.5px "IBM Plex Mono", monospace'; ctx.fillStyle = WA.soft;
  const who = (syncSaved().displayName || syncSaved().user || '');
  ctx.fillText(`Checked${who ? ' by ' + who : ''} · ${fmtDateTime(new Date())} · Invoice Audit ${APP_VERSION} · read from the Tally PDF`, WA.PAD, y);
  y += 30;
  return waCrop(c, y);
}
function drawDayImage(){
  const recs = tabRecords().sort((a, b) => a.seq - b.seq);
  const skipped = window.__skipped.filter(s => s.kind === 'failed' && inTab(s));
  const { c, ctx } = waCanvas(400 + recs.length * 64 + skipped.length * 40);
  let y = waHeader(ctx, `INVOICE AUDIT · ${(BRANCH.key === 'clt' ? 'CALICUT · KANNUR' : 'ERNAKULAM')} · ${currentView === 'local' ? 'LOCAL SALES' : 'DISPATCH LIST'} · DAY SUMMARY`, fmtDate(new Date()), 'ok') + 22;
  const n = k => recs.filter(r => shareKind(r) === k).length;
  const loss = recs.reduce((t, r) => t + (r.slabLoss || 0), 0);
  ctx.fillStyle = WA.ink; ctx.font = '700 24px Fraunces, Georgia, serif';
  ctx.fillText(`${recs.length} bill${recs.length === 1 ? '' : 's'} checked · ${n('verified')} verified · ${n('discrepancy')} with discrepancies`, WA.PAD, y); y += 34;
  ctx.font = '500 15px Inter, sans-serif'; ctx.fillStyle = loss > 0 ? WA.red : WA.soft;
  ctx.fillText(loss > 0 ? `Total loss against the rate slab: ₹${fmt(loss)}` : 'No bill below the rate slab.', WA.PAD, y); y += 22;
  const pend = recs.length - n('verified') - n('discrepancy');
  if(pend || skipped.length){ ctx.fillStyle = WA.amber; ctx.fillText(`${pend ? pend + ' still pending a check' : ''}${pend && skipped.length ? ' · ' : ''}${skipped.length ? skipped.length + ' file(s) could not be read' : ''}`, WA.PAD, y); y += 22; }
  y += 12;
  recs.forEach(r => {
    const [st, kind] = waStamp(r);
    const col = kind === 'ok' ? WA.green : kind === 'bad' ? WA.red : WA.amber;
    ctx.font = '600 16px Inter, sans-serif';
    const party = waWrap(ctx, `#${r.seq}  ${r.parsed.partyName || r.filename}`, WA.W - WA.PAD * 2 - 260)[0];
    ctx.fillStyle = WA.ink; ctx.fillText(party, WA.PAD, y);
    ctx.font = '700 13.5px Inter, sans-serif'; ctx.fillStyle = col;
    const sw = ctx.measureText(st).width; ctx.fillText(st, WA.W - WA.PAD - sw, y + 2);
    y += 22;
    ctx.font = '500 13px "IBM Plex Mono", monospace'; ctx.fillStyle = WA.soft;
    const first = gatherBillDiscrepancies(r)[0];
    const sub = [r.parsed.invoiceNumber || '', r.local ? 'Local sale' : '', r.slabLoss > 0 ? 'Loss ₹' + fmt(r.slabLoss) : '', first ? first : ''].filter(Boolean).join(' · ');
    waWrap(ctx, sub, WA.W - WA.PAD * 2).slice(0, 2).forEach(t => { ctx.fillText(t, WA.PAD + 30, y); y += 18; });
    y += 10;
    ctx.strokeStyle = WA.rule; ctx.beginPath(); ctx.moveTo(WA.PAD, y - 4); ctx.lineTo(WA.W - WA.PAD, y - 4); ctx.stroke();
    y += 6;
  });
  skipped.forEach(s => {
    ctx.font = '600 14px Inter, sans-serif'; ctx.fillStyle = WA.red;
    ctx.fillText(waWrap(ctx, `#${s.seq}  ${s.filename} — not read (${s.code})`, WA.W - WA.PAD * 2)[0], WA.PAD, y); y += 26;
  });
  y += 10;
  ctx.font = '500 12.5px "IBM Plex Mono", monospace'; ctx.fillStyle = WA.soft;
  ctx.fillText(`${fmtDateTime(new Date())} · Invoice Audit ${APP_VERSION}`, WA.PAD, y);
  return waCrop(c, y + 30);
}
// Copy → Ctrl+V in WhatsApp. Where the browser won't allow copying a picture, it is saved instead.
async function copyCanvasToClipboard(makeCanvas, btn, fileName){
  const original = btn.textContent;
  const done = t => { btn.textContent = t; setTimeout(() => { btn.textContent = original; }, 2600); };
  try{ if(document.fonts && document.fonts.ready) await document.fonts.ready; }catch(e){}
  const canvas = makeCanvas();
  const blobP = new Promise(res => canvas.toBlob(res, 'image/png'));
  window.__lastWaCanvas = canvas;
  try{
    if(navigator.clipboard && window.ClipboardItem){
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]);
      done('✓ Copied — paste in WhatsApp (Ctrl+V)');
      return 'copied';
    }
  }catch(e){ console.warn('[whatsapp] copy refused, saving instead', e); }
  const blob = await blobP;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  done('⬇ Saved as a picture');
  return 'saved';
}
function copyBillImage(record, btn){
  const name = (record.parsed.invoiceNumber || record.filename).replace(/[^\w.-]+/g, '_') + '.png';
  return copyCanvasToClipboard(() => drawBillImage(record), btn, name);
}

// ---- Start ---------------------------------------------------------------------------------------
(async function bootV7(){
  applyBranchTexts();
  document.getElementById('syncNowBtn').addEventListener('click', () => fullSync());
  initLockScreen();
  await loadPersisted();                         // this browser's rules, log, parser report
  try{ outbox = (await idbGet('outbox')) || []; }catch(e){ outbox = []; }
  try{ MASTER_ALL = (await idbGet('master')) || null; }catch(e){ MASTER_ALL = null; }
  lastRulesJson = rulesJsonNow();
  applyMasterAll(false);                         // last synced copy, until the sync below finishes
  updateSheetLinks();
  await restoreSession();                        // yesterday's / this morning's work, if not cleared
  updateSyncStatus();
  initPwa();
  if(syncCfg()) fullSync();                      // once per opening
})();

