import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/msc-lab.html', import.meta.url), 'utf8');
const start = source.indexOf('const THERMAL_SIM_TIME_SCALE=');
const end = source.indexOf('/* ---- tủ dụng cụ ---- */', start);
assert.ok(start >= 0 && end > start, 'thermal helper markers must exist');

function loadThermal() {
  const context = {
    Math, Number, Object, Array, console,
    performance: { now: () => 0 },
    GEAR: {
      tripod: { w: 104 }, beaker: {}, flask: {}, rflask: {},
      tube: {}, burette: {}, cylinder: {},
    },
    TARE: { beaker: 95, flask: 110, rflask: 104, tube: 22, burette: 120, cylinder: 78 },
    ION: { Na: { M: 22.99 } },
    SOLIDS: {},
    reduceMotion: true,
    fmt: (value, digits = 3) => Number(value).toFixed(digits),
    toast: () => {},
    logRxn: () => {},
    note2: () => {},
    react: () => {},
  };
  vm.runInNewContext(`${source.slice(start, end)}
    globalThis.__thermal = {
      thermalApparatusState, thermalDissolvedMassG, thermalWaterMassG,
      thermalResidueMassG, thermalHeatCapacity, thermalStep,
      THERMAL_SIM_TIME_SCALE, THERMAL_LATENT_HEAT_J_PER_G,
    };`, context, { filename: 'msc-lab-thermal.js' });
  return { api: context.__thermal, context };
}

function vessel(type = 'flask') {
  return {
    id: type, kind: 'vessel', type, x: 0, y: 100, on: null, vol: 10,
    temp: 25, dry: false, dryResidueG: 0, precip: [], solids: {},
    ions: {}, weakA: 0, weakB: 0, cplx: [], bubs: [], boil: 0,
  };
}

function apparatus(type = 'flask', { tripod = true, holder = false, lampX = 0 } = {}) {
  const v = vessel(type);
  const bench = [{ type: 'lamp', lit: true, x: lampX, y: 100 }];
  if (tripod) {
    const support = { id: 'tripod', type: 'tripod', x: 0, y: 100 };
    bench.push(support); v.on = support.id;
  }
  if (holder) bench.push({ type: 'holder', attach: v.id });
  return { v, bench };
}

test('thermal apparatus validation rejects unsafe glassware and requires correct support', () => {
  const { api } = loadThermal();
  for (const type of ['burette', 'cylinder']) {
    const { v, bench } = apparatus(type, { tripod: true });
    assert.equal(api.thermalApparatusState(v, bench).heated, false, `${type} must never heat`);
    assert.equal(api.thermalApparatusState(v, bench).reason, 'unsafe-glassware');
  }

  const invalidBeaker = apparatus('beaker', { tripod: false });
  assert.equal(api.thermalApparatusState(invalidBeaker.v, invalidBeaker.bench).reason, 'tripod-required');
  const misplaced = apparatus('flask', { tripod: true, lampX: 200 });
  assert.equal(api.thermalApparatusState(misplaced.v, misplaced.bench).heated, false);

  const tubeWithoutHolder = apparatus('tube', { tripod: false });
  assert.equal(api.thermalApparatusState(tubeWithoutHolder.v, tubeWithoutHolder.bench).reason, 'tube-holder-required');
  const tubeWithHolder = apparatus('tube', { tripod: false, holder: true });
  assert.equal(api.thermalApparatusState(tubeWithHolder.v, tubeWithHolder.bench).heated, true);
  const validFlask = apparatus('flask', { tripod: true });
  assert.equal(api.thermalApparatusState(validFlask.v, validFlask.bench).heated, true);
});

test('valid heating is monotonic and invalid heating does not raise temperature', () => {
  const { api } = loadThermal();
  const valid = apparatus('flask');
  const temperatures = [];
  for (let i = 0; i < 20; i++) {
    temperatures.push(api.thermalStep(valid.v, valid.bench, 0.1).temperatureC);
  }
  assert.ok(temperatures.every((value, i) => i === 0 || value >= temperatures[i - 1]));
  assert.ok(valid.v.temp > 25);

  const invalid = apparatus('burette');
  api.thermalStep(invalid.v, invalid.bench, 0.1);
  assert.equal(invalid.v.temp, 25, 'burette must not receive heater energy');
});

test('evaporation uses latent heat, preserves solute, and periodically re-equilibrates Ksp', () => {
  const { api, context } = loadThermal();
  let reactCalls = 0;
  context.react = () => { reactCalls += 1; };
  const { v, bench } = apparatus('flask');
  v.vol = 1; v.temp = 100; v.ions.Na = 0.001;
  const initialSolute = v.ions.Na;
  const before = v.vol;
  const result = api.thermalStep(v, bench, 0.1);

  assert.ok(result.evaporatedMl > 0 && v.vol < before);
  assert.equal(v.ions.Na, initialSolute, 'evaporation must not remove dissolved solute');
  assert.ok(reactCalls >= 1, 'evaporation must trigger Ksp equilibration at cadence');
  assert.ok(api.THERMAL_LATENT_HEAT_J_PER_G > 2000);
});

test('drying records residue once and does not keep evaporating or double-counting it', () => {
  const { api, context } = loadThermal();
  let reactCalls = 0;
  context.react = () => { reactCalls += 1; };
  const { v, bench } = apparatus('flask');
  v.vol = 0.03; v.temp = 100; v.ions.Na = 0.001;
  const first = api.thermalStep(v, bench, 0.1);

  assert.equal(v.dry, true);
  assert.equal(v.vol, 0);
  assert.ok(v.dryResidueG > 0);
  assert.ok(Math.abs(v.dryResidueG - api.thermalResidueMassG(v)) < 1e-12,
    'dry residue metadata must equal the represented solute/solid state');
  assert.ok(first.evaporatedMl > 0);
  const residue = v.dryResidueG;
  const callsAfterDry = reactCalls;
  const second = api.thermalStep(v, bench, 0.1);
  assert.equal(second.evaporatedMl, 0);
  assert.equal(v.dryResidueG, residue);
  assert.equal(reactCalls, callsAfterDry);
});
