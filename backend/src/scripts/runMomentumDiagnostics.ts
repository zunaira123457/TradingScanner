/**
 * Phase 4.5 diagnostics: deep-dive research on momentum_continuation's
 * completed trades. Does NOT modify the strategy or optimize parameters —
 * this is exploratory/diagnostic analysis on top of already-generated
 * backtest results, per the phase's explicit instructions.
 *
 * Usage:
 *   npm run run-momentum-diagnostics
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
import { extractTradeFeatures } from '@/research/TradeFeatureExtractor';
import { compareFeature, rankFeatureComparisons, winRateByCategory, FeatureComparison } from '@/research/DistributionAnalysis';
import { getFullUniverseTickers, getHandCuratedSectorMap } from './downloadUniverse';
import { BacktestConfig, BacktestUniverse } from '@/types/backtest';
import { TradeFeatureRecord } from '@/types/research';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function fmtComparison(c: FeatureComparison): string {
  return `${c.feature.padEnd(28)} d=${c.cohensD !== null ? c.cohensD.toFixed(3).padStart(7) : '   null'} [${c.effectStrength.padEnd(19)}] winMean=${c.winners.mean.toFixed(3)} (n=${c.winners.n}) loseMean=${c.losers.mean.toFixed(3)} (n=${c.losers.n})`;
}

/** Every numeric feature from TradeFeatureRecord worth comparing. */
const NUMERIC_FEATURES: Array<keyof TradeFeatureRecord> = [
  'signalScore', 'riskRewardRatio',
  'rsi14', 'macd', 'macdSignal', 'macdHistogram', 'stochK', 'stochD', 'roc12',
  'adx14', 'plusDI14', 'minusDI14', 'atr14', 'atrPct',
  'bbWidth', 'bbPosition', 'historicalVolatility20',
  'relativeVolume', 'avgDollarVolume30',
  'priceVsSma50Pct', 'priceVsSma200Pct', 'sma50VsSma200Pct', 'distanceFromRecentHighPct',
  'mtfAlignmentScore', 'relativeStrengthVsBenchmark', 'regimeCompositeScore',
];

function extractNumeric(records: TradeFeatureRecord[], feature: keyof TradeFeatureRecord): Array<number | null> {
  return records.map((r) => {
    const v = r[feature];
    return typeof v === 'number' ? v : null;
  });
}

