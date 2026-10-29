// =====================================================================================
//  BRANCH FORMULAS — ERNAKULAM (EKM)
//  Everything between this line and "END BRANCH FORMULAS" is specific to Ernakulam: how the rate
//  sheet is read, how bills are matched to it, and how the expected rate and quantity are worked
//  out. Everything outside this block is the shared tool, identical in every branch's file.
// =====================================================================================
const BRANCH = {
  key: 'ekm',
  name: 'Ernakulam',
  storagePrefix: 'jainwire.ekm.',
  gstins: { '32AAFFJ6260N1Z6': 'Ernakulam' },  // seller GSTINs accepted on this branch's bills
  descMaxChars: 60,          // bill descriptions are cut to this length (0 = keep in full)
  qtyFollowsCategory: false, // changing a line's Category does not re-derive its Actual Qty here
  // Category keys used when a Google Sheet item row names its category in words ("Sheet", "Roll"…)
  categoryKeys: { sheet: 'sheet_pics', roll: 'roll_mesh', five: 'direct_5pct', kg: 'direct', nos: 'direct_flat' },
  text: {
    eyebrow: 'Ernakulam · Invoice · Rate · Audit',
    lede: "Upload today's rate Excel, then drop all the bill PDFs at once. The Bill overview lists every file with its status, so you can work through what needs attention and jump straight to it. Each bill is matched to its Excel customer automatically when the name is clear; quoted rates and ordered quantities then auto-fill from the sheet — you only pick or type anything where it isn't sure.",
    rulesToggle: '⚙ Pricing rules (formulas, tax %, bundle weights)',
    codesToggle: '📖 Item code reference (built-in list)',
    excelMain: "Drop today's rate Excel here",
    excelSub: '.xlsx — grouped by customer, qty + rate columns',
    footerNote: 'Item shorthand is decoded from the EKM Items tab of the Google Sheet (or the built-in list until the sheet is connected).',
  },
};

// Called once per bill line when a bill is read. Ernakulam reads height from the description later
// (guessHeightFt) and uses the category's default length, so there is nothing extra to set up.
function branchInitRow(row){}

// ---- Default pricing rules (editable) ----
const defaultRules = {
  sheet_pics:  { label: 'Sheet (PICS/PCS)', lengthFt: 12, tax: 18, decimals: 0 },
  roll_mesh:   { label: 'Roll mesh (ROLL)', lengthFt: 50, tax: 18, decimals: 0 },
  direct:      { label: 'Direct (KG / sq.ft)', tax: 18, decimals: 2 },
  direct_flat: { label: 'Direct, flat rate (NOS / other)', tax: 18, decimals: 0 },
  direct_5pct: { label: 'Direct, 5% items (Velcro/Shade Net)', tax: 5, decimals: 2 },
};
let rules = JSON.parse(JSON.stringify(defaultRules));
// Only these specific KG items come in fixed-weight bundles; everything else billed at its exact listed weight.
// Brand-qualified variants (Tata, Supreme) are explicitly NOT bundled, even if the base item name matches.
let bundleRules = [
  { label: 'First Wire / Wire Nail', match: 'firstwire', weight: 25 },
  { label: 'Wire Nail (alt naming)', match: 'wirenail', weight: 25 },
  { label: 'GI Wire 16g', match: 'giwire16g', weight: 25 },
  { label: 'GI Wire 18g', match: 'giwire18g', weight: 25 },
  { label: 'GI Wire 20g', match: 'giwire20g', weight: 25 },
  { label: 'GI Wire 22g', match: 'giwire22g', weight: 25 },
  { label: 'GI Wire 24g', match: 'giwire24g', weight: 25 },
  { label: 'MS Wire 18g', match: 'mswire18g', weight: 25 },
  { label: 'MS Wire', match: 'mswire', weight: 25 },
];
const bundleExcludeBrands = ['supreme']; // Tata is handled explicitly below — it has its own MS-wire exception

// ---- Tata-branded wire: explicit, named rules (kept separate from bundleExcludeBrands above for clarity) ----
// Tata Wire and Tata GI Wire are sold at their EXACT listed weight — never bundled.
// Tata MS Wire (often printed on bills as "Tata Binding Wire") is the one exception: it IS always
// bundled, at 30kg. Written as named functions rather than a inline condition so this reads clearly
// on its own, without needing the conversation history that produced it.
function isTataMsWire(normalizedDescription){
  return normalizedDescription.includes('tata') &&
    (normalizedDescription.includes('mswire') || normalizedDescription.includes('bindingwire'));
}
function isTataExcludedWire(normalizedDescription){
  if(isTataMsWire(normalizedDescription)) return false; // explicit exception — do NOT exclude this one
  return normalizedDescription.includes('tatawire') || normalizedDescription.includes('tatagiwire');
}

