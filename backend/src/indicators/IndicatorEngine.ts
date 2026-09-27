import { Candle } from '@/types';
import { IndicatorSnapshot } from '@/types/indicators';
import { sma, ema } from './MovingAverages';
import { rsi, macd, stochastic, roc, adx } from './Momentum';
import { atr, bollingerBands, historicalVolatility } from './Volatility';
import { volumeSma, relativeVolume, obv, avgDollarVolume } from './Volume';

/**
 * The single shared source of technical indicators for the whole system.
 * Strategies, pattern detectors, and the backtester must all read from
 * these snapshots rather than recomputing indicators themselves — this
 * guarantees identical math everywhere and makes point-in-time access
 * (snapshot[i] uses only candles[0..i]) the default, which is what keeps
 * later backtesting free of look-ahead bias.
 */
export class IndicatorEngine {
  static calculateAll(candles: Candle[]): IndicatorSnapshot[] {
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);

    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const sma100 = sma(closes, 100);
    const sma200 = sma(closes, 200);
    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);

    const rsi14 = rsi(closes, 14);
    const { macdLine, signalLine, histogram } = macd(closes, 12, 26, 9);
    const { k: stochK, d: stochD } = stochastic(candles, 14, 3, 3);
    const roc12 = roc(closes, 12);
    const { adx: adx14, plusDI: plusDI14, minusDI: minusDI14 } = adx(candles, 14);

    const atr14 = atr(candles, 14);
    const { upper: bbUpper, middle: bbMiddle, lower: bbLower, width: bbWidth } = bollingerBands(
      closes,
      20,
      2
    );
    const hv20 = historicalVolatility(closes, 20);

    const volSma20 = volumeSma(volumes, 20);
    const relVol = relativeVolume(volumes, 20);
    const obvArr = obv(candles);
    const dollarVol30 = avgDollarVolume(candles, 30);

    return candles.map((candle, i) => ({
      date: candle.timestamp,
      close: candle.close,
      sma20: sma20[i],
      sma50: sma50[i],
      sma100: sma100[i],
      sma200: sma200[i],
      ema9: ema9[i],
      ema21: ema21[i],
      ema50: ema50[i],
      ema200: ema200[i],
      rsi14: rsi14[i],
      macd: macdLine[i],
      macdSignal: signalLine[i],
      macdHistogram: histogram[i],
      stochK: stochK[i],
      stochD: stochD[i],
      roc12: roc12[i],
      adx14: adx14[i],
      plusDI14: plusDI14[i],
      minusDI14: minusDI14[i],
      atr14: atr14[i],
      bbUpper: bbUpper[i],
      bbMiddle: bbMiddle[i],
      bbLower: bbLower[i],
      bbWidth: bbWidth[i],
      historicalVolatility20: hv20[i],
      volumeSma20: volSma20[i],
      relativeVolume: relVol[i],
      obv: obvArr[i],
      avgDollarVolume30: dollarVol30[i],
    }));
  }

  static latest(candles: Candle[]): IndicatorSnapshot | null {
    if (candles.length === 0) return null;
    const all = this.calculateAll(candles);
    return all[all.length - 1];
  }
}
