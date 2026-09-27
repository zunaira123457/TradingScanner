import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, openDashboard, test } from './helpers';

const METRICS = 'playwright-report/perf-metrics.json';
function record(key: string, value: unknown) {
  mkdirSync('playwright-report', { recursive: true });
  const all = existsSync(METRICS) ? JSON.parse(readFileSync(METRICS, 'utf8')) : {};
  all[key] = value;
  writeFileSync(METRICS, JSON.stringify(all, null, 2));
  console.log(`[perf] ${key}: ${JSON.stringify(value)}`);
}

/** Counts live EventSources and intervals so leaks/stacking are observable. */
const instrument = () => {
  const w = window as unknown as Record<string, unknown>;
  const streams = new Set<EventSource>();
  const Orig = window.EventSource;
  window.EventSource = class extends Orig {
    constructor(u: string | URL, i?: EventSourceInit) {
      super(u, i);
      streams.add(this);
    }
  } as typeof EventSource;
  const intervals = new Set<number>();
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  window.setInterval = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
    const id = si(fn, ms, ...a);
    intervals.add(id);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) intervals.delete(id);
    ci(id);
  }) as typeof window.clearInterval;
  w.__stats = () => ({ streams: [...streams].filter((s) => s.readyState !== 2).length, intervals: intervals.size });
  w.__longTasks = [] as number[];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__longTasks as number[]).push(e.duration))).observe({ type: 'longtask', buffered: true });
  } catch {
    /* not supported */
  }
};

test.describe('performance', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'uses Chrome DevTools Protocol metrics');

  test('initial JS bundle is < 500 KB gzipped', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))];
    let raw = 0;
    let gz = 0;
    const files: Record<string, number> = {};
    for (const s of srcs) {
      const body = await (await request.get(s)).body();
      raw += body.length;
      const g = gzipSync(body).length;
      gz += g;
      files[s.split('/').pop()!] = Math.round(g / 1024);
    }
    const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
    let cssGz = 0;
    for (const c of css) cssGz += gzipSync(await (await request.get(c)).body()).length;
    record('bundle', { scripts: srcs.length, rawKB: Math.round(raw / 1024), gzipKB: Math.round(gz / 1024), cssGzipKB: Math.round(cssGz / 1024), largestChunksGzipKB: Object.fromEntries(Object.entries(files).sort((a, b) => b[1] - a[1]).slice(0, 5)) });
    expect(gz).toBeLessThan(500 * 1024);
  });

  test('chart: 500 bars + all indicators render fast; panning stays smooth', async ({ page }) => {
    await page.addInitScript(instrument);
    await page.addInitScript(() => {
      localStorage.setItem('sd.interval.v1', '"1d"');
      localStorage.setItem('sd.indicators.v1', '["vol","sma20","ema50","bb","rsi","macd"]');
    });
    const t0 = Date.now();
    await page.goto('/');
    const chart = page.getByRole('img', { name: 'Candlestick price chart' });
    await expect(chart.locator('canvas').first()).toBeVisible();
    await expect.poll(() => chart.locator('canvas').count()).toBeGreaterThan(6); // price + RSI + MACD panes
    const firstChart = Date.now() - t0;

    // Symbol switch → new 500-bar series fully drawn.
    const t1 = Date.now();
    const req = page.waitForResponse((r) => r.url().includes('/api/candles?symbol=MSFT'));
    await page.keyboard.press('j');
    await req;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const switchMs = Date.now() - t1;

    // Pan for ~2 seconds and measure frame rate.
    const box = (await chart.boundingBox())!;
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number; __counting: boolean };
      w.__frames = 0;
      w.__counting = true;
      const tick = () => {
        if (!w.__counting) return;
        w.__frames++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const start = Date.now();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) await page.mouse.move(box.x + box.width * (0.8 - i * 0.01), box.y + box.height * 0.3, { steps: 2 });
    await page.mouse.up();
    const panMs = Date.now() - start;
    const frames = await page.evaluate(() => {
      const w = window as unknown as { __frames: number; __counting: boolean };
      w.__counting = false;
      return w.__frames;
    });
    const fps = Math.round((frames / panMs) * 1000);
    const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
    record('chart', { bars: 500, indicators: 6, firstChartMs: firstChart, symbolSwitchMs: switchMs, panFps: fps, longTasksOver50ms: longTasks.length, worstLongTaskMs: Math.round(Math.max(0, ...longTasks)) });
    expect(switchMs).toBeLessThan(2_000);
    expect(fps).toBeGreaterThanOrEqual(30);
  });

  test('no memory leak or stacked streams/timers after 60 switches', async ({ page }) => {
    await page.addInitScript(instrument);
    await openDashboard(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      return {
        heapMB: +(metrics.find((m) => m.name === 'JSHeapUsedSize')!.value / 1048576).toFixed(1),
        nodes: metrics.find((m) => m.name === 'Nodes')!.value,
        listeners: metrics.find((m) => m.name === 'JSEventListeners')!.value,
      };
    };
    const stats = () => page.evaluate(() => (window as unknown as { __stats: () => { streams: number; intervals: number } }).__stats());

    // Warm up every code path once, then baseline.
    for (const k of ['j', 'j', '1', '5', 'k', 'k']) await page.keyboard.press(k);
    await page.waitForTimeout(1500);
    const before = { ...(await heap()), ...(await stats()) };

    for (let i = 0; i < 60; i++) {
      await page.keyboard.press(i % 2 ? 'j' : 'k');
      if (i % 10 === 0) await page.keyboard.press(String((i / 10) % 6 + 1));
    }
    await page.keyboard.press('5');
    await page.waitForTimeout(3000);
    const after = { ...(await heap()), ...(await stats()) };
    record('memory', { before, after, heapGrowthMB: +(after.heapMB - before.heapMB).toFixed(1) });

    expect(after.streams).toBe(1);
    expect(after.intervals).toBeLessThanOrEqual(before.intervals + 2);
    expect(after.heapMB - before.heapMB).toBeLessThan(15);
    expect(after.listeners).toBeLessThan(before.listeners * 1.5 + 50);
  });
});