// ---- Item code reference table (shorthand -> full spec, DISPLAY ONLY, not used in pricing) ----
let itemCodes = [["1/2x1/2x10x2 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 2ft"], ["1/2x1/2x10x3 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 3ft"], ["1/2x1/2x10x4 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 4ft"], ["1/2x1/2x10x5 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 5ft"], ["1/2x1/2x10x6 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 6ft"], ["10x24", "10 X 24"], ["10x22", "10x22"], ["12x24x3", "12X24X3"], ["14x26x3", "14X26X3"], ["20x24x3'", "20X24X3'"], ["4x18", "4X18"], ["4x20", "4X20"], ["4x22", "4X22"], ["5x20", "5X20"], ["6x18", "6X18"], ["6x20", "6x20"], ["6x22", "6X22"], ["8 x24", "8 X24"], ["8x16", "8X16"], ["8x20", "8X20"], ["8x22", "8x22"], ["shaded net 50%", "Agro Shaded Net 50%"], ["shaded net 75%", "Agro Shaded Net 75%"], ["shaded net 90%", "Agro Shaded Net 90%"], ["al. exp. metal 3ft", "Al. Exp. Metal 3ft"], ["al. grilling 4'", "Al. Grilling 4'"], ["al.exp.metal 2ft", "Al.Exp.Metal 2ft"], ["al.exp.metal 4ft", "Al.Exp.Metal 4ft"], ["al.grilling 2'", "Al.Grilling 2'"], ["al.grilling 3'", "Al.Grilling 3'"], ["alu. grilling 5ft", "Alu. Grilling 5ft"], ["alu.grilling 4'", "Alu.Grilling 4'"], ["alumininum m.net", "ALUMININUM M.NET"], ["aluminium coil 01.50 ft", "ALUMINIUM COIL 01.50 FT"], ["aluminium coil 02.00 ft", "ALUMINIUM COIL 02.00 FT"], ["aluminium coil 02.50 ft", "ALUMINIUM COIL 02.50 FT"], ["aluminium coil 1 ft", "ALUMINIUM COIL 1 FT"], ["aluminium coil 3 ft", "ALUMINIUM COIL 3 FT"], ["aluminium coil 4 ft", "ALUMINIUM COIL 4 FT"], ["aluminium grilling", "ALUMINIUM GRILLING"], ["aries fiber mesh 1mtr x50mtr 145gsm", "Aries Fiber Mesh 1mtr X50mtr 145gsm"], ["aries fiber mesh 1mtr x50mtr 80gsm", "Aries Fiber Mesh 1mtr X50mtr 80gsm"], ["aries fiber mesh 4inch x50mtr 145gsm", "Aries Fiber Mesh 4inch X50mtr 145gsm"], ["aries fiber mesh 6inch x50mtr 145gsm", "Aries Fiber Mesh 6inch X50mtr 145gsm"], ["aries fibre mesh 6inchx50mtr 80 gsm", "Aries Fibre Mesh 6inchx50mtr 80 Gsm"], ["asphaltic roofing - black", "Asphaltic Roofing - Black"], ["asphaltic roofing - blue", "Asphaltic Roofing - Blue"], ["asphaltic roofing - golden", "Asphaltic Roofing - Golden"], ["asphaltic roofing - silver", "Asphaltic Roofing - Silver"], ["asphaltic roofing heavy", "Asphaltic Roofing Heavy"], ["barbed wire 12x12", "BARBED WIRE 12X12"], ["barbed wire 14x14", "BARBED WIRE 14X14"], ["chicken mesh 1\\2x20 h 3ft", "CHICKEN  MESH  1\\2X20 (H) 3ft"], ["chicken mesh 1\\2x22x4", "CHICKEN  MESH  1\\2X22X4"], ["chicken mesh 1/2x20", "CHICKEN MESH 1/2X20"], ["chicken mesh 1/2x22x3", "CHICKEN MESH 1/2X22X3"], ["chicken mesh 1/2x24", "CHICKEN MESH 1/2X24"], ["chicken mesh 1/2x26x3'", "Chicken Mesh 1/2x26x3'"], ["chicken mesh 1/2x26x4'", "Chicken Mesh 1/2x26x4'"], ["chicken mesh 1/2x28", "CHICKEN MESH 1/2X28"], ["chicken mesh 1/2x28x20mtr", "CHICKEN MESH 1/2X28X20MTR"], ["diamond latice sheet white", "Diamond Latice Sheet (White)"], ["diamond lattice sheet green", "Diamond Lattice Sheet (Green)"], ["diamond lattice sheet nos ivory", "Diamond Lattice Sheet (Nos) Ivory"], ["razor sheet", "Diamond Razor Sheet 75mm x 75mm x 3mm x 12ft x 5ft"], ["diamond 1x1x12x4 4mm", "Diamond Sheet 40mm x 40mm x 3.3mm x 12ft x 4ft"], ["diamond 1x1x12x5 4mm", "Diamond Sheet 40mm x 40mm x 3.3mm x 12ft x 5ft"], ["diamond 1x1x12x4 5mm", "Diamond Sheet 40mm x 40mm x 4.1mm x 12ft x 4ft"], ["diamond 1x1x12x5 5mm", "Diamond Sheet 40mm x 40mm x 4.1mm x 12ft x 5ft"], ["diamond 2x2x12x4 4mm", "Diamond Sheet 65mm x 65mm x 3.3mm x 12ft x 4ft"], ["diamond 2x2x12x5 4mm", "Diamond Sheet 65mm x 65mm x 3.3mm x 12ft x 5ft"], ["diamond 2x2x12x4 5mm", "Diamond Sheet 65mm x 65mm x 4.1mm x 12ft x 4ft"], ["diamond 2x2x12x5 5mm", "Diamond sheet 65mm x 65mm x 4.1mm x 12ft x 5ft"], ["diamond 2x2x12x4 6mm", "Diamond sheet 65mm x 65mm x 5.5mm x 12ft x 4ft"], ["diamond 2x2x12x5 6mm", "Diamond sheet 65mm x 65mm x 5.5mm x 12ft x 5ft"], ["ex.metal 5'", "EX.METAL 5'"], ["expanded mesh", "EXPANDED MESH"], ["first wire nails 1.5x12", "First Wire Nails 1.5x12"], ["first wire nails 1.5x14", "First Wire Nails 1.5x14"], ["first wire nails 1x14", "First Wire Nails 1x14"], ["first wire nails 2.5x10", "First Wire Nails 2.5x10"], ["first wire nails 2.5x12", "First Wire Nails 2.5x12"], ["first wire nails 2x10", "First Wire Nails 2x10"], ["first wire nails 2x12", "First Wire Nails 2x12"], ["first wire nails 3x8", "First Wire Nails 3x8"], ["g.i weldmesh 12mmx12mmx12gx3'", "G.I Weldmesh 12mmx12mmx12gx3'"], ["g.i weldmesh 12mmx12mmx12gx4'", "G.I Weldmesh 12mmx12mmx12gx4'"], ["g.i weldmesh 12mmx12mmx12gx5'", "G.I Weldmesh 12mmx12mmx12gx5'"], ["g.i weldmesh 6mmx6mmx16gx3ft", "G.I Weldmesh 6mmx6mmx16gx3ft"], ["g.i weldmesh 6mmx6mmx16gx4ft", "G.I Weldmesh 6mmx6mmx16gx4ft"], ["g.i weldmesh 6mmx6mmx18gx3ft", "G.I Weldmesh 6mmx6mmx18gx3ft"], ["g.i weldmesh 6mmx6mmx18gx4ft", "G.I Weldmesh 6mmx6mmx18gx4ft"], ["g.i weldmesh 6mmx6mmx20gx3ft", "G.I Weldmesh 6mmx6mmx20gx3ft"], ["g.i weldmesh 6mmx6mmx20gx4ft", "G.I Weldmesh 6mmx6mmx20gx4ft"], ["g.i. concertina coil kg", "G.I. CONCERTINA COIL (KG)"], ["g.i. pvc wire 12g", "G.I. PVC WIRE 12g"], ["g.i. pvc wire 18g", "G.I. PVC WIRE 18G"], ["g.i.pvc chainlink", "G.I.Pvc Chainlink"], ["g.i.pvc wire 10g", "G.I.PVC WIRE 10G"], ["g.i.pvc wire 6g", "G.I.Pvc Wire 6g"], ["g.i.pvc. wire 14g", "G.I.Pvc. Wire 14g"], ["galvanized steel acsr core wire 1.57mm", "Galvanized Steel Acsr Core Wire 1.57mm"], ["galvanized steel acsr core wire 2.00mm", "Galvanized Steel Acsr Core Wire 2.00mm"], ["galvanized steel acsr core wire 2.20mm", "Galvanized Steel Acsr Core Wire 2.20mm"], ["galvanized steel acsr core wire 2.59mm", "Galvanized Steel ACSR Core Wire 2.59mm"], ["galvanized steel acsr core wire 2.59mm p", "Galvanized Steel Acsr Core Wire 2.59mm P"], ["gi perforatedsheet 8x3x14gx10mm rh", "GI  Perforatedsheet 8x3x14gx10mm RH"], ["gi perforatedsheet 8x3x14gx3mm rh", "GI  Perforatedsheet 8x3x14gx3mm RH"], ["gi perforatedsheet 8x3x14gx6mm rh", "GI  Perforatedsheet 8x3x14gx6mm RH"], ["gi perforatedsheet 8x3x14gx8mm rh", "GI  Perforatedsheet 8x3x14gx8mm RH"], ["gi perforatedsheet 8x3x16gx10mm rh", "GI  Perforatedsheet 8x3x16gx10mm RH"], ["gi perforatedsheet 8x3x16gx3mm rh", "GI  Perforatedsheet 8x3x16gx3mm RH"], ["gi perforatedsheet 8x3x16gx6mm rh", "GI  Perforatedsheet 8x3x16gx6mm RH"], ["gi perforatedsheet 8x3x16gx8mm rh", "GI  Perforatedsheet 8x3x16gx8mm RH"], ["Perf 8x3x18g 3mm RH", "GI  Perforatedsheet 8x3x18gx3mm RH"], ["gi perforatedsheet 8x3x18gx6mm rh", "GI  Perforatedsheet 8x3x18gx6mm RH"], ["gi perforatedsheet 8x3x18gx8mm rh", "GI  Perforatedsheet 8x3x18gx8mm RH"], ["gi perforatedsheet 8x4x10gx6mm rh", "GI  Perforatedsheet 8x4x10gx6mm RH"], ["gi perforatedsheet 8x4x14gx3mm rh", "GI  Perforatedsheet 8x4x14gx3mm RH"], ["gi perforatedsheet 8x4x14gx6mm rh", "GI  Perforatedsheet 8x4x14gx6mm RH"], ["gi perforatedsheet 8x4x14gx8mm rh", "GI  Perforatedsheet 8x4x14gx8mm RH"], ["gi perforatedsheet 8x4x16gx3mm rh", "GI  Perforatedsheet 8x4x16gx3mm RH"], ["gi perforatedsheet 8x4x16gx6mm rh", "GI  Perforatedsheet 8x4x16gx6mm RH"], ["gi perforatedsheet 8x4x16gx8mm rh", "GI  Perforatedsheet 8x4x16gx8mm RH"], ["Perf 8x4x18g 3mm RH", "GI  Perforatedsheet 8x4x18gx3mm RH"], ["Perf Sheet 8x4x18g 1.2mm 3mm RH", "GI  Perforatedsheet 8x4x18gx3mm RH"], ["gi perforatedsheet 8x4x18gx6mm rh", "GI  Perforatedsheet 8x4x18gx6mm RH"], ["gi perforatedsheet 8x4x18gx8mm rh", "GI  Perforatedsheet 8x4x18gx8mm RH"], ["gi weldmesh 25mm x 12.5mm x 2.20mm x 4ft", "Gi  Weldmesh 25mm x 12.5mm x 2.20mm x 4ft"], ["gi chain link", "GI CHAIN LINK"], ["gi chainlink fencing 50x50x4mm-90 gsm", "Gi Chainlink  Fencing 50x50x4mm-90 Gsm"], ["gi chainlink kg", "Gi Chainlink (Kg)"], ["gi chainlink mtr", "GI Chainlink (Mtr)"], ["gi chainlink sq.mtr", "Gi Chainlink (Sq.Mtr)"], ["gi chainlink 65mm x 65mm x 2.5mm x 3ft", "GI Chainlink 65mm x 65mm x 2.5mm x 3ft"], ["gi chainlink 65mm x 65mm x 2.5mm x 4ft", "GI Chainlink 65mm x 65mm x 2.5mm x 4ft"], ["gi chainlink 65mm x 65mm x 2.5mm x 5ft", "GI Chainlink 65mm x 65mm x 2.5mm x 5ft"], ["gi chainlink 65mm x 65mm x 3.0mm x 3ft", "GI Chainlink 65mm x 65mm x 3.0mm x 3ft"], ["gi chainlink 65mm x 65mm x 3.0mm x 4ft", "GI Chainlink 65mm x 65mm x 3.0mm x 4ft"], ["gi chainlink 65mm x 65mm x 3.0mm x 5ft", "GI Chainlink 65mm x 65mm x 3.0mm x 5ft"], ["gi chainlink 75mm x 75mm x 2.5mm x 3ft", "GI Chainlink 75mm x 75mm x 2.5mm x 3ft"], ["gi chainlink 75mm x 75mm x 2.5mm x 4ft", "GI Chainlink 75mm x 75mm x 2.5mm x 4ft"], ["gi chainlink 75mm x 75mm x 2.5mm x 5ft", "GI Chainlink 75mm x 75mm x 2.5mm x 5ft"], ["gi perforated sheet 10x4x16gx6mmrh", "GI Perforated Sheet 10x4x16gx6mmRH"], ["gi perforated sheet 8x3x14gx6mm sqh", "Gi Perforated Sheet 8x3x14gx6mm Sqh"], ["gi perforated sheet 8x3x16gx6mm sqh", "Gi Perforated Sheet 8x3x16gx6mm Sqh"], ["gi perforated sheet 8x3x18gx10mm rh", "GI Perforated Sheet 8x3x18gx10mm RH"], ["gi perforated sheet 8x3x18gx6mm sqh", "Gi Perforated Sheet 8x3x18gx6mm Sqh"], ["gi perforated sheet 8x3x18gx8mm sqh", "Gi Perforated Sheet 8x3x18gx8mm Sqh"], ["gi perforated sheet 8x3x20gx10mm rh", "Gi Perforated Sheet 8x3x20gx10mm RH"], ["gi perforated sheet 8x3x20gx10mm sqh", "Gi Perforated Sheet 8x3x20gx10mm Sqh"], ["gi perforated sheet 8x3x20gx12mm rh", "Gi Perforated Sheet 8x3x20gx12mm RH"], ["gi perforated sheet 8x3x20gx16mm rh", "Gi Perforated Sheet 8x3x20gx16mm RH"], ["gi perforated sheet 8x3x20gx3mm rh", "Gi Perforated Sheet 8x3x20gx3mm RH"], ["gi perforated sheet 8x3x20gx6mm rh", "Gi Perforated Sheet 8x3x20gx6mm RH"], ["gi perforated sheet 8x3x20gx6mm sqh", "Gi Perforated Sheet 8x3x20gx6mm Sqh"], ["gi perforated sheet 8x3x20gx8mm rh", "Gi Perforated Sheet 8x3x20gx8mm RH"], ["gi perforated sheet 8x3x22g", "Gi Perforated Sheet 8x3x22g"], ["gi perforated sheet 8x4x1.2mm designer hexa hole", "Gi Perforated Sheet 8x4x1.2mm Designer Hexa Hole"], ["gi perforated sheet 8x4x14gx10mm rh", "Gi Perforated Sheet 8x4x14gx10mm RH"], ["gi perforated sheet 8x4x14gx6mm sqh", "Gi Perforated Sheet 8x4x14gx6mm Sqh"], ["gi perforated sheet 8x4x16gx10mm rh", "GI Perforated Sheet 8x4x16gx10mm RH"], ["gi perforated sheet 8x4x16gx10mm sqh", "GI Perforated Sheet 8x4x16gx10mm Sqh"], ["gi perforated sheet 8x4x16gx12mm rh", "GI Perforated Sheet 8X4X16gX12mm RH"], ["gi perforated sheet 8x4x16gx12mm sqh", "GI Perforated Sheet 8X4X16gX12mm Sqh"], ["gi perforated sheet 8x4x16gx6mm sqh", "Gi Perforated Sheet 8x4x16gx6mm Sqh"], ["gi perforated sheet 8x4x18gx10mm rh", "Gi Perforated Sheet 8x4x18gx10mm RH"], ["gi perforated sheet 8x4x18gx10mm sqh", "Gi Perforated Sheet 8x4x18gx10mm Sqh"], ["gi perforated sheet 8x4x18gx12mm rh", "Gi Perforated Sheet 8x4x18gx12mm RH"], ["gi perforated sheet 8x4x18gx6mm sqh", "Gi Perforated Sheet 8x4x18gx6mm Sqh"], ["gi perforated sheet 8x4x19gx12mm rh", "GI Perforated Sheet 8x4x19gx12mm RH"], ["gi perforated sheet 8x4x20gx10mm sqh", "Gi Perforated Sheet 8x4x20gx10mm Sqh"], ["gi perforated sheet 8x4x20gx12mm rh", "Gi Perforated Sheet 8x4x20gx12mm RH"], ["gi perforated sheet 8x4x20gx16mm rh", "Gi Perforated Sheet 8x4x20gx16mm RH"], ["gi perforated sheet 8x4x20gx3mm rh", "Gi Perforated Sheet 8x4x20gx3mm RH"], ["gi perforated sheet 8x4x20gx6mm rh", "Gi Perforated Sheet 8x4x20gx6mm RH"], ["gi perforated sheet 8x4x20gx6mm sqh", "Gi Perforated Sheet 8x4x20gx6mm Sqh"], ["gi perforated sheet 8x4x20gx8mm rh", "Gi Perforated Sheet 8x4x20gx8mm RH"], ["gi perforated sheet 8x4x22gx3mm rh", "Gi Perforated Sheet 8x4x22gx3mm RH"], ["gi perforated sheet 8x4x22gx6mm rh", "Gi Perforated Sheet 8x4x22gx6mm RH"], ["gi perforatedsheet 8x4x19gx6mm rh", "Gi Perforatedsheet 8x4x19gx6mm RH"], ["gi perforatedsheet 8x4x20gx10mm rh", "Gi Perforatedsheet 8x4x20gx10mm RH"], ["gi pvc barbed wire 12 x12", "GI PVC BARBED WIRE 12 X12"], ["gi pvc coated chainlink kg", "Gi Pvc Coated Chainlink (KG)"], ["gi pvc coated chainlink sq.ft", "Gi Pvc Coated Chainlink (Sq.ft)"], ["gi pvc coated mesh 25x25x3mmx5ft", "Gi Pvc Coated Mesh 25x25x3mmx5ft"], ["gi pvc coated mesh 2'x10mtr 12mm", "Gi Pvc Coated Mesh 2'x10mtr 12mm"], ["gi pvc coated mesh 3'x10mtr-12mm", "Gi Pvc Coated Mesh 3'x10mtr-12mm"], ["Gi Pvc 12mm Green 3ft", "Gi Pvc Coated Mesh 3'x10mtr-12mm"], ["gi pvc coated mesh 3'x10mtr-15mm", "Gi Pvc Coated Mesh 3'x10mtr-15mm"], ["gi pvc coated mesh 3'x10mtr-6mm", "Gi Pvc Coated Mesh 3'x10mtr-6mm"], ["gi pvc coated mesh 3'x10mtr-6mm black", "Gi Pvc Coated Mesh 3'x10mtr-6mm Black"], ["gi pvc coated mesh 4'x10mtr-12mm", "Gi Pvc Coated Mesh 4'x10mtr-12mm"], ["Gi Pvc 12mm Green 4ft", "Gi Pvc Coated Mesh 4'x10mtr-12mm"], ["gi pvc coated mesh 4'x10mtr-15mm", "Gi Pvc Coated Mesh 4'x10mtr-15mm"], ["gi pvc coated mesh 4'x10mtr-6mm", "Gi Pvc Coated Mesh 4'x10mtr-6mm"], ["gi pvc coated mesh 4'x10mtr-6mm black", "Gi Pvc Coated Mesh 4'x10mtr-6mm Black"], ["gi pvc coated mesh 5'x10mtr-12mm", "Gi Pvc Coated Mesh 5'x10mtr-12mm"], ["Gi Pvc 12mm Green 5ft", "Gi Pvc Coated Mesh 5'x10mtr-12mm"], ["gi pvc coated mesh 5'x10mtr-15mm", "Gi Pvc Coated Mesh 5'x10mtr-15mm"], ["gi pvc coated mesh 5'x10mtr-6mm", "Gi Pvc Coated Mesh 5'x10mtr-6mm"], ["gi pvc wire 16", "GI PVC WIRE 16"], ["gi pvc wire 8g", "GI PVC WIRE 8G"], ["gi sheet kg", "Gi Sheet (Kg)"], ["gi sheet sqft", "Gi Sheet (Sqft)"], ["gi sheet mesh 100mmx100mmx2.5mmx12ftx5ft", "Gi Sheet Mesh 100mmx100mmx2.5mmx12ftx5ft"], ["4x1x12x4 5mm", "Gi Sheet Mesh 110mm x 36mm x 4.1mm x 12ft x 4ft"], ["4x1x12x5 5mm", "Gi Sheet Mesh 110mm x 36mm x 4.1mm x 12ft x 5ft"], ["4x1x12x4 6mm", "Gi Sheet Mesh 110mm x 36mm x 4.8mm x 12ft x 4ft"], ["4x1x12x5 6mm", "Gi Sheet Mesh 110mm x 36mm x 4.8mm x 12ft x 5ft"], ["25x25x12x4 4mm", "Gi Sheet Mesh 25mm x 25mm x 3.2mm x 12ft x 4ft"], ["25x25x12x4 3.2mm", "Gi Sheet Mesh 25mm x 25mm x 3.2mm x 12ft x 4ft"], ["25x25x12x5 4mm", "Gi Sheet Mesh 25mm x 25mm x 3.2mm x 12ft x 5ft"], ["25x25x12x5 3.2mm", "Gi Sheet Mesh 25mm x 25mm x 3.2mm x 12ft x 5ft"], ["25x25x12x4 4mm lite", "Gi Sheet Mesh 25mm X 25mm x 3mm x 12ft x 4ft"], ["25x25x12x5 4mm lite", "Gi Sheet Mesh 25mm X 25mm x 3mm x 12ft x 5ft"], ["1x1x12x3 4mm", "Gi Sheet Mesh 40mm x 40mm x 3.2mm x 12ft x 3ft"], ["1x1x12x4 4mm", "Gi Sheet Mesh 40mm x 40mm x 3.2mm x 12ft x 4ft"], ["1x1x12x5 4mm", "Gi Sheet Mesh 40mm x 40mm x 3.2mm x 12ft x 5ft"], ["1x1x12x3 4mm lite", "Gi Sheet Mesh 40mm x 40mm x 3mm x 12ft x 3ft"], ["1x1x12x4 4mm lite", "Gi Sheet Mesh 40mm x 40mm x 3mm x 12ft x 4ft"], ["1x1x12x5 4mm lite", "Gi Sheet Mesh 40mm x 40mm x 3mm x 12ft x 5ft"], ["1x1x12x4 5mm", "Gi Sheet Mesh 40mm x 40mm x 4.1mm x 12ft x 4ft"], ["1x1x12x5 5mm", "Gi Sheet Mesh 40mm x 40mm x 4.1mm x 12ft x 5ft"], ["1x1x12x4 6mm", "Gi Sheet Mesh 40mm x 40mm x 4.8mm x 12ft x 4ft"], ["1x1x12x5 6mm", "Gi Sheet Mesh 40mm x 40mm x 4.8mm x 12ft x 5ft"], ["2x2x12x3 4mm", "Gi Sheet Mesh 65mm x 65mm x 3.2mm x 12ft x 3ft"], ["2x2x12x4 4mm", "Gi Sheet Mesh 65mm x 65mm x 3.2mm x 12ft x 4ft"], ["2x2x12x5 4mm", "Gi Sheet Mesh 65mm x 65mm x 3.2mm x 12ft x 5ft"], ["2x2x12x4 5mm lite", "Gi Sheet Mesh 65mm x 65mm x 3.8mm x 12ft x 4ft"], ["2x2x12x5 5mm lite", "Gi Sheet Mesh 65mm x 65mm x 3.8mm x 12ft x 5ft"], ["2x2x12x4 4mm lite", "Gi Sheet Mesh 65mm x 65mm x 3mm x 12ft x 4ft"], ["2x2x12x5 4mm lite", "Gi Sheet Mesh 65mm x 65mm x 3mm x 12ft x 5ft"], ["2x2x12x4 5mm", "Gi Sheet Mesh 65mm x 65mm x 4.1mm x 12ft x 4ft"], ["2x2x12x5 5mm", "Gi Sheet Mesh 65mm x 65mm x 4.1mm x 12ft x 5ft"], ["2x2x12x4 6mm lite", "Gi Sheet Mesh 65mm x 65mm x 4.4mm x 12ft x 4ft"], ["2x2x12x5 6mm lite", "Gi Sheet Mesh 65mm x 65mm x 4.4mm x 12ft x 5ft"], ["2x2x12x4 6mm", "Gi Sheet Mesh 65mm x 65mm x 4.8mm x 12ft x 4ft"], ["2x2x12x5 6mm", "Gi Sheet Mesh 65mm x 65mm x 4.8mm x 12ft x 5ft"], ["2x2x12x4 6mm heavy", "Gi Sheet Mesh 65mm x 65mm x 5.2mm x 12ft x 4ft"], ["2x2x12x5 6mm heavy", "Gi Sheet Mesh 65mm x 65mm x 5.2mm x 12ft x 5ft"], ["3x1/2x12x4 3mm", "Gi Sheet Mesh 80mm x 18mm x 3mm x 12ft x 4ft"], ["3x1/2x12x5 3mm", "Gi Sheet Mesh 80mm x 18mm x 3mm x 12ft x 5ft"], ["gi sheet weldmesh", "Gi Sheet Weldmesh"], ["gi weldmesh roll", "GI WELDMESH (ROLL)"], ["gi weldmesh sqft", "Gi Weldmesh (Sqft)"], ["gi weldmesh 12mm x 12mm x 1.10mm x 3ft", "Gi Weldmesh 12mm x 12mm x 1.10mm x 3ft"], ["gi weldmesh 12mm x 12mm x 1.10mm x 4ft", "Gi Weldmesh 12mm x 12mm x 1.10mm x 4ft"], ["gi weldmesh 12mm x 12mm x 1.6mm x 3ft", "GI Weldmesh 12mm x 12mm x 1.6mm x 3ft"], ["gi weldmesh 12mm x 12mm x 1.6mm x 4ft", "GI Weldmesh 12mm x 12mm x 1.6mm x 4ft"], ["gi weldmesh 12mm x 12mm x 1.6mm x 5ft", "GI Weldmesh 12mm x 12mm x 1.6mm x 5ft"], ["gi weldmesh 12mmx12mmx14gx3ft", "Gi Weldmesh 12mmx12mmx14gx3ft"], ["gi weldmesh 12mmx12mmx14gx4ft", "Gi Weldmesh 12mmx12mmx14gx4ft"], ["gi weldmesh 15mmx15mmx2.4mmx3ft", "Gi Weldmesh 15mmx15mmx2.4mmx3ft"], ["gi weldmesh 15mmx15mmx2.4mmx4ft", "Gi Weldmesh 15mmx15mmx2.4mmx4ft"], ["gi weldmesh 15mmx15mmx2.4mmx5ft", "Gi Weldmesh 15mmx15mmx2.4mmx5ft"], ["1/2x1/2x16x3", "Gi Weldmesh 17mm x 17mm x 1.10mm x 3ft"], ["1/2x1/2x16x4", "Gi Weldmesh 17mm x 17mm x 1.10mm x 4ft"], ["1/2x1/2x16x5", "Gi Weldmesh 17mm x 17mm x 1.10mm x 5ft"], ["1/2x1/2x14x2", "Gi Weldmesh 17mm x 17mm x 1.40mm x 2ft"], ["1/2x1/2x14x3", "Gi Weldmesh 17mm x 17mm x 1.40mm x 3ft"], ["1/2x1/2x14x4", "Gi Weldmesh 17mm x 17mm x 1.40mm x 4ft"], ["1/2x1/2x14x5", "Gi Weldmesh 17mm x 17mm x 1.40mm x 5ft"], ["1/2x1/2x12x2 lite", "Gi Weldmesh 17mm x 17mm x 1.60mm x 2ft"], ["1/2x1/2x12x3 lite", "Gi Weldmesh 17mm x 17mm x 1.60mm x 3ft"], ["1/2x1/2x12x4 lite", "Gi Weldmesh 17mm x 17mm x 1.60mm x 4ft"], ["1/2x1/2x12x5 lite", "Gi Weldmesh 17mm x 17mm x 1.60mm x 5ft"], ["1/2x1/2x12x2 heavy", "Gi Weldmesh 17mm x 17mm x 1.80mm x 2ft"], ["1/2x1/2x12x3 heavy", "Gi Weldmesh 17mm x 17mm x 1.80mm x 3ft"], ["1/2x1/2x12x4 heavy", "Gi Weldmesh 17mm x 17mm x 1.80mm x 4ft"], ["1/2x1/2x12x5 heavy", "Gi Weldmesh 17mm x 17mm x 1.80mm x 5ft"], ["1/2x1/2x10x2", "Gi Weldmesh 17mm x 17mm x 2.00mm x 2ft"], ["1/2x1/2x10x3", "Gi Weldmesh 17mm x 17mm x 2.00mm x 3ft"], ["1/2x1/2x10x4", "Gi Weldmesh 17mm x 17mm x 2.00mm x 4ft"], ["1/2x1/2x10x5", "Gi Weldmesh 17mm x 17mm x 2.00mm x 5ft"], ["1/2x1/2x10x6", "Gi Weldmesh 17mm x 17mm x 2.00mm x 6ft"], ["1/2x1/2x8x2", "Gi Weldmesh 17mm x 17mm x 2.30mm x 2ft"], ["1/2x1/2x8x3", "Gi Weldmesh 17mm x 17mm x 2.30mm x 3ft"], ["1/2x1/2x8x4", "Gi Weldmesh 17mm x 17mm x 2.30mm x 4ft"], ["1/2x1/2x8x5", "Gi Weldmesh 17mm x 17mm x 2.30mm x 5ft"], ["gi weldmesh 25mm x 12.5mm x 2.20mm x 3ft", "Gi Weldmesh 25mm x 12.5mm x 2.20mm x 3ft"], ["25x25x10x3", "Gi Weldmesh 25mm x 25mm x 2.20mm x 3ft"], ["25x25x2.2x3", "Gi Weldmesh 25mm x 25mm x 2.20mm x 3ft"], ["25x25x10x4", "Gi Weldmesh 25mm x 25mm x 2.20mm x 4ft"], ["25x25x2.2x4", "Gi Weldmesh 25mm x 25mm x 2.20mm x 4ft"], ["25x25x10x5", "Gi Weldmesh 25mm x 25mm x 2.20mm x 5ft"], ["25x25x2.2x5", "Gi Weldmesh 25mm x 25mm x 2.20mm x 5ft"], ["25x25x10x3 blue", "Gi Weldmesh 25mm x 25mm x 2.50mm x 3ft"], ["25x25x10x4 blue", "Gi Weldmesh 25mm x 25mm x 2.50mm x 4ft"], ["25x25x10x5 blue", "Gi Weldmesh 25mm x 25mm x 2.50mm x 5ft"], ["25x25x8x3", "Gi Weldmesh 25mm x 25mm x 2.80mm x 3ft"], ["25x25x8x4", "Gi Weldmesh 25mm x 25mm x 2.80mm x 4ft"], ["25x25x8x5", "Gi Weldmesh 25mm x 25mm x 2.80mm x 5ft"], ["1x1/2x10x3", "Gi Weldmesh 40mm x 20mm x 2.20mm x 3ft"], ["1x1/2x10x4", "Gi Weldmesh 40mm x 20mm x 2.20mm x 4ft"], ["1x1/2x10x5", "Gi Weldmesh 40mm x 20mm x 2.20mm x 5ft"], ["1x1/2x8x3", "Gi Weldmesh 40mm x 20mm x 2.80mm x 3ft"], ["1x1/2x8x4", "Gi Weldmesh 40mm x 20mm x 2.80mm x 4ft"], ["1x1/2x8x5", "Gi Weldmesh 40mm x 20mm x 2.80mm x 5ft"], ["1x1x10x3", "Gi Weldmesh 40mm x 40mm x 2.20mm x 3ft"], ["1x1x10x4", "Gi Weldmesh 40mm x 40mm x 2.20mm x 4ft"], ["1x1x10x5", "Gi Weldmesh 40mm x 40mm x 2.20mm x 5ft"], ["1x1x10x6", "Gi Weldmesh 40mm x 40mm x 2.20mm x 6ft"], ["1x1x10x3 blue", "Gi Weldmesh 40mm x 40mm x 2.50mm x 3ft"], ["1x1x10x4 blue", "Gi Weldmesh 40mm x 40mm x 2.50mm x 4ft"], ["1x1x10x5 blue", "Gi Weldmesh 40mm x 40mm x 2.50mm x 5ft"], ["1x1x8x3", "Gi Weldmesh 40mm x 40mm x 2.80mm x 3ft"], ["1x1x8x4", "Gi Weldmesh 40mm x 40mm x 2.80mm x 4ft"], ["1x1x8x5", "Gi Weldmesh 40mm x 40mm x 2.80mm x 5ft"], ["1x1x8x6", "Gi Weldmesh 40mm x 40mm x 2.80mm x 6ft"], ["1x1x8x3 Heavy", "Gi Weldmesh 40mm x 40mm x 3.30mm x 3ft"], ["1x1x8x4 Heavy", "Gi Weldmesh 40mm x 40mm x 3.30mm x 4ft"], ["1x1x8x5 Heavy", "Gi Weldmesh 40mm x 40mm x 3.30mm x 5ft"], ["2x1x10x3", "Gi Weldmesh 60mm x 36mm x 2.20mm x 3ft"], ["2x1x10x4", "Gi Weldmesh 60mm x 36mm x 2.20mm x 4ft"], ["2x1x10x5", "Gi Weldmesh 60mm x 36mm x 2.20mm x 5ft"], ["2x1x8x3", "Gi Weldmesh 60mm x 36mm x 2.80mm x 3ft"], ["2x1x8x4", "Gi Weldmesh 60mm x 36mm x 2.80mm x 4ft"], ["2x1x8x5", "Gi Weldmesh 60mm x 36mm x 2.80mm x 5ft"], ["2x2x10x3", "Gi Weldmesh 60mm x 60mm x 2.20mm x 3ft"], ["2x2x10x4", "Gi Weldmesh 60mm x 60mm x 2.20mm x 4ft"], ["2x2x10x5", "Gi Weldmesh 60mm x 60mm x 2.20mm x 5ft"], ["2x2x8x3", "Gi Weldmesh 60mm x 60mm x 2.90mm x 3ft"], ["2x2x8x4", "Gi Weldmesh 60mm x 60mm x 2.90mm x 4ft"], ["2x2x8x5", "Gi Weldmesh 60mm x 60mm x 2.90mm x 5ft"], ["2x2x8x3 Super heavy", "Gi Weldmesh 60mm x 60mm x 3.50mm x 3ft"], ["2x2x8x4 Super heavy", "Gi Weldmesh 60mm x 60mm x 3.50mm x 4ft"], ["2x2x8x5 Super heavy", "Gi Weldmesh 60mm x 60mm x 3.50mm x 5ft"], ["gi weldmesh 6mm x 6mm x 1.4mm x 3ft", "GI Weldmesh 6mm x 6mm x 1.4mm x 3ft"], ["gi weldmesh 6mm x 6mm x 1.4mm x 4ft", "GI Weldmesh 6mm x 6mm x 1.4mm x 4ft"], ["gi weldmesh 6mm x 6mm x 1mm x 3ft", "GI Weldmesh 6mm x 6mm x 1mm x 3ft"], ["gi weldmesh 6mm x 6mm x 1mm x 4ft", "GI Weldmesh 6mm x 6mm x 1mm x 4ft"], ["gi weldmesh 6mmx16gx3'x50'", "GI Weldmesh 6mmx16gx3'x50'"], ["gi weldmesh 6mmx16gx4'x50'", "GI Weldmesh 6mmx16gx4'x50'"], ["gi weldmesh 6mmx18gx3'x100'", "GI Weldmesh 6mmx18gx3'x100'"], ["gi weldmesh 8mm x 8mm x 1.00mm x 3ft", "Gi Weldmesh 8mm x 8mm x 1.00mm x 3ft"], ["gi weldmesh 8mm x 8mm x 1.00mm x 4ft", "Gi Weldmesh 8mm x 8mm x 1.00mm x 4ft"], ["gi wire 16g", "GI Wire 16g"], ["16g", "GI Wire 16g"], ["gi wire 18g", "GI Wire 18g"], ["18g", "GI Wire 18g"], ["gi wire 12g", "GI Wire 2.5mm"], ["gi wire 20g", "GI Wire 20g"], ["gi wire 22g", "GI Wire 22g"], ["gi wire 24g", "GI Wire 24g"], ["gi wire 26g", "Gi Wire 26g"], ["gi wire 14g", "GI Wire 2mm"], ["Gi Wire 10g", "GI Wire 3.1mm"], ["Gi wire 8g", "GI WIRE 4MM"], ["gi wire 6g", "GI Wire 5mm"], ["gichainlink sq.ft", "GICHAINLINK(SQ.FT)"], ["gipvc wire", "GIPVC WIRE"], ["hexagonal vergin 1.2x25 ivory", "HEXAGONAL (VERGIN) 1.2X25 IVORY"], ["hexagonal vergin 1.2x25 red", "HEXAGONAL (VERGIN) 1.2X25 RED"], ["hexagonal vergin 1.5x25 orange", "HEXAGONAL (VERGIN) 1.5X25 ORANGE"], ["hexagonal vergin 2.0x25-silver", "HEXAGONAL (VERGIN) 2.0X25-SILVER"], ["hexagonal sada 1.5x25 gray", "HEXAGONAL(SADA)1.5X25 GRAY"], ["hexagonal sadha 1.0x25 green", "HEXAGONAL(SADHA)1.0X25 GREEN"], ["hexagonal sadha 1.2x25 green", "HEXAGONAL(SADHA)1.2X25 GREEN"], ["hexagonal sadha 1.2x25 orange", "HEXAGONAL(SADHA)1.2X25 ORANGE"], ["hexagonal sadha 1.5x25 green", "HEXAGONAL(SADHA)1.5X25 GREEN"], ["hexagonal sadha 1.5x25 orange", "HEXAGONAL(SADHA)1.5X25 ORANGE"], ["hexagonal sadha 2.0x25 green", "HEXAGONAL(SADHA)2.0X25 GREEN"], ["hexagonal vergin 1.2x25 green", "HEXAGONAL(VERGIN) 1.2X25 GREEN"], ["hexagonal vergin 1.5x25 gray", "HEXAGONAL(VERGIN) 1.5X25 GRAY"], ["hexagonal vergin 1.0x25 black", "HEXAGONAL(VERGIN)1.0X25 BLACK"], ["hexagonal vergin 1.0x25 green", "HEXAGONAL(VERGIN)1.0X25 GREEN"], ["hexagonal vergin 1.0x25 orange", "HEXAGONAL(VERGIN)1.0X25 ORANGE"], ["hexagonal vergin 1.0x25 white", "HEXAGONAL(VERGIN)1.0X25 WHITE"], ["hexagonal vergin 1.2x25 black", "HEXAGONAL(VERGIN)1.2X25 BLACK"], ["hexagonal vergin 1.2x25 blue", "HEXAGONAL(VERGIN)1.2X25 BLUE"], ["hexagonal vergin 1.2x25 gray", "HEXAGONAL(VERGIN)1.2X25 GRAY"], ["hexagonal vergin 1.2x25 orange", "HEXAGONAL(VERGIN)1.2X25 ORANGE"], ["hexagonal vergin 1.2x25 white", "HEXAGONAL(VERGIN)1.2X25 WHITE"], ["hexagonal vergin 1.2x25 yellow", "HEXAGONAL(VERGIN)1.2X25 YELLOW"], ["hexagonal vergin 1.5x25 black", "HEXAGONAL(VERGIN)1.5X25 BLACK"], ["hexagonal vergin 1.5x25 blue", "HEXAGONAL(VERGIN)1.5X25 BLUE"], ["hexagonal vergin 1.5x25 green", "HEXAGONAL(VERGIN)1.5X25 GREEN"], ["hexagonal vergin 1.5x25 ivory", "HEXAGONAL(VERGIN)1.5X25 IVORY"], ["hexagonal vergin 1.5x25 red", "HEXAGONAL(VERGIN)1.5X25 RED"], ["hexagonal vergin 1.5x25 white", "HEXAGONAL(VERGIN)1.5X25 WHITE"], ["hexagonal vergin 2.0x25 green", "HEXAGONAL(VERGIN)2.0X25 GREEN"], ["hexagonal vergin 2.0x25 orange", "HEXAGONAL(VERGIN)2.0X25 ORANGE"], ["hexagonal vergin 2.0x25 red", "HEXAGONAL(VERGIN)2.0X25 RED"], ["hexagonal vergin i.0x25-ivory", "HEXAGONAL(VERGIN)I.0X25-IVORY"], ["laser cutting sheet 1.2mm", "Laser Cutting Sheet 1.2mm"], ["laser cutting sheet 1.5mm", "Laser Cutting Sheet 1.5mm"], ["laser cutting sheet 1.5mm sqft", "Laser Cutting Sheet 1.5mm (Sqft)"], ["lazer cutting 16g - 4'x16", "Lazer Cutting 16g - 4'X16"], ["lazer cutting 16g - 5'x16", "Lazer Cutting 16g - 5'x16"], ["lazer cutting 16g-32\"x24", "Lazer Cutting 16g-32\"x24"], ["lazer cutting 18g", "Lazer Cutting 18g"], ["mosquito net biscuite 3'", "Mosquito Net Biscuite 3'"], ["mosquito net biscuite 4'", "Mosquito Net Biscuite 4'"], ["mosquito net biscuite 5'", "Mosquito Net Biscuite 5'"], ["mosquito net black 3'", "Mosquito Net Black 3'"], ["mosquito net black 4'", "Mosquito Net Black 4'"], ["mosquito net black 5'", "Mosquito Net Black 5'"], ["mosquito net blue 3'", "Mosquito Net Blue 3'"], ["mosquito net blue 4'", "Mosquito Net Blue 4'"], ["mosquito net blue 5'", "Mosquito Net Blue 5'"], ["mosquito net brown 3'", "Mosquito Net Brown 3'"], ["mosquito net brown 4'", "Mosquito Net Brown 4'"], ["mosquito net brown 5'", "Mosquito Net Brown 5'"], ["mosquito net buiscuit3'", "Mosquito Net Buiscuit3'"], ["mosquito net green 3'", "Mosquito Net Green 3'"], ["mosquito net green 4'", "Mosquito Net Green 4'"], ["mosquito net green 5'", "Mosquito Net Green 5'"], ["mosquito net ivory 4'", "Mosquito Net Ivory 4'"], ["mosquito net ivory 5'", "Mosquito Net Ivory 5'"], ["mosquito net ivory3'", "Mosquito Net Ivory3'"], ["mosquito net pink 3'", "Mosquito Net Pink 3'"], ["mosquito net pink 4'", "Mosquito Net Pink 4'"], ["s.s.wire 100 x 100 x 1mtr x 100", "S.S.Wire 100 x 100 x 1mtr x 100"], ["shreeven 3d mesh 8x3x4mm", "SHREEVEN 3D MESH 8X3X4MM"], ["shreeven 3d mesh 8x4x3.4mm", "SHREEVEN 3D MESH 8X4X3.4MM"], ["shreeven 3d mesh 8x4x3.5mm", "SHREEVEN 3D MESH 8X4X3.5MM"], ["shreeven 3d mesh 8x4x4mm", "SHREEVEN 3D MESH 8X4X4MM"], ["shreeven 3d mesh 8x5x3.4mm", "SHREEVEN 3D MESH 8X5X3.4MM"], ["shreeven 3d mesh 8x5x3.5mm", "SHREEVEN 3D MESH 8X5X3.5MM"], ["shreeven 3d mesh 8x5x4mm", "SHREEVEN 3D MESH 8X5X4MM"], ["shreeven 3d mesh 8x6x4mm", "SHREEVEN 3D MESH 8X6X4MM"], ["sky velcro 20mm black", "SKY VELCRO 20MM BLACK"], ["sky velcro 20mm white", "SKY VELCRO 20MM WHITE"], ["sky velcro 25mm black", "SKY VELCRO 25MM BLACK"], ["sky velcro 38mm black", "SKY VELCRO 38MM BLACK"], ["sky velcro 38mm white", "SKY VELCRO 38MM WHITE"], ["sky velcro 50mm black", "SKY VELCRO 50MM BLACK"], ["sky velcro 50mm grey", "SKY VELCRO 50MM GREY"], ["sky velcro whit loop", "SKY VELCRO WHIT LOOP"], ["sky velcro white 25mm", "SKY VELCRO WHITE 25MM"], ["sky velcro white 50mm", "SKY VELCRO WHITE 50MM"], ["sq net 12mm black 25 mtr", "SQ NET 12MM BLACK (25 MTR)"], ["sq net 12mm blue 10 mtr", "SQ NET 12MM BLUE (10 MTR)"], ["sq net 12mm blue 25 mtr", "SQ NET 12MM BLUE (25 MTR)"], ["sq net 12mm green 10 mtr", "SQ NET 12MM GREEN (10 MTR)"], ["sq net 12mm green 25 mtr", "SQ NET 12MM GREEN (25 MTR)"], ["sq net 12mm ivory 10 mtr", "SQ NET 12MM IVORY (10 MTR)"], ["sq net 12mm ivory 25 mtr", "SQ NET 12MM IVORY (25 MTR)"], ["sq net 15mm black 10 mtr", "SQ NET 15MM BLACK (10 MTR)"], ["sq net 15mm blue 10 mtr", "SQ NET 15MM BLUE (10 MTR)"], ["sq net 15mm blue 25 mtr", "SQ NET 15MM BLUE (25 MTR)"], ["sq net 15mm green 10 mtr", "SQ NET 15MM GREEN (10 MTR)"], ["sq net 15mm green 25 mtr", "SQ NET 15MM GREEN (25 MTR)"], ["sq net 15mm ivory 10 mtr", "SQ NET 15MM IVORY (10 MTR)"], ["sq net 15mm ivory 25mtr", "SQ NET 15MM IVORY (25MTR)"], ["sq net 4mm green 25 mtr", "SQ NET 4MM GREEN (25 MTR)"], ["sq net 4mmx1mtrx25 mtr", "SQ NET 4MMX1MTRX25 MTR"], ["sq net 6mm black 10 mtr", "SQ NET 6MM BLACK (10 MTR)"], ["sq net black 15mm x1x25", "SQ NET BLACK 15MM X1X25"], ["sq. net 4mm black 10 mtr", "SQ. NET 4MM BLACK (10 MTR)"], ["sq. net 4mm black 25 mtr", "SQ. NET 4MM BLACK (25 MTR)"], ["sq. net 4mm blue 25 mtr", "SQ. NET 4MM BLUE (25 MTR)"], ["sq. net 6mm black 25 mtr", "SQ. NET 6MM BLACK (25 MTR)"], ["sq. net 6mm blue 25 mtr", "SQ. NET 6MM BLUE (25 MTR)"], ["sq.net 12mm black 15 mtr", "SQ.NET 12MM BLACK ( 15 MTR)"], ["sq.net 12mm black 10 mtr", "SQ.NET 12MM BLACK (10 MTR)"], ["sq.net 4mm blue 10mtr", "SQ.NET 4MM BLUE (10MTR)"], ["sq.net 4mm green 10 mtr", "SQ.NET 4MM GREEN (10 MTR)"], ["sq.net 4mm ivory 10 mtr", "SQ.NET 4MM IVORY (10 MTR)"], ["sq.net 6mm blue 10 mtr", "SQ.NET 6MM BLUE (10 MTR)"], ["sq.net 6mm green 10 mtr", "SQ.NET 6MM GREEN (10 MTR)"], ["sq.net 6mm green 1x25 mtr", "Sq.Net 6mm Green 1x25 Mtr"], ["sq.net 8mm green 10 mtr", "SQ.NET 8MM GREEN (10 MTR)"], ["sq.net.6mm ivory 1.4.mt.", "SQ.NET.6MM IVORY 1.4.MT."], ["ss coin mesh", "Ss Coin Mesh"], ["ss coin mesh kg", "Ss Coin Mesh (Kg)"], ["ss concertina coil", "SS CONCERTINA COIL"], ["ss concertina coils", "SS CONCERTINA COILS"], ["ss wire", "Ss Wire"], ["ss wire - 0.9mm", "SS WIRE - 0.9MM"], ["ss wire - 1.20mm", "SS WIRE - 1.20MM"], ["ss wire - 1.30mm", "SS WIRE - 1.30MM"], ["ss wire - 2.00mm", "SS WIRE - 2.00MM"], ["ss wire - 2.50mm", "SS WIRE - 2.50MM"], ["ss wire - 3mm 304l soft 0091", "SS WIRE - 3MM (304L SOFT 0091)"], ["ss wire - 4.00mm", "SS WIRE - 4.00MM"], ["ss wire - 5.20mm", "SS WIRE - 5.20MM"], ["supreme barbed wire 12x12 90 gsm", "SUPREME Barbed Wire 12x12 90 GSM"], ["supreme barbed wire 14x14 90 gsm", "SUPREME Barbed Wire 14x14 90 GSM"], ["supreme barbed wire 90 gsm", "SUPREME BARBED WIRE 90 GSM"], ["supreme gi wire 10g 90 gsm", "SUPREME Gi Wire 10g 90 GSM"], ["supreme gi wire 12g 90 gsm", "SUPREME Gi Wire 12g 90 GSM"], ["Supreme Wire 2.5mm (12g)", "SUPREME Gi Wire 12g 90 GSM"], ["supreme gi wire 14g 90 gsm", "SUPREME Gi Wire 14g 90 GSM"], ["supreme gi wire 16g 100 gsm", "SUPREME Gi Wire 16g 100 GSM"], ["supreme gi wire 16g 90 gsm", "SUPREME Gi Wire 16g 90 GSM"], ["supreme gi wire 6g 90 gsm", "SUPREME Gi Wire 6g 90 GSM"], ["supreme gi wire 8g 90 gsm", "SUPREME Gi Wire 8g 90 GSM"], ["supreme gi wire 9g 90 gsm", "SUPREME GI Wire 9g 90 GSM"], ["tata ayush wire 1.60mm 16g", "TATA AYUSH WIRE 1.60MM(16G)"], ["tata barbed wire 12x12", "TATA BARBED WIRE 12X12"], ["tata barbed wire 14x14", "TATA BARBED WIRE 14X14"], ["Tata Ms wire", "Tata Binding Wire TW20-0.91 mm PIP Compact"], ["tata fence post 6.5ft", "TATA FENCE POST 6.5FT"], ["tata fencepost 5.5ft", "TATA FENCEPOST 5.5FT"], ["Tata ch 65x65x2.5mmx3ft", "Tata GI Chainlink 65mm x 65mm x 2.5mm x 3ft"], ["Tata ch 65x65x2.5mmx4ft", "Tata GI Chainlink 65mm x 65mm x 2.5mm x 4ft"], ["tata gi chainlink 65mm x 65mm x 2.5mm x 5ft", "Tata GI Chainlink 65mm x 65mm x 2.5mm x 5ft"], ["tata gi chainlink 65mm x 65mm x 3.0mm x 3ft", "Tata GI Chainlink 65mm x 65mm x 3.0mm x 3ft"], ["tata gi chainlink 65mm x 65mm x 3.0mm x 4ft", "Tata GI Chainlink 65mm x 65mm x 3.0mm x 4ft"], ["tata gi chainlink 65mm x 65mm x 3.0mm x 5ft", "Tata GI Chainlink 65mm x 65mm x 3.0mm x 5ft"], ["tata gi chainlink 75mm x 75mm x 2.5mm x 3ft", "Tata GI Chainlink 75mm x 75mm x 2.5mm x 3ft"], ["tata gi chainlink 75mm x 75mm x 2.5mm x 4ft", "Tata GI Chainlink 75mm x 75mm x 2.5mm x 4ft"], ["tata gi chainlink 75mm x 75mm x 2.5mm x 5ft", "Tata GI Chainlink 75mm x 75mm x 2.5mm x 5ft"], ["tata gi wire 08swg 4.00mm", "TATA Gi Wire 08swg (4.00mm)"], ["tata gi wire 10swg 3.00mm", "TATA Gi Wire 10swg (3.00mm)"], ["tata gi wire 12swg 2.50mm", "TATA Gi Wire 12swg (2.50mm)"], ["Tata Wire 2.5mm (12g)", "TATA Gi Wire 12swg (2.50mm)"], ["tata pvc wire - 3.00mm", "TATA PVC WIRE - 3.00MM"], ["tata pvc wire 10g", "Tata Pvc Wire 10g"], ["tata pvc wire 5.00mm", "TATA PVC WIRE 5.00MM"], ["tata pvc wire 5.5mm", "TATA PVC WIRE 5.5MM"], ["tata 1/2x1/2x10x3", "TATA Super Fence 17mm x 17mm x 2mm x 3ft x 50ft"], ["tata 1/2x1/2x10x4", "TATA Super Fence 17mm x 17mm x 2mm x 4ft x 50ft"], ["tata 25x25x10x3 blue", "TATA Super Fence 25mm x 25mm x 2.50mm x 3ft x 50ft"], ["tata 25x25x10x4 blue", "TATA Super Fence 25mm x 25mm x 2.50mm x 4ft x 50ft"], ["tata wire 1.60mm 16g", "TATA WIRE 1.60MM(16G)"], ["Tata Wire 1.6mm (16g)", "TATA WIRE 1.60MM(16G)"], ["tata wire 16g", "TATA WIRE 16G"], ["tata wire 2.00mm 14g", "TATA WIRE 2.00MM(14G)"], ["tata wire 2.4mm", "TATA WIRE 2.4MM"], ["tata wire 4.88mm green", "TATA WIRE 4.88MM (Green)"], ["tata wire 4.88mm yellow", "TATA WIRE 4.88MM (Yellow)"], ["tata wire 5.00mm 6g", "TATA WIRE 5.00MM(6G)"], ["wire nail 1.5x12", "Wire Nail 1.5x12"], ["wire nail 1.5x14", "Wire Nail 1.5x14"], ["wire nail 1x14", "Wire Nail 1x14"], ["wire nail 2.5x10", "Wire Nail 2.5x10"], ["wire nail 2.5x12", "Wire Nail 2.5x12"], ["wire nail 2x10", "Wire Nail 2x10"], ["wire nail 2x11", "Wire Nail 2x11"], ["wire nail 2x12", "Wire Nail 2x12"], ["wire nail 2x9", "Wire Nail 2x9"], ["wire nail 3x8", "Wire Nail 3x8"], ["wire nail 4x6", "Wire Nail 4x6"], ["wire nail 4x8", "Wire Nail 4x8"]];

