import { test, expect } from '@playwright/test';

test('touch/mobile layout supports plotting and reagent deselection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html#studio');
  await expect(page.locator('#panel-studio')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Phân tích dữ liệu' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#msds-samples').selectOption('1');
  await expect(page.locator('#msds-plot-0 .scatterlayer')).toBeVisible();
  await page.getByRole('tab', { name: 'Bảng', exact: true }).tap();
  await expect(page.locator('#msds-data-table')).toBeVisible();

  await page.getByRole('tab', { name: 'Phòng lab hóa học' }).tap();
  await page.locator('#cabT-chem').tap();
  await page.locator('[data-chem="HCl"]').tap();
  await expect(page.locator('#mClearChem')).toBeEnabled();
  await page.locator('#mClearChem').tap();
  await expect(page.locator('#mClearChem')).toBeDisabled();

  await page.getByRole('tab', { name: 'Phân tích dữ liệu' }).tap();
  await expect(page.locator('.msds-dataset')).toHaveCount(1);
  expect(errors).toEqual([]);
});
