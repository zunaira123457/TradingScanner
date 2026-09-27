import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, openDashboard, priceOf, test } from './helpers';

/** Leaves the dashboard open for SOAK_MINUTES (default 60). Opt-in: SOAK=1. */
const MINUTES = Number(process.env.SOAK_MINUTES ?? 60);

test.describe('soak', () => {
  test.skip(({ browserName }) => !process.env.SOAK || browserName !== 'chromium', 'opt-in: SOAK=1, chromium');
  test.setTimeout((MINUTES + 10) * 60_000);

  test(`dashboard left open for ${MINUTES} minutes stays live and does not leak`, async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      const streams = new Set<EventSource>();
      const Orig = window.EventSource;
      let opened = 0;
      window.EventSource = class extends Orig {
        constructor(u: string | URL, i?: EventSourceInit) {
          super(u, i);
          streams.add(this);
          opened++;
        }
      } as typeof EventSource;
      w.__soak = () => ({ openStreams: [...streams].filter((s) => s.readyState !== 2).length, streamsOpenedTotal: opened });
    });
    await openDashboard(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const samples: Record<string, unknown>[] = [];
    const t0 = Date.now();
    let lastPrice = await priceOf(page);
    for (let m = 0; m <= MINUTES; m += 5) {
      if (m) await page.waitForTimeout(5 * 60_000);
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = (n: string) => metrics.find((x) => x.name === n)!.value;
      const price = await priceOf(page);
      const status = await page.locator('header [aria-live="polite"]').first().innerText();
      const sample = {
        minute: Math.round((Date.now() - t0) / 60_000),
        heapMB: +(get('JSHeapUsedSize') / 1048576).toFixed(1),
        nodes: get('Nodes'),
        listeners: get('JSEventListeners'),
        ...(await page.evaluate(() => (window as unknown as { __soak: () => object }).__soak())),
        status: status.replace(/\s+/g, ' ').trim(),
        priceChanged: price !== lastPrice,
      };
      lastPrice = price;
      samples.push(sample);
      console.log('[soak]', JSON.stringify(sample));
      mkdirSync('playwright-report', { recursive: true });
      writeFileSync('playwright-report/soak.json', JSON.stringify(samples, null, 2));
    }
    const first = samples[1] as { heapMB: number; nodes: number; listeners: number };
    const last = samples.at(-1) as { heapMB: number; nodes: number; listeners: number; openStreams: number; status: string };
    expect(last.openStreams).toBe(1);
    expect(last.status).toMatch(/^Live/);
    expect(samples.slice(1).every((s) => s.priceChanged)).toBe(true);
    expect(last.heapMB - first.heapMB).toBeLessThan(10);
    expect(last.nodes).toBeLessThan(first.nodes * 1.2);
    expect(last.listeners).toBeLessThan(first.listeners * 1.2 + 20);
  });
});
