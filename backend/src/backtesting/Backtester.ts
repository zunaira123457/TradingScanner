import { Candle } from '@/types';
import { Trade, BacktestConfig, BacktestResult, BacktestUniverse, PortfolioSnapshot } from '@/types/backtest';
import { ScoringWeights, ClassificationThresholds } from '@/types/scoring';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { Strategy } from '@/types/strategy';
import { calculateScore, classifySignal, DEFAULT_SCORING_WEIGHTS, DEFAULT_CLASSIFICATION_THRESHOLDS } from '@/scoring/ScoringEngine';
import { Portfolio } from './Portfolio';
import { checkExit } from './Execution';
import { calculatePositionSize } from './PositionSizing';
import { calculateAllMetrics } from './Metrics';
import { validateAlignedCalendars } from './TradingCalendar';

export interface BacktesterOptions {
  scoringWeights?: ScoringWeights;
  classificationThresholds?: ClassificationThresholds;
}

interface PendingEntry {
  ticker: string;
  strategy: string;
  signalDate: Date;
  referenceEntry: number; // the strategy's own "today's close" reference price
  riskDistance: number; // referenceEntry - referenceStop, preserved through to the real fill
  rewardDistance: number; // referenceTarget - referenceEntry, preserved through to the real fill
  signalScore: number;
  marketRegimeAtEntry: string | null;
}

/**
 * Event-driven backtesting engine.
 *
 * NO-LOOK-AHEAD DESIGN (the whole point of this phase):
 *   - Every strategy evaluation at simulated day t uses
 *     buildStrategyContext(ticker, fullCandles, { asOfIndex: t, ... }) —
 *     the SAME point-in-time-safe builder Phase 3 already proved correct.
 *     Auxiliary data (index/benchmark/sector candles) is explicitly sliced
 *     to `.slice(0, t + 1)` here, because buildStrategyContext does not
 *     auto-slice those (documented in Phase 3) — this is the single
 *     highest-risk spot for a look-ahead bug in this whole engine, and it
 *     has dedicated tests (see Backtester.test.ts).
 *   - A signal detected using day t's close is never executed on day t.
 *     It is queued and filled at day t+1's OPEN (plus slippage) — you
 *     cannot realistically act on a closing price until the next session.
 *   - Stop/target levels are recalculated relative to the ACTUAL fill
 *     price (riskDistance/rewardDistance from the signal are preserved,
 *     but re-anchored to the real entry), since the strategy's original
 *     reference price was yesterday's close, not today's fill.
 */
export class Backtester {
  private options: Required<BacktesterOptions>;

  constructor(options: BacktesterOptions = {}) {
    this.options = {
      scoringWeights: options.scoringWeights ?? DEFAULT_SCORING_WEIGHTS,
      classificationThresholds: options.classificationThresholds ?? DEFAULT_CLASSIFICATION_THRESHOLDS,
    };
  }

