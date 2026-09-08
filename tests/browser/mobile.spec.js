import { test, expect } from '@playwright/test';

test('touch/mobile layout supports plotting and reagent deselection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/analysis.html');
  await expect(page.locator('#msc-data-studio')).toBeVisible();
  await page.locator('#msds-samples').selectOption('1');
  await expect(page.locator('#msds-plot-0 .scatterlayer')).toBeVisible();
  await page.getByRole('tab', { name: 'Bảng' }).tap();
  await expect(page.locator('#msds-data-table')).toBeVisible();

  await page.goto('/index.html');
  await page.locator('#cabT-chem').tap();
  await page.locator('[data-chem="HCl"]').tap();
  await expect(page.locator('#mClearChem')).toBeEnabled();
  await page.locator('#mClearChem').tap();
  await expect(page.locator('#mClearChem')).toBeDisabled();
  expect(errors).toEqual([]);
});
