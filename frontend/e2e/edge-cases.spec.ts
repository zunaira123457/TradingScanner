import { expect, openDashboard, test } from './helpers';

test.describe('error handling & edge cases', () => {
  test('invalid stock symbol: added, clearly marked, no crash', async ({ page }) => {
    await openDashboard(page);
    const search = page.getByRole('combobox', { name: /search symbols/i });
    await search.fill('ZZZZ');
    await expect(page.getByText('No US stocks match')).toBeVisible();
    await search.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ZZZZ');
    await expect(page.getByText('Couldn’t load chart data')).toBeVisible();
    await expect(page.getByText(/not found/).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Watchlist symbols' }).getByText('unavailable')).toBeVisible({ timeout: 20_000 });
    // Garbage input is refused outright.
    await search.fill('$$$; drop');
    await search.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ZZZZ');
  });

  test('malicious deep link and API input are rejected', async ({ page, request }) => {
    await openDashboard(page, '/?symbol=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('AAPL');
    await expect(page).toHaveURL(/\/$/);
    for (const url of ['/api/candles?symbol=../../etc/passwd&interval=1d', '/api/quotes?symbols=AAPL;rm', '/api/search?q=%3Cscript%3E', '/api/scanner/analysis/..%2F..%2Fx']) {
      expect((await request.get(url)).status(), url).toBe(400);
    }
  });

  test('upstream timeout shows a clear message (not a hang)', async ({ page }) => {
    await openDashboard(page, '/?symbol=SLOW');
    await page.getByRole('radio', { name: '1D' }).click();
    await expect(page.getByText('Upstream request timed out')).toBeVisible({ timeout: 20_000 });
    // The rest of the dashboard keeps working meanwhile.
    await page.getByRole('list', { name: 'Watchlist symbols' }).getByRole('button', { name: /^MSFT/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('MSFT');
  });

  test('provider rate limit is explained, not shown as a crash', async ({ page }) => {
    await openDashboard(page, '/?symbol=LIMIT');
    await expect(page.getByText('Free-tier rate limit reached')).toBeVisible();
  });

  test('offline → reconnecting → recovers automatically', async ({ page, context, browserName }) => {
    void browserName;
    await openDashboard(page);
    await expect(page.getByText(/^Live/)).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/^Offline/)).toBeVisible();
    // Cached prices stay on screen while offline.
    await expect(page.locator('[aria-live="polite"] .text-3xl').first()).toHaveText(/^\$/);
    await context.setOffline(false);
    await expect(page.getByText(/^Live/)).toBeVisible({ timeout: 30_000 });
  });

  test('slow 3G: usable and prices arrive', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'network throttling needs the Chrome DevTools Protocol');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    // Chrome DevTools "Slow 3G" profile.
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
    const t0 = Date.now();
    await page.goto('/', { timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('AAPL', { timeout: 60_000 });
    const interactive = Date.now() - t0;
    await expect(page.locator('[aria-live="polite"] .text-3xl').first()).toHaveText(/^\$/, { timeout: 60_000 });
    const firstPrice = Date.now() - t0;
    await page.keyboard.press('j');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('MSFT');
    test.info().annotations.push({ type: 'perf', description: `slow3g interactive=${interactive}ms firstPrice=${firstPrice}ms` });
    console.log(`[perf] slow 3G: interactive ${interactive}ms, first price ${firstPrice}ms`);
    expect(firstPrice).toBeLessThan(45_000);
  });

  test('rapid switching between stocks: correct final state, one stream, no errors', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'keyboard-driven');
    await page.addInitScript(() => {
      const Orig = window.EventSource;
      const open = new Set<EventSource>();
      (window as unknown as { __openStreams: () => number }).__openStreams = () => [...open].filter((s) => s.readyState !== 2).length;
      window.EventSource = class extends Orig {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          open.add(this);
        }
      } as typeof EventSource;
    });
    await openDashboard(page);
    for (let i = 0; i < 40; i++) await page.keyboard.press(i % 3 === 0 ? 'k' : 'j');
    // 40 presses: 14 × k (i % 3 === 0), 26 × j → net +12 → index 2 of 10 → NVDA
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('NVDA');
    await expect(page.getByRole('img', { name: 'Candlestick price chart' }).locator('canvas').first()).toBeVisible();
    await expect(page.getByText('Couldn’t load chart data')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __openStreams: () => number }).__openStreams())).toBe(1);
  });

  test('full outage: every panel degrades gracefully, the app shell survives', async ({ page }) => {
    await page.route('**/api/**', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html>502 Bad Gateway</html>' }));
    await page.goto('/');
    await expect(page.getByText('Trading Desk').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('AAPL');
    await expect(page.getByText(/Couldn’t load/).first()).toBeVisible();
    await page.getByRole('tab', { name: /News/ }).click();
    await expect(page.getByText(/Couldn’t load news/)).toBeVisible();
  });
});
