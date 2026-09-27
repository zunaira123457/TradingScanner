import { Candle } from '@/types';
import { MarketRegimeLabel, MarketRegimeResult, IndexRegimeScore } from '@/types/analysis';
import { sma } from '@/indicators/MovingAverages';
import { roc } from '@/indicators/Momentum';
import { historicalVolatility } from '@/indicators/Volatility';
import { determineTrend } from './MultiTimeframe';

export interface MarketRegimeOptions {
  momentumLookback?: number; // days for ROC, default 20
  drawdownLookback?: number; // days to look back for the recent high, default 60
  highVolatilityThreshold?: number; // annualized vol at/above this forces 'high_volatility', default 0.35
  strongThreshold?: number; // |compositeScore| at/above this is "strong", default 0.6
  neutralThreshold?: number; // |compositeScore| below this is "neutral", default 0.25
}

/**
 * Scores a single index (e.g. S&P 500) on three explicit, measurable axes:
 *   trend     (0.5 weight): SMA alignment via the shared determineTrend() rule
 *   momentum  (0.3 weight): N-day rate of change, normalized so a 10% move = full score
 *   drawdown  (0.2 weight): distance below the recent high, normalized so a
 *                           15%+ drawdown = maximum bearish contribution.
 *             Drawdown only ever pulls the score down — being at a high
 *             doesn't add bullish points beyond what trend/momentum already give.
 */
export function analyzeIndexRegime(
  candles: Candle[],
  ticker: string,
  options: MarketRegimeOptions = {}
): IndexRegimeScore {
  const { momentumLookback = 20, drawdownLookback = 60 } = options;

  const closes = candles.map((c) => c.close);
  const n = closes.length;

  const sma50Arr = sma(closes, 50);
  const sma200Arr = sma(closes, 200);
  const trend = determineTrend(closes, sma50Arr, sma200Arr);
  const trendScore = trend === 'bullish' ? 1 : trend === 'bearish' ? -1 : 0;

  const rocArr = roc(closes, momentumLookback);
  const rocValue = n > 0 ? rocArr[n - 1] : null;
  const momentumScore = rocValue === null ? 0 : Math.max(-1, Math.min(1, rocValue / 10));

  let drawdownPct = 0;
  if (n > 0) {
    const window = closes.slice(Math.max(0, n - drawdownLookback));
    const recentHigh = Math.max(...window);
    drawdownPct = recentHigh === 0 ? 0 : (closes[n - 1] - recentHigh) / recentHigh;
  }
  const drawdownContribution = Math.max(-1, Math.min(0, drawdownPct / 0.15));

  const hv20 = historicalVolatility(closes, 20);
  const annualizedVolatility = n > 0 ? hv20[n - 1] : null;

  const compositeScore = 0.5 * trendScore + 0.3 * momentumScore + 0.2 * drawdownContribution;

  return {
    ticker,
    trendScore,
    momentumScore,
    drawdownPct,
    annualizedVolatility,
    compositeScore,
  };
}

/**
 * Combines multiple index scores (equal-weighted average) into one market
 * regime classification. High volatility overrides the trend-based label
 * unconditionally — even a bullish market under extreme volatility warrants
 * more conservative strategy/risk behavior than a calm bullish market.
 */
export function classifyMarketRegime(
  indexCandles: Map<string, Candle[]>,
  options: MarketRegimeOptions = {}
): MarketRegimeResult {
  const { highVolatilityThreshold = 0.35, strongThreshold = 0.6, neutralThreshold = 0.25 } = options;

  const indexScores: IndexRegimeScore[] = [];
  for (const [ticker, candles] of indexCandles) {
    indexScores.push(analyzeIndexRegime(candles, ticker, options));
  }

  if (indexScores.length === 0) {
    return { label: 'neutral', compositeScore: 0, isHighVolatility: false, indexScores: [] };
  }

  const avgComposite =
    indexScores.reduce((sum, s) => sum + s.compositeScore, 0) / indexScores.length;

  const volValues = indexScores
    .map((s) => s.annualizedVolatility)
    .filter((v): v is number => v !== null);
  const avgVol = volValues.length > 0 ? volValues.reduce((a, b) => a + b, 0) / volValues.length : null;
  const isHighVolatility = avgVol !== null && avgVol >= highVolatilityThreshold;

  let label: MarketRegimeLabel;
  if (isHighVolatility) {
    label = 'high_volatility';
  } else if (avgComposite >= strongThreshold) {
    label = 'strong_bullish';
  } else if (avgComposite >= neutralThreshold) {
    label = 'bullish';
  } else if (avgComposite <= -strongThreshold) {
    label = 'strong_bearish';
  } else if (avgComposite <= -neutralThreshold) {
    label = 'bearish';
  } else {
    label = 'neutral';
  }

  return { label, compositeScore: avgComposite, isHighVolatility, indexScores };
}