const V61_NEW_CODES = [["1/2x1/2x10x2 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 2ft"], ["1/2x1/2x10x3 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 3ft"], ["1/2x1/2x10x4 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 4ft"], ["1/2x1/2x10x5 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 5ft"], ["1/2x1/2x10x6 lite", "Gi Weldmesh 17mm x 17mm x 2.00mm x 6ft"]];

// Normalises the shorthand people actually type: stray spaces around the x, "lit" vs "lite",
// 1/2 written as .5, curly quotes, trailing ft marks. Ported from TallySync's normCode() so both
// tools tolerate the same typos/spacing quirks when matching a rate-sheet code against a reference row.
function normCode(s){
  let v = String(s||'').toLowerCase();
  v = v.replace(/[\u2018\u2019\u201c\u201d]/g, "'").replace(/[\u00d7\u2715]/g,'x');
  v = v.replace(/\bhalf\s*inch\b/g,'1/2x1/2');
  v = v.replace(/(\d)\s*\/\s*(\d)/g,'$1/$2');       // 1 / 2 -> 1/2
  v = v.replace(/\b0?\.5\b/g,'1/2');                  // .5 -> 1/2
  v = v.replace(/\s*x\s*/g,'x');                      // 1 x 1 -> 1x1
  v = v.replace(/\blit\b/g,'lite').replace(/\bhvy\b/g,'heavy').replace(/\bblu\b/g,'blue');
  v = v.replace(/\bgauge\b/g,'g').replace(/(\d)\s*g(?=x|\s|$|[^a-z0-9])/g,'$1');   // 10g and 10gx3 -> 10
  v = v.replace(/\bfeet\b/g,'ft').replace(/'/g,'ft');
  v = v.replace(/[^a-z0-9/.]+/g,' ').replace(/\s+/g,' ').trim();
  return v;
}

function guessCategory(unit, description){
  const u = (unit || '').toUpperCase();
  const d = (description || '').toLowerCase();
  if(d.includes('velcro') || d.includes('shade net')) return 'direct_5pct';
  if(u.includes('PIC') || u.includes('PCS') || u === 'PC') return 'sheet_pics';
  if(u.includes('ROL')) return 'roll_mesh';
  if(u.includes('KG') || u.includes('SQ') || u.includes('FT')) return 'direct';
  return 'direct_flat';
}
// Height is read off the bill's own printed description: normally the LAST ft value is the height
// ("...x 12ft x 5ft" — fixed sheet/roll length first, real height last).
// But some items print the opposite way round: chainlink reads "...x 4.5ft x 90ft", where the
// trailing number is the roll's own LENGTH, not its height. Guessing there produced a height of
// 90 and a badly wrong quantity. No mesh product has a height above 12ft — that's the sheet
// length, and heights run 3/4/5/6ft — so a trailing value above 12 is never a height.
// In that case: return null deliberately, leaving the Height ft box blank so the person checking
// enters it (and the roll's length) by hand. Chosen over auto-picking the second-to-last value:
// a silent guess on an item whose format we already know is unusual is exactly the kind of
// automatic behaviour that makes a wrong number look verified.
const MAX_PLAUSIBLE_HEIGHT_FT = 12;
function guessHeightFt(description){
  const matches = [...(description || '').matchAll(/(\d+(?:\.\d+)?)\s*ft/gi)].map(m => parseFloat(m[1]));
  if(matches.length === 0) return null;
  const last = matches[matches.length - 1];
  if(last > MAX_PLAUSIBLE_HEIGHT_FT) return null; // needs a manual height + length
  return last;
}
function normalizeForMatch(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Returns {bundled, weightKg} — bundled=false means "billed at its exact listed weight, no bundle math"
function getBundleInfo(description){
  const d = normalizeForMatch(description);

  // 0. Item list (Google Sheet) gives a bundle weight for this exact item — that wins.
  const mi = masterSingleForDescription(description);
  if(mi && mi.bundleKg > 0) return { bundled: true, weightKg: mi.bundleKg };

  // 1. Tata MS Wire / Tata Binding Wire — always bundled at 30kg (the one Tata exception).
  if(isTataMsWire(d)) return { bundled: true, weightKg: 30 };

  // 2. Tata Wire / Tata GI Wire, and any other excluded brand (e.g. Supreme) — never bundled.
  if(isTataExcludedWire(d)) return { bundled: false, weightKg: null };
  if(bundleExcludeBrands.some(b => d.includes(b))) return { bundled: false, weightKg: null };

  // 3. Everything else — check the general bundle rules list (GI Wire gauges, MS Wire, wire nails, etc).
  const hit = bundleRules.find(r => d.includes(r.match));
  return hit ? { bundled: true, weightKg: hit.weight } : { bundled: false, weightKg: null };
}
function findCodeLabel(code){
  if(!code) return null;
  const target = normalize(code);
  const hit = itemCodes.find(([c]) => normalize(c) === target);
  if(hit) return hit[1];

  // Fallback: normalised-code match, tolerating spacing/typo variants a rate sheet might have
  // ("lit" vs "lite", "1 x 1" vs "1x1", ".5" vs "1/2", stray spaces). Only trusted when it
  // resolves to exactly one row — a code that fuzzy-matches several reference rows stays
  // unresolved rather than guessing, same as the exact-match path always did.
  const n = normCode(code);
  if(!n) return null;
  const byNorm = itemCodes.filter(([c]) => normCode(c) === n);
  return byNorm.length === 1 ? byNorm[0][1] : null;
}

// Pure text sanity-check between the billed description and the reference table's decoded spec —
// identification only, never touches rate/qty math. Compares mm values (aperture + wire gauge) AND
// the height ft (since a wrong-height Excel row can share the same aperture/gauge and slip through
// on mm alone — the fixed roll/sheet length of 12 or 50 is excluded so it isn't mistaken for height).
function extractMM(text){
  return [...String(text || '').matchAll(/(\d+(?:\.\d+)?)\s*mm/gi)].map(m => parseFloat(m[1]));
}
function extractLabelHeightFt(label){
  const ftValues = [...String(label || '').matchAll(/(\d+(?:\.\d+)?)\s*ft/gi)].map(m => parseFloat(m[1]));
  if(ftValues.length === 0) return null;
  const standardLengths = [12, 50];
  const nonStandard = ftValues.filter(v => !standardLengths.includes(v));
  if(nonStandard.length === 1) return nonStandard[0];
  if(nonStandard.length === 0 && ftValues.length === 1) return ftValues[0];
  return null; // ambiguous — stay silent rather than guess
}
function compareItemSpecs(billDescription, excelLabel){
  const billMM = extractMM(billDescription);
  const excelMM = extractMM(excelLabel);
  const billHeight = guessHeightFt(billDescription);
  const labelHeight = extractLabelHeightFt(excelLabel);

  const mmKnown = billMM.length > 0 && excelMM.length > 0;
  const heightKnown = billHeight !== null && labelHeight !== null;
  if(!mmKnown && !heightKnown) return null; // nothing to compare against — stay silent, don't guess

  const tolerance = 0.05;
  const mmOk = !mmKnown || billMM.every(bv => excelMM.some(ev => Math.abs(ev - bv) <= tolerance));
  const heightOk = !heightKnown || Math.abs(billHeight - labelHeight) <= 0.05;

  return (mmOk && heightOk) ? 'match' : 'mismatch';
}

// Fallback for codes with no reference-table entry (e.g. wire nails), where the Excel shorthand already
// uses the same literal numbers as the bill's own description — unlike weldmesh, which needs the decode
// table because its shorthand numbers (aperture-inch/gauge) don't match the bill's mm spec at all.
// Only ever returns 'match' or null (never 'mismatch') — too risky to call a false negative here confidently,
// since we can't tell in advance whether a given code family is "literal" or "coded" without the decode table.
function extractAllNumbers(text){
  return [...String(text || '').matchAll(/(\d+(?:\.\d+)?)/g)].map(m => parseFloat(m[1]));
}
// v6.1: a rate-sheet code with no numbers at all ("MS Wire", "Binding Wire") can't be matched on
// numbers, so it is matched on its name instead: the code, with spaces and dots removed, must appear
// inside the bill description treated the same way ("MS Wire" is inside "M.S Wire (25kg Bundle) 120").
// Returns null when the code has numbers, so every numbered code keeps the old behaviour exactly.
function nameOnlyCodeMatch(code, description){
  const c = String(code || '');
  if(/\d/.test(c)) return null;
  const nc = normalizeForMatch(c);
  if(nc.length < 4) return null; // too short to trust as a name
  return normalizeForMatch(description).includes(nc) ? 'match' : null;
}
function rawCodeMatch(code, description){
  const codeNums = extractAllNumbers(code);
  const descNums = extractAllNumbers(description);
  if(codeNums.length < 2 || descNums.length === 0) return null;
  const tolerance = 0.05;
  const allFound = codeNums.every(cv => descNums.some(dv => Math.abs(dv - cv) <= tolerance));
  return allFound ? 'match' : null;
}

// The single entry point used both for the assigned row's own check and for searching other rows
// as a "did you mean" suggestion when the assigned one doesn't check out.
function matchExcelRowToDescription(exRow, description){
  if(!exRow) return null;
  const rel = masterCodeRelation(description, exRow.code);
  if(rel === 'same') return 'match';
  if(rel === 'different') return 'mismatch';
  const label = exRow.code ? findCodeLabel(exRow.code) : null;
  if(label){
    const specResult = compareItemSpecs(description, label);
    if(specResult !== null) return specResult; // mm/height comparison had something to work with — trust it
    return rawCodeMatch(label, description); // label has no mm/ft units (e.g. nails) — compare its raw numbers instead
  }
  return rawCodeMatch(exRow.code, description) || nameOnlyCodeMatch(exRow.code, description);
}

// ============ CONTENT-BASED ITEM MATCHING (replaces naive position-based pairing) ============
// Bills don't follow the Excel row order: items get reordered, an item marked qty=0 gets billed
// anyway, an extra item appears. Pairing bill line 1 with Excel row 1, line 2 with row 2, etc.
// meant a single such difference shifted every following line onto the wrong Excel row, cascading
// wrong "expected rate" and wrong item-mismatch flags down the whole invoice.
// Instead: score every (bill line, Excel row) pair on what the item actually IS, then assign
// globally, best pair first. Anything that can't be matched confidently is left unassigned and
// flagged for a manual pick rather than silently paired with whatever sat at that position.
function specNumbers(text){
  const s = String(text || '');
  return {
    mm: [...s.matchAll(/(\d+(?:\.\d+)?)\s*mm/gi)].map(m => parseFloat(m[1])),
    ft: [...s.matchAll(/(\d+(?:\.\d+)?)\s*ft/gi)].map(m => parseFloat(m[1])),
  };
}
// Fraction of values shared between two number lists, each value consumable once (so a spec with
// two 65s only matches another spec that also has two 65s). Divides by the LONGER list, so a
// partial overlap can never score as a perfect match.
function multisetOverlap(a, b, tol){
  if(!a.length && !b.length) return null;
  if(!a.length || !b.length) return 0;
  const used = new Array(b.length).fill(false);
  let hits = 0;
  a.forEach(av => {
    for(let i = 0; i < b.length; i++){
      if(!used[i] && Math.abs(b[i] - av) <= tol){ used[i] = true; hits++; break; }
    }
  });
  return hits / Math.max(a.length, b.length);
}
// 0..1 confidence that a billed line and an Excel row describe the same item.
// Graded rather than yes/no on purpose: a reference spec that's slightly stale on wire thickness
// (say 3.8mm listed where the bill says 4.1mm) still scores well enough on aperture + dimensions
// to win its correct partner, instead of being thrown out and letting a neighbouring row steal it.
const ITEM_MATCH_TOLERANCE = 0.05;
function itemSimilarity(billDescription, exRow){
  if(!exRow || !exRow.code) return null;
  // The item list (Google Sheet) settles it when it knows both sides: the bill's Tally item name
  // and the rate-sheet code. Same item → certain match; two different items → never a match.
  const rel = masterCodeRelation(billDescription, exRow.code);
  if(rel === 'same') return 1.01;
  if(rel === 'different') return 0;
  const label = findCodeLabel(exRow.code);
  if(label){
    const b = specNumbers(billDescription), r = specNumbers(label);
    const mmScore = multisetOverlap(b.mm, r.mm, ITEM_MATCH_TOLERANCE);
    const ftScore = multisetOverlap(b.ft, r.ft, ITEM_MATCH_TOLERANCE);
    if(mmScore !== null || ftScore !== null){
      if(mmScore === null) return ftScore;
      if(ftScore === null) return mmScore;
      return 0.5 * mmScore + 0.5 * ftScore;
    }
  }
  // No decode available (e.g. nails, or a code the reference table doesn't carry): the shorthand
  // itself already uses the same literal numbers the bill prints, so compare those directly.
  if(nameOnlyCodeMatch(exRow.code, billDescription) === 'match') return 0.9;
  return multisetOverlap(extractAllNumbers(exRow.code), extractAllNumbers(billDescription), ITEM_MATCH_TOLERANCE);
}

const MIN_ITEM_MATCH_SCORE = 0.6;
function assignExcelRowsToBillLines(record, block){
  // Skipped (qty=0/blank) rows are candidates too — an item marked "not going out" that still got
  // billed should pair with its OWN Excel row, so the rate check is right and it can be flagged
  // as billed-but-not-dispatched, rather than shunting every later line one row out of step.
  const candidates = [
    ...block.activeRows.map(r => ({ row: r, skipped: false })),
    ...(block.skippedRows || []).map(r => ({ row: r, skipped: true })),
  ];
  const scores = record.items.map(item =>
    candidates.map(c => {
      const s = itemSimilarity(item.description, c.row);
      return (s === null || isNaN(s)) ? 0 : s;
    })
  );

  const assignment = new Array(record.items.length).fill(null);
  const taken = new Set();
  // Repeatedly commit the single most confident unambiguous pair, then re-evaluate. Committing the
  // certain ones first is what resolves the near-ties: two rows differing only in wire thickness
  // both look plausible for a line, but once each one's exact partner claims it, only one remains
  // for the other line and the ambiguity dissolves on the next pass.
  while(true){
    let pick = null;
    for(let b = 0; b < record.items.length; b++){
      if(assignment[b] !== null) continue;
      let bestIdx = -1, best = -1, tie = 0;
      for(let c = 0; c < candidates.length; c++){
        if(taken.has(c)) continue;
        const s = scores[b][c];
        if(s > best + 1e-9){ best = s; bestIdx = c; tie = 1; }
        else if(Math.abs(s - best) <= 1e-9){ tie++; }
      }
      if(bestIdx < 0 || best < MIN_ITEM_MATCH_SCORE) continue;
      if(tie > 1) continue; // still ambiguous this pass — may resolve once other lines claim theirs
      if(!pick || best > pick.score) pick = { b, c: bestIdx, score: best };
    }
    if(!pick) break;
    assignment[pick.b] = pick.c;
    taken.add(pick.c);
  }
  return { assignment, candidates };
}

// ===================== RULES PANEL =====================
function renderRulesPanel(){
  let html = `<h3>Pricing rules</h3><p class="desc">These control how the expected rate is computed. Excel rates are always treated as tax-inclusive.</p>`;
  html += `<div class="rule-row head"><span>Category</span><span>Formula</span><span>Length ft</span><span>Tax %</span><span>Decimals</span></div>`;
  Object.keys(rules).forEach(key => {
    const r = rules[key];
    html += `<div class="rule-row">
      <span>${r.label}</span>
      <span style="font-family:'IBM Plex Mono',monospace; color:var(--ink-soft);">${
        key === 'sheet_pics' || key === 'roll_mesh'
          ? 'ceil(height × length × rate ÷ tax)'
          : 'ceil(rate ÷ tax)'
      }</span>
      <span>${'lengthFt' in r ? `<input class="cell-input" data-rule="${key}" data-field="lengthFt" value="${r.lengthFt}">` : '—'}</span>
      <span><input class="cell-input" data-rule="${key}" data-field="tax" value="${r.tax}"></span>
      <span><input class="cell-input" data-rule="${key}" data-field="decimals" value="${r.decimals}"></span>
    </div>`;
  });
  html += `<div class="rule-row head" style="margin-top:10px;"><span>Bundled items (25kg etc.)</span><span colspan="3"></span></div>`;
  html += `<p class="desc" style="margin:4px 0 10px;">Only items matched here get Excel qty × weight bundle math and a bundle-divisibility check. Any other KG item (including Tata/Supreme-branded wire) is billed at its exact listed weight, no conversion.</p>`;
  bundleRules.forEach((r, i) => {
    html += `<div class="rule-row"><span><input class="cell-input" data-bundle-idx="${i}" data-bundle-field="label" value="${escapeHtml(r.label)}" style="width:100%;"></span><span style="font-size:11px; color:var(--ink-soft); font-family:'IBM Plex Mono',monospace;">matches: "${escapeHtml(r.match)}"</span><span><input class="cell-input" data-bundle-idx="${i}" data-bundle-field="weight" value="${r.weight}" style="width:60px;"> kg</span><span></span><span><span class="fill-btn" data-remove-bundle="${i}" style="cursor:pointer;">✕ remove</span></span></div>`;
  });
  html += `<div class="add-code-row" style="margin-top:10px;">
    <input class="code-in" id="newBundleLabelIn" placeholder="Label, e.g. GI Wire 26g">
    <input class="code-in" id="newBundleMatchIn" placeholder="matches text, e.g. giwire26g" style="width:180px;">
    <input class="cell-input" id="newBundleWeightIn" placeholder="kg" style="width:60px;">
    <button id="addBundleBtn">+ Add bundled item</button>
  </div>
  <p class="desc" style="margin-top:8px;">Brand names always excluded from bundling regardless of the list above: ${bundleExcludeBrands.map(b=>escapeHtml(b)).join(', ')}. Tata Wire and Tata GI Wire are also always excluded — <b>except</b> Tata MS Wire (billed as "Tata Binding Wire"), which is the one Tata item that IS bundled, always at 30kg. This Tata logic is fixed in code, not editable from this panel — change it in the code if needed.</p>`;
  rulesPanel.innerHTML = html;

  rulesPanel.querySelectorAll('input[data-rule]').forEach(inp => {
    inp.addEventListener('change', () => {
      const key = inp.dataset.rule, field = inp.dataset.field;
      rules[key][field] = parseFloat(inp.value) || 0;
      savePersisted();
      document.querySelectorAll('.invoice-card').forEach(c => recalcCard(c));
    });
  });
  rulesPanel.querySelectorAll('input[data-bundle-idx]').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = parseInt(inp.dataset.bundleIdx, 10);
      const field = inp.dataset.bundleField;
      bundleRules[idx][field] = field === 'weight' ? (parseFloat(inp.value) || 0) : inp.value;
      savePersisted();
      document.querySelectorAll('.invoice-card').forEach(c => recalcCard(c));
    });
  });
  rulesPanel.querySelectorAll('[data-remove-bundle]').forEach(el => {
    el.addEventListener('click', () => {
      bundleRules.splice(parseInt(el.dataset.removeBundle, 10), 1);
      savePersisted();
      renderRulesPanel();
      document.querySelectorAll('.invoice-card').forEach(c => recalcCard(c));
    });
  });
  const addBundleBtn = document.getElementById('addBundleBtn');
  if(addBundleBtn){
    addBundleBtn.addEventListener('click', () => {
      const label = document.getElementById('newBundleLabelIn').value.trim();
      const matchRaw = document.getElementById('newBundleMatchIn').value.trim();
      const weight = parseFloat(document.getElementById('newBundleWeightIn').value) || 0;
      if(!label || !matchRaw || !weight) return;
      bundleRules.push({ label, match: normalizeForMatch(matchRaw), weight });
      savePersisted();
      renderRulesPanel();
      document.querySelectorAll('.invoice-card').forEach(c => recalcCard(c));
    });
  }
}

