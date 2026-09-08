import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function addSample(page, value = '0') {
  await page.goto('/analysis.html');
  await expect(page.locator('#msc-data-studio')).toBeVisible();
  await page.locator('#msds-samples').selectOption(value);
  await expect(page.locator('.msds-dataset')).toHaveCount(1);
  await expect(page.locator('#msds-plot-0 .scatterlayer')).toBeVisible();
}

test('offline bundle opens directly from file://', async ({ page }) => {
  const errors = collectPageErrors(page);
  const target = `file://${path.resolve('analysis.html')}`;
  await page.goto(target);
  await expect(page).toHaveTitle(/Materials Data Studio/);
  await expect(page.locator('#msc-data-studio')).toBeVisible();
  await page.locator('#msds-samples').selectOption('1');
  await expect(page.locator('.msds-dataset-name')).toContainText('Raman');
  await expect(page.locator('#msds-plot-0 .scatterlayer')).toBeVisible();
  expect(errors).toEqual([]);
});

test('CSV mapping, worksheet edit, mask, undo and redo preserve raw data', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/analysis.html');
  await page.locator('#msds-file').setInputFiles({
    name: 'fixture.csv', mimeType: 'text/csv', buffer: Buffer.from('energy,intensity,sigma\n1,2,0.1\n2,4,0.2\n3,bad,0.3\n'),
  });
  await expect(page.locator('#msds-import-dialog')).toBeVisible();
  await page.locator('#msds-map-xlabel').fill('Photon energy');
  await page.locator('#msds-map-ylabel').fill('Intensity');
  await page.locator('#msds-map-error').selectOption('2');
  await page.locator('#msds-import-confirm').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(1);
  await page.getByRole('button', { name: 'Bảng' }).click();
  await expect(page.locator('#msds-table-summary')).toContainText('Cảnh báo');
  const rawValue = await page.locator('.msds-cell[data-row="0"][data-column="y"]').inputValue();
  expect(rawValue).toBe('2');
  await page.locator('.msds-cell[data-row="0"][data-column="y"]').fill('2.5');
  await page.locator('#msds-apply-edits').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(2);
  expect(await page.locator('.msds-cell[data-row="0"][data-column="y"]').inputValue()).toBe('2.5');
  await page.locator('#msds-undo').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(1);
  await page.locator('#msds-redo').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(2);
  await page.locator('.msds-row-select[data-row="1"]').check();
  await page.locator('#msds-mask-selected').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(3);
  await expect(page.locator('#msds-table-summary')).toContainText('1 masked');
  expect(errors).toEqual([]);
});

