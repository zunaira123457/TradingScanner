/**
 * Experiment 5 — Bullish-regime market-momentum gate
 * (MOMENTUM_DIAGNOSTICS_REPORT.md Section 8, Experiment 5).
 *
 * Pre-registered hypothesis: requiring SPY's own 12-day rate of change to
 * be positive before taking a `bullish`-regime momentum_continuation
 * signal improves that regime's currently near-breakeven results (see
 * src/research/BullishMomentumGateVariant.ts for the full pre-registration
 * and the exact, fixed threshold: SPY 12-day ROC > 0%).
 *
 * Same validation discipline as Experiment 4: evaluated ONLY on data that
 * did NOT generate the hypothesis. Reuses the same two independent
 * holdouts built for Experiments 2 and 3.
 *
 * Does NOT modify MomentumContinuationStrategy, ScoringEngine, risk, or
 * portfolio logic. The variant is a wrapper strategy, run only through
 * this script and Backtester — never registered anywhere else.
 *
 * Usage:
 *   npm run run-experiment-5
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { Backtester } from '@/backtesting/Backtester';
import { auditUniverse } from '@/backtesting/DataQualityAudit';
import { alignSeriesByDate } from '@/backtesting/CalendarAlignment';
import { analyzeByRegime } from '@/backtesting/TradeAnalytics';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { BullishMomentumGateVariant, buildSpyRoc12ByDate } from '@/research/BullishMomentumGateVariant';
import { getFullUniverseTickers, getHandCuratedSectorMap } from './downloadUniverse';
import { getSecondUniverseTickers, getSecondUniverseSectorMap } from '@/research/SecondUniverse';
import { BacktestConfig, BacktestUniverse, BacktestResult, Trade } from '@/types/backtest';
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
  logger.info(
    `${label}: Trades=${result.metrics.numTrades} WinRate=${pct(result.metrics.winRate)} PF=${fmtPF(result.metrics.profitFactor)} CAGR=${pct(result.metrics.cagr)} Expectancy=$${result.metrics.expectancy.toFixed(2)} TotalReturn=${pct(result.metrics.totalReturn)}`
  );
}

function printBullishBucket(label: string, trades: Trade[]): void {
  const buckets = analyzeByRegime(trades);
  const bullish = buckets.find((b) => b.label === 'bullish');
  if (!bullish) {
    logger.info(`${label}: no bullish-regime trades`);
    return;
  }
  logger.info(
    `${label} [bullish only]: Trades=${bullish.trades} WinRate=${pct(bullish.winRate)} PF=${fmtPF(bullish.profitFactor)} Expectancy=$${bullish.expectancy.toFixed(2)} NetPnl=$${bullish.netPnl.toFixed(2)}`
  );
}

interface HoldoutSpec {
  label: string;
  cacheDir: string;
  tickers: string[];
  sectorMap: Map<string, string>;
  startDate?: Date;
  endDate?: Date;
}

async function runHoldout(spec: HoldoutSpec, backtester: Backtester): Promise<void> {
  logger.info(`\n${'='.repeat(70)}`);
  logger.info(`HOLDOUT: ${spec.label}`);
  logger.info('='.repeat(70));

  const provider = new TwelveDataProvider(config.twelveDataApiKey!, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(spec.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);

  const rawCandles = new Map<string, Candle[]>();
  const downloadFailures: string[] = [];
  for (const ticker of spec.tickers) {
    try {
      const { candles } = await downloader.downloadStock(ticker, { startDate: spec.startDate, endDate: spec.endDate });
      rawCandles.set(ticker, candles);
    } catch (error) {
      downloadFailures.push(ticker);
      logger.warn(`✗ ${ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (downloadFailures.length > 0) {
    logger.info(`Download failures (${downloadFailures.length}): ${downloadFailures.join(', ')}`);
  }
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of INDEX_TICKERS) {
    const { candles } = await downloader.downloadStock(idx, { startDate: spec.startDate, endDate: spec.endDate });
    indexCandles.set(idx, candles);
  }

  const audit = auditUniverse(rawCandles);
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

  const backtestConfig: BacktestConfig = {
    startingCapital: 100000,
    maxRiskPerTradePct: 0.01,
    maxPositions: 10,
    maxPortfolioExposurePct: 0.8,
    slippageBps: 5,
    commissionBps: 2,
    fractionalShares: false,
    sectorMap: spec.sectorMap,
    maxSectorExposurePct: 0.3,
  };

  const startIndex = 0;
  const endIndex = benchmarkCandles.length - 1;
  logger.info(`Universe: ${stockTickersAligned.size} stocks, ${benchmarkCandles.length} trading days`);

  // Built ONCE from the aligned SPY series — safe (see BullishMomentumGateVariant.ts's no-look-ahead note).
  const spyRoc12ByDate = buildSpyRoc12ByDate(benchmarkCandles);

  await yieldToEventLoop();
  const t0 = Date.now();
  const baseline = backtester.run(new MomentumContinuationStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`[PROFILING] baseline took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printSummary('BASELINE (unmodified)', baseline);
  printBullishBucket('BASELINE', baseline.trades);
  await yieldToEventLoop();

  const t1 = Date.now();
  const variant = backtester.run(new BullishMomentumGateVariant(spyRoc12ByDate), universe, backtestConfig, startIndex, endIndex);
  logger.info(`[PROFILING] variant took ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  printSummary('VARIANT (bullish momentum gate)', variant);
  printBullishBucket('VARIANT', variant.trades);
  await yieldToEventLoop();

  logger.info('\nOverall regime breakdown (baseline):');
  analyzeByRegime(baseline.trades).forEach((b) =>
    logger.info(`  ${b.label}: n=${b.trades} winRate=${pct(b.winRate)} PF=${fmtPF(b.profitFactor)}`)
  );
  logger.info('Overall regime breakdown (variant):');
  analyzeByRegime(variant.trades).forEach((b) =>
    logger.info(`  ${b.label}: n=${b.trades} winRate=${pct(b.winRate)} PF=${fmtPF(b.profitFactor)}`)
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

  logger.info('='.repeat(70));
  logger.info('EXPERIMENT 5 — BULLISH-REGIME MARKET-MOMENTUM GATE (research/diagnostic only)');
  logger.info('(base MomentumContinuationStrategy UNCHANGED; variant is research-only, never registered elsewhere)');
  logger.info('='.repeat(70));

  const backtester = new Backtester();

  await runHoldout(
    {
      label: 'Experiment 2 second universe (71 stocks, 2020-2026) — validation holdout A',
      cacheDir: config.cacheDir,
      tickers: getSecondUniverseTickers(),
      sectorMap: getSecondUniverseSectorMap(),
    },
    backtester
  );

  await runHoldout(
    {
      label: 'Experiment 3 temporal holdout (81 stocks, 2015-2019) — validation holdout B',
      cacheDir: './data/cache_holdout_pre2020',
      tickers: getFullUniverseTickers(),
      sectorMap: getHandCuratedSectorMap(),
      startDate: new Date('2015-01-01'),
      endDate: new Date('2019-12-31'),
    },
    backtester
  );

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('EXPERIMENT 5 COMPLETE — research/diagnostic only, no strategy/scoring changes made');
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Experiment 5 (bullish momentum gate) failed:', error);
  process.exit(1);
});
