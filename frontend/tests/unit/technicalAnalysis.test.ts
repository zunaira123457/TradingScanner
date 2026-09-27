import { describe, expect, it } from 'vitest';
import { bollinger, ema, macd, rsi, sma } from '@/lib/utils/technicalAnalysis';

const close = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];

describe('sma', () => {
  it('is null until the window fills, then the rolling mean', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });
});

describe('ema', () => {
  it('seeds with the SMA and then applies the 2/(n+1) multiplier', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(3); // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4);
  });
  it('returns all nulls when there is not enough data', () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe('rsi (Wilder)', () => {
  it('matches the classic Wilder worked example (first RSI ≈ 70.5)', () => {
    const out = rsi(close, 14);
    expect(out.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(out[14]).toBeCloseTo(70.46, 0);
    out.slice(14).forEach((v) => {
      expect(v).not.toBeNull();
      expect(v as number).toBeGreaterThanOrEqual(0);
      expect(v as number).toBeLessThanOrEqual(100);
    });
  });
  it('is 100 for a strictly rising series and 50 for a flat one', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
    expect(rsi([5, 5, 5, 5, 5], 3).at(-1)).toBe(50);
  });
});

describe('macd', () => {
  it('histogram = macd - signal wherever both exist', () => {
    const series = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 5 + i * 0.2);
    const { macd: line, signal, histogram } = macd(series);
    expect(line[24]).toBeNull();
    expect(line[25]).not.toBeNull();
    expect(signal[25 + 7]).toBeNull();
    expect(signal[25 + 8]).not.toBeNull();
    for (let i = 0; i < series.length; i++) {
      if (histogram[i] !== null) expect(histogram[i]).toBeCloseTo((line[i] as number) - (signal[i] as number));
    }
  });
});

describe('bollinger', () => {
  it('bands are symmetric around the SMA and collapse for a flat series', () => {
    const { upper, middle, lower } = bollinger(close, 20, 2);
    expect(middle[19]).toBeCloseTo(close.reduce((a, b) => a + b, 0) / 20);
    expect((upper[19] as number) - (middle[19] as number)).toBeCloseTo((middle[19] as number) - (lower[19] as number));
    const flat = bollinger(new Array(20).fill(10), 20, 2);
    expect(flat.upper[19]).toBe(10);
    expect(flat.lower[19]).toBe(10);
  });
});
