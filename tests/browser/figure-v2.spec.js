import { test, expect } from '@playwright/test';

test('Figure Editor v2 keeps Page/Layer/Plot styling, ordering and keyboard tabs coherent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/analysis.html');
  await page.locator('#msds-samples').selectOption('0');
  await page.locator('#msds-samples').selectOption('1');

  const figureTab = page.getByRole('tab', { name: 'Figure', exact: true });
  await figureTab.click();
  await expect(figureTab).toHaveAttribute('aria-selected', 'true');
  await figureTab.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Bảng' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Bảng' }).press('ArrowLeft');
  await expect(figureTab).toHaveAttribute('aria-selected', 'true');

  await page.locator('#msds-series-select').selectOption('1');
  const movedName = await page.locator('#msds-series-name').inputValue();
  await page.locator('#msds-series-up').click();
  await page.locator('#msds-series-name').fill('Styled spectrum');
  await page.locator('#msds-series-color').fill('#7c3aed');
  await page.locator('#msds-series-opacity').fill('0.65');
  await page.locator('#msds-line-shape').selectOption('spline');
  await page.locator('#msds-series-fill').selectOption('tozeroy');
  await page.locator('#msds-line-width').fill('0');
  await page.locator('#msds-marker-size').fill('7');
  await page.locator('#msds-page-background').fill('#f4f0ff');
  await page.locator('#msds-plot-background').fill('#fffefe');
  for (const id of ['#msds-margin-l', '#msds-margin-r', '#msds-margin-t', '#msds-margin-b', '#msds-grid-width', '#msds-axis-width']) {
    await page.locator(id).fill('0');
  }
  await page.locator('#msds-grid-minor').check();
  await page.locator('#msds-legend-position').selectOption('bottom');
  await page.locator('#msds-legend-orientation').selectOption('h');
  await page.locator('#msds-figure-update').click();

  let figure = (await page.evaluate(() => window.MSCStudio.getProject())).figures[0];
  expect(figure.panels[0].series[0].name).toBe('Styled spectrum');
  expect(figure.panels[0].series[0].name).not.toBe(movedName);
  expect(figure.panels[0].series[0].lineWidth).toBe(0);
  expect(figure.panels[0].series[0].opacity).toBe(0.65);
  expect(figure.panels[0].series[0].lineShape).toBe('spline');
  expect(figure.panels[0].series[0].fill).toBe('tozeroy');
  expect(figure.panels[0].margins).toEqual({ l: 0, r: 0, t: 0, b: 0 });
  expect(figure.panels[0].grid.width).toBe(0);
  expect(figure.panels[0].axes.width).toBe(0);
  expect(figure.pageBackground).toBe('#f4f0ff');
  expect(figure.panels[0].legend.position).toBe('bottom');
  await expect(page.locator('#msds-plot-grid')).toHaveCSS('background-color', 'rgb(244, 240, 255)');
  await expect.poll(() => page.evaluate(() => document.querySelector('#msds-plot-0')?.data?.[0]?.opacity)).toBe(0.65);

  await page.locator('#msds-series-visible').uncheck();
  await page.locator('#msds-figure-update').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#msds-plot-0')?.data?.length)).toBe(1);
  await page.locator('#msds-series-visible').check();
  await page.locator('#msds-figure-update').click();

  await page.locator('#msds-add-reference').click();
  await page.locator('#msds-annotation-x').fill('500');
  await page.locator('#msds-reference-label').fill('Reference peak');
  await page.locator('#msds-reference-width').fill('0');
  await page.locator('#msds-annotation-confirm').click();
  figure = (await page.evaluate(() => window.MSCStudio.getProject())).figures[0];
  expect(figure.panels[0].references[0]).toMatchObject({ type: 'vline', value: 500, label: 'Reference peak', width: 0 });
  expect(errors).toEqual([]);
});
