/**
 * Phase 4.5: comprehensive expanded-universe backtest.
 *
 * Runs Momentum Continuation FIRST (unmodified, per instruction), then
 * Trend Pullback, then Breakout, across the 81-ticker hand-curated
 * universe, with year-by-year, market-regime, sector, and stock-
 * concentration breakdowns, benchmark comparison, walk-forward validation,
 * parameter sensitivity, and statistical evidence classification.
 *
 * Usage:
 *   npm run run-expanded-backtest
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { Backtester } from '@/backtesting/Backtester';
import { buyAndHoldBenchmark } from '@/backtesting/BuyAndHold';
import { SmaCrossoverStrategy } from '@/backtesting/SmaCrossoverStrategy';
import { runWalkForward } from '@/backtesting/WalkForward';
import { runParameterSensitivity } from '@/backtesting/SensitivityAnalysis';
import { auditUniverse } from '@/backtesting/DataQualityAudit';
import { alignSeriesByDate } from '@/backtesting/CalendarAlignment';
import { analyzeByYear, analyzeByRegime, analyzeBySector, analyzeStockConcentration } from '@/backtesting/TradeAnalytics';
import { wilsonScoreInterval, classifyEvidence } from '@/backtesting/StatisticalEvidence';
import { calculateDailyReturns, calculateSharpeRatio } from '@/backtesting/Metrics';
import { TrendPullbackStrategy } from '@/strategies/TrendPullback';
import { BreakoutStrategy } from '@/strategies/Breakout';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { getFullUniverseTickers, getHandCuratedSectorMap, UNIVERSE_BY_SECTOR } from './downloadUniverse';
import { SURVIVORSHIP_BIAS_DISCLOSURE } from '@/data/PointInTimeUniverse';
import { BacktestConfig, BacktestUniverse, BacktestResult } from '@/types/backtest';
import { Strategy } from '@/types/strategy';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

/**
 * Backtester.run() and friends are fully synchronous CPU-bound calls with
 * no internal awaits. Called back-to-back with no yield point between them,
 * the ENTIRE script (all 4 backtests + walk-forward + sensitivity sweep,
 * ~35 minutes of real computation at this universe size) runs as one
 * unbroken synchronous block — nothing can flush to the log until all of
 * it finishes. This yields control back to the event loop so buffered
 * output (and the pino worker-thread transport) actually gets flushed
 * between sections, giving real progress visibility during a long run.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function printFullMetrics(label: string, result: BacktestResult, sectorMap: Map<string, string>): void {
  const m = result.metrics;
  const closedTrades = result.trades.filter((t) => t.status === 'closed' && t.netPnl !== null);
  const returns = closedTrades.map((t) => t.netPnl as number);
  const medianReturn = median(returns);
  const dailyReturns = calculateDailyReturns(result.equityCurve);
  const annualizedVol = dailyReturns.length > 0
    ? Math.sqrt(dailyReturns.reduce((s, r) => s + r * r, 0) / dailyReturns.length) * Math.sqrt(252)
    : 0;

  const byYear = analyzeByYear(result.trades);
  const profitableYears = byYear.filter((y) => y.netPnl > 0).length;
  const losingYears = byYear.filter((y) => y.netPnl < 0).length;

  logger.info(`\n${'='.repeat(70)}`);
  logger.info(`${label.toUpperCase()}`);
  logger.info('='.repeat(70));
  logger.info(`Trades: ${m.numTrades} | Unique stocks: ${new Set(closedTrades.map((t) => t.ticker)).size} | Win rate: ${pct(m.winRate)}`);
  logger.info(`Total return: ${pct(m.totalReturn)} | CAGR: ${pct(m.cagr)} | Annualized volatility: ${pct(annualizedVol)}`);
  logger.info(`Avg win: $${m.avgWin.toFixed(2)} | Avg loss: $${m.avgLoss.toFixed(2)} | Median trade: $${medianReturn.toFixed(2)}`);
  logger.info(`Profit factor: ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf'} | Expectancy: $${m.expectancy.toFixed(2)}/trade`);
  logger.info(`Best trade: $${m.bestTrade.toFixed(2)} | Worst trade: $${m.worstTrade.toFixed(2)} | Avg holding: ${m.avgHoldingPeriodDays.toFixed(1)}d`);
  logger.info(`Sharpe: ${m.sharpeRatio.toFixed(2)} | Sortino: ${m.sortinoRatio.toFixed(2)} | Max drawdown: ${pct(m.maxDrawdown)}`);
  logger.info(`Max consecutive wins: ${m.maxConsecutiveWins} | Max consecutive losses: ${m.maxConsecutiveLosses}`);
  logger.info(`Profitable years: ${profitableYears}/${byYear.length} | Losing years: ${losingYears}/${byYear.length}`);

  const wilson = wilsonScoreInterval(closedTrades.filter((t) => (t.netPnl as number) > 0).length, closedTrades.length);
  logger.info(`Win rate 95% CI (Wilson score, i.i.d. assumption): [${pct(wilson.lower)}, ${pct(wilson.upper)}]`);

  logger.info('\n-- Year-by-year --');
  byYear.forEach((y) => {
    logger.info(`  ${y.label}: trades=${y.trades} winRate=${pct(y.winRate)} netPnl=$${y.netPnl.toFixed(2)} profitFactor=${Number.isFinite(y.profitFactor) ? y.profitFactor.toFixed(2) : 'inf'}`);
  });

  logger.info('\n-- Market regime --');
  analyzeByRegime(result.trades).forEach((r) => {
    logger.info(`  ${r.label}: trades=${r.trades} winRate=${pct(r.winRate)} profitFactor=${Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : 'inf'} expectancy=$${r.expectancy.toFixed(2)} avgReturn=$${r.avgReturn.toFixed(2)}`);
  });

  logger.info('\n-- Sector (hand-curated labels, see downloadUniverse.ts) --');
  analyzeBySector(result.trades, sectorMap).forEach((s) => {
    logger.info(`  ${s.label}: trades=${s.trades} winRate=${pct(s.winRate)} profitFactor=${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf'} avgReturn=$${s.avgReturn.toFixed(2)}`);
  });

  const concentration = analyzeStockConcentration(result.trades);
  logger.info('\n-- Stock concentration --');
  logger.info(`  Unique stocks traded: ${concentration.uniqueStocks}`);
  logger.info(`  Top 5 stocks' share of total P&L: ${concentration.top5PctOfTotalPnl.toFixed(1)}%`);
  logger.info(`  Median stock P&L contribution: $${concentration.medianContribution.toFixed(2)}`);
  logger.info(`  Stocks with positive expectancy: ${concentration.stocksWithPositiveExpectancy} | negative: ${concentration.stocksWithNegativeExpectancy}`);
  logger.info('  Top 10 by P&L:');
  concentration.top10.forEach((c, i) => {
    logger.info(`    ${i + 1}. ${c.ticker}: netPnl=$${c.netPnl.toFixed(2)} trades=${c.trades} winRate=${pct(c.winRate)}`);
  });
}

async function main() {
  const startTime = Date.now();
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
  logger.info('PHASE 4.5 EXPANDED MARKET VALIDATION');
  logger.info('='.repeat(70));
  logger.info(SURVIVORSHIP_BIAS_DISCLOSURE);

  // -- Load raw candles for the full universe + indices ----------------------
  const tickers = getFullUniverseTickers();
  logger.info(`\nLoading ${tickers.length} tickers (from cache; already downloaded)...`);
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

  // -- Data quality audit: exclude, don't silently include, bad data --------
  const audit = auditUniverse(rawCandles);
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('DATA QUALITY AUDIT');
  logger.info('='.repeat(70));
  logger.info(`Usable: ${audit.validTickers.length}/${audit.totalTickers}`);
  if (audit.excludedTickers.length > 0) {
    logger.info(`Excluded (${audit.excludedTickers.length}):`);
    audit.excludedTickers.forEach((e) => logger.info(`  ${e.ticker}: ${e.reasons.join(', ')}`));
  }

  const usableCandles = new Map<string, Candle[]>();
  for (const ticker of audit.validTickers) {
    usableCandles.set(ticker, rawCandles.get(ticker) as Candle[]);
  }

  // -- Calendar alignment: join by REAL date, not raw array index -----------
  const allSeries = new Map<string, Candle[]>([...usableCandles, ...indexCandles]);
  const { aligned, report: alignmentReport } = alignSeriesByDate(allSeries);

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('CALENDAR ALIGNMENT');
  logger.info('='.repeat(70));
  logger.info(`Common trading dates across all series: ${alignmentReport.commonDates}`);
  logger.info(`Unexpected gaps detected: ${alignmentReport.unexpectedGaps.length}`);
  if (alignmentReport.unexpectedGaps.length > 0 && alignmentReport.unexpectedGaps.length <= 20) {
    alignmentReport.unexpectedGaps.forEach((g) => logger.info(`  ${g.label}: missing ${g.date}`));
  }

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

  const startDate = benchmarkCandles[0].timestamp.toISOString().slice(0, 10);
  const endDate = benchmarkCandles[benchmarkCandles.length - 1].timestamp.toISOString().slice(0, 10);
  logger.info(`\nFinal universe: ${stockTickersAligned.size} stocks, ${startDate} to ${endDate} (${benchmarkCandles.length} trading days)`);

  const startIndex = 0;
  const endIndex = benchmarkCandles.length - 1;

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

  const backtester = new Backtester();

  // -- Momentum Continuation FIRST (per instruction, unmodified) -------------
  logger.info('\nStarting momentum_continuation backtest (81 tickers x ~1666 days)...');
  await yieldToEventLoop();
  let t0 = Date.now();
  const momentumResult = backtester.run(new MomentumContinuationStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`\n[PROFILING] momentum_continuation backtest took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printFullMetrics('momentum_continuation', momentumResult, sectorMap);
  await yieldToEventLoop();

  // -- Trend Pullback ---------------------------------------------------------
  logger.info('\nStarting trend_pullback backtest...');
  await yieldToEventLoop();
  t0 = Date.now();
  const trendPullbackResult = backtester.run(new TrendPullbackStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`\n[PROFILING] trend_pullback backtest took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printFullMetrics('trend_pullback', trendPullbackResult, sectorMap);
  await yieldToEventLoop();

  // -- Breakout -----------------------------------------------------------
  logger.info('\nStarting breakout backtest...');
  await yieldToEventLoop();
  t0 = Date.now();
  const breakoutResult = backtester.run(new BreakoutStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`\n[PROFILING] breakout backtest took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printFullMetrics('breakout', breakoutResult, sectorMap);
  await yieldToEventLoop();

  // -- Benchmarks -------------------------------------------------------------
  logger.info('\nStarting sma_crossover backtest...');
  await yieldToEventLoop();
  t0 = Date.now();
  const smaResult = backtester.run(new SmaCrossoverStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`\n[PROFILING] sma_crossover backtest took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printFullMetrics('sma_crossover (benchmark)', smaResult, sectorMap);
  await yieldToEventLoop();

  const buyHold = buyAndHoldBenchmark(benchmarkCandles, backtestConfig, startIndex, endIndex);
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('BUY_AND_HOLD_SPY (BENCHMARK)');
  logger.info('='.repeat(70));
  const bhReturns = calculateDailyReturns(buyHold.equityCurve);
  const bhVol = bhReturns.length > 0 ? Math.sqrt(bhReturns.reduce((s, r) => s + r * r, 0) / bhReturns.length) * Math.sqrt(252) : 0;
  logger.info(`Total return: ${pct(buyHold.metrics.totalReturn)} | CAGR: ${pct(buyHold.metrics.cagr)} | Volatility: ${pct(bhVol)}`);
  logger.info(`Sharpe: ${buyHold.metrics.sharpeRatio.toFixed(2)} | Sortino: ${buyHold.metrics.sortinoRatio.toFixed(2)} | Max drawdown: ${pct(buyHold.metrics.maxDrawdown)}`);

  // -- Strategy comparison table ------------------------------------------
  logger.info(`\n${'='.repeat(100)}`);
  logger.info('STRATEGY COMPARISON (expanded universe)');
  logger.info('='.repeat(100));
  logger.info('Strategy                 | Stocks | Trades | WinRate | ProfitFactor | CAGR    | MaxDD   | Sharpe | Sortino');
  const table = [
    { name: 'momentum_continuation', result: momentumResult },
    { name: 'trend_pullback', result: trendPullbackResult },
    { name: 'breakout', result: breakoutResult },
    { name: 'sma_crossover', result: smaResult },
    { name: 'buy_and_hold_SPY', result: buyHold },
  ];
  table.forEach(({ name, result }) => {
    const m = result.metrics;
    const uniqueStocks = new Set(result.trades.map((t) => t.ticker)).size;
    logger.info(
      `${name.padEnd(25)} | ${String(uniqueStocks).padStart(6)} | ${String(m.numTrades).padStart(6)} | ${pct(m.winRate).padStart(7)} | ${(Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf').padStart(12)} | ${pct(m.cagr).padStart(7)} | ${pct(m.maxDrawdown).padStart(7)} | ${m.sharpeRatio.toFixed(2).padStart(6)} | ${m.sortinoRatio.toFixed(2)}`
    );
  });

  // -- Walk-forward validation (Momentum Continuation) -----------------------
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('WALK-FORWARD VALIDATION: momentum_continuation');
  logger.info('(fixed-rule strategy across sequential out-of-sample windows — NOT parameter optimization)');
  logger.info('='.repeat(70));
  await yieldToEventLoop();
  t0 = Date.now();
  const wfResult = runWalkForward(backtester, new MomentumContinuationStrategy(), universe, backtestConfig, {
    minHistoryDays: 210,
    windowDays: 126,
    stepDays: 126,
  });
  logger.info(`[PROFILING] walk-forward took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  wfResult.windows.forEach((w) => {
    const s = benchmarkCandles[w.window.testStart].timestamp.toISOString().slice(0, 10);
    const e = benchmarkCandles[w.window.testEnd].timestamp.toISOString().slice(0, 10);
    logger.info(`Window ${w.window.index} (${s} to ${e}): trades=${w.result.metrics.numTrades} winRate=${pct(w.result.metrics.winRate)} profitFactor=${Number.isFinite(w.result.metrics.profitFactor) ? w.result.metrics.profitFactor.toFixed(2) : 'inf'} totalReturn=${pct(w.result.metrics.totalReturn)}`);
  });
  logger.info(`\nWin rate: mean=${pct(wfResult.consistency.winRateMean)} stdDev=${pct(wfResult.consistency.winRateStdDev)} CV=${wfResult.consistency.winRateCV.toFixed(2)}`);
  logger.info(`Profit factor: mean=${wfResult.consistency.profitFactorMean.toFixed(2)} CV=${wfResult.consistency.profitFactorCV.toFixed(2)}`);
  logger.info(`Consistent across windows (heuristic): ${wfResult.consistency.isConsistent}`);

  // -- Parameter sensitivity (Momentum Continuation: minAdx) -----------------
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('PARAMETER SENSITIVITY: momentum_continuation.minAdx');
  logger.info('='.repeat(70));
  await yieldToEventLoop();
  t0 = Date.now();
  const sensitivity = runParameterSensitivity(
    backtester,
    (v) => new MomentumContinuationStrategy({ minAdx: v }),
    universe,
    backtestConfig,
    startIndex,
    endIndex,
    'minAdx',
    [15, 20, 25, 30, 35]
  );
  logger.info(`[PROFILING] sensitivity sweep took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  sensitivity.points.forEach((p) => {
    logger.info(`minAdx=${p.paramValue}: trades=${p.metrics.numTrades} winRate=${pct(p.metrics.winRate)} totalReturn=${pct(p.metrics.totalReturn)} profitFactor=${Number.isFinite(p.metrics.profitFactor) ? p.metrics.profitFactor.toFixed(2) : 'inf'} maxDD=${pct(p.metrics.maxDrawdown)} sharpe=${p.metrics.sharpeRatio.toFixed(2)}`);
  });
  logger.info(`\nTotal return CV: ${sensitivity.totalReturnCV.toFixed(2)} | Sign flips: ${sensitivity.signFlips} | Robust (heuristic): ${sensitivity.isRobust}`);

  // -- Statistical evidence classification ------------------------------------
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('STATISTICAL EVIDENCE CLASSIFICATION');
  logger.info('='.repeat(70));
  const regimesCovered = new Set(momentumResult.trades.map((t) => t.marketRegimeAtEntry).filter(Boolean)).size;
  const yearsCovered = analyzeByYear(momentumResult.trades).length;
  const evidence = classifyEvidence({
    numTrades: momentumResult.metrics.numTrades,
    uniqueStocks: new Set(momentumResult.trades.map((t) => t.ticker)).size,
    yearsCovered,
    regimesCovered,
    outOfSampleConsistent: wfResult.consistency.isConsistent,
    parameterRobust: sensitivity.isRobust,
  });
  logger.info(`momentum_continuation: ${evidence.level}`);
  evidence.reasons.forEach((r) => logger.info(`  - ${r}`));

  logger.info(`\n${'='.repeat(70)}`);
  logger.info(`TOTAL RUNTIME: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Expanded backtest failed:', error);
  process.exit(1);
});
