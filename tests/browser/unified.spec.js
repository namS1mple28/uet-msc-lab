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
