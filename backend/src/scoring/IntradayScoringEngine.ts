import { IntradayContext, latestIntradaySnapshot } from '@/types/intraday';
import { StrategyResult } from '@/types/strategy';
import { ScoringWeights, ScoreBreakdown } from '@/types/scoring';
import { DEFAULT_SCORING_WEIGHTS, validateWeights, chartSetupComponent, riskRewardComponent } from './ScoringEngine';
import { tradingDayKey } from '@/indicators/VWAP';
import { clamp01 } from '@/utils/mathUtils';

/**
 * SPY's IntradayContext for the current cycle, shared across every ticker
 * being scored this cycle rather than rebuilt per-ticker. Null when SPY
 * data could not be fetched — every component that depends on it degrades
 * to a neutral 0.5 score rather than failing the whole scan.
 */
export interface IntradayMarketContext {
  spy: IntradayContext | null;
}

/** Today's session open (first bar's open) to latest close, as a fraction. */
export function intradaySessionPctChange(context: IntradayContext): number | null {
  if (context.candles.length === 0) return null;
  const todayKey = tradingDayKey(context.candles[context.candles.length - 1].timestamp);
  const todaysBars = context.candles.filter((c) => tradingDayKey(c.timestamp) === todayKey);
  if (todaysBars.length === 0) return null;
  const sessionOpen = todaysBars[0].open;
  const latestClose = todaysBars[todaysBars.length - 1].close;
  return sessionOpen === 0 ? null : (latestClose - sessionOpen) / sessionOpen;
}

/**
 * Trend component (0-1): short-term EMA alignment (EMA9 > EMA21) blended
 * with position relative to VWAP — the two most common intraday trend
 * reads, in place of daily's weekly/daily multi-timeframe alignment.
 */
function trendComponent(context: IntradayContext): number {
  const snap = latestIntradaySnapshot(context);
  if (snap.ema9 === null || snap.ema21 === null || snap.vwap === null) return 0.5;
  const emaAligned = snap.ema9 > snap.ema21 ? 1 : 0;
  const aboveVwap = snap.close > snap.vwap ? 1 : 0;
  return clamp01(0.5 * emaAligned + 0.5 * aboveVwap);
}

/** Momentum component (0-1): RSI normalized linearly over [30,70]. */
function momentumComponent(context: IntradayContext): number {
  const snap = latestIntradaySnapshot(context);
  return snap.rsi14 === null ? 0.5 : clamp01((snap.rsi14 - 30) / 40);
}

/**
 * Volume component (0-1): relative volume normalized so 3x the rolling
 * baseline maps to a full score — intraday spikes run hotter than the
 * daily pipeline's 2x reference.
 */
function volumeComponent(context: IntradayContext): number {
  const snap = latestIntradaySnapshot(context);
  return snap.relativeVolume === null ? 0.5 : clamp01(snap.relativeVolume / 3.0);
}

/**
 * Relative strength component (0-1): the ticker's session %-change minus
 * SPY's session %-change, mapped onto 0-1 with a +/-4% relative edge
 * spanning the full range — the intraday analog of the daily pipeline's
 * sector/benchmark outperformance read.
 */
function relativeStrengthComponent(context: IntradayContext, market: IntradayMarketContext): number {
  if (market.spy === null) return 0.5;
  const tickerPct = intradaySessionPctChange(context);
  const spyPct = intradaySessionPctChange(market.spy);
  if (tickerPct === null || spyPct === null) return 0.5;
  return clamp01(0.5 + (tickerPct - spyPct) / 0.04);
}

/**
 * Market regime component (0-1): SPY's own session %-change so far today,
 * standing in for daily's index-based regime classification — a bullish
 * broad tape lifts every setup's score slightly, a bearish one dampens it.
 */
function marketRegimeComponent(market: IntradayMarketContext): number {
  if (market.spy === null) return 0.5;
  const spyPct = intradaySessionPctChange(market.spy);
  if (spyPct === null) return 0.5;
  if (spyPct >= 0.01) return 1.0;
  if (spyPct >= 0.003) return 0.75;
  if (spyPct > -0.003) return 0.5;
  if (spyPct > -0.01) return 0.25;
  return 0.0;
}

/**
 * Computes the transparent 0-100 intraday score, reusing the same 7-category
 * ScoreBreakdown shape as the daily pipeline (see ScoringEngine.ts) with an
 * intraday-appropriate read for each category — so classifySignal and every
 * downstream consumer of ScoreBreakdown/SignalExplanation work unchanged.
 */
export function calculateIntradayScore(
  context: IntradayContext,
  market: IntradayMarketContext,
  strategyResult: StrategyResult,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS
): ScoreBreakdown {
  validateWeights(weights);

  if (!strategyResult.setupDetected) {
    return { trend: 0, momentum: 0, volume: 0, relativeStrength: 0, chartSetup: 0, marketRegime: 0, riskReward: 0, total: 0 };
  }

  const trend = trendComponent(context) * weights.trend * 100;
  const momentum = momentumComponent(context) * weights.momentum * 100;
  const volume = volumeComponent(context) * weights.volume * 100;
  const relativeStrength = relativeStrengthComponent(context, market) * weights.relativeStrength * 100;
  const chartSetup = chartSetupComponent(strategyResult) * weights.chartSetup * 100;
  const marketRegime = marketRegimeComponent(market) * weights.marketRegime * 100;
  const riskReward = riskRewardComponent(strategyResult) * weights.riskReward * 100;

  const total = trend + momentum + volume + relativeStrength + chartSetup + marketRegime + riskReward;

  return { trend, momentum, volume, relativeStrength, chartSetup, marketRegime, riskReward, total };
}
