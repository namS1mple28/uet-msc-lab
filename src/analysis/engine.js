import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import { levenbergMarquardt } from 'ml-levenberg-marquardt';

const HC_EV_NM = 1239.841984;
const SQRT_2PI = Math.sqrt(2 * Math.PI);
const SQRT_PI_OVER_LN2 = Math.sqrt(Math.PI / Math.log(2));

export class AnalysisError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalysisError';
  }
}

function fail(message) {
  throw new AnalysisError(message);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function copyParams(params) {
  return structuredClone(params ?? {});
}

function checkDataset(dataset) {
  if (!dataset || !Array.isArray(dataset.x) || !Array.isArray(dataset.y)) fail('Dataset must contain x and y arrays.');
  if (dataset.x.length !== dataset.y.length) fail('x and y must have the same length.');
  if (dataset.error != null && (!Array.isArray(dataset.error) || dataset.error.length !== dataset.x.length)) {
    fail('error must be null or have the same length as x.');
  }
  if (dataset.mask != null && (!Array.isArray(dataset.mask) || dataset.mask.length !== dataset.x.length)) {
    fail('mask must be null or have the same length as x.');
  }
  return dataset.x.length;
}

function isMasked(dataset, i) {
  return dataset.mask?.[i] === true;
}

function assertFiniteRows(dataset, indices = null, { error = false } = {}) {
  const n = checkDataset(dataset);
  const rows = indices ?? Array.from({ length: n }, (_, i) => i);
  for (const i of rows) {
    if (isMasked(dataset, i)) continue;
    if (!finite(dataset.x[i]) || !finite(dataset.y[i])) fail(`Non-finite unmasked value at row ${i + 1}.`);
    if (error && (!dataset.error || !finite(dataset.error[i]) || dataset.error[i] <= 0)) {
      fail(`Weighted analysis requires a positive finite uncertainty at row ${i + 1}.`);
    }
  }
}

function assertMonotonic(dataset) {
  assertFiniteRows(dataset);
  const active = [];
  for (let i = 0; i < dataset.x.length; i++) if (!isMasked(dataset, i)) active.push(i);
  let direction = 0;
  for (let pos = 1; pos < active.length; pos++) {
    const i = active[pos]; const previous = active[pos - 1];
    if (!finite(dataset.x[previous]) || !finite(dataset.x[i])) fail(`Non-finite x value at row ${i + 1}.`);
    const d = dataset.x[i] - dataset.x[previous];
    if (d === 0) fail(`Duplicate x value at rows ${i} and ${i + 1}.`);
    const sign = Math.sign(d);
    if (!direction) direction = sign;
    else if (sign !== direction) fail('x must be strictly monotonic; unordered input is not sorted automatically.');
  }
  return direction || 1;
}

function roiIndices(dataset, roi, { weighted = false, minimum = 1 } = {}) {
  const n = checkDataset(dataset);
  if (roi != null && (!Array.isArray(roi) || roi.length !== 2 || !finite(roi[0]) || !finite(roi[1]) || roi[0] > roi[1])) {
    fail('ROI must be [min, max] with finite min <= max.');
  }
  const indices = [];
  for (let i = 0; i < n; i++) {
    if (isMasked(dataset, i)) continue;
    const x = dataset.x[i];
    if (roi && finite(x) && (x < roi[0] || x > roi[1])) continue;
    indices.push(i);
  }
  assertFiniteRows(dataset, indices, { error: weighted });
  if (indices.length < minimum) fail(`Analysis requires at least ${minimum} unmasked point(s) in the ROI.`);
  return indices;
}

function datasetResult(type, dataset, params, y, extras = undefined, overrides = {}) {
  const data = {
    x: overrides.x ? [...overrides.x] : [...dataset.x],
    y: [...y],
    error: overrides.error !== undefined ? overrides.error : dataset.error == null ? undefined : [...dataset.error],
    mask: overrides.mask !== undefined ? overrides.mask : dataset.mask == null ? undefined : [...dataset.mask],
    name: overrides.name ?? dataset.name,
    xLabel: overrides.xLabel ?? dataset.xLabel ?? 'X',
    yLabel: overrides.yLabel ?? dataset.yLabel ?? 'Y',
    xUnit: overrides.xUnit ?? dataset.xUnit ?? '',
    yUnit: overrides.yUnit ?? dataset.yUnit ?? '',
  };
  if (data.error === undefined) delete data.error;
  if (data.mask === undefined) delete data.mask;
  const result = { kind: 'dataset', data, operation: { type, params: copyParams(params) } };
  if (extras !== undefined) result.extras = extras;
  return result;
}

function resultEnvelope(result, dataset) {
  result.datasetId = dataset.id ?? null;
  result.datasetRevision = dataset.revision ?? null;
  return { kind: 'result', result };
}

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let i = 1; i <= k; i++) value = (value * (n - i + 1)) / i;
  return value;
}

function svdSymmetricSolve(gram, rhs) {
  const matrix = new Matrix(gram);
  const svd = new SingularValueDecomposition(matrix, { autoTranspose: true });
  const diagonal = Array.from(svd.diagonal);
  const max = diagonal.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
  const tolerance = Math.max(matrix.rows, matrix.columns) * Number.EPSILON * max;
  const rank = diagonal.filter((s) => Math.abs(s) > tolerance).length;
  if (rank < matrix.columns) return { rank, solution: null, inverse: null };
  const solution = svd.solve(Matrix.columnVector(rhs)).to1DArray();
  return { rank, solution, inverse: svd.inverse() };
}

function polynomialRegression(x, y, sigma, degree, { requireCovariance = true } = {}) {
  const p = degree + 1;
  if (!Number.isInteger(degree) || degree < 0 || degree > 12) fail('Polynomial degree must be an integer from 0 to 12.');
  if (x.length < p || (requireCovariance && x.length === p)) {
    return { valid: false, message: requireCovariance ? `At least ${p + 1} points are required to estimate covariance.` : `At least ${p} points are required.` };
  }
  let xmin = x[0];
  let xmax = x[0];
  for (let i = 1; i < x.length; i++) {
    if (x[i] < xmin) xmin = x[i];
    if (x[i] > xmax) xmax = x[i];
  }
  const center = (xmin + xmax) / 2;
  const scale = (xmax - xmin) / 2;
  if (!(scale > 0) && degree > 0) return { valid: false, message: 'The fit is rank-deficient because all x values are equal.' };
  const safeScale = scale || 1;
  const gram = Array.from({ length: p }, () => Array(p).fill(0));
  const rhs = Array(p).fill(0);
  for (let i = 0; i < x.length; i++) {
    const t = (x[i] - center) / safeScale;
    const basis = Array(p);
    basis[0] = 1;
    for (let j = 1; j < p; j++) basis[j] = basis[j - 1] * t;
    const w = sigma ? 1 / (sigma[i] * sigma[i]) : 1;
    for (let j = 0; j < p; j++) {
      rhs[j] += w * basis[j] * y[i];
      for (let k = 0; k <= j; k++) gram[j][k] += w * basis[j] * basis[k];
    }
  }
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) gram[k][j] = gram[j][k];
  const solved = svdSymmetricSolve(gram, rhs);
  if (!solved.solution) return { valid: false, message: 'The design matrix is rank-deficient; covariance is undefined.' };
  const fitted = x.map((value) => {
    const t = (value - center) / safeScale;
    let sum = 0;
    for (let j = degree; j >= 0; j--) sum = sum * t + solved.solution[j];
    return sum;
  });
  let weightedSse = 0;
  for (let i = 0; i < y.length; i++) {
    const r = y[i] - fitted[i];
    weightedSse += sigma ? (r / sigma[i]) ** 2 : r * r;
  }
  const variance = x.length > p ? weightedSse / (x.length - p) : 0;
  const covarianceT = solved.inverse.clone().mul(variance);

  // Transform coefficients and covariance from t=(x-center)/scale to powers of x.
  const transform = Matrix.zeros(p, p);
  for (let k = 0; k < p; k++) {
    for (let j = 0; j <= k; j++) {
      transform.set(j, k, binomial(k, j) * (-center) ** (k - j) / safeScale ** k);
    }
  }
  const coefficients = transform.mmul(Matrix.columnVector(solved.solution)).to1DArray();
  const covariance = transform.mmul(covarianceT).mmul(transform.transpose());
  const uncertainty = Array.from({ length: p }, (_, i) => Math.sqrt(Math.max(0, covariance.get(i, i))));
  return {
    valid: true,
    coefficients,
    normalizedCoefficients: solved.solution,
    center,
    scale: safeScale,
    fitted,
    covariance,
    uncertainty,
    uncertaintyMethod: sigma ? 'relative-sigma-scaled' : 'residual-variance-scaled',
    degreesOfFreedom: x.length - p,
  };
}

