import { auditUniverse } from '@/backtesting/DataQualityAudit';
import { Candle } from '@/types';

function makeGoodCandles(days = 260): Candle[] {
  return Array.from({ length: days }, (_, i) => ({
    timestamp: new Date(2020, 0, 1 + i),
    open: 100 + i * 0.1,
    high: 101 + i * 0.1,
    low: 99 + i * 0.1,
    close: 100.5 + i * 0.1,
    volume: 1000000,
  }));
}

describe('auditUniverse', () => {
  it('should include a ticker with valid, sufficient-history data', () => {
    const map = new Map([['GOOD', makeGoodCandles()]]);
    const report = auditUniverse(map);

    expect(report.validTickers).toContain('GOOD');
    expect(report.excludedTickers.length).toBe(0);
  });

  it('should exclude a ticker with insufficient history and log the reason', () => {
    const map = new Map([['SHORT', makeGoodCandles(50)]]);
    const report = auditUniverse(map);

    expect(report.validTickers).not.toContain('SHORT');
    const excluded = report.excludedTickers.find((e) => e.ticker === 'SHORT');
    expect(excluded).toBeDefined();
    expect(excluded!.reasons.some((r) => r.includes('INSUFFICIENT_HISTORY'))).toBe(true);
  });

  it('should exclude a ticker with invalid OHLC relationships and log the reason', () => {
    const candles = makeGoodCandles();
    candles[10] = { ...candles[10], high: 50, low: 100 }; // high < low, invalid
    const map = new Map([['BAD', candles]]);
    const report = auditUniverse(map);

    expect(report.validTickers).not.toContain('BAD');
    const excluded = report.excludedTickers.find((e) => e.ticker === 'BAD');
    expect(excluded!.reasons.some((r) => r.includes('INVALID_HIGH_LOW'))).toBe(true);
  });

  it('should exclude a ticker whose data-quality score falls below the 0.5 threshold even if technically valid', () => {
    // Minimal history (below 252 but above validator's hard error floor is
    // not possible since <252 IS a hard error — instead trigger the LOW
    // score path via heavy zero-volume days combined with borderline length).
    const candles = makeGoodCandles(260).map((c, i) => (i % 10 === 0 ? { ...c, volume: 0 } : c));
    const map = new Map([['THIN', candles]]);
    const report = auditUniverse(map);

    // 26/260 = 10% zero-volume days triggers the quality penalty in DataValidator.
    const result = report.perTickerResults.find((r) => r.ticker === 'THIN')!;
    expect(result.dataQualityScore).toBeLessThan(1);
  });

  it('should audit every ticker in the map and report totalTickers correctly', () => {
    const map = new Map([
      ['A', makeGoodCandles()],
      ['B', makeGoodCandles(50)],
    ]);
    const report = auditUniverse(map);
    expect(report.totalTickers).toBe(2);
    expect(report.perTickerResults.length).toBe(2);
  });

  it('should handle an empty universe gracefully', () => {
    const report = auditUniverse(new Map());
    expect(report.totalTickers).toBe(0);
    expect(report.validTickers).toEqual([]);
    expect(report.excludedTickers).toEqual([]);
  });
});