function compareAllFeatures(winners: TradeFeatureRecord[], losers: TradeFeatureRecord[]): FeatureComparison[] {
  return NUMERIC_FEATURES.map((feature) =>
    compareFeature(feature, extractNumeric(winners, feature), extractNumeric(losers, feature))
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
  const sectorMap = getHandCuratedSectorMap();

  logger.info('='.repeat(70));
  logger.info('MOMENTUM_CONTINUATION RESEARCH DIAGNOSTICS');
  logger.info('(diagnostic analysis only — strategy rules unchanged)');
  logger.info('='.repeat(70));

  // --- Rebuild the exact same universe used in the Phase 4.5 report ---------
  const tickers = getFullUniverseTickers();
  const rawCandles = new Map<string, Candle[]>();
  for (const ticker of tickers) {
    const { candles } = await downloader.downloadStock(ticker);
    rawCandles.set(ticker, candles);
  }
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of INDEX_TICKERS) {
    const { candles } = await downloader.downloadStock(idx);
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
    sectorMap,
    maxSectorExposurePct: 0.3,
  };

  const startIndex = 0;
  const endIndex = benchmarkCandles.length - 1;
  const backtester = new Backtester();

  logger.info(`\nUniverse: ${stockTickersAligned.size} stocks, ${benchmarkCandles.length} trading days`);
  logger.info('Running baseline momentum_continuation backtest (unmodified)...');
  await yieldToEventLoop();
  const t0 = Date.now();
  const baseline = backtester.run(new MomentumContinuationStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`[PROFILING] baseline backtest took ${((Date.now() - t0) / 1000).toFixed(1)}s, ${baseline.trades.length} trades`);
  await yieldToEventLoop();

  // ==========================================================================
  // SECTION 3: Feature -> outcome dataset
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 3: FEATURE EXTRACTION');
  logger.info('='.repeat(70));
  const records = extractTradeFeatures(baseline.trades, universe, { sectorMap });
  logger.info(`Extracted ${records.length} feature records (of ${baseline.trades.length} closed trades)`);

  const winners = records.filter((r) => r.won);
  const losers = records.filter((r) => !r.won);
  logger.info(`Winners: ${winners.length} | Losers: ${losers.length}`);

  // ==========================================================================
  // SECTION 1: Regime analysis — winners vs losers within each regime
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 1: REGIME ANALYSIS (winners vs losers, per regime)');
  logger.info('='.repeat(70));

  const regimes = [...new Set(records.map((r) => r.marketRegime).filter((r): r is string => r !== null))];
  for (const regime of regimes) {
    const regimeRecords = records.filter((r) => r.marketRegime === regime);
    const regimeWinners = regimeRecords.filter((r) => r.won);
    const regimeLosers = regimeRecords.filter((r) => !r.won);
    logger.info(`\n--- ${regime} (n=${regimeRecords.length}, ${regimeWinners.length}W/${regimeLosers.length}L) ---`);
    const comparisons = rankFeatureComparisons(compareAllFeatures(regimeWinners, regimeLosers));
    comparisons.slice(0, 8).forEach((c) => logger.info('  ' + fmtComparison(c)));
    await yieldToEventLoop();
  }

  // ==========================================================================
  // SECTION 4: Feature -> outcome ranking (ALL trades, not per-regime)
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 4: FEATURE RANKING (all trades, winners vs losers)');
  logger.info('='.repeat(70));
  const overallComparisons = rankFeatureComparisons(compareAllFeatures(winners, losers));
  overallComparisons.forEach((c) => logger.info(fmtComparison(c)));

  logger.info('\n-- Win rate by categorical feature --');
  const byRegime = winRateByCategory(records.map((r) => r.marketRegime), records.map((r) => r.won));
  byRegime.forEach((c) => logger.info(`  regime=${c.category}: n=${c.n} winRate=${pct(c.winRate)} sufficientSample=${c.sufficientSample}`));
  const bySector = winRateByCategory(records.map((r) => r.sector), records.map((r) => r.won));
  bySector.forEach((c) => logger.info(`  sector=${c.category}: n=${c.n} winRate=${pct(c.winRate)} sufficientSample=${c.sufficientSample}`));
  const byTrendStructure = winRateByCategory(records.map((r) => r.trendStructure), records.map((r) => r.won));
  byTrendStructure.forEach((c) => logger.info(`  trendStructure=${c.category}: n=${c.n} winRate=${pct(c.winRate)} sufficientSample=${c.sufficientSample}`));

  await yieldToEventLoop();

  // ==========================================================================
  // SECTION 5: bullish vs strong_bullish deep-dive
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 5: BULLISH vs STRONG_BULLISH');
  logger.info('='.repeat(70));
  const bullishRecords = records.filter((r) => r.marketRegime === 'bullish');
  const strongBullishRecords = records.filter((r) => r.marketRegime === 'strong_bullish');
  logger.info(`bullish: n=${bullishRecords.length} | strong_bullish: n=${strongBullishRecords.length}`);
  const regimeComparison = rankFeatureComparisons(compareAllFeatures(strongBullishRecords, bullishRecords));
  logger.info('(positive d = higher in strong_bullish; negative d = higher in bullish)');
  regimeComparison.forEach((c) => logger.info(fmtComparison(c)));

  await yieldToEventLoop();

  // ==========================================================================
  // SECTION 2: Stock-concentration re-runs (exclude top winners, re-run engine)
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 2: STOCK-CONCENTRATION RE-RUNS');
  logger.info('(re-running the actual backtest with top winners excluded from the universe)');
  logger.info('='.repeat(70));

  const concentration = analyzeStockConcentration(baseline.trades);
  logger.info('\n-- Baseline (full universe) --');
  logger.info(`Trades: ${baseline.metrics.numTrades} | Unique stocks: ${concentration.uniqueStocks}`);
  logger.info(`Profit factor: ${Number.isFinite(baseline.metrics.profitFactor) ? baseline.metrics.profitFactor.toFixed(2) : 'inf'} | CAGR: ${pct(baseline.metrics.cagr)} | Sharpe: ${baseline.metrics.sharpeRatio.toFixed(2)} | Sortino: ${baseline.metrics.sortinoRatio.toFixed(2)}`);
  logger.info(`Expectancy: $${baseline.metrics.expectancy.toFixed(2)} | Total return: ${pct(baseline.metrics.totalReturn)}`);
  logger.info(`Median stock P&L: $${(concentration.medianContribution).toFixed(2)} | Mean stock P&L: $${(concentration.contributions.reduce((s, c) => s + c.netPnl, 0) / concentration.contributions.length).toFixed(2)}`);
  logger.info(`% stocks profitable: ${pct(concentration.contributions.filter((c) => c.netPnl > 0).length / concentration.contributions.length)}`);
  logger.info(`% stocks positive expectancy: ${pct(concentration.stocksWithPositiveExpectancy / concentration.uniqueStocks)}`);

  for (const n of [1, 3, 5, 10]) {
    const topTickers = concentration.contributions.slice(0, n).map((c) => c.ticker);
    logger.info(`\n-- Excluding top ${n}: ${topTickers.join(', ')} --`);
    await yieldToEventLoop();
    const reducedUniverse = excludeTickersFromUniverse(universe, topTickers);
    const rerunT0 = Date.now();
    const rerun = backtester.run(new MomentumContinuationStrategy(), reducedUniverse, backtestConfig, startIndex, endIndex);
    logger.info(`[PROFILING] took ${((Date.now() - rerunT0) / 1000).toFixed(1)}s`);
    logger.info(`Trades: ${rerun.metrics.numTrades} | Profit factor: ${Number.isFinite(rerun.metrics.profitFactor) ? rerun.metrics.profitFactor.toFixed(2) : 'inf'} | CAGR: ${pct(rerun.metrics.cagr)}`);
    logger.info(`Sharpe: ${rerun.metrics.sharpeRatio.toFixed(2)} | Sortino: ${rerun.metrics.sortinoRatio.toFixed(2)} | Expectancy: $${rerun.metrics.expectancy.toFixed(2)} | Total return: ${pct(rerun.metrics.totalReturn)}`);
    await yieldToEventLoop();
  }

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('DIAGNOSTICS COMPLETE');
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Momentum diagnostics failed:', error);
  process.exit(1);
});
