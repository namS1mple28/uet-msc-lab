import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Đọc trực tiếp source canonical; không import hoặc sửa các HTML sinh ra.
const source = await readFile(new URL('../src/msc-lab.html', import.meta.url), 'utf8');

function loadPrecursorHelpers() {
  const start = source.indexOf('function pSatWater');
  const end = source.indexOf('const RECIPES=', start);
  assert.ok(start >= 0 && end > start, 'pressure/sol-gel helper markers must exist');
  const context = { Math, Number, Object, fmt: (value, digits) => Number(value).toFixed(digits) };
  const block = source.slice(start, end);
  vm.runInNewContext(`${block}
    globalThis.__precursor = { pSatWater, saturatedWaterDensity, autoclavePressure, SOLGEL_SPECS, solgelSpec, solgelYield };
  `, context, { filename: 'msc-lab-precursor-helpers.js' });
  return context.__precursor;
}

function loadMaterials() {
  const start = source.indexOf('const MATS=');
  const end = source.indexOf('const METHODS=', start);
  assert.ok(start >= 0 && end > start, 'materials markers must exist');
  const context = { Math, Number, Object };
  vm.runInNewContext(`${source.slice(start, end)}
    globalThis.__materials = { MATS };
  `, context, { filename: 'msc-lab-materials.js' });
  return context.__materials;
}

function loadZnOSolgelRoute() {
  const start = source.indexOf('const SOLGEL_SPECS=');
  const end = source.indexOf('/* ============================================================\n   MÔ PHỎNG TỪNG BƯỚC', start);
  assert.ok(start >= 0 && end > start, 'sol-gel recipe markers must exist');
  const context = { Math, Number, Object, fmt: (value, digits) => Number(value).toFixed(digits) };
  vm.runInNewContext(`${source.slice(start, end)}
    globalThis.__zno = { SOLGEL_SPECS, znoSolgelMetrics, RECIPES, recipeFor };
  `, context, { filename: 'msc-lab-zno-solgel.js' });
  return context.__zno;
}

function close(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), `${label} should be finite, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} differs from ${expected}`);
}

test('IAPWS/Wagner saturation pressure matches water reference points', () => {
  const { pSatWater, saturatedWaterDensity } = loadPrecursorHelpers();
  close(pSatWater(100), 1.014, 0.01, 'Psat at 100 C');
  close(pSatWater(180), 10.028, 0.03, 'Psat at 180 C');
  close(pSatWater(220), 23.196, 0.05, 'Psat at 220 C');
  close(saturatedWaterDensity(25), 997.0, 0.5, 'saturated liquid density at 25 C');
  close(saturatedWaterDensity(180), 887.1, 1.0, 'saturated liquid density at 180 C');
});

test('autoclave pressure decomposes into vapor and non-condensable terms', () => {
  const { autoclavePressure } = loadPrecursorHelpers();
  const p70 = autoclavePressure(180, 70);
  const p85 = autoclavePressure(180, 85);
  assert.ok(p70.vapor > 10 && p70.vapor < 10.1);
  close(p70.total, p70.vapor + p70.noncond, 1e-12, 'pressure decomposition');
  close(p70.vapor, p85.vapor, 1e-12, 'vapor pressure independent of fill');
  assert.ok(p70.headspacePct < 30, 'thermal expansion must reduce the hot headspace');
  assert.ok(p85.headspacePct < 15, 'high fill must leave still less hot headspace');
  close(p70.hotFillPct + p70.headspacePct, 100, 1e-10, 'hot volume balance at 70% fill');
  close(p85.hotFillPct + p85.headspacePct, 100, 1e-10, 'hot volume balance at 85% fill');
  assert.ok(p85.noncond > p70.noncond, 'higher fill compresses the assumed trapped gas');
  assert.ok(p85.total > p70.total, 'higher fill increases total pressure through headspace gas only');
  assert.equal(p70.unsafe, false);
  assert.equal(p85.unsafe, true, '85% fill at 180 C must trigger the low-headspace guard');
  assert.ok(p70.total > 12 && p70.total < 13, 'default total pressure includes heated trapped air');
});

test('sol-gel theoretical mass and recovered yield use material stoichiometry', () => {
  const { SOLGEL_SPECS, solgelYield } = loadPrecursorHelpers();
  const params = { m: 5, solv: 60, h: 4, pH: 2, age: 12, dry: 100 };
  const ti = solgelYield(params, 'TiO2');
  const zn = solgelYield(params, 'ZnO');
  close(ti.theoretical, 5 * SOLGEL_SPECS.TiO2.oxideMassPerPrecursor, 1e-12, 'TiO2 theoretical mass');
  close(zn.theoretical, 5 * SOLGEL_SPECS.ZnO.oxideMassPerPrecursor, 1e-12, 'ZnO theoretical mass');
  assert.notEqual(ti.theoretical, zn.theoretical, 'different precursors must have different oxide yield');
  assert.ok(ti.yield > 0 && ti.yield < ti.theoretical);
  assert.ok(zn.yield > 0 && zn.yield < zn.theoretical);
  close(ti.yield, ti.theoretical * ti.conversion * ti.handling, 1e-12, 'TiO2 recovered yield');
  close(zn.yield, zn.theoretical * zn.conversion * zn.handling, 1e-12, 'ZnO recovered yield');
});

