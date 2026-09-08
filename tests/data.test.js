import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  History, deriveDataset, makeDataset, makeProject, parseProject, serializeProject,
  validateDataset, validateProject,
  datasetIssues,
} from '../src/analysis/model.js';
import { datasetCSV, parseText, readFile, tableToDataset } from '../src/analysis/io.js';
import { loadProject, loadTransfer, saveProject, saveTransfer } from '../src/analysis/storage.js';
import { sampleDatasets } from '../src/analysis/samples.js';

test('table conversion retains invalid values as null and reports an issue', () => {
  const dataset = tableToDataset([
    ['angle', 'intensity', 'sigma'],
    ['1,5', '2,5', '0,1'],
    ['bad', '3,5', ''],
  ], { name: 'comma data', decimal: ',', errorColumn: 2 });
  assert.deepEqual(dataset.x, [1.5, null]);
  assert.deepEqual(dataset.y, [2.5, 3.5]);
  assert.deepEqual(dataset.error, [0.1, null]);
  assert.equal(dataset.issues.length, 1);
  assert.equal(dataset.x.length, 2);
});

test('CSV parser supports semicolon and whitespace delimiters', () => {
  assert.deepEqual(parseText('x;y\n1,2;3,4', { delimiter: ';', decimal: ',' }).sheets[0].rows, [['x', 'y'], [1.2, 3.4]]);
  assert.deepEqual(parseText('1  2\n3 4', { delimiter: 'whitespace' }).sheets[0].rows, [[1, 2], [3, 4]]);
  assert.deepEqual(parseText('1  2\n3 4').sheets[0].rows, [[1, 2], [3, 4]]);
});

test('XLSX import reads cached formula values and never evaluates code', async () => {
  const sheet = XLSX.utils.aoa_to_sheet([['x', 'y'], [1, 2]]);
  sheet.B2 = { t: 'n', v: 42, f: 'SUM(40,2)' };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Measured');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const result = await readFile({ name: 'fixture.xlsx', size: bytes.length, arrayBuffer: async () => bytes }, {});
  assert.deepEqual(result.sheets[0].rows.slice(0, 2), [['x', 'y'], [1, 42]]);
  assert.deepEqual(result.warnings, []);
});

test('derived datasets preserve source and record operation without mutating parent', () => {
  const parent = makeDataset({ name: 'raw', x: [1, 2], y: [3, 4], source: { kind: 'import', fileName: 'raw.csv' } });
  const child = deriveDataset(parent, { x: [1, 2], y: [6, 8], operation: { type: 'scale', params: { value: 2 } } });
  assert.notEqual(child.id, parent.id);
  assert.equal(child.parentId, parent.id);
  assert.deepEqual(child.source, parent.source);
  assert.deepEqual(child.operations, [{ type: 'scale', params: { value: 2 } }]);
  assert.deepEqual(parent.y, [3, 4]);
});

test('project serialisation and History return independent snapshots', () => {
  const project = makeProject({ name: 'test' });
  const dataset = makeDataset({ x: [1], y: [2] });
  project.datasets.push(dataset);
  project.activeDatasetId = dataset.id;
  validateProject(project);
  const restored = parseProject(serializeProject(project));
  assert.deepEqual(restored, project);
  const history = new History(project);
  const changed = parseProject(serializeProject(project));
  changed.name = 'changed';
  history.push(changed);
  assert.equal(history.undo().name, 'test');
  assert.equal(history.redo().name, 'changed');
  assert.equal(history.redo(), null);
});

test('dataset CSV includes full precision and exclusion mask', () => {
  const dataset = makeDataset({ x: [1 / 3], y: [2], mask: [true] });
  const csv = datasetCSV(dataset);
  assert.match(csv, /error,mask/);
  assert.match(csv, /0\.3333333333333333,2,,true/);
});

test('storage round trips autosave and transfer in non-browser runtime', async () => {
  const project = makeProject();
  const dataset = makeDataset({ x: [1], y: [2] });
  project.datasets.push(dataset);
  await saveProject(project);
  const loaded = await loadProject();
  assert.deepEqual(loaded, project);
  const transferId = await saveTransfer(dataset);
  assert.deepEqual(await loadTransfer(transferId), dataset);
  assert.equal(await loadTransfer('missing'), null);
});

test('sample datasets are deterministic and carry tutorial metadata', () => {
  const first = sampleDatasets();
  const second = sampleDatasets();
  assert.equal(first.length, 3);
  assert.deepEqual(first.map(d => d.id), second.map(d => d.id));
  assert.deepEqual(first.map(d => d.y), second.map(d => d.y));
  for (const dataset of first) {
    assert.equal(typeof dataset.tutorial, 'string');
    assert.equal(dataset.source.kind, 'sample');
    assert.deepEqual(validateDataset(dataset), []);
  }
});

test('quality diagnostics report invalid, duplicate, unordered and uncertainty rows without deleting them', () => {
  const data = makeDataset({ x: [0, null, 2, 1, 1], y: [1, 2, 3, 4, 5], error: [1, 1, 0, null, 1] });
  const issues = datasetIssues(data).join(' ');
  assert.match(issues, /1 dòng có X hoặc Y/);
  assert.match(issues, /1 giá trị X bị trùng/);
  assert.match(issues, /không đơn điệu/);
  assert.match(issues, /2 uncertainty/);
  assert.equal(data.x.length, 5);
});

test('project validation rejects stale figure and result references', () => {
  const project = makeProject();
  const data = makeDataset({ x: [1], y: [2] });
  project.datasets.push(data);
  project.figures.push({ id: 'f', panels: [{ series: [{ datasetId: 'missing' }] }] });
  assert.throws(() => validateProject(project), /missing dataset/);
  project.figures[0].panels[0].series[0].datasetId = data.id;
  project.results.push({ datasetId: data.id, datasetRevision: 999 });
  assert.throws(() => validateProject(project), /revision/);
});
