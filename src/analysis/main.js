import { datasetIssues, deriveDataset, History, makeProject, parseProject, serializeProject, validateProject } from './model.js';
import { datasetCSV, downloadFile, parseText, readFile, tableToDataset } from './io.js';
import { loadProject, loadTransfer, saveProject } from './storage.js';
import { sampleDatasets } from './samples.js';
import { WorkerClient } from './worker-client.js';
import { addSeries, applyFigureTheme, exportPanel, makeFigureSpec, normalizeFigure, renderFigureGrid } from './plotting.js';

const $ = (id, root = document) => root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`);
const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
const clone = (value) => JSON.parse(JSON.stringify(value));
const numeric = (value) => value === '' || value === null || value === undefined ? null : Number(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const OPERATION_FIELDS = {
  crop: [{ key: 'min', label: 'X min' }, { key: 'max', label: 'X max' }],
  offset: [{ key: 'value', label: 'Offset Y', value: 0 }],
  scale: [{ key: 'value', label: 'Scale factor', value: 1 }],
  normalize: [{ key: 'mode', label: 'Mode', type: 'select', values: [['maximum', 'Maximum'], ['area', 'Area']] }],
  resample: [{ key: 'step', label: 'Bước X' }],
  movingAverage: [{ key: 'window', label: 'Window (odd)', value: 5 }],
  savgol: [{ key: 'window', label: 'Window (odd)', value: 7 }, { key: 'degree', label: 'Degree', value: 2 }],
  despike: [
    { key: 'window', label: 'Median window (odd)', value: 5 },
    { key: 'threshold', label: 'Ngưỡng robust σ', value: 6 },
    { key: 'action', label: 'Output', type: 'select', values: [['replace', 'Thay spike bằng local median'], ['mask', 'Mask spike, không thay Y']] },
  ],
  derivative: [{ key: 'order', label: 'Order', type: 'select', values: [[1, 'Bậc 1'], [2, 'Bậc 2']] }],
  integrate: [],
  statistics: [],
  baseline: [
    { key: 'mode', label: 'Mode', type: 'select', values: [['constant', 'Constant'], ['linear', 'Linear anchors'], ['polynomial', 'Polynomial regions'], ['als', 'Asymmetric least squares']] },
    { key: 'value', label: 'Constant', value: 0, show: 'constant' },
    { key: 'anchorsText', label: 'Anchors: x:y; …', type: 'text', show: 'linear' },
    { key: 'regionsText', label: 'Regions: xmin:xmax; …', type: 'text', show: 'polynomial' },
    { key: 'degree', label: 'Polynomial degree', value: 2, show: 'polynomial' },
    { key: 'lambda', label: 'ALS λ', value: 100000, show: 'als' },
    { key: 'p', label: 'ALS p', value: 0.01, show: 'als' },
    { key: 'iterations', label: 'Iterations', value: 10, show: 'als' },
  ],
  detectPeaks: [{ key: 'prominence', label: 'Prominence', value: 0 }, { key: 'minDistance', label: 'Min. distance', value: 0 }, { key: 'minWidth', label: 'Min. width', value: 0 }],
  xrd: [
    { key: 'lambda', label: 'λ (Å)', value: 1.5406 }, { key: 'K', label: 'Scherrer K', value: 0.9 },
    { key: 'instrumentFwhm', label: 'Instrument FWHM (°)', value: 0 },
    { key: 'correction', label: 'Correction', type: 'select', values: [['none', 'Uncorrected'], ['gaussian', 'Gaussian'], ['lorentzian', 'Lorentzian']] },
    { key: 'profile', label: 'Peak profile', type: 'select', values: [['gaussian', 'Gaussian'], ['lorentzian', 'Lorentzian'], ['pseudoVoigt', 'Pseudo-Voigt']] },
    { key: 'confirmed', label: 'Xác nhận λ, K và FWHM', type: 'checkbox' },
  ],
  williamsonHall: [
    { key: 'lambda', label: 'λ (Å)', value: 1.5406 }, { key: 'K', label: 'Scherrer K', value: 0.9 },
    { key: 'instrumentFwhm', label: 'Instrument FWHM (°)', value: 0 },
    { key: 'correction', label: 'Correction', type: 'select', values: [['none', 'Uncorrected'], ['gaussian', 'Gaussian'], ['lorentzian', 'Lorentzian']] },
    { key: 'profile', label: 'Peak profile', type: 'select', values: [['gaussian', 'Gaussian'], ['lorentzian', 'Lorentzian'], ['pseudoVoigt', 'Pseudo-Voigt']] },
    { key: 'confirmed', label: 'Xác nhận λ, K, profile và FWHM', type: 'checkbox' },
  ],
  cubicLattice: [
    { key: 'lambda', label: 'λ (Å)', value: 1.5406 },
    { key: 'zeroShiftDegrees', label: '2θ zero shift (°)', value: 0 },
    { key: 'hklText', label: 'hkl theo peak: 111; 200; 220', type: 'text' },
    { key: 'confirmed', label: 'Xác nhận phase cubic, λ và hkl', type: 'checkbox' },
  ],
  transmittance: [{ key: 'percent', label: 'Transmittance theo %', type: 'checkbox', value: true }],
  tauc: [
    { key: 'xMode', label: 'X mode', type: 'select', values: [['wavelength', 'Wavelength (nm)'], ['energy', 'Energy (eV)']] },
    { key: 'signal', label: 'Signal', type: 'select', values: [['alpha', 'α'], ['absorbance', 'Absorbance'], ['transmittance', 'Transmittance'], ['reflectance', 'Diffuse reflectance']] },
    { key: 'thicknessNm', label: 'Thickness (nm)' },
    { key: 'transition', label: 'Transition', type: 'select', values: [['direct', 'Direct allowed'], ['indirect', 'Indirect allowed']] },
    { key: 'percent', label: 'T/R theo %', type: 'checkbox', value: true },
    { key: 'confirmed', label: 'Xác nhận model và vùng fit', type: 'checkbox' },
  ],
  urbach: [
    { key: 'xMode', label: 'X mode', type: 'select', values: [['wavelength', 'Wavelength (nm)'], ['energy', 'Energy (eV)']] },
    { key: 'signal', label: 'Signal', type: 'select', values: [['alpha', 'α'], ['absorbance', 'Absorbance'], ['transmittance', 'Transmittance'], ['reflectance', 'Diffuse reflectance']] },
    { key: 'thicknessNm', label: 'Thickness (nm)' },
    { key: 'percent', label: 'T/R theo %', type: 'checkbox', value: true },
    { key: 'confirmed', label: 'Xác nhận signal và vùng Urbach tail', type: 'checkbox' },
  ],
  peakRatio: [{ key: 'a', label: 'Peak A index', value: 0 }, { key: 'b', label: 'Peak B index', value: 1 }, { key: 'metric', label: 'Definition', type: 'select', values: [['height', 'Height ratio'], ['area', 'Area ratio']] }],
};

class Studio {
  constructor(root) {
    this.root = root;
    this.project = makeProject({ name: 'Materials Data Project' });
    this.project.figures.push(makeFigureSpec());
    this.history = new History(this.project);
    this.figure = this.project.figures[0];
    this.preview = null;
    this.previewJob = null;
    this.pendingImport = null;
    this.fileQueue = [];
    this.fitPeaks = [emptyPeak()];
    this.worker = new WorkerClient();
    this.autosaveTimer = null;
    this.selectedRows = new Set();
    this.editedRows = new Map();
  }

  get active() {
    return this.project.datasets.find((dataset) => dataset.id === this.project.activeDatasetId) || null;
  }

  start() {
    this.bind();
    this.populateSamples();
    this.setOperationControls();
    this.render();
    this.loadInitial().catch((error) => this.status(`Không thể khôi phục dữ liệu: ${error.message}`, true));
  }

  bind() {
    $('msds-file', this.root).addEventListener('change', (event) => this.openFiles(event.target.files));
    const dropzone = $('msds-dropzone', this.root);
    dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('dragging'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragging');
      this.openFiles(event.dataTransfer.files);
    });
    $('msds-paste-open', this.root).addEventListener('click', () => this.openPaste());
    $('msds-samples', this.root).addEventListener('change', (event) => {
      const dataset = sampleDatasets()[Number(event.target.value)];
      if (dataset) this.addDataset(dataset);
      event.target.value = '';
    });
    $('msds-operation', this.root).addEventListener('change', () => this.setOperationControls());
    $('msds-preview', this.root).addEventListener('click', () => this.runOperation(true));
    $('msds-apply', this.root).addEventListener('click', () => this.runOperation(false));
    $('msds-cancel', this.root).addEventListener('click', () => this.cancelPreview());
    $('msds-undo', this.root).addEventListener('click', () => this.historyStep('undo'));
    $('msds-redo', this.root).addEventListener('click', () => this.historyStep('redo'));
    $('msds-save', this.root).addEventListener('click', () => this.persist());
    $('msds-load', this.root).addEventListener('click', () => this.loadSaved());
    $('msds-import-project-open', this.root).addEventListener('click', () => $('msds-import-project', this.root).click());
    $('msds-import-project', this.root).addEventListener('change', (event) => this.importProject(event.target.files[0]));
    $('msds-export-project', this.root).addEventListener('click', () => this.exportProject());
    $('msds-new-figure', this.root).addEventListener('click', () => this.newFigure());
    $('msds-add-series', this.root).addEventListener('click', () => this.addActiveSeries());
    $('msds-layout', this.root).addEventListener('change', (event) => {
      this.commit((_project, figure) => { figure.layout = event.target.value; normalizeFigure(figure); });
      this.render();
    });
    $('msds-fit-view', this.root).addEventListener('click', () => {
      this.commit((_project, figure) => figure.panels.forEach((panel) => { panel.ranges = { x: [null, null], y: [null, null], y2: [null, null] }; }));
      this.render();
    });
    $('msds-figure-panel', this.root).addEventListener('change', (event) => { this.figure.activePanel = Number(event.target.value); this.render(); });
    $('msds-series-select', this.root).addEventListener('change', () => this.populateFigureInputs());
    $('msds-figure-update', this.root).addEventListener('click', () => this.applyFigureInputs());
    $('msds-apply-theme', this.root).addEventListener('click', () => {
      const theme = $('msds-figure-theme', this.root).value;
      this.commit((_project, figure) => Object.assign(figure, applyFigureTheme(figure, theme)));
      this.render();
      this.status(`Đã áp dụng figure theme “${theme}”; dữ liệu không thay đổi.`);
    });
    $('msds-series-up', this.root).addEventListener('click', () => this.moveSeries(-1));
    $('msds-series-down', this.root).addEventListener('click', () => this.moveSeries(1));
    $('msds-remove-series', this.root).addEventListener('click', () => {
      const index = Number($('msds-series-select', this.root).value);
      this.commit((_project, figure) => { if (Number.isInteger(index)) figure.panels[figure.activePanel].series.splice(index, 1); });
      this.render();
    });
    $('msds-add-annotation', this.root).addEventListener('click', () => this.openAnnotation('annotation'));
    $('msds-add-reference', this.root).addEventListener('click', () => this.openAnnotation('vline'));
    $('msds-annotation-confirm', this.root).addEventListener('click', (event) => { event.preventDefault(); this.addAnnotation(); });
    qa('[data-msds-export]', this.root).forEach((button) => button.addEventListener('click', () => this.exportFigure(button.dataset.msdsExport)));
    $('msds-apply-edits', this.root).addEventListener('click', () => this.applyEdits());
    $('msds-mask-selected', this.root).addEventListener('click', () => this.applyMask(true));
    $('msds-unmask-all', this.root).addEventListener('click', () => this.applyMask(false, true));
    $('msds-export-data', this.root).addEventListener('click', () => this.exportData());
    $('msds-rename-project', this.root).addEventListener('click', () => this.renameProject());
    qa('[data-msds-tab]', this.root).forEach((button) => button.addEventListener('click', () => this.showTab(button.dataset.msdsTab)));
    q('.msds-inspector-tabs', this.root).addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = qa('[data-msds-tab]', this.root);
      const current = Math.max(0, tabs.indexOf(document.activeElement));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      this.showTab(tabs[next].dataset.msdsTab);
      tabs[next].focus();
    });
    qa('[data-msds-view]', this.root).forEach((button) => button.addEventListener('click', () => this.showView(button.dataset.msdsView)));
    $('msds-import-confirm', this.root).addEventListener('click', (event) => { event.preventDefault(); this.confirmImport(); });
  }

  showTab(tab) {
    qa('[data-msds-tab]', this.root).forEach((button) => {
      const active = button.dataset.msdsTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    qa('.msds-tabpanel', this.root).forEach((panel) => {
      const active = panel.id === `msds-tab-${tab}`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  }

  moveSeries(direction) {
    const index = Number($('msds-series-select', this.root).value);
    if (!Number.isInteger(index) || !this.figure) return;
    let nextIndex = index;
    this.commit((_project, figure) => {
      const series = figure.panels[figure.activePanel].series;
      nextIndex = Math.max(0, Math.min(series.length - 1, index + direction));
      if (nextIndex === index) return;
      [series[index], series[nextIndex]] = [series[nextIndex], series[index]];
    });
    this.render();
    $('msds-series-select', this.root).value = String(nextIndex);
    this.populateFigureInputs();
  }

  showView(view) {
    qa('.msds-nav [data-msds-view]', this.root).forEach((button) => {
      const active = button.dataset.msdsView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    qa('[data-msds-viewpanel]', this.root).forEach((panel) => { panel.hidden = panel.dataset.msdsViewpanel !== view; });
  }

  populateSamples() {
    const select = $('msds-samples', this.root);
    sampleDatasets().forEach((dataset, index) => select.insertAdjacentHTML('beforeend', `<option value="${index}">${escapeHtml(dataset.name)}</option>`));
  }

  ensureFigure() {
    if (!this.project.figures.length) this.project.figures.push(makeFigureSpec());
    const id = this.figure?.id;
    this.figure = this.project.figures.find((figure) => figure.id === id) || this.project.figures[0];
    normalizeFigure(this.figure);
  }

  commit(mutator, autosave = true) {
    const figureId = this.figure?.id;
    const next = clone(this.project);
    const nextFigure = next.figures.find((figure) => figure.id === figureId) || next.figures[0] || null;
    mutator(next, nextFigure);
    validateProject(next);
    this.project = next;
    this.figure = next.figures.find((figure) => figure.id === figureId) || next.figures[0] || null;
    this.history.push(next);
    if (autosave) this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.autosaveTimer);
    $('msds-save-state', this.root).textContent = 'Đang autosave…';
    this.autosaveTimer = setTimeout(() => this.persist(true), 700);
  }

  async persist(silent = false) {
    try {
      await saveProject(this.project);
      $('msds-save-state', this.root).textContent = 'Đã lưu cục bộ';
      if (!silent) this.status('Project đã được lưu vào IndexedDB.');
    } catch (error) {
      $('msds-save-state', this.root).textContent = 'Storage không khả dụng';
      this.status(`Không lưu được project: ${error.message}. Hãy dùng “Xuất project”.`, true);
    }
  }

  async loadInitial() {
    const transferId = new URLSearchParams(location.search).get('transfer');
    if (transferId) {
      const dataset = await loadTransfer(transferId);
      if (dataset) {
        this.addDataset(dataset, false);
        this.status(`Đã nhận dataset mô phỏng “${dataset.name}”.`);
        return;
      }
    }
    const saved = await loadProject();
    if (saved) this.replaceProject(saved, 'Đã khôi phục autosave cục bộ.');
  }

  async loadSaved() {
    try {
      const saved = await loadProject();
      if (!saved) return this.status('Chưa có autosave.');
      this.replaceProject(saved, 'Đã mở autosave.');
    } catch (error) {
      this.status(`Không mở được autosave: ${error.message}`, true);
    }
  }

  replaceProject(project, message) {
    validateProject(project);
    this.project = clone(project);
    this.figure = null;
    this.ensureFigure();
    this.history = new History(this.project);
    this.preview = null;
    this.previewJob = null;
    this.editedRows.clear();
    this.render();
    this.status(message);
  }

  historyStep(kind) {
    const snapshot = this.history[kind]();
    if (!snapshot) return;
    this.project = snapshot;
    this.figure = null;
    this.preview = null;
    this.previewJob = null;
    this.editedRows.clear();
    this.ensureFigure();
    this.render();
    this.scheduleSave();
  }

  newFigure() {
    let id;
    this.commit((project) => {
      const figure = makeFigureSpec(`Figure ${project.figures.length + 1}`);
      id = figure.id;
      project.figures.push(figure);
    });
    this.figure = this.project.figures.find((figure) => figure.id === id);
    this.render();
  }

  addActiveSeries() {
    if (!this.active || !this.figure) return;
    const datasetId = this.active.id;
    this.commit((project, figure) => addSeries(figure, project.datasets.find((dataset) => dataset.id === datasetId)));
    this.render();
  }

  renameProject() {
    const name = prompt('Tên project:', this.project.name);
    if (name?.trim()) this.commit((project) => { project.name = name.trim(); });
    this.render();
  }

  addDataset(dataset, autosave = true) {
    const warnings = datasetIssues(dataset);
    this.commit((project, figure) => {
      project.datasets.push(clone(dataset));
      project.activeDatasetId = dataset.id;
      addSeries(figure, dataset);
    }, autosave);
    this.preview = null;
    this.previewJob = null;
    this.editedRows.clear();
    this.render();
    this.status(warnings.length ? `Đã nhập; cần kiểm tra: ${warnings.join(' · ')}` : `Đã nhập ${dataset.name}.`);
  }

  selectDataset(id) {
    if (!this.project.datasets.some((dataset) => dataset.id === id)) return;
    this.project.activeDatasetId = id;
    this.preview = null;
    this.previewJob = null;
    this.selectedRows.clear();
    this.editedRows.clear();
    this.scheduleSave();
    this.render();
  }

  async openFiles(files) {
    this.fileQueue = [...(files || [])];
    $('msds-file', this.root).value = '';
    await this.openNextFile();
  }

  async openNextFile() {
    const file = this.fileQueue.shift();
    if (!file) return;
    try {
      this.status(`Đang đọc ${file.name}…`);
      const parsed = await readFile(file);
      this.openMapping(parsed, file.name, { kind: 'import', fileName: file.name });
    } catch (error) {
      this.status(`Không đọc được ${file.name}: ${error.message}`, true);
      await this.openNextFile();
    }
  }

  openPaste() {
    this.pendingImport = null;
    $('msds-import-title', this.root).textContent = 'Dán dữ liệu';
    $('msds-import-content', this.root).innerHTML = `<p class="msds-muted">Dán CSV, TSV hoặc text-space separated. Tiếp theo bạn sẽ chọn header và mapping X/Y/error.</p><textarea id="msds-paste-text" class="msds-paste-area" placeholder="x, y, error\n1, 2.1, 0.1"></textarea><div class="msds-import-map"><label>Delimiter<select id="msds-paste-delimiter" class="msds-select"><option value="auto">Tự nhận diện</option><option value=",">Comma</option><option value="\t">Tab</option><option value="whitespace">Whitespace</option><option value=";">Semicolon</option></select></label><label>Decimal<select id="msds-paste-decimal" class="msds-select"><option value=".">.</option><option value=",">,</option></select></label></div>`;
    $('msds-import-dialog', this.root).showModal();
  }

  openMapping(parsed, name, source = { kind: 'paste' }) {
    this.pendingImport = { parsed, name, source };
    $('msds-import-title', this.root).textContent = `Mapping: ${name}`;
    $('msds-import-content', this.root).innerHTML = `<div class="msds-import-map"><label>Sheet<select id="msds-map-sheet" class="msds-select">${parsed.sheets.map((sheet, index) => `<option value="${index}">${escapeHtml(sheet.name)}</option>`).join('')}</select></label><label>Header row<select id="msds-map-header" class="msds-select"><option value="0">Hàng 1 là header</option><option value="-1">Không có header</option></select></label><label>X column<select id="msds-map-x" class="msds-select"></select></label><label>Y column<select id="msds-map-y" class="msds-select"></select></label><label>Error column<select id="msds-map-error" class="msds-select"></select></label><label>Decimal<select id="msds-map-decimal" class="msds-select"><option value=".">.</option><option value=",">,</option></select></label><label>X label<input id="msds-map-xlabel" value="X"></label><label>Y label<input id="msds-map-ylabel" value="Y"></label><label>X unit<input id="msds-map-xunit"></label><label>Y unit<input id="msds-map-yunit"></label></div><div class="msds-import-preview" id="msds-map-preview"></div>${parsed.warnings?.length ? `<p class="msds-import-warning">${escapeHtml(parsed.warnings.join(' · '))}</p>` : ''}`;
    $('msds-map-sheet', this.root).addEventListener('change', () => this.refreshMapping());
    this.refreshMapping();
    if (!$('msds-import-dialog', this.root).open) $('msds-import-dialog', this.root).showModal();
  }

  refreshMapping() {
    const { parsed } = this.pendingImport;
    const sheet = parsed.sheets[Number($('msds-map-sheet', this.root).value)];
    const columns = Math.max(0, ...sheet.rows.slice(0, 30).map((row) => row.length));
    const header = sheet.rows[0] || [];
    const options = Array.from({ length: columns }, (_, index) => `<option value="${index}">${index}: ${escapeHtml(header[index] ?? `Column ${index + 1}`)}</option>`).join('');
    $('msds-map-x', this.root).innerHTML = options;
    $('msds-map-y', this.root).innerHTML = options;
    $('msds-map-error', this.root).innerHTML = `<option value="">Không có</option>${options}`;
    $('msds-map-y', this.root).value = String(Math.min(1, Math.max(0, columns - 1)));
    $('msds-map-preview', this.root).innerHTML = `<table>${sheet.rows.slice(0, 12).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</table>`;
  }

  confirmImport() {
    try {
      if (!this.pendingImport) {
        const parsed = parseText($('msds-paste-text', this.root).value, {
          delimiter: $('msds-paste-delimiter', this.root).value,
          decimal: $('msds-paste-decimal', this.root).value,
        });
        this.openMapping(parsed, 'Pasted data', { kind: 'paste' });
        return;
      }
      const { parsed, name, source } = this.pendingImport;
      const sheet = parsed.sheets[Number($('msds-map-sheet', this.root).value)];
      const dataset = tableToDataset(sheet.rows, {
        name,
        headerRow: Number($('msds-map-header', this.root).value),
        xColumn: Number($('msds-map-x', this.root).value),
        yColumn: Number($('msds-map-y', this.root).value),
        errorColumn: $('msds-map-error', this.root).value === '' ? null : Number($('msds-map-error', this.root).value),
        decimal: $('msds-map-decimal', this.root).value,
        xLabel: $('msds-map-xlabel', this.root).value,
        yLabel: $('msds-map-ylabel', this.root).value,
        xUnit: $('msds-map-xunit', this.root).value,
        yUnit: $('msds-map-yunit', this.root).value,
        source: { ...source, sheet: sheet.name, importWarnings: parsed.warnings || [] },
      });
      this.addDataset(dataset);
      this.pendingImport = null;
      $('msds-import-dialog', this.root).close();
      this.openNextFile();
    } catch (error) {
      this.status(`Không thể tạo dataset: ${error.message}`, true);
    }
  }

  setOperationControls() {
    const type = $('msds-operation', this.root).value;
    $('msds-roi-label', this.root).textContent = ['tauc', 'urbach'].includes(type)
      ? 'ROI fit (photon energy, eV)' : 'ROI (min, max theo trục X)';
    const fields = OPERATION_FIELDS[type] || [];
    const scientificNote = operationScientificNote(type);
    $('msds-operation-controls', this.root).innerHTML = `${fields.map(operationFieldHtml).join('')}${type === 'fit' ? this.fitEditorHtml() : ''}${scientificNote ? `<p class="msds-hint msds-scientific-note">${scientificNote}</p>` : ''}`;
    const toggleConditional = () => {
      const mode = q('[data-param="mode"]', this.root)?.value;
      qa('.msds-op-field[data-show]', this.root).forEach((element) => { if (element.dataset.show) element.hidden = element.dataset.show !== mode; });
    };
    q('[data-param="mode"]', this.root)?.addEventListener('change', toggleConditional);
    toggleConditional();
    this.wireFitEditor();
    this.prefillTechniqueControls(type);
  }

  prefillTechniqueControls(type) {
    if (!['tauc', 'urbach'].includes(type) || !this.active?.source) return;
    const source = this.active.source;
    const signal = source.measurement === 'uvvis' ? 'transmittance' : source.measurement === 'tauc' ? 'alpha' : null;
    if (signal) q('[data-param="signal"]', this.root).value = signal;
    if (finite(source.thicknessNm)) q('[data-param="thicknessNm"]', this.root).value = source.thicknessNm;
    if (type === 'tauc' && source.transition) q('[data-param="transition"]', this.root).value = source.transition;
    if (this.active.xUnit === 'eV') q('[data-param="xMode"]', this.root).value = 'energy';
  }

  fitEditorHtml() {
    const values = (this.active?.y || []).filter((value, index) => finite(value) && !this.active.mask[index]).sort((a, b) => a - b);
    const baseline = values.length ? values[Math.floor(values.length * 0.05)] : 0;
    return `<div class="msds-control-grid"><label>Model<select id="msds-fit-model" class="msds-select"><option value="gaussian">Gaussian</option><option value="lorentzian">Lorentzian</option><option value="pseudoVoigt">Pseudo-Voigt</option><option value="linear">Linear regression</option><option value="polynomial">Polynomial regression</option></select></label><label>Degree<input id="msds-fit-degree" type="number" value="2" min="1" max="8"></label><label>Fixed baseline<input id="msds-fit-baseline" type="number" value="${baseline}" step="any"></label><label class="msds-check"><input id="msds-fit-weighted" type="checkbox"> Weighted by σY</label></div><div class="msds-fit-peaks"><b>Peaks: center / height / FWHM; fixed & bounds</b><div id="msds-fit-peak-list">${this.fitPeaks.map((peak, index) => this.fitPeakHtml(peak, index)).join('')}</div><div class="msds-fit-actions"><button type="button" id="msds-fit-add" class="msds-smallbtn">+ Peak</button></div></div>`;
  }

  fitPeakHtml(peak, index) {
    const value = (key) => escapeHtml(peak[key] ?? '');
    const bound = (key, side) => escapeHtml(peak.bounds?.[key]?.[side] ?? '');
    return `<div class="msds-fit-peak" data-peak="${index}"><b>${index + 1}</b><input data-k="center" type="number" step="any" value="${value('center')}" placeholder="center"><input data-k="height" type="number" step="any" value="${value('height')}" placeholder="height"><input data-k="fwhm" type="number" min="0" step="any" value="${value('fwhm')}" placeholder="FWHM"><input data-k="eta" type="number" min="0" max="1" step="0.01" value="${value('eta')}" placeholder="η"><button type="button" data-delete="${index}" title="Xóa peak">×</button><div class="msds-fit-bounds"><label><input data-fixed="center" type="checkbox" ${peak.fixed?.center ? 'checked' : ''}>fix c</label><input data-bound="center,0" type="number" placeholder="c min" value="${bound('center', 0)}"><input data-bound="center,1" type="number" placeholder="c max" value="${bound('center', 1)}"><label><input data-fixed="height" type="checkbox" ${peak.fixed?.height ? 'checked' : ''}>fix h</label><input data-bound="height,0" type="number" placeholder="h min" value="${bound('height', 0)}"><input data-bound="height,1" type="number" placeholder="h max" value="${bound('height', 1)}"><label><input data-fixed="fwhm" type="checkbox" ${peak.fixed?.fwhm ? 'checked' : ''}>fix w</label><input data-bound="fwhm,0" type="number" placeholder="w min" value="${bound('fwhm', 0)}"><input data-bound="fwhm,1" type="number" placeholder="w max" value="${bound('fwhm', 1)}"><label><input data-fixed="eta" type="checkbox" ${peak.fixed?.eta ? 'checked' : ''}>fix η</label><input data-bound="eta,0" type="number" min="0" max="1" placeholder="η min" value="${bound('eta', 0)}"><input data-bound="eta,1" type="number" min="0" max="1" placeholder="η max" value="${bound('eta', 1)}"></div></div>`;
  }

  wireFitEditor() {
    const list = $('msds-fit-peak-list', this.root);
    if (!list) return;
    const sync = () => {
      this.fitPeaks = qa('.msds-fit-peak', list).map((element) => {
        const peak = emptyPeak();
        qa('[data-k]', element).forEach((input) => { peak[input.dataset.k] = numeric(input.value); });
        qa('[data-fixed]', element).forEach((input) => { peak.fixed[input.dataset.fixed] = input.checked; });
        qa('[data-bound]', element).forEach((input) => {
          const [key, side] = input.dataset.bound.split(',');
          peak.bounds[key] ||= [null, null];
          peak.bounds[key][Number(side)] = numeric(input.value);
        });
        return peak;
      });
    };
    list.addEventListener('input', sync);
    list.addEventListener('change', sync);
    list.addEventListener('click', (event) => {
      if (event.target.dataset.delete === undefined) return;
      sync();
      this.fitPeaks.splice(Number(event.target.dataset.delete), 1);
      this.setOperationControls();
    });
    $('msds-fit-add', this.root).addEventListener('click', () => {
      sync();
      if (this.fitPeaks.length >= 10) return this.status('Giới hạn 10 peaks cho mỗi lần fit.', true);
      this.fitPeaks.push(emptyPeak());
      this.setOperationControls();
    });
  }

  params() {
    const type = $('msds-operation', this.root).value;
    const params = {};
    qa('[data-param]', $('msds-operation-controls', this.root)).forEach((element) => {
      params[element.dataset.param] = element.type === 'checkbox' ? element.checked : element.type === 'number' ? numeric(element.value) : element.value;
    });
    const roiMin = numeric($('msds-roi-min', this.root).value);
    const roiMax = numeric($('msds-roi-max', this.root).value);
    if (finite(roiMin) && finite(roiMax)) params.roi = [roiMin, roiMax];
    if (type === 'baseline') {
      if (params.anchorsText !== undefined) params.anchors = parsePairs(params.anchorsText, 'Anchors').map(([x, y]) => ({ x, y }));
      if (params.regionsText !== undefined) params.regions = parsePairs(params.regionsText, 'Regions');
      delete params.anchorsText;
      delete params.regionsText;
    }
    if (type === 'fit') Object.assign(params, {
      model: $('msds-fit-model', this.root).value,
      degree: Number($('msds-fit-degree', this.root).value),
      baseline: numeric($('msds-fit-baseline', this.root).value) ?? 0,
      weighted: $('msds-fit-weighted', this.root).checked,
      peaks: clone(this.fitPeaks),
    });
    if (['xrd', 'williamsonHall', 'peakRatio'].includes(type)) params.peaks = this.recentPeaks();
    if (type === 'cubicLattice') {
      const hkls = parseHklList(params.hklText);
      delete params.hklText;
      const peaks = this.recentPeaks();
      if (hkls.length !== peaks.length) throw new Error(`Cần ${peaks.length} bộ hkl, hiện có ${hkls.length}.`);
      params.peaks = peaks.map((peak, index) => ({ ...peak, ...hkls[index] }));
    }
    return params;
  }

  recentPeaks() {
    const result = [...this.project.results].reverse().find((item) => item.datasetId === this.active?.id && item.status !== 'invalid' && item.peaks?.length);
    if (result) return clone(result.peaks);
    return this.fitPeaks.filter((peak) => finite(peak.center) && finite(peak.height) && finite(peak.fwhm)).map((peak) => clone(peak));
  }

  async runOperation(previewOnly) {
    const dataset = this.active;
    if (!dataset) return;
    const type = $('msds-operation', this.root).value;
    let params;
    try { params = this.params(); } catch (error) { return this.status(error.message, true); }
    this.status(`${previewOnly ? 'Đang tính preview' : 'Đang áp dụng'} ${type}…`);
    $('msds-cancel', this.root).disabled = false;
    try {
      const signature = JSON.stringify(params);
      const reusable = !previewOnly && this.previewJob && this.previewJob.type === type && this.previewJob.datasetId === dataset.id && this.previewJob.revision === dataset.revision && this.previewJob.signature === signature;
      const output = reusable ? clone(this.previewJob.output) : await this.worker.run(type, clone(dataset), params, (progress) => this.status(`Đang chạy ${type}: ${Math.round(progress * 100)}%`));
      const current = this.project.datasets.find((item) => item.id === dataset.id);
      if (!current || current.revision !== dataset.revision) throw new Error('Dataset đã thay đổi; kết quả cũ bị loại để tránh ghi nhầm revision.');
      if (previewOnly) this.previewJob = { type, datasetId: dataset.id, revision: dataset.revision, signature, output: clone(output) };
      else this.previewJob = null;
      this.showResult(output);
      if (output.kind === 'dataset') this.handleDatasetOutput(output, dataset, type, params, previewOnly);
      else if (output.kind === 'result') this.handleResultOutput(output, dataset, type, params, previewOnly);
    } catch (error) {
      if (error?.name === 'AbortError') this.status('Đã hủy tác vụ; dữ liệu không thay đổi.');
      else this.status(`Engine lỗi: ${error.message}`, true);
    } finally {
      $('msds-cancel', this.root).disabled = true;
    }
  }

  handleDatasetOutput(output, dataset, type, params, previewOnly) {
    if (previewOnly) {
      this.preview = output.data;
      this.renderPlot();
      this.status('Preview hoàn tất. “Áp dụng” sẽ tạo dataset dẫn xuất.');
      return;
    }
    const derived = deriveDataset(dataset, { ...output.data, name: `${dataset.name} · ${type}`, operation: output.operation || { type, params } });
    this.commit((project, figure) => {
      project.datasets.push(derived);
      project.activeDatasetId = derived.id;
      const operation = { ...output.operation, inputDatasetId: dataset.id, inputRevision: dataset.revision, outputDatasetId: derived.id };
      if (output.extras && ['tauc', 'urbach', 'integrate'].includes(type)) {
        project.results.push({ type, ...clone(output.extras), datasetId: dataset.id, datasetRevision: dataset.revision, outputDatasetId: derived.id });
        operation.resultIndex = project.results.length - 1;
      }
      project.operations.push(operation);
      addSeries(figure, derived);
    });
    this.preview = null;
    this.render();
    const invalidOptical = ['tauc', 'urbach'].includes(type) && output.extras?.status === 'invalid';
    this.status(invalidOptical
      ? `Đã tạo ${type} plot nhưng không lưu optical parameter hợp lệ: ${output.extras.message}`
      : `Đã tạo dataset dẫn xuất bằng ${type}; raw data không thay đổi.`, invalidOptical);
  }

  handleResultOutput(output, dataset, type, params, previewOnly) {
    if (output.result.type === 'fit' && output.result.status === 'success') this.preview = { x: output.result.x, y: output.result.yFit };
    if (previewOnly) {
      this.renderPlot();
      const invalid = output.result.status === 'invalid';
      this.status(invalid ? `Kết quả không hợp lệ: ${output.result.message}` : 'Preview kết quả hoàn tất; bấm “Áp dụng” để lưu cùng revision dữ liệu.', invalid);
      return;
    }
    this.commit((project) => {
      project.results.push(clone(output.result));
      project.operations.push({ type, params, inputDatasetId: dataset.id, inputRevision: dataset.revision, resultIndex: project.results.length - 1 });
    });
    this.render();
    const invalid = output.result.status === 'invalid';
    this.status(invalid ? `Kết quả không hợp lệ: ${output.result.message}` : `Đã lưu kết quả ${type}.`, invalid);
  }

  cancelPreview() {
    this.worker.cancel();
    this.preview = null;
    this.previewJob = null;
    this.renderPlot();
  }

  showResult(output) {
    const element = $('msds-analysis-result', this.root);
    const result = output.result || output.extras || {};
    if (result.type === 'fit') {
      const regression = result.model === 'linear'
        ? `<li>Intercept: ${format(result.parameters.intercept)} ± ${format(result.uncertainty?.intercept)} · slope: ${format(result.parameters.slope)} ± ${format(result.uncertainty?.slope)}</li>`
        : result.model === 'polynomial' ? `<li>Coefficients: ${escapeHtml((result.parameters.coefficients || []).map(format).join(', '))}</li>` : '';
      const diagnostics = `<li>RSS: ${format(result.rss)} · DoF: ${format(result.degreesOfFreedom)} · Adj. R²: ${format(result.adjustedR2)} · AIC/BIC: ${format(result.aic)} / ${format(result.bic)}</li>${finite(result.reducedChiSquare) ? `<li>Reduced χ² (weighted): ${format(result.reducedChiSquare)}</li>` : ''}`;
      element.innerHTML = `<h3>Fit result</h3><ul class="msds-result-list"><li>Status: <b>${escapeHtml(result.status)}</b>: ${escapeHtml(result.message || '')}</li><li>RMSE: ${format(result.rmse)} · R²: ${format(result.r2)} · iterations: ${format(result.iterations)}</li>${diagnostics}${regression}${(result.peaks || []).map((peak, index) => `<li>Peak ${index + 1}: center ${formatWithUncertainty(peak.center, peak.uncertainty?.center)}, FWHM ${formatWithUncertainty(peak.fwhm, peak.uncertainty?.fwhm)}, height ${formatWithUncertainty(peak.height, peak.uncertainty?.height)}, area ${format(peak.area)}</li>`).join('')}</ul>`;
    } else if (result.type === 'peaks') {
      this.fitPeaks = result.peaks.slice(0, 10).map((peak) => ({
        ...emptyPeak(), center: peak.center, height: peak.height, fwhm: peak.fwhm,
        bounds: {
          center: [peak.center - 2 * peak.fwhm, peak.center + 2 * peak.fwhm],
          height: [0, Math.max(peak.height * 3, 1)],
          fwhm: [Math.max(peak.fwhm * 0.2, Number.EPSILON), peak.fwhm * 5],
        },
      }));
      element.innerHTML = `<h3>Detected peaks</h3><ul class="msds-result-list">${result.peaks.map((peak, index) => `<li>${index + 1}: ${format(peak.center)} · height ${format(peak.height)} · FWHM ${format(peak.fwhm)} · prominence ${format(peak.prominence)}</li>`).join('')}</ul>`;
    } else if (result.type === 'xrd') {
      element.innerHTML = `<h3>XRD / Scherrer</h3><p class="msds-hint">FWHM đã đổi sang radian; crystallite size không đồng nhất với particle size. Correction: ${escapeHtml(result.correction)}.</p><ul class="msds-result-list">${result.peaks.map((peak) => `<li>2θ ${format(peak.center)}° · d ${format(peak.dAngstrom)} Å · D ${format(peak.sizeNm)} nm ${escapeHtml(peak.warning || '')}</li>`).join('')}</ul>`;
    } else if (result.type === 'williamsonHall') {
      const sizeNm = result.sizeNm ?? result.crystalliteSizeNm;
      const slope = result.slope ?? result.strain;
      element.innerHTML = `<h3>Williamson–Hall (UDM)</h3><p>Status: <b>${escapeHtml(result.status)}</b>${result.message ? `: ${escapeHtml(result.message)}` : ''}</p><p>Profile: <b>${escapeHtml(result.profile)}</b> · correction: <b>${escapeHtml(result.correction)}</b></p><ul class="msds-result-list"><li>D: ${format(sizeNm)} nm · microstrain ε: ${format(result.strain)}</li><li>Intercept: ${formatWithUncertainty(result.intercept, result.uncertainty?.intercept)} · slope: ${formatWithUncertainty(slope, result.uncertainty?.slope)} · R²: ${format(result.r2)}</li></ul><p class="msds-hint">Fit β cosθ = Kλ/D + 4ε sinθ; β là FWHM specimen-corrected theo radian. ${escapeHtml((result.warnings || []).join(' '))}</p>`;
    } else if (result.type === 'cubicLattice') {
      element.innerHTML = `<h3>Cubic lattice parameter</h3><p>Status: <b>${escapeHtml(result.status)}</b>${result.message ? `: ${escapeHtml(result.message)}` : ''}</p><p>a = <b>${format(result.aMeanAngstrom)} Å</b> · SD ${format(result.sampleSD)} Å · SE ${format(result.standardError)} Å</p><ul class="msds-result-list">${(result.peaks || []).map((peak) => `<li>(${peak.h}${peak.k}${peak.l}) · 2θ ${format(peak.center)}° · d ${format(peak.dAngstrom)} Å · a ${format(peak.aAngstrom)} Å</li>`).join('')}</ul>`;
    } else if (result.type === 'statistics') {
      element.innerHTML = `<h3>Thống kê ROI</h3><ul class="msds-result-list"><li>n: ${format(result.n)} · mean: ${format(result.mean)} · median: ${format(result.median)}</li><li>Sample SD: ${format(result.sampleSD)} · SE: ${format(result.standardError)}</li><li>Min/max: ${format(result.min)} / ${format(result.max)} · Q1/Q3: ${format(result.q1)} / ${format(result.q3)}</li><li>Trapezoidal area: ${format(result.area)}</li></ul>${result.warning ? `<p class="msds-hint">${escapeHtml(result.warning)}</p>` : ''}`;
    } else if (result.type === 'urbach' || output.extras?.type === 'urbach') {
      const urbach = output.extras || result;
      element.innerHTML = `<h3>Urbach tail</h3><p>Status: <b>${escapeHtml(urbach.status)}</b>${urbach.message ? `: ${escapeHtml(urbach.message)}` : ''}</p><p>E<sub>U</sub>: <b>${format(urbach.EuEv)} eV</b> · slope: ${format(urbach.fit?.parameters?.slope)} · R²: ${format(urbach.fit?.r2)}</p><p class="msds-hint">Fit ln(α-equivalent) theo hν trong ROI do người dùng chọn; diffuse reflectance chỉ là Kubelka-Munk proxy khi scattering gần như không đổi.</p>`;
    } else if (output.extras?.transition) {
      element.innerHTML = `<h3>Tauc result</h3><p>Status: <b>${escapeHtml(output.extras.status)}</b>${output.extras.message ? `: ${escapeHtml(output.extras.message)}` : ''}</p><p>Transition: <b>${escapeHtml(output.extras.transition)}</b> · E<sub>g</sub>: <b>${format(output.extras.Eg)} eV</b></p><p class="msds-hint">Vùng tuyến tính do người dùng chọn; R² không tự xác định transition type.</p>`;
    } else {
      element.innerHTML = `<h3>Kết quả</h3><pre>${escapeHtml(JSON.stringify(result, null, 2)).slice(0, 6000)}</pre>`;
    }
  }

  applyMask(mask, unmaskAll = false) {
    const dataset = this.active;
    if (!dataset) return;
    if (!unmaskAll && !this.selectedRows.size) return this.status('Chọn ít nhất một dòng trong worksheet.');
    const selected = new Set(this.selectedRows);
    const nextMask = dataset.mask.map((value, index) => unmaskAll ? false : selected.has(index) ? mask : value);
    const derived = deriveDataset(dataset, { mask: nextMask, name: `${dataset.name} · ${unmaskAll ? 'unmask' : 'mask'}`, operation: { type: unmaskAll ? 'unmask' : 'mask', indices: unmaskAll ? 'all' : [...selected] } });
    this.addDataset(derived);
    this.selectedRows.clear();
  }

  applyEdits() {
    const dataset = this.active;
    if (!dataset || !this.editedRows.size) return this.status('Chưa có ô nào được chỉnh sửa.');
    const x = [...dataset.x];
    const y = [...dataset.y];
    const error = dataset.error ? [...dataset.error] : null;
    for (const [row, values] of this.editedRows) {
      if ('x' in values) x[row] = numeric(values.x);
      if ('y' in values) y[row] = numeric(values.y);
      if (error && 'error' in values) error[row] = numeric(values.error);
    }
    const derived = deriveDataset(dataset, { x, y, error, name: `${dataset.name} · edited`, operation: { type: 'editCells', rows: [...this.editedRows.keys()] } });
    this.editedRows.clear();
    this.addDataset(derived);
  }

  render() {
    this.ensureFigure();
    this.renderDatasetList();
    this.renderMeta();
    this.renderPlot();
    this.populateFigureControls();
    this.renderTable();
    $('msds-undo', this.root).disabled = this.history.index <= 0;
    $('msds-redo', this.root).disabled = this.history.index >= this.history.snapshots.length - 1;
    $('msds-preview', this.root).disabled = !this.active;
    $('msds-apply', this.root).disabled = !this.active;
    $('msds-add-series', this.root).disabled = !this.active;
  }

  renderDatasetList() {
    const list = $('msds-dataset-list', this.root);
    list.innerHTML = this.project.datasets.map((dataset) => `<button class="msds-dataset ${dataset.id === this.active?.id ? 'active' : ''}" data-id="${escapeHtml(dataset.id)}"><i class="msds-dataset-dot"></i><span class="msds-dataset-name">${escapeHtml(dataset.name)}</span><span class="msds-dataset-meta">${dataset.x.length}</span></button>`).join('') || '<p class="msds-muted">Chưa có dataset.</p>';
    qa('.msds-dataset', list).forEach((button) => button.addEventListener('click', () => this.selectDataset(button.dataset.id)));
  }

  renderMeta() {
    const dataset = this.active;
    $('msds-active-name', this.root).textContent = dataset?.name || 'Chọn hoặc nhập dữ liệu';
    $('msds-active-meta', this.root).textContent = dataset ? `${dataset.x.length} điểm · rev ${dataset.revision}${dataset.parentId ? ' · derived' : ' · raw'}` : '';
    $('msds-project-name', this.root).textContent = this.project.name;
    $('msds-project-meta', this.root).textContent = `${this.project.datasets.length} dataset · ${this.project.figures.length} figure · ${this.project.results.length} result`;
  }

  async renderPlot() {
    if (!this.figure) return;
    try {
      await renderFigureGrid($('msds-plot-grid', this.root), this.figure, this.project.datasets, {
        previewOverlay: this.preview,
        onPanelSelect: (index) => { this.figure.activePanel = index; this.populateFigureControls(); },
        onRoi: ({ x: range }) => {
          if (!range || range.length !== 2) return;
          $('msds-roi-min', this.root).value = range[0];
          $('msds-roi-max', this.root).value = range[1];
          this.status(`Đã chọn ROI [${format(range[0])}, ${format(range[1])}] từ figure.`);
        },
      });
    } catch (error) {
      this.status(`Không thể vẽ figure: ${error.message}`, true);
    }
  }

  populateFigureControls() {
    const panel = this.figure?.panels[this.figure.activePanel || 0];
    if (!panel) return;
    $('msds-layout', this.root).value = this.figure.layout;
    $('msds-figure-panel', this.root).innerHTML = this.figure.panels.map((_item, index) => `<option value="${index}">Panel ${String.fromCharCode(65 + index)}</option>`).join('');
    $('msds-figure-panel', this.root).value = this.figure.activePanel;
    $('msds-series-select', this.root).innerHTML = panel.series.map((series, index) => `<option value="${index}">${escapeHtml(series.name)}</option>`).join('') || '<option value="">Chưa có series</option>';
    $('msds-remove-series', this.root).disabled = !panel.series.length;
    $('msds-series-up', this.root).disabled = panel.series.length < 2;
    $('msds-series-down', this.root).disabled = panel.series.length < 2;
    this.populateFigureInputs();
  }

  populateFigureInputs() {
    const panel = this.figure?.panels[this.figure.activePanel || 0];
    if (!panel) return;
    const series = panel.series[Number($('msds-series-select', this.root).value) || 0];
    $('msds-series-name', this.root).value = series?.name || '';
    $('msds-series-visible', this.root).checked = series?.visible !== false;
    $('msds-series-opacity', this.root).value = series?.opacity ?? 1;
    $('msds-line-shape', this.root).value = series?.lineShape || 'linear';
    $('msds-series-fill', this.root).value = series?.fill || 'none';
    $('msds-series-color', this.root).value = series?.color || '#167d86';
    $('msds-series-axis', this.root).value = series?.axis || 'y';
    $('msds-series-mode', this.root).value = series?.mode || 'lines';
    $('msds-series-dash', this.root).value = series?.dash || 'solid';
    $('msds-series-marker', this.root).value = series?.marker || 'circle';
    $('msds-series-offset', this.root).value = series?.offset ?? 0;
    $('msds-line-width', this.root).value = series?.lineWidth ?? 1.6;
    $('msds-marker-size', this.root).value = series?.markerSize ?? 5;
    $('msds-error-bars', this.root).checked = Boolean(series?.errorBars);
    $('msds-error-color', this.root).value = series?.errorColor || series?.color || '#167d86';
    $('msds-error-width', this.root).value = series?.errorWidth ?? 1;
    $('msds-error-cap', this.root).value = series?.errorCap ?? 2;
    $('msds-panel-title', this.root).value = panel.title || '';
    $('msds-x-label', this.root).value = panel.xLabel || '';
    $('msds-y-label', this.root).value = panel.yLabel || '';
    $('msds-y2-label', this.root).value = panel.y2Label || '';
    $('msds-tick-format', this.root).value = panel.tickFormat || 'auto';
    $('msds-font-size', this.root).value = panel.fontSize || 12;
    $('msds-x-scale', this.root).value = panel.xScale || 'linear';
    $('msds-y-scale', this.root).value = panel.yScale || 'linear';
    $('msds-reverse-x', this.root).checked = Boolean(panel.reverseX);
    $('msds-show-legend', this.root).checked = panel.legend?.visible !== false && panel.showLegend !== false;
    $('msds-link-axes', this.root).checked = Boolean(this.figure.linkAxes);
    $('msds-page-background', this.root).value = this.figure.pageBackground || '#ffffff';
    $('msds-plot-background', this.root).value = panel.plotBackground || '#ffffff';
    [['msds-margin-l', 'l'], ['msds-margin-r', 'r'], ['msds-margin-t', 't'], ['msds-margin-b', 'b']].forEach(([id, key]) => { $(id, this.root).value = panel.margins?.[key] ?? ''; });
    $('msds-grid-x', this.root).checked = panel.grid?.x !== false;
    $('msds-grid-y', this.root).checked = panel.grid?.y !== false;
    $('msds-grid-minor', this.root).checked = Boolean(panel.grid?.minor);
    $('msds-grid-color', this.root).value = panel.grid?.color || '#e7ebed';
    $('msds-grid-width', this.root).value = panel.grid?.width ?? 1;
    $('msds-grid-dash', this.root).value = panel.grid?.dash || 'solid';
    $('msds-axis-color', this.root).value = panel.axes?.color || '#737b85';
    $('msds-axis-width', this.root).value = panel.axes?.width ?? 1;
    $('msds-axis-mirror', this.root).checked = panel.axes?.mirror !== false;
    $('msds-zero-line', this.root).checked = panel.axes?.zeroLine !== false;
    $('msds-tick-direction', this.root).value = panel.axes?.tickDirection || '';
    $('msds-x-tick-step', this.root).value = panel.ticks?.xStep ?? '';
    $('msds-y-tick-step', this.root).value = panel.ticks?.yStep ?? '';
    $('msds-x-tick-angle', this.root).value = panel.ticks?.xAngle ?? 0;
    $('msds-y-tick-angle', this.root).value = panel.ticks?.yAngle ?? 0;
    $('msds-legend-position', this.root).value = panel.legend?.position || 'inside-top-left';
    $('msds-legend-orientation', this.root).value = panel.legend?.orientation || 'v';
    $('msds-legend-font-size', this.root).value = panel.legend?.fontSize ?? 10;
    $('msds-legend-background', this.root).value = colorHex(panel.legend?.background, '#ffffff');
    $('msds-legend-border-color', this.root).value = colorHex(panel.legend?.borderColor, '#d7dcdf');
    $('msds-legend-border-width', this.root).value = panel.legend?.borderWidth ?? 0.5;
    [['msds-xmin', 'x', 0], ['msds-xmax', 'x', 1], ['msds-ymin', 'y', 0], ['msds-ymax', 'y', 1]].forEach(([id, axis, side]) => { $(id, this.root).value = panel.ranges?.[axis]?.[side] ?? ''; });
  }

  applyFigureInputs() {
    const seriesIndex = Number($('msds-series-select', this.root).value) || 0;
    this.commit((_project, figure) => {
      const panel = figure.panels[figure.activePanel];
      const series = panel.series[seriesIndex];
      if (series) Object.assign(series, {
        name: $('msds-series-name', this.root).value.trim() || series.name,
        visible: $('msds-series-visible', this.root).checked,
        opacity: clamp(numeric($('msds-series-opacity', this.root).value) ?? 1, 0, 1),
        lineShape: $('msds-line-shape', this.root).value,
        fill: $('msds-series-fill', this.root).value,
        color: $('msds-series-color', this.root).value,
        axis: $('msds-series-axis', this.root).value,
        mode: $('msds-series-mode', this.root).value,
        dash: $('msds-series-dash', this.root).value,
        marker: $('msds-series-marker', this.root).value,
        offset: numeric($('msds-series-offset', this.root).value) ?? 0,
        lineWidth: Math.max(0, numeric($('msds-line-width', this.root).value) ?? 1.6),
        markerSize: Math.max(1, numeric($('msds-marker-size', this.root).value) ?? 5),
        errorBars: $('msds-error-bars', this.root).checked,
        errorColor: $('msds-error-color', this.root).value,
        errorWidth: Math.max(0, numeric($('msds-error-width', this.root).value) ?? 1),
        errorCap: Math.max(0, numeric($('msds-error-cap', this.root).value) ?? 2),
      });
      Object.assign(panel, {
        title: $('msds-panel-title', this.root).value,
        xLabel: $('msds-x-label', this.root).value,
        yLabel: $('msds-y-label', this.root).value,
        y2Label: $('msds-y2-label', this.root).value,
        tickFormat: $('msds-tick-format', this.root).value,
        fontSize: numeric($('msds-font-size', this.root).value) ?? 12,
        xScale: $('msds-x-scale', this.root).value,
        yScale: $('msds-y-scale', this.root).value,
        reverseX: $('msds-reverse-x', this.root).checked,
        showLegend: $('msds-show-legend', this.root).checked,
        plotBackground: $('msds-plot-background', this.root).value,
      });
      figure.pageBackground = $('msds-page-background', this.root).value;
      panel.margins = {
        l: nonNegativeInput('msds-margin-l', 70, this.root), r: nonNegativeInput('msds-margin-r', 70, this.root),
        t: nonNegativeInput('msds-margin-t', 42, this.root), b: nonNegativeInput('msds-margin-b', 62, this.root),
      };
      panel.grid = {
        x: $('msds-grid-x', this.root).checked, y: $('msds-grid-y', this.root).checked, minor: $('msds-grid-minor', this.root).checked,
        color: $('msds-grid-color', this.root).value, width: nonNegativeInput('msds-grid-width', 1, this.root), dash: $('msds-grid-dash', this.root).value,
      };
      const tickDirection = $('msds-tick-direction', this.root).value;
      panel.axes = {
        color: $('msds-axis-color', this.root).value, width: nonNegativeInput('msds-axis-width', 1, this.root),
        mirror: $('msds-axis-mirror', this.root).checked, zeroLine: $('msds-zero-line', this.root).checked,
        tickDirection: ['outside', 'inside', ''].includes(tickDirection) ? tickDirection : 'outside',
      };
      panel.ticks = {
        xStep: positiveNullable($('msds-x-tick-step', this.root).value), yStep: positiveNullable($('msds-y-tick-step', this.root).value),
        xAngle: clamp(numeric($('msds-x-tick-angle', this.root).value) ?? 0, -180, 180), yAngle: clamp(numeric($('msds-y-tick-angle', this.root).value) ?? 0, -180, 180),
      };
      const legendPosition = $('msds-legend-position', this.root).value;
      panel.legend = {
        ...panel.legend, ...legendPlacement(legendPosition), position: legendPosition,
        visible: $('msds-show-legend', this.root).checked, orientation: $('msds-legend-orientation', this.root).value,
        fontSize: positiveInput('msds-legend-font-size', 10, this.root), background: $('msds-legend-background', this.root).value,
        borderColor: $('msds-legend-border-color', this.root).value, borderWidth: Math.max(0, numeric($('msds-legend-border-width', this.root).value) ?? 0.5),
      };
      panel.ranges.x = [numeric($('msds-xmin', this.root).value), numeric($('msds-xmax', this.root).value)];
      panel.ranges.y = [numeric($('msds-ymin', this.root).value), numeric($('msds-ymax', this.root).value)];
      figure.linkAxes = $('msds-link-axes', this.root).checked;
    });
    this.render();
  }

  openAnnotation(kind) {
    $('msds-annotation-type', this.root).value = kind;
    $('msds-annotation-color', this.root).value = kind === 'annotation' ? '#343846' : '#a45d55';
    $('msds-reference-label', this.root).value = '';
    $('msds-annotation-dialog', this.root).showModal();
  }

  addAnnotation() {
    const type = $('msds-annotation-type', this.root).value;
    const x = numeric($('msds-annotation-x', this.root).value);
    const y = numeric($('msds-annotation-y', this.root).value);
    const text = $('msds-annotation-text', this.root).value;
    const color = $('msds-annotation-color', this.root).value;
    const fontSize = positiveInput('msds-annotation-font-size', 11, this.root);
    if (type === 'annotation' && (!finite(x) || !finite(y))) return this.status('Annotation cần X và Y.', true);
    if (type !== 'annotation' && !finite(type === 'hline' ? y : x)) return this.status('Reference line cần một giá trị.', true);
    this.commit((_project, figure) => {
      const panel = figure.panels[figure.activePanel];
      if (type === 'annotation') panel.annotations.push({ text, x, y, color, fontSize, showarrow: $('msds-annotation-show-arrow', this.root).checked });
      else panel.references.push({ type, value: type === 'hline' ? y : x, color, fontSize, dash: $('msds-reference-dash', this.root).value, width: nonNegativeInput('msds-reference-width', 1.3, this.root), label: $('msds-reference-label', this.root).value });
    });
    $('msds-annotation-dialog', this.root).close();
    this.render();
  }

  renderTable() {
    const dataset = this.active;
    const table = $('msds-data-table', this.root);
    ['msds-mask-selected', 'msds-unmask-all', 'msds-export-data'].forEach((id) => { $(id, this.root).disabled = !dataset; });
    $('msds-apply-edits', this.root).disabled = !dataset || !this.editedRows.size;
    if (!dataset) {
      table.innerHTML = '';
      $('msds-table-summary', this.root).textContent = 'Chưa chọn dataset.';
      return;
    }
    const warnings = datasetIssues(dataset);
    $('msds-table-summary', this.root).textContent = `${dataset.x.length} dòng; ${dataset.mask.filter(Boolean).length} masked.${warnings.length ? ` Cảnh báo: ${warnings.join(' · ')}` : ' Dữ liệu hợp lệ.'}`;
    const limit = Math.min(500, dataset.x.length);
    table.innerHTML = `<table><thead><tr><th></th><th>#</th><th>${escapeHtml(dataset.xLabel || 'X')}</th><th>${escapeHtml(dataset.yLabel || 'Y')}</th><th>Error</th><th>Mask</th></tr></thead><tbody>${Array.from({ length: limit }, (_item, index) => worksheetRow(dataset, index, this.selectedRows.has(index))).join('')}</tbody></table>${dataset.x.length > limit ? `<p class="msds-hint">Hiển thị 500/${dataset.x.length} dòng để bảo vệ UI; export và numerical engine vẫn dùng full data.</p>` : ''}`;
    qa('.msds-row-select', table).forEach((checkbox) => checkbox.addEventListener('change', () => {
      const row = Number(checkbox.dataset.row);
      if (checkbox.checked) this.selectedRows.add(row); else this.selectedRows.delete(row);
    }));
    qa('.msds-cell', table).forEach((input) => input.addEventListener('input', () => {
      const row = Number(input.dataset.row);
      const edited = this.editedRows.get(row) || {};
      edited[input.dataset.column] = input.value;
      this.editedRows.set(row, edited);
      $('msds-apply-edits', this.root).disabled = false;
    }));
  }

  exportData() {
    if (this.active) downloadFile(datasetCSV(this.active), `${safeName(this.active.name)}.csv`, 'text/csv;charset=utf-8');
  }

  async exportFigure(kind) {
    if (!this.figure) return;
    try {
      await exportPanel(q(`#msds-plot-${this.figure.activePanel}`, this.root), this.figure, this.project.datasets, kind, safeName(this.figure.name), {
        widthMm: numeric($('msds-width-mm', this.root).value), heightMm: numeric($('msds-height-mm', this.root).value), dpi: numeric($('msds-dpi', this.root).value),
      });
      this.status(`Đã xuất ${kind.toUpperCase()} bằng full data.`);
    } catch (error) {
      this.status(`Không xuất được figure: ${error.message}`, true);
    }
  }

  exportProject() {
    try {
      downloadFile(serializeProject(this.project), `${safeName(this.project.name)}.msc.json`, 'application/json');
    } catch (error) {
      this.status(`Không xuất được project: ${error.message}`, true);
    }
  }

  async importProject(file) {
    if (!file) return;
    try {
      this.replaceProject(parseProject(await file.text()), 'Đã nhập project JSON.');
      this.scheduleSave();
    } catch (error) {
      this.status(`Project JSON không hợp lệ: ${error.message}`, true);
    } finally {
      $('msds-import-project', this.root).value = '';
    }
  }

  status(message, error = false) {
    const element = $('msds-status', this.root);
    element.textContent = message;
    element.classList.toggle('error', error);
  }
}