// ===================== CODE REFERENCE PANEL =====================
function renderCodesPanel(){
  let html = `<h3>Item code reference</h3><p class="desc">Shorthand codes from your rate sheet, decoded to full specs. Used two ways: shown next to matched rows so you can eyeball that Excel and the bill agree, and to auto-compare specs so a likely mismatch gets flagged before you have to spot it yourself. This table is <b>not</b> used in the rate math (that only needs height + 12ft/50ft, both read straight off the bill) — it's for item identification only.</p>`;
  html += `<div class="code-search-row"><input type="text" id="codeSearchIn" placeholder="Search code or full spec…"></div>`;
  html += `<div class="code-scroll"><table class="code-table">
    <colgroup><col style="width:190px;"><col><col style="width:28px;"></colgroup>
    <thead><tr><th>Code</th><th>Full spec</th><th></th></tr></thead>
    <tbody id="codeTableBody"></tbody>
  </table></div>`;
  html += `<div class="add-code-row">
    <input class="code-in" id="newCodeIn" placeholder="new code, e.g. 2x2x12x6 5mm">
    <input class="label-in" id="newLabelIn" placeholder="full spec, e.g. GI Sheet Weldmesh 65mm x 65mm x 4.1mm x 12ft x 6ft">
    <button id="addCodeBtn">+ Add</button>
  </div>`;
  html += `<div class="bulk-paste-box">
    <p class="desc" style="margin:12px 0 6px;">Or paste many at once — one per line, code and full spec separated by a Tab or 2+ spaces (same layout as a copied Excel column pair):</p>
    <textarea id="bulkCodeIn" placeholder="2x2x12x6 5mm&#9;GI Sheet Weldmesh 65mm x 65mm x 4.1mm x 12ft x 6ft
1x1x8x6&#9;GI Weldmesh 40mm x 40mm x 2.8mm x 6ft x 50ft"></textarea>
    <button id="bulkAddCodeBtn">+ Add all lines</button>
    <span id="bulkAddStatus" class="bulk-add-status"></span>
  </div>`;
  codesPanel.innerHTML = html;

  // Search box lives outside the scrolling table and is never re-rendered while typing —
  // only the tbody rows underneath it are rebuilt, so focus/cursor position survive every keystroke.
  const searchIn = document.getElementById('codeSearchIn');
  searchIn.addEventListener('input', () => renderCodeRows(searchIn.value));

  document.getElementById('addCodeBtn').addEventListener('click', () => {
    const code = document.getElementById('newCodeIn').value.trim();
    const label = document.getElementById('newLabelIn').value.trim();
    if(!code || !label) return;
    itemCodes.push([code, label]);
    savePersisted();
    document.getElementById('newCodeIn').value = '';
    document.getElementById('newLabelIn').value = '';
    renderCodeRows(searchIn.value);
  });
  document.getElementById('bulkAddCodeBtn').addEventListener('click', () => {
    const raw = document.getElementById('bulkCodeIn').value;
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    let added = 0, skipped = 0;
    lines.forEach(line => {
      const parts = line.split(/\t+| {2,}/).map(p => p.trim()).filter(Boolean);
      if(parts.length < 2){ skipped++; return; }
      const code = parts[0];
      const label = parts.slice(1).join(' ');
      itemCodes.push([code, label]);
      added++;
    });
    const status = document.getElementById('bulkAddStatus');
    status.textContent = `Added ${added}${skipped ? `, skipped ${skipped} (no separator found)` : ''}.`;
    if(added > 0){
      savePersisted();
      renderCodeRows(searchIn.value);
    }
  });

  renderCodeRows(''); // initial, unfiltered
}

