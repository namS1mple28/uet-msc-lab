import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Chỉ lấy phần chemistry engine từ source canonical. Không sửa hoặc import HTML
// generated; các test này cố ý chạy trực tiếp các hàm đang có trong msc-lab.html.
const source = await readFile(new URL('../src/msc-lab.html', import.meta.url), 'utf8');
const chemistryStart = source.indexOf('const ION=');
const chemistryEnd = source.indexOf('/* ============================================================\n   BÀN THÍ NGHIỆM ẢO', chemistryStart);
const transferStart = source.indexOf('function transferDissolved(');
const transferEnd = source.indexOf('/* nối ống dẫn khí với hai bình gần nhất */', transferStart);
assert.ok(chemistryStart >= 0, 'chemistry start marker must exist');
assert.ok(chemistryEnd > chemistryStart, 'chemistry end marker must exist');
assert.ok(transferStart >= 0 && transferEnd > transferStart, 'chemistry transfer markers must exist');

function loadChemistry() {
  const context = {
    console,
    Math,
    Number,
    Object,
    Array,
    String,
    isFinite,
    Kw: 1e-14,
    fmt: (value, digits = 3) => Number(value).toFixed(digits),
    renderTouchActions: () => {},
    clampPh: (value) => Math.max(0, Math.min(14, value)),
    parseColor: () => [80, 80, 80],
    hex2rgb: () => [80, 80, 80],
    performance: { now: () => 0 },
    spawnPrecip: () => {},
    note2: () => {},
    toast: () => {},
    logRxn: () => {},
    refreshLab: () => {},
    setTimeout: () => {},
    pourFx: null,
  };
  const block = source.slice(chemistryStart, chemistryEnd);
  const transferBlock = source.slice(transferStart, transferEnd);
  const exportCode = `
    globalThis.__chem = {
      BENCH, GEAR, REAGENTS, ION, PRECIP, REDOX,
      newVessel, pourInto, pourBetween, filterThrough, react,
      tubePh, tubeColor, pushCplx, pushPrecip, addIon, ionOf, trim,
    };
  `;
  vm.runInNewContext(`${block}\n${transferBlock}\n${exportCode}`, context, { filename: 'msc-lab-chemistry.js' });
  return context.__chem;
}

function loadReagentSelection() {
  const button = {
    disabled: true,
    textContent: '',
    title: '',
    setAttribute(name, value) { this[name] = value; },
  };
  const state = {
    textContent: '',
    classList: { toggle(name, value) { state[name] = value; } },
  };
  const dose = { value: '5' };
  const context = {
    $: (selector) => ({
      '#mClearChem': button,
      '#benchState': state,
      '#mDose': dose,
    }[selector] || null),
    document: { querySelectorAll: () => [] },
    String,
    Number,
    Math,
    isFinite,
    fmt: (value, digits = 3) => Number(value).toFixed(digits),
    renderTouchActions: () => {},
    __button: button,
    __state: state,
    __dose: dose,
  };
  const selectionStart = source.indexOf('function setHeldReagent(');
  const selectionEnd = source.indexOf('function newVessel(', selectionStart);
  assert.ok(selectionStart >= 0 && selectionEnd > selectionStart, 'selection hooks must exist');
  vm.runInNewContext(`let heldReagent=null;
    const button=globalThis.__button, state=globalThis.__state, dose=globalThis.__dose;
    ${source.slice(selectionStart, selectionEnd)}
    globalThis.__selection = { setHeldReagent, selectedDoseMl, button, state, dose };
  `, context, { filename: 'msc-lab-selection.js' });
  return context.__selection;
}

function vessel(chem, type = 'tube') {
  const result = chem.newVessel(type, 0, 0);
  chem.BENCH.push(result);
  return result;
}

test('AcOH + NH3 equimolar is near neutral and conserves both analytical families', () => {
  const chem = loadChemistry();
  const target = vessel(chem);
  chem.pourInto(target, chem.REAGENTS.find((reagent) => reagent.id === 'AcOH'), 25);
  chem.pourInto(target, chem.REAGENTS.find((reagent) => reagent.id === 'NH3'), 25);

  assert.ok(Math.abs(chem.tubePh(target) - 7) < 0.25,
    `equimolar ammonium acetate should be near pH 7, got ${chem.tubePh(target)}`);
  assert.ok(Math.abs((target.weakA + chem.ionOf(target, 'Ac')) - 0.025) < 1e-12,
    'acetate analytical family must be conserved');
  assert.ok(Math.abs((target.weakB + chem.ionOf(target, 'NH4')) - 0.025) < 1e-12,
    'ammonia/ammonium analytical family must be conserved');
});

