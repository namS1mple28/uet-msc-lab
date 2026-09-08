import { test, expect } from '@playwright/test';

function projectWithDataset(dataset, results = []) {
  return {
    schemaVersion: 1,
    id: `project-${dataset.id}`,
    name: 'Phase 2 E2E',
    datasets: [dataset],
    figures: [{ id: 'figure-e2e', name: 'Figure E2E', layout: '1x1', activePanel: 0, linkAxes: false, panels: [{ series: [{ id: 'series-e2e', datasetId: dataset.id, name: dataset.name }] }] }],
    results,
    operations: [],
    activeDatasetId: dataset.id,
  };
}

async function importProject(page, project) {
  await page.locator('#msds-import-project').setInputFiles({
    name: 'phase-2.msc.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('#msds-status')).toContainText('Đã nhập project JSON');
}

test('figure theme is applied to existing series and restored from schema-v1 autosave', async ({ page }) => {
  await page.goto('/analysis.html');
  await page.locator('#msds-samples').selectOption('1');
  await page.getByRole('tab', { name: 'Figure', exact: true }).click();
  await page.locator('#msds-figure-theme').selectOption('presentation');
  await page.locator('#msds-apply-theme').click();
  let figure = (await page.evaluate(() => window.MSCStudio.getProject())).figures[0];
  expect(figure.pageBackground).toBe('#f7f9fb');
  expect(figure.panels[0].fontSize).toBe(14);
  expect(figure.panels[0].series[0].lineWidth).toBe(2.4);
  expect(figure.panels[0].legend.orientation).toBe('h');
  await expect(page.locator('#msds-font-size')).toHaveValue('14');
  await page.locator('#msds-save').click();
  await expect(page.locator('#msds-save-state')).toContainText('Đã lưu cục bộ');
  await page.reload();
  await expect(page.locator('.msds-dataset')).toHaveCount(1);
  figure = (await page.evaluate(() => window.MSCStudio.getProject())).figures[0];
  expect(figure.pageBackground).toBe('#f7f9fb');
  expect(figure.panels[0].series[0].lineWidth).toBe(2.4);
  await page.getByRole('tab', { name: 'Figure', exact: true }).click();
  await expect(page.locator('#msds-legend-orientation')).toHaveValue('h');
});

test('despike preview is non-destructive and apply creates a derived dataset', async ({ page }) => {
  await page.goto('/analysis.html');
  await page.locator('#msds-file').setInputFiles({
    name: 'spike.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n0,1\n1,1\n2,20\n3,1\n4,1'),
  });
  await page.locator('#msds-import-confirm').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(1);
  await page.locator('#msds-operation').selectOption('despike');
  await page.locator('[data-param="window"]').fill('3');
  await page.locator('[data-param="threshold"]').fill('3');
  await page.locator('[data-param="action"]').selectOption('replace');
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-analysis-result')).toContainText('"count": 1');
  await expect(page.locator('.msds-dataset')).toHaveCount(1);
  await page.locator('#msds-apply').click();
  await expect(page.locator('.msds-dataset')).toHaveCount(2);
  const project = await page.evaluate(() => window.MSCStudio.getProject());
  expect(project.datasets[0].y).toEqual([1, 1, 20, 1, 1]);
  expect(project.datasets[1].y).toEqual([1, 1, 1, 1, 1]);
  expect(project.datasets[1].parentId).toBe(project.datasets[0].id);
});

test('Williamson–Hall blocks unconfirmed assumptions then reports corrected model state', async ({ page }) => {
  const lambda = 1.5406;
  const intercept = 0.002;
  const strain = 0.001;
  const peaks = [30, 40, 50].map((center) => {
    const theta = center * Math.PI / 360;
    const beta = (intercept + strain * 4 * Math.sin(theta)) / Math.cos(theta);
    return { center, fwhm: beta * 180 / Math.PI, height: 10, area: 5 };
  });
  const dataset = { id: 'xrd-e2e', revision: 1, name: 'Indexed XRD', x: [20, 30, 40, 50, 60], y: [1, 4, 3, 2, 1], error: null, mask: [false, false, false, false, false], xLabel: '2θ', yLabel: 'Intensity', xUnit: '°', yUnit: 'a.u.', source: { kind: 'test' }, parentId: null, operations: [] };
  const fit = { type: 'fit', status: 'success', datasetId: dataset.id, datasetRevision: 1, peaks };
  await page.goto('/analysis.html');
  await importProject(page, projectWithDataset(dataset, [fit]));
  await page.locator('#msds-operation').selectOption('williamsonHall');
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-status')).toContainText('explicit confirmation');
  await page.locator('[data-param="confirmed"]').check();
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-analysis-result')).toContainText('Williamson–Hall (UDM)');
  await expect(page.locator('#msds-analysis-result')).toContainText('Profile: gaussian · correction: none');
  await expect(page.locator('#msds-analysis-result')).toContainText('D: 69.327 nm');
  await expect(page.locator('#msds-analysis-result')).toContainText('No instrumental broadening correction');
});

test('Urbach requires confirmation and returns a numeric energy from explicit ROI', async ({ page }) => {
  const x = [2, 2.1, 2.2, 2.3, 2.4];
  const y = x.map((energy) => Math.exp(1 + 2 * energy));
  const dataset = { id: 'urbach-e2e', revision: 1, name: 'Urbach fixture', x, y, error: null, mask: x.map(() => false), xLabel: 'Photon energy', yLabel: 'α', xUnit: 'eV', yUnit: 'cm⁻¹', source: { kind: 'test' }, parentId: null, operations: [] };
  await page.goto('/analysis.html');
  await importProject(page, projectWithDataset(dataset));
  await page.locator('#msds-operation').selectOption('urbach');
  await expect(page.locator('#msds-roi-label')).toHaveText('ROI fit (photon energy, eV)');
  await page.locator('[data-param="xMode"]').selectOption('energy');
  await page.locator('[data-param="signal"]').selectOption('alpha');
  await page.locator('#msds-roi-min').fill('2');
  await page.locator('#msds-roi-max').fill('2.4');
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-status')).toContainText('explicit confirmation');
  await page.locator('[data-param="confirmed"]').check();
  await page.locator('#msds-preview').click();
  await expect(page.locator('#msds-analysis-result')).toContainText('Urbach tail');
  await expect(page.locator('#msds-analysis-result')).toContainText('EU: 0.5 eV');
  await expect(page.locator('#msds-analysis-result')).toContainText('R²: 1');
});