test('MAPbI3 has no invalid hydrothermal route', () => {
  const { MATS } = loadMaterials();
  assert.equal(Array.from(MATS.MAPI.methods).join(','), 'spin');
});

test('ZnO sol-gel dispatches to zinc acetate–MEA recipe and scene labels', () => {
  const { RECIPES, recipeFor } = loadZnOSolgelRoute();
  assert.equal(recipeFor('ZnO', 'solgel'), RECIPES.znoSolgel);
  assert.equal(recipeFor('TiO2', 'solgel'), RECIPES.solgel);
  assert.deepEqual(Array.from(RECIPES.znoSolgel.steps, step => step.k), ['m', 'solv', 'ratio', 'T', 'stir', 'age', 'dry']);
  assert.equal(RECIPES.znoSolgel.steps.find(step => step.k === 'ratio').def, 1);
  assert.equal(RECIPES.znoSolgel.steps.find(step => step.k === 'T').def, 60);
  assert.equal(RECIPES.znoSolgel.steps.find(step => step.k === 'stir').def, 2);
  const start = source.indexOf('SCENES.znoSolgel=');
  const end = source.indexOf('function sceneFor', start);
  assert.ok(start >= 0 && end > start, 'ZnO scene variant must exist');
  const scene = source.slice(start, end);
  assert.match(scene, /zinc acetate|MEA|2-methoxyethanol/);
  assert.doesNotMatch(scene, /HNO3|TTIP|thủy phân/);
});

test('ZnO sol-gel has deterministic optimum and off-ratio penalty', () => {
  const { SOLGEL_SPECS, znoSolgelMetrics } = loadZnOSolgelRoute();
  const optimumParams = { m: 10.975, solv: 100, ratio: 1, T: 60, stir: 2, age: 12, dry: 100 };
  const optimum = znoSolgelMetrics(optimumParams);
  const repeat = znoSolgelMetrics({ ...optimumParams });
  assert.deepEqual(JSON.parse(JSON.stringify(repeat)), JSON.parse(JSON.stringify(optimum)), 'metric model must be deterministic');
  close(optimum.concentrationM, 0.5, 1e-12, 'ZnO target concentration');
  close(optimum.theoretical, optimumParams.m * SOLGEL_SPECS.ZnO.oxideMassPerPrecursor, 1e-12, 'ZnO theoretical mass');
  close(optimum.yield, optimum.theoretical * optimum.conversion * optimum.handling, 1e-12, 'ZnO recovered yield');

  const offRatio = znoSolgelMetrics({ ...optimumParams, ratio: 0.6 });
  assert.ok(offRatio.conversion < optimum.conversion, 'off-ratio must reduce conversion');
  assert.ok(offRatio.uniformity < optimum.uniformity, 'off-ratio must reduce uniformity');
  assert.ok(offRatio.D > optimum.D, 'off-ratio must increase particle size proxy');
  assert.ok(offRatio.def > optimum.def, 'off-ratio must increase defect proxy');
  assert.ok(offRatio.yield < optimum.yield, 'off-ratio must reduce recovered ZnO');

  const perturbations = [
    { label: 'concentration', params: { m: 5.4875 } },
    { label: 'solution temperature', params: { T: 35 } },
    { label: 'stir time', params: { stir: 0.5 } },
    { label: 'aging', params: { age: 0 } },
    { label: 'drying', params: { dry: 60 } }
  ];
  for (const { label, params } of perturbations) {
    const q = znoSolgelMetrics({ ...optimumParams, ...params });
    assert.ok(q.conversion < optimum.conversion, `${label} perturbation must affect conversion`);
    assert.ok(q.uniformity < optimum.uniformity, `${label} perturbation must affect uniformity`);
    assert.ok(q.D !== optimum.D, `${label} perturbation must affect D`);
    assert.ok(q.def > optimum.def, `${label} perturbation must increase defect proxy`);
    assert.ok(q.yield < optimum.yield, `${label} perturbation must reduce recovered yield`);
  }
});

test('precursor workflow invalidates downstream steps and persists calculation metadata', () => {
  assert.match(source, /for\(let j=cur;j<PSIM\.done\.length;j\+\+\)PSIM\.done\[j\]=false/);
  assert.match(source, /R\.calc\(PARAMS,calcCtx\)/);
  assert.match(source, /SMP\.recipe=\{method:PENDING\.method,material:PENDING\.mat,params:\{\.\.\.PARAMS\}/);
  assert.match(source, /result:\{\.\.\.c,extra\},extra/);
  assert.match(source, /const R=recipeFor\(PENDING\.mat,PENDING\.method\)/);
  assert.match(source, /const SC=sceneFor\(PENDING\.mat,PENDING\.method\)/);
});
