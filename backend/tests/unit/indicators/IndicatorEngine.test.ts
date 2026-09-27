import { IndicatorEngine } from '@/indicators/IndicatorEngine';
import { sma } from '@/indicators/MovingAverages';
import { Candle } from '@/types';

function makeCandles(n: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    // deterministic pseudo-random-ish walk so indicators have real variance
    price += Math.sin(i / 5) * 2 + 0.1;
    const open = price - 0.5;
    const close = price;
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;
    candles.push({
      timestamp: new Date(2020, 0, 1 + i),
      open,
      high,
      low,
      close,
      volume: 1000000 + (i % 10) * 50000,
    });
  }
  return candles;
}

describe('IndicatorEngine', () => {
  it('should return one snapshot per candle with matching date/close', () => {
    const candles = makeCandles(300);
    const snapshots = IndicatorEngine.calculateAll(candles);

    expect(snapshots.length).toBe(candles.length);
    snapshots.forEach((snap, i) => {
      expect(snap.date).toEqual(candles[i].timestamp);
      expect(snap.close).toBe(candles[i].close);
    });
  });

  it('should null-pad the warm-up period and populate once enough data exists', () => {
    const candles = makeCandles(300);
    const snapshots = IndicatorEngine.calculateAll(candles);

    // sma200 needs 200 data points
    expect(snapshots[198].sma200).toBeNull();
    expect(snapshots[199].sma200).not.toBeNull();

    // last snapshot should have every indicator populated with 300 candles
    const last = snapshots[299];
    expect(last.sma20).not.toBeNull();
    expect(last.sma200).not.toBeNull();
    expect(last.ema200).not.toBeNull();
    expect(last.rsi14).not.toBeNull();
    expect(last.macd).not.toBeNull();
    expect(last.stochK).not.toBeNull();
    expect(last.atr14).not.toBeNull();
    expect(last.bbUpper).not.toBeNull();
    expect(last.historicalVolatility20).not.toBeNull();
    expect(last.relativeVolume).not.toBeNull();
    expect(last.avgDollarVolume30).not.toBeNull();
  });

  it('should be wired correctly: sma20 in the engine matches the standalone sma() function', () => {
    const candles = makeCandles(60);
    const snapshots = IndicatorEngine.calculateAll(candles);
    const expectedSma20 = sma(
      candles.map((c) => c.close),
      20
    );

    snapshots.forEach((snap, i) => {
      if (expectedSma20[i] === null) {
        expect(snap.sma20).toBeNull();
      } else {
        expect(snap.sma20).toBeCloseTo(expectedSma20[i] as number, 8);
      }
    });
  });

  it('latest() should return the same as the last element of calculateAll()', () => {
    const candles = makeCandles(50);
    const all = IndicatorEngine.calculateAll(candles);
    const latest = IndicatorEngine.latest(candles);

    expect(latest).toEqual(all[all.length - 1]);
  });

  it('latest() should return null for an empty candle array', () => {
    expect(IndicatorEngine.latest([])).toBeNull();
  });

  it('point-in-time guarantee: snapshot at index i must be identical whether computed from a truncated or full series', () => {
    const candles = makeCandles(100);
    const fullSnapshots = IndicatorEngine.calculateAll(candles);
    const truncated = candles.slice(0, 60);
    const truncatedSnapshots = IndicatorEngine.calculateAll(truncated);

    // Index 59 must be identical in both — this is the core no-look-ahead property.
    expect(truncatedSnapshots[59]).toEqual(fullSnapshots[59]);
  });
});
