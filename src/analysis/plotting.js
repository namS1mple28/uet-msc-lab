import Plotly from 'plotly.js-dist-min';
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';

const PALETTE = ['#167d86', '#4b3e71', '#c46843', '#356ba4', '#b34b70', '#5b7f42'];
const finite = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));
const copy = value => JSON.parse(JSON.stringify(value));
const MM_PER_INCH = 25.4;

/** FigureSpec is stored directly in project.figures and deliberately contains no DOM nodes. */
export function makeFigureSpec(name = 'Figure 1') {
  return {
    id: `fig_${crypto.randomUUID?.() || Date.now().toString(36)}`,
    name, layout: '1x1', activePanel: 0, linkAxes: false,
    widthMm: 180, heightMm: 120, dpi: 300, pageBackground: '#ffffff', panels: [makePanel()],
    createdAt: new Date().toISOString()
  };
}

export function makePanel() {
  return {
    title: '', xLabel: '', yLabel: '', y2Label: '', tickFormat: 'auto',
    xScale: 'linear', yScale: 'linear', y2Scale: 'linear', reverseX: false,
    fontSize: 11, lineWidth: 1.6, markerSize: 5, showLegend: true,
    plotBackground: '#ffffff',
    margins: { l: 70, r: 70, t: 42, b: 62 },
    grid: { x: true, y: true, minor: false, color: '#e7ebed', width: 1, dash: 'solid' },
    axes: { color: '#737b85', width: 1, mirror: true, zeroLine: true, tickDirection: 'outside' },
    ticks: { xStep: null, yStep: null, xAngle: 0, yAngle: 0 },
    legend: { visible: true, position: 'inside-top-left', x: .01, y: .99, xanchor: 'left', yanchor: 'top', orientation: 'v', background: '#ffffff', borderColor: '#d7dcdf', borderWidth: .5, fontSize: 10 },
    ranges: { x: [null, null], y: [null, null], y2: [null, null] },
    series: [], annotations: [], references: []
  };
}

export function panelCount(layout) { return ({ '1x1': 1, '1x2': 2, '2x1': 2, '2x2': 4 })[layout] || 1; }