// Rebuilds only the <tbody> rows — never touches the search input itself, so its focus and
// cursor position survive every keystroke. Filters by substring match against either the code
// or the full spec, case-insensitive. Row indices reference the real position in itemCodes
// (not the filtered list), so edits/removals always hit the correct entry.
function renderCodeRows(filterText){
  const tbody = document.getElementById('codeTableBody');
  if(!tbody) return;
  const q = (filterText || '').trim().toLowerCase();
  const visible = itemCodes
    .map((pair, i) => ({ code: pair[0], label: pair[1], i }))
    .filter(r => !q || r.code.toLowerCase().includes(q) || r.label.toLowerCase().includes(q));

  tbody.innerHTML = visible.map(({code, label, i}) => `
    <tr>
      <td class="code"><input class="cell-input" data-code-idx="${i}" data-code-field="0" value="${escapeHtml(code)}" style="width:100%;"></td>
      <td class="spec"><input class="cell-input" data-code-idx="${i}" data-code-field="1" value="${escapeHtml(label)}" style="width:100%;"></td>
      <td><span class="fill-btn" data-remove-code="${i}" style="cursor:pointer;">✕</span></td>
    </tr>
  `).join('');

  if(q && visible.length === 0){
    tbody.innerHTML = `<tr><td colspan="3" style="padding:14px 6px; color:var(--ink-soft); font-style:italic;">No codes match "${escapeHtml(filterText)}"</td></tr>`;
  }

  tbody.querySelectorAll('input[data-code-idx]').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = parseInt(inp.dataset.codeIdx, 10);
      const field = parseInt(inp.dataset.codeField, 10);
      itemCodes[idx][field] = inp.value;
      savePersisted();
      document.querySelectorAll('.invoice-card').forEach(c => {
        const record = window.__records.find(r => r.id === c.dataset.recordId);
        if(record) updateItemPreview(c, record);
      });
    });
  });
  tbody.querySelectorAll('[data-remove-code]').forEach(el => {
    el.addEventListener('click', () => {
      itemCodes.splice(parseInt(el.dataset.removeCode, 10), 1);
      savePersisted();
      const searchIn = document.getElementById('codeSearchIn');
      renderCodeRows(searchIn ? searchIn.value : '');
      document.querySelectorAll('.invoice-card').forEach(c => {
        const record = window.__records.find(r => r.id === c.dataset.recordId);
        if(record) updateItemPreview(c, record);
      });
    });
  });
}

