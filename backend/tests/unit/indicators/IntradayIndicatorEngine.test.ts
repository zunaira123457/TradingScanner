import { IntradayIndicatorEngine } from '@/indicators/IntradayIndicatorEngine';
import { makeIntradaySessionCandles } from '../strategies/intraday/fixtures';

describe('IntradayIndicatorEngine', () => {
  it('should return one snapshot per candle with matching date/close', () => {
    const candles = makeIntradaySessionCandles('2024-01-17', 40);
    const snapshots = IntradayIndicatorEngine.calculateAll(candles);

    expect(snapshots.length).toBe(candles.length);
    snapshots.forEach((snap, i) => {
      expect(snap.date).toEqual(candles[i].timestamp);
      expect(snap.close).toBe(candles[i].close);
    });
  });

  it('should null-pad the warm-up period for ema21/rsi14/atr14 and populate once enough bars exist', () => {
    const candles = makeIntradaySessionCandles('2024-01-17', 40);
    const snapshots = IntradayIndicatorEngine.calculateAll(candles);

    expect(snapshots[0].ema21).toBeNull();
    expect(snapshots[0].rsi14).toBeNull();
    expect(snapshots[0].atr14).toBeNull();

    const last = snapshots[snapshots.length - 1];
    expect(last.ema21).not.toBeNull();
    expect(last.rsi14).not.toBeNull();
    expect(last.atr14).not.toBeNull();
    expect(last.vwap).not.toBeNull();
  });

  it('should compute relativeVolume against a 12-bar rolling baseline, not a 20-day one', () => {
    const calm = makeIntradaySessionCandles('2024-01-17', 20, { volume: 100000 });
    const spike = { ...calm[calm.length - 1], volume: 500000 };
    const candles = [...calm.slice(0, -1), spike];

    const snap = IntradayIndicatorEngine.latest(candles);
    expect(snap?.relativeVolume).not.toBeNull();
    expect(snap?.relativeVolume as number).toBeCloseTo(5, 1);
  });

  it('latest() should return null for an empty candle array', () => {
    expect(IntradayIndicatorEngine.latest([])).toBeNull();
  });
});