export function normalizeFigure(figure) {
  const fig = figure || makeFigureSpec();
  fig.layout ||= '1x1'; fig.activePanel = Math.max(0, Math.floor(Number(fig.activePanel) || 0));
  fig.linkAxes = Boolean(fig.linkAxes); fig.widthMm = positive(fig.widthMm, 180); fig.heightMm = positive(fig.heightMm, 120); fig.dpi = positive(fig.dpi, 300); fig.pageBackground ||= '#ffffff';
  if (!Array.isArray(fig.panels)) fig.panels = [];
  while (fig.panels.length < panelCount(fig.layout)) fig.panels.push(makePanel());
  fig.panels = fig.panels.slice(0, panelCount(fig.layout)).map(panel => {
    const defaults = makePanel();
    const migrated = { ...panel };
    // FigureSpec v1 aliases are retained while newer nested style fields are normalized.
    const legacy = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
    if (!migrated.margins) { const values = legacy({ l: panel.marginLeft, r: panel.marginRight, t: panel.marginTop, b: panel.marginBottom }); if (Object.keys(values).length) migrated.margins = values; }
    if (!migrated.grid) { const values = legacy({ x: panel.showGridX, y: panel.showGridY, minor: panel.minorGrid, color: panel.gridColor, width: panel.gridWidth, dash: panel.gridDash }); if (Object.keys(values).length) migrated.grid = values; }
    if (!migrated.axes) { const values = legacy({ color: panel.axisColor, width: panel.axisWidth, mirror: panel.mirrorAxes, zeroLine: panel.zeroLine, tickDirection: panel.tickDirection }); if (Object.keys(values).length) migrated.axes = values; }
    if (!migrated.ticks) { const values = legacy({ xStep: panel.xTickStep, yStep: panel.yTickStep, xAngle: panel.xTickAngle, yAngle: panel.yTickAngle }); if (Object.keys(values).length) migrated.ticks = values; }
    if (!migrated.legend) { const values = legacy({ visible: panel.showLegend, position: panel.legendPosition, x: panel.legendX, y: panel.legendY, xanchor: panel.legendXAnchor, yanchor: panel.legendYAnchor, orientation: panel.legendOrientation, background: panel.legendBackground, borderColor: panel.legendBorderColor, borderWidth: panel.legendBorderWidth, fontSize: panel.legendFontSize }); if (Object.keys(values).length) migrated.legend = values; }
    const merged = { ...defaults, ...migrated, margins: { ...defaults.margins, ...(migrated.margins || {}) }, grid: { ...defaults.grid, ...(migrated.grid || {}) }, axes: { ...defaults.axes, ...(migrated.axes || {}) }, ticks: { ...defaults.ticks, ...(migrated.ticks || {}) }, legend: { ...defaults.legend, ...(migrated.legend || {}) }, ranges: { ...defaults.ranges, ...(panel.ranges || {}) }, series: Array.isArray(panel.series) ? panel.series : [], annotations: Array.isArray(panel.annotations) ? panel.annotations : [], references: Array.isArray(panel.references) ? panel.references : [] };
    for (const key of ['l', 'r', 't', 'b']) merged.margins[key] = nonNegative(merged.margins[key], defaults.margins[key]);
    merged.grid.width = nonNegative(merged.grid.width, defaults.grid.width);
    merged.axes.width = nonNegative(merged.axes.width, defaults.axes.width);
    merged.legend.position ||= 'inside-top-left';
    merged.series = merged.series.map(series => ({ color: '#167d86', dash: 'solid', marker: 'circle', mode: 'lines', visible: true, opacity: 1, lineShape: 'linear', fill: 'none', lineWidth: 1.6, markerSize: 5, errorBars: false, errorColor: null, errorWidth: 1, errorCap: 2, ...series, name: series.name || '' }));
    return merged;
  });
  fig.activePanel = Math.min(fig.activePanel, fig.panels.length - 1);
  return fig;
}

/** Pure theme transform: returns a normalized copy and never mutates its input. */
export function applyFigureTheme(figure, name = 'journal') {
  const out = normalizeFigure(copy(figure || makeFigureSpec()));
  const themes = {
    journal: { pageBackground: '#ffffff', fontSize: 10, lineWidth: 1.4, markerSize: 4, plotBackground: '#ffffff', grid: { x: false, y: true, color: '#d9dddf', width: 1, dash: 'solid' }, axes: { color: '#202330', width: 1, mirror: false, zeroLine: false, tickDirection: 'outside' }, legend: { orientation: 'v', background: '#ffffff', borderWidth: 0, fontSize: 9 } },
    presentation: { pageBackground: '#f7f9fb', fontSize: 14, lineWidth: 2.4, markerSize: 7, plotBackground: '#ffffff', grid: { x: true, y: true, color: '#e1e7eb', width: 1, dash: 'solid' }, axes: { color: '#26344a', width: 2, mirror: true, zeroLine: true, tickDirection: 'outside' }, legend: { orientation: 'h', background: '#ffffff', borderWidth: 0, fontSize: 12 } },
    xrd: { pageBackground: '#ffffff', fontSize: 10, lineWidth: 1.2, markerSize: 3, plotBackground: '#ffffff', grid: { x: false, y: true, color: '#e7ebed', width: 1, dash: 'dot' }, axes: { color: '#202330', width: 1, mirror: true, zeroLine: false, tickDirection: 'outside' }, legend: { orientation: 'v', background: '#ffffff', borderWidth: .5, fontSize: 9 } }
  };
  const theme = themes[name] || themes.journal;
  Object.assign(out, { pageBackground: theme.pageBackground });
  out.panels = out.panels.map(panel => ({
    ...panel, fontSize: theme.fontSize, lineWidth: theme.lineWidth, markerSize: theme.markerSize,
    plotBackground: theme.plotBackground,
    grid: { ...panel.grid, ...theme.grid }, axes: { ...panel.axes, ...theme.axes }, legend: { ...panel.legend, ...theme.legend },
    series: panel.series.map(series => ({ ...series, lineWidth: theme.lineWidth, markerSize: theme.markerSize }))
  }));
  return out;
}

