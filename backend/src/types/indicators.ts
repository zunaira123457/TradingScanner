/**
 * A single point-in-time indicator snapshot.
 * snapshot[i] must only be derived from candles[0..i] — never from future data.
 * This is what makes it safe to reuse across live scanning AND backtesting.
 */
export interface IndicatorSnapshot {
  date: Date;
  close: number;

  // Moving averages
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;

  // Momentum
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochK: number | null;
  stochD: number | null;
  roc12: number | null;
  adx14: number | null;
  plusDI14: number | null;
  minusDI14: number | null;

  // Volatility
  atr14: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  historicalVolatility20: number | null;

  // Volume
  volumeSma20: number | null;
  relativeVolume: number | null;
  obv: number | null;
  avgDollarVolume30: number | null;
}
