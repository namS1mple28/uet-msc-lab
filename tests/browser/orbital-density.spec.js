import { test, expect } from '@playwright/test';

const elements = [
  ['H', 1, '1s', 's'], ['C', 6, '2p', 'p_z'], ['Fe', 26, '3d', 'd_z²'],
  ['Ce', 58, '4f', 'f_z³'], ['U', 92, '5f', 'f_z³'], ['Og', 118, '7p', 'p_z'],
];

async function openAtom(page, entry) {
  await page.goto(entry === 'unified' ? '/index.html#atom' : '/nguyen-tu.html');
  await expect(page.locator('#fingerprint')).toBeVisible();
  await expect(page.locator('#elSym')).toHaveText('Si');
}

async function clickElement(page, z) {
  await page.locator(`.el[data-z="${z}"]`).click();
  await expect(page.locator('#elZ')).toHaveText(String(z));
}

for (const entry of ['unified', 'atom']) {
  test(`${entry} atom entry updates symbol, subshell, quantum metadata, and canvas`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openAtom(page, entry);
    for (const [symbol, z, subshell, component] of elements) {
      await clickElement(page, z);
      await expect(page.locator('#elSym')).toHaveText(symbol);
      await expect(page.locator('#fingerprintSymbol')).toContainText(symbol);
      await expect(page.locator('#fingerprintMeta')).toContainText(subshell);
      await expect(page.locator('#fingerprintMeta')).toContainText(component);
      await expect(page.locator('#fingerprintMeta')).toContainText('(n, ℓ, m)');
      await expect(page.locator('#fingerprint')).toHaveAttribute('aria-label', new RegExp(`${component} hydrogenic representative`));
      if (z === 1) await expect(page.locator('#fingerprintCaveat')).toBeHidden();
      else await expect(page.locator('#fingerprintCaveat')).toContainText('Z > 1');
    }
    expect(errors).toEqual([]);
  });
}

test('density/phase and plane controls alter the bitmap and accessible state', async ({ page }) => {
  await openAtom(page, 'unified');
  const canvas = page.locator('#fingerprint');
  const initial = await canvas.evaluate((node) => node.toDataURL());
  await page.locator('[data-fingerprint-mode="phase"]').click();
  await expect(page.locator('[data-fingerprint-mode="phase"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('aria-label', /pha ψ/);
  const phase = await canvas.evaluate((node) => node.toDataURL());
  expect(phase).not.toBe(initial);
  await page.locator('[data-fingerprint-plane="xy"]').click();
  await expect(page.locator('[data-fingerprint-plane="xy"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('aria-label', /mặt cắt xy/);
  const xy = await canvas.evaluate((node) => node.toDataURL());
  expect(xy).not.toBe(phase);
  await page.locator('[data-fingerprint-mode="density"]').click();
  await expect(page.locator('#fingerprintScaleLabel')).toContainText('|ψ|²');
});

test('fingerprint canvas remains black-backed in light and dark themes', async ({ page }) => {
  await openAtom(page, 'unified');
  const sample = () => page.locator('#fingerprint').evaluate((node) => Array.from(node.getContext('2d').getImageData(0, 0, 1, 1).data));
  const dark = await sample();
  await page.locator('#themeBtn').click();
  const light = await sample();
  expect(dark.slice(0, 3)).toEqual([3, 3, 7]);
  expect(light.slice(0, 3)).toEqual([3, 3, 7]);
  await page.locator('#themeBtn').click();
  expect((await sample()).slice(0, 3)).toEqual([3, 3, 7]);
});

test('390px layout has no horizontal overflow and keeps fingerprint controls touch-sized', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAtom(page, 'unified');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const controls = page.locator('.fingerprint-controls button');
  await expect(controls).toHaveCount(5);
  for (let i = 0; i < await controls.count(); i += 1) {
    expect((await controls.nth(i).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
});

test('reduced-motion keeps the orbital bitmap deterministic after a frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAtom(page, 'unified');
  const before = await page.locator('#fingerprint').evaluate((node) => node.toDataURL());
  await page.waitForTimeout(120);
  const after = await page.locator('#fingerprint').evaluate((node) => node.toDataURL());
  expect(after).toBe(before);
});