// ===================== EXCEL PARSING =====================
// Sheet is grouped: a row with only a name in column B = new customer block.
// Following rows: [description, qty, rate]. Blank rate = inherit previous row's rate.
function parseExcelWorkbook(arrayBuffer){
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const blocks = [];
  let current = null;
  let lastRate = null;

  rows.forEach(r => {
    // sheet_to_json(header:1) indexes columns starting at the sheet's used range
    // (here the data starts at column B), so index 0 is already the description column.
    const b = r[0];
    const c = r[1];
    const d = r[2];

    if(b == null || String(b).trim() === '') return; // fully blank row -> ignore
    const isHeaderRow = (c === null || c === undefined) && (d === null || d === undefined);
    if(isHeaderRow){
      current = { customerName: String(b).trim(), rows: [] };
      blocks.push(current);
      lastRate = null;
      return;
    }
    if(!current) return; // stray item row before any customer header — skip
    const qty = (c === null || c === undefined || c === '') ? null : Number(c);
    let rate = (d === null || d === undefined || d === '') ? null : Number(d);
    if(rate === null || isNaN(rate)){
      rate = lastRate; // inherit
    }else{
      lastRate = rate;
    }
    current.rows.push({ code: String(b).trim(), qty: (qty !== null && !isNaN(qty)) ? qty : null, rate: rate });
  });

  // Split each block into rows actually expected to be billed (activeRows — used for positional matching)
  // and rows marked qty=0 OR left blank (skippedRows — cancelled/unavailable/not loaded, not part of the
  // billing sequence at all, so they must never shift the positional alignment of everything after them).
  // Matches TallySync's parseExcelWorkbook, which drops qty===0 and qty===null rows the same way when
  // reading the identical rate sheet — a blank qty cell means "no line for this customer today", same
  // as an explicit 0, not "expected but not yet filled in".
  blocks.forEach(block => {
    block.activeRows = block.rows.filter(r => r.qty !== 0 && r.qty !== null);
    block.skippedRows = block.rows.filter(r => r.qty === 0 || r.qty === null);
  });

  return { blocks };
}