test('permanganate-oxalate consumes 16 H+ per 2 permanganates', () => {
  const chem = loadChemistry();
  const target = vessel(chem);
  chem.addIon(target, 'MnO4', 0.002);
  chem.addIon(target, 'C2O4', 0.005);
  chem.addIon(target, 'H', 0.006); // insufficient for the 16 H+ equation
  chem.react(target);

  // With 16 H+ stoichiometry, at most 0.000375 mol reaction extent is possible.
  assert.ok(chem.ionOf(target, 'MnO4') >= 0.00125 - 1e-12,
    `insufficient H+ must leave MnO4-, got ${chem.ionOf(target, 'MnO4')}`);
});

test('Fe3+ + carbonate stores the stoichiometric three mol CO2 per extent', () => {
  const chem = loadChemistry();
  const target = vessel(chem);
  chem.addIon(target, 'Fe3', 0.002);
  chem.addIon(target, 'CO3', 0.003);
  chem.react(target);

  assert.ok(Math.abs((target.co2 || 0) - 0.003) < 1e-12,
    `Fe3+/carbonate should produce 0.003 mol CO2, got ${target.co2 || 0}`);
});

test('partial filtration keeps the unfiltered precipitate in the source', () => {
  const chem = loadChemistry();
  const src = vessel(chem);
  const dst = vessel(chem);
  const funnel = { attach: dst.id, residue: [] };
  src.vol = 10;
  dst.vol = 20; // only half of source volume can enter the 25 mL receiver
  src.precip = [{ f: 'BaSO4', color: '#fff', cname: 'trắng', mol: 0.01, M: 233.4 }];
  chem.filterThrough(src, funnel);

  assert.ok(Math.abs(src.precip[0].mol - 0.005) < 1e-12,
    `source should retain 0.005 mol precipitate, got ${src.precip[0]?.mol}`);
  assert.ok(Math.abs(funnel.residue[0].mol - 0.005) < 1e-12,
    `filter should retain 0.005 mol precipitate, got ${funnel.residue[0]?.mol}`);
});

test('pouring a fraction transfers dissolved complex instead of duplicating it at source', () => {
  const chem = loadChemistry();
  const src = vessel(chem);
  const dst = vessel(chem);
  src.vol = 10;
  dst.vol = 20; // half of source can be transferred
  chem.pushCplx(src, { f: '[Cu(NH3)4]2+', color: '#1B3FB0', cname: 'xanh' }, 0.001);
  chem.pourBetween(src, dst);

  assert.ok(Math.abs(src.cplx[0].mol - 0.0005) < 1e-12,
    `source complex should be halved, got ${src.cplx[0]?.mol}`);
  assert.ok(Math.abs(dst.cplx[0].mol - 0.0005) < 1e-12,
    `receiver should contain transferred complex, got ${dst.cplx[0]?.mol}`);
});

test('reagent dose selection is reflected in state and cancel clears the held reagent', () => {
  const selection = loadReagentSelection();
  const hcl = { id: 'HCl', f: 'HCl', n: 'Axit clohiđric' };

  assert.equal(selection.selectedDoseMl(), 5);
  selection.setHeldReagent(hcl);
  assert.equal(selection.button.disabled, false);
  assert.equal(selection.button.textContent, 'Bỏ chọn HCl');
  assert.match(selection.state.textContent, /Đang cầm HCl/);
  assert.match(selection.state.textContent, /5(?:\.0)? mL/);

  selection.setHeldReagent(null);
  assert.equal(selection.button.disabled, true);
  assert.equal(selection.button.textContent, 'Bỏ chọn hóa chất');
  assert.equal(selection.state.textContent, 'Không cầm hóa chất');
});

function silverCompetition(anionOrder) {
  const chem = loadChemistry();
  const target = vessel(chem);
  target.vol = 30;
  chem.addIon(target, 'Ag', 0.001);
  chem.react(target);
  for (const anion of anionOrder) {
    chem.addIon(target, anion, 0.001);
    chem.react(target);
  }
  return Object.fromEntries(target.precip.map((record) => [record.f, record.mol]));
}

test('Ag+ / Cl- / I- precipitation is order-invariant and favors AgI by Ksp', () => {
  const chlorideFirst = silverCompetition(['Cl', 'I']);
  const iodideFirst = silverCompetition(['I', 'Cl']);
  assert.ok((chlorideFirst.AgI || 0) > 9e-4, `Cl then I should end mostly as AgI: ${JSON.stringify(chlorideFirst)}`);
  assert.ok((iodideFirst.AgI || 0) > 9e-4, `I then Cl should end mostly as AgI: ${JSON.stringify(iodideFirst)}`);
  assert.ok(Math.abs((chlorideFirst.AgI || 0) - (iodideFirst.AgI || 0)) < 1e-6,
    'final AgI amount should not depend on reagent order');
  assert.ok(Math.abs((chlorideFirst.AgCl || 0) - (iodideFirst.AgCl || 0)) < 1e-6,
    'final AgCl amount should not depend on reagent order');
});

