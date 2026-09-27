import { Candle } from '@/types';
import {
  SwingPoint,
  StructureAnalysis,
  BreakoutResult,
  BreakdownResult,
  ConsolidationResult,
  GapResult,
  PullbackResult,
} from '@/types/patterns';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Swing highs/lows use a "fractal" definition: a bar is a swing high if its
 * high is strictly greater than every bar within `lookback` positions on
 * BOTH sides. This means a swing point can only be confirmed once
 * `lookback` bars have passed after it — it is inherently retrospective.
 *
 * IMPORTANT (no look-ahead): when using this for point-in-time analysis as
 * of day T, callers MUST pass `candles.slice(0, T + 1)` — never the full
 * dataset. Because confirmation requires future bars, no swing point within
 * the last `lookback` bars of whatever slice you pass in will ever appear,
 * which is exactly the correct, conservative behavior.
 */
export function findSwingHighs(candles: Candle[], lookback = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwingHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) {
      swings.push({ index: i, date: candles[i].timestamp, price: candles[i].high });
    }
  }
  return swings;
}

export function findSwingLows(candles: Candle[], lookback = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].low <= candles[i].low) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) {
      swings.push({ index: i, date: candles[i].timestamp, price: candles[i].low });
    }
  }
  return swings;
}

/**
 * Classifies trend structure from the two most recent swing highs and the
 * two most recent swing lows:
 *   uptrend   = higher high AND higher low
 *   downtrend = lower high AND lower low
 *   sideways  = anything else (mixed signals)
 */
export function classifyStructure(
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[]
): StructureAnalysis {
  const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : null;
  const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : null;

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return {
      trend: 'insufficient_data',
      lastSwingHigh,
      lastSwingLow,
      higherHigh: false,
      higherLow: false,
      lowerHigh: false,
      lowerLow: false,
    };
  }

  const prevHigh = swingHighs[swingHighs.length - 2];
  const prevLow = swingLows[swingLows.length - 2];

  const higherHigh = (lastSwingHigh as SwingPoint).price > prevHigh.price;
  const lowerHigh = (lastSwingHigh as SwingPoint).price < prevHigh.price;
  const higherLow = (lastSwingLow as SwingPoint).price > prevLow.price;
  const lowerLow = (lastSwingLow as SwingPoint).price < prevLow.price;

  let trend: StructureAnalysis['trend'] = 'sideways';
  if (higherHigh && higherLow) trend = 'uptrend';
  else if (lowerHigh && lowerLow) trend = 'downtrend';

  return { trend, lastSwingHigh, lastSwingLow, higherHigh, higherLow, lowerHigh, lowerLow };
}

/**
 * Resistance = highest high over the `lookbackDays` bars STRICTLY BEFORE the
 * last candle in the array. The last candle ("today") is always excluded so
 * that comparing today's price to this level is a valid breakout test.
 */
export function findResistance(candles: Candle[], lookbackDays = 20): number | null {
  if (candles.length < 2) return null;
  const end = candles.length - 1; // exclusive of "today"
  const start = Math.max(0, end - lookbackDays);
  const window = candles.slice(start, end);
  if (window.length === 0) return null;
  return Math.max(...window.map((c) => c.high));
}

/**
 * Support = lowest low over the `lookbackDays` bars STRICTLY BEFORE the last
 * candle in the array. See findResistance for the "today excluded" rationale.
 */
export function findSupport(candles: Candle[], lookbackDays = 20): number | null {
  if (candles.length < 2) return null;
  const end = candles.length - 1;
  const start = Math.max(0, end - lookbackDays);
  const window = candles.slice(start, end);
  if (window.length === 0) return null;
  return Math.min(...window.map((c) => c.low));
}

export interface BreakoutOptions {
  lookbackDays?: number;
  minBreakoutPct?: number; // required % above resistance, e.g. 0 = any close above counts
  volumeMultiplier?: number; // required relative volume, e.g. 1.5 = 150% of average
  stopBufferPct?: number; // invalidation buffer below resistance, e.g. 0.02 = 2%
}

/**
 * Breakout: today's close exceeds the resistance established by the prior
 * `lookbackDays` bars by at least `minBreakoutPct`, AND relative volume is
 * at or above `volumeMultiplier`. Both conditions are required for
 * `detected` — an unconfirmed price move without volume is not a breakout.
 */