function fitQuality(observed, fitted) {
  let sse = 0;
  let mean = 0;
  for (const value of observed) mean += value;
  mean /= observed.length;
  let sst = 0;
  const residuals = Array(observed.length);
  for (let i = 0; i < observed.length; i++) {
    const r = observed[i] - fitted[i];
    residuals[i] = r;
    sse += r * r;
    sst += (observed[i] - mean) ** 2;
  }
  return { residuals, rmse: Math.sqrt(sse / observed.length), r2: sst === 0 ? (sse === 0 ? 1 : null) : 1 - sse / sst, sse };
}

// Tách diagnostics khỏi tham số fit. RSS là tổng bình phương phần dư không
// trọng số; reduced chi-square chỉ có ý nghĩa khi có sigmaY theo từng điểm.
function fitDiagnostics(observed, fitted, parameterCount, sigma = null, quality = null) {
  if (!Array.isArray(observed) || !Array.isArray(fitted) || observed.length !== fitted.length || !observed.length) {
    return { rss: null, degreesOfFreedom: null, adjustedR2: null, aic: null, bic: null };
  }
  const q = quality ?? fitQuality(observed, fitted);
  const n = observed.length;
  const p = Number.isInteger(parameterCount) ? parameterCount : 0;
  const degreesOfFreedom = n - p;
  const adjustedR2 = degreesOfFreedom > 0 && q.r2 != null && n > 1
    ? 1 - (1 - q.r2) * (n - 1) / degreesOfFreedom : null;
  const rss = q.sse;
  // Information criterion với RSS bằng 0 tiến tới -Infinity. JSON không nên
  // truyền giá trị đó, nên trả null nhưng vẫn giữ RSS chính xác.
  const aic = rss > 0 ? n * Math.log(rss / n) + 2 * p : null;
  const bic = rss > 0 ? n * Math.log(rss / n) + p * Math.log(n) : null;
  const diagnostics = { rss, degreesOfFreedom, adjustedR2, aic, bic };
  if (sigma) {
    if (sigma.length !== n || degreesOfFreedom <= 0) diagnostics.reducedChiSquare = null;
    else {
      let chiSquare = 0;
      for (let i = 0; i < n; i++) chiSquare += ((observed[i] - fitted[i]) / sigma[i]) ** 2;
      diagnostics.reducedChiSquare = chiSquare / degreesOfFreedom;
    }
  }
  return diagnostics;
}

function invalidFit(model, dataset, params, message, selected = null) {
  const indices = selected ?? [];
  const diagnostics = fitDiagnostics(null, null, null);
  return resultEnvelope({
    type: 'fit', model, status: 'invalid', message, parameters: {}, peaks: [],
    x: indices.map((i) => dataset.x[i]), yFit: [], residuals: [], rmse: null, r2: null,
    uncertainty: null, iterations: 0, roi: params.roi ?? null,
    diagnostics, ...diagnostics,
  }, dataset);
}

function linearOrPolynomialFit(dataset, params) {
  const degree = params.model === 'linear' ? 1 : (params.degree ?? 2);
  let indices;
  try {
    indices = roiIndices(dataset, params.roi, { weighted: params.weighted === true, minimum: degree + 2 });
  } catch (error) {
    if (error instanceof AnalysisError) return invalidFit(params.model, dataset, params, error.message);
    throw error;
  }
  const x = indices.map((i) => dataset.x[i]);
  const y = indices.map((i) => dataset.y[i]);
  const sigma = params.weighted === true ? indices.map((i) => dataset.error[i]) : null;
  const regression = polynomialRegression(x, y, sigma, degree);
  if (!regression.valid) return invalidFit(params.model, dataset, params, regression.message, indices);
  const quality = fitQuality(y, regression.fitted);
  const parameters = params.model === 'linear'
    ? { intercept: regression.coefficients[0], slope: regression.coefficients[1] }
    : { coefficients: regression.coefficients, degree };
  const uncertainty = params.model === 'linear'
    ? { intercept: regression.uncertainty[0], slope: regression.uncertainty[1], covariance: regression.covariance.to2DArray(), method: regression.uncertaintyMethod, degreesOfFreedom: regression.degreesOfFreedom }
    : { coefficients: regression.uncertainty, covariance: regression.covariance.to2DArray(), method: regression.uncertaintyMethod, degreesOfFreedom: regression.degreesOfFreedom };
  const diagnostics = fitDiagnostics(y, regression.fitted, degree + 1, sigma, quality);
  return resultEnvelope({
    type: 'fit', model: params.model, status: 'success', message: '', parameters, peaks: [], x,
    yFit: regression.fitted, residuals: quality.residuals, rmse: quality.rmse, r2: quality.r2,
    uncertainty, iterations: 1, roi: params.roi ?? null, diagnostics, ...diagnostics,
  }, dataset);
}

function peakValue(model, peak, x) {
  const u = (x - peak.center) / peak.fwhm;
  const gaussian = peak.height * Math.exp(-4 * Math.log(2) * u * u);
  if (model === 'gaussian') return gaussian;
  const lorentzian = peak.height / (1 + 4 * u * u);
  if (model === 'lorentzian') return lorentzian;
  return (1 - peak.eta) * gaussian + peak.eta * lorentzian;
}

function peakArea(model, peak) {
  const gaussian = peak.height * peak.fwhm * SQRT_PI_OVER_LN2 / 2;
  const lorentzian = peak.height * peak.fwhm * Math.PI / 2;
  if (model === 'gaussian') return gaussian;
  if (model === 'lorentzian') return lorentzian;
  return (1 - peak.eta) * gaussian + peak.eta * lorentzian;
}

