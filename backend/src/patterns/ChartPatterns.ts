import { Candle } from '@/types';
import { ChartPatternResult } from '@/types/chartPatterns';
import { StructureAnalysis } from '@/types/patterns';
import {
  detectBreakout,
  detectBreakdown,
  detectConsolidation,
  detectPullback,
  findSwingHighs,
  findSwingLows,
  findSupport,
  findResistance,
} from './PriceStructure';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ---------------------------------------------------------------------------
// 1. Breakout from consolidation
// Rule: the bars BEFORE today formed a tight consolidation range, AND today
// breaks above the resistance established by that range with volume support.
// ---------------------------------------------------------------------------
export interface BreakoutFromConsolidationOptions {
  consolidationLookback?: number;
  maxRangePct?: number;
  breakoutLookback?: number;
  volumeMultiplier?: number;
}

export function detectBreakoutFromConsolidation(
  candles: Candle[],
  relativeVolumeAtToday: number | null,
  options: BreakoutFromConsolidationOptions = {}
): ChartPatternResult {
  const {
    consolidationLookback = 15,
    maxRangePct = 0.08,
    breakoutLookback = 20,
    volumeMultiplier = 1.5,
  } = options;

  if (candles.length < 2) {
    return {
      pattern: 'breakout_from_consolidation',
      detected: false,
      confidence: 0,
      invalidationPrice: null,
      details: {},
    };
  }

  const priorCandles = candles.slice(0, candles.length - 1);
  const consolidation = detectConsolidation(priorCandles, {
    lookbackDays: consolidationLookback,
    maxRangePct,
  });
  const breakout = detectBreakout(candles, relativeVolumeAtToday, {
    lookbackDays: breakoutLookback,
    volumeMultiplier,
  });

  const detected = consolidation.detected && breakout.detected;
  const confidence = detected
    ? clamp01(0.5 * consolidation.confidence + 0.5 * breakout.confidence)
    : 0;

  return {
    pattern: 'breakout_from_consolidation',
    detected,
    confidence,
    invalidationPrice: breakout.invalidationPrice,
    details: {
      consolidationRangePct: consolidation.rangePct,
      resistance: breakout.resistance,
      breakoutPrice: breakout.breakoutPrice,
      breakoutPct: breakout.breakoutPct,
      volumeConfirmation: breakout.volumeConfirmation,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Breakout with (strict) volume confirmation
// Same mechanics as a plain breakout but with a materially higher relative
// volume bar — distinguishes a routine breakout from an institutionally
// significant one.
// ---------------------------------------------------------------------------
export interface BreakoutWithVolumeOptions {
  lookbackDays?: number;
  volumeMultiplier?: number;
}

export function detectBreakoutWithVolumeConfirmation(
  candles: Candle[],
  relativeVolumeAtToday: number | null,
  options: BreakoutWithVolumeOptions = {}
): ChartPatternResult {
  const { lookbackDays = 20, volumeMultiplier = 2.0 } = options;
  const breakout = detectBreakout(candles, relativeVolumeAtToday, { lookbackDays, volumeMultiplier });

  return {
    pattern: 'breakout_with_volume_confirmation',
    detected: breakout.detected,
    confidence: breakout.confidence,
    invalidationPrice: breakout.invalidationPrice,
    details: {
      resistance: breakout.resistance,
      breakoutPrice: breakout.breakoutPrice,
      breakoutPct: breakout.breakoutPct,
      relativeVolume: relativeVolumeAtToday,
      volumeConfirmation: breakout.volumeConfirmation,
    },
  };
}

// ---------------------------------------------------------------------------
// 3/4. Pullback to 20/21 EMA or 50 SMA
// ---------------------------------------------------------------------------
export interface PullbackToLevelOptions {
  maxDistancePct?: number;
}

export function detectPullbackToEma21(
  candles: Candle[],
  ema21: number | null,
  structure: StructureAnalysis,
  options: PullbackToLevelOptions = {}
): ChartPatternResult {
  const pullback = detectPullback(candles, ema21, null, structure, options);
  const detected = pullback.detected && pullback.pullbackToLevel === 'ema21';

  return {
    pattern: 'pullback_to_ema21',
    detected,
    confidence: detected ? pullback.confidence : 0,
    invalidationPrice: pullback.invalidationPrice,
    details: { distancePct: pullback.distancePct, trendIntact: pullback.trendIntact },
  };
}

export function detectPullbackToSma50(
  candles: Candle[],
  sma50: number | null,
  structure: StructureAnalysis,
  options: PullbackToLevelOptions = {}
): ChartPatternResult {
  const pullback = detectPullback(candles, null, sma50, structure, options);
  const detected = pullback.detected && pullback.pullbackToLevel === 'sma50';

  return {
    pattern: 'pullback_to_sma50',
    detected,
    confidence: detected ? pullback.confidence : 0,
    invalidationPrice: pullback.invalidationPrice,
    details: { distancePct: pullback.distancePct, trendIntact: pullback.trendIntact },
  };
}

// ---------------------------------------------------------------------------
// 5. Moving average reclaim
// Rule: yesterday's close was below the MA, today's close is above it.
// ---------------------------------------------------------------------------
export function detectMovingAverageReclaim(
  candles: Candle[],
  maValues: (number | null)[]
): ChartPatternResult {
  const n = candles.length;
  if (n < 2 || maValues[n - 1] === null || maValues[n - 2] === null) {
    return {
      pattern: 'moving_average_reclaim',
      detected: false,
      confidence: 0,
      invalidationPrice: null,
      details: {},
    };
  }

  const todayClose = candles[n - 1].close;
  const yesterdayClose = candles[n - 2].close;
  const todayMa = maValues[n - 1] as number;
  const yesterdayMa = maValues[n - 2] as number;

  const wasBelow = yesterdayClose < yesterdayMa;
  const nowAbove = todayClose > todayMa;
  const detected = wasBelow && nowAbove;

  const reclaimPct = detected ? (todayClose - todayMa) / todayMa : null;
  const confidence = detected ? clamp01((reclaimPct as number) / 0.02) : 0;

  return {
    pattern: 'moving_average_reclaim',
    detected,
    confidence,
    invalidationPrice: detected ? todayMa : null,
    details: { maValue: todayMa, reclaimPct },
  };
}

// ---------------------------------------------------------------------------
// 6. Moving average rejection
// Rule: today's high traded above the MA intraday, but the candle closed
// back below it — a failed test.
// ---------------------------------------------------------------------------
export function detectMovingAverageRejection(
  candles: Candle[],
  maValues: (number | null)[]
): ChartPatternResult {
  const n = candles.length;
  if (n < 1 || maValues[n - 1] === null) {
    return {
      pattern: 'moving_average_rejection',
      detected: false,
      confidence: 0,
      invalidationPrice: null,
      details: {},
    };
  }

  const today = candles[n - 1];
  const ma = maValues[n - 1] as number;

  const testedAbove = today.high > ma;
  const closedBelow = today.close < ma;
  const detected = testedAbove && closedBelow;

  const rejectionPct = detected ? (today.high - today.close) / today.high : null;
  const confidence = detected ? clamp01((rejectionPct as number) / 0.02) : 0;

  return {
    pattern: 'moving_average_rejection',
    detected,
    confidence,
    invalidationPrice: detected ? today.high : null,
    details: { maValue: ma, rejectionPct },
  };
}

// ---------------------------------------------------------------------------
// 7/8. Bull flag / bear flag
// Rule: a strong directional impulse over `impulseLookback` bars, followed
// by a tight `flagLookback`-bar consolidation that retraces no more than
// `maxRetracementPct` of the impulse, on declining volume.
// ---------------------------------------------------------------------------
export interface FlagOptions {
  impulseLookback?: number;
  flagLookback?: number;
  minImpulsePct?: number;
  maxFlagRangePct?: number;
  maxRetracementPct?: number;
}

export function detectBullFlag(candles: Candle[], options: FlagOptions = {}): ChartPatternResult {
  const {
    impulseLookback = 10,
    flagLookback = 5,
    minImpulsePct = 0.15,
    maxFlagRangePct = 0.1,
    maxRetracementPct = 0.5,
  } = options;

  const total = impulseLookback + flagLookback;
  if (candles.length < total) {
    return { pattern: 'bull_flag', detected: false, confidence: 0, invalidationPrice: null, details: {} };
  }

  const recent = candles.slice(candles.length - total);
  const impulseCandles = recent.slice(0, impulseLookback);
  const flagCandles = recent.slice(impulseLookback);

  const impulseStart = impulseCandles[0].low;
  const impulseHigh = Math.max(...impulseCandles.map((c) => c.high));
  const impulsePct = impulseStart === 0 ? 0 : (impulseHigh - impulseStart) / impulseStart;

  const flagHigh = Math.max(...flagCandles.map((c) => c.high));
  const flagLow = Math.min(...flagCandles.map((c) => c.low));
  const flagMid = (flagHigh + flagLow) / 2;
  const flagRangePct = flagMid === 0 ? 1 : (flagHigh - flagLow) / flagMid;

  const impulseRange = impulseHigh - impulseStart;
  const retracement = impulseRange === 0 ? 1 : (impulseHigh - flagLow) / impulseRange;

  const impulseAvgVolume = impulseCandles.reduce((s, c) => s + c.volume, 0) / impulseCandles.length;
  const flagAvgVolume = flagCandles.reduce((s, c) => s + c.volume, 0) / flagCandles.length;
  const volumeDryUp = flagAvgVolume < impulseAvgVolume;

  const detected =
    impulsePct >= minImpulsePct &&
    flagRangePct <= maxFlagRangePct &&
    retracement <= maxRetracementPct &&
    volumeDryUp;

  const confidence = detected
    ? clamp01(
        0.4 * clamp01(impulsePct / (minImpulsePct * 1.5)) +
          0.3 * clamp01(1 - flagRangePct / maxFlagRangePct) +
          0.3 * (volumeDryUp ? 1 : 0)
      )
    : 0;

  return {
    pattern: 'bull_flag',
    detected,
    confidence,
    invalidationPrice: detected ? flagLow : null,
    details: { impulsePct, flagRangePct, retracement, volumeDryUp, flagHigh, flagLow },
  };
}

export function detectBearFlag(candles: Candle[], options: FlagOptions = {}): ChartPatternResult {
  const {
    impulseLookback = 10,
    flagLookback = 5,
    minImpulsePct = 0.15,
    maxFlagRangePct = 0.1,
    maxRetracementPct = 0.5,
  } = options;

  const total = impulseLookback + flagLookback;
  if (candles.length < total) {
    return { pattern: 'bear_flag', detected: false, confidence: 0, invalidationPrice: null, details: {} };
  }

  const recent = candles.slice(candles.length - total);
  const impulseCandles = recent.slice(0, impulseLookback);
  const flagCandles = recent.slice(impulseLookback);

  const impulseStart = impulseCandles[0].high;
  const impulseLow = Math.min(...impulseCandles.map((c) => c.low));
  const impulsePct = impulseStart === 0 ? 0 : (impulseStart - impulseLow) / impulseStart;

  const flagHigh = Math.max(...flagCandles.map((c) => c.high));
  const flagLow = Math.min(...flagCandles.map((c) => c.low));
  const flagMid = (flagHigh + flagLow) / 2;
  const flagRangePct = flagMid === 0 ? 1 : (flagHigh - flagLow) / flagMid;

  const impulseRange = impulseStart - impulseLow;
  const retracement = impulseRange === 0 ? 1 : (flagHigh - impulseLow) / impulseRange;

  const impulseAvgVolume = impulseCandles.reduce((s, c) => s + c.volume, 0) / impulseCandles.length;
  const flagAvgVolume = flagCandles.reduce((s, c) => s + c.volume, 0) / flagCandles.length;
  const volumeDryUp = flagAvgVolume < impulseAvgVolume;

  const detected =
    impulsePct >= minImpulsePct &&
    flagRangePct <= maxFlagRangePct &&
    retracement <= maxRetracementPct &&
    volumeDryUp;

  const confidence = detected
    ? clamp01(
        0.4 * clamp01(impulsePct / (minImpulsePct * 1.5)) +
          0.3 * clamp01(1 - flagRangePct / maxFlagRangePct) +
          0.3 * (volumeDryUp ? 1 : 0)
      )
    : 0;

  return {
    pattern: 'bear_flag',
    detected,
    confidence,
    invalidationPrice: detected ? flagHigh : null,
    details: { impulsePct, flagRangePct, retracement, volumeDryUp, flagHigh, flagLow },
  };
}

// ---------------------------------------------------------------------------
// 9/10. Double bottom / double top
// Rule: two swing lows (highs) within `maxDeviationPct` of each other, with
// a swing high (low) "neckline" between them at least `minPeakPct` away.
// `detected` requires the neckline to be broken by today's close — an
// unconfirmed "W"/"M" shape is not yet a signal.
// ---------------------------------------------------------------------------
export interface DoubleFormationOptions {
  lookbackBars?: number;
  swingLookback?: number;
  maxDeviationPct?: number;
  minPeakPct?: number;
}

export function detectDoubleBottom(
  candles: Candle[],
  options: DoubleFormationOptions = {}
): ChartPatternResult {
  const { lookbackBars = 60, swingLookback = 3, maxDeviationPct = 0.03, minPeakPct = 0.05 } = options;

  const window = candles.slice(Math.max(0, candles.length - lookbackBars));
  const swingLows = findSwingLows(window, swingLookback);
  const swingHighs = findSwingHighs(window, swingLookback);

  if (swingLows.length < 2 || window.length === 0) {
    return { pattern: 'double_bottom', detected: false, confidence: 0, invalidationPrice: null, details: {} };
  }

  const l2 = swingLows[swingLows.length - 1];
  const l1 = swingLows[swingLows.length - 2];
  const deviation = l1.price === 0 ? 1 : Math.abs(l2.price - l1.price) / l1.price;
  const lowestLow = Math.min(l1.price, l2.price);

  const peak = swingHighs.find((h) => h.index > l1.index && h.index < l2.index);

  if (!peak || deviation > maxDeviationPct) {
    return {
      pattern: 'double_bottom',
      detected: false,
      confidence: 0,
      invalidationPrice: lowestLow,
      details: { l1: l1.price, l2: l2.price, deviation },
    };
  }

  const peakPct = lowestLow === 0 ? 0 : (peak.price - lowestLow) / lowestLow;
  const necklineBroken = window[window.length - 1].close > peak.price;
  const detected = peakPct >= minPeakPct && necklineBroken;

  const confidence = detected
    ? clamp01(
        0.4 * clamp01(1 - deviation / maxDeviationPct) + 0.3 * clamp01(peakPct / (minPeakPct * 2)) + 0.3
      )
    : 0;

  return {
    pattern: 'double_bottom',
    detected,
    confidence,
    invalidationPrice: lowestLow,
    details: {
      l1: l1.price,
      l2: l2.price,
      neckline: peak.price,
      deviation,
      peakPct,
      necklineBroken,
    },
  };
}

export function detectDoubleTop(
  candles: Candle[],
  options: DoubleFormationOptions = {}
): ChartPatternResult {
  const { lookbackBars = 60, swingLookback = 3, maxDeviationPct = 0.03, minPeakPct = 0.05 } = options;

  const window = candles.slice(Math.max(0, candles.length - lookbackBars));
  const swingHighs = findSwingHighs(window, swingLookback);
  const swingLows = findSwingLows(window, swingLookback);

  if (swingHighs.length < 2 || window.length === 0) {
    return { pattern: 'double_top', detected: false, confidence: 0, invalidationPrice: null, details: {} };
  }

  const h2 = swingHighs[swingHighs.length - 1];
  const h1 = swingHighs[swingHighs.length - 2];
  const deviation = h1.price === 0 ? 1 : Math.abs(h2.price - h1.price) / h1.price;
  const highestHigh = Math.max(h1.price, h2.price);

  const trough = swingLows.find((l) => l.index > h1.index && l.index < h2.index);

  if (!trough || deviation > maxDeviationPct) {
    return {
      pattern: 'double_top',
      detected: false,
      confidence: 0,
      invalidationPrice: highestHigh,
      details: { h1: h1.price, h2: h2.price, deviation },
    };
  }

  const troughPct = highestHigh === 0 ? 0 : (highestHigh - trough.price) / highestHigh;
  const necklineBroken = window[window.length - 1].close < trough.price;
  const detected = troughPct >= minPeakPct && necklineBroken;

  const confidence = detected
    ? clamp01(
        0.4 * clamp01(1 - deviation / maxDeviationPct) + 0.3 * clamp01(troughPct / (minPeakPct * 2)) + 0.3
      )
    : 0;

  return {
    pattern: 'double_top',
    detected,
    confidence,
    invalidationPrice: highestHigh,
    details: {
      h1: h1.price,
      h2: h2.price,
      neckline: trough.price,
      deviation,
      troughPct,
      necklineBroken,
    },
  };
}

// ---------------------------------------------------------------------------
// 11. Higher-low reversal
// Rule: the two most recent confirmed swing lows before the newest one were
// falling (L1 > L2, a downtrend), but the newest swing low L3 is higher than
// L2 — the first break in the sequence of lower lows. This is an early
// reversal WATCH signal, not yet a confirmed trend change.
// ---------------------------------------------------------------------------
export interface HigherLowReversalOptions {
  lookbackBars?: number;
  swingLookback?: number;
}

export function detectHigherLowReversal(
  candles: Candle[],
  options: HigherLowReversalOptions = {}
): ChartPatternResult {
  const { lookbackBars = 60, swingLookback = 3 } = options;

  const window = candles.slice(Math.max(0, candles.length - lookbackBars));
  const swingLows = findSwingLows(window, swingLookback);

  if (swingLows.length < 3) {
    return {
      pattern: 'higher_low_reversal',
      detected: false,
      confidence: 0,
      invalidationPrice: null,
      details: {},
    };
  }

  const [l1, l2, l3] = swingLows.slice(-3);
  const priorDowntrend = l2.price < l1.price;
  const higherLow = l3.price > l2.price;
  const detected = priorDowntrend && higherLow;

  const reversalPct = l2.price === 0 ? 0 : (l3.price - l2.price) / l2.price;
  const confidence = detected ? clamp01(reversalPct / 0.05) : 0;

  return {
    pattern: 'higher_low_reversal',
    detected,
    confidence,
    invalidationPrice: detected ? l2.price : null,
    details: { l1: l1.price, l2: l2.price, l3: l3.price, reversalPct },
  };
}

// ---------------------------------------------------------------------------
// 12. Volatility contraction
// Rule: current Bollinger Band width sits in the bottom `percentileThreshold`
// of its own range over `lookbackBars` — a volatility "squeeze" that often
// precedes an expansion move.
// ---------------------------------------------------------------------------
export interface VolatilityContractionOptions {
  lookbackBars?: number;
  percentileThreshold?: number;
}

export function detectVolatilityContraction(
  bbWidths: (number | null)[],
  options: VolatilityContractionOptions = {}
): ChartPatternResult {
  const { lookbackBars = 60, percentileThreshold = 0.25 } = options;

  const n = bbWidths.length;
  if (n === 0 || bbWidths[n - 1] === null) {
    return {
      pattern: 'volatility_contraction',
      detected: false,
      confidence: 0,
      invalidationPrice: null,
      details: {},
    };
  }

  const start = Math.max(0, n - lookbackBars);
  const window = bbWidths.slice(start, n).filter((w): w is number => w !== null);

  if (window.length < 10) {
    return {
      pattern: 'volatility_contraction',
      detected: false,
      confidence: 0,
      invalidationPrice: null,
      details: {},
    };
  }

  const currentWidth = bbWidths[n - 1] as number;
  const minWidth = Math.min(...window);
  const maxWidth = Math.max(...window);
  const range = maxWidth - minWidth;
  const percentile = range === 0 ? 0 : (currentWidth - minWidth) / range;

  const detected = percentile <= percentileThreshold;
  const confidence = detected ? clamp01(1 - percentile / percentileThreshold) : 0;

  return {
    pattern: 'volatility_contraction',
    detected,
    confidence,
    invalidationPrice: null,
    details: { currentWidth, minWidth, maxWidth, percentile },
  };
}

// ---------------------------------------------------------------------------
// 13/14. Support bounce / resistance rejection
// Rule: the day's low (high) comes within `proximityPct` of a support
// (resistance) level without closing through it, and the candle closes back
// in the direction of the bounce (bullish for support, bearish for resistance).
// ---------------------------------------------------------------------------
export interface LevelReactionOptions {
  lookbackDays?: number;
  proximityPct?: number;
}

export function detectSupportBounce(
  candles: Candle[],
  options: LevelReactionOptions = {}
): ChartPatternResult {
  const { lookbackDays = 20, proximityPct = 0.015 } = options;

  const support = findSupport(candles, lookbackDays);
  if (support === null || candles.length === 0) {
    return { pattern: 'support_bounce', detected: false, confidence: 0, invalidationPrice: null, details: {} };
  }

  const today = candles[candles.length - 1];
  const distanceToSupport = (today.low - support) / support;
  const touchedSupport =
    distanceToSupport <= proximityPct && today.low >= support * (1 - proximityPct * 2);
  const closedAbove = today.close > support;
  const bullishClose = today.close > today.open;
  const detected = touchedSupport && closedAbove && bullishClose;

  const dayRange = today.high - today.low || 1;
  const confidence = detected
    ? clamp01(
        0.5 * clamp01(1 - Math.abs(distanceToSupport) / proximityPct) +
          0.5 * clamp01((today.close - today.low) / dayRange)
      )
    : 0;

  return {
    pattern: 'support_bounce',
    detected,
    confidence,
    invalidationPrice: detected ? support * (1 - proximityPct * 2) : null,
    details: { support, low: today.low, close: today.close, distanceToSupport },
  };
}

export function detectResistanceRejection(
  candles: Candle[],
  options: LevelReactionOptions = {}
): ChartPatternResult {
  const { lookbackDays = 20, proximityPct = 0.015 } = options;

  const resistance = findResistance(candles, lookbackDays);
  if (resistance === null || candles.length === 0) {
    return {
      pattern: 'resistance_rejection',
      detected: false,
      confidence: 0,
      invalidationPrice: null,
      details: {},
    };
  }

  const today = candles[candles.length - 1];
  const distanceToResistance = (resistance - today.high) / resistance;
  const testedResistance =
    distanceToResistance <= proximityPct && today.high <= resistance * (1 + proximityPct * 2);
  const closedBelow = today.close < resistance;
  const bearishClose = today.close < today.open;
  const detected = testedResistance && closedBelow && bearishClose;

  const dayRange = today.high - today.low || 1;
  const confidence = detected
    ? clamp01(
        0.5 * clamp01(1 - Math.abs(distanceToResistance) / proximityPct) +
          0.5 * clamp01((today.high - today.close) / dayRange)
      )
    : 0;

  return {
    pattern: 'resistance_rejection',
    detected,
    confidence,
    invalidationPrice: detected ? resistance * (1 + proximityPct * 2) : null,
    details: { resistance, high: today.high, close: today.close, distanceToResistance },
  };
}