export function addSeries(figure, dataset, panelIndex = figure.activePanel || 0) {
  normalizeFigure(figure);
  const panel = figure.panels[panelIndex];
  if (!panel || panel.series.some(series => series.datasetId === dataset.id)) return false;
  panel.series.push({ id: `series_${crypto.randomUUID?.() || Date.now().toString(36)}`, datasetId: dataset.id, name: dataset.name, color: PALETTE[panel.series.length % PALETTE.length], dash: 'solid', marker: 'circle', mode: 'lines', axis: 'y', visible: true, errorBars: Boolean(dataset.error), offset: 0, lineWidth: 1.6, markerSize: 5 });
  if (!panel.xLabel) panel.xLabel = labelWithUnit(dataset.xLabel, dataset.xUnit);
  if (!panel.yLabel) panel.yLabel = labelWithUnit(dataset.yLabel, dataset.yUnit);
  return true;
}

/** Min/max bucket decimation preserves narrow extrema; it is preview-only. */
export function reduceForPreview(xs, ys, maximum = 12000) {
  if (xs.length <= maximum || maximum < 4) return [xs, ys];
  const bins = Math.max(1, Math.floor(maximum / 2)), step = xs.length / bins, keep = new Set([0, xs.length - 1]);
  for (let bin = 0; bin < bins; bin++) {
    const start = Math.floor(bin * step), end = Math.min(xs.length, Math.max(start + 1, Math.floor((bin + 1) * step)));
    let low = start, high = start;
    for (let i = start + 1; i < end; i++) { if (ys[i] < ys[low]) low = i; if (ys[i] > ys[high]) high = i; }
    keep.add(low); keep.add(high);
  }
  const indices = [...keep].sort((a, b) => a - b).slice(0, maximum);
  return [indices.map(i => xs[i]), indices.map(i => ys[i])];
}