function nonlinearPeakFit(dataset, params) {
  const model = params.model;
  const seeds = params.peaks;
  if (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 10) return invalidFit(model, dataset, params, 'Provide between 1 and 10 initial peaks.');
  let indices;
  try {
    indices = roiIndices(dataset, params.roi, { weighted: params.weighted === true, minimum: 3 });
  } catch (error) {
    if (error instanceof AnalysisError) return invalidFit(model, dataset, params, error.message);
    throw error;
  }
  const x = indices.map((i) => dataset.x[i]);
  const y = indices.map((i) => dataset.y[i]);
  const sigma = params.weighted === true ? indices.map((i) => dataset.error[i]) : null;
  const baseline = finite(params.baseline) ? params.baseline : 0;
  const peaks = seeds.map((seed, index) => {
    if (!finite(seed.center) || !finite(seed.height) || !finite(seed.fwhm) || seed.fwhm <= 0) {
      fail(`Peak ${index + 1} needs finite center, height and positive FWHM.`);
    }
    return { center: seed.center, height: seed.height, fwhm: seed.fwhm, eta: model === 'pseudoVoigt' ? (seed.eta ?? 0.5) : undefined };
  });
  const descriptors = [];
  for (let i = 0; i < peaks.length; i++) {
    for (const key of model === 'pseudoVoigt' ? ['center', 'height', 'fwhm', 'eta'] : ['center', 'height', 'fwhm']) {
      const fixed = seeds[i].fixed?.[key] === true;
      if (fixed) continue;
      const explicit = seeds[i].bounds?.[key];
      let min = explicit?.[0] ?? -Number.MAX_VALUE;
      let max = explicit?.[1] ?? Number.MAX_VALUE;
      if (key === 'fwhm') min = Math.max(min, Number.EPSILON);
      if (key === 'eta') { min = Math.max(min, 0); max = Math.min(max, 1); }
      if (!finite(min) || !finite(max) || min > max) return invalidFit(model, dataset, params, `Invalid bounds for peak ${i + 1} ${key}.`, indices);
      descriptors.push({ peak: i, key, min, max });
    }
  }
  const unpack = (values) => {
    const expanded = peaks.map((peak) => ({ ...peak }));
    descriptors.forEach((descriptor, i) => { expanded[descriptor.peak][descriptor.key] = values[i]; });
    return expanded;
  };
  // ml-levenberg-marquardt calls the returned model for every x value. Expand
  // parameters once per optimizer step instead of allocating a peak array for
  // every point; this keeps multi-peak spectra comfortably inside the worker
  // timeout.
  const curveFor = (values) => {
    const expanded = unpack(values);
    return (value) => {
      let sum = baseline;
      for (const peak of expanded) sum += peakValue(model, peak, value);
      return sum;
    };
  };
  let parameterValues = descriptors.map((d) => peaks[d.peak][d.key]);
  let iterations = 0;
  let optimizerError = 0;
  if (descriptors.length) {
    if (x.length <= descriptors.length) return invalidFit(model, dataset, params, 'Too few points to estimate covariance for the free parameters.', indices);
    try {
      const lm = levenbergMarquardt({ x, y }, curveFor, {
        initialValues: parameterValues,
        minValues: descriptors.map((d) => d.min),
        maxValues: descriptors.map((d) => d.max),
        weights: sigma ?? 1,
        centralDifference: true,
        gradientDifference: parameterValues.map((value) => Math.max(1e-7, Math.abs(value) * 1e-5)),
        damping: 1e-2,
        maxIterations: 250,
        errorTolerance: 1e-12,
        timeout: 30,
      });
      parameterValues = lm.parameterValues;
      iterations = lm.iterations;
      optimizerError = lm.parameterError;
      if (!finite(optimizerError)) return invalidFit(model, dataset, params, 'The nonlinear optimizer returned a non-finite objective.', indices);
    } catch (error) {
      return invalidFit(model, dataset, params, `Nonlinear optimizer failed: ${error.message}`, indices);
    }
  }
  const fittedPeaks = unpack(parameterValues);
  if (fittedPeaks.some((peak) => !finite(peak.center) || !finite(peak.height) || !finite(peak.fwhm) || peak.fwhm <= 0 || (model === 'pseudoVoigt' && (!finite(peak.eta) || peak.eta < 0 || peak.eta > 1)))) {
    return invalidFit(model, dataset, params, 'The optimizer returned non-physical peak parameters.', indices);
  }
  const fittedCurve = curveFor(parameterValues);
  const yFit = x.map((value) => fittedCurve(value));
  const quality = fitQuality(y, yFit);
  const parameterCount = descriptors.length;
  let uncertainty = null;
  let covariance = null;
  let convergence = { reached: true, criterion: 'all parameters fixed', scaledStep: 0, tolerance: 1e-4 };
  if (descriptors.length) {
    const p = descriptors.length;
    const gram = Array.from({ length: p }, () => Array(p).fill(0));
    const gradient = Array(p).fill(0);
    const steps = parameterValues.map((value) => Math.max(1e-7, Math.abs(value) * 1e-5));
    const plusCurves = [];
    const minusCurves = [];
    for (let j = 0; j < p; j++) {
      const plus = [...parameterValues]; plus[j] += steps[j];
      const minus = [...parameterValues]; minus[j] -= steps[j];
      plusCurves[j] = curveFor(plus);
      minusCurves[j] = curveFor(minus);
    }
    for (let row = 0; row < x.length; row++) {
      const jac = Array(p);
      for (let j = 0; j < p; j++) {
        jac[j] = (plusCurves[j](x[row]) - minusCurves[j](x[row])) / (2 * steps[j]);
      }
      const w = sigma ? 1 / sigma[row] ** 2 : 1;
      const residual = y[row] - yFit[row];
      for (let j = 0; j < p; j++) {
        gradient[j] += w * jac[j] * residual;
        for (let k = 0; k <= j; k++) gram[j][k] += w * jac[j] * jac[k];
      }
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) gram[k][j] = gram[j][k];
    const solved = svdSymmetricSolve(gram, Array(p).fill(0));
    if (!solved.inverse) return invalidFit(model, dataset, params, 'The fitted covariance is rank-deficient.', indices);
    const stationarity = svdSymmetricSolve(gram, gradient).solution;
    if (!stationarity) return invalidFit(model, dataset, params, 'The fitted stationarity test is rank-deficient.', indices);
    let scaledStep = 0;
    for (let j = 0; j < p; j++) {
      const descriptor = descriptors[j];
      const value = parameterValues[j];
      const finiteRange = descriptor.max < Number.MAX_VALUE / 2 && descriptor.min > -Number.MAX_VALUE / 2
        ? Math.abs(descriptor.max - descriptor.min) : 0;
      const scale = Math.max(1, Math.abs(value), finiteRange);
      const atLower = value <= descriptor.min + 1e-8 * scale;
      const atUpper = value >= descriptor.max - 1e-8 * scale;
      const effectiveStep = (atLower && stationarity[j] < 0) || (atUpper && stationarity[j] > 0) ? 0 : stationarity[j];
      scaledStep = Math.max(scaledStep, Math.abs(effectiveStep) / scale);
    }
    convergence = { reached: finite(scaledStep) && scaledStep <= 1e-4, criterion: 'scaled Gauss-Newton step', scaledStep, tolerance: 1e-4 };
    let chi2 = 0;
    for (let i = 0; i < y.length; i++) chi2 += sigma ? ((y[i] - yFit[i]) / sigma[i]) ** 2 : (y[i] - yFit[i]) ** 2;
    covariance = solved.inverse.clone().mul(chi2 / (x.length - p));
    const std = Array.from({ length: p }, (_, i) => Math.sqrt(Math.max(0, covariance.get(i, i))));
    uncertainty = {
      freeParameters: descriptors.map((d, i) => ({ peak: d.peak, parameter: d.key, standardError: std[i] })),
      covariance: covariance.to2DArray(),
      method: sigma ? 'relative-sigma-scaled' : 'residual-variance-scaled',
      degreesOfFreedom: x.length - p,
    };
  }
  const peakOutput = fittedPeaks.map((peak, peakIndex) => {
    const output = { center: peak.center, height: peak.height, fwhm: peak.fwhm, area: peakArea(model, peak) };
    if (model === 'pseudoVoigt') output.eta = peak.eta;
    if (uncertainty) {
      output.uncertainty = {};
      for (const item of uncertainty.freeParameters) if (item.peak === peakIndex) output.uncertainty[item.parameter] = item.standardError;
    }
    return output;
  });
  const status = convergence.reached ? 'success' : 'invalid';
  const message = convergence.reached ? '' : `Optimizer did not satisfy the stationarity criterion (scaled step ${convergence.scaledStep}).`;
  const diagnostics = status === 'success'
    ? fitDiagnostics(y, yFit, parameterCount, sigma, quality)
    : fitDiagnostics(null, null, null);
  return resultEnvelope({
    type: 'fit', model, status, message, parameters: { baseline }, peaks: peakOutput,
    x, yFit, residuals: quality.residuals, rmse: quality.rmse, r2: quality.r2,
    uncertainty, iterations, optimizerError, convergence, roi: params.roi ?? null, diagnostics, ...diagnostics,
  }, dataset);
}

function fit(dataset, params) {
  if (!['linear', 'polynomial', 'gaussian', 'lorentzian', 'pseudoVoigt'].includes(params.model)) fail('Unknown fit model.');
  return params.model === 'linear' || params.model === 'polynomial'
    ? linearOrPolynomialFit(dataset, params)
    : nonlinearPeakFit(dataset, params);
}

function localPolynomialValue(x, y, target, degree, derivativeOrder = 0) {
  const scale = x.reduce((m, value) => Math.max(m, Math.abs(value - target)), 0) || 1;
  const t = x.map((value) => (value - target) / scale);
  const regression = polynomialRegression(t, y, null, degree, { requireCovariance: false });
  if (!regression.valid) fail(regression.message);
  const c = regression.coefficients;
  if (derivativeOrder === 0) return c[0];
  if (derivativeOrder === 1) return (c[1] ?? 0) / scale;
  return (2 * (c[2] ?? 0)) / (scale * scale);
}

function transformSimple(type, dataset, params) {
  assertFiniteRows(dataset);
  const y = [...dataset.y];
  let error = dataset.error == null ? undefined : [...dataset.error];
  if (type === 'offset') {
    if (!finite(params.value)) fail('Offset must be finite.');
    for (let i = 0; i < y.length; i++) if (finite(y[i])) y[i] += params.value;
  } else if (type === 'scale') {
    if (!finite(params.value)) fail('Scale factor must be finite.');
    for (let i = 0; i < y.length; i++) if (finite(y[i])) y[i] *= params.value;
    if (error) for (let i = 0; i < error.length; i++) if (finite(error[i])) error[i] *= Math.abs(params.value);
  } else {
    const indices = roiIndices(dataset, params.roi);
    let denominator;
    if (params.mode === 'maximum') {
      denominator = -Infinity;
      for (const i of indices) if (dataset.y[i] > denominator) denominator = dataset.y[i];
    } else if (params.mode === 'area') {
      assertMonotonic(dataset);
      denominator = 0;
      for (let j = 1; j < indices.length; j++) {
        const a = indices[j - 1]; const b = indices[j];
        if (b !== a + 1) continue;
        denominator += 0.5 * (dataset.y[a] + dataset.y[b]) * Math.abs(dataset.x[b] - dataset.x[a]);
      }
    } else fail('Normalize mode must be maximum or area.');
    if (!finite(denominator) || denominator === 0) fail('Normalization denominator is zero or non-finite.');
    for (let i = 0; i < y.length; i++) if (finite(y[i])) y[i] /= denominator;
    if (error) for (let i = 0; i < error.length; i++) if (finite(error[i])) error[i] /= Math.abs(denominator);
  }
  return datasetResult(type, dataset, params, y, undefined, { error });
}

