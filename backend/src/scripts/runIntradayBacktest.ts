/**
 * Backtests the 3 intraday strategies (src/strategies/intraday/) against
 * real historical 5-min data, using the same ranking/scoring/sizing/
 * trailing-stop logic as the live day-trading daemon
 * (runIBKRDayTrading.ts) — this is what actually answers "does this
 * strategy set work," which the unit tests (hand-built fixtures) can't.
 *
 * Requires cached intraday data — run downloadIntradayData.ts first:
 *   npm run download-intraday-data -- AAPL MSFT NVDA
 *   npm run run-intraday-backtest -- AAPL MSFT NVDA
 *   npm run run-intraday-backtest                    (default watchlist)
 */
import { config, validateConfig } from '@/config/environment';
import { getCachedIntradayCandles } from '@/data/IntradayDataCache';
import { IntradayBacktester, IntradayBacktestConfig } from '@/backtesting/IntradayBacktester';
import { OpeningRangeBreakoutStrategy } from '@/strategies/intraday/OpeningRangeBreakout';
import { VwapTrendContinuationStrategy } from '@/strategies/intraday/VwapTrendContinuation';
import { MomentumBreakoutStrategy } from '@/strategies/intraday/MomentumBreakout';
import { BacktestConfig, BacktestResult, ExitReason } from '@/types/backtest';
import { IntradayStrategy } from '@/types/intraday';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA'];
const INTERVAL = '5min';

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function printMetrics(label: string, result: BacktestResult): void {
  const m = result.metrics;
  logger.info(`\n--- ${label} ---`);
  logger.info(`Trades: ${m.numTrades} | Win rate: ${pct(m.winRate)}`);
  logger.info(`Total return: ${pct(m.totalReturn)} | CAGR: ${pct(m.cagr)}`);
  logger.info(
    `Avg win: $${m.avgWin.toFixed(2)} | Avg loss: $${m.avgLoss.toFixed(2)} | Profit factor: ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf'}`
  );
  logger.info(`Expectancy: $${m.expectancy.toFixed(2)}/trade | Best: $${m.bestTrade.toFixed(2)} | Worst: $${m.worstTrade.toFixed(2)}`);
  logger.info(`Sharpe: ${m.sharpeRatio.toFixed(2)} | Sortino: ${m.sortinoRatio.toFixed(2)} | Max drawdown: ${pct(m.maxDrawdown)}`);
  logger.info(`Max consecutive wins: ${m.maxConsecutiveWins} | Max consecutive losses: ${m.maxConsecutiveLosses}`);

  const avgHoldingMinutes =
    result.trades.length === 0
      ? 0
      : result.trades.reduce((sum, t) => sum + ((t.exitDate?.getTime() ?? 0) - t.entryDate.getTime()) / 60000, 0) / result.trades.length;
  logger.info(`Avg holding period: ${avgHoldingMinutes.toFixed(1)} min`);

  const counts: Record<ExitReason, number> = { stop: 0, target: 0, end_of_data: 0 };
  for (const t of result.trades) {
    if (t.exitReason) counts[t.exitReason] += 1;
  }
  const total = result.trades.length || 1;
  logger.info(
    `Exits — target: ${counts.target} (${pct(counts.target / total)}), trailing-stop: ${counts.stop} (${pct(counts.stop / total)}), ` +
      `forced flatten: ${counts.end_of_data} (${pct(counts.end_of_data / total)})`
  );

  const tradingDays = new Set(result.trades.map((t) => t.entryDate.toISOString().slice(0, 10))).size;
  logger.info(`Trades landed on ${tradingDays} distinct day(s), avg ${(result.trades.length / Math.max(tradingDays, 1)).toFixed(2)} trades/active-day`);
}

