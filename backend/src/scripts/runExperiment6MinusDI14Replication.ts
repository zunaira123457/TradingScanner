/**
 * Experiment 6 — minusDI14 anomaly replication
 * (MOMENTUM_DIAGNOSTICS_REPORT.md Section 8, Experiment 6).
 *
 * Pre-registered hypothesis: higher -DI14 at momentum_continuation signal
 * time is genuinely (mildly) associated with better outcomes, not a
 * dataset-specific artifact of the original 2020-2026/81-stock universe.
 * The original diagnostics found this was the single strongest pooled
 * winner/loser feature separator (Cohen's d = +0.569) — counterintuitive,
 * since lower -DI14 (cleaner bullish dominance) is the naive expectation
 * for a better setup.
 *
 * This is a pure diagnostic replication — no strategy variant, no rule
 * change, nothing backtested differently. It reuses the exact same,
 * already-tested tooling the original diagnostics pass used
 * (TradeFeatureExtractor.extractTradeFeatures + DistributionAnalysis's
 * compareFeature/cohensD), applied to the two holdouts already built for
 * Experiments 2 and 3 (same discipline as Experiments 4/5: validated on
 * data that did NOT generate the original finding).
 *
 * Does NOT modify MomentumContinuationStrategy, ScoringEngine, risk, or
 * portfolio logic.
 *
 * Usage:
 *   npm run run-experiment-6
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { Backtester } from '@/backtesting/Backtester';
import { auditUniverse } from '@/backtesting/DataQualityAudit';
import { alignSeriesByDate } from '@/backtesting/CalendarAlignment';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { extractTradeFeatures } from '@/research/TradeFeatureExtractor';
import { compareFeature } from '@/research/DistributionAnalysis';
import { getFullUniverseTickers, getHandCuratedSectorMap } from './downloadUniverse';
import { getSecondUniverseTickers, getSecondUniverseSectorMap } from '@/research/SecondUniverse';
import { BacktestConfig, BacktestUniverse } from '@/types/backtest';
import { TradeFeatureRecord } from '@/types/research';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];
const ORIGINAL_COHENS_D = 0.569;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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

  await yieldToEventLoop();
  const t0 = Date.now();
  const baseline = backtester.run(new MomentumContinuationStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`[PROFILING] baseline took ${((Date.now() - t0) / 1000).toFixed(1)}s, ${baseline.trades.length} trades`);
  await yieldToEventLoop();

  const records: TradeFeatureRecord[] = extractTradeFeatures(baseline.trades, universe, { sectorMap: spec.sectorMap });
  const winners = records.filter((r) => r.won);
  const losers = records.filter((r) => !r.won);
  logger.info(`Winners: ${winners.length} | Losers: ${losers.length}`);

  const comparison = compareFeature(
    'minusDI14',
    winners.map((r) => r.minusDI14),
    losers.map((r) => r.minusDI14)
  );

  logger.info(`\nminusDI14 — winners: n=${comparison.winners.n} mean=${comparison.winners.mean.toFixed(3)} median=${comparison.winners.median.toFixed(3)}`);
  logger.info(`minusDI14 — losers:  n=${comparison.losers.n} mean=${comparison.losers.mean.toFixed(3)} median=${comparison.losers.median.toFixed(3)}`);
  logger.info(`Cohen's d: ${comparison.cohensD !== null ? comparison.cohensD.toFixed(3) : 'null'} [${comparison.effectStrength}]`);
  logger.info(`Original (2020-2026, 81-stock universe) Cohen's d: +${ORIGINAL_COHENS_D}`);
  if (comparison.cohensD !== null) {
    const sameDirection = Math.sign(comparison.cohensD) === Math.sign(ORIGINAL_COHENS_D);
    const roughMagnitudeMatch = Math.abs(comparison.cohensD) >= 0.2; // "noise" threshold used throughout this project
    logger.info(`Same direction as original: ${sameDirection} | Above the project's noise threshold (|d|>=0.2): ${roughMagnitudeMatch}`);
  }

  // Supplementary context only (not a separate hypothesis test): the two
  // other DI-system indicators, to help interpret whatever minusDI14 shows.
  const plusDiComparison = compareFeature('plusDI14', winners.map((r) => r.plusDI14), losers.map((r) => r.plusDI14));
  const adxComparison = compareFeature('adx14', winners.map((r) => r.adx14), losers.map((r) => r.adx14));
  logger.info(`\n(context only) plusDI14 Cohen's d: ${plusDiComparison.cohensD?.toFixed(3) ?? 'null'} [${plusDiComparison.effectStrength}]`);
  logger.info(`(context only) adx14 Cohen's d: ${adxComparison.cohensD?.toFixed(3) ?? 'null'} [${adxComparison.effectStrength}]`);
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
  logger.info('EXPERIMENT 6 — minusDI14 ANOMALY REPLICATION (research/diagnostic only)');
  logger.info('(pure feature-distribution comparison — no strategy variant, no rule change)');
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
  logger.info('EXPERIMENT 6 COMPLETE — research/diagnostic only, no strategy/scoring changes made');
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Experiment 6 (minusDI14 replication) failed:', error);
  process.exit(1);
});