function despike(dataset, params) {
  checkDataset(dataset);
  const window = params.window;
  const threshold = params.threshold;
  const action = params.action ?? 'replace';
  if (!Number.isInteger(window) || window < 3 || window % 2 === 0) fail('Despike window must be an odd integer of at least 3.');
  if (window > dataset.x.length) fail('Despike window exceeds the dataset length.');
  if (!(finite(threshold) && threshold > 0)) fail('Despike threshold must be positive and finite.');
  if (!['replace', 'mask'].includes(action)) fail("Despike action must be 'replace' or 'mask'.");
  const y = [...dataset.y];
  const mask = dataset.mask == null ? Array(dataset.x.length).fill(false) : [...dataset.mask];
  const half = Math.floor(window / 2);
  const indices = [];
  for (let i = 0; i < dataset.y.length; i++) {
    if (isMasked(dataset, i) || !finite(dataset.y[i])) continue;
    const neighbors = [];
    for (let j = Math.max(0, i - half); j <= Math.min(dataset.y.length - 1, i + half); j++) {
      if (!isMasked(dataset, j) && finite(dataset.y[j])) neighbors.push(dataset.y[j]);
    }
    // Cần ít nhất hai neighbor độc lập để ước lượng location/scale robust,
    // đặc biệt ở biên của rolling window.
    if (neighbors.length < 2) continue;
    neighbors.sort((a, b) => a - b);
    const middle = Math.floor(neighbors.length / 2);
    const localMedian = neighbors.length % 2 ? neighbors[middle] : (neighbors[middle - 1] + neighbors[middle]) / 2;
    const deviations = neighbors.map((value) => Math.abs(value - localMedian)).sort((a, b) => a - b);
    const mad = deviations.length % 2 ? deviations[middle] : (deviations[middle - 1] + deviations[middle]) / 2;
    // Khi MAD=0, dùng scale gắn với độ phân giải floating-point. Cách này bắt
    // isolated jump xác định, nhưng giữ nguyên cửa sổ hằng tuyệt đối.
    const scale = mad > 0 ? 1.4826 * mad : Number.EPSILON * Math.max(1, Math.abs(localMedian), Math.abs(dataset.y[i]));
    if (Math.abs(dataset.y[i] - localMedian) > threshold * scale) {
      indices.push(i);
      if (action === 'replace') y[i] = localMedian;
      else mask[i] = true;
    }
  }
  return datasetResult('despike', dataset, params, y, {
    type: 'despike', count: indices.length, indices,
    method: 'rolling-median/MAD with 1.4826 scaling', action,
  }, { mask });
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function statistics(dataset, params) {
  const indices = roiIndices(dataset, params.roi, { minimum: 1 });
  const values = indices.map((i) => dataset.y[i]);
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const sumSquares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const sampleSD = n >= 2 ? Math.sqrt(sumSquares / (n - 1)) : null;
  const standardError = sampleSD == null ? null : sampleSD / Math.sqrt(n);
  const warnings = [];
  let area = null;
  if (n < 2) warnings.push('At least two active points are required for area.');
  let monotonic = n >= 2;
  let direction = 0;
  for (let pos = 1; pos < n; pos++) {
    const delta = dataset.x[indices[pos]] - dataset.x[indices[pos - 1]];
    if (delta === 0 || !finite(delta) || (direction && Math.sign(delta) !== direction)) monotonic = false;
    else direction ||= Math.sign(delta);
    if (indices[pos] !== indices[pos - 1] + 1) monotonic = false;
  }
  if (n >= 2 && !monotonic) warnings.push('Area is unavailable unless X is strictly monotonic with contiguous active pairs.');
  if (!warnings.length && n >= 2) {
    area = 0;
    for (let pos = 1; pos < n; pos++) {
      const a = indices[pos - 1]; const b = indices[pos];
      area += 0.5 * (dataset.y[a] + dataset.y[b]) * Math.abs(dataset.x[b] - dataset.x[a]);
    }
  }
  return resultEnvelope({ type: 'statistics', roi: params.roi ?? null, n, mean, sampleSD,
    standardError, min: sorted[0], max: sorted[n - 1], median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75), area, warnings,
    warning: warnings.length ? warnings.join(' ') : null }, dataset);
}

function crop(dataset, params) {
  checkDataset(dataset);
  if (!finite(params.min) || !finite(params.max) || params.min > params.max) fail('Crop limits must be finite with min <= max.');
  for (let i = 0; i < dataset.x.length; i++) if (!finite(dataset.x[i])) fail(`Non-finite x value at row ${i + 1}.`);
  const take = [];
  for (let i = 0; i < dataset.x.length; i++) if (dataset.x[i] >= params.min && dataset.x[i] <= params.max) take.push(i);
  if (!take.length) fail('Crop range contains no points.');
  return datasetResult('crop', dataset, params, take.map((i) => dataset.y[i]), undefined, {
    x: take.map((i) => dataset.x[i]),
    error: dataset.error == null ? undefined : take.map((i) => dataset.error[i]),
    mask: dataset.mask == null ? undefined : take.map((i) => dataset.mask[i]),
  });
}

function resample(dataset, params) {
  const direction = assertMonotonic(dataset);
  if (!(finite(params.step) && params.step > 0)) fail('Resampling step must be positive and finite.');
  const n = dataset.x.length;
  if (n < 2) fail('Resampling requires at least two points.');
  const start = dataset.x[0]; const end = dataset.x[n - 1];
  const count = Math.floor(Math.abs(end - start) / params.step + 1e-12) + 1;
  if (count > 1_000_000) fail('Resampling would exceed 1,000,000 points.');
  const xNew = Array.from({ length: count }, (_, i) => start + direction * params.step * i);
  if (Math.abs(xNew[count - 1] - end) > params.step * 1e-9) xNew.push(end);
  const yNew = Array(xNew.length);
  const errorNew = dataset.error == null ? undefined : Array(xNew.length);
  const maskNew = Array(xNew.length).fill(false);
  let j = 0;
  for (let i = 0; i < xNew.length; i++) {
    const target = xNew[i];
    while (j + 1 < n && direction * (dataset.x[j + 1] - target) < 0) j++;
    if (j + 1 >= n || target === dataset.x[j]) {
      const k = j + 1 >= n ? n - 1 : j;
      maskNew[i] = isMasked(dataset, k);
      yNew[i] = maskNew[i] ? null : dataset.y[k];
      if (errorNew) errorNew[i] = maskNew[i] ? null : dataset.error[k];
    } else {
      const t = (target - dataset.x[j]) / (dataset.x[j + 1] - dataset.x[j]);
      maskNew[i] = isMasked(dataset, j) || isMasked(dataset, j + 1);
      yNew[i] = maskNew[i] ? null : dataset.y[j] * (1 - t) + dataset.y[j + 1] * t;
      if (errorNew) {
        errorNew[i] = maskNew[i] || !finite(dataset.error[j]) || !finite(dataset.error[j + 1])
          ? null
          : Math.hypot((1 - t) * dataset.error[j], t * dataset.error[j + 1]);
      }
    }
  }
  return datasetResult('resample', dataset, params, yNew, undefined, { x: xNew, error: errorNew, mask: maskNew });
}

function movingAverage(dataset, params) {
  assertMonotonic(dataset);
  const window = params.window;
  if (!Number.isInteger(window) || window < 1 || window % 2 === 0) fail('Moving-average window must be a positive odd integer.');
  if (window > dataset.x.length) fail('Moving-average window exceeds the dataset length.');
  const half = Math.floor(window / 2);
  const y = Array(dataset.y.length);
  for (let i = 0; i < y.length; i++) {
    if (isMasked(dataset, i)) { y[i] = null; continue; }
    let sum = 0; let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(y.length - 1, i + half); j++) {
      if (!isMasked(dataset, j)) { sum += dataset.y[j]; count++; }
    }
    y[i] = sum / count;
  }
  return datasetResult('movingAverage', dataset, params, y);
}