// ===================== PARTY MATCHING =====================
// Character-bigram Dice-coefficient scoring, ported from TallySync's findParty(). Handles
// abbreviations and missing location suffixes ("Deepu Agencies" vs "Deepu Agencies, Kayamkulam")
// without matching two genuinely different customers that merely share a common word — the old
// version here just counted shared tokens and took the top score with no ambiguity check, which
// is a real risk in an audit tool: a wrong silent match pre-fills every line's rate/qty from the
// wrong customer's Excel data before a human ever looks at it.
function bigrams(s){
  const v = ' ' + normalize(s) + ' ';
  const out = new Set();
  for(let i=0;i<v.length-1;i++) out.add(v.slice(i,i+2));
  return out;
}
function dice(a,b){
  if(!a.size || !b.size) return 0;
  let hits = 0; a.forEach(g => { if(b.has(g)) hits++; });
  return (2*hits)/(a.size+b.size);
}
function guessBestBlock(buyerName, blocks){
  const want = bigrams(buyerName);
  let best = null, bestScore = 0, second = 0;
  blocks.forEach(block => {
    const sc = dice(want, bigrams(block.customerName));
    if(sc > bestScore){ second = bestScore; bestScore = sc; best = block; }
    else if(sc > second){ second = sc; }
  });
  // needs to be both strong and clearly ahead of the runner-up — otherwise stay silent and
  // leave selectedBlockName unset, forcing a manual pick from the dropdown instead of a guess.
  return (bestScore >= 0.68 && bestScore - second >= 0.06) ? best : null;
}

