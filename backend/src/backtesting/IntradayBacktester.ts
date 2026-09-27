import { Candle } from '@/types';
import { Trade, BacktestConfig, BacktestResult, PortfolioSnapshot } from '@/types/backtest';
import { ScoringWeights, ClassificationThresholds } from '@/types/scoring';
import { IntradayStrategy, IntradaySnapshot, latestIntradaySnapshot } from '@/types/intraday';
import { buildIntradayContext } from '@/strategies/intraday/IntradayStrategyContext';
import { IntradayIndicatorEngine } from '@/indicators/IntradayIndicatorEngine';
import { calculateIntradayScore, IntradayMarketContext } from '@/scoring/IntradayScoringEngine';
import { classifySignal, DEFAULT_SCORING_WEIGHTS, DEFAULT_CLASSIFICATION_THRESHOLDS } from '@/scoring/ScoringEngine';
import { Portfolio } from './Portfolio';
import { checkExit } from './Execution';
import { calculatePositionSize } from './PositionSizing';
import { calculateAllMetrics } from './Metrics';
import { tradingDayKey } from '@/indicators/VWAP';
import { isWithinDayTradingWindow } from '@/utils/marketHours';

export interface IntradayBacktesterOptions {
  scoringWeights?: ScoringWeights;
  classificationThresholds?: ClassificationThresholds;
}

export interface IntradayBacktestConfig {
  maxTradesPerDay: number;
  maxPositionValueUsd: number; // notional cap per trade, same role as OrderExecutorConfig's field — kept separate from BacktestConfig since only day trading uses it
  trailingPercent: number;
  startTimeCst: string;
  endTimeCst: string;
  /**
   * Optional entry-quality gate: rejects a signal if ATR14/close exceeds
   * this fraction at signal time, applied uniformly after all 3 strategies
   * evaluate (not a change to any strategy's own rules). Evidence: a
   * research pass (analyzeIntradayEntryQualityFeatures.ts) found
   * entryAtrPctOfPrice the most stable of several candidate features on a
   * temporal out-of-sample split — Cohen's d -0.304 (discovery half) vs
   * -0.317 (validation half), same direction and magnitude on data that
   * didn't produce the finding. Still only a "weak" effect (|d|<0.5) by
   * this project's own threshold, so this is optional and off by default
   * (undefined = no filtering, exactly the existing baseline behavior) —
   * only apply it with an explicit before/after comparison.
   */
  maxEntryAtrPctOfPrice?: number;
}

interface PendingEntry {
  ticker: string;
  strategy: string;
  signalDate: Date;
  riskDistance: number;
  rewardDistance: number;
  signalScore: number;
}

interface TrailState {
  highWaterMark: number;
  initialStop: number;
}

/**
 * Intraday counterpart to Backtester.ts. Reuses Portfolio, checkExit, and
 * calculateAllMetrics unchanged (all timeframe-agnostic — nothing about
 * them assumes daily bars). What's new here, vs. the daily engine, is the
 * simulation loop itself: multiple 5-min bars per day, multiple strategies
 * ranked against each other every bar (mirroring the live daemon's
 * runScanCycle exactly), a per-day trade cap, a trailing stop that ratchets
 * bar-by-bar, and a forced end-of-day flatten.
 *
 * SIMPLIFICATION: one ticker's (SPY's) bar timestamps are used as the
 * canonical per-day timeline; every other ticker is looked up by exact
 * timestamp match, and simply skipped for a bar it has no candle at. Real
 * 5-min bars across liquid large-caps are timestamp-aligned in practice, so
 * this avoids a general async merge-join for a gap case that's rare in the
 * actual data — but it means a ticker with materially different bar
 * timestamps than SPY (e.g. a genuinely gappy feed) will be under-evaluated.
 */
export class IntradayBacktester {
  private options: Required<IntradayBacktesterOptions>;

  constructor(options: IntradayBacktesterOptions = {}) {
    this.options = {
      scoringWeights: options.scoringWeights ?? DEFAULT_SCORING_WEIGHTS,
      classificationThresholds: options.classificationThresholds ?? DEFAULT_CLASSIFICATION_THRESHOLDS,
    };
  }

