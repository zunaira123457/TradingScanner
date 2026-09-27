/**
 * Experiment 3 — True temporal holdout / out-of-time test
 * (MOMENTUM_DIAGNOSTICS_REPORT.md Section 8, Experiment 3, option (b): no
 * live paper-trading system exists yet for option (a), so this uses a
 * pre-committed, never-before-touched 2015-2019 window on the SAME 81-stock
 * universe as the original Phase 4.5 analysis).
 *
 * Pre-registered hypothesis: momentum_continuation's baseline edge
 * (profit factor 1.14, CAGR 3.71%, win rate 34.5% on 2020-2026) persists,
 * directionally, on data this analysis has never seen.
 *
 * Pre-registered success/failure (fixed BEFORE this script was run):
 *   Success: directionally similar PF/win rate, and a similarly-shaped (or
 *   better) concentration profile.
 *   Failure: PF drops to <=1, or the edge again depends entirely on 1-2
 *   stocks.
 *
 * Methodology: identical unmodified MomentumContinuationStrategy, identical
 * BacktestConfig, identical Backtester, identical concentration re-run
 * technique as Experiments 1/2 and the original Phase 4.5 report — applied
 * to the 2015-2019 holdout data downloaded by downloadHoldoutPre2020.ts
 * into the ISOLATED cache_holdout_pre2020 directory. Nothing about the
 * strategy, scoring, or risk logic is touched by this script.
 *
 * Usage:
 *   npm run run-experiment-3
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
import { getFullUniverseTickers, getHandCuratedSectorMap } from './downloadUniverse';
import { BacktestConfig, BacktestUniverse, BacktestResult } from '@/types/backtest';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const HOLDOUT_CACHE_DIR = './data/cache_holdout_pre2020';
const HOLDOUT_START = new Date('2015-01-01');
const HOLDOUT_END = new Date('2019-12-31');
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
  // ISOLATED cache — never touches the production 2020-2026 dataset.
  const cache = new HybridCacheProvider(HOLDOUT_CACHE_DIR, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);
  const sectorMap = getHandCuratedSectorMap();

  logger.info('='.repeat(70));
  logger.info('EXPERIMENT 3 — TRUE TEMPORAL HOLDOUT (2015-2019, research/diagnostic only)');
  logger.info('(strategy, scoring, and risk logic UNCHANGED — pre-2020 holdout period only)');
  logger.info('='.repeat(70));

  const tickers = getFullUniverseTickers();
  const rawCandles = new Map<string, Candle[]>();
  const downloadFailures: string[] = [];
  for (const ticker of tickers) {
    try {
      const { candles } = await downloader.downloadStock(ticker, { startDate: HOLDOUT_START, endDate: HOLDOUT_END });
      rawCandles.set(ticker, candles);
    } catch (error) {
      downloadFailures.push(ticker);
      logger.warn(`✗ ${ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of INDEX_TICKERS) {
    const { candles } = await downloader.downloadStock(idx, { startDate: HOLDOUT_START, endDate: HOLDOUT_END });
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

  // IDENTICAL BacktestConfig to Experiments 1 and 2 and the original Phase
  // 4.5 run — nothing tuned for this holdout window.
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

  logger.info(`\nHoldout universe: ${stockTickersAligned.size} stocks, ${benchmarkCandles.length} trading days`);
  logger.info(`Holdout window: ${benchmarkCandles[0].timestamp.toISOString().slice(0, 10)} to ${benchmarkCandles[benchmarkCandles.length - 1].timestamp.toISOString().slice(0, 10)}`);
  logger.info('Running baseline momentum_continuation backtest (strategy UNCHANGED)...');
  await yieldToEventLoop();
  const t0 = Date.now();
  const baseline = backtester.run(new MomentumContinuationStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`[PROFILING] baseline backtest took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printSummary('BASELINE (2015-2019 holdout, same 81-stock universe)', baseline);
  await yieldToEventLoop();

  // ==========================================================================
  // STOCK-CONCENTRATION RE-RUNS — identical technique to Experiments 1/2
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('STOCK-CONCENTRATION RE-RUNS (2015-2019 holdout)');
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
  logger.info('EXPERIMENT 3 COMPLETE — research/diagnostic only, no strategy/scoring changes made');
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Experiment 3 (temporal holdout) failed:', error);
  process.exit(1);
});