function operationFieldHtml(field) {
  let control;
  if (field.type === 'select') control = `<select data-param="${field.key}" class="msds-select">${field.values.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>`;
  else if (field.type === 'checkbox') control = `<input data-param="${field.key}" type="checkbox" ${field.value ? 'checked' : ''}>`;
  else control = `<input data-param="${field.key}" type="${field.type || 'number'}" value="${field.value ?? ''}" ${field.type === 'text' ? '' : 'step="any"'}>`;
  return `<label class="msds-op-field" data-show="${field.show || ''}">${escapeHtml(field.label)}${control}</label>`;
}

function operationScientificNote(type) {
  if (type === 'xrd') return 'Scherrer dùng FWHM của peak theo radian. Crystallite size không phải particle size; instrumental correction phải khớp Gaussian/Lorentzian profile và pseudo-Voigt không dùng correction đơn này.';
  if (type === 'williamsonHall') return 'Williamson–Hall UDM fit β cosθ theo 4 sinθ với ít nhất 3 peaks. β specimen-corrected phải theo radian; intercept dương mới cho crystallite size có ý nghĩa.';
  if (type === 'cubicLattice') return 'Chỉ dùng cho phase cubic với hkl đã index rõ ràng: d = λ/(2 sinθ), a = d√(h²+k²+l²). Zero shift được trừ khỏi 2θ quan sát.';
  if (type === 'tauc') return 'Chọn transition và ROI thủ công. Absorbance/Transmittance cần thickness và giả thiết mẫu đồng nhất; diffuse reflectance dùng Kubelka-Munk F(R), chỉ phù hợp khi mẫu đủ dày và scattering gần như không đổi.';
  if (type === 'urbach') return 'Urbach energy Eᵤ = 1/slope từ fit ln(α-equivalent) theo hν trong ROI thủ công. Absorbance/Transmittance cần thickness; diffuse reflectance chỉ cho apparent proxy dưới giả thiết Kubelka-Munk.';
  if (type === 'despike') return 'Median/MAD despike chỉ phát hiện outlier cục bộ. Hãy preview; mode Mask giữ nguyên Y và loại các điểm khỏi phép tính.';
  if (type === 'statistics') return 'Thống kê chỉ dùng các điểm unmasked trong ROI. Sample SD dùng n−1; trapezoidal area chỉ báo khi X strict-monotonic.';
  if (type === 'fit') return 'Weighted fitting hiểu cột uncertainty là σY và tối ưu với trọng số 1/σY². Parameter uncertainty chỉ được báo khi covariance đủ hạng.';
  return '';
}