  run(
    strategy: Strategy,
    universe: BacktestUniverse,
    config: BacktestConfig,
    startIndex: number,
    endIndex: number
  ): BacktestResult {
    const calendars = new Map<string, Candle[]>(universe.tickers);
    if (universe.benchmarkCandles) calendars.set('__benchmark__', universe.benchmarkCandles);
    if (universe.indexCandles) {
      for (const [k, v] of universe.indexCandles) calendars.set(`__index_${k}__`, v);
    }
    validateAlignedCalendars(calendars);

    const portfolio = new Portfolio(config.startingCapital);
    const equityCurve: PortfolioSnapshot[] = [];
    const closedTrades: Trade[] = [];
    let pendingEntries = new Map<string, PendingEntry>();

    const startDate = this.dateAt(universe, startIndex);
    const endDate = this.dateAt(universe, endIndex);

    for (let t = startIndex; t <= endIndex; t++) {
      // --- Step A: execute entries queued from yesterday's signals, at today's open ---
      const nextPending = new Map<string, PendingEntry>();
      for (const [ticker, pending] of pendingEntries) {
        const candles = universe.tickers.get(ticker);
        if (!candles || t >= candles.length) continue;

        const today = candles[t];
        const latestPrices = this.latestPricesAt(universe, t);

        const intendedEntry = today.open;
        const intendedStop = intendedEntry - pending.riskDistance;
        const intendedTarget = intendedEntry + pending.rewardDistance;

        const estimatedShares = calculatePositionSize(
          portfolio.getEquity(latestPrices),
          intendedEntry,
          intendedStop,
          config.maxRiskPerTradePct,
          config.fractionalShares
        );
        if (estimatedShares <= 0) continue;

        const estimatedCost = estimatedShares * intendedEntry * (1 + config.slippageBps / 10000);
        if (!portfolio.canOpenPosition(ticker, estimatedCost, config, latestPrices)) continue;

        portfolio.openPosition({
          ticker,
          strategy: pending.strategy,
          signalDate: pending.signalDate,
          entryDate: today.timestamp,
          intendedEntryPrice: intendedEntry,
          shares: estimatedShares,
          stopPrice: intendedStop,
          targetPrice: intendedTarget,
          signalScore: pending.signalScore,
          marketRegimeAtEntry: pending.marketRegimeAtEntry,
          slippageBps: config.slippageBps,
          commissionBps: config.commissionBps,
        });
      }
      pendingEntries = nextPending; // cleared for this iteration; step C below repopulates for tomorrow

      // --- Step B: check exits for open positions using today's candle ---
      for (const ticker of [...portfolio.openPositions.keys()]) {
        const candles = universe.tickers.get(ticker);
        if (!candles || t >= candles.length) continue;

        const position = portfolio.openPositions.get(ticker);
        if (!position) continue;

        // A position opened at today's open CAN legitimately stop/target out
        // the same day — today's high/low is fully realized data, not a
        // look-ahead, so there is no reason to suppress this check.
        const exitCheck = checkExit(candles[t], position.stopPrice, position.targetPrice);
        if (exitCheck.exited && exitCheck.price !== null && exitCheck.reason) {
          const trade = portfolio.closePosition(
            ticker,
            exitCheck.price,
            candles[t].timestamp,
            exitCheck.reason,
            config.slippageBps,
            config.commissionBps
          );
          closedTrades.push(trade);
        }
      }

      // --- Step C: evaluate new signals as of today (close), queue for tomorrow's open ---
      if (t < endIndex) {
        for (const [ticker, candles] of universe.tickers) {
          if (t >= candles.length) continue;
          if (portfolio.openPositions.has(ticker)) continue;
          if (portfolio.openPositions.size >= config.maxPositions) continue;

          const context = buildStrategyContext(ticker, candles, {
            asOfIndex: t,
            marketIndexCandles: this.sliceIndexMap(universe.indexCandles, t),
            benchmarkCandles: universe.benchmarkCandles?.slice(0, t + 1),
            sectorCandles: universe.sectorCandlesByTicker?.get(ticker)?.slice(0, t + 1) ?? null,
          });

          const result = strategy.evaluate(context);
          if (!result.setupDetected || result.entry === null || result.stop === null || result.target === null) {
            continue;
          }

          const scoreBreakdown = calculateScore(context, result, this.options.scoringWeights);
          const classification = classifySignal(
            scoreBreakdown.total,
            result.setupDetected,
            this.options.classificationThresholds
          );

          if (classification !== 'BUY') continue;

          nextPending.set(ticker, {
            ticker,
            strategy: strategy.name,
            signalDate: candles[t].timestamp,
            referenceEntry: result.entry,
            riskDistance: result.entry - result.stop,
            rewardDistance: result.target - result.entry,
            signalScore: scoreBreakdown.total,
            marketRegimeAtEntry: context.marketRegime?.label ?? null,
          });
        }
      }

      // --- Step D: record end-of-day equity snapshot ---
      const latestPrices = this.latestPricesAt(universe, t);
      const equity = portfolio.getEquity(latestPrices);
      equityCurve.push({
        date: this.dateAt(universe, t),
        cash: portfolio.cash,
        equity,
        openPositionsCount: portfolio.openPositions.size,
        exposurePct: portfolio.getExposurePct(latestPrices),
      });
    }

    // --- Force-close any still-open positions at the final available close ---
    for (const ticker of [...portfolio.openPositions.keys()]) {
      const candles = universe.tickers.get(ticker);
      if (!candles) continue;
      const finalCandle = candles[Math.min(endIndex, candles.length - 1)];
      const trade = portfolio.closePosition(
        ticker,
        finalCandle.close,
        finalCandle.timestamp,
        'end_of_data',
        config.slippageBps,
        config.commissionBps
      );
      closedTrades.push(trade);
    }

    const metrics = calculateAllMetrics(closedTrades, equityCurve, config.startingCapital, startDate, endDate);

    return {
      strategyName: strategy.name,
      startDate,
      endDate,
      trades: closedTrades,
      equityCurve,
      metrics,
      config,
    };
  }

  private sliceIndexMap(map: Map<string, Candle[]> | undefined, t: number): Map<string, Candle[]> | undefined {
    if (!map) return undefined;
    const sliced = new Map<string, Candle[]>();
    for (const [k, v] of map) sliced.set(k, v.slice(0, t + 1));
    return sliced;
  }

  private latestPricesAt(universe: BacktestUniverse, t: number): Map<string, number> {
    const prices = new Map<string, number>();
    for (const [ticker, candles] of universe.tickers) {
      if (t < candles.length) prices.set(ticker, candles[t].close);
    }
    return prices;
  }

  private dateAt(universe: BacktestUniverse, t: number): Date {
    const first = universe.tickers.values().next().value as Candle[] | undefined;
    if (!first || t >= first.length) return new Date(0);
    return first[t].timestamp;
  }
}