function savgol(dataset, params) {
  assertMonotonic(dataset);
  const { window, degree } = params;
  if (!Number.isInteger(window) || window < 3 || window % 2 === 0) fail('Savitzky-Golay window must be an odd integer of at least 3.');
  if (!Number.isInteger(degree) || degree < 0 || degree >= window) fail('Savitzky-Golay degree must be an integer smaller than the window.');
  if (window > dataset.x.length) fail('Savitzky-Golay window exceeds the dataset length.');
  const dx = (dataset.x[dataset.x.length - 1] - dataset.x[0]) / (dataset.x.length - 1);
  const tolerance = Math.max(1e-12, Math.abs(dx) * 1e-7);
  for (let i = 1; i < dataset.x.length; i++) if (Math.abs((dataset.x[i] - dataset.x[i - 1]) - dx) > tolerance) {
    fail('Savitzky-Golay filtering requires uniformly spaced x; resampling is never applied implicitly.');
  }
  const half = Math.floor(window / 2);
  const y = Array(dataset.y.length);
  for (let i = 0; i < y.length; i++) {
    if (isMasked(dataset, i)) { y[i] = null; continue; }
    let left = Math.max(0, Math.min(i - half, y.length - window));
    const xs = []; const ys = [];
    for (let j = left; j < left + window; j++) if (!isMasked(dataset, j)) { xs.push(dataset.x[j]); ys.push(dataset.y[j]); }
    if (xs.length <= degree) { y[i] = null; continue; }
    y[i] = localPolynomialValue(xs, ys, dataset.x[i], degree, 0);
  }
  return datasetResult('savgol', dataset, params, y);
}

function derivative(dataset, params) {
  assertMonotonic(dataset);
  const order = params.order;
  if (order !== 1 && order !== 2) fail('Derivative order must be 1 or 2.');
  const valid = [];
  for (let i = 0; i < dataset.x.length; i++) if (!isMasked(dataset, i)) valid.push(i);
  if (valid.length < (order === 1 ? 2 : 3)) fail('Too few unmasked points for the requested derivative.');
  const y = Array(dataset.y.length).fill(null);
  const points = Math.min(valid.length, Math.max(3, order + 1));
  for (let pos = 0; pos < valid.length; pos++) {
    const start = Math.max(0, Math.min(pos - 1, valid.length - points));
    const slice = valid.slice(start, start + points);
    y[valid[pos]] = localPolynomialValue(slice.map((i) => dataset.x[i]), slice.map((i) => dataset.y[i]), dataset.x[valid[pos]], Math.min(2, points - 1), order);
  }
  return datasetResult('derivative', dataset, params, y, { order }, {
    yLabel: `${order === 2 ? 'd²' : 'd'}(${dataset.yLabel || 'Y'})/${order === 2 ? 'd' : 'd'}${dataset.xLabel || 'X'}${order === 2 ? '²' : ''}`,
    yUnit: `${dataset.yUnit || 'Y'}/${dataset.xUnit || 'X'}${order === 2 ? '²' : ''}`,
  });
}

function integrate(dataset, params) {
  assertMonotonic(dataset);
  const y = Array(dataset.y.length).fill(null);
  let total = 0;
  let previous = null;
  for (let i = 0; i < dataset.x.length; i++) {
    if (isMasked(dataset, i)) continue;
    if (previous != null && previous === i - 1) total += 0.5 * (dataset.y[previous] + dataset.y[i]) * (dataset.x[i] - dataset.x[previous]);
    y[i] = total;
    previous = i;
  }
  return datasetResult('integrate', dataset, params, y, { total }, {
    yLabel: `Integral of ${dataset.yLabel || 'Y'}`,
    yUnit: `${dataset.yUnit || 'Y'}·${dataset.xUnit || 'X'}`,
  });
}

function alsBaseline(values, lambda, p, iterations) {
  const n = values.length;
  if (n < 3) fail('ALS baseline requires at least three unmasked points.');
  if (!(finite(lambda) && lambda > 0)) fail('ALS lambda must be positive and finite.');
  if (!(finite(p) && p > 0 && p < 1)) fail('ALS p must be between 0 and 1.');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) fail('ALS iterations must be an integer from 1 to 1000.');
  const weights = Array(n).fill(1);
  let z = [...values];
  const penaltyMain = Array(n).fill(6);
  penaltyMain[0] = penaltyMain[n - 1] = 1;
  penaltyMain[1] = penaltyMain[n - 2] = 5;
  const penaltyOne = Array(n - 1).fill(-4);
  penaltyOne[0] = penaltyOne[n - 2] = -2;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const diagonal = weights.map((w, i) => w + lambda * penaltyMain[i]);
    const one = penaltyOne.map((v) => lambda * v);
    const two = Array(n - 2).fill(lambda);
    const l0 = Array(n); const l1 = Array(n).fill(0); const l2 = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (i >= 2) l2[i] = two[i - 2] / l0[i - 2];
      if (i >= 1) l1[i] = (one[i - 1] - (i >= 2 ? l2[i] * l1[i - 1] : 0)) / l0[i - 1];
      const pivot = diagonal[i] - l1[i] ** 2 - l2[i] ** 2;
      if (!(pivot > 0)) fail('ALS banded solve lost positive definiteness.');
      l0[i] = Math.sqrt(pivot);
    }
    const forward = Array(n);
    for (let i = 0; i < n; i++) forward[i] = (weights[i] * values[i] - (i ? l1[i] * forward[i - 1] : 0) - (i > 1 ? l2[i] * forward[i - 2] : 0)) / l0[i];
    for (let i = n - 1; i >= 0; i--) z[i] = (forward[i] - (i + 1 < n ? l1[i + 1] * z[i + 1] : 0) - (i + 2 < n ? l2[i + 2] * z[i + 2] : 0)) / l0[i];
    for (let i = 0; i < n; i++) weights[i] = values[i] > z[i] ? p : 1 - p;
  }
  return z;
}

function baseline(dataset, params) {
  assertMonotonic(dataset);
  const baselineValues = Array(dataset.x.length).fill(null);
  const active = [];
  for (let i = 0; i < dataset.x.length; i++) if (!isMasked(dataset, i)) active.push(i);
  if (params.mode === 'constant') {
    const value = params.value ?? 0;
    if (!finite(value)) fail('Constant baseline value must be finite.');
    for (const i of active) baselineValues[i] = value;
  } else if (params.mode === 'als') {
    const fitted = alsBaseline(active.map((i) => dataset.y[i]), params.lambda ?? 1e5, params.p ?? 0.01, params.iterations ?? 10);
    active.forEach((index, i) => { baselineValues[index] = fitted[i]; });
  } else if (params.mode === 'linear' || params.mode === 'polynomial') {
    const bx = []; const by = [];
    for (const anchor of params.anchors ?? []) {
      if (!finite(anchor.x) || !finite(anchor.y)) fail('Baseline anchors must contain finite x and y.');
      bx.push(anchor.x); by.push(anchor.y);
    }
    for (const region of params.regions ?? []) {
      if (!Array.isArray(region) || region.length !== 2 || !finite(region[0]) || !finite(region[1]) || region[0] > region[1]) fail('Baseline regions must be [min,max].');
      for (const i of active) if (dataset.x[i] >= region[0] && dataset.x[i] <= region[1]) { bx.push(dataset.x[i]); by.push(dataset.y[i]); }
    }
    const degree = params.mode === 'linear' ? 1 : (params.degree ?? 2);
    if (bx.length < degree + 1) fail(`Baseline needs at least ${degree + 1} independent anchor/region points.`);
    const regression = polynomialRegression(bx, by, null, degree, { requireCovariance: false });
    if (!regression.valid) fail(regression.message);
    for (const i of active) {
      let value = 0;
      for (let j = degree; j >= 0; j--) value = value * dataset.x[i] + regression.coefficients[j];
      baselineValues[i] = value;
    }
  } else fail('Unknown baseline mode.');
  const corrected = baselineValues.map((value, i) => value == null ? null : dataset.y[i] - value);
  return datasetResult('baseline', dataset, params, corrected, { baseline: baselineValues });
}

function crossing(x1, y1, x2, y2, level) {
  if (y2 === y1) return (x1 + x2) / 2;
  return x1 + (level - y1) * (x2 - x1) / (y2 - y1);
}

