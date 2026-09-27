import { Candle } from '@/types';
import { ExitReason } from '@/types/backtest';

/**
 * Slippage/commission on entry: a buy always fills WORSE (higher) than the
 * intended price.
 */
export function applyEntrySlippage(intendedPrice: number, slippageBps: number): number {
  return intendedPrice * (1 + slippageBps / 10000);
}

/**
 * Slippage on exit: a sell always fills WORSE (lower) than the intended
 * price.
 */
export function applyExitSlippage(intendedPrice: number, slippageBps: number): number {
  return intendedPrice * (1 - slippageBps / 10000);
}

export function calculateCommission(notional: number, commissionBps: number): number {
  return notional * (commissionBps / 10000);
}

export interface ExitCheckResult {
  exited: boolean;
  reason: ExitReason | null;
  price: number | null;
}

/**
 * Determines whether an open position's stop or target was hit on `candle`,
 * and at what price.
 *
 * DOCUMENTED ASSUMPTION (no intraday data available): if a single candle's
 * range could have hit BOTH the stop and the target — i.e. low <= stop AND
 * high >= target — the true intrabar sequence is unknowable from daily
 * OHLC alone. This engine always resolves that ambiguity in the trader's
 * WORST favor: the stop is treated as triggering first. This is a
 * deliberately conservative choice so the backtest cannot overstate
 * performance by silently assuming favorable fills; it will understate
 * performance in the (comparatively rare) cases where the target was
 * actually touched first intraday.
 *
 * Gap handling: a stop-loss is modeled as a stop-market order, so if the
 * candle's open already gapped through the stop, the fill is the open price
 * (worse than the stated stop). A target is modeled as a limit order, so it
 * always fills at exactly the target price once touched, even on a gap
 * through it — a limit order cannot fill worse than its limit price.
 */
export function checkExit(candle: Candle, stopPrice: number, targetPrice: number): ExitCheckResult {
  const stopHit = candle.low <= stopPrice;
  const targetHit = candle.high >= targetPrice;

  if (stopHit) {
    const fillPrice = candle.open < stopPrice ? candle.open : stopPrice;
    return { exited: true, reason: 'stop', price: fillPrice };
  }

  if (targetHit) {
    return { exited: true, reason: 'target', price: targetPrice };
  }

  return { exited: false, reason: null, price: null };
}
