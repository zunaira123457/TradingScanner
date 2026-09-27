import { describe, expect, it } from 'vitest';
import { BollingerBands, EMA, MACD, RSI, SMA } from 'technicalindicators';
import { bollinger, ema, macd, rsi, sma, type Series } from '@/lib/utils/technicalAnalysis';
import { candles } from '../fixtures';

/**
 * Cross-checks our indicators against an independent open-source
 * implementation (`technicalindicators`) on 500 bars of seeded data.
 */
const closes = candles(500).map((c) => c.close);
const tail = (s: Series) => s.filter((v): v is number => v !== null);

function expectSeriesClose(ours: Series, ref: number[], digits = 6) {
  const got = tail(ours);
  expect(got.length).toBe(ref.length);
  got.forEach((v, i) => expect(v).toBeCloseTo(ref[i], digits));
}

describe('indicator accuracy vs technicalindicators', () => {
  it.each([5, 20, 50, 200])('SMA %i', (period) => {
    expectSeriesClose(sma(closes, period), SMA.calculate({ period, values: closes }));
  });

  it.each([9, 12, 21, 50])('EMA %i', (period) => {
    expectSeriesClose(ema(closes, period), EMA.calculate({ period, values: closes }));
  });

  it('RSI 14 (Wilder)', () => {
    // technicalindicators rounds RSI to 2 dp.
    expectSeriesClose(rsi(closes, 14), RSI.calculate({ period: 14, values: closes }), 1);
  });

  it('MACD 12/26/9', () => {
    const ref = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const ours = macd(closes);
    expectSeriesClose(ours.macd, ref.map((r) => r.MACD!), 6);
    const withSignal = ref.filter((r) => r.signal !== undefined);
    expectSeriesClose(ours.signal, withSignal.map((r) => r.signal!), 6);
    expectSeriesClose(ours.histogram, withSignal.map((r) => r.histogram!), 6);
  });

  it('Bollinger 20, 2σ', () => {
    const ref = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const ours = bollinger(closes, 20, 2);
    expectSeriesClose(ours.upper, ref.map((r) => r.upper), 6);
    expectSeriesClose(ours.middle, ref.map((r) => r.middle), 6);
    expectSeriesClose(ours.lower, ref.map((r) => r.lower), 6);
  });

  it('keeps every indicator index-aligned with the input', () => {
    for (const s of [sma(closes, 20), ema(closes, 50), rsi(closes), macd(closes).signal, bollinger(closes).upper]) {
      expect(s).toHaveLength(closes.length);
    }
  });

  it('handles edge inputs without throwing', () => {
    for (const input of [[], [1], [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]]) {
      expect(() => [sma(input, 3), ema(input, 3), rsi(input), macd(input), bollinger(input)]).not.toThrow();
    }
    expect(rsi(new Array(20).fill(5)).at(-1)).toBe(50); // flat → neutral
    expect(rsi(Array.from({ length: 20 }, (_, i) => i)).at(-1)).toBe(100); // only gains
  });
});
