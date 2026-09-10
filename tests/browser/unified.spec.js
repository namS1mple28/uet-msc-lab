import { test, expect } from '@playwright/test';

test('index unifies Lab Studio and Data Studio while preserving both states', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html');

  await expect(page).toHaveTitle('UET MSC Lab & Data Studio');
  await expect(page.getByRole('tab', { name: 'Phòng lab hóa học' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-studio #msc-data-studio')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Phòng lab hóa học' }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Phân tích dữ liệu' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Xưởng vật liệu' })).toBeFocused();
  await page.getByRole('tab', { name: 'Phòng lab hóa học' }).click();

  await page.locator('#cabT-chem').click();
  await page.locator('[data-chem="HCl"]').click();
  await expect(page.locator('#mClearChem')).toBeEnabled();

  await page.getByRole('tab', { name: 'Phân tích dữ liệu' }).click();
  await expect(page.locator('#panel-studio')).toBeVisible();
  await expect(page).toHaveURL(/#studio$/);
  await page.locator('#msds-samples').selectOption('1');
  await expect(page.locator('#panel-studio .msds-dataset')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Phòng lab hóa học' }).click();
  await expect(page.locator('#mClearChem')).toBeEnabled();
  await page.getByRole('tab', { name: 'Phân tích dữ liệu' }).click();
  await expect(page.locator('#panel-studio .msds-dataset')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('XRD bridge imports the displayed spectrum directly without page navigation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html');
  const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);

  await page.evaluate(async () => {
    SMP = newSample('Si', 'cz');
    xrdData = { x0: 10, dx: 0.5, y: Float32Array.from([4, 9, 16, 9, 4]) };
    await sendToStudio('xrd');
  });

  await expect(page.getByRole('tab', { name: 'Phân tích dữ liệu' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-studio')).toBeVisible();
  const dataset = await page.evaluate(() => window.MSCStudio.getActiveDataset());
  expect(dataset.name).toContain('XRD · Si · mô phỏng');
  expect(dataset.x).toEqual([10, 10.5, 11, 11.5, 12]);
  expect(dataset.y).toEqual([4, 9, 16, 9, 4]);
  expect(dataset.source.measurement).toBe('xrd');
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navigationCount);
  expect(errors).toEqual([]);
});

test('UV-Vis and Tauc bridges preserve units and sample metadata in the same page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html#fab');
  const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);

  await page.evaluate(async () => {
    SMP = newSample('ZnO', 'solgel');
    await sendToStudio('uvvis');
  });
  const uvvis = await page.evaluate(() => window.MSCStudio.getActiveDataset());
  expect(uvvis.source.measurement).toBe('uvvis');
  expect(uvvis.xUnit).toBe('nm');
  expect(uvvis.yUnit).toBe('%');
  expect(uvvis.source.sample.mat).toBe('ZnO');

  await page.evaluate(async () => {
    showTab('fab');
    await sendToStudio('tauc');
  });
  const tauc = await page.evaluate(() => window.MSCStudio.getActiveDataset());
  expect(tauc.source.measurement).toBe('tauc');
  expect(tauc.xUnit).toBe('eV');
  expect(tauc.yUnit).toBe('cm⁻¹');
  expect(tauc.source.transition).toBe('direct');
  expect(tauc.source.thicknessNm).toBeGreaterThan(0);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navigationCount);
  expect(errors).toEqual([]);
});

test('legacy entries route every workspace back into the unified page', async ({ page }) => {
  await page.goto('/analysis.html');
  await expect(page.getByRole('link', { name: 'Phòng Lab' })).toHaveAttribute('href', 'index.html#lab');
  await expect(page.getByRole('link', { name: 'Xưởng vật liệu' })).toHaveAttribute('href', 'index.html#fab');
  await expect(page.getByRole('link', { name: 'Bảng tuần hoàn' })).toHaveAttribute('href', 'index.html#atom');

  await page.goto('/vat-lieu.html');
  await expect(page.getByRole('link', { name: 'Phân tích dữ liệu' })).toHaveAttribute('href', 'index.html#studio');
  await page.getByRole('link', { name: 'Phân tích dữ liệu' }).click();
  await expect(page).toHaveURL(/index\.html#studio$/);
  await expect(page.locator('#panel-studio')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Phân tích dữ liệu' })).toHaveAttribute('aria-selected', 'true');
});
