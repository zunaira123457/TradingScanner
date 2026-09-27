/**
 * Phase 4 demonstration: runs the full backtesting engine against real
 * downloaded market data — strategy comparison, benchmark comparison,
 * walk-forward validation, and parameter sensitivity analysis.
 *
 * Usage:
 *   npm run run-backtest
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
import { TrendPullbackStrategy } from '@/strategies/TrendPullback';
import { BreakoutStrategy } from '@/strategies/Breakout';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { BacktestConfig, BacktestUniverse, BacktestResult } from '@/types/backtest';
import { Strategy } from '@/types/strategy';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const STOCK_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA'];
const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];
const WINDOW_DAYS = 1666; // full cached history (~2020-2026): COVID crash, 2022 bear market, 2023-2025 bull run

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function printMetrics(label: string, result: BacktestResult): void {
  const m = result.metrics;
  logger.info(`\n--- ${label} ---`);
  logger.info(`Trades: ${m.numTrades} | Win rate: ${pct(m.winRate)} | Avg holding: ${m.avgHoldingPeriodDays.toFixed(1)}d`);
  logger.info(`Total return: ${pct(m.totalReturn)} | CAGR: ${pct(m.cagr)}`);
  logger.info(`Avg win: $${m.avgWin.toFixed(2)} | Avg loss: $${m.avgLoss.toFixed(2)} | Profit factor: ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf'}`);
  logger.info(`Expectancy: $${m.expectancy.toFixed(2)}/trade | Best: $${m.bestTrade.toFixed(2)} | Worst: $${m.worstTrade.toFixed(2)}`);
  logger.info(`Sharpe: ${m.sharpeRatio.toFixed(2)} | Sortino: ${m.sortinoRatio.toFixed(2)} | Max drawdown: ${pct(m.maxDrawdown)}`);
  logger.info(`Max consecutive wins: ${m.maxConsecutiveWins} | Max consecutive losses: ${m.maxConsecutiveLosses}`);
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

  logger.info('='.repeat(70));
  logger.info('PHASE 4 BACKTESTING — REAL DATA RUN');
  logger.info('='.repeat(70));

  // --- Load and align the universe ---------------------------------------
  const stockCandles = new Map<string, Candle[]>();
  for (const ticker of STOCK_TICKERS) {
    const { candles } = await downloader.downloadStock(ticker);
    stockCandles.set(ticker, candles.slice(-WINDOW_DAYS));
  }

  const indexCandles = new Map<string, Candle[]>();
  for (const ticker of INDEX_TICKERS) {
    const { candles } = await downloader.downloadStock(ticker);
    indexCandles.set(ticker, candles.slice(-WINDOW_DAYS));
  }
  const benchmarkCandles = indexCandles.get('SPY') as Candle[];

  const universe: BacktestUniverse = {
    tickers: stockCandles,
    benchmarkCandles,
    indexCandles,
  };

  const startDate = benchmarkCandles[0].timestamp.toISOString().slice(0, 10);
  const endDate = benchmarkCandles[benchmarkCandles.length - 1].timestamp.toISOString().slice(0, 10);
  logger.info(`Universe: ${STOCK_TICKERS.join(', ')} | Indices: ${INDEX_TICKERS.join(', ')}`);
  logger.info(`Date range: ${startDate} to ${endDate} (${WINDOW_DAYS} trading days)`);

  const startIndex = 0;
  const endIndex = benchmarkCandles.length - 1;

  const backtestConfig: BacktestConfig = {
    startingCapital: 100000,
    maxRiskPerTradePct: 0.01,
    maxPositions: 5,
    maxPortfolioExposurePct: 0.8,
    slippageBps: 5,
    commissionBps: 2,
    fractionalShares: false,
  };

  const backtester = new Backtester();

  // --- Run each strategy ---------------------------------------------------
  const strategies: Strategy[] = [
    new TrendPullbackStrategy(),
    new BreakoutStrategy(),
    new MomentumContinuationStrategy(),
    new SmaCrossoverStrategy(),
  ];

  const results: BacktestResult[] = [];
  for (const strategy of strategies) {
    logger.info(`\nRunning ${strategy.name}...`);
    const result = backtester.run(strategy, universe, backtestConfig, startIndex, endIndex);
    results.push(result);
    printMetrics(strategy.name, result);
  }

  // --- Benchmark 1: Buy-and-hold S&P 500 ------------------------------------
  const buyHold = buyAndHoldBenchmark(benchmarkCandles, backtestConfig, startIndex, endIndex);
  printMetrics('buy_and_hold_SPY', buyHold);

  // --- Strategy comparison table --------------------------------------------
  logger.info(`\n${'='.repeat(90)}`);
  logger.info('STRATEGY COMPARISON');
  logger.info('='.repeat(90));
  logger.info('Strategy                | Trades | WinRate | ProfitFactor | Expectancy | CAGR    | MaxDD   | Sharpe');
  const allForTable = [...results, buyHold];
  for (const r of allForTable) {
    const m = r.metrics;
    logger.info(
      `${r.strategyName.padEnd(24)} | ${String(m.numTrades).padStart(6)} | ${pct(m.winRate).padStart(7)} | ${(Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf').padStart(12)} | $${m.expectancy.toFixed(2).padStart(9)} | ${pct(m.cagr).padStart(7)} | ${pct(m.maxDrawdown).padStart(7)} | ${m.sharpeRatio.toFixed(2).padStart(6)}`
    );
  }

  // --- Walk-forward validation (Trend Pullback) -----------------------------
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('WALK-FORWARD VALIDATION: trend_pullback');
  logger.info('(fixed-rule strategy across sequential out-of-sample windows — NOT parameter optimization)');
  logger.info('='.repeat(70));

  const wfResult = runWalkForward(
    backtester,
    new TrendPullbackStrategy(),
    universe,
    backtestConfig,
    { minHistoryDays: 210, windowDays: 126, stepDays: 126 }
  );

  wfResult.windows.forEach((w) => {
    const start = benchmarkCandles[w.window.testStart].timestamp.toISOString().slice(0, 10);
    const end = benchmarkCandles[w.window.testEnd].timestamp.toISOString().slice(0, 10);
    logger.info(
      `Window ${w.window.index} (${start} to ${end}): trades=${w.result.metrics.numTrades} winRate=${pct(w.result.metrics.winRate)} profitFactor=${Number.isFinite(w.result.metrics.profitFactor) ? w.result.metrics.profitFactor.toFixed(2) : 'inf'} totalReturn=${pct(w.result.metrics.totalReturn)}`
    );
  });
  logger.info(
    `\nWin rate: mean=${pct(wfResult.consistency.winRateMean)} stdDev=${pct(wfResult.consistency.winRateStdDev)} CV=${wfResult.consistency.winRateCV.toFixed(2)}`
  );
  logger.info(
    `Profit factor: mean=${wfResult.consistency.profitFactorMean.toFixed(2)} stdDev=${wfResult.consistency.profitFactorStdDev.toFixed(2)} CV=${wfResult.consistency.profitFactorCV.toFixed(2)}`
  );
  logger.info(`Consistent across windows (heuristic): ${wfResult.consistency.isConsistent}`);

  // --- Parameter sensitivity (Trend Pullback reward multiple) --------------
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('PARAMETER SENSITIVITY: trend_pullback.rewardMultiple');
  logger.info('(never selects a "best" value — only measures stability across nearby values)');
  logger.info('='.repeat(70));

  const sensitivityResult = runParameterSensitivity(
    backtester,
    (v) => new TrendPullbackStrategy({ rewardMultiple: v }),
    universe,
    backtestConfig,
    startIndex,
    endIndex,
    'rewardMultiple',
    [1.5, 2.0, 2.5, 3.0]
  );

  sensitivityResult.points.forEach((p) => {
    logger.info(
      `rewardMultiple=${p.paramValue}: trades=${p.metrics.numTrades} winRate=${pct(p.metrics.winRate)} totalReturn=${pct(p.metrics.totalReturn)} profitFactor=${Number.isFinite(p.metrics.profitFactor) ? p.metrics.profitFactor.toFixed(2) : 'inf'}`
    );
  });
  logger.info(`\nTotal return CV: ${sensitivityResult.totalReturnCV.toFixed(2)} | Sign flips across range: ${sensitivityResult.signFlips}`);
  logger.info(`Robust (heuristic): ${sensitivityResult.isRobust}`);

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('IMPORTANT: These are historical backtest results on a small universe');
  logger.info('over a limited date range with a fixed rule set. NONE of this is a');
  logger.info('guarantee of future performance. Trade counts here are too small for');
  logger.info('most of these numbers to be statistically meaningful on their own —');
  logger.info('treat them as a demonstration of the engine, not a trading recommendation.');
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Backtest run failed:', error);
  process.exit(1);
});