function emptyPeak() {
  return { center: null, height: null, fwhm: null, eta: 0.5, fixed: {}, bounds: {} };
}

function parsePairs(text, kind) {
  if (!String(text || '').trim()) return [];
  return String(text).split(';').filter((entry) => entry.trim()).map((entry) => {
    const pair = entry.split(':').map((value) => Number(value.trim()));
    if (pair.length !== 2 || !pair.every(Number.isFinite)) throw new Error(`${kind} phải có dạng a:b; c:d`);
    return pair;
  });
}

function parseHklList(text) {
  if (!String(text || '').trim()) return [];
  return String(text).split(';').filter((entry) => entry.trim()).map((entry) => {
    const token = entry.trim();
    const values = /^\d{3}$/.test(token) ? [...token].map(Number) : token.split(/[\s,]+/).map(Number);
    if (values.length !== 3 || !values.every(Number.isInteger) || values.every((value) => value === 0)) {
      throw new Error('hkl phải có dạng 111; 200; 2 2 0 hoặc 1,1,1; không nhận (000).');
    }
    return { h: values[0], k: values[1], l: values[2] };
  });
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function positiveInput(id, fallback, root) {
  const value = numeric($(id, root).value);
  return finite(value) && value > 0 ? value : fallback;
}

function nonNegativeInput(id, fallback, root) {
  const value = numeric($(id, root).value);
  return finite(value) && value >= 0 ? value : fallback;
}

function positiveNullable(value) {
  const parsed = numeric(value);
  return finite(parsed) && parsed > 0 ? parsed : null;
}

function colorHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

function legendPlacement(position) {
  return ({
    'inside-top-left': { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' },
    'inside-top-right': { x: 0.99, y: 0.99, xanchor: 'right', yanchor: 'top' },
    'outside-right': { x: 1.02, y: 0.99, xanchor: 'left', yanchor: 'top' },
    bottom: { x: 0.5, y: -0.16, xanchor: 'center', yanchor: 'top' },
  })[position] || { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' };
}

function worksheetRow(dataset, index, selected) {
  const input = (column, value) => `<input class="msds-cell" data-row="${index}" data-column="${column}" value="${escapeHtml(value ?? '')}">`;
  return `<tr class="${dataset.mask[index] ? 'masked' : ''}"><td><input class="msds-row-select" data-row="${index}" type="checkbox" ${selected ? 'checked' : ''}></td><td>${index + 1}</td><td>${input('x', dataset.x[index])}</td><td>${input('y', dataset.y[index])}</td><td>${dataset.error ? input('error', dataset.error[index]) : '-'}</td><td>${dataset.mask[index] ? '✓' : ''}</td></tr>`;
}

function format(value) {
  if (!finite(value)) return value === null || value === undefined ? '-' : String(value);
  return Number(value).toPrecision(6).replace(/\.0+e/, 'e').replace(/(\.\d*?)0+$/, '$1');
}

function formatWithUncertainty(value, uncertainty) {
  return finite(uncertainty) ? `${format(value)} ± ${format(uncertainty)}` : format(value);
}

function safeName(name) {
  return String(name || 'figure').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'figure';
}

export function initMaterialsDataStudio(root = document.getElementById('msc-data-studio')) {
  if (!root || root.dataset.initialized) return globalThis.MSCStudio;
  root.dataset.initialized = 'true';
  const studio = new Studio(root);
  studio.start();
  globalThis.MSCStudio = {
    getProject: () => clone(studio.project),
    getActiveDataset: () => clone(studio.active),
    importDataset: (dataset) => {
      studio.showView('workspace');
      studio.addDataset(clone(dataset));
      return clone(studio.active);
    },
    studio,
  };
  return globalThis.MSCStudio;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initMaterialsDataStudio());
else initMaterialsDataStudio();