test('Ksp exchange conserves silver and both halide analytical totals', () => {
  const chem = loadChemistry();
  const target = vessel(chem);
  target.vol = 30;
  chem.addIon(target, 'Ag', 0.001);
  chem.addIon(target, 'Cl', 0.001);
  chem.addIon(target, 'I', 0.001);
  chem.react(target);

  const precip = (formula) => target.precip.find((record) => record.f === formula)?.mol || 0;
  const silverTotal = chem.ionOf(target, 'Ag') + precip('AgCl') + precip('AgI');
  const chlorideTotal = chem.ionOf(target, 'Cl') + precip('AgCl');
  const iodideTotal = chem.ionOf(target, 'I') + precip('AgI');
  assert.ok(Math.abs(silverTotal - 0.001) < 1e-10, `Ag not conserved: ${silverTotal}`);
  assert.ok(Math.abs(chlorideTotal - 0.001) < 1e-10, `Cl not conserved: ${chlorideTotal}`);
  assert.ok(Math.abs(iodideTotal - 0.001) < 1e-10, `I not conserved: ${iodideTotal}`);
});

function hydroxideCompetition() {
  const chem = loadChemistry();
  const target = vessel(chem);
  target.vol = 1000;
  chem.addIon(target, 'Fe3', 0.001);
  chem.addIon(target, 'Cu', 0.001);
  chem.addIon(target, 'OH', 0.003);
  chem.react(target);
  return Object.fromEntries(target.precip.map((record) => [record.f, record.mol]));
}

test('Fe3+ / Cu2+ competition for OH- is governed by Ksp, not PRECIP array order', () => {
  const result = hydroxideCompetition();
  assert.ok((result['Fe(OH)₃'] || 0) > 9e-4, `Fe(OH)3 should precipitate first: ${JSON.stringify(result)}`);
  assert.ok((result['Cu(OH)₂'] || 0) < 1e-8, `Cu(OH)2 should not consume the limiting OH- first: ${JSON.stringify(result)}`);
});

test('undersaturated ion product does not nucleate a precipitate', () => {
  const chem = loadChemistry();
  const target = vessel(chem);
  target.vol = 1000;
  chem.addIon(target, 'Ag', 1e-5);
  chem.addIon(target, 'Cl', 1e-5); // Q = 1e-10 < Ksp(AgCl) = 1.8e-10
  chem.react(target);

  assert.equal(target.precip.length, 0, `undersaturated AgCl must remain dissolved: ${JSON.stringify(target)}`);
});

test('every precipitation row carries explicit finite M and Ksp metadata', () => {
  const chem = loadChemistry();
  assert.ok(chem.PRECIP.length >= 20);
  for (const row of chem.PRECIP) {
    assert.equal(row.length, 9, `Ksp row must have explicit metadata: ${JSON.stringify(row)}`);
    assert.ok(Number.isFinite(row[7]) && row[7] > 0, `invalid molar mass for ${row[4]}`);
    assert.ok(Number.isFinite(row[8]) && row[8] > 0, `invalid Ksp for ${row[4]}`);
  }
});

test('acid addition drives hydroxide precipitate dissolution through Ksp', () => {
  const chem = loadChemistry();
  const target = vessel(chem);
  target.vol = 1000;
  chem.addIon(target, 'Cu', 0.001);
  chem.addIon(target, 'OH', 0.002);
  chem.react(target);
  assert.ok((target.precip.find((record) => record.f === 'Cu(OH)₂')?.mol || 0) > 9e-4,
    `baseline Cu(OH)2 precipitate expected: ${JSON.stringify(target.precip)}`);

  chem.addIon(target, 'H', 0.002);
  chem.react(target);
  assert.ok((target.precip.find((record) => record.f === 'Cu(OH)₂')?.mol || 0) < 1e-8,
    `acid should dissolve Cu(OH)2: ${JSON.stringify(target.precip)}`);
});

test('Ksp solver terminates with finite bounded reaction log for a crowded mixture', () => {
  const chem = loadChemistry();
  const target = vessel(chem);
  target.vol = 100;
  for (const [key, mol] of [['Ag', 0.001], ['Pb', 0.001], ['Ba', 0.001], ['Ca', 0.001], ['Cu', 0.001], ['Fe3', 0.001], ['Ni', 0.001], ['Co', 0.001], ['Mg', 0.001], ['Zn', 0.001], ['Cl', 0.001], ['Br', 0.001], ['I', 0.001], ['SO4', 0.001], ['CO3', 0.001], ['OH', 0.001]]) {
    chem.addIon(target, key, mol);
  }
  const events = chem.react(target);
  assert.ok(Array.isArray(events) && events.length < 500, `reaction log unexpectedly large: ${events?.length}`);
  assert.ok(target.precip.every((record) => Number.isFinite(record.mol) && record.mol >= 0),
    `precipitate state must remain finite: ${JSON.stringify(target.precip)}`);
});
