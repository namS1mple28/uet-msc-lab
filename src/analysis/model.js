/* Data Studio's small, deliberately boring, serialisable data model. */

export const LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  points: 1_000_000,
  peaks: 10,
  timeoutMs: 30_000,
});

const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
let idCounter = 0;

function makeId(prefix = 'ds') {
  const random = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

function isObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('Cyclic data is not serialisable');
  seen.set(value, true);
  try {
    if (Array.isArray(value)) return value.map(item => clone(item, seen));
    if (!isObject(value)) throw new TypeError('Only plain objects are serialisable');
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (BAD_KEYS.has(key)) throw new TypeError(`Unsafe object key: ${key}`);
      result[key] = clone(item, seen);
    }
    return result;
  } finally {
    // `seen` is the current recursion stack, so shared (but non-cyclic)
    // metadata objects remain legal while actual cycles are rejected.
    seen.delete(value);
  }
}

function normalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function numberArray(values, field) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array`);
  return values.map(normalNumber);
}

function boolArray(values, length) {
  if (values === undefined || values === null) return Array(length).fill(false);
  if (!Array.isArray(values) || values.length !== length) {
    throw new TypeError('mask must have the same length as x and y');
  }
  return values.map(Boolean);
}

/** Create a dataset while retaining the row count (invalid values become null). */
export function makeDataset({
  id,
  revision = 1,
  name = 'Untitled dataset',
  x,
  y,
  error = null,
  mask,
  xLabel = 'X',
  yLabel = 'Y',
  xUnit = '',
  yUnit = '',
  source = { kind: 'import' },
  parentId = null,
  operations = [],
  ...metadata
} = {}) {
  const xx = numberArray(x, 'x');
  const yy = numberArray(y, 'y');
  if (xx.length !== yy.length) throw new TypeError('x and y must have the same length');
  const ee = error === null || error === undefined ? null : numberArray(error, 'error');
  if (ee && ee.length !== xx.length) throw new TypeError('error must have the same length as x and y');
  if (typeof name !== 'string' || typeof xLabel !== 'string' || typeof yLabel !== 'string' ||
      typeof xUnit !== 'string' || typeof yUnit !== 'string') {
    throw new TypeError('Dataset labels and name must be strings');
  }
  const dataset = {
    id: id ?? makeId(),
    revision,
    name,
    x: xx,
    y: yy,
    error: ee,
    mask: boolArray(mask, xx.length),
    xLabel,
    yLabel,
    xUnit,
    yUnit,
    source: clone(source),
    parentId,
    operations: clone(operations),
    ...clone(metadata),
  };
  return dataset;
}

function safeIssue(value, path, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path} must contain finite numbers`];
  if (typeof value !== 'object') return [`${path} contains an unsafe value`];
  if (seen.has(value)) return [`${path} must not be cyclic`];
  seen.add(value);
  const issues = [];
  if (Array.isArray(value)) value.forEach((item, i) => issues.push(...safeIssue(item, `${path}[${i}]`, seen)));
  else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (BAD_KEYS.has(key)) issues.push(`${path} contains unsafe key "${key}"`);
      issues.push(...safeIssue(item, `${path}.${key}`, seen));
    }
  } else issues.push(`${path} must contain plain objects or arrays`);
  seen.delete(value);
  return issues;
}

function checkNumericArray(values, field, expectedLength, issues) {
  if (!Array.isArray(values)) { issues.push(`${field} must be an array`); return; }
  if (expectedLength !== undefined && values.length !== expectedLength) issues.push(`${field} length must match x and y`);
  values.forEach((value, i) => {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) issues.push(`${field}[${i}] must be a finite number or null`);
  });
}