export function detectBreakout(
  candles: Candle[],
  relativeVolumeAtToday: number | null,
  options: BreakoutOptions = {}
): BreakoutResult {
  const { lookbackDays = 20, minBreakoutPct = 0, volumeMultiplier = 1.5, stopBufferPct = 0.02 } =
    options;

  const resistance = findResistance(candles, lookbackDays);
  if (resistance === null || candles.length === 0) {
    return {
      pattern: 'breakout',
      detected: false,
      confidence: 0,
      resistance,
      breakoutPrice: null,
      breakoutPct: null,
      volumeConfirmation: false,
      invalidationPrice: null,
    };
  }

  const today = candles[candles.length - 1];
  const breakoutPct = (today.close - resistance) / resistance;
  const priceBreakout = today.close > resistance * (1 + minBreakoutPct);
  const volumeConfirmation =
    relativeVolumeAtToday !== null && relativeVolumeAtToday >= volumeMultiplier;
  const detected = priceBreakout && volumeConfirmation;

  const priceStrength = clamp01(breakoutPct / (minBreakoutPct + 0.02));
  const volumeStrength =
    relativeVolumeAtToday !== null ? clamp01(relativeVolumeAtToday / (volumeMultiplier * 1.5)) : 0;
  const confidence = detected ? clamp01(0.5 * priceStrength + 0.5 * volumeStrength) : 0;

  return {
    pattern: 'breakout',
    detected,
    confidence,
    resistance,
    breakoutPrice: today.close,
    breakoutPct,
    volumeConfirmation,
    invalidationPrice: detected ? resistance * (1 - stopBufferPct) : null,
  };
}

export interface BreakdownOptions {
  lookbackDays?: number;
  minBreakdownPct?: number;
  volumeMultiplier?: number;
  stopBufferPct?: number;
}

/**
 * Breakdown: symmetric to detectBreakout, using support instead of resistance.
 */
export function detectBreakdown(
  candles: Candle[],
  relativeVolumeAtToday: number | null,
  options: BreakdownOptions = {}
): BreakdownResult {
  const { lookbackDays = 20, minBreakdownPct = 0, volumeMultiplier = 1.5, stopBufferPct = 0.02 } =
    options;

  const support = findSupport(candles, lookbackDays);
  if (support === null || candles.length === 0) {
    return {
      pattern: 'breakdown',
      detected: false,
      confidence: 0,
      support,
      breakdownPrice: null,
      breakdownPct: null,
      volumeConfirmation: false,
      invalidationPrice: null,
    };
  }

  const today = candles[candles.length - 1];
  const breakdownPct = (support - today.close) / support;
  const priceBreakdown = today.close < support * (1 - minBreakdownPct);
  const volumeConfirmation =
    relativeVolumeAtToday !== null && relativeVolumeAtToday >= volumeMultiplier;
  const detected = priceBreakdown && volumeConfirmation;

  const priceStrength = clamp01(breakdownPct / (minBreakdownPct + 0.02));
  const volumeStrength =
    relativeVolumeAtToday !== null ? clamp01(relativeVolumeAtToday / (volumeMultiplier * 1.5)) : 0;
  const confidence = detected ? clamp01(0.5 * priceStrength + 0.5 * volumeStrength) : 0;

  return {
    pattern: 'breakdown',
    detected,
    confidence,
    support,
    breakdownPrice: today.close,
    breakdownPct,
    volumeConfirmation,
    invalidationPrice: detected ? support * (1 + stopBufferPct) : null,
  };
}

export interface ConsolidationOptions {
  lookbackDays?: number;
  maxRangePct?: number; // high-low range as % of midpoint; below this counts as consolidation
}

/**
 * Consolidation: the high-low range over the last `lookbackDays` bars,
 * expressed as a percentage of the range midpoint, is at or below
 * `maxRangePct`. Confidence increases the tighter the range is relative to
 * the threshold.
 */
