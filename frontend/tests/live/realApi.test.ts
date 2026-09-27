/**
 * LIVE tests against the real Twelve Data API and the running scanner.
 * Opt-in (costs ~4 of the 800 daily free credits): LIVE=1 npx vitest run tests/live
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { rsi, sma } from '@/lib/utils/technicalAnalysis';

const LIVE = process.env.LIVE === '1';
const envFile = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

describe.skipIf(!LIVE)('live market data (real Twelve Data)', () => {
  let client: typeof import('@/lib/api-clients/stockDataClient');
  beforeAll(async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', envFile.TWELVE_DATA_API_KEY);
    vi.stubEnv('FINNHUB_API_KEY', envFile.FINNHUB_API_KEY ?? '');
    vi.stubEnv('TWELVE_DATA_RPM', '6');
    vi.resetModules();
    client = await import('@/lib/api-clients/stockDataClient');
  });

  it('real quote for AAPL is sane and internally consistent', async () => {
    const q = await client.getQuote('AAPL');
    expect(q.price).toBeGreaterThan(1);
    expect(q.prevClose).toBeGreaterThan(1);
    expect(q.change!).toBeCloseTo(q.price - q.prevClose!, 1);
    expect(q.changePercent!).toBeCloseTo(((q.price - q.prevClose!) / q.prevClose!) * 100, 1);
    expect(q.low!).toBeLessThanOrEqual(q.price + 1e-6);
    expect(q.high!).toBeGreaterThanOrEqual(q.price - 1e-6);
    console.log('[live] AAPL', q.price, q.change, `${q.changePercent}%`, 'prev', q.prevClose);
  });

  it('real daily candles: ordered, valid OHLC; our RSI/SMA match the scanner backend', async () => {
    const r = await client.getCandles('AAPL', '1d');
    const c = r.candles;
    expect(c.length).toBeGreaterThan(200);
    for (let i = 0; i < c.length; i++) {
      expect(c[i].high).toBeGreaterThanOrEqual(Math.max(c[i].open, c[i].close) - 1e-6);
      expect(c[i].low).toBeLessThanOrEqual(Math.min(c[i].open, c[i].close) + 1e-6);
      if (i) expect(c[i].time).toBeGreaterThan(c[i - 1].time);
    }
    const closes = c.map((x) => x.close);
    const ourRsi = rsi(closes, 14).at(-1)!;
    const ourSma50 = sma(closes, 50).at(-1)!;
    const res = await fetch('http://localhost:4000/v1/analysis/AAPL?ai=0');
    const scanner = (await res.json()) as { indicators: { rsi14: number; sma50: number }; lastClose: number };
    console.log('[live] RSI14 ours', ourRsi.toFixed(2), 'scanner', scanner.indicators.rsi14, '| SMA50 ours', ourSma50.toFixed(2), 'scanner', scanner.indicators.sma50, '| last close', closes.at(-1), scanner.lastClose);
    expect(closes.at(-1)).toBeCloseTo(scanner.lastClose, 1);
    // Different history lengths seed Wilder smoothing differently; agreement within 1 point is the expectation.
    expect(Math.abs(ourRsi - scanner.indicators.rsi14)).toBeLessThan(1);
    expect(Math.abs(ourSma50 - scanner.indicators.sma50)).toBeLessThan(0.05);
  });

  it('real invalid symbol returns a clean error', async () => {
    await expect(client.getCandles('ZZZZQ', '1d')).rejects.toMatchObject({ provider: 'twelvedata' });
  });
});