function detectPeaks(dataset, params) {
  assertMonotonic(dataset);
  const indices = roiIndices(dataset, params.roi, { minimum: 3 });
  const prominenceMin = params.prominence ?? 0;
  const minDistance = params.minDistance ?? 0;
  const minWidth = params.minWidth ?? 0;
  if (![prominenceMin, minDistance, minWidth].every((v) => finite(v) && v >= 0)) fail('Peak thresholds must be finite and non-negative.');
  const candidates = [];
  for (let q = 1; q < indices.length - 1; q++) {
    const i = indices[q];
    if (indices[q - 1] !== i - 1 || indices[q + 1] !== i + 1) continue;
    if (!(dataset.y[i] > dataset.y[i - 1] && dataset.y[i] >= dataset.y[i + 1])) continue;
    let leftMin = dataset.y[i];
    for (let j = i - 1; j >= 0; j--) { leftMin = Math.min(leftMin, dataset.y[j]); if (dataset.y[j] > dataset.y[i] || isMasked(dataset, j)) break; }
    let rightMin = dataset.y[i];
    for (let j = i + 1; j < dataset.y.length; j++) { rightMin = Math.min(rightMin, dataset.y[j]); if (dataset.y[j] > dataset.y[i] || isMasked(dataset, j)) break; }
    const prominence = dataset.y[i] - Math.max(leftMin, rightMin);
    if (prominence < prominenceMin) continue;
    const level = dataset.y[i] - prominence / 2;
    let l = i;
    while (l > 0 && !isMasked(dataset, l - 1) && dataset.y[l - 1] > level) l--;
    let r = i;
    while (r + 1 < dataset.y.length && !isMasked(dataset, r + 1) && dataset.y[r + 1] > level) r++;
    const leftX = l > 0 && !isMasked(dataset, l - 1) ? crossing(dataset.x[l - 1], dataset.y[l - 1], dataset.x[l], dataset.y[l], level) : dataset.x[l];
    const rightX = r + 1 < dataset.y.length && !isMasked(dataset, r + 1) ? crossing(dataset.x[r], dataset.y[r], dataset.x[r + 1], dataset.y[r + 1], level) : dataset.x[r];
    const fwhm = Math.abs(rightX - leftX);
    if (fwhm < minWidth) continue;
    let area = 0;
    for (let j = l + 1; j <= r; j++) area += 0.5 * (dataset.y[j - 1] + dataset.y[j]) * Math.abs(dataset.x[j] - dataset.x[j - 1]);
    candidates.push({ center: dataset.x[i], height: dataset.y[i], fwhm, area, prominence });
  }
  candidates.sort((a, b) => b.prominence - a.prominence);
  const chosen = [];
  for (const candidate of candidates) if (chosen.every((peak) => Math.abs(peak.center - candidate.center) >= minDistance)) chosen.push(candidate);
  chosen.sort((a, b) => a.center - b.center);
  return resultEnvelope({ type: 'peaks', peaks: chosen }, dataset);
}

function correctPeakBroadening(observedDegrees, instrumentDegrees, correction) {
  const observed = observedDegrees * Math.PI / 180;
  const instrumental = instrumentDegrees * Math.PI / 180;
  let beta = observed;
  if (correction === 'gaussian') beta = Math.sqrt(observed ** 2 - instrumental ** 2);
  else if (correction === 'lorentzian') beta = observed - instrumental;
  return !finite(beta) || beta <= 0 ? null : beta;
}

function xrd(dataset, params) {
  if (params.confirmed !== true) fail('XRD crystallite-size calculation requires explicit confirmation of the wavelength/profile assumptions.');
  if (!Array.isArray(params.peaks)) fail('XRD analysis requires a peaks array.');
  const lambda = params.lambda ?? 1.5406;
  const K = params.K ?? 0.9;
  const instrument = params.instrumentFwhm ?? 0;
  const correction = params.correction ?? 'none';
  const profile = params.profile ?? 'gaussian';
  if (!(finite(lambda) && lambda > 0 && finite(K) && K > 0 && finite(instrument) && instrument >= 0)) fail('Invalid XRD wavelength, shape factor, or instrumental FWHM.');
  if (!['none', 'gaussian', 'lorentzian'].includes(correction)) fail('Unknown XRD broadening correction.');
  if (!['gaussian', 'lorentzian', 'pseudoVoigt'].includes(profile)) fail('Unknown XRD peak profile.');
  if (profile === 'pseudoVoigt' && correction !== 'none') fail('A single Gaussian/Lorentzian instrumental correction is not valid for a pseudo-Voigt profile.');
  if (correction !== 'none' && correction !== profile) fail('Instrumental broadening correction must match the selected Gaussian or Lorentzian peak profile.');
  const peaks = params.peaks.map((peak, index) => {
    if (!finite(peak.center) || peak.center <= 0 || peak.center >= 180 || !finite(peak.fwhm) || peak.fwhm <= 0) fail(`Invalid XRD peak ${index + 1}.`);
    const theta = peak.center * Math.PI / 360;
    const beta = correctPeakBroadening(peak.fwhm, instrument, correction);
    const warning = beta == null ? 'Instrumental broadening is greater than or equal to the observed FWHM.' : null;
    return {
      ...peak,
      dAngstrom: lambda / (2 * Math.sin(theta)),
      betaRadians: warning ? null : beta,
      sizeNm: warning ? null : (K * lambda) / (beta * Math.cos(theta)) / 10,
      warning,
    };
  });
  return resultEnvelope({ type: 'xrd', wavelengthAngstrom: lambda, shapeFactor: K, profile, correction, peaks }, dataset);
}

function transmittance(dataset, params) {
  assertFiniteRows(dataset);
  const y = dataset.y.map((value, i) => {
    if (isMasked(dataset, i)) return null;
    const fraction = params.percent === true ? value / 100 : value;
    if (!(fraction > 0 && fraction <= 1)) fail(`Transmittance at row ${i + 1} must be in (0, ${params.percent ? '100' : '1'}].`);
    return -Math.log10(fraction);
  });
  return datasetResult('transmittance', dataset, params, y, undefined, { yLabel: 'Absorbance', yUnit: '' });
}

function tauc(dataset, params) {
  assertMonotonic(dataset);
  if (params.confirmed !== true) fail('Tauc analysis requires explicit confirmation of transition and signal assumptions.');
  if (!['wavelength', 'energy'].includes(params.xMode) || !['alpha', 'absorbance', 'transmittance', 'reflectance'].includes(params.signal)) fail('Unknown Tauc xMode or signal type.');
  if (!['direct', 'indirect'].includes(params.transition)) fail('Tauc transition must be direct or indirect.');
  if (params.signal === 'absorbance' || params.signal === 'transmittance') {
    if (!(finite(params.thicknessNm) && params.thicknessNm > 0)) fail('A positive thicknessNm is required to convert optical signal to absorption coefficient.');
  }
  const x = Array(dataset.x.length); const y = Array(dataset.y.length);
  for (let i = 0; i < x.length; i++) {
    if (isMasked(dataset, i)) { x[i] = params.xMode === 'wavelength' && finite(dataset.x[i]) && dataset.x[i] !== 0 ? HC_EV_NM / dataset.x[i] : dataset.x[i]; y[i] = null; continue; }
    const energy = params.xMode === 'wavelength' ? HC_EV_NM / dataset.x[i] : dataset.x[i];
    if (!(finite(energy) && energy > 0)) fail(`Photon energy/wavelength at row ${i + 1} is invalid.`);
    let alpha;
    if (params.signal === 'alpha') alpha = dataset.y[i];
    else if (params.signal === 'reflectance') {
      const reflectance = params.percent === true ? dataset.y[i] / 100 : dataset.y[i];
      if (!(reflectance > 0 && reflectance <= 1)) fail(`Reflectance at row ${i + 1} must be in its physical range.`);
      alpha = (1 - reflectance) ** 2 / (2 * reflectance);
    } else {
      let absorbance = dataset.y[i];
      if (params.signal === 'transmittance') {
        const transmittanceValue = params.percent === true ? dataset.y[i] / 100 : dataset.y[i];
        if (!(transmittanceValue > 0 && transmittanceValue <= 1)) fail(`Transmittance at row ${i + 1} must be in its physical range.`);
        absorbance = -Math.log10(transmittanceValue);
      }
      if (!(finite(absorbance) && absorbance >= 0)) fail(`Absorbance at row ${i + 1} must be non-negative.`);
      alpha = 2.302585092994046 * absorbance / (params.thicknessNm * 1e-7);
    }
    if (!(finite(alpha) && alpha >= 0)) fail(`Absorption signal at row ${i + 1} must be finite and non-negative.`);
    x[i] = energy;
    y[i] = (alpha * energy) ** (params.transition === 'direct' ? 2 : 0.5);
  }
  let extras = { status: 'not-fitted', message: 'Choose an ROI to fit and extrapolate Eg.', Eg: null, fit: null, hcEvNm: HC_EV_NM, transition: params.transition, signal: params.signal };
  if (params.roi != null) {
    const temporary = { ...dataset, x, y, error: null };
    const fitResult = linearOrPolynomialFit(temporary, { model: 'linear', roi: params.roi, weighted: false }).result;
    if (fitResult.status === 'success') {
      const { slope, intercept } = fitResult.parameters;
      const Eg = -intercept / slope;
      const validEg = finite(Eg) && Eg >= 0 && slope > 0;
      extras = {
        ...extras,
        status: validEg ? 'success' : 'invalid',
        message: validEg ? '' : 'The selected Tauc region does not yield a positive slope and non-negative intercept energy.',
        Eg: validEg ? Eg : null,
        fit: fitResult,
      };
    } else extras = { ...extras, status: 'invalid', message: fitResult.message, fit: fitResult };
  }
  const spectralTerm = params.signal === 'reflectance' ? 'F(R)' : 'α';
  return datasetResult('tauc', dataset, params, y, extras, {
    x, error: undefined, xLabel: 'Photon energy', xUnit: 'eV',
    yLabel: params.transition === 'direct' ? `(${spectralTerm}hν)²` : `(${spectralTerm}hν)¹ᐟ²`,
    yUnit: params.signal === 'reflectance' ? 'a.u.' : '(eV·cm⁻¹)ⁿ',
  });
}

