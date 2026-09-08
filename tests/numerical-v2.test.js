import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisError, NUMERICAL_CONSTANTS, runAnalysis } from '../src/analysis/engine.js';
import { makeDataset } from '../src/analysis/model.js';

const ds = (x, y, extra = {}) => makeDataset({ id: 'v2-fixture', x, y, ...extra });
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('despike detects isolated spikes with rolling median/MAD and preserves provenance', () => {
  const input = ds([0, 1, 2, 3, 4], [1, 1, 20, 1, 1], { mask: [false, false, false, false, false] });
  const replaced = runAnalysis({ type: 'despike', dataset: input, params: { window: 3, threshold: 3, action: 'replace' } });
  assert.deepEqual(replaced.data.y, [1, 1, 1, 1, 1]);
  assert.deepEqual(replaced.data.mask, input.mask);
  assert.deepEqual(replaced.extras.indices, [2]);
  assert.equal(replaced.extras.count, 1);
  assert.match(replaced.extras.method, /median.*MAD/);
  assert.equal(replaced.extras.type, 'despike');
  const masked = runAnalysis({ type: 'despike', dataset: input, params: { window: 3, threshold: 3, action: 'mask' } });
  assert.deepEqual(masked.data.y, input.y);
  assert.deepEqual(masked.data.mask, [false, false, true, false, false]);
  assert.throws(() => runAnalysis({ type: 'despike', dataset: input, params: { window: 2, threshold: 3, action: 'replace' } }), AnalysisError);
  assert.throws(() => runAnalysis({ type: 'despike', dataset: input, params: { window: 3, threshold: 0, action: 'replace' } }), AnalysisError);
});

test('despike ignores masked neighbors and has deterministic MAD-zero behavior', () => {
  const input = ds([0, 1, 2, 3, 4], [5, 5, 99, 5, 5], { mask: [false, true, false, false, false] });
  const output = runAnalysis({ type: 'despike', dataset: input, params: { window: 5, threshold: 1, action: 'replace' } });
  assert.equal(output.extras.count, 1);
  assert.deepEqual(output.extras.indices, [2]);
  assert.equal(output.data.y[2], 5);
  assert.equal(output.data.mask[1], true);
  const ramp = runAnalysis({ type: 'despike', dataset: ds([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]), params: { window: 3, threshold: 3, action: 'mask' } });
  assert.deepEqual(ramp.data.mask, [false, false, false, false, false]);
});

test('statistics honors ROI/mask and only reports area for contiguous monotonic active pairs', () => {
  const input = ds([0, 1, 2, 3, 4], [1, 2, 3, 4, 5], { mask: [false, false, true, false, false] });
  const output = runAnalysis({ type: 'statistics', dataset: input, params: { roi: [0, 4] } }).result;
  assert.equal(output.type, 'statistics');
  assert.equal(output.n, 4);
  close(output.mean, 3);
  close(output.sampleSD, Math.sqrt(10 / 3));
  close(output.standardError, Math.sqrt(10 / 3) / 2);
  close(output.median, 3);
  close(output.q1, 1.75);
  close(output.q3, 4.25);
  assert.equal(output.area, null);
  assert.ok(output.warnings.length);
  const descending = runAnalysis({ type: 'statistics', dataset: ds([3, 2, 1], [1, 2, 3]), params: {} }).result;
  close(descending.area, 4);
  const one = runAnalysis({ type: 'statistics', dataset: ds([1], [4]), params: {} }).result;
  assert.equal(one.sampleSD, null);
  assert.equal(one.standardError, null);
  assert.equal(one.area, null);
});

