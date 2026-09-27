import { IBKRClient } from './IBKRClient';
import { SignalExplanation } from '@/types/scoring';
import { calculatePositionSize } from '@/backtesting/PositionSizing';
import { BracketOrderIds } from './IBKRTypes';
import logger from '@/utils/logger';

export interface OrderExecutorConfig {
  accountEquity: number;
  maxRiskPerTradePct: number; // fraction, e.g. 0.0025 for 0.25%
  maxPositionValueUsd: number; // hard notional cap per trade, regardless of stop distance
  /**
   * When set, the stop-loss leg trails price by this percent instead of
   * sitting at a fixed stop price — used by the day-trading pipeline so
   * profit locks in as a trade moves favorably; swing/paper-trading callers
   * leave this unset for a fixed stop.
   */
  trailingStopPercent?: number;
}

/**
 * Converts a scored, ranked signal (already produced by the existing
 * StrategyEngine + ScoringEngine + SignalExplainer pipeline) into an IBKR
 * bracket order. Position size uses the same risk-based formula as the
 * backtesting engine (src/backtesting/PositionSizing.ts) so paper trading
 * position sizing is consistent with what was backtested.
 *
 * The risk-based formula alone can produce very large positions when a
 * signal's stop distance is tight relative to price (e.g. a $1.19 stop on a
 * $28 stock against a large account risked a $239K position on one trade
 * during initial testing) — maxPositionValueUsd caps notional exposure per
 * trade independent of stop distance, so a single signal can never consume
 * an outsized share of the account.
 *
 * This does not decide WHICH signals to trade — that's the caller's job
 * (typically: only BUY-classified signals). It only turns one already-
 * decided signal into an order.
 */
export class OrderExecutor {
  constructor(
    private client: IBKRClient,
    private config: OrderExecutorConfig
  ) {}

  async executeSignal(signal: SignalExplanation): Promise<(BracketOrderIds & { quantity: number }) | null> {
    if (signal.entry === null || signal.stop === null || signal.target === null) {
      logger.warn(`${signal.ticker} (${signal.strategy}): missing entry/stop/target, skipping order`);
      return null;
    }

    const riskBasedQuantity = calculatePositionSize(
      this.config.accountEquity,
      signal.entry,
      signal.stop,
      this.config.maxRiskPerTradePct,
      false
    );

    const notionalCapQuantity = Math.floor(this.config.maxPositionValueUsd / signal.entry);
    const quantity = Math.min(riskBasedQuantity, notionalCapQuantity);

    if (quantity <= 0) {
      logger.warn(
        `${signal.ticker} (${signal.strategy}): computed position size is 0 (equity=$${this.config.accountEquity}, ` +
          `entry=$${signal.entry}, stop=$${signal.stop}) — skipping order`
      );
      return null;
    }

    if (notionalCapQuantity < riskBasedQuantity) {
      logger.info(
        `${signal.ticker}: risk-based size (${riskBasedQuantity} shares) capped to ${quantity} shares by ` +
          `maxPositionValueUsd ($${this.config.maxPositionValueUsd})`
      );
    }

    const ids = await this.client.placeBracketOrder({
      ticker: signal.ticker,
      action: 'BUY',
      quantity,
      entryLimitPrice: signal.entry,
      stopLossPrice: signal.stop,
      takeProfitPrice: signal.target,
      trailingPercent: this.config.trailingStopPercent,
    });
    return { ...ids, quantity };
  }
}
