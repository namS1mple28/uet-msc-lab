import { test, expect } from '@playwright/test';

async function openChemistryLab(page) {
  await page.goto('/index.html');
  const tab = page.getByRole('tab', { name: 'Phòng lab hóa học' });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  await expect(page.locator('#panel-lab')).toBeVisible();
}

async function clickBenchObject(page, id) {
  const canvas = page.locator('#benchCv');
  await canvas.scrollIntoViewIfNeeded();
  const point = await page.evaluate((objectId) => {
    const object = BENCH.find((item) => item.id === objectId);
    const rect = document.querySelector('#benchCv').getBoundingClientRect();
    return {
      x: (object.x / BW) * rect.width,
      y: (object.y - GEAR[object.type].h / 2) / BH * rect.height,
    };
  }, id);
  await canvas.click({ position: point });
}

test('reagent dose is explicit, announced, and cancellation prevents a further pour', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openChemistryLab(page);

  await page.locator('#cabT-chem').click();
  await expect(page.locator('#mDose')).toBeVisible();
  await page.locator('#mDose').selectOption('5');
  await page.locator('[data-chem="HCl"]').click();

  const state = page.locator('#benchState');
  await expect(state).toHaveAttribute('role', 'status');
  await expect(state).toHaveAttribute('aria-live', 'polite');
  await expect(state).toContainText('Đang cầm HCl');
  await expect(state).toContainText('5 mL');
  await expect(page.locator('#mClearChem')).toBeEnabled();

  const target = await page.evaluate(() => {
    const vessel = BENCH.find((item) => item.type === 'beaker' && item.vol + 5 <= item.cap);
    return { id: vessel.id, volume: vessel.vol };
  });
  await clickBenchObject(page, target.id);
  await expect.poll(() => page.evaluate((id) => BENCH.find((item) => item.id === id).vol, target.id))
    .toBeCloseTo(target.volume + 5, 6);

  await page.locator('#mClearChem').click();
  await expect(page.locator('#mClearChem')).toBeDisabled();
  await expect(state).toHaveText('Không cầm hóa chất');

  const afterCancel = await page.evaluate((id) => BENCH.find((item) => item.id === id).vol, target.id);
  await clickBenchObject(page, target.id);
  await expect.poll(() => page.evaluate((id) => BENCH.find((item) => item.id === id).vol, target.id))
    .toBeCloseTo(afterCancel, 6);
  expect(errors).toEqual([]);
});

test('key Chemistry Lab controls remain touch-sized without horizontal overflow at 390 px', async ({ page }) => {
  await openChemistryLab(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const audit = await page.locator('#panel-lab').evaluate((panel) => {
    const controls = ['#mHeat', '#mDrip', '#mStir', '#mEmpty', '#mClearChem', '#mPreset', '#mClear']
      .map((selector) => {
        const rect = panel.querySelector(selector).getBoundingClientRect();
        return { selector, width: rect.width, height: rect.height };
      });
    return {
      controls,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelOverflow: panel.scrollWidth - panel.clientWidth,
    };
  });

  for (const control of audit.controls) {
    expect(control.height, control.selector).toBeGreaterThanOrEqual(44);
  }
  expect(audit.documentOverflow).toBeLessThanOrEqual(1);
  expect(audit.panelOverflow).toBeLessThanOrEqual(1);
});

test('reduced-motion Chemistry Canvas remains bitmap-stable without user input', async ({ page }) => {
  await openChemistryLab(page);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  const canvas = page.locator('#benchCv');
  await canvas.scrollIntoViewIfNeeded();
  const bitmapHash = async () => canvas.evaluate((element) => {
    const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += 97) {
      hash = Math.imul(hash ^ data[index], 16777619);
    }
    return hash >>> 0;
  });
  const before = await bitmapHash();
  await page.waitForTimeout(350);
  const after = await bitmapHash();
  expect(after).toBe(before);
});