test('fit diagnostics distinguish weighted and unweighted fits, including invalid fits', () => {
  const weighted = runAnalysis({ type: 'fit', dataset: ds([0, 1, 2, 3, 4], [2, 5, 8, 11, 14], { error: [1, 2, 1, 2, 1] }), params: { model: 'linear', weighted: true } }).result;
  assert.equal(weighted.status, 'success');
  assert.equal(weighted.diagnostics.degreesOfFreedom, 3);
  assert.equal(weighted.degreesOfFreedom, weighted.diagnostics.degreesOfFreedom);
  assert.equal(weighted.diagnostics.rss, 0);
  assert.equal(weighted.rss, weighted.diagnostics.rss);
  assert.ok(Object.hasOwn(weighted.diagnostics, 'reducedChiSquare'));
  const unweighted = runAnalysis({ type: 'fit', dataset: ds([0, 1, 2, 3, 4], [2, 5, 8, 12, 14]), params: { model: 'linear' } }).result;
  assert.equal(unweighted.status, 'success');
  assert.ok(Number.isFinite(unweighted.diagnostics.rss));
  assert.ok(!Object.hasOwn(unweighted.diagnostics, 'reducedChiSquare'));
  const invalid = runAnalysis({ type: 'fit', dataset: ds([1, 1, 1, 1], [1, 2, 3, 4]), params: { model: 'linear' } }).result;
  assert.equal(invalid.status, 'invalid');
  assert.ok(invalid.diagnostics);
  assert.equal(invalid.diagnostics.rss, null);
});

test('Williamson-Hall applies profile-aware broadening correction and returns size/uncertainty', () => {
  const lambda = 1.5406;
  const intercept = 0.002;
  const strain = 0.001;
  const centers = [30, 40, 50];
  const peaks = centers.map((center) => {
    const theta = center * Math.PI / 360;
    const x = 4 * Math.sin(theta);
    const beta = (intercept + strain * x) / Math.cos(theta);
    return { center, fwhm: beta * 180 / Math.PI };
  });
  const output = runAnalysis({ type: 'williamsonHall', dataset: ds([], []), params: { confirmed: true, lambda, K: 0.9, peaks } }).result;
  assert.equal(output.status, 'success', output.message);
  assert.match(output.warning, /No instrumental broadening correction/);
  close(output.regression.intercept, intercept, 1e-12);
  close(output.regression.strain, strain, 1e-12);
  close(output.intercept, intercept, 1e-12);
  close(output.strain, strain, 1e-12);
  close(output.sizeNm, 0.9 * lambda / intercept / 10, 1e-9);
  close(output.rss, 0, 1e-18);
  assert.equal(output.degreesOfFreedom, 1);
  assert.equal(output.diagnostics.degreesOfFreedom, 1);
  assert.equal(output.points[0].x, 4 * Math.sin(centers[0] * Math.PI / 360));
  const invalidBroadening = runAnalysis({ type: 'williamsonHall', dataset: ds([], []), params: {
    confirmed: true, instrumentFwhm: 0.3, correction: 'gaussian', peaks: [{ center: 30, fwhm: 0.2 }, { center: 40, fwhm: 0.2 }, { center: 50, fwhm: 0.2 }],
  } }).result;
  assert.equal(invalidBroadening.status, 'invalid');
  assert.ok(invalidBroadening.warnings.length);
  assert.throws(() => runAnalysis({ type: 'williamsonHall', dataset: ds([], []), params: { confirmed: true, profile: 'pseudoVoigt', correction: 'gaussian', peaks } }), /pseudo-Voigt/);
  assert.throws(() => runAnalysis({ type: 'williamsonHall', dataset: ds([], []), params: { confirmed: true, profile: 'gaussian', correction: 'lorentzian', peaks } }), /must match/);
  assert.throws(() => runAnalysis({ type: 'williamsonHall', dataset: ds([], []), params: { confirmed: false, peaks } }), /explicit confirmation/);

  const negativeStrainPeaks = centers.map((center) => {
    const theta = center * Math.PI / 360;
    const beta = (intercept - 0.0002 * 4 * Math.sin(theta)) / Math.cos(theta);
    return { center, fwhm: beta * 180 / Math.PI };
  });
  const negativeStrain = runAnalysis({ type: 'williamsonHall', dataset: ds([], []), params: { confirmed: true, peaks: negativeStrainPeaks } }).result;
  assert.equal(negativeStrain.status, 'invalid');
  assert.equal(negativeStrain.sizeNm, null);
  assert.equal(negativeStrain.diagnostics.rss, null);
  assert.match(negativeStrain.message, /negative microstrain/);
});

