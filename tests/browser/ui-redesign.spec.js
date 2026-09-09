import { test, expect } from '@playwright/test';

test('research console uses readable local typography and restrained brand styling', async ({ page }) => {
  await page.goto('/analysis.html');
  await page.locator('#msds-samples').selectOption('1');
  await page.evaluate(() => document.fonts.ready);

  const audit = await page.evaluate(() => {
    const style = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo);
    const buttonBoxes = [...document.querySelectorAll('.msds-actions .msds-btn')].map((button) => ({
      height: button.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(button).lineHeight),
      whiteSpace: getComputedStyle(button).whiteSpace,
    }));
    return {
      bodyMargin: style('body').margin,
      fontFamily: style('.msds').fontFamily,
      fontLoaded: document.fonts.check('14px Figtree'),
      bodySize: parseFloat(style('.msds').fontSize),
      labelSize: parseFloat(style('.msds-control-grid label').fontSize),
      hintSize: parseFloat(style('.msds-hint').fontSize),
      inputSize: parseFloat(style('#msds-operation').fontSize),
      cardRadius: style('.msds-card').borderRadius,
      plotRadius: style('.msds-plot-panel').borderRadius,
      topbarBefore: style('.msds-topbar', '::before').content,
      topbarAfter: style('.msds-topbar', '::after').content,
      buttonBoxes,
    };
  });

  expect(audit.bodyMargin).toBe('0px');
  expect(audit.fontFamily).toContain('Figtree');
  expect(audit.fontLoaded).toBe(true);
  expect(audit.bodySize).toBeGreaterThanOrEqual(14);
  expect(audit.labelSize).toBeGreaterThanOrEqual(12);
  expect(audit.hintSize).toBeGreaterThanOrEqual(12);
  expect(audit.inputSize).toBeGreaterThanOrEqual(13);
  expect(audit.cardRadius).toBe(audit.plotRadius);
  expect(audit.topbarBefore).toBe('none');
  expect(audit.topbarAfter).toBe('none');
  for (const box of audit.buttonBoxes) {
    expect(box.whiteSpace).toBe('nowrap');
    expect(box.height).toBeLessThan(45);
    expect(box.height).toBeGreaterThanOrEqual(36);
  }
});

test('research console remains usable at tablet and mobile widths', async ({ page }) => {
  await page.goto('/analysis.html');

  await page.setViewportSize({ width: 1024, height: 900 });
  const tablet = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector('.msds-shell')).gridTemplateColumns.split(' ').length,
    navScrollable: document.querySelector('.msds-nav').scrollWidth >= document.querySelector('.msds-nav').clientWidth,
    actionLines: [...document.querySelectorAll('.msds-actions .msds-btn')].every((button) => getComputedStyle(button).whiteSpace === 'nowrap'),
  }));
  expect(tablet.columns).toBe(3);
  expect(tablet.navScrollable).toBe(true);
  expect(tablet.actionLines).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.msds-shell')).toHaveCSS('grid-template-columns', '390px');
  const touchTargets = await page.locator('.msds-actions button').evaluateAll((buttons) => buttons.map((button) => ({
    width: button.getBoundingClientRect().width,
    height: button.getBoundingClientRect().height,
  })));
  for (const target of touchTargets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
});
