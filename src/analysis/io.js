import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { LIMITS, makeDataset } from './model.js';

function extension(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)(?:\.gz)?$/);
  return match ? match[1] : '';
}

function localizedNumber(value, decimal = '.') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const normalized = decimal === ',' && /^[-+]?\d+(?:,\d+)?(?:[eE][-+]?\d+)?$/.test(text)
    ? text.replace(',', '.')
    : text;
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function convertCells(rows, decimal) {
  return rows.map(row => row.map(cell => {
    if (typeof cell !== 'string') return cell;
    const n = localizedNumber(cell, decimal);
    return n === null ? cell : n;
  }));
}

function parseWhitespace(text, decimal) {
  const rows = String(text).replace(/^\uFEFF/, '').split(/\r?\n|\r/).map(line => {
    if (!line.trim()) return [];
    return line.trim().split(/\s+/);
  });
  return { rows: convertCells(rows, decimal), warnings: [] };
}

/** Parse delimited text without discarding malformed or blank rows. */
export function parseText(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('Text input must be a string');
  const delimiter = options.delimiter ?? 'auto';
  if (delimiter === 'whitespace') return { sheets: [{ name: options.sheetName ?? 'Sheet1', rows: parseWhitespace(text, options.decimal ?? '.').rows }], warnings: [] };
  if (delimiter === 'auto') {
    const sample = text.replace(/^\uFEFF/, '').split(/\r?\n|\r/).filter(line => line.trim()).slice(0, 12);
    const whitespaceColumns = sample.length && sample.every(line => line.trim().split(/\s+/).length > 1);
    const hasStrongDelimiter = sample.some(line => /[;\t|]/.test(line));
    if (!hasStrongDelimiter && whitespaceColumns) {
      return { sheets: [{ name: options.sheetName ?? 'Sheet1', rows: parseWhitespace(text, options.decimal ?? '.').rows }], warnings: [] };
    }
  }
  const config = { skipEmptyLines: false, dynamicTyping: false, newline: '', quoteChar: '"' };
  if (delimiter !== 'auto' && delimiter !== '') config.delimiter = delimiter;
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), config);
  const warnings = (parsed.errors ?? []).map(error => {
    const row = error.row === undefined ? '' : ` (row ${error.row + 1})`;
    return `${error.message}${row}`;
  });
  return {
    sheets: [{ name: options.sheetName ?? 'Sheet1', rows: convertCells(parsed.data, options.decimal ?? '.') }],
    warnings,
  };
}

async function readBytes(file) {
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  if (ArrayBuffer.isView(file)) return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  if (file && typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return null;
}

async function readTextValue(file) {
  if (typeof file === 'string') return file;
  if (file && typeof file.text === 'function') return file.text();
  const bytes = await readBytes(file);
  if (bytes) return new TextDecoder().decode(bytes);
  throw new TypeError('Unsupported file input');
}

function xlsxRows(bytes) {
  // SheetJS reads the cached `v` value; formulas are never evaluated here.
  const workbook = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, cellText: false, WTF: false });
  const sheets = workbook.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }),
  }));
  return { sheets, warnings: [] };
}

/** Read CSV/TXT/DAT or XLSX from a File/Blob/Buffer/ArrayBuffer. */
export async function readFile(file, options = {}) {
  const fileName = options.name ?? file?.name ?? '';
  const knownSize = Number(file?.size);
  if (Number.isFinite(knownSize) && knownSize > LIMITS.fileBytes) throw new RangeError(`File exceeds the ${LIMITS.fileBytes} byte limit`);
  const ext = extension(fileName);
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') {
    const bytes = await readBytes(file);
    if (!bytes) throw new TypeError('XLSX input must provide arrayBuffer() or bytes');
    if (bytes.byteLength > LIMITS.fileBytes) throw new RangeError(`File exceeds the ${LIMITS.fileBytes} byte limit`);
    return xlsxRows(bytes);
  }
  const text = await readTextValue(file);
  if (new TextEncoder().encode(text).byteLength > LIMITS.fileBytes) throw new RangeError(`File exceeds the ${LIMITS.fileBytes} byte limit`);
  return parseText(text, options);
}

function cellText(value, decimal) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return localizedNumber(value, decimal);
}

function describe(value) {
  if (value === undefined) return 'missing';
  if (value === null || value === '') return 'empty';
  return JSON.stringify(value);
}

/** Convert a table while retaining every input row, including invalid cells as null. */
export function tableToDataset(rows, {
  name = 'Imported data', headerRow = 0, xColumn = 0, yColumn = 1, errorColumn = null,
  xLabel, yLabel, xUnit = '', yUnit = '', decimal = '.', source = { kind: 'import' },
} = {}) {
  if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) throw new TypeError('rows must be an array of arrays');
  if (!(headerRow === -1 || Number.isInteger(headerRow) && headerRow >= 0)) throw new TypeError('headerRow must be -1 or a non-negative integer');
  for (const [key, value] of [['xColumn', xColumn], ['yColumn', yColumn]]) if (!Number.isInteger(value) || value < 0) throw new TypeError(`${key} must be a non-negative integer`);
  if (errorColumn !== null && (!Number.isInteger(errorColumn) || errorColumn < 0)) throw new TypeError('errorColumn must be null or a non-negative integer');
  const header = headerRow >= 0 && rows[headerRow] ? rows[headerRow] : [];
  const dataRows = rows.slice(headerRow < 0 ? 0 : headerRow + 1);
  const issues = [];
  const values = (column, label) => dataRows.map((row, i) => {
    const raw = row[column];
    const value = cellText(raw, decimal);
    if (value === null && raw !== null && raw !== undefined && raw !== '') issues.push(`row ${i + (headerRow < 0 ? 1 : headerRow + 2)}, column ${column + 1} (${label}): invalid numeric value ${describe(raw)}`);
    if (raw === undefined) issues.push(`row ${i + (headerRow < 0 ? 1 : headerRow + 2)}, column ${column + 1} (${label}): missing value retained as null`);
    return value;
  });
  const x = values(xColumn, 'x');
  const y = values(yColumn, 'y');
  const error = errorColumn === null ? null : values(errorColumn, 'error');
  const dataset = makeDataset({
    name,
    x,
    y,
    error,
    xLabel: xLabel ?? (header[xColumn] == null ? 'X' : String(header[xColumn])),
    yLabel: yLabel ?? (header[yColumn] == null ? 'Y' : String(header[yColumn])),
    xUnit, yUnit, source, issues,
  });
  return dataset;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function datasetCSV(dataset) {
  const header = [dataset.xLabel || 'X', dataset.yLabel || 'Y', 'error', 'mask'];
  const lines = [header.map(csvEscape).join(',')];
  for (let i = 0; i < dataset.x.length; i += 1) lines.push([
    dataset.x[i], dataset.y[i], dataset.error ? dataset.error[i] : null, Boolean(dataset.mask?.[i]),
  ].map(csvEscape).join(','));
  return `${lines.join('\n')}\n`;
}

export function downloadFile(content, filename, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  if (typeof document === 'undefined') return { blob, filename, mime };
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return blob;
}