test('XRD validates peak profile and correction compatibility', () => {
  const input = ds([20, 30, 40], [1, 2, 1]);
  const base = { confirmed: true, peaks: [{ center: 30, fwhm: 0.2 }] };
  assert.throws(() => runAnalysis({ type: 'xrd', dataset: input, params: { ...base, profile: 'unknown' } }), /Unknown XRD peak profile/);
  assert.throws(() => runAnalysis({ type: 'xrd', dataset: input, params: { ...base, profile: 'gaussian', correction: 'lorentzian' } }), /must match/);
});

test('cubic lattice indexing computes mean and uncertainty with zero-shift correction', () => {
  const a = 3.6; const lambda = 1.5406;
  const indexed = [[1, 1, 1], [2, 0, 0], [2, 2, 0]].map(([h, k, l]) => {
    const d = a / Math.sqrt(h * h + k * k + l * l);
    return { center: 2 * Math.asin(lambda / (2 * d)) * 180 / Math.PI, h, k, l };
  });
  const output = runAnalysis({ type: 'cubicLattice', dataset: ds([], []), params: { confirmed: true, peaks: indexed } }).result;
  assert.equal(output.status, 'success');
  close(output.aMeanAngstrom, a, 1e-10);
  close(output.sampleSD, 0, 1e-10);
  close(output.standardError, 0, 1e-10);
  const one = runAnalysis({ type: 'cubicLattice', dataset: ds([], []), params: { confirmed: true, zeroShiftDegrees: 0.1, peaks: [indexed[0]] } }).result;
  assert.equal(one.status, 'success');
  assert.equal(one.sampleSD, null);
  assert.ok(one.warnings.length);
  assert.throws(() => runAnalysis({ type: 'cubicLattice', dataset: ds([], []), params: { confirmed: true, peaks: [{ center: 30, h: 0, k: 0, l: 0 }] } }), /not all zero/);
});

test('Urbach transform uses explicit ROI, optical guards, positive slope, and apparent reflectance proxy label', () => {
  const energy = [2, 2.1, 2.2, 2.3, 2.4];
  const alpha = energy.map((value) => Math.exp(1 + 2 * value));
  const output = runAnalysis({ type: 'urbach', dataset: ds(energy, alpha), params: { confirmed: true, xMode: 'energy', signal: 'alpha', roi: [2, 2.4] } });
  assert.equal(output.extras.type, 'urbach');
  assert.equal(output.extras.status, 'success');
  close(output.extras.EuEv, 0.5, 1e-12);
  assert.equal(output.data.xUnit, 'eV');
  assert.equal(output.data.yLabel, 'ln(α)');
  assert.equal(output.extras.fit.status, 'success');
  const wavelength = energy.map((value) => NUMERICAL_CONSTANTS.HC_EV_NM / value).reverse();
  const reflectance = [20, 25, 30, 35, 40].reverse();
  const proxy = runAnalysis({ type: 'urbach', dataset: ds(wavelength, reflectance), params: { confirmed: true, xMode: 'wavelength', signal: 'reflectance', percent: true, roi: [2, 2.4] } });
  assert.equal(proxy.extras.apparentProxy, true);
  assert.match(proxy.data.yLabel, /apparent proxy/);
  assert.throws(() => runAnalysis({ type: 'urbach', dataset: ds(energy, alpha), params: { confirmed: true, xMode: 'energy', signal: 'alpha' } }), /explicit ROI/);
  const tooFew = runAnalysis({ type: 'urbach', dataset: ds(energy.slice(0, 2), alpha.slice(0, 2)), params: { confirmed: true, xMode: 'energy', signal: 'alpha', roi: [2, 2.1] } });
  assert.equal(tooFew.extras.status, 'invalid');
  assert.match(tooFew.extras.message, /at least 3/);
  const outsideZero = runAnalysis({ type: 'urbach', dataset: ds(energy, [0, ...alpha.slice(1)]), params: { confirmed: true, xMode: 'energy', signal: 'alpha', roi: [2.1, 2.4] } });
  assert.equal(outsideZero.extras.status, 'success');
  assert.equal(outsideZero.data.y[0], null);
  assert.equal(outsideZero.extras.outsideRoiCount, 1);
  assert.ok(outsideZero.extras.warnings.length);
  assert.throws(() => runAnalysis({ type: 'urbach', dataset: ds(energy, [0, ...alpha.slice(1)]), params: { confirmed: true, xMode: 'energy', signal: 'alpha', roi: [2, 2.4] } }), /positive/);
});
