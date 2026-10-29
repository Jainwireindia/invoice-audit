// =====================================================================================
//  BRANCH FORMULAS — CALICUT · KANNUR (CLT / KNR)
//  Everything between this line and "END BRANCH FORMULAS" is specific to the Calicut-style
//  billing used by Calicut and Kannur: how the loading plan is read, how bills are matched to
//  it, and how the expected quantity and rate are worked out. Everything outside this block is
//  the shared tool, identical in every branch's file.
//
//  HOW THIS BILLING DIFFERS FROM ERNAKULAM
//  The loading plan gives quantity as a COUNT OF PIECES ("nos"), not sq.ft. The bill converts
//  that count to square feet using the item's own size:
//     SHEETS   billed sq.ft = nos × L × H          e.g. 10 nos of 12x4 -> 480 sq.ft
//     ROLLS    billed sq.ft = nos × 50ft × width   e.g.  2 nos of 4ft   -> 400 sq.ft
//     DIRECT   billed qty   = nos as written       (perf sheet, PVC mesh, net, wire)
//  Because the size is already in the QUANTITY, the rate check is a plain comparison:
//     expected rate = plan rate ÷ 1.18  (÷ 1.05 for velcro / shade net), rounded to the
//     category's decimals — plan rates are tax-inclusive.
//
//  READING THE PLAN SHORTHAND
//     Sheet:  1x1x12x4 4mm lite   aperture 1x1 · 12ft × 4ft · thickness code "4mm lite"
//     Roll:   1x1x10x4 lite       aperture 1x1 · 10 gauge · 4ft wide · lite
//  A SHEET always carries an "Nmm" token after the dimensions; a ROLL never does. That token is
//  the only thing separating the two, because the third number means feet on a sheet and gauge
//  on a roll. If a plan row is written without it, it reads as a roll — the Category dropdown on
//  the line switches it back.
//
//  Kannur bills under the Ernakulam GSTIN but uses this same sq.ft billing, so both GSTINs are
//  accepted here and each bill shows which one it came from.
// =====================================================================================
const BRANCH = {
  key: 'clt',
  name: 'Calicut · Kannur',
  storagePrefix: 'jainwire.clt.',
  gstins: { '32BLMPJ2728L1ZX': 'Calicut', '32AAFFJ6260N1Z6': 'Kannur (EKM GSTIN)' },
  descMaxChars: 0,          // keep bill descriptions in full — sizes sit at the end
  qtyFollowsCategory: true, // switching Sheet/Roll/Direct re-derives the expected sq.ft
  categoryKeys: { sheet: 'sheet', roll: 'roll', five: 'direct5', kg: 'directKg', nos: 'directNos' },
  text: {
    eyebrow: 'Calicut · Kannur · Loading Plan · Audit',
    lede: "Drop today's loading plan, then all the bill PDFs at once. Plan quantities are in pieces and are converted to the billed sq.ft from each item's size. The Bill overview lists every file with its status, so you can work through what needs attention and jump straight to it. Each bill is matched to its plan party automatically when the name is clear — you only pick or type anything where it isn't sure.",
    rulesToggle: '⚙ Rules and tolerances (tax %, lengths, ₹ tolerances)',
    codesToggle: '📖 Aperture & wire thickness codes',
    excelMain: "Drop today's loading plan here",
    excelSub: '.xlsx — party name on its own row, then item, nos, rate',
    footerNote: 'Calicut and Kannur bills are both accepted (Calicut and Ernakulam GSTINs). Items are recognised from the CLT Items tab of the Google Sheet, then from the plan shorthand.',
  },
};

// ---- Pricing categories --------------------------------------------------------------
// The category decides the tax rate, the fallback length, how the expected rate is rounded, and
// how much slack the quantity and rate checks allow. lengthFt is a FALLBACK: a plan row carries
// its own size ("2x2x12x4" is a 12ft × 4ft sheet) and that always wins. 12 and 50 are used only
// when a row doesn't state one — normal for rolls (a standard coil), rare for sheets.
const defaultRules = {
  sheet:     { label: 'Sheet mesh (nos → sq.ft)',        formula: 'nos × length × height · round(rate ÷ tax, 2)', lengthFt: 12,   taxPct: 18, decimals: 2, tolRate: 0.02, tolQty: 0.5  },
  roll:      { label: 'Roll mesh (nos → sq.ft)',         formula: 'nos × length × width · round(rate ÷ tax, 2)',  lengthFt: 50,   taxPct: 18, decimals: 2, tolRate: 0.02, tolQty: 0.5  },
  directKg:  { label: 'Direct (KG)',                     formula: 'qty as listed · round(rate ÷ tax, 2)',          lengthFt: null, taxPct: 18, decimals: 2, tolRate: 0.05, tolQty: 0.05 },
  directNos: { label: 'Direct, flat rate (NOS)',         formula: 'qty as listed · round(rate ÷ tax, 0)',          lengthFt: null, taxPct: 18, decimals: 0, tolRate: 1.00, tolQty: 0.01 },
  direct5:   { label: 'Direct, 5% (Velcro / Shade Net)', formula: 'qty as listed · round(rate ÷ tax, 0)',          lengthFt: null, taxPct: 5,  decimals: 0, tolRate: 1.00, tolQty: 0.01 },
};
let rules = JSON.parse(JSON.stringify(defaultRules));
const DEFAULT_CLT_SETTINGS = {
  fivePctKeywords: ['velcro', 'shade net', 'shadenet', 'shade-net'],
  tolAmount: 1.00   // ₹ on a line's amount
};
let cltSettings = JSON.parse(JSON.stringify(DEFAULT_CLT_SETTINGS));

// ---- Code tables ---------------------------------------------------------------------
// Aperture code -> the millimetre pair Tally prints. A code may have more than one: sheet 2x2 is
// 65×65 on the thin grades and 60×60 on the 7mm.
const DEFAULT_APERTURE = {
  sheet: { '1x1': [[40,40]], '2x2': [[65,65],[60,60]], '4x1': [[110,36]] },
  roll:  { '1x1': [[40,40]], '2x2': [[60,60]], '1/2x1/2': [[17,17]], '1x1/2': [[40,20]] }
};
// Wire thickness per code, each confirmed on a real CLT bill where plan rate and billed rate
// agreed to the paisa. Sheets keyed by the printed code (with any product qualifier in front,
// because "diamond 5mm" is a different wire from plain "5mm"); rolls keyed aperture|gauge|lite,
// because the same gauge lands on a different wire depending on the aperture.
const DEFAULT_THICKNESS = {
  sheet: { '4mm lite': 3.0, '5mm': 4.1, '5mm lite': 3.8, '6mm lite': 4.5, '7mm': 6.8, 'diamond 5mm': 4.3 },
  roll: {
    '1x1|8|': 2.9, '1x1|8|lite': 2.6, '1x1|10|': 2.3, '1x1|10|lite': 2.1,
    '2x2|8|': 2.9, '2x2|10|': 2.3, '1x1/2|10|': 2.3,
    '1/2x1/2|8|lite': 2.2, '1/2x1/2|10|': 2.0, '1/2x1/2|10|lite': 1.9, '1/2x1/2|12|lite': 1.6, '1/2x1/2|14|': 1.4
  }
};
let apertureTable = JSON.parse(JSON.stringify(DEFAULT_APERTURE));
let thicknessTable = JSON.parse(JSON.stringify(DEFAULT_THICKNESS));