function printBreakdown(label: string, result: BacktestResult, groupBy: (t: BacktestResult['trades'][number]) => string): void {
  const groups = new Map<string, BacktestResult['trades']>();
  for (const t of result.trades) {
    const key = groupBy(t);
    const bucket = groups.get(key);
    if (bucket) bucket.push(t);
    else groups.set(key, [t]);
  }

  logger.info(`\n--- ${label} ---`);
  logger.info('Group                    | Trades | WinRate | Expectancy | Total P&L');
  for (const [key, trades] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const wins = trades.filter((t) => (t.netPnl ?? 0) > 0);
    const winRate = trades.length === 0 ? 0 : wins.length / trades.length;
    const totalPnl = trades.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
    const expectancy = trades.length === 0 ? 0 : totalPnl / trades.length;
    logger.info(
      `${key.padEnd(24)} | ${String(trades.length).padStart(6)} | ${pct(winRate).padStart(7)} | $${expectancy.toFixed(2).padStart(9)} | $${totalPnl.toFixed(2).padStart(9)}`
    );
  }
}

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const tickerArgs = args.filter((a) => !a.startsWith('--')).map((t) => t.toUpperCase());
  const tickers = tickerArgs.length > 0 ? tickerArgs : DEFAULT_TICKERS;

  // Single-variable overrides for controlled experiments (e.g. testing
  // whether a wider trailing stop changes the exit-reason mix) without
  // touching the live daemon's .env-derived config.
  const trailFlag = flags.find((f) => f.startsWith('--trail='));
  const trailingPercentOverride = trailFlag ? parseFloat(trailFlag.split('=')[1]) : undefined;
  const maxAtrFlag = flags.find((f) => f.startsWith('--max-atr-pct='));
  const maxEntryAtrPctOfPrice = maxAtrFlag ? parseFloat(maxAtrFlag.split('=')[1]) : undefined;
  // Out-of-sample windowing: restrict to bars at/after this date, so a
  // candidate change can be compared against baseline on a period that
  // didn't inform the change (e.g. a temporal holdout).
  const startDateFlag = flags.find((f) => f.startsWith('--start-date='));
  const startDateOverride = startDateFlag ? new Date(startDateFlag.split('=')[1]) : undefined;

  const universe = new Map<string, Candle[]>();
  for (const ticker of tickers) {
    let candles = getCachedIntradayCandles(ticker, INTERVAL);
    if (!candles) {
      logger.warn(`✗ ${ticker}: no cached intraday data — run: npm run download-intraday-data -- ${ticker}`);
      continue;
    }
    if (startDateOverride) candles = candles.filter((c) => c.timestamp >= startDateOverride);
    universe.set(ticker, candles);
  }

  let spyCandles = getCachedIntradayCandles('SPY', INTERVAL);
  if (spyCandles && startDateOverride) spyCandles = spyCandles.filter((c) => c.timestamp >= startDateOverride);
  if (!spyCandles) {
    logger.error('No cached SPY intraday data — run: npm run download-intraday-data');
    process.exit(1);
  }
  if (universe.size === 0) {
    logger.error('No cached intraday data for any requested ticker — run download-intraday-data first.');
    process.exit(1);
  }

  logger.info('='.repeat(70));
  logger.info('INTRADAY BACKTEST');
  logger.info(`Universe: ${[...universe.keys()].join(', ')} (+ SPY for market context)`);
  logger.info('='.repeat(70));

  const backtestConfig: BacktestConfig = {
    startingCapital: 10000,
    maxRiskPerTradePct: config.ibkrDayTradingMaxRiskPerTradePct / 100,
    maxPositions: config.ibkrDayTradingMaxTradesPerDay,
    maxPortfolioExposurePct: 0.9,
    slippageBps: 5,
    commissionBps: 2,
    fractionalShares: false,
  };

  const dayConfig: IntradayBacktestConfig = {
    maxTradesPerDay: config.ibkrDayTradingMaxTradesPerDay,
    maxPositionValueUsd: config.ibkrDayTradingMaxPositionValueUsd,
    trailingPercent: trailingPercentOverride ?? config.ibkrDayTradingTrailPercent,
    startTimeCst: config.ibkrDayTradingStartTimeCst,
    endTimeCst: config.ibkrDayTradingEndTimeCst,
    maxEntryAtrPctOfPrice,
  };
  if (trailingPercentOverride !== undefined) {
    logger.info(`[experiment] trailingPercent overridden to ${trailingPercentOverride}% (default ${config.ibkrDayTradingTrailPercent}%)`);
  }
  if (maxEntryAtrPctOfPrice !== undefined) {
    logger.info(`[experiment] entry-quality gate active: reject if ATR14/close > ${(maxEntryAtrPctOfPrice * 100).toFixed(2)}%`);
  }

  const strategies: IntradayStrategy[] = [
    new OpeningRangeBreakoutStrategy(),
    new VwapTrendContinuationStrategy(),
    new MomentumBreakoutStrategy(),
  ];

  const backtester = new IntradayBacktester();
  const result = backtester.run(strategies, universe, spyCandles, backtestConfig, dayConfig);

  printMetrics('intraday_day_trading (all 3 strategies combined)', result);
  printBreakdown('BY STRATEGY', result, (t) => t.strategy);
  printBreakdown('BY TICKER', result, (t) => t.ticker);
}

main().catch((error) => {
  logger.error('Intraday backtest failed:', error);
  process.exit(1);
});