function labelWithUnit(label, unit) { return unit ? `${label || ''} (${unit})` : (label || ''); }
function positive(value, fallback) { return finite(value) && Number(value) > 0 ? Number(value) : fallback; }
function nonNegative(value, fallback) { return finite(value) && Number(value) >= 0 ? Number(value) : fallback; }
function seriesMode(series) {
  if (series.mode === 'sticks') return 'lines';
  if (series.mode === 'scatter' || series.mode === 'markers') return 'markers';
  if (series.mode === 'line+scatter' || series.mode === 'lines+markers') return 'lines+markers';
  if (series.mode === 'line' || series.mode === 'lines') return 'lines';
  return series.marker && series.marker !== 'none' ? 'lines+markers' : 'lines';
}
function cleanData(dataset, series = {}) {
  const x = [], y = [], err = [], offset = finite(series.offset) ? Number(series.offset) : 0;
  for (let i = 0; i < (dataset?.x?.length || 0); i++) {
    if (dataset.mask?.[i] || !finite(dataset.x[i]) || !finite(dataset.y[i])) continue;
    x.push(Number(dataset.x[i])); y.push(Number(dataset.y[i]) + offset); err.push(finite(dataset.error?.[i]) ? Number(dataset.error[i]) : null);
  }
  return { x, y, err };
}
function rangeFor(panel, key, logarithmic = false, reverse = false) {
  const values = panel.ranges?.[key]; if (!Array.isArray(values) || !values.every(finite)) return undefined;
  const raw = values.map(Number); if (logarithmic && raw.some(value => value <= 0)) return undefined;
  const range = logarithmic ? raw.map(value => Math.log10(value)) : raw;
  return reverse ? [range[1], range[0]] : range;
}
function baseAxis(title, range, tickformat, type, fontSize, extras = {}) {
  return { title: { text: title || '', font: { size: fontSize + 1 } }, range, type, tickformat, showline: true, linewidth: 1, linecolor: '#737b85', mirror: true, gridcolor: '#e7ebed', zerolinecolor: '#d9dddf', ticks: 'outside', tickfont: { size: fontSize }, ...extras };
}
function plotlyLayout(panel, isActive) {
  const fontSize = positive(panel.fontSize, 11), tickformat = panel.tickFormat === 'auto' ? undefined : panel.tickFormat;
  const margins = { l: nonNegative(panel.margins?.l, 70), r: nonNegative(panel.margins?.r, 70), t: nonNegative(panel.margins?.t, 42), b: nonNegative(panel.margins?.b, 62) };
  const grid = panel.grid || {}, axes = panel.axes || {}, ticks = panel.ticks || {}, legend = panel.legend || {};
  const legendPosition = { 'inside-top-left': [.01, .99, 'left', 'top'], 'inside-top-right': [.99, .99, 'right', 'top'], 'outside-right': [1.02, .99, 'left', 'top'], bottom: [.5, -.16, 'center', 'top'] }[legend.position] || null;
  const lx = legendPosition ? legendPosition[0] : legend.x, ly = legendPosition ? legendPosition[1] : legend.y;
  const xScale = panel.xScale === 'log' ? 'log' : 'linear', yScale = panel.yScale === 'log' ? 'log' : 'linear', y2Scale = panel.y2Scale === 'log' ? 'log' : 'linear';
  const xRange = rangeFor(panel, 'x', xScale === 'log', panel.reverseX);
  const shapes = (panel.references || []).filter(reference => finite(reference.value)).map(reference => {
    const line = { color: reference.color || '#a45d55', dash: reference.dash || 'dot', width: nonNegative(reference.width, 1.3) };
    const shape = reference.type === 'hline' ? { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: Number(reference.value), y1: Number(reference.value), line } : { type: 'line', y0: 0, y1: 1, yref: 'paper', x0: Number(reference.value), x1: Number(reference.value), line };
    if (reference.label || reference.text) shape.label = { text: reference.label || reference.text, font: { size: positive(reference.fontSize, 10), color: reference.color || '#a45d55' } };
    return shape;
  });
  return {
    margin: margins, showlegend: legend.visible !== false && panel.showLegend !== false,
    legend: { font: { size: positive(legend.fontSize, Math.max(8, fontSize - 1)) }, x: Number.isFinite(Number(lx)) ? Number(lx) : .01, y: Number.isFinite(Number(ly)) ? Number(ly) : .99, xanchor: legendPosition ? legendPosition[2] : (legend.xanchor || 'left'), yanchor: legendPosition ? legendPosition[3] : (legend.yanchor || 'top'), orientation: legend.orientation || 'v', bgcolor: legend.background || 'rgba(255,255,255,.82)', bordercolor: legend.borderColor || '#d7dcdf', borderwidth: Number(legend.borderWidth) || 0 },
    font: { family: 'NotoSans, Arial, sans-serif', size: fontSize, color: '#262333' }, paper_bgcolor: panel.plotBackground || '#ffffff', plot_bgcolor: panel.plotBackground || '#ffffff', hovermode: 'closest',
    title: panel.title ? { text: panel.title, font: { size: fontSize + 3, color: '#262333' } } : undefined,
    xaxis: baseAxis(panel.xLabel || 'X', xRange, tickformat, xScale, fontSize, { autorange: panel.reverseX && !xRange ? 'reversed' : undefined, showgrid: grid.x !== false, minor: grid.minor ? { showgrid: true, gridcolor: grid.color || '#e7ebed', gridwidth: nonNegative(grid.width, 1) / 2 } : undefined, gridcolor: grid.color || '#e7ebed', gridwidth: nonNegative(grid.width, 1), griddash: grid.dash || 'solid', zeroline: axes.zeroLine !== false, linecolor: axes.color || '#737b85', linewidth: nonNegative(axes.width, 1), mirror: axes.mirror !== false, ticks: axes.tickDirection || 'outside', dtick: finite(ticks.xStep) ? Number(ticks.xStep) : undefined, tickangle: Number(ticks.xAngle) || 0 }),
    yaxis: baseAxis(panel.yLabel || 'Y', rangeFor(panel, 'y', yScale === 'log'), tickformat, yScale, fontSize, { showgrid: grid.y !== false, minor: grid.minor ? { showgrid: true, gridcolor: grid.color || '#e7ebed', gridwidth: nonNegative(grid.width, 1) / 2 } : undefined, gridcolor: grid.color || '#e7ebed', gridwidth: nonNegative(grid.width, 1), griddash: grid.dash || 'solid', zeroline: axes.zeroLine !== false, linecolor: axes.color || '#737b85', linewidth: nonNegative(axes.width, 1), mirror: axes.mirror !== false, ticks: axes.tickDirection || 'outside', dtick: finite(ticks.yStep) ? Number(ticks.yStep) : undefined, tickangle: Number(ticks.yAngle) || 0 }),
    yaxis2: baseAxis(panel.y2Label || 'Y₂', rangeFor(panel, 'y2', y2Scale === 'log'), tickformat, y2Scale, fontSize, { overlaying: 'y', side: 'right', showgrid: false, linecolor: axes.color || '#737b85', linewidth: nonNegative(axes.width, 1), mirror: axes.mirror !== false, ticks: axes.tickDirection || 'outside' }),
    annotations: (panel.annotations || []).filter(annotation => finite(annotation.x) && finite(annotation.y)).map(annotation => ({ x: Number(annotation.x), y: Number(annotation.y), text: annotation.text || annotation.label || '', showarrow: annotation.showarrow !== false, arrowhead: 2, font: { size: positive(annotation.fontSize, fontSize), color: annotation.color || '#343846' } })),
    shapes, dragmode: isActive ? 'zoom' : false
  };
}

