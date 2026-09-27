import { Candle } from '@/types';
import { IntradaySnapshot } from '@/types/intraday';
import { ema } from './MovingAverages';
import { rsi } from './Momentum';
import { atr } from './Volatility';
import { relativeVolume } from './Volume';
import { vwap } from './VWAP';

/**
 * Intraday counterpart to IndicatorEngine — same underlying pure functions
 * (timeframe-agnostic), but with periods tuned for 5-minute bars instead of
 * daily bars, plus session-anchored VWAP. relativeVolume's baseline is a
 * rolling 12-bar (1 hour of 5-min bars) window rather than 20 days.
 */
export class IntradayIndicatorEngine {
  static calculateAll(candles: Candle[]): IntradaySnapshot[] {
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);

    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const rsi14 = rsi(closes, 14);
    const atr14 = atr(candles, 14);
    const vwapValues = vwap(candles);
    const relVol = relativeVolume(volumes, 12);

    return candles.map((candle, i) => ({
      date: candle.timestamp,
      close: candle.close,
      ema9: ema9[i],
      ema21: ema21[i],
      rsi14: rsi14[i],
      atr14: atr14[i],
      vwap: vwapValues[i],
      relativeVolume: relVol[i],
    }));
  }

  static latest(candles: Candle[]): IntradaySnapshot | null {
    if (candles.length === 0) return null;
    const all = this.calculateAll(candles);
    return all[all.length - 1];
  }
}