  run(
    strategies: IntradayStrategy[],
    universe: Map<string, Candle[]>,
    spyCandles: Candle[],
    config: BacktestConfig,
    dayConfig: IntradayBacktestConfig
  ): BacktestResult {
    const timestampIndex = new Map<string, Map<number, number>>();
    // Indicator snapshots depend only on candles[0..i] (no look-ahead), so
    // computing each ticker's full history ONCE here — instead of
    // recomputing it from scratch every single bar inside the loop below —
    // is exactly equivalent and turns an O(bars^2) backtest into O(bars).
    const snapshotsByTicker = new Map<string, IntradaySnapshot[]>();
    for (const [ticker, candles] of universe) {
      timestampIndex.set(ticker, this.buildTimestampIndex(candles));
      snapshotsByTicker.set(ticker, IntradayIndicatorEngine.calculateAll(candles));
    }
    timestampIndex.set('SPY', this.buildTimestampIndex(spyCandles));
    snapshotsByTicker.set('SPY', IntradayIndicatorEngine.calculateAll(spyCandles));

    const spyByDay = this.groupByTradingDay(spyCandles);
    const sortedDays = [...spyByDay.keys()].sort();

    const portfolio = new Portfolio(config.startingCapital);
    const equityCurve: PortfolioSnapshot[] = [];
    const closedTrades: Trade[] = [];
    const trailState = new Map<string, TrailState>();

    let firstBarDate: Date | null = null;
    let lastBarDate: Date | null = null;

    for (const day of sortedDays) {
      const dayBars = (spyByDay.get(day) ?? []).filter((c) =>
        isWithinDayTradingWindow(c.timestamp, dayConfig.startTimeCst, dayConfig.endTimeCst)
      );
      if (dayBars.length === 0) continue;

      let tradesExecutedToday = 0;
      const tickersTradedToday = new Set<string>();
      let pendingEntries = new Map<string, PendingEntry>();

      for (let barIdx = 0; barIdx < dayBars.length; barIdx++) {
        const bar = dayBars[barIdx];
        const ts = bar.timestamp.getTime();
        if (firstBarDate === null) firstBarDate = bar.timestamp;
        lastBarDate = bar.timestamp;

        // --- Step A: fill entries queued from the previous bar's close, at THIS bar's open ---
        const nextPending = new Map<string, PendingEntry>();
        for (const [ticker, pending] of pendingEntries) {
          const idx = timestampIndex.get(ticker)?.get(ts);
          const candles = universe.get(ticker);
          if (idx === undefined || !candles) continue; // no bar for this ticker at this exact timestamp

          const thisBar = candles[idx];
          const intendedEntry = thisBar.open;
          const intendedStop = intendedEntry - pending.riskDistance;
          const intendedTarget = intendedEntry + pending.rewardDistance;

          const latestPrices = this.latestPricesForOpenPositions(portfolio, universe, timestampIndex, ts);
          const riskBasedShares = calculatePositionSize(
            portfolio.getEquity(latestPrices),
            intendedEntry,
            intendedStop,
            config.maxRiskPerTradePct,
            config.fractionalShares
          );
          const notionalCapShares = Math.floor(dayConfig.maxPositionValueUsd / intendedEntry);
          const shares = Math.min(riskBasedShares, notionalCapShares);
          if (shares <= 0) continue;

          const estimatedCost = shares * intendedEntry * (1 + config.slippageBps / 10000);
          if (!portfolio.canOpenPosition(ticker, estimatedCost, config, latestPrices)) continue;

          portfolio.openPosition({
            ticker,
            strategy: pending.strategy,
            signalDate: pending.signalDate,
            entryDate: thisBar.timestamp,
            intendedEntryPrice: intendedEntry,
            shares,
            stopPrice: intendedStop,
            targetPrice: intendedTarget,
            signalScore: pending.signalScore,
            marketRegimeAtEntry: null,
            slippageBps: config.slippageBps,
            commissionBps: config.commissionBps,
          });
          trailState.set(ticker, { highWaterMark: thisBar.high, initialStop: intendedStop });
        }
        pendingEntries = nextPending; // Step C below repopulates for the next bar

        // --- Step B: check exits for open positions, trailing stop ratcheted from this bar's high ---
        for (const ticker of [...portfolio.openPositions.keys()]) {
          const idx = timestampIndex.get(ticker)?.get(ts);
          const candles = universe.get(ticker);
          if (idx === undefined || !candles) continue;

          const candle = candles[idx];
          const state = trailState.get(ticker);
          if (!state) continue;
          state.highWaterMark = Math.max(state.highWaterMark, candle.high);
          const trailingStopPrice = Math.max(state.initialStop, state.highWaterMark * (1 - dayConfig.trailingPercent / 100));

          const position = portfolio.openPositions.get(ticker);
          if (!position) continue;

          const exitCheck = checkExit(candle, trailingStopPrice, position.targetPrice);
          if (exitCheck.exited && exitCheck.price !== null && exitCheck.reason) {
            const trade = portfolio.closePosition(
              ticker,
              exitCheck.price,
              candle.timestamp,
              exitCheck.reason,
              config.slippageBps,
              config.commissionBps
            );
            closedTrades.push(trade);
            trailState.delete(ticker);
          }
        }

        const isLastBarOfDay = barIdx === dayBars.length - 1;

        // --- Step C: evaluate new signals as of this bar (close), queue for next bar's open ---
        // Skipped on the last bar of the day — nothing queued then could ever fill before flatten.
        if (!isLastBarOfDay && tradesExecutedToday < dayConfig.maxTradesPerDay) {
          const spyIdx = timestampIndex.get('SPY')?.get(ts);
          const spyContext =
            spyIdx !== undefined
              ? buildIntradayContext('SPY', spyCandles.slice(0, spyIdx + 1), {
                  precomputedSnapshots: snapshotsByTicker.get('SPY'),
                })
              : null;
          const market: IntradayMarketContext = { spy: spyContext };

          const candidates: Array<{ entry: PendingEntry; score: number }> = [];

          for (const [ticker, candles] of universe) {
            if (portfolio.openPositions.has(ticker)) continue;
            if (tickersTradedToday.has(ticker)) continue;
            const idx = timestampIndex.get(ticker)?.get(ts);
            if (idx === undefined) continue;

            const context = buildIntradayContext(ticker, candles.slice(0, idx + 1), {
              precomputedSnapshots: snapshotsByTicker.get(ticker),
            });

            if (dayConfig.maxEntryAtrPctOfPrice !== undefined) {
              const snap = latestIntradaySnapshot(context);
              const atrPctOfPrice = snap.atr14 !== null && snap.close > 0 ? snap.atr14 / snap.close : null;
              if (atrPctOfPrice === null || atrPctOfPrice > dayConfig.maxEntryAtrPctOfPrice) continue;
            }

            for (const strategy of strategies) {
              const result = strategy.evaluate(context);
              if (!result.setupDetected || result.entry === null || result.stop === null || result.target === null) {
                continue;
              }
              const scoreBreakdown = calculateIntradayScore(context, market, result, this.options.scoringWeights);
              const classification = classifySignal(
                scoreBreakdown.total,
                result.setupDetected,
                this.options.classificationThresholds
              );
              if (classification !== 'BUY') continue;

              candidates.push({
                entry: {
                  ticker,
                  strategy: strategy.name,
                  signalDate: candles[idx].timestamp,
                  riskDistance: result.entry - result.stop,
                  rewardDistance: result.target - result.entry,
                  signalScore: scoreBreakdown.total,
                },
                score: scoreBreakdown.total,
              });
            }
          }

          candidates.sort((a, b) => b.score - a.score);
          const slotsRemaining = dayConfig.maxTradesPerDay - tradesExecutedToday;
          for (const candidate of candidates.slice(0, slotsRemaining)) {
            nextPending.set(candidate.entry.ticker, candidate.entry);
            // Reserved against the daily cap at signal time, not fill time —
            // matches the fact that a queued entry is attempted exactly once
            // (next bar) and then dropped whether or not it actually fills,
            // same as the daily Backtester's pendingEntries.
            tickersTradedToday.add(candidate.entry.ticker);
            tradesExecutedToday += 1;
          }
        }

        // --- Step D: force-flatten anything still open at the end of the day's window ---
        if (isLastBarOfDay) {
          for (const ticker of [...portfolio.openPositions.keys()]) {
            const idx = timestampIndex.get(ticker)?.get(ts);
            const candles = universe.get(ticker);
            const finalCandle = idx !== undefined && candles ? candles[idx] : bar;
            const trade = portfolio.closePosition(
              ticker,
              finalCandle.close,
              finalCandle.timestamp,
              'end_of_data',
              config.slippageBps,
              config.commissionBps
            );
            closedTrades.push(trade);
            trailState.delete(ticker);
          }
        }
      }

      // --- One equity snapshot per day (end-of-day), not per bar ---
      const lastBar = dayBars[dayBars.length - 1];
      const latestPrices = this.latestPricesForOpenPositions(portfolio, universe, timestampIndex, lastBar.timestamp.getTime());
      const equity = portfolio.getEquity(latestPrices);
      equityCurve.push({
        date: lastBar.timestamp,
        cash: portfolio.cash,
        equity,
        openPositionsCount: portfolio.openPositions.size,
        exposurePct: portfolio.getExposurePct(latestPrices),
      });
    }

    const startDate = firstBarDate ?? new Date(0);
    const endDate = lastBarDate ?? new Date(0);
    const metrics = calculateAllMetrics(closedTrades, equityCurve, config.startingCapital, startDate, endDate);

    return {
      strategyName: strategies.map((s) => s.name).join('+'),
      startDate,
      endDate,
      trades: closedTrades,
      equityCurve,
      metrics,
      config,
    };
  }

  private buildTimestampIndex(candles: Candle[]): Map<number, number> {
    const m = new Map<number, number>();
    candles.forEach((c, i) => m.set(c.timestamp.getTime(), i));
    return m;
  }

  private groupByTradingDay(candles: Candle[]): Map<string, Candle[]> {
    const byDay = new Map<string, Candle[]>();
    for (const candle of candles) {
      const key = tradingDayKey(candle.timestamp);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(candle);
      else byDay.set(key, [candle]);
    }
    return byDay;
  }

  /** Prices for every currently-open position, at-or-nearest this instant — falls back to the trade's entry price on a rare data gap. */
  private latestPricesForOpenPositions(
    portfolio: Portfolio,
    universe: Map<string, Candle[]>,
    timestampIndex: Map<string, Map<number, number>>,
    ts: number
  ): Map<string, number> {
    const prices = new Map<string, number>();
    for (const [ticker, trade] of portfolio.openPositions) {
      const idx = timestampIndex.get(ticker)?.get(ts);
      const candles = universe.get(ticker);
      prices.set(ticker, idx !== undefined && candles ? candles[idx].close : trade.entryPrice);
    }
    return prices;
  }
}
