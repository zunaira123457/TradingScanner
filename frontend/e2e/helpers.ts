import { expect, test as base, type Page } from '@playwright/test';

export const MOCK = 'http://127.0.0.1:4010';

export async function control(body: Record<string, unknown>) {
  const r = await fetch(`${MOCK}/__control`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error('mock control failed');
}

/**
 * Each test acts as a distinct client IP (as it would behind Caddy) so the
 * per-client rate limits don't couple parallel tests, and every test collects
 * console errors / uncaught exceptions and fails on any.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page, context }, use, info) => {
      const ip = `10.${info.workerIndex % 250}.${(info.repeatEachIndex + info.retry) % 250}.${Math.floor(Math.random() * 250) + 1}`;
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        // Expected: failing fetches the test deliberately provokes are asserted separately.
        if (/Failed to load resource|net::ERR_|status of (4\d\d|5\d\d)|EventSource|WebSocket|NetworkError when attempting|Load failed/.test(t)) return;
        errors.push(t);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await use(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function openDashboard(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByText('Trading Desk').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export const priceOf = async (page: Page) => (await page.locator('[aria-live="polite"] .text-3xl').first().textContent())?.trim();

/** True if the page scrolls horizontally. */
export const hasHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
