import { test, expect } from '@playwright/test';

async function openMobileLab(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  const tab = page.getByRole('tab', { name: 'Phòng lab hóa học' });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  await expect(page.locator('#panel-lab')).toBeVisible();
}

test('touch tray pours the selected dose and provides explicit cancellation', async ({ page }) => {
  await openMobileLab(page);
  const before = await page.evaluate(() => {
    const vessel = BENCH.find((item) => item.kind === 'vessel' && item.vol + 5 <= item.cap);
    selId = vessel.id;
    refreshLab();
    return { id: vessel.id, volume: vessel.vol };
  });

  await page.locator('#cabT-chem').click();
  await page.locator('#mDose').selectOption('5');
  await page.locator('[data-chem="HCl"]').click();

  const tray = page.locator('#touchActions');
  await expect(tray).toBeVisible();
  await expect(tray.locator('[data-touch="pour"]')).toContainText('Rót 5');
  await expect(tray.locator('[data-touch="clear-reagent"]')).toContainText('Bỏ chọn HCl');
  await tray.locator('[data-touch="pour"]').click();

  await expect.poll(() => page.evaluate((id) => BENCH.find((item) => item.id === id).vol, before.id))
    .toBeCloseTo(before.volume + 5, 6);
  await tray.locator('[data-touch="clear-reagent"]').click();
  await expect(page.locator('#mClearChem')).toBeDisabled();
  await expect(page.locator('#benchState')).toHaveText('Không cầm hóa chất');

  const sizes = await tray.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height));
  expect(sizes.length).toBeGreaterThan(0);
  for (const height of sizes) expect(height).toBeGreaterThanOrEqual(44);
});

test('small glassware gets a 44 px effective hit target on mobile', async ({ page }) => {
  await openMobileLab(page);
  const target = await page.evaluate(() => {
    BENCH.length = 0;
    const tube = spawnGear('tube', 440, FLOOR);
    selId = null;
    refreshLab();
    const rect = document.querySelector('#benchCv').getBoundingClientRect();
    return {
      id: tube.id,
      x: rect.left + (tube.x / BW) * rect.width + 18,
      y: rect.top + ((tube.y - GEAR.tube.h / 2) / BH) * rect.height,
      renderedWidth: GEAR.tube.w / BW * rect.width,
    };
  });
  expect(target.renderedWidth).toBeLessThan(20);

  await page.mouse.click(target.x, target.y);
  await expect(page.locator('#touchActions')).toBeVisible();
  await expect(page.locator('#touchActions .touch-summary')).toContainText('Ống nghiệm');
  expect(await page.evaluate(() => selId)).toBe(target.id);
});