// unit-aware conversion of an Excel qty (bags/rolls/pieces) to the bill's billed unit,
// so it can prefill "ordered qty" for comparison against the billed qty.
function convertExcelQtyToBilledUnit(excelQty, row){
  if(excelQty === null || excelQty === undefined || isNaN(excelQty)) return null;
  const u = (row.unit || '').toUpperCase();
  if(u.includes('KG')){
    const info = getBundleInfo(row.description);
    return info.bundled ? excelQty * info.weightKg : excelQty; // bundled: bags->kg; direct-weight items: Excel qty already IS the kg amount
  }
  if(u.includes('ROL') || u.includes('PIC') || u.includes('PCS') || u === 'PC') return excelQty;
  if((u.includes('SQ') || u.includes('FT')) && row.heightFt !== null && !isNaN(row.heightFt)){
    // A manually entered Length ft overrides the hardcoded 50ft assumption — needed for anything
    // that isn't a standard 50ft roll (e.g. chainlink, which comes in its own width x length per
    // roll, not a fixed length). Previously this field had no effect here at all: it only fed the
    // rate formula for Roll mesh/Sheet categories, so typing a length for a Direct sq.ft item like
    // this silently did nothing — this is the fix for that.
    const lengthFt = (row.customLengthFt !== null && row.customLengthFt !== '' && !isNaN(row.customLengthFt))
      ? row.customLengthFt
      : 50;
    return excelQty * row.heightFt * lengthFt;
  }
  return excelQty; // best-effort passthrough, unit mismatch — user should sanity check
}

// Safety net for lines the assignment couldn't pair confidently: if such a line still looks like a
// qty=0 Excel row, flag it anyway. Assigned lines are left alone — their own matched row already
// decided this above, and re-deciding here could contradict it.
function checkNotDispatchedButBilled(record, block){
  if(!block.skippedRows || !block.skippedRows.length) return;
  block.skippedRows.forEach(skipped => {
    const label = findCodeLabel(skipped.code);
    if(!label) return; // no reference decode available — can't auto-check this one, needs a manual eye
    record.items.forEach(row => {
      if(row.excelCode) return;            // already confidently assigned — not this pass's business
      if(row.notDispatchedButBilled) return; // already matched to a different skipped item
      if(compareItemSpecs(row.description, label) === 'match'){
        row.notDispatchedButBilled = true;
        row.notDispatchedCode = skipped.code;
      }
    });
  });
}

const DET_COLS = { slno:[0,40], desc:[40,330], hsn:[330,380], qty:[380,440], rate:[440,483], per:[483,528], amt:[528,9999] };
function detColOf(it){
  const x = it.x;   // Ernakulam: placed by the text's LEFT edge (as calibrated on EKM bills)
  for(const name in DET_COLS){ const [lo,hi] = DET_COLS[name]; if(x >= lo && x < hi) return name; }
  return null;
}

// ===================== ROW COMPUTATION =====================
function computeRow(row){
  const rule = rules[row.category] || rules.direct;
  const taxDivisor = 1 + (rule.tax / 100);
  // A manually entered length overrides the category's default 12ft/50ft — for the rare item
  // that genuinely comes in a non-standard length (e.g. a 100ft roll instead of the usual 50ft).
  // Blank means "use the category default", same as it always did.
  const lengthFt = (row.customLengthFt !== null && row.customLengthFt !== '' && !isNaN(row.customLengthFt))
    ? row.customLengthFt
    : rule.lengthFt;
  let expectedRate = null;
  if(row.quotedRate !== null && row.quotedRate !== '' && !isNaN(row.quotedRate)){
    if(row.category === 'sheet_pics' || row.category === 'roll_mesh'){
      const height = row.heightFt;
      if(height !== null && !isNaN(height)){
        expectedRate = ceilTo((height * lengthFt * row.quotedRate) / taxDivisor, rule.decimals);
      }
    }else{
      expectedRate = ceilTo(row.quotedRate / taxDivisor, rule.decimals);
    }
  }
  const expectedAmount = expectedRate !== null ? expectedRate * row.quantity : null;
  // ---- Rate tolerance: fixed ₹ amount, chosen by category — NOT a % of the rate ----
  // Roll (roll_mesh) & Sheet (sheet_pics): ₹1 flat, since these rates are height-multiplied and
  // can legitimately land a rupee off after rounding.
  // Direct, 5% items (Velcro/Shade Net) and Direct, flat rate (PCS/NOS/ROLL): ₹0.50 flat.
  // Direct (KG / sq.ft): ₹0 — these should match exactly.
  let tolerance = null;
  if(expectedRate !== null){
    if(row.category === 'sheet_pics' || row.category === 'roll_mesh'){
      tolerance = 1;
    }else if(row.category === 'direct_5pct' || row.category === 'direct_flat'){
      tolerance = 0.5;
    }else{
      tolerance = 0; // direct (KG / sq.ft)
    }
  }
  const rateMismatch = expectedRate !== null && Math.abs(row.rate - expectedRate) > tolerance;

  let bundleWarning = null;
  if((row.unit || '').toUpperCase().includes('KG')){
    const info = getBundleInfo(row.description);
    if(info.bundled){
      const rem = row.quantity % info.weightKg;
      if(rem > 0.05 && (info.weightKg - rem) > 0.05){
        bundleWarning = `${row.quantity}kg doesn't divide evenly into ${info.weightKg}kg bundles`;
      }
    }
  }

  // ---- Qty tolerance: removed. Only a hairline epsilon survives, to absorb floating-point
  // noise from unit conversions (e.g. bags->kg), not to forgive any real-world discrepancy. ----
  // Skipped when notDispatchedButBilled is already set: that flag's own message says the same
  // thing more clearly ("not dispatched but billed 3") than a generic "actual qty 0, billed
  // qty is 3" would, so showing both was pure repetition.
  let qtyMismatch = false, qtyWarning = null;
  if(!row.notDispatchedButBilled && row.orderedQty !== null && !isNaN(row.orderedQty)){
    const qtyEpsilon = 1e-6;
    if(Math.abs(row.orderedQty - row.quantity) > qtyEpsilon){
      qtyMismatch = true;
      qtyWarning = `Actual qty ${fmtQty(row.orderedQty)}, billed qty is ${fmtQty(row.quantity)}`;
    }
  }

  // rate-mismatch narration, so a screenshot alone explains the discrepancy
  let rateWarning = null;
  if(rateMismatch){
    const diff = row.rate - expectedRate;
    const pct = expectedRate !== 0 ? Math.abs(diff / expectedRate * 100) : 0;
    rateWarning = diff > 0
      ? `Billed ₹${fmt(row.rate)} vs expected ₹${fmt(expectedRate)} — over by ₹${fmt(Math.abs(diff))} (${pct.toFixed(1)}%)`
      : `Billed ₹${fmt(row.rate)} vs expected ₹${fmt(expectedRate)} — short by ₹${fmt(Math.abs(diff))} (${pct.toFixed(1)}%)`;
  }

  const itemMismatch = !!row.itemNameMismatch;
  const itemMismatchWarning = itemMismatch ? 'Item name Mismatch' : null;

  // Simplified per feedback: the code reference (e.g. "1x1x10x5") reads as noise in a screenshot
  // meant for someone else to read at a glance — just say what happened and how much.
  const notDispatched = !!row.notDispatchedButBilled;
  const notDispatchedWarning = notDispatched ? `Item not dispatched but billed ${fmtQty(row.quantity)}` : null;

  const pending = expectedRate === null;

  return { expectedRate, expectedAmount, flagged: rateMismatch || qtyMismatch || itemMismatch || notDispatched, pending, bundleWarning, qtyMismatch, qtyWarning, rateMismatch, rateWarning, itemMismatch, itemMismatchWarning, notDispatched, notDispatchedWarning };
}

// ---- Persistence of this branch's own settings (shared code saves the log, report, version) ----
async function branchSavePersisted(){
  await window.storage.set('btc_rules', JSON.stringify({rules, bundleRules}), false);
  await window.storage.set('btc_item_codes_v2', JSON.stringify(itemCodes), false);
}
async function branchLoadPersisted(){
  try{
    const r = await window.storage.get('btc_rules', false);
    if(r && r.value){
      const p = JSON.parse(r.value);
      // Merge rather than replace: any category key already known to the code keeps its label
      // (labels aren't user-editable) but takes lengthFt/tax/decimals from what was saved; a
      // category that's new in this version of the tool (e.g. added after a rules split) simply
      // keeps its fresh default until the user edits it, instead of vanishing because the old
      // saved blob didn't know about it yet.
      if(p.rules){
        Object.keys(defaultRules).forEach(key => {
          if(p.rules[key]) rules[key] = { ...defaultRules[key], ...p.rules[key], label: defaultRules[key].label };
        });
      }
      if(p.bundleRules) bundleRules = p.bundleRules;
    }
  }catch(e){}
  try{
    const c = await window.storage.get('btc_item_codes_v2', false);
    if(c && c.value){ const p = JSON.parse(c.value); if(Array.isArray(p) && p.length) itemCodes = p; }
    // v6.1: a code list saved by an earlier version replaces the built-in one, so codes added to the
    // built-in list later would never reach it. Codes new in v6.1 are merged in once (skipping any code
    // already present), then marked done so a code deliberately removed afterwards stays removed.
    const seed = await window.storage.get('btc_codes_seed', false);
    if(!seed || seed.value !== 'v6.1'){
      V61_NEW_CODES.forEach(pair => {
        if(!itemCodes.some(([code]) => normalize(code) === normalize(pair[0]))) itemCodes.push(pair.slice());
      });
      await window.storage.set('btc_codes_seed', 'v6.1', false);
      await window.storage.set('btc_item_codes_v2', JSON.stringify(itemCodes), false);
    }
  }catch(e){}
}

// ---- v7: rules shared through the Google Sheet (Rules tab) -----------------------------------
function branchRulesSnapshot(){ return { rules, bundleRules }; }
function branchApplyRules(p){
  if(!p) return;
  if(p.rules){
    Object.keys(defaultRules).forEach(key => {
      if(p.rules[key]) rules[key] = { ...defaultRules[key], ...p.rules[key], label: defaultRules[key].label };
    });
  }
  if(Array.isArray(p.bundleRules)) bundleRules = p.bundleRules;
}

// ---- v7: item list from the Google Sheet (EKM Items tab) ------------------------------------
// When the sheet has items, they replace the built-in code list: every code and "other code /
// spelling" on a row decodes to that row's Tally item name. Until then the built-in list is used.
let builtInItemCodes = null;
function branchApplyMaster(items){
  if(!builtInItemCodes) builtInItemCodes = itemCodes;
  if(!items || !items.length){ itemCodes = builtInItemCodes; return; }
  const pairs = [];
  items.forEach(it => {
    if(!it.name) return;
    [it.code, ...splitList(it.other)].filter(Boolean).forEach(c => pairs.push([c, it.name]));
  });
  itemCodes = pairs;
}
// The built-in list, in the sheet's column layout — used to fill an empty EKM Items tab once.
function branchBuiltInItems(){
  const byName = new Map();
  (builtInItemCodes || itemCodes).forEach(([code, name]) => {
    const k = normalize(name);
    if(!byName.has(k)) byName.set(k, { code, name, other: [] });
    else byName.get(k).other.push(code);
  });
  return [...byName.values()].map(r => ({ code: r.code, name: r.name, other: r.other.join(', ') }));
}

// ============================ END BRANCH FORMULAS — ERNAKULAM ============================