export function validateDataset(dataset) {
  const issues = [];
  if (!isObject(dataset)) return ['Dataset must be a plain object'];
  issues.push(...safeIssue(dataset, 'dataset'));
  if (typeof dataset.id !== 'string' || !dataset.id) issues.push('id must be a non-empty string');
  if (!Number.isInteger(dataset.revision) || dataset.revision < 1) issues.push('revision must be a positive integer');
  for (const field of ['name', 'xLabel', 'yLabel', 'xUnit', 'yUnit']) if (typeof dataset[field] !== 'string') issues.push(`${field} must be a string`);
  const length = Array.isArray(dataset.x) ? dataset.x.length : undefined;
  if (!Array.isArray(dataset.x) || !Array.isArray(dataset.y)) {
    if (!Array.isArray(dataset.x)) issues.push('x must be an array');
    if (!Array.isArray(dataset.y)) issues.push('y must be an array');
  } else if (dataset.x.length !== dataset.y.length) issues.push('x and y must have the same length');
  if (length !== undefined && length > LIMITS.points) issues.push(`dataset exceeds the ${LIMITS.points} point limit`);
  checkNumericArray(dataset.x, 'x', undefined, issues);
  checkNumericArray(dataset.y, 'y', length, issues);
  if (dataset.error !== null) checkNumericArray(dataset.error, 'error', length, issues);
  if (!Array.isArray(dataset.mask) || (length !== undefined && dataset.mask.length !== length)) issues.push('mask must match x and y length');
  else dataset.mask.forEach((v, i) => { if (typeof v !== 'boolean') issues.push(`mask[${i}] must be boolean`); });
  if (!isObject(dataset.source)) issues.push('source must be a plain object');
  if (!Array.isArray(dataset.operations)) issues.push('operations must be an array');
  return [...new Set(issues)];
}

/**
 * Non-destructive data-quality diagnostics. These are warnings, not schema
 * errors: imported rows remain visible until the user masks or edits them.
 */
export function datasetIssues(dataset) {
  const structural = validateDataset(dataset);
  if (structural.length) return structural;
  const issues = [];
  let invalid = 0;
  let invalidError = 0;
  let direction = 0;
  let unordered = false;
  let duplicates = 0;
  let previousX = null;
  const seen = new Set();
  for (let i = 0; i < dataset.x.length; i += 1) {
    if (dataset.mask[i]) continue;
    const x = dataset.x[i];
    const y = dataset.y[i];
    if (x === null || y === null) {
      invalid += 1;
      continue;
    }
    if (dataset.error && (dataset.error[i] === null || dataset.error[i] <= 0)) invalidError += 1;
    const key = Object.is(x, -0) ? '0' : String(x);
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    if (previousX !== null) {
      const step = x - previousX;
      if (step !== 0) {
        const sign = Math.sign(step);
        if (direction && sign !== direction) unordered = true;
        direction ||= sign;
      }
    }
    previousX = x;
  }
  if (!dataset.x.length) issues.push('Dataset không có điểm dữ liệu.');
  if (invalid) issues.push(`${invalid} dòng có X hoặc Y trống/không hợp lệ.`);
  if (duplicates) issues.push(`${duplicates} giá trị X bị trùng.`);
  if (unordered) issues.push('X không đơn điệu; engine sẽ không tự sắp xếp dữ liệu.');
  if (invalidError) issues.push(`${invalidError} uncertainty không dương hoặc không hợp lệ; weighted fitting sẽ từ chối.`);
  if (Array.isArray(dataset.issues)) issues.push(...dataset.issues);
  return [...new Set(issues)];
}

export function deriveDataset(dataset, { x, y, error, mask, name, operation, ...rest } = {}) {
  const baseIssues = validateDataset(dataset);
  if (baseIssues.length) throw new TypeError(`Invalid parent dataset: ${baseIssues.join('; ')}`);
  const nextX = x ?? dataset.x;
  const nextY = y ?? dataset.y;
  const sameLength = nextX.length === dataset.x.length && nextY.length === dataset.y.length;
  const derived = makeDataset({
    ...Object.fromEntries(Object.entries(dataset).filter(([key]) => !['id', 'revision', 'parentId', 'operations', 'x', 'y', 'error', 'mask', 'name'].includes(key))),
    name: name ?? `${dataset.name} (derived)`,
    x: nextX,
    y: nextY,
    error: error === undefined ? (sameLength ? dataset.error : null) : error,
    mask: mask === undefined ? (sameLength ? dataset.mask : undefined) : mask,
    source: dataset.source,
    parentId: dataset.id,
    operations: [...dataset.operations, clone(operation ?? { ...rest })],
  });
  return derived;
}

export function makeProject({ id, name = 'Untitled project' } = {}) {
  return {
    schemaVersion: 1,
    id: id ?? makeId('project'),
    name,
    datasets: [],
    figures: [],
    results: [],
    operations: [],
    activeDatasetId: null,
  };
}

