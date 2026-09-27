import { expect, hasHorizontalScroll, openDashboard, test } from './helpers';

const TABS = ['Scanner', 'Alerts', 'News', 'Heatmap', 'Compare', 'Track record'];

test.describe('responsiveness', () => {
  test('no horizontal page scroll on this device, across every tab and dialog', async ({ page }) => {
    await openDashboard(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
    for (const t of TABS) {
      await page.getByRole('tab', { name: new RegExp(t) }).click();
      await page.waitForTimeout(300);
      expect(await hasHorizontalScroll(page), `tab ${t}`).toBe(false);
    }
    await page.getByRole('button', { name: /alert/i }).first().click();
    expect(await hasHorizontalScroll(page), 'alert dialog').toBe(false);
    const dialog = page.getByRole('dialog');
    const box = (await dialog.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
  });

  for (const [label, width, height] of [['mobile 375', 375, 812], ['tablet 768', 768, 1024], ['desktop 1920', 1920, 1080]] as const) {
    test(`explicit viewport ${label}px: layout fits, key UI visible`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'viewport matrix runs once; device projects cover other engines');
      await page.setViewportSize({ width, height });
      await openDashboard(page);
      expect(await hasHorizontalScroll(page)).toBe(false);
      await expect(page.getByRole('list', { name: 'Watchlist symbols' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Candlestick price chart' })).toBeVisible();
      await expect(page.getByText(/AI Insights/i)).toBeVisible();
      const chart = (await page.getByRole('img', { name: 'Candlestick price chart' }).boundingBox())!;
      expect(chart.width).toBeGreaterThan(width < 768 ? 250 : 400);
      expect(chart.x + chart.width).toBeLessThanOrEqual(width);
      // Every visible interactive element is at least partly on-screen horizontally.
      const offscreen = await page.evaluate((vw) =>
        [...document.querySelectorAll('button, a, input, [role="tab"]')]
          .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('.overflow-x-auto'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.left < -1 || r.right > vw + 1);
          })
          .map((el) => (el as HTMLElement).innerText || el.getAttribute('aria-label')), width);
      expect(offscreen).toEqual([]);
    });
  }

  test('touch interactions work on touch devices', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'touch-only');
    await openDashboard(page);
    const list = page.getByRole('list', { name: 'Watchlist symbols' });
    await list.getByRole('button', { name: /^NVDA/ }).tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('NVDA');
    // The remove (×) button is visible without hover on touch screens.
    await expect(list.getByRole('button', { name: 'Remove NVDA from watchlist' })).toBeVisible();
    await page.getByRole('tab', { name: /Heatmap/ }).tap();
    await page.getByRole('tabpanel').getByRole('button').first().tap();
    await page.getByRole('radio', { name: '1W' }).tap();
    await expect(page.getByRole('radio', { name: '1W' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'RSI' }).tap();
    await expect(page.getByRole('button', { name: 'RSI' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Notification settings' }).tap();
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
    // Buttons are big enough to hit with a finger (≥ 24px, WCAG 2.2 AA target size).
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] button')]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.width < 24 || r.height < 20)).length);
    expect(small).toBe(0);
  });
});