test('multiple files queue and project autosave/JSON round-trip retain state', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/analysis.html');
  await page.locator('#msds-file').setInputFiles([
    { name: 'first.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n2,3\n') },
    { name: 'second.dat', mimeType: 'text/plain', buffer: Buffer.from('x y\n3 4\n4 5\n') },
  ]);
  await expect(page.locator('#msds-import-title')).toContainText('first.csv');
  await page.locator('#msds-import-confirm').click();
  await expect(page.locator('#msds-import-title')).toContainText('second.dat');
  await page.locator('#msds-import-confirm').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(2);
  await page.locator('#msds-save').click();
  await expect(page.locator('#msds-save-state')).toContainText('Đã lưu');

  const download = await Promise.all([page.waitForEvent('download'), page.locator('#msds-export-project').click()]).then(([item]) => item);
  const bytes = await readFile(await download.path());
  const exported = JSON.parse(bytes.toString());
  expect(exported.schemaVersion).toBe(1);
  expect(exported.datasets).toHaveLength(2);

  await page.reload();
  await expect(page.locator('.msds-dataset')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('worker preprocessing, peak detection and Gaussian fitting are revision-safe', async ({ page }) => {
  const errors = collectPageErrors(page);
  await addSample(page, '0');
  await page.locator('#msds-operation').selectOption('movingAverage');
  await page.locator('[data-param="window"]').fill('5');
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-status')).toContainText('Preview hoàn tất');
  await expect(page.locator('.msds-dataset')).toHaveCount(1);
  await page.locator('#msds-apply').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(2);

  await page.locator('#msds-operation').selectOption('detectPeaks');
  await page.locator('[data-param="prominence"]').fill('5');
  await page.locator('[data-param="minDistance"]').fill('1');
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-analysis-result')).toContainText('Detected peaks');

  await page.locator('#msds-operation').selectOption('fit');
  await expect(page.locator('.msds-fit-peak')).toHaveCount(5);
  await page.locator('#msds-fit-model').selectOption('gaussian');
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-analysis-result')).toContainText('Status: success', { timeout: 30_000 });
  await page.locator('#msds-apply').click();
  await expect(page.locator('#msds-status')).toContainText('Đã lưu kết quả fit', { timeout: 30_000 });
  const project = await page.evaluate(() => window.MSCStudio.getProject());
  expect(project.results.at(-1).datasetRevision).toBe(1);
  expect(project.results.at(-1).r2).toBeGreaterThan(0.95);
  await page.locator('#msds-preview').click();
  await page.locator('#msds-cancel').click();
  await expect(page.locator('#msds-status')).toContainText('Đã hủy');
  expect((await page.evaluate(() => window.MSCStudio.getProject())).results).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Tauc workflow requires confirmation and recovers the synthetic band gap', async ({ page }) => {
  const errors = collectPageErrors(page);
  await addSample(page, '2');
  await page.locator('#msds-operation').selectOption('tauc');
  await page.locator('[data-param="xMode"]').selectOption('wavelength');
  await page.locator('[data-param="signal"]').selectOption('alpha');
  await page.locator('[data-param="transition"]').selectOption('direct');
  await page.locator('#msds-roi-min').fill('2.2');
  await page.locator('#msds-roi-max').fill('3.2');
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-status')).toContainText('explicit confirmation');
  await page.locator('[data-param="confirmed"]').check();
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-analysis-result')).toContainText('Tauc result');
  await expect(page.locator('#msds-analysis-result')).toContainText('2.1 eV');
  expect(errors).toEqual([]);
});

test('full 2x2 figure exports vector SVG, 300 dpi PNG and PDF', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  await addSample(page, '1');
  await page.getByRole('button', { name: 'Figure', exact: true }).click();
  await page.locator('#msds-layout').selectOption('2x2');
  for (const panel of ['1', '2', '3']) {
    await page.locator('#msds-figure-panel').selectOption(panel);
    await page.locator('#msds-add-series').click();
  }
  await page.locator('#msds-width-mm').fill('100');
  await page.locator('#msds-height-mm').fill('80');

  const svgDownload = await Promise.all([page.waitForEvent('download'), page.locator('[data-msds-export="svg"]').click()]).then(([download]) => download);
  const svgPath = await svgDownload.path();
  const svg = await readFile(svgPath, 'utf8');
  expect(svg).toContain('width="100mm"');
  expect(svg).toContain('<path');
  expect(svg).toContain('>(a)</text>');
  expect(svg).not.toContain('<image');

  const pngDownload = await Promise.all([page.waitForEvent('download'), page.locator('[data-msds-export="png"]').click()]).then(([download]) => download);
  const png = await readFile(await pngDownload.path());
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.length).toBeGreaterThan(20_000);

  const pdfDownload = await Promise.all([page.waitForEvent('download'), page.locator('[data-msds-export="pdf"]').click()]).then(([download]) => download);
  const pdf = await readFile(await pdfDownload.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
  await testInfo.attach('figure.svg', { body: svg, contentType: 'image/svg+xml' });
});

test('chemistry reagent can be explicitly unselected before another vessel touch', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/index.html');
  await page.locator('#cabT-chem').click();
  await expect(page.locator('[data-chem="HCl"]')).toBeVisible();
  await page.locator('[data-chem="HCl"]').click();
  await expect(page.locator('#mClearChem')).toBeEnabled();
  await expect(page.locator('#mClearChem')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mClearChem').click();
  await expect(page.locator('#mClearChem')).toBeDisabled();
  await expect(page.locator('#mClearChem')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-chem="HCl"]')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