function checkPeaks(value, path, issues) {
  if (Array.isArray(value) && /(^|\.)peaks$/.test(path) && value.length > LIMITS.peaks) issues.push(`${path} exceeds the ${LIMITS.peaks} peak limit`);
  if (Array.isArray(value)) value.forEach((v, i) => checkPeaks(v, `${path}[${i}]`, issues));
  else if (isObject(value)) Object.entries(value).forEach(([k, v]) => checkPeaks(v, `${path}.${k}`, issues));
}

export function validateProject(project) {
  if (!isObject(project)) throw new TypeError('Project must be a plain object');
  const safeIssues = safeIssue(project, 'project');
  if (safeIssues.length) throw new TypeError(safeIssues.join('; '));
  if (project.schemaVersion !== 1) throw new TypeError('Unsupported project schemaVersion');
  if (typeof project.id !== 'string' || !project.id) throw new TypeError('Project id must be a non-empty string');
  if (typeof project.name !== 'string') throw new TypeError('Project name must be a string');
  for (const field of ['datasets', 'figures', 'results', 'operations']) if (!Array.isArray(project[field])) throw new TypeError(`Project ${field} must be an array`);
  const ids = new Set();
  let totalPoints = 0;
  for (const dataset of project.datasets) {
    const errors = validateDataset(dataset);
    if (errors.length) throw new TypeError(`Invalid dataset: ${errors.join('; ')}`);
    if (ids.has(dataset.id)) throw new TypeError(`Duplicate dataset id: ${dataset.id}`);
    ids.add(dataset.id);
    totalPoints += dataset.x.length;
  }
  if (totalPoints > LIMITS.points) throw new RangeError(`Project exceeds the ${LIMITS.points} point limit`);
  if (project.activeDatasetId !== null && (typeof project.activeDatasetId !== 'string' || !ids.has(project.activeDatasetId))) throw new TypeError('activeDatasetId must refer to a dataset or be null');
  const figureIds = new Set();
  for (const figure of project.figures) {
    if (!isObject(figure) || typeof figure.id !== 'string' || !figure.id) throw new TypeError('Each figure needs a non-empty id');
    if (figureIds.has(figure.id)) throw new TypeError(`Duplicate figure id: ${figure.id}`);
    figureIds.add(figure.id);
    if (!Array.isArray(figure.panels)) throw new TypeError(`Figure ${figure.id} panels must be an array`);
    for (const panel of figure.panels) {
      if (!isObject(panel) || !Array.isArray(panel.series)) throw new TypeError(`Figure ${figure.id} contains an invalid panel`);
      for (const series of panel.series) if (!ids.has(series.datasetId)) throw new TypeError(`Figure series refers to missing dataset: ${series.datasetId}`);
    }
  }
  const revisions = new Map(project.datasets.map(dataset => [dataset.id, dataset.revision]));
  for (const result of project.results) {
    if (!isObject(result)) throw new TypeError('Project results must contain plain objects');
    if (result.datasetId !== null && result.datasetId !== undefined) {
      if (!ids.has(result.datasetId)) throw new TypeError(`Result refers to missing dataset: ${result.datasetId}`);
      if (result.datasetRevision !== revisions.get(result.datasetId)) throw new TypeError(`Result revision does not match dataset ${result.datasetId}`);
    }
  }
  const peakIssues = [];
  checkPeaks(project, 'project', peakIssues);
  if (peakIssues.length) throw new RangeError(peakIssues[0]);
  return true;
}

export function serializeProject(project) {
  validateProject(project);
  return JSON.stringify(clone(project));
}

export function parseProject(serialized) {
  if (typeof serialized !== 'string') throw new TypeError('Serialized project must be a JSON string');
  let project;
  try { project = JSON.parse(serialized); } catch (error) { throw new TypeError(`Invalid project JSON: ${error.message}`); }
  validateProject(project);
  return clone(project);
}

export class History {
  constructor(initial = null) {
    this.snapshots = [];
    this.index = -1;
    if (initial !== null) this.push(initial);
  }

  push(project) {
    validateProject(project);
    this.snapshots.splice(this.index + 1);
    this.snapshots.push(clone(project));
    this.index = this.snapshots.length - 1;
    return clone(project);
  }

  undo() {
    if (this.index <= 0) return null;
    this.index -= 1;
    return clone(this.snapshots[this.index]);
  }

  redo() {
    if (this.index >= this.snapshots.length - 1) return null;
    this.index += 1;
    return clone(this.snapshots[this.index]);
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index >= 0 && this.index < this.snapshots.length - 1; }
}

export const cloneProject = clone;
