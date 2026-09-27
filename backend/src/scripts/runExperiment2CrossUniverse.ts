/**
 * Experiment 2 — Cross-universe replication of the momentum_continuation
 * stock-concentration finding (MOMENTUM_DIAGNOSTICS_REPORT.md Section 8,
 * Experiment 2).
 *
 * Pre-registered hypothesis: the 3-5-stock dependency found on the original
 * 81-stock universe (removing the top 3 winners erases the edge, removing
 * the top 5 makes it a net loser) is specific to that universe/period, not
 * a general property of momentum_continuation.
 *
 * Methodology: identical to Phase 4.5 + the original diagnostics pass
 * (same BacktestConfig, same unmodified MomentumContinuationStrategy, same
 * Backtester, same concentration re-run technique), applied to the second,
 * non-overlapping universe defined in src/research/SecondUniverse.ts and
 * downloaded by downloadSecondUniverse.ts. Nothing about the strategy,
 * scoring, or risk logic is touched by this script.
 *
 * Usage:
 *   npm run run-experiment-2
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { Backtester } from '@/backtesting/Backtester';
import { auditUniverse } from '@/backtesting/DataQualityAudit';
import { alignSeriesByDate } from '@/backtesting/CalendarAlignment';
import { excludeTickersFromUniverse } from '@/backtesting/UniverseFilter';
import { analyzeStockConcentration } from '@/backtesting/TradeAnalytics';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { getSecondUniverseTickers, getSecondUniverseSectorMap } from '@/research/SecondUniverse';
import { BacktestConfig, BacktestUniverse, BacktestResult } from '@/types/backtest';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function fmtPF(pf: number): string {
  return Number.isFinite(pf) ? pf.toFixed(2) : '∞';
}

function printSummary(label: string, result: BacktestResult): void {
  logger.info(`\n-- ${label} --`);
  logger.info(
    `Trades: ${result.metrics.numTrades} | WinRate: ${pct(result.metrics.winRate)} | PF: ${fmtPF(result.metrics.profitFactor)} | CAGR: ${pct(result.metrics.cagr)} | Sharpe: ${result.metrics.sharpeRatio.toFixed(2)} | Expectancy: $${result.metrics.expectancy.toFixed(2)} | TotalReturn: ${pct(result.metrics.totalReturn)}`
  );
}

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }
  if (!config.twelveDataApiKey) throw new Error('TWELVE_DATA_API_KEY not configured');

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);
  const sectorMap = getSecondUniverseSectorMap();

  logger.info('='.repeat(70));
  logger.info('EXPERIMENT 2 — CROSS-UNIVERSE REPLICATION (research/diagnostic only)');
  logger.info('(strategy, scoring, and risk logic UNCHANGED — second universe only)');
  logger.info('='.repeat(70));

  // --- Build the second universe exactly the same way the original was built ---
  const tickers = getSecondUniverseTickers();
  const rawCandles = new Map<string, Candle[]>();
  const downloadFailures: string[] = [];
  for (const ticker of tickers) {
    try {
      const { candles } = await downloader.downloadStock(ticker);
      rawCandles.set(ticker, candles);
    } catch (error) {
      downloadFailures.push(ticker);
      logger.warn(`✗ ${ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of INDEX_TICKERS) {
    const { candles } = await downloader.downloadStock(idx);
    indexCandles.set(idx, candles);
  }

  const audit = auditUniverse(rawCandles);
  logger.info(`\nDownloaded: ${rawCandles.size}/${tickers.length} tickers (${downloadFailures.length} failed: ${downloadFailures.join(', ') || 'none'})`);
  logger.info(`Data-quality audit: ${audit.validTickers.length} valid, ${rawCandles.size - audit.validTickers.length} excluded`);
  if (audit.validTickers.length < rawCandles.size) {
    const excludedByAudit = [...rawCandles.keys()].filter((t) => !audit.validTickers.includes(t));
    logger.info(`Excluded by audit: ${excludedByAudit.join(', ')}`);
  }

  const allSeries = new Map<string, Candle[]>([...rawCandles, ...indexCandles]);
  const { aligned } = alignSeriesByDate(allSeries);

  const stockTickersAligned = new Map<string, Candle[]>();
  for (const ticker of audit.validTickers) {
    const series = aligned.get(ticker);
    if (series) stockTickersAligned.set(ticker, series);
  }
  const indexCandlesAligned = new Map<string, Candle[]>();
  for (const idx of INDEX_TICKERS) {
    const series = aligned.get(idx);
    if (series) indexCandlesAligned.set(idx, series);
  }
  const benchmarkCandles = indexCandlesAligned.get('SPY') as Candle[];

  const universe: BacktestUniverse = {
    tickers: stockTickersAligned,
    benchmarkCandles,
    indexCandles: indexCandlesAligned,
  };

  // IDENTICAL BacktestConfig to the original Phase 4.5 / diagnostics run —
  // nothing tuned for this universe.
  const backtestConfig: BacktestConfig = {
    startingCapital: 100000,
    maxRiskPerTradePct: 0.01,
    maxPositions: 10,
    maxPortfolioExposurePct: 0.8,
    slippageBps: 5,
    commissionBps: 2,
    fractionalShares: false,
    sectorMap,
    maxSectorExposurePct: 0.3,
  };

  const startIndex = 0;
  const endIndex = benchmarkCandles.length - 1;
  const backtester = new Backtester();

  logger.info(`\nFinal universe: ${stockTickersAligned.size} stocks, ${benchmarkCandles.length} trading days`);
  logger.info('Running baseline momentum_continuation backtest (strategy UNCHANGED)...');
  await yieldToEventLoop();
  const t0 = Date.now();
  const baseline = backtester.run(new MomentumContinuationStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`[PROFILING] baseline backtest took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printSummary('BASELINE (full second universe)', baseline);
  await yieldToEventLoop();

  // ==========================================================================
  // STOCK-CONCENTRATION RE-RUNS (identical technique to the original
  // diagnostics pass — re-run the real engine with top winners excluded)
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('STOCK-CONCENTRATION RE-RUNS (second universe)');
  logger.info('='.repeat(70));

  const concentration = analyzeStockConcentration(baseline.trades);
  logger.info(`\nUnique stocks traded: ${concentration.uniqueStocks}`);
  logger.info(`Median stock P&L: $${concentration.medianContribution.toFixed(2)}`);
  logger.info(
    `% stocks profitable: ${pct(concentration.contributions.filter((c) => c.netPnl > 0).length / concentration.contributions.length)}`
  );
  logger.info(
    `% stocks positive expectancy: ${pct(concentration.stocksWithPositiveExpectancy / concentration.uniqueStocks)}`
  );
  logger.info('\nTop 10 contributors by net P&L:');
  concentration.top10.forEach((c, i) =>
    logger.info(`  ${i + 1}. ${c.ticker}: $${c.netPnl.toFixed(0)} (${c.trades} trades, ${pct(c.winRate)} win rate)`)
  );

  for (const n of [1, 3, 5, 10]) {
    const topTickers = concentration.contributions.slice(0, n).map((c) => c.ticker);
    logger.info(`\n-- Excluding top ${n}: ${topTickers.join(', ')} --`);
    await yieldToEventLoop();
    const reducedUniverse = excludeTickersFromUniverse(universe, topTickers);
    const rerunT0 = Date.now();
    const rerun = backtester.run(new MomentumContinuationStrategy(), reducedUniverse, backtestConfig, startIndex, endIndex);
    logger.info(`[PROFILING] took ${((Date.now() - rerunT0) / 1000).toFixed(1)}s`);
    printSummary(`Excluding top ${n}`, rerun);
    await yieldToEventLoop();
  }

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('EXPERIMENT 2 COMPLETE — research/diagnostic only, no strategy/scoring changes made');
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Experiment 2 (cross-universe replication) failed:', error);
  process.exit(1);
});