function reducedData(data, maximum) {
  if (data.x.length <= maximum) return data;
  const [x, y] = reduceForPreview(data.x, data.y, maximum), buckets = new Map();
  data.x.forEach((value, i) => { const key = `${value}\u0000${data.y[i]}`, values = buckets.get(key) || []; values.push(data.err[i]); buckets.set(key, values); });
  return { x, y, err: x.map((value, i) => (buckets.get(`${value}\u0000${y[i]}`) || []).shift() ?? null) };
}
function panelTraces(panel, datasetMap, { preview = true } = {}) {
  const traces = [];
  for (const series of panel.series || []) {
    const dataset = datasetMap.get(series.datasetId); if (!dataset || series.visible === false) continue;
    let data = cleanData(dataset, series); if (!data.x.length) continue; if (preview) data = reducedData(data, 12000);
    const sticks = series.mode === 'sticks';
    if (sticks) {
      const baseline = finite(series.offset) ? Number(series.offset) : 0, x = [], y = [];
      for (let i = 0; i < data.x.length; i++) { x.push(data.x[i], data.x[i], null); y.push(baseline, data.y[i], null); }
      data = { x, y, err: Array(x.length).fill(null) };
    }
    const useErrors = Boolean(!sticks && series.errorBars && data.err.some(finite));
    traces.push({ type: 'scatter', mode: seriesMode(series), x: data.x, y: data.y, name: series.name || dataset.name, opacity: finite(series.opacity) ? Math.max(0, Math.min(1, Number(series.opacity))) : 1, yaxis: series.axis === 'y2' ? 'y2' : 'y', fill: series.fill && series.fill !== 'none' ? series.fill : undefined, line: { color: series.color || '#167d86', width: nonNegative(series.lineWidth, nonNegative(panel.lineWidth, 1.6)), dash: series.dash || 'solid', shape: ['linear', 'hv', 'vh', 'spline'].includes(series.lineShape) ? series.lineShape : 'linear' }, marker: { symbol: series.marker === 'none' ? 'circle' : (series.marker || 'circle'), color: series.color || '#167d86', size: positive(series.markerSize, positive(panel.markerSize, 5)) }, error_y: useErrors ? { type: 'data', array: data.err.map(value => finite(value) ? value : 0), visible: true, color: series.errorColor || series.color || '#167d86', thickness: nonNegative(series.errorWidth, 1), width: nonNegative(series.errorCap, 2) } : undefined, hovertemplate: '%{x:.7g}, %{y:.7g}<extra>%{fullData.name}</extra>' });
  }
  return traces;
}
function roiFromEvent(event) {
  const points = event?.points || []; if (!points.length) return null;
  const xs = points.map(point => point.x).filter(finite).map(Number), ys = points.map(point => point.y).filter(finite).map(Number);
  return xs.length && ys.length ? { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], points } : null;
}