function williamsonHall(dataset, params) {
  if (params.confirmed !== true) fail('Williamson-Hall analysis requires explicit confirmation of the wavelength/profile assumptions.');
  if (!Array.isArray(params.peaks) || params.peaks.length < 3) fail('Williamson-Hall analysis requires at least three peaks.');
  const lambda = params.lambda ?? 1.5406;
  const K = params.K ?? 0.9;
  const instrument = params.instrumentFwhm ?? 0;
  const correction = params.correction ?? 'none';
  const profile = params.profile ?? 'gaussian';
  if (!(finite(lambda) && lambda > 0 && finite(K) && K > 0 && finite(instrument) && instrument >= 0)) fail('Invalid Williamson-Hall wavelength, shape factor, or instrumental FWHM.');
  if (!['none', 'gaussian', 'lorentzian'].includes(correction)) fail('Unknown Williamson-Hall broadening correction.');
  if (!['gaussian', 'lorentzian', 'pseudoVoigt'].includes(profile)) fail('Unknown Williamson-Hall peak profile.');
  if (profile === 'pseudoVoigt' && correction !== 'none') fail('A single Gaussian/Lorentzian instrumental correction is not valid for a pseudo-Voigt profile.');
  if (correction !== 'none' && correction !== profile) fail('Instrumental broadening correction must match the selected Gaussian or Lorentzian peak profile.');
  const warnings = [];
  if (correction === 'none') warnings.push('No instrumental broadening correction was applied; beta uses the observed FWHM.');
  const points = params.peaks.map((peak, index) => {
    if (!finite(peak.center) || peak.center <= 0 || peak.center >= 180 || !finite(peak.fwhm) || peak.fwhm <= 0) fail(`Invalid Williamson-Hall peak ${index + 1}.`);
    const thetaDegrees = peak.center / 2;
    const theta = thetaDegrees * Math.PI / 180;
    const beta = correctPeakBroadening(peak.fwhm, instrument, correction);
    const warning = beta == null ? 'Instrumental broadening is greater than or equal to the observed FWHM.' : null;
    if (warning) warnings.push(`Peak ${index + 1}: ${warning}`);
    const x = beta == null ? null : 4 * Math.sin(theta);
    const y = beta == null ? null : beta * Math.cos(theta);
    return { ...peak, thetaDegrees, betaRadians: beta, x, y, warning };
  });
  if (points.some((point) => point.x == null || point.y == null)) {
    return resultEnvelope({ type: 'williamsonHall', status: 'invalid', message: 'Instrumental broadening correction is non-physical for at least one peak.',
      wavelengthAngstrom: lambda, shapeFactor: K, profile, correction, points, regression: null, r2: null, uncertainties: null,
      warnings, warning: warnings.join(' ') }, dataset);
  }
  const x = points.map((point) => point.x); const y = points.map((point) => point.y);
  const regression = polynomialRegression(x, y, null, 1);
  if (!regression.valid) {
    warnings.push(regression.message);
    return resultEnvelope({ type: 'williamsonHall', status: 'invalid', message: regression.message,
      wavelengthAngstrom: lambda, shapeFactor: K, profile, correction, points, regression: null, r2: null, uncertainties: null,
      warnings, warning: warnings.join(' ') }, dataset);
  }
  const quality = fitQuality(y, regression.fitted);
  const intercept = regression.coefficients[0];
  const strain = regression.coefficients[1];
  const physical = intercept > 0 && strain >= 0;
  if (intercept <= 0) warnings.push('Williamson-Hall intercept must be positive to calculate crystallite size.');
  if (strain < 0) warnings.push('Williamson-Hall microstrain cannot be negative in the isotropic UDM interpretation.');
  const sizeNm = physical ? K * lambda / intercept / 10 : null;
  const uncertainties = {
    intercept: regression.uncertainty[0],
    strain: regression.uncertainty[1],
    sizeNm: physical ? K * lambda * regression.uncertainty[0] / (10 * intercept ** 2) : null,
  };
  const diagnostics = physical ? fitDiagnostics(y, regression.fitted, 2, null, quality) : fitDiagnostics(null, null, null);
  const message = intercept <= 0 ? 'The Williamson-Hall fit has a non-positive intercept.'
    : strain < 0 ? 'The Williamson-Hall fit has a negative microstrain slope.' : '';
  return resultEnvelope({ type: 'williamsonHall', status: physical ? 'success' : 'invalid',
    message, wavelengthAngstrom: lambda,
    shapeFactor: K, profile, correction, points,
    intercept, slope: strain, strain, uncertainty: { intercept: uncertainties.intercept, slope: uncertainties.strain },
    regression: { intercept, strain, fitted: regression.fitted, residuals: quality.residuals, rmse: quality.rmse,
      covariance: regression.covariance.to2DArray(), degreesOfFreedom: regression.degreesOfFreedom },
    r2: quality.r2, sizeNm, uncertainties, diagnostics, ...diagnostics,
    warnings, warning: warnings.length ? warnings.join(' ') : null }, dataset);
}

function cubicLattice(dataset, params) {
  if (params.confirmed !== true) fail('Cubic-lattice calculation requires explicit confirmation of the wavelength and indexing assumptions.');
  if (!Array.isArray(params.peaks) || params.peaks.length < 1) fail('Cubic-lattice calculation requires at least one reflection.');
  const lambda = params.lambda ?? 1.5406;
  const zeroShiftDegrees = params.zeroShiftDegrees ?? 0;
  if (!(finite(lambda) && lambda > 0 && finite(zeroShiftDegrees))) fail('Invalid cubic-lattice wavelength or zero shift.');
  const warnings = [];
  const peaks = params.peaks.map((peak, index) => {
    const indices = Array.isArray(peak.hkl) ? peak.hkl : [peak.h, peak.k, peak.l];
    const [h, k, l] = indices;
    if (!finite(peak.center) || indices.length !== 3 || !Number.isInteger(h) || !Number.isInteger(k) || !Number.isInteger(l) || (h === 0 && k === 0 && l === 0)) {
      fail(`Reflection ${index + 1} needs a finite center and integer h, k, l not all zero.`);
    }
    const corrected2theta = peak.center - zeroShiftDegrees;
    if (!(corrected2theta > 0 && corrected2theta < 180)) {
      warnings.push(`Reflection ${index + 1} has an invalid corrected 2theta.`);
      return { ...peak, h, k, l, corrected2theta, dAngstrom: null, aAngstrom: null };
    }
    const theta = corrected2theta * Math.PI / 360;
    const dAngstrom = lambda / (2 * Math.sin(theta));
    const aAngstrom = dAngstrom * Math.sqrt(h ** 2 + k ** 2 + l ** 2);
    return { ...peak, h, k, l, corrected2theta, dAngstrom, aAngstrom };
  });
  const values = peaks.map((peak) => peak.aAngstrom).filter(finite);
  if (values.length !== peaks.length) return resultEnvelope({ type: 'cubicLattice', status: 'invalid', message: 'At least one reflection has a non-physical corrected angle.',
    wavelengthAngstrom: lambda, zeroShiftDegrees, aMeanAngstrom: null, sampleSD: null, standardError: null, peaks, warnings,
    warning: warnings.join(' ') }, dataset);
  const aMeanAngstrom = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sampleSD = values.length >= 2 ? Math.sqrt(values.reduce((sum, value) => sum + (value - aMeanAngstrom) ** 2, 0) / (values.length - 1)) : null;
  const standardError = sampleSD == null ? null : sampleSD / Math.sqrt(values.length);
  if (values.length < 2) warnings.push('At least two reflections are required for sampleSD and standardError.');
  return resultEnvelope({ type: 'cubicLattice', status: 'success', message: '', wavelengthAngstrom: lambda,
    zeroShiftDegrees, aMeanAngstrom, sampleSD, standardError, peaks, warnings,
    warning: warnings.length ? warnings.join(' ') : null }, dataset);
}

