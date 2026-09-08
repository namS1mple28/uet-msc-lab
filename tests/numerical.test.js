import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnalysis, AnalysisError, NUMERICAL_CONSTANTS } from '../src/analysis/engine.js';
import { makeDataset } from '../src/analysis/model.js';

function dataset(x, y, extra = {}) {
  return makeDataset({ id: extra.id || 'fixture', name: 'fixture', x, y, error: extra.error ?? null, mask: extra.mask, xUnit: extra.xUnit || '', yUnit: extra.yUnit || '' });
}
function close(actual, expected, tolerance, label = 'value') {
  assert.ok(Number.isFinite(actual), `${label} should be finite, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} differs from ${expected} by more than ${tolerance}`);
}

test('crop, scale, normalization, resampling and masking retain provenance inputs', () => {
  const raw = dataset([0, 1, 2, 3], [0, 2, 4, 6], { mask: [false, true, false, false], error: [0.1, 0.1, 0.2, 0.3] });
  const cropped = runAnalysis({ type: 'crop', dataset: raw, params: { min: 1, max: 2 } });
  assert.deepEqual(cropped.data.x, [1, 2]);
  assert.deepEqual(cropped.data.mask, [true, false]);
  const scaled = runAnalysis({ type: 'scale', dataset: raw, params: { value: -2 } });
  assert.deepEqual(scaled.data.y.map((value) => Object.is(value, -0) ? 0 : value), [0, -4, -8, -12]);
  assert.deepEqual(scaled.data.error, [0.2, 0.2, 0.4, 0.6]);
  const normalized = runAnalysis({ type: 'normalize', dataset: dataset([0, 1, 2], [1, 2, 4]), params: { mode: 'maximum' } });
  assert.deepEqual(normalized.data.y, [0.25, 0.5, 1]);
  const resampled = runAnalysis({ type: 'resample', dataset: dataset([0, 2], [0, 4]), params: { step: 0.5 } });
  assert.deepEqual(resampled.data.x, [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(resampled.data.y, [0, 1, 2, 3, 4]);
  const uncertain = runAnalysis({ type: 'resample', dataset: dataset([0, 2], [0, 4], { error: [0.1, null] }), params: { step: 1 } });
  assert.deepEqual(uncertain.data.error, [0.1, null, null], 'missing uncertainty must not be silently converted to zero');
});

test('Savitzky-Golay, derivatives and trapezoidal integration match polynomials', () => {
  const x = Array.from({ length: 21 }, (_, index) => index - 10);
  const y = x.map((value) => 3 * value * value + 2 * value + 7);
  const smooth = runAnalysis({ type: 'savgol', dataset: dataset(x, y), params: { window: 7, degree: 2 } });
  smooth.data.y.forEach((value, index) => close(value, y[index], 1e-8, `SG row ${index}`));
  const first = runAnalysis({ type: 'derivative', dataset: dataset(x, y), params: { order: 1 } });
  assert.match(first.data.yLabel, /^d/);
  first.data.y.forEach((value, index) => close(value, 6 * x[index] + 2, 1e-8, `d1 row ${index}`));
  const second = runAnalysis({ type: 'derivative', dataset: dataset(x, y), params: { order: 2 } });
  second.data.y.forEach((value, index) => close(value, 6, 1e-8, `d2 row ${index}`));
  const integral = runAnalysis({ type: 'integrate', dataset: dataset([0, 1, 2, 3], [0, 1, 2, 3]), params: {} });
  assert.deepEqual(integral.data.y, [0, 0.5, 2, 4.5]);
  close(integral.extras.total, 4.5, 1e-12);
});

test('scientific operations reject unordered or silently invalid input', () => {
  assert.throws(() => runAnalysis({ type: 'savgol', dataset: dataset([0, 1, 1.8], [1, 2, 3]), params: { window: 3, degree: 1 } }), /uniformly spaced/);
  assert.throws(() => runAnalysis({ type: 'integrate', dataset: dataset([0, 2, 1], [1, 2, 3]), params: {} }), /strictly monotonic/);
  assert.throws(() => runAnalysis({ type: 'scale', dataset: dataset([0, 1], [1, null]), params: { value: 2 } }), /Non-finite unmasked value/);
});

test('constant and polynomial-region baseline subtraction are exact', () => {
  const x = Array.from({ length: 21 }, (_, index) => index / 2);
  const baseline = x.map((value) => 1 + 0.3 * value + 0.02 * value * value);
  const constant = runAnalysis({ type: 'baseline', dataset: dataset(x, baseline.map((value) => value + 4)), params: { mode: 'constant', value: 4 } });
  constant.data.y.forEach((value, index) => close(value, baseline[index], 1e-12));
  const polynomial = runAnalysis({ type: 'baseline', dataset: dataset(x, baseline), params: { mode: 'polynomial', degree: 2, regions: [[0, 10]] } });
  polynomial.data.y.forEach((value, index) => close(value, 0, 1e-9, `baseline row ${index}`));
  const anchored = runAnalysis({ type: 'baseline', dataset: dataset(x, baseline), params: { mode: 'linear', anchors: [{ x: 0, y: 1 }, { x: 10, y: 4 }] } });
  anchored.extras.baseline.forEach((value, index) => close(value, 1 + 0.3 * x[index], 1e-10, `anchor baseline ${index}`));
});

test('asymmetric least-squares baseline lowers the broad background residual', () => {
  const x = Array.from({ length: 401 }, (_, index) => index * 0.05);
  const background = x.map((value) => 2 + 0.04 * value);
  const y = x.map((value, index) => background[index] + 8 * Math.exp(-4 * Math.log(2) * ((value - 10) / 1.2) ** 2));
  const output = runAnalysis({ type: 'baseline', dataset: dataset(x, y), params: { mode: 'als', lambda: 1e6, p: 0.005, iterations: 15 } });
  const edgeValues = [...output.extras.baseline.slice(0, 80), ...output.extras.baseline.slice(-80)];
  const edgeError = edgeValues.reduce((sum, value, index) => {
    const sourceIndex = index < 80 ? index : x.length - 80 + index - 80;
    return sum + Math.abs(value - background[sourceIndex]) / edgeValues.length;
  }, 0);
  assert.ok(edgeError < 0.08, `ALS edge baseline MAE was ${edgeError}`);
  assert.ok(Math.max(...output.data.y.filter(Number.isFinite)) > 7.5);
});

for (const profile of ['gaussian', 'lorentzian', 'pseudoVoigt']) {
  test(`${profile} nonlinear fit recovers center, FWHM and area`, () => {
    const expected = { center: 5.1, height: 8.2, fwhm: 1.15, eta: 0.35 };
    const x = Array.from({ length: 501 }, (_, index) => index * 0.02);
    const y = x.map((value) => {
      const u = (value - expected.center) / expected.fwhm;
      const gaussian = expected.height * Math.exp(-4 * Math.log(2) * u * u);
      const lorentzian = expected.height / (1 + 4 * u * u);
      const peak = profile === 'gaussian' ? gaussian : profile === 'lorentzian' ? lorentzian : (1 - expected.eta) * gaussian + expected.eta * lorentzian;
      return 1.7 + peak;
    });
    const output = runAnalysis({ type: 'fit', dataset: dataset(x, y), params: {
      model: profile, baseline: 1.7,
      peaks: [{ center: 5, height: 7.8, fwhm: 1.25, eta: 0.5, fixed: {}, bounds: { center: [4.5, 5.5], height: [0, 20], fwhm: [0.2, 3], eta: [0, 1] } }],
    } }).result;
    assert.equal(output.status, 'success', output.message);
    close(output.peaks[0].center, expected.center, expected.center * 0.01, 'center');
    close(output.peaks[0].fwhm, expected.fwhm, expected.fwhm * 0.01, 'FWHM');
    close(output.peaks[0].height, expected.height, expected.height * 0.01, 'height');
    assert.ok(output.r2 > 0.9999);
    assert.ok(output.peaks[0].area > 0);
    assert.ok(output.uncertainty?.covariance);
  });
}

test('overlapping Gaussian peaks recover center, FWHM and area within one percent', () => {
  const expected = [
    { center: 4.7, height: 8.0, fwhm: 0.9 },
    { center: 5.45, height: 5.5, fwhm: 1.05 },
  ];
  const x = Array.from({ length: 801 }, (_, index) => 2 + index * 0.0075);
  const y = x.map((value) => 0.8 + expected.reduce((sum, peak) => {
    const u = (value - peak.center) / peak.fwhm;
    return sum + peak.height * Math.exp(-4 * Math.log(2) * u * u);
  }, 0));
  const output = runAnalysis({ type: 'fit', dataset: dataset(x, y), params: {
    model: 'gaussian', baseline: 0.8,
    peaks: expected.map((peak) => ({
      center: peak.center + 0.08, height: peak.height * 0.9, fwhm: peak.fwhm * 1.1, fixed: {},
      bounds: { center: [peak.center - 0.4, peak.center + 0.4], height: [0, 20], fwhm: [0.2, 2] },
    })),
  } }).result;
  assert.equal(output.status, 'success', output.message);
  expected.forEach((peak, index) => {
    close(output.peaks[index].center, peak.center, peak.center * 0.01, `center ${index}`);
    close(output.peaks[index].fwhm, peak.fwhm, peak.fwhm * 0.01, `FWHM ${index}`);
    const area = peak.height * peak.fwhm * Math.sqrt(Math.PI / Math.log(2)) / 2;
    close(output.peaks[index].area, area, area * 0.01, `area ${index}`);
  });
  assert.equal(output.convergence.reached, true);
});

test('weighted linear fit and singular covariance states are explicit', () => {
  const x = [0, 1, 2, 3, 4];
  const y = x.map((value) => 2 + 3 * value);
  const success = runAnalysis({ type: 'fit', dataset: dataset(x, y, { error: [0.1, 0.2, 0.15, 0.1, 0.3] }), params: { model: 'linear', weighted: true } }).result;
  assert.equal(success.status, 'success');
  close(success.parameters.intercept, 2, 1e-10);
  close(success.parameters.slope, 3, 1e-10);
  const invalid = runAnalysis({ type: 'fit', dataset: dataset([1, 1, 1, 1], [1, 2, 3, 4]), params: { model: 'linear' } }).result;
  assert.equal(invalid.status, 'invalid');
  assert.match(invalid.message, /rank-deficient/);
});

test('XRD Bragg and Scherrer calculations distinguish correction profiles', () => {
  const raw = dataset([20, 30, 40], [1, 2, 1]);
  const output = runAnalysis({ type: 'xrd', dataset: raw, params: {
    confirmed: true, lambda: 1.5406, K: 0.9, instrumentFwhm: 0.1, correction: 'gaussian', profile: 'gaussian',
    peaks: [{ center: 30, fwhm: 0.2, height: 10, area: 5 }],
  } }).result;
  close(output.peaks[0].dAngstrom, 1.5406 / (2 * Math.sin(15 * Math.PI / 180)), 1e-12, 'd-spacing');
  const beta = Math.sqrt(0.2 ** 2 - 0.1 ** 2) * Math.PI / 180;
  close(output.peaks[0].sizeNm, 0.9 * 1.5406 / (beta * Math.cos(15 * Math.PI / 180)) / 10, 1e-10, 'Scherrer size');
  assert.throws(() => runAnalysis({ type: 'xrd', dataset: raw, params: { confirmed: true, peaks: [{ center: 30, fwhm: 0.2 }], correction: 'gaussian', profile: 'pseudoVoigt' } }), /pseudo-Voigt/);
  assert.throws(() => runAnalysis({ type: 'xrd', dataset: raw, params: { confirmed: false, peaks: [] } }), /explicit confirmation/);
});

test('ideal direct Tauc fixture recovers Eg within 0.01 eV', () => {
  const Eg = 2.1;
  const energy = Array.from({ length: 251 }, (_, index) => 1.7 + index * 0.006);
  const wavelength = energy.map((value) => NUMERICAL_CONSTANTS.HC_EV_NM / value).reverse();
  const alpha = energy.map((value) => value > Eg ? Math.sqrt(5e10 * (value - Eg)) / value : 0).reverse();
  const output = runAnalysis({ type: 'tauc', dataset: dataset(wavelength, alpha, { xUnit: 'nm', yUnit: 'cm⁻¹' }), params: {
    confirmed: true, xMode: 'wavelength', signal: 'alpha', transition: 'direct', percent: false, roi: [2.2, 3.0],
  } });
  close(output.extras.Eg, Eg, 0.01, 'Tauc Eg');
  assert.equal(output.data.xUnit, 'eV');
  assert.equal(output.data.yLabel, '(αhν)²');
  assert.equal(output.data.x.length, wavelength.length);
  assert.equal(output.extras.fit.status, 'success');
});

test('transmittance conversion is physical and explicit', () => {
  const output = runAnalysis({ type: 'transmittance', dataset: dataset([400, 500], [100, 10]), params: { percent: true } });
  close(output.data.y[0], 0, 1e-12);
  close(output.data.y[1], 1, 1e-12);
  assert.throws(() => runAnalysis({ type: 'transmittance', dataset: dataset([400], [0]), params: { percent: true } }), AnalysisError);
});