export async function renderFigureGrid(container, figure, datasets, { onPanelSelect, onRoi, onROI, previewOverlay } = {}) {
  normalizeFigure(figure); container.className = `msds-plot-grid layout-${figure.layout}`; container.style.background = figure.pageBackground || '#ffffff'; container.replaceChildren();
  const datasetMap = new Map(datasets.map(dataset => [dataset.id, dataset])), plotNodes = [];
  await Promise.all(figure.panels.map(async (panel, index) => {
    const panelEl = document.createElement('div'); panelEl.className = `msds-plot-panel ${index === figure.activePanel ? 'active' : ''}`; panelEl.dataset.panel = index;
    panelEl.innerHTML = `<span class="msds-panel-label">PANEL ${String.fromCharCode(65 + index)}</span><div class="msds-plot" id="msds-plot-${index}"></div>`;
    panelEl.addEventListener('click', () => onPanelSelect?.(index)); container.append(panelEl);
    const traces = panelTraces(panel, datasetMap, { preview: true });
    if (previewOverlay && index === figure.activePanel && Array.isArray(previewOverlay.x)) traces.push({ type: 'scatter', mode: 'lines', x: previewOverlay.x, y: previewOverlay.y, name: 'Preview', line: { color: '#e0a72e', width: 2, dash: 'dash' }, hovertemplate: 'Preview: %{x:.7g}, %{y:.7g}<extra></extra>' });
    const plot = panelEl.querySelector('.msds-plot');
    await Plotly.react(plot, traces, plotlyLayout(panel, index === figure.activePanel), { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['autoScale2d'] });
    plot.on?.('plotly_selected', event => { const roi = roiFromEvent(event); if (roi) (onRoi || onROI)?.({ panelIndex: index, ...roi }); }); plotNodes[index] = plot;
  }));
  if (figure.linkAxes && plotNodes.length > 1) {
    let propagating = false;
    plotNodes.forEach((plot, source) => plot.on?.('plotly_relayout', change => {
      if (propagating || (!Object.hasOwn(change, 'xaxis.range[0]') && !Object.hasOwn(change, 'xaxis.autorange'))) return;
      const update = change['xaxis.autorange'] ? { 'xaxis.autorange': change['xaxis.autorange'] } : { 'xaxis.range': [change['xaxis.range[0]'], change['xaxis.range[1]']] };
      propagating = true; Promise.all(plotNodes.filter((_, i) => i !== source).map(target => Plotly.relayout(target, update))).finally(() => { propagating = false; });
    }));
  }
}

export function capturePlotSelection(plotEl) { return plotEl?.data || null; }

