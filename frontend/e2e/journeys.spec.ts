import { control, expect, openDashboard, priceOf, test } from './helpers';

test.describe('critical user journeys', () => {
  test('1. dashboard loads with live data and updates in real time', async ({ page }) => {
    await openDashboard(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('AAPL');
    await expect(page.getByText(/^Live/)).toBeVisible();
    const watchlist = page.getByRole('list', { name: 'Watchlist symbols' });
    await expect(watchlist.getByRole('button', { name: /^MSFT/ })).toContainText('$');
    const first = await priceOf(page);
    expect(first).toMatch(/^\$\d/);
    // Streamed ticks change the headline price without a reload.
    await expect.poll(() => priceOf(page), { timeout: 20_000, intervals: [500] }).not.toBe(first);
    await expect(page.getByRole('img', { name: 'Candlestick price chart' }).locator('canvas').first()).toBeVisible();
  });

  test('2. view chart: timeframes, indicators and crosshair', async ({ page }) => {
    await openDashboard(page);
    const chart = page.getByRole('img', { name: 'Candlestick price chart' });
    await expect(chart.locator('canvas').first()).toBeVisible();
    for (const tf of ['1m', '15m', '1H', '1W']) {
      const req = page.waitForRequest((r) => r.url().includes('/api/candles') && r.url().includes(`interval=${tf.toLowerCase()}`));
      await page.getByRole('radio', { name: tf }).click();
      await req;
      await expect(page.getByRole('radio', { name: tf })).toHaveAttribute('aria-checked', 'true');
    }
    await page.keyboard.press('5');
    await expect(page.getByRole('radio', { name: '1D' })).toHaveAttribute('aria-checked', 'true');

    const canvasesBefore = await chart.locator('canvas').count();
    await page.getByRole('button', { name: 'RSI' }).click();
    await page.getByRole('button', { name: 'MACD' }).click();
    await expect(page.getByRole('button', { name: 'RSI' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => chart.locator('canvas').count()).toBeGreaterThan(canvasesBefore);

    const legend = page.locator('.num.pointer-events-none').first();
    const before = await legend.textContent();
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await expect.poll(() => legend.textContent()).not.toBe(before);
  });

  test('3. add a stock to the watchlist, persists across reloads, then remove it', async ({ page }) => {
    await openDashboard(page);
    const search = page.getByRole('combobox', { name: /search symbols/i });
    await search.fill('PLT');
    await page.getByRole('option').filter({ hasText: 'PLTR' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PLTR');
    const list = page.getByRole('list', { name: 'Watchlist symbols' });
    await expect(list.getByRole('button', { name: /^PLTR/ })).toBeVisible();
    await page.reload();
    await expect(list.getByRole('button', { name: /^PLTR/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PLTR');
    await page.getByRole('button', { name: 'Remove from watchlist' }).click();
    await expect(list.getByRole('button', { name: /^PLTR/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PLTR');
    await expect(list.getByRole('button', { name: /^PLTR/ })).toHaveCount(0);
  });

  test('4. set a price alert → stored on server → fires when price crosses', async ({ page }) => {
    await openDashboard(page, '/?symbol=AMD');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('AMD');
    await expect.poll(() => priceOf(page)).toMatch(/^\$/);
    await page.keyboard.press('a');
    const dialog = page.getByRole('dialog', { name: /New alert · AMD/ });
    const input = dialog.getByRole('textbox', { name: /price/i });
    await input.fill('1');
    await dialog.getByRole('button', { name: 'Create alert' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Already above');
    await input.fill('170');
    await dialog.getByRole('button', { name: 'Create alert' }).click();
    await expect(page.getByText('Alert created')).toBeVisible();

    const panel = page.getByRole('tabpanel');
    await page.getByRole('tab', { name: /Alerts/ }).click();
    await expect(panel.getByText('AMD · Price rises above $170.00')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: /Alerts/ }).click();
    await expect(panel.getByText('AMD · Price rises above $170.00')).toBeVisible(); // came back from the server

    await control({ override: { AMD: 171.5 } });
    try {
      await expect(page.getByText(/Alert: AMD at \$171\.50/)).toBeVisible({ timeout: 20_000 });
      await expect(panel.getByText('Triggered')).toBeVisible();
      await expect(panel.getByText(/Fired at/)).toContainText('$171.50');
    } finally {
      await control({ override: {} });
    }
    await panel.getByRole('button', { name: 'Clear' }).click();
    await expect(panel.getByText('No alerts yet')).toBeVisible();
  });

  test('5. AI scanner → select a setup → AI insights explain it', async ({ page }) => {
    await openDashboard(page);
    const scanner = page.getByRole('tabpanel');
    await expect(scanner.getByText('BUY')).toBeVisible();
    await scanner.getByRole('button', { name: 'NVDA' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('NVDA');
    await expect(page.getByText('NVDA shows a bullish daily and weekly trend.')).toBeVisible();
    await expect(page.getByText(/mtfAligned/)).toHaveCount(0);
    await expect(page.getByText('$216.25').first()).toBeVisible(); // stop from the trade plan
    await scanner.getByRole('button', { name: 'All tickers' }).click();
    await expect(scanner.getByRole('button', { name: 'MSFT' })).toBeVisible();
  });

  test('6. news, heatmap, compare and track record tabs', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('tab', { name: /News/ }).click();
    const link = page.getByRole('link', { name: /AAPL headline 1/ });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await page.getByRole('tab', { name: /Heatmap/ }).click();
    await expect(page.getByRole('tabpanel').getByRole('button')).toHaveCount(10);
    await page.getByRole('tab', { name: /Compare/ }).click();
    await expect(page.getByRole('img', { name: 'Relative performance chart' }).locator('canvas').first()).toBeVisible();
    await expect(page.getByRole('tabpanel').getByText('SPY')).toBeVisible();
    await page.getByRole('tab', { name: /Track record/ }).click();
    await expect(page.getByText('Momentum continuation')).toBeVisible();
  });

  test('7. keyboard-only navigation', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'no physical keyboard on phones');
    await openDashboard(page);
    await page.keyboard.press('j');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('MSFT');
    await page.keyboard.press('k');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('AAPL');
    await page.keyboard.press('/');
    await expect(page.getByRole('combobox', { name: /search symbols/i })).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    await expect(page.locator('html')).toHaveClass(/light/);
  });

  test('8. owner unlocks notifications and runs a test', async ({ page, browserName }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'Notification settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Notifications' });
    await dialog.getByPlaceholder('Owner key').fill('wrong-key-000');
    await dialog.getByRole('button', { name: 'Unlock' }).click();
    await expect(dialog.getByText('Wrong owner key')).toBeVisible();
    await dialog.getByPlaceholder('Owner key').fill('e2e-owner-key-123');
    await dialog.getByRole('button', { name: 'Unlock' }).click();
    await expect(dialog.getByText(/This browser is the site owner/)).toBeVisible();
    await expect(dialog.getByText(/Email \(not configured\)/)).toBeVisible();
    void browserName;
  });
});