function opticalAlpha(value, signal, params, row, { allowNonPositive = false } = {}) {
  if (signal === 'alpha') {
    if (!(finite(value))) fail(`Absorption coefficient at row ${row + 1} must be finite for an Urbach fit.`);
    if (!(value > 0)) {
      if (allowNonPositive) return null;
      fail(`Absorption coefficient at row ${row + 1} must be positive for an Urbach fit.`);
    }
    return value;
  }
  if (signal === 'reflectance') {
    const reflectance = params.percent === true ? value / 100 : value;
    if (!(reflectance > 0 && reflectance <= 1)) fail(`Reflectance at row ${row + 1} must be in its physical range.`);
    const kubelkaMunk = (1 - reflectance) ** 2 / (2 * reflectance);
    if (!(finite(kubelkaMunk))) fail(`Reflectance at row ${row + 1} must yield a finite Kubelka-Munk value for an Urbach fit.`);
    if (!(kubelkaMunk > 0)) {
      if (allowNonPositive) return null;
      fail(`Reflectance at row ${row + 1} must yield a positive Kubelka-Munk value for an Urbach fit.`);
    }
    return kubelkaMunk;
  }
  let absorbance = value;
  if (signal === 'transmittance') {
    const transmittanceValue = params.percent === true ? value / 100 : value;
    if (!(transmittanceValue > 0 && transmittanceValue <= 1)) fail(`Transmittance at row ${row + 1} must be in its physical range.`);
    absorbance = -Math.log10(transmittanceValue);
  }
  if (!(finite(absorbance) && absorbance >= 0)) fail(`Absorbance at row ${row + 1} must be non-negative.`);
  const alpha = 2.302585092994046 * absorbance / (params.thicknessNm * 1e-7);
  if (!(finite(alpha))) fail(`Absorption coefficient at row ${row + 1} must be finite for an Urbach fit.`);
  if (!(alpha > 0)) {
    if (allowNonPositive) return null;
    fail(`Absorption coefficient at row ${row + 1} must be positive for an Urbach fit.`);
  }
  return alpha;
}

function urbach(dataset, params) {
  assertMonotonic(dataset);
  if (params.confirmed !== true) fail('Urbach analysis requires explicit confirmation of the signal and optical assumptions.');
  if (!['wavelength', 'energy'].includes(params.xMode) || !['alpha', 'absorbance', 'transmittance', 'reflectance'].includes(params.signal)) fail('Unknown Urbach xMode or signal type.');
  if (params.roi == null) fail('Urbach analysis requires an explicit ROI with at least three points.');
  if (!Array.isArray(params.roi) || params.roi.length !== 2 || !finite(params.roi[0]) || !finite(params.roi[1]) || params.roi[0] > params.roi[1]) fail('ROI must be [min, max] with finite min <= max.');
  if ((params.signal === 'absorbance' || params.signal === 'transmittance') && !(finite(params.thicknessNm) && params.thicknessNm > 0)) fail('A positive thicknessNm is required to convert optical signal to absorption coefficient.');
  const x = Array(dataset.x.length); const y = Array(dataset.y.length);
  let outsideRoiCount = 0;
  for (let i = 0; i < x.length; i++) {
    if (isMasked(dataset, i)) { x[i] = params.xMode === 'wavelength' && finite(dataset.x[i]) && dataset.x[i] !== 0 ? HC_EV_NM / dataset.x[i] : dataset.x[i]; y[i] = null; continue; }
    const energy = params.xMode === 'wavelength' ? HC_EV_NM / dataset.x[i] : dataset.x[i];
    if (!(finite(energy) && energy > 0)) fail(`Photon energy/wavelength at row ${i + 1} is invalid.`);
    const inRoi = energy >= params.roi[0] && energy <= params.roi[1];
    const alpha = opticalAlpha(dataset.y[i], params.signal, params, i, { allowNonPositive: !inRoi });
    x[i] = energy;
    if (alpha == null) { y[i] = null; outsideRoiCount += 1; }
    else y[i] = Math.log(alpha);
  }
  const temporary = { ...dataset, x, y, error: null };
  let fitResult;
  try { fitResult = linearOrPolynomialFit(temporary, { model: 'linear', roi: params.roi, weighted: false }).result; }
  catch (error) { if (error instanceof AnalysisError) fitResult = { type: 'fit', status: 'invalid', message: error.message, diagnostics: fitDiagnostics(null, null, null) }; else throw error; }
  const warnings = params.signal === 'reflectance' ? ['Reflectance Urbach output is an apparent proxy based on Kubelka-Munk F(R).'] : [];
  if (outsideRoiCount) warnings.push(`${outsideRoiCount} non-positive alpha-equivalent point(s) outside the ROI were returned as null.`);
  let status = 'invalid'; let EuEv = null; let message = fitResult.message || '';
  if (fitResult.status === 'success' && fitResult.parameters.slope > 0) { status = 'success'; EuEv = 1 / fitResult.parameters.slope; message = ''; }
  else if (fitResult.status === 'success') message = 'Urbach fit slope must be positive.';
  const spectralTerm = params.signal === 'reflectance' ? 'F(R)' : 'α';
  return datasetResult('urbach', dataset, params, y, { type: 'urbach', status, message, EuEv, fit: fitResult,
    xMode: params.xMode, signal: params.signal, thicknessNm: params.thicknessNm ?? null, apparentProxy: params.signal === 'reflectance',
    outsideRoiCount, warnings },
  { x, error: undefined, xLabel: 'Photon energy', xUnit: 'eV', yLabel: `ln(${spectralTerm})${params.signal === 'reflectance' ? ' apparent proxy' : ''}`, yUnit: '' });
}

function peakRatio(dataset, params) {
  if (!Array.isArray(params.peaks) || !Number.isInteger(params.a) || !Number.isInteger(params.b)) fail('Peak ratio requires peaks and integer indices a and b.');
  const metric = params.metric ?? 'height';
  if (!['height', 'area'].includes(metric)) fail('Peak ratio metric must be height or area.');
  const numerator = params.peaks[params.a]?.[metric];
  const denominator = params.peaks[params.b]?.[metric];
  if (!finite(numerator) || !finite(denominator) || denominator === 0) fail('Selected peak metric is missing, non-finite, or has a zero denominator.');
  return resultEnvelope({ type: 'peakRatio', metric, a: params.a, b: params.b, numerator, denominator, ratio: numerator / denominator }, dataset);
}

export function runAnalysis({ type, dataset, params = {} }) {
  checkDataset(dataset);
  switch (type) {
    case 'crop': return crop(dataset, params);
    case 'offset': case 'scale': case 'normalize': return transformSimple(type, dataset, params);
    case 'despike': return despike(dataset, params);
    case 'statistics': return statistics(dataset, params);
    case 'resample': return resample(dataset, params);
    case 'movingAverage': return movingAverage(dataset, params);
    case 'savgol': return savgol(dataset, params);
    case 'derivative': return derivative(dataset, params);
    case 'integrate': return integrate(dataset, params);
    case 'baseline': return baseline(dataset, params);
    case 'detectPeaks': return detectPeaks(dataset, params);
    case 'fit': return fit(dataset, params);
    case 'xrd': return xrd(dataset, params);
    case 'transmittance': return transmittance(dataset, params);
    case 'tauc': return tauc(dataset, params);
    case 'williamsonHall': return williamsonHall(dataset, params);
    case 'cubicLattice': return cubicLattice(dataset, params);
    case 'urbach': return urbach(dataset, params);
    case 'peakRatio': return peakRatio(dataset, params);
    default: fail(`Unknown analysis type: ${type}`);
  }
}

export const NUMERICAL_CONSTANTS = Object.freeze({ HC_EV_NM });