/** Exports full data. Options: { widthMm, heightMm, dpi, panelIndex }. */
export async function exportPanel(panelEl, figure, datasets, kind, filename = 'figure', options = {}) {
  if (filename && typeof filename === 'object') { options = filename; filename = 'figure'; }
  const fig = normalizeFigure(copy(figure)), settings = { widthMm: positive(options.widthMm, positive(fig.widthMm, 180)), heightMm: positive(options.heightMm, positive(fig.heightMm, 120)), dpi: positive(options.dpi, positive(fig.dpi, 300)), panelIndex: Number.isInteger(options.panelIndex) ? options.panelIndex : null };
  const panels = settings.panelIndex === null ? fig.panels : [fig.panels[settings.panelIndex]].filter(Boolean), datasetMap = new Map(datasets.map(dataset => [dataset.id, dataset]));
  if (kind === 'csv') {
    const rows = ['panel,series,x,y,error']; panels.forEach((panel, panelOffset) => panel.series.forEach(series => { const dataset = datasetMap.get(series.datasetId); if (!dataset) return; const data = cleanData(dataset, series); data.x.forEach((x, i) => rows.push([String.fromCharCode(65 + (settings.panelIndex ?? panelOffset)), csvCell(series.name || dataset.name), x, data.y[i], data.err[i] ?? ''].join(','))); }));
    download(rows.join('\n'), `${filename}.csv`, 'text/csv;charset=utf-8'); return;
  }
  settings.pageBackground = fig.pageBackground || '#ffffff';
  const svg = await figureSvg(panels, fig.layout, datasetMap, settings);
  if (kind === 'svg') { download(svg.text, `${filename}.svg`, 'image/svg+xml;charset=utf-8'); return; }
  if (kind === 'png') { downloadBlob(await svgToPng(svg.text, svg.pixelWidth, svg.pixelHeight, settings.dpi, settings.widthMm, settings.heightMm), `${filename}.png`); return; }
  if (kind !== 'pdf') throw new Error(`Unsupported export format: ${kind}`);
  await svgToPdf(svg, filename, settings);
}