export function detectConsolidation(
  candles: Candle[],
  options: ConsolidationOptions = {}
): ConsolidationResult {
  const { lookbackDays = 20, maxRangePct = 0.08 } = options;

  if (candles.length < lookbackDays) {
    return {
      pattern: 'consolidation',
      detected: false,
      confidence: 0,
      rangeHigh: null,
      rangeLow: null,
      rangePct: null,
      days: 0,
    };
  }

  const window = candles.slice(candles.length - lookbackDays);
  const rangeHigh = Math.max(...window.map((c) => c.high));
  const rangeLow = Math.min(...window.map((c) => c.low));
  const mid = (rangeHigh + rangeLow) / 2;
  const rangePct = mid === 0 ? null : (rangeHigh - rangeLow) / mid;
  const detected = rangePct !== null && rangePct <= maxRangePct;
  const confidence = rangePct === null ? 0 : clamp01(1 - rangePct / maxRangePct);

  return {
    pattern: 'consolidation',
    detected,
    confidence,
    rangeHigh,
    rangeLow,
    rangePct,
    days: lookbackDays,
  };
}

export interface GapOptions {
  thresholdPct?: number;
}

/**
 * Gap: today's open vs. yesterday's close, as a percentage move.
 */
export function detectGap(candles: Candle[], options: GapOptions = {}): GapResult {
  const { thresholdPct = 0.02 } = options;
  if (candles.length < 2) return { type: 'none', gapPct: 0 };

  const today = candles[candles.length - 1];
  const prevClose = candles[candles.length - 2].close;
  const gapPct = (today.open - prevClose) / prevClose;

  if (gapPct >= thresholdPct) return { type: 'gap_up', gapPct };
  if (gapPct <= -thresholdPct) return { type: 'gap_down', gapPct };
  return { type: 'none', gapPct };
}

export interface PullbackOptions {
  maxDistancePct?: number; // max distance from MA to still count as "at" it
}

/**
 * Pullback: price is within `maxDistancePct` of EMA21 (checked first) or
 * SMA50, the structure is an established uptrend, and price has not broken
 * below the most recent confirmed swing low (which would invalidate the
 * pullback as a "healthy" one).
 */
export function detectPullback(
  candles: Candle[],
  ema21: number | null,
  sma50: number | null,
  structure: StructureAnalysis,
  options: PullbackOptions = {}
): PullbackResult {
  const { maxDistancePct = 0.02 } = options;

  if (candles.length === 0) {
    return {
      pattern: 'pullback',
      detected: false,
      confidence: 0,
      pullbackToLevel: null,
      distancePct: null,
      trendIntact: false,
      invalidationPrice: null,
    };
  }

  const today = candles[candles.length - 1];
  const trendIntact = structure.trend === 'uptrend';

  let pullbackToLevel: 'ema21' | 'sma50' | null = null;
  let distancePct: number | null = null;

  if (ema21 !== null) {
    const dist = Math.abs(today.close - ema21) / ema21;
    if (dist <= maxDistancePct) {
      pullbackToLevel = 'ema21';
      distancePct = dist;
    }
  }
  if (pullbackToLevel === null && sma50 !== null) {
    const dist = Math.abs(today.close - sma50) / sma50;
    if (dist <= maxDistancePct) {
      pullbackToLevel = 'sma50';
      distancePct = dist;
    }
  }

  const structureIntact =
    structure.lastSwingLow === null || today.close > structure.lastSwingLow.price;

  const detected = trendIntact && pullbackToLevel !== null && structureIntact;
  const confidence = detected ? clamp01(1 - (distancePct as number) / maxDistancePct) : 0;
  const invalidationPrice = structure.lastSwingLow ? structure.lastSwingLow.price : null;

  return {
    pattern: 'pullback',
    detected,
    confidence,
    pullbackToLevel,
    distancePct,
    trendIntact,
    invalidationPrice,
  };
}

/**
 * Trend continuation: the established trend direction is intact and the
 * most recent candle has not violated the last confirmed counter-swing
 * (a higher low in an uptrend, or a lower high in a downtrend).
 */
export function detectTrendContinuation(structure: StructureAnalysis, candles: Candle[]): boolean {
  if (candles.length === 0) return false;
  const today = candles[candles.length - 1];

  if (structure.trend === 'uptrend' && structure.lastSwingLow) {
    return today.close > structure.lastSwingLow.price;
  }
  if (structure.trend === 'downtrend' && structure.lastSwingHigh) {
    return today.close < structure.lastSwingHigh.price;
  }
  return false;
}