// ---- Small helpers -------------------------------------------------------------------
function alnum(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
// Ordinary half-up rounding. Not ceiling: a plan rate of 19 works out to 16.1017 and Tally
// prints 16.10, so rounding up would disagree with the bill.
function roundTo(n, dp){
  const d = (dp == null || !isFinite(dp)) ? 2 : Math.max(0, Math.min(6, Math.round(dp)));
  const f = Math.pow(10, d);
  return Math.round((n + Number.EPSILON) * f) / f;
}
function cltBigrams(s){ const out = []; for(let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; }
// Dice coefficient on character bigrams (multiset).
function cltDice(a, b){
  if(!a || !b) return 0;
  if(a === b) return 1;
  const A = cltBigrams(a), B = cltBigrams(b);
  if(!A.length || !B.length) return 0;
  const pool = B.slice(); let hits = 0;
  for(const g of A){ const i = pool.indexOf(g); if(i >= 0){ pool.splice(i, 1); hits++; } }
  return (2 * hits) / (A.length + B.length);
}
function unitClass(unit){
  const u = String(unit || '').toLowerCase();
  if(u.indexOf('sq') >= 0) return 'sqft';
  if(u.indexOf('kg') >= 0) return 'kg';
  return 'nos';
}
function isFivePct(text){
  const name = String(text || '').toLowerCase();
  return (cltSettings.fivePctKeywords || []).some(k => { const key = String(k).trim().toLowerCase(); return key && name.indexOf(key) >= 0; });
}

// ---- Plan shorthand -> structured spec ---------------------------------------------------
// The four-part dimension token is searched for anywhere in the name, not just at the start —
// "DIAMOND 1x1x12x5 5mm" is a diamond sheet with an ordinary 12x5 spec behind it.
function parsePlanSpec(rawName){
  const name = String(rawName || '').trim();
  const s = name.toLowerCase().replace(/[\u00d7\u2715]/g, 'x');
  // Second plan style: "Diamond 65x65x4.1mm 12x5" (aperture x aperture x thickness mm, then length x height)
  const m2 = s.match(/(\d+(?:\/\d+)?)\s*x\s*(\d+(?:\/\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*mm\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
  if(m2){
    const q2 = s.slice(0, m2.index).replace(/[^a-z ]+/g, ' ').trim().replace(/\s+/g, ' ');
    const rest2 = s.slice(m2.index + m2[0].length);
    const lite2 = /\blite\b/.test(rest2), heavy2 = /\bheavy\b/.test(rest2);
    return {
      kind: 'sheet', label: name, ap: m2[1] + 'x' + m2[2], lite: lite2, heavy: heavy2,
      asSheet: { L: parseFloat(m2[4]), H: parseFloat(m2[5]), thickCode: (q2 ? q2 + ' ' : '') + m2[3] + 'mm' + (lite2 ? ' lite' : heavy2 ? ' heavy' : '') },
      asRoll: { gauge: parseFloat(m2[4]), widthFt: parseFloat(m2[5]) }
    };
  }
  const m = s.match(/(\d+(?:\/\d+)?)\s*x\s*(\d+(?:\/\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
  if(!m) return { kind: 'other', label: name };
  const n3 = parseFloat(m[3]), n4 = parseFloat(m[4]);
  const rest = s.slice(m.index + m[0].length).trim();
  const qualifier = s.slice(0, m.index).replace(/[^a-z ]+/g, ' ').trim().replace(/\s+/g, ' ');
  const mmTok = rest.match(/(\d+(?:\.\d+)?)\s*mm/);
  const lite = /\blite\b/.test(rest), heavy = /\bheavy\b/.test(rest);
  return {
    kind: mmTok ? 'sheet' : 'roll', label: name, ap: m[1] + 'x' + m[2], lite, heavy,
    asSheet: { L: n3, H: n4, thickCode: mmTok ? ((qualifier ? qualifier + ' ' : '') + mmTok[1] + 'mm' + (lite ? ' lite' : heavy ? ' heavy' : '')) : null },
    asRoll: { gauge: n3, widthFt: n4 }
  };
}
// ---- Bill description -> structured spec --------------------------------------------------
// "Mesh" is optional: Tally writes "Gi Sheet Mesh 40mm x 40mm 3.0mm 12x5" for ordinary stock but
// "Diamond Sheet 40mm x 40mm 4.3mm 12x5" for diamond — the same shape of item, priced the same way.
function parseBillSpec(desc){
  // Tally sometimes prints the size as 12×5 (multiplication sign) instead of 12x5.
  const t = String(desc || '').replace(/[\u00d7\u2715]/g, 'x').replace(/\s+/g, ' ').trim();
  const m = t.match(/\b(sheet|roll)(?:\s+mesh)?\s+(\d+(?:\.\d+)?)\s*mm\s*x\s*(\d+(?:\.\d+)?)\s*mm\s+(\d+(?:\.\d+)?)\s*mm\s+(\S+)/i);
  if(!m) return { kind: 'other', raw: t };
  const kind = m[1].toLowerCase();
  const ap = [parseFloat(m[2]), parseFloat(m[3])];
  const thick = parseFloat(m[4]);
  const tail = m[5];
  if(kind === 'sheet'){
    const d = tail.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
    return { kind: 'sheet', raw: t, ap, thick, L: d ? parseFloat(d[1]) : null, H: d ? parseFloat(d[2]) : null };
  }
  const w = tail.match(/^(\d+(?:\.\d+)?)\s*ft$/i);
  return { kind: 'roll', raw: t, ap, thick, widthFt: w ? parseFloat(w[1]) : null };
}
function knownThickness(spec, kind){
  if(kind === 'sheet'){
    const code = spec.asSheet.thickCode;
    return (code && thicknessTable.sheet[code] != null) ? thicknessTable.sheet[code] : null;
  }
  const key = spec.ap + '|' + spec.asRoll.gauge + '|' + (spec.lite ? 'lite' : '');
  return thicknessTable.roll[key] != null ? thicknessTable.roll[key] : null;
}

// ---- Bill line setup (called once per line when a bill is read) --------------------------
function guessCategory(unit, description){
  const spec = parseBillSpec(description);
  if(spec.kind === 'sheet' || spec.kind === 'roll') return spec.kind;
  if(isFivePct(description)) return 'direct5';
  return unitClass(unit) === 'kg' ? 'directKg' : 'directNos';
}
function guessHeightFt(description){
  const spec = parseBillSpec(description);
  if(spec.kind === 'sheet') return spec.H;
  if(spec.kind === 'roll') return spec.widthFt;
  return null;
}
function branchInitRow(row){
  row.spec = parseBillSpec(row.description);
  // A sheet's length comes from its own size ("12x5"); a roll's from the category default (50ft).
  if(row.spec.kind === 'sheet' && row.spec.L) row.customLengthFt = row.spec.L;
}

// ---- Reading the loading plan -------------------------------------------------------------
// Blocks separated by blank rows. A row whose name has a number immediately to its right (nos)
// or one further (rate) is an item; any other row carrying a name starts a new party. Column
// letters are not assumed — the first text cell is the item name.
function parseExcelWorkbook(arrayBuffer){
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if(!ws) throw new Error('the workbook has no readable sheet');
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const blocks = [];
  let cur = null;
  const isNum = s => /^-?[\d.,]+$/.test(s) && isFinite(parseFloat(String(s).replace(/,/g, '')));
  const val = s => parseFloat(String(s).replace(/,/g, ''));
  aoa.forEach((row, i) => {
    const cells = (row || []).map(c => (c == null ? '' : String(c).trim()));
    const filled = cells.map((c, ci) => ({ c, ci })).filter(o => o.c !== '');
    if(!filled.length) return;
    const texts = filled.filter(o => !isNum(o.c));
    if(!texts.length) return;
    // Identified by POSITION: the two cells right of the name hold nos and rate. Either being a
    // number is enough — a row ordered at 0 often has no rate typed yet, and requiring both made
    // it read as a party header that swallowed the items below it.
    const ti = texts[0].ci;
    const qtyCell = cells[ti + 1] == null ? '' : cells[ti + 1];
    const rateCell = cells[ti + 2] == null ? '' : cells[ti + 2];
    if(isNum(qtyCell) || isNum(rateCell)){
      if(!cur){ cur = { customerName: '(unnamed block)', rows: [] }; blocks.push(cur); }
      cur.rows.push({
        code: texts[0].c,
        qty: isNum(qtyCell) ? val(qtyCell) : 0,
        // A missing rate stays null, so the line reads "awaiting a rate" rather than being
        // compared against a rate that was never quoted.
        rate: isNum(rateCell) ? val(rateCell) : null,
        excelRow: i + 1,
        spec: parsePlanSpec(texts[0].c)
      });
    }else{
      cur = { customerName: texts.map(t => t.c).join(' '), rows: [] };
      blocks.push(cur);
    }
  });
  const out = blocks.filter(b => b.rows.length);
  // A plan row ordered as 0 was never meant to go out: it's not expected on the bill, and if it
  // IS billed it's flagged as billed-but-not-ordered.
  out.forEach(b => {
    b.activeRows = b.rows.filter(r => r.qty > 0);
    b.skippedRows = b.rows.filter(r => !(r.qty > 0));
  });
  return { blocks: out };
}

// ---- Party matching ------------------------------------------------------------------------
const PARTY_STOPWORDS = new Set([
  'traders','trader','trading','corporation','corp','co','company','steels','steel',
  'building','materials','material','enterprises','enterprise','and','the','hardware',
  'pkd','mlpm','ekm','clt','knr','tvm','ph','road','private','limited','ltd'
]);
function partyTokens(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter(w => w.length > 1 && !PARTY_STOPWORDS.has(w) && !/^\d+$/.test(w));
}
// Two views, best wins: token containment handles a bill name padded with a postal address;
// whole-string dice handles a name broken up by full stops ("K.V.R.Traders").
function partyScore(planName, billName){
  const pt = partyTokens(planName), bt = partyTokens(billName);
  let tokenScore = 0;
  if(pt.length && bt.length){
    let sum = 0;
    pt.forEach(p => { let best = 0; bt.forEach(b => { const d = cltDice(p, b); if(d > best) best = d; }); sum += best; });
    tokenScore = sum / pt.length;
  }
  return Math.max(tokenScore, cltDice(alnum(planName), alnum(billName)));
}
// When the overall score is too close to call, a token that matches exactly ONE plan party and no
// other can still settle it ("CV Steels, Nallalam" vs "CV STEELS PARAMBIL BAZAR").
function distinctiveTokenBlock(billName, blocks){
  const bt = partyTokens(billName);
  if(!bt.length) return null;
  const blockTokens = blocks.map(b => partyTokens(b.customerName));
  let found = null;
  for(const tok of bt){
    const hits = [];
    blockTokens.forEach((toks, i) => { if(toks.some(t => cltDice(t, tok) >= 0.9)) hits.push(i); });
    if(hits.length === 1){
      if(found !== null && found !== hits[0]) return null;
      found = hits[0];
    }
  }
  return found;
}
function guessBestBlock(buyerName, blocks){
  const scored = blocks.map((b, i) => ({ i, s: partyScore(b.customerName, buyerName) })).sort((a, b) => b.s - a.s);
  const best = scored[0], runner = scored[1];
  if(best && best.s >= 0.55 && (!runner || best.s - runner.s >= 0.12)){
    blocks[best.i]._matchNote = null;
    return blocks[best.i];
  }
  const pick = distinctiveTokenBlock(buyerName, blocks);
  const pickScore = pick != null ? (scored.find(c => c.i === pick) || { s: 0 }).s : 0;
  if(pick != null && pickScore >= 0.25){
    blocks[pick]._matchNote = 'matched on one distinctive word only — check it';
    return blocks[pick];
  }
  return null;
}

// ---- Item matching -------------------------------------------------------------------------
// Score one plan row against one bill line, 0–100. Structural facts carry the match; quantity and
// rate only nudge the non-mesh items. Mesh is never matched on its numbers, so a wrong rate can't
// disguise itself as a different product.
function scorePlanRow(planRow, billSpec, qty, rate, unit){
  // The item list (Google Sheet) settles it when it knows both the bill's Tally item name and the
  // plan code: same item → certain match, two different items → never a match.
  const rel = billSpec && billSpec.raw ? masterCodeRelation(billSpec.raw, planRow.code) : null;
  if(rel === 'same') return 100;
  if(rel === 'different') return 0;
  const ps = planRow.spec || parsePlanSpec(planRow.code);
  const pk = ps.kind, bk = billSpec.kind;
  if(pk === 'other' || bk === 'other'){
    if(pk !== 'other' || bk !== 'other') return 0;
    let s = cltDice(alnum(ps.label), alnum(billSpec.raw)) * 100;
    if(qty != null && Math.abs(qty - planRow.qty) < 0.005) s += 12;
    if(rate != null && planRow.rate != null){
      const cat = isFivePct(ps.label) ? 'direct5' : (unitClass(unit) === 'kg' ? 'directKg' : 'directNos');
      if(Math.abs(rate - planRow.rate / (1 + (rules[cat].taxPct || 0) / 100)) <= 0.05) s += 8;
    }
    return Math.min(100, s);
  }
  if(pk !== bk) return 0;
  let s = 40;
  // Diamond sheet ordered, plain sheet billed (or the other way round): same size, different
  // product. Kept as a weak pairing so qty and rate still fill in, but shown as an item mismatch.
  if(diamondClash(ps, billSpec)) s -= 30;
  const alts = (apertureTable[pk] || {})[ps.ap];
  const mmAp = apertureInMm(ps.ap);
  if(alts && alts.length){
    if(alts.some(a => a[0] === billSpec.ap[0] && a[1] === billSpec.ap[1])) s += 25;
    else return 0;                    // a confident rejection, not a guess
  }else if(mmAp){
    // Plan written in millimetres ("Diamond 65x65x4.1mm 12x5"): compare with the bill directly.
    if(mmAp[0] === billSpec.ap[0] && mmAp[1] === billSpec.ap[1]) s += 25;
    else return 0;
  }else{
    s += 10;                          // unknown code: neither vouch nor block
  }
  if(pk === 'sheet'){
    const L = ps.asSheet.L, H = ps.asSheet.H;
    if((L === billSpec.L && H === billSpec.H) || (L === billSpec.H && H === billSpec.L)) s += 25; else return 0;
  }else{
    if(ps.asRoll.widthFt === billSpec.widthFt) s += 25; else return 0;
  }
  const known = knownThickness(ps, pk);
  if(known != null && billSpec.thick != null){
    if(Math.abs(known - billSpec.thick) <= 0.06) s += 10; else s -= 12;
  }
  return Math.max(0, Math.min(100, s));
}
// "65x65" is already millimetres (inch codes like 1x1, 2x2, 1/2x1/2 are never 10 or more).
function apertureInMm(ap){
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(String(ap || ''));
  if(!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[2]);
  return a >= 10 && b >= 10 ? [a, b] : null;
}
function matchBarFor(planRow){ return (planRow.spec || parsePlanSpec(planRow.code)).kind !== 'other' ? 85 : 45; }

function assignExcelRowsToBillLines(record, block){
  const candidates = [
    ...block.activeRows.map(r => ({ row: r, skipped: false })),
    ...(block.skippedRows || []).map(r => ({ row: r, skipped: true })),
  ];
  const assignment = new Array(record.items.length).fill(null);
  const pairs = [];
  candidates.forEach((c, ci) => record.items.forEach((it, li) => {
    const s = scorePlanRow(c.row, it.spec || parseBillSpec(it.description), it.quantity, it.rate, it.unit);
    if(s > 0) pairs.push({ ci, li, s });
  }));
  pairs.sort((a, b) => b.s - a.s);
  const takenC = new Set(), takenL = new Set();
  const byLine = {};
  pairs.forEach(p => { (byLine[p.li] = byLine[p.li] || []).push(p); });
  // Pass 1 — confident, unambiguous assignments.
  pairs.forEach(p => {
    if(takenC.has(p.ci) || takenL.has(p.li)) return;
    const runner = (byLine[p.li] || []).find(q => q !== p && !takenC.has(q.ci));
    const margin = runner ? p.s - runner.s : 99;
    if(p.s >= matchBarFor(candidates[p.ci].row) && margin >= 8){
      takenC.add(p.ci); takenL.add(p.li); assignment[p.li] = p.ci;
    }
  });
  // Pass 2 — a line left with exactly one surviving candidate is assigned too; its hint shows
  // the plan row without the "✓ matches" tick, so it gets looked at.
  record.items.forEach((it, li) => {
    if(takenL.has(li)) return;
    const arr = (byLine[li] || []).filter(q => !takenC.has(q.ci));
    if(arr.length === 1){ takenC.add(arr[0].ci); takenL.add(li); assignment[li] = arr[0].ci; }
  });
  return { assignment, candidates };
}

// 'match' / 'mismatch' / null for one plan row against one bill description — drives the hint
// under each line and the "did you mean" suggestion.
function diamondClash(ps, billSpec){
  const planDiamond = /\b(diamond|dimond|dimoand|diamon)\b/i.test(ps.label || '');
  const billDiamond = /\bdiamond\b/i.test(billSpec.raw || '');
  return planDiamond !== billDiamond;
}
function matchExcelRowToDescription(exRow, description){
  if(!exRow) return null;
  const rel = masterCodeRelation(description, exRow.code);
  if(rel === 'same') return 'match';
  if(rel === 'different') return 'mismatch';
  const spec = parseBillSpec(description);
  const ps0 = exRow.spec || parsePlanSpec(exRow.code);
  if(ps0.kind !== 'other' && ps0.kind === spec.kind && diamondClash(ps0, spec) && scorePlanRow(exRow, spec, null, null, null) > 0) return 'mismatch';
  const s = scorePlanRow(exRow, spec, null, null, null);
  const ps = exRow.spec || parsePlanSpec(exRow.code);
  if(s >= matchBarFor(exRow)) return 'match';
  if(s === 0 && (ps.kind !== 'other' || spec.kind !== 'other')) return 'mismatch';
  return null;
}

// Plain-language decode of a plan code, shown next to matched lines and in pick lists.
function findCodeLabel(code){
  const mi = masterSingleForCode(code);
  if(mi && mi.name) return mi.name;
  const ps = parsePlanSpec(code);
  if(ps.kind === 'other') return null;
  const ap = (apertureTable[ps.kind] || {})[ps.ap];
  const mmAp = apertureInMm(ps.ap);
  const apTxt = ap && ap.length ? ap.map(p => p[0] + '×' + p[1]).join(' or ') + 'mm' : mmAp ? mmAp[0] + '×' + mmAp[1] + 'mm' : ps.ap + ' (aperture not in table)';
  const th = knownThickness(ps, ps.kind);
  if(ps.kind === 'sheet'){
    return `Sheet ${apTxt} · ${ps.asSheet.L}×${ps.asSheet.H} ft${th != null ? ' · ' + th + 'mm wire' : ''}`;
  }
  return `Roll ${apTxt} · ${ps.asRoll.widthFt}ft wide · ${ps.asRoll.gauge}g${ps.lite ? ' lite' : ''}${th != null ? ' · ' + th + 'mm wire' : ''}`;
}

// Lines the matching left unassigned that still look like a 0-qty plan row: flagged as billed
// although nothing was ordered.
function checkNotDispatchedButBilled(record, block){
  if(!block.skippedRows || !block.skippedRows.length) return;
  block.skippedRows.forEach(skipped => {
    record.items.forEach(row => {
      if(row.excelCode || row.notDispatchedButBilled) return;
      if(matchExcelRowToDescription(skipped, row.description) === 'match'){
        row.notDispatchedButBilled = true;
        row.notDispatchedCode = skipped.code;
      }
    });
  });
}

// ---- Expected quantity: plan pieces -> billed units -----------------------------------------
// Called when a line is matched to a plan row and again whenever its Category, Height or Length
// changes. The first time a line meets a given plan row it takes that row's own size and type;
// after that, whatever has been typed into the line is respected.
function convertExcelQtyToBilledUnit(nos, row, planRow){
  if(nos === null || nos === undefined || isNaN(nos)) return null;
  if(planRow && row._sizedFor !== planRow.code){
    row._sizedFor = planRow.code;
    const ps = planRow.spec || parsePlanSpec(planRow.code);
    row.planSpec = ps;
    // The item list (Google Sheet) knows this plan code's size: use it before reading the shorthand.
    const mi = masterSingleForCode(planRow.code);
    const miCat = mi ? mapMasterCategory(mi.category, row.unit) : null;
    if(mi && (miCat === 'sheet' || miCat === 'roll') && mi.ht != null){
      row.category = miCat; row.heightFt = mi.ht;
      row.customLengthFt = miCat === 'sheet' ? (mi.len != null ? mi.len : rules.sheet.lengthFt) : (mi.len != null && mi.len !== rules.roll.lengthFt ? mi.len : null);
    }
    else if(mi && miCat && miCat !== 'sheet' && miCat !== 'roll'){ row.category = miCat; }
    else if(ps.kind === 'sheet'){ row.category = 'sheet'; row.heightFt = ps.asSheet.H; row.customLengthFt = ps.asSheet.L; }
    else if(ps.kind === 'roll'){ row.category = 'roll'; row.heightFt = ps.asRoll.widthFt; row.customLengthFt = null; }
    else if((row.category === 'sheet' || row.category === 'roll') && row.heightFt != null){ /* plan name unreadable: keep the size read from the bill line */ }
    else{ row.category = isFivePct(ps.label) ? 'direct5' : (unitClass(row.unit) === 'kg' ? 'directKg' : 'directNos'); }
  }
  row.planNos = nos;
  if(row.category === 'sheet' || row.category === 'roll'){
    const H = row.heightFt;
    const L = (row.customLengthFt !== null && row.customLengthFt !== '' && !isNaN(row.customLengthFt)) ? row.customLengthFt : (rules[row.category] || {}).lengthFt;
    if(H == null || isNaN(H) || L == null || isNaN(L)) return null;   // size unknown: type it in
    return nos * L * H;
  }
  return nos;
}

// ---- Parser calibration (column bands measured off real CLT bills) ---------------------------
// Items are placed by their MIDPOINT, not their left edge: the numeric columns are right-aligned,
// so an unusually wide figure grows leftward and would leave its band if only the left edge
// were tested. The midpoint stays put however wide the number gets.
const DET_COLS = { slno:[0,40], desc:[40,330], hsn:[330,382], qty:[382,440], rate:[440,483], per:[483,512], amt:[512,99999] };
function detColOf(it){
  const x = it.x + (it.w || 0) / 2;
  for(const name in DET_COLS){ const [lo, hi] = DET_COLS[name]; if(x >= lo && x < hi) return name; }
  return null;
}

// ---- The line check ------------------------------------------------------------------------
function computeRow(row){
  const cat = rules[row.category] || rules.directNos;
  const divisor = 1 + (cat.taxPct || 0) / 100;
  const quoted = (row.quotedRate !== null && row.quotedRate !== '' && !isNaN(row.quotedRate)) ? row.quotedRate : null;
  // Expected rate shown and compared at the category's decimals; the amount check keeps the
  // unrounded figure, because that's what Tally multiplies by.
  const rawRate = quoted !== null ? quoted / divisor : null;
  const expectedRate = rawRate !== null ? roundTo(rawRate, cat.decimals) : null;
  const expectedAmount = expectedRate !== null ? expectedRate * row.quantity : null;

  const rateMismatch = expectedRate !== null && Math.abs(row.rate - expectedRate) > (cat.tolRate || 0) + 1e-9;
  let rateWarning = null;
  if(rateMismatch){
    const diff = row.rate - expectedRate;
    const pct = expectedRate !== 0 ? Math.abs(diff / expectedRate * 100) : 0;
    rateWarning = `Billed ₹${fmt(row.rate)} vs expected ₹${fmt(expectedRate)} — ${diff > 0 ? 'over' : 'short'} by ₹${fmt(Math.abs(diff))} (${pct.toFixed(1)}%)`;
  }

  let qtyMismatch = false, qtyWarning = null;
  if(!row.notDispatchedButBilled && row.orderedQty !== null && row.orderedQty !== '' && !isNaN(row.orderedQty)){
    if(Math.abs(row.orderedQty - row.quantity) > (cat.tolQty || 0) + 1e-9){
      qtyMismatch = true;
      qtyWarning = `Actual qty ${fmtQty(row.orderedQty)}, billed qty is ${fmtQty(row.quantity)}`;
    }
  }

  // Line amount vs expected qty × unrounded rate. Only raised on its own — when the qty or rate is
  // already flagged, the amount being off is the same problem said twice.
  const otherIssues = [];
  if(!rateMismatch && !qtyMismatch && !row.notDispatchedButBilled && rawRate !== null && row.orderedQty !== null && !isNaN(row.orderedQty)){
    const expAmt = row.orderedQty * rawRate;
    const tol = Math.max(cltSettings.tolAmount || 0, row.orderedQty * 0.005);
    if(Math.abs(row.amount - expAmt) > tol) otherIssues.push(`Amount ₹${fmt(row.amount)} vs expected ₹${fmt(expAmt)}`);
  }

  // Notes that inform rather than accuse.
  const infoNotes = [];
  const bs = row.spec || {};
  if(bs.kind === 'sheet' && bs.ap && bs.ap[0] === 60 && bs.ap[1] === 60) infoNotes.push('60×60 aperture');
  if(row.planSpec && row.planSpec.kind === bs.kind && bs.kind !== 'other'){
    const known = knownThickness(row.planSpec, bs.kind);
    if(known != null && bs.thick != null && Math.abs(known - bs.thick) > 0.06) infoNotes.push(`billed ${bs.thick}mm, code table says ${known}mm`);
  }
  if((row.category === 'sheet' || row.category === 'roll') && row.unit && unitClass(row.unit) !== 'sqft') infoNotes.push(`unit is ${row.unit}, expected sq.ft`);
  if(cat.taxPct !== 18) infoNotes.push(`priced at ${cat.taxPct}% tax`);

  let qtyCalc = null;
  if((row.category === 'sheet' || row.category === 'roll') && row.planNos != null && row.excelCode){
    const L = (row.customLengthFt !== null && row.customLengthFt !== '' && !isNaN(row.customLengthFt)) ? row.customLengthFt : cat.lengthFt;
    qtyCalc = `${fmtQty(row.planNos)} nos × ${L} × ${row.heightFt} ft`;
  }

  const itemMismatch = !!row.itemNameMismatch;
  const notDispatched = !!row.notDispatchedButBilled;
  return {
    expectedRate, expectedAmount,
    flagged: rateMismatch || qtyMismatch || itemMismatch || notDispatched || otherIssues.length > 0,
    pending: expectedRate === null,
    bundleWarning: null,
    qtyMismatch, qtyWarning, rateMismatch, rateWarning,
    itemMismatch, itemMismatchWarning: itemMismatch ? 'Item name Mismatch' : null,
    notDispatched, notDispatchedWarning: notDispatched ? `Billed ${fmtQty(row.quantity)} but nothing was ordered (plan qty 0)` : null,
    otherIssues, infoNotes, qtyCalc
  };
}

// ---- Rules panel -----------------------------------------------------------------------------
function recalcAllCards(){
  document.querySelectorAll('.invoice-card').forEach(c => {
    const record = window.__records.find(r => r.id === c.dataset.recordId);
    if(record){ record.items.forEach(row => refreshOrderedQtyFromExcel(record, row)); }
    recalcCard(c);
  });
}
function renderRulesPanel(){
  const grid = 'grid-template-columns: 190px 1fr 70px 60px 70px 76px 70px;';
  let html = `<h3>Rules and tolerances</h3><p class="desc">Plan rates are tax-inclusive. Each category sets its tax %, the decimals the expected rate is rounded to, and how much the rate (₹) and quantity may differ before a line is flagged. Tolerances are absolute, not percent — a percentage would let a large-volume line hide a real shortfall. A plan rate of <b>19</b> works out to 19 ÷ 1.18 = 16.102, which Tally prints as 16.10; the ₹0.02 sq.ft tolerance accepts it. Length ft is the fallback when a plan row doesn't state its own (a sheet's size always wins).</p>`;
  html += `<div class="rule-row head" style="${grid}"><span>Category</span><span>Formula</span><span>Length ft</span><span>Tax %</span><span>Decimals</span><span>Rate tol ₹</span><span>Qty tol</span></div>`;
  Object.keys(rules).forEach(key => {
    const r = rules[key];
    html += `<div class="rule-row" style="${grid}">
      <span>${escapeHtml(r.label)}</span>
      <span style="font-family:'IBM Plex Mono',monospace; color:var(--ink-soft); font-size:11.5px;">${escapeHtml(r.formula)}</span>
      <span>${r.lengthFt !== null ? `<input class="cell-input" data-rule="${key}" data-field="lengthFt" value="${r.lengthFt}">` : '—'}</span>
      <span><input class="cell-input" data-rule="${key}" data-field="taxPct" value="${r.taxPct}"></span>
      <span><input class="cell-input" data-rule="${key}" data-field="decimals" value="${r.decimals}"></span>
      <span><input class="cell-input" data-rule="${key}" data-field="tolRate" value="${r.tolRate}"></span>
      <span><input class="cell-input" data-rule="${key}" data-field="tolQty" value="${r.tolQty}"></span>
    </div>`;
  });
  html += `<div class="rule-row" style="grid-template-columns: 190px 1fr;">
      <span>Line amount tolerance (₹)</span>
      <span><input class="cell-input" id="cltTolAmount" value="${cltSettings.tolAmount}"> <span style="color:var(--ink-soft); font-size:11.5px;">widened by ₹0.005 per unit on large quantities, to absorb rate rounding</span></span>
    </div>
    <div class="rule-row" style="grid-template-columns: 190px 1fr;">
      <span>5% tax keywords</span>
      <span><input class="cell-input" id="cltFivePct" value="${escapeHtml((cltSettings.fivePctKeywords || []).join(', '))}" style="width:100%;"></span>
    </div>
    <div style="margin-top:12px;"><span class="fill-btn" id="cltResetRules" style="cursor:pointer;">Reset rules to defaults</span></div>`;
  rulesPanel.innerHTML = html;

  rulesPanel.querySelectorAll('input[data-rule]').forEach(inp => {
    inp.addEventListener('change', () => {
      const key = inp.dataset.rule, field = inp.dataset.field;
      const v = parseFloat(inp.value);
      // A zero length or a negative tolerance would break every check — refuse and snap back.
      if(!isFinite(v) || v < 0 || (field === 'lengthFt' && v <= 0)){ inp.value = rules[key][field]; return; }
      rules[key][field] = v;
      savePersisted();
      recalcAllCards();
    });
  });
  document.getElementById('cltTolAmount').addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if(!isFinite(v) || v < 0){ e.target.value = cltSettings.tolAmount; return; }
    cltSettings.tolAmount = v; savePersisted(); recalcAllCards();
  });
  document.getElementById('cltFivePct').addEventListener('change', e => {
    cltSettings.fivePctKeywords = e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    savePersisted(); recalcAllCards();
  });
  document.getElementById('cltResetRules').addEventListener('click', () => {
    if(!confirm('Reset all categories and tolerances to the defaults?')) return;
    rules = JSON.parse(JSON.stringify(defaultRules));
    cltSettings = JSON.parse(JSON.stringify(DEFAULT_CLT_SETTINGS));
    savePersisted(); renderRulesPanel(); recalcAllCards();
  });
}

// ---- Code reference panel ------------------------------------------------------------------
function rematchAllBills(){
  document.querySelectorAll('.invoice-card').forEach(c => {
    const record = window.__records.find(r => r.id === c.dataset.recordId);
    if(!record) return;
    if(record.selectedBlockName && excelWorkbookData){
      const block = excelWorkbookData.blocks.find(b => b.customerName === record.selectedBlockName);
      if(block){ record.itemMismatches = {}; record.items.forEach(r => { r._sizedFor = null; }); applyExcelMatch(record, block); }
    }
    updateItemPreview(c, record);
    recalcCard(c);
  });
}
function renderCodesPanel(){
  let html = `<h3>Item code reference</h3><p class="desc">Used to confirm that a plan row and a bill line are the same product. An unknown code never blocks a match, it just stops the tool vouching for the aperture or thickness. Two worth remembering: sheet <b>2x2</b> is 65×65mm on the thin grades but <b>60×60mm</b> on the 7mm (every 60×60 line gets a note), and <b>1/2x1/2</b> 10g lite bills at <b>1.9mm</b> here where Ernakulam writes 2.0mm.</p>`;
  html += `<h3 style="font-size:13.5px; margin-top:14px;">Aperture — the square between wires</h3>
    <div class="code-scroll"><table class="code-table"><colgroup><col style="width:70px;"><col style="width:120px;"><col><col style="width:28px;"></colgroup>
    <thead><tr><th>Kind</th><th>Code</th><th>Millimetres (comma-separated pairs, e.g. 65x65, 60x60)</th><th></th></tr></thead><tbody>`;
  ['sheet', 'roll'].forEach(kind => Object.keys(apertureTable[kind] || {}).forEach(code => {
    const v = apertureTable[kind][code].map(p => p[0] + 'x' + p[1]).join(', ');
    html += `<tr><td>${kind}</td><td class="code">${escapeHtml(code)}</td><td class="spec"><input class="cell-input" data-ap-kind="${kind}" data-ap-code="${escapeHtml(code)}" value="${escapeHtml(v)}" style="width:100%;"></td><td><span class="fill-btn" data-ap-remove="${kind}|${escapeHtml(code)}" style="cursor:pointer;">✕</span></td></tr>`;
  }));
  html += `</tbody></table></div>
    <div class="add-code-row"><select class="cell-select" id="newApKind"><option>sheet</option><option>roll</option></select>
      <input class="code-in" id="newApCode" placeholder="code, e.g. 3x3"><input class="label-in" id="newApMm" placeholder="mm pairs, e.g. 75x75"><button id="addApBtn">+ Add</button></div>`;

  html += `<h3 style="font-size:13.5px; margin-top:18px;">Sheet thickness codes</h3>
    <div class="code-scroll"><table class="code-table"><colgroup><col style="width:190px;"><col><col style="width:28px;"></colgroup>
    <thead><tr><th>Code on the plan</th><th>Wire (mm) on the bill</th><th></th></tr></thead><tbody>`;
  Object.keys(thicknessTable.sheet).forEach(code => {
    html += `<tr><td class="code">${escapeHtml(code)}</td><td class="spec"><input class="cell-input" data-th-kind="sheet" data-th-code="${escapeHtml(code)}" value="${thicknessTable.sheet[code]}"></td><td><span class="fill-btn" data-th-remove="sheet|${escapeHtml(code)}" style="cursor:pointer;">✕</span></td></tr>`;
  });
  html += `</tbody></table></div>
    <div class="add-code-row"><input class="code-in" id="newThSheetCode" placeholder="code, e.g. 6mm"><input class="code-in" id="newThSheetMm" placeholder="wire mm, e.g. 4.8"><button id="addThSheetBtn">+ Add</button></div>`;

  html += `<h3 style="font-size:13.5px; margin-top:18px;">Roll gauge codes — aperture · gauge · lite</h3>
    <div class="code-scroll"><table class="code-table"><colgroup><col style="width:190px;"><col><col style="width:28px;"></colgroup>
    <thead><tr><th>Aperture · gauge · lite</th><th>Wire (mm) on the bill</th><th></th></tr></thead><tbody>`;
  Object.keys(thicknessTable.roll).forEach(code => {
    html += `<tr><td class="code">${escapeHtml(code.replace(/\|/g, ' · '))}</td><td class="spec"><input class="cell-input" data-th-kind="roll" data-th-code="${escapeHtml(code)}" value="${thicknessTable.roll[code]}"></td><td><span class="fill-btn" data-th-remove="roll|${escapeHtml(code)}" style="cursor:pointer;">✕</span></td></tr>`;
  });
  html += `</tbody></table></div>
    <div class="add-code-row"><input class="code-in" id="newThRollAp" placeholder="aperture, e.g. 1x1" style="width:110px;"><input class="code-in" id="newThRollG" placeholder="gauge, e.g. 12" style="width:100px;">
      <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input type="checkbox" id="newThRollLite"> lite</label>
      <input class="code-in" id="newThRollMm" placeholder="wire mm" style="width:100px;"><button id="addThRollBtn">+ Add</button></div>
    <div style="margin-top:14px;"><span class="fill-btn" id="cltResetCodes" style="cursor:pointer;">Reset code tables to defaults</span></div>`;
  codesPanel.innerHTML = html;

  const changed = () => { savePersisted(); renderCodesPanel(); rematchAllBills(); };
  codesPanel.querySelectorAll('input[data-ap-kind]').forEach(inp => inp.addEventListener('change', () => {
    const pairs = inp.value.split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(/x/i).map(n => parseFloat(n)))
      .filter(p => p.length === 2 && isFinite(p[0]) && isFinite(p[1]));
    apertureTable[inp.dataset.apKind][inp.dataset.apCode] = pairs;
    changed();
  }));
  codesPanel.querySelectorAll('input[data-th-kind]').forEach(inp => inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if(!isFinite(v) || v <= 0){ inp.value = thicknessTable[inp.dataset.thKind][inp.dataset.thCode]; return; }
    thicknessTable[inp.dataset.thKind][inp.dataset.thCode] = v;
    changed();
  }));
  codesPanel.querySelectorAll('[data-ap-remove]').forEach(el => el.addEventListener('click', () => {
    const [kind, code] = el.dataset.apRemove.split('|'); delete apertureTable[kind][code]; changed();
  }));
  codesPanel.querySelectorAll('[data-th-remove]').forEach(el => el.addEventListener('click', () => {
    const i = el.dataset.thRemove.indexOf('|');
    const kind = el.dataset.thRemove.slice(0, i), code = el.dataset.thRemove.slice(i + 1);
    delete thicknessTable[kind][code]; changed();
  }));
  document.getElementById('addApBtn').addEventListener('click', () => {
    const kind = document.getElementById('newApKind').value;
    const code = normCodeKey(document.getElementById('newApCode').value);
    const pairs = document.getElementById('newApMm').value.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => s.split(/x/i).map(n => parseFloat(n))).filter(p => p.length === 2 && isFinite(p[0]) && isFinite(p[1]));
    if(!code || !pairs.length) return;
    apertureTable[kind][code] = pairs; changed();
  });
  document.getElementById('addThSheetBtn').addEventListener('click', () => {
    const code = document.getElementById('newThSheetCode').value.trim().toLowerCase().replace(/\s+/g, ' ');
    const v = parseFloat(document.getElementById('newThSheetMm').value);
    if(!code || !isFinite(v) || v <= 0) return;
    thicknessTable.sheet[code] = v; changed();
  });
  document.getElementById('addThRollBtn').addEventListener('click', () => {
    const ap = normCodeKey(document.getElementById('newThRollAp').value);
    const g = parseFloat(document.getElementById('newThRollG').value);
    const v = parseFloat(document.getElementById('newThRollMm').value);
    if(!ap || !isFinite(g) || !isFinite(v) || v <= 0) return;
    thicknessTable.roll[ap + '|' + g + '|' + (document.getElementById('newThRollLite').checked ? 'lite' : '')] = v; changed();
  });
  document.getElementById('cltResetCodes').addEventListener('click', () => {
    if(!confirm('Reset the aperture and thickness tables to the defaults?')) return;
    apertureTable = JSON.parse(JSON.stringify(DEFAULT_APERTURE));
    thicknessTable = JSON.parse(JSON.stringify(DEFAULT_THICKNESS));
    changed();
  });
}
function normCodeKey(s){ return String(s || '').toLowerCase().replace(/\s+/g, ''); }

// ---- Persistence of this branch's own settings (shared code saves the log, report, version) ----
async function branchSavePersisted(){
  await window.storage.set('clt_rules', JSON.stringify({ categories: rules, settings: cltSettings }), false);
  await window.storage.set('clt_codes', JSON.stringify({ aperture: apertureTable, thickness: thicknessTable }), false);
}
function mergeCategoryValues(saved){
  if(!saved) return;
  Object.keys(defaultRules).forEach(cat => {
    const s = saved[cat];
    if(!s) return;
    ['lengthFt', 'taxPct', 'decimals', 'tolRate', 'tolQty'].forEach(f => {
      const v = s[f];
      if(v === null || (typeof v === 'number' && isFinite(v) && v >= 0)) rules[cat][f] = v;
    });
  });
}
function mergeCodeTables(ap, th){
  // Saved values win; codes new in this version (not in the saved copy) are added from defaults.
  if(ap && ap.sheet && ap.roll){ ['sheet', 'roll'].forEach(k => Object.assign(apertureTable[k], ap[k])); }
  if(th && th.sheet && th.roll){ ['sheet', 'roll'].forEach(k => Object.assign(thicknessTable[k], th[k])); }
}
async function branchLoadPersisted(){
  try{
    const r = await window.storage.get('clt_rules', false);
    const c = await window.storage.get('clt_codes', false);
    if(r && r.value){
      const p = JSON.parse(r.value);
      mergeCategoryValues(p.categories);
      if(p.settings){
        if(typeof p.settings.tolAmount === 'number' && isFinite(p.settings.tolAmount)) cltSettings.tolAmount = p.settings.tolAmount;
        if(Array.isArray(p.settings.fivePctKeywords)) cltSettings.fivePctKeywords = p.settings.fivePctKeywords.filter(k => typeof k === 'string');
      }
    }
    if(c && c.value){ const p = JSON.parse(c.value); mergeCodeTables(p.aperture, p.thickness); }
    if(!(r && r.value) && !(c && c.value)) await migrateOldCltStorage();
  }catch(e){}
}
// One-time carry-over from the earlier Calicut tools (v1.1 on the website and v2.x), which kept
// everything under one localStorage key. Rules, code tables and the discrepancy log come across;
// the old key is left in place untouched.
async function migrateOldCltStorage(){
  let o = null;
  try{ const raw = localStorage.getItem('jainwire.clt.audit.v1'); if(raw) o = JSON.parse(raw); }catch(e){}
  if(!o) return;
  if(o.rules){
    if(o.rules.categories){                       // v2.x layout
      mergeCategoryValues(o.rules.categories);
      if(typeof o.rules.tolAmount === 'number') cltSettings.tolAmount = o.rules.tolAmount;
      if(Array.isArray(o.rules.fivePctKeywords)) cltSettings.fivePctKeywords = o.rules.fivePctKeywords;
    }else{                                         // v1.1 layout: one flat set of tolerances
      const R = o.rules, num = v => typeof v === 'number' && isFinite(v) && v >= 0;
      if(num(R.rollLengthFt) && R.rollLengthFt > 0) rules.roll.lengthFt = R.rollLengthFt;
      if(num(R.tolRateSqft)){ rules.sheet.tolRate = R.tolRateSqft; rules.roll.tolRate = R.tolRateSqft; }
      if(num(R.tolQtySqft)){ rules.sheet.tolQty = R.tolQtySqft; rules.roll.tolQty = R.tolQtySqft; }
      if(num(R.tolRateKg)) rules.directKg.tolRate = R.tolRateKg;
      if(num(R.tolQtyKg)) rules.directKg.tolQty = R.tolQtyKg;
      if(num(R.tolRateNos)) rules.directNos.tolRate = R.tolRateNos;
      if(num(R.tolQtyNos)) rules.directNos.tolQty = R.tolQtyNos;
      if(num(R.tolAmount)) cltSettings.tolAmount = R.tolAmount;
    }
  }
  mergeCodeTables(o.aperture, o.thickness);
  // Old log entries were one row per issue; the shared log keeps one entry per bill.
  if(Array.isArray(o.log) && o.log.length){
    const existing = await window.storage.get('btc_check_log', false);
    if(!(existing && existing.value)){
      const byBill = {};
      o.log.forEach(e => {
        const k = e.invoice || e.party || '?';
        (byBill[k] = byBill[k] || { id: 'log' + Math.random().toString(36).slice(2, 9), date: String(e.at || '').split(',')[0], party: (e.party || '') + (e.invoice ? ' · ' + e.invoice : ''), discrepancyCount: 0, discrepancies: [] });
        byBill[k].discrepancies.push((e.line ? e.line + ': ' : '') + (e.issue || ''));
        byBill[k].discrepancyCount++;
      });
      await window.storage.set('btc_check_log', JSON.stringify(Object.values(byBill)), false);
    }
  }
  await branchSavePersisted();
}

// ---- v7: rules shared through the Google Sheet (Rules tab) -----------------------------------
function branchRulesSnapshot(){ return { categories: rules, settings: cltSettings, aperture: apertureTable, thickness: thicknessTable }; }
function branchApplyRules(p){
  if(!p) return;
  rules = JSON.parse(JSON.stringify(defaultRules));
  mergeCategoryValues(p.categories);
  if(p.settings){
    if(typeof p.settings.tolAmount === 'number' && isFinite(p.settings.tolAmount)) cltSettings.tolAmount = p.settings.tolAmount;
    if(Array.isArray(p.settings.fivePctKeywords)) cltSettings.fivePctKeywords = p.settings.fivePctKeywords.filter(k => typeof k === 'string');
  }
  if(p.aperture && p.thickness){
    apertureTable = JSON.parse(JSON.stringify(DEFAULT_APERTURE));
    thicknessTable = JSON.parse(JSON.stringify(DEFAULT_THICKNESS));
    mergeCodeTables(p.aperture, p.thickness);
  }
}
// The CLT item list comes only from the sheet (CLT Items tab); the plan shorthand reader above is
// the fallback for anything not on it.
function branchApplyMaster(items){}
function branchBuiltInItems(){ return []; }

// ============================ END BRANCH FORMULAS — CALICUT · KANNUR ============================