function gridShape(layout, count) { if (count === 1) return [1, 1]; if (layout === '2x1') return [2, 1]; if (layout === '2x2') return [2, 2]; return [1, Math.min(2, count)]; }
async function figureSvg(panels, figureLayout, datasetMap, settings) {
  const [rows, cols] = gridShape(figureLayout, panels.length), pixelWidth = Math.max(480, Math.round(settings.widthMm / MM_PER_INCH * settings.dpi)), pixelHeight = Math.max(360, Math.round(settings.heightMm / MM_PER_INCH * settings.dpi)), gap = Math.max(10, Math.round(Math.min(pixelWidth, pixelHeight) * .012)), panelWidth = Math.floor((pixelWidth - gap * (cols - 1)) / cols), panelHeight = Math.floor((pixelHeight - gap * (rows - 1)) / rows), svgs = [];
  for (let index = 0; index < panels.length; index++) {
    const paper = document.createElement('div'); paper.style.cssText = `position:fixed;left:-30000px;top:0;width:${panelWidth}px;height:${panelHeight}px;background:#fff;visibility:hidden`; document.body.append(paper);
    try { await Plotly.newPlot(paper, panelTraces(panels[index], datasetMap, { preview: false }), plotlyLayout(panels[index], true), { displaylogo: false, staticPlot: true }); svgs.push(decodeDataUrl(await Plotly.toImage(paper, { format: 'svg', width: panelWidth, height: panelHeight, scale: 1 }))); } finally { Plotly.purge(paper); paper.remove(); }
  }
  const nested = svgs.map((text, index) => {
    const row = Math.floor(index / cols), col = index % cols, left = col * (panelWidth + gap), top = row * (panelHeight + gap);
    const panel = `<svg x="${left}" y="${top}" width="${panelWidth}" height="${panelHeight}" viewBox="0 0 ${panelWidth} ${panelHeight}">${namespaceSvg(text, `p${index}_`)}</svg>`;
    const label = `<text x="${left + 10}" y="${top + 22}" font-family="NotoSans,Arial,sans-serif" font-size="${Math.max(14, Math.round(panelHeight * .027))}" font-weight="700" fill="#262333">(${String.fromCharCode(97 + index)})</text>`;
    return panel + label;
  }).join('');
  return { text: `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${settings.widthMm}mm" height="${settings.heightMm}mm" viewBox="0 0 ${pixelWidth} ${pixelHeight}"><style>${embeddedFontCss()}svg text{font-family:NotoSans,Arial,sans-serif!important}</style><rect width="100%" height="100%" fill="${settings.pageBackground || '#fff'}"/>${nested}</svg>`, panelSvgs: svgs, pixelWidth, pixelHeight, panelWidth, panelHeight, rows, cols };
}
function namespaceSvg(text, prefix) {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement, body = root.innerHTML, ids = [...body.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); let namespaced = body;
  ids.forEach(id => { const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); namespaced = namespaced.replace(new RegExp(`([\\s#(])${escaped}(?=[\\s)"'])`, 'g'), `$1${prefix}${id}`); namespaced = namespaced.replace(new RegExp(`id="${escaped}"`, 'g'), `id="${prefix}${id}"`); }); return namespaced;
}
function embeddedFontCss() { const regular = globalThis.__MSC_PDF_FONT_REGULAR__, bold = globalThis.__MSC_PDF_FONT_BOLD__; return `${regular ? `@font-face{font-family:NotoSans;src:url(data:font/ttf;base64,${regular}) format('truetype');font-weight:400;}` : ''}${bold ? `@font-face{font-family:NotoSans;src:url(data:font/ttf;base64,${bold}) format('truetype');font-weight:700;}` : ''}`; }
async function svgToPng(svgText, pixelWidth, pixelHeight, dpi, widthMm, heightMm) {
  const targetWidth = Math.max(1, Math.round(widthMm / MM_PER_INCH * dpi)), targetHeight = Math.max(1, Math.round(heightMm / MM_PER_INCH * dpi)), url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try { const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Không thể rasterize SVG để xuất PNG.')); image.src = url; }); const canvas = document.createElement('canvas'); canvas.width = targetWidth; canvas.height = targetHeight; const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, targetWidth, targetHeight); context.drawImage(image, 0, 0, pixelWidth, pixelHeight, 0, 0, targetWidth, targetHeight); return await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG encoder failed.')), 'image/png')); } finally { URL.revokeObjectURL(url); }
}
async function svgToPdf(svg, filename, settings) {
  const doc = new jsPDF({ orientation: settings.widthMm >= settings.heightMm ? 'landscape' : 'portrait', unit: 'mm', format: [settings.widthMm, settings.heightMm] });
  addNotoFonts(doc);
  const figure = new DOMParser().parseFromString(svg.text, 'image/svg+xml').documentElement;
  await svg2pdf(figure, doc, { xOffset: 0, yOffset: 0, scale: settings.widthMm / svg.pixelWidth });
  doc.save(`${filename}.pdf`);
}
function addNotoFonts(doc) { const regular = globalThis.__MSC_PDF_FONT_REGULAR__, bold = globalThis.__MSC_PDF_FONT_BOLD__; if (!regular) return; doc.addFileToVFS('NotoSans-Regular.ttf', regular); doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal'); if (bold) { doc.addFileToVFS('NotoSans-Bold.ttf', bold); doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold'); } doc.setFont('NotoSans'); }
function decodeDataUrl(url) { const comma = url.indexOf(','); if (comma < 0) return url; const header = url.slice(0, comma), data = url.slice(comma + 1); return /;base64/i.test(header) ? atob(data) : decodeURIComponent(data); }
function csvCell(value) { return `"${String(value).replace(/"/g, '""')}"`; }
function download(text, name, type) { downloadBlob(new Blob([text], { type }), name); }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 500); }

export { Plotly };
