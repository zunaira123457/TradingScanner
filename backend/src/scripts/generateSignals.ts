/**
 * Phase 3 demonstration: runs the full strategy + scoring + ranking
 * pipeline against real downloaded market data for a watchlist of tickers.
 *
 * Usage:
 *   npm run generate-signals -- AAPL MSFT GOOGL NVDA TSLA
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { StrategyEngine } from '@/strategies/StrategyEngine';
import { TrendPullbackStrategy } from '@/strategies/TrendPullback';
import { BreakoutStrategy } from '@/strategies/Breakout';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { calculateScore, classifySignal } from '@/scoring/ScoringEngine';
import { explainSignal } from '@/scoring/SignalExplainer';
import { rankSignals } from '@/scoring/Ranking';
import { SignalExplanation } from '@/types/scoring';
import { Candle } from '@/types';
import logger from '@/utils/logger';

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
  if (tickers.length === 0) {
    logger.error('Usage: npm run generate-signals -- AAPL MSFT GOOGL NVDA TSLA');
    process.exit(1);
  }

  if (!config.twelveDataApiKey) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);

  const isConnected = await provider.validateConnection();
  if (!isConnected) {
    logger.error('Failed to connect to Twelve Data. Check your API key.');
    process.exit(1);
  }

  logger.info('='.repeat(70));
  logger.info('PHASE 3 SIGNAL GENERATION');
  logger.info('='.repeat(70));

  // Load market regime index data
  const indexTickers = ['SPY', 'QQQ', 'IWM'];
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of indexTickers) {
    try {
      const { candles } = await downloader.downloadStock(idx);
      indexCandles.set(idx, candles);
    } catch (error) {
      logger.warn(`Could not load index data for ${idx}: ${error instanceof Error ? error.message : error}`);
    }
  }
  const benchmarkCandles = indexCandles.get('SPY');

  const engine = new StrategyEngine();
  engine.register(new TrendPullbackStrategy());
  engine.register(new BreakoutStrategy());
  engine.register(new MomentumContinuationStrategy());

  const explanations: SignalExplanation[] = [];

  for (const ticker of tickers) {
    try {
      const { candles } = await downloader.downloadStock(ticker);
      const context = buildStrategyContext(ticker, candles, {
        marketIndexCandles: indexCandles.size > 0 ? indexCandles : undefined,
        benchmarkCandles,
      });

      const results = engine.evaluateAll(context);

      for (const result of results) {
        const scoreBreakdown = calculateScore(context, result);
        const classification = classifySignal(scoreBreakdown.total, result.setupDetected);
        const explanation = explainSignal(context, result, scoreBreakdown, classification);
        explanations.push(explanation);
      }

      logger.info(`✓ ${ticker}: evaluated ${results.length} strategies`);
    } catch (error) {
      logger.warn(`✗ ${ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const ranked = rankSignals(explanations);

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('RANKED SIGNALS (all strategies, all tickers)');
  logger.info('='.repeat(70));
  logger.info(
    'Rank | Ticker | Strategy               | Score | Signal | R:R  | Entry    Stop      Target'
  );
  ranked.forEach((r) => {
    logger.info(
      `${String(r.rank).padStart(4)} | ${r.ticker.padEnd(6)} | ${r.strategy.padEnd(22)} | ${r.score.toFixed(1).padStart(5)} | ${r.classification.padEnd(6)} | ${r.riskRewardRatio !== null ? r.riskRewardRatio.toFixed(2).padStart(4) : ' n/a'} | ${r.entry !== null ? '$' + r.entry.toFixed(2) : 'n/a'.padStart(8)}  ${r.stop !== null ? '$' + r.stop.toFixed(2) : 'n/a'}  ${r.target !== null ? '$' + r.target.toFixed(2) : 'n/a'}`
    );
  });

  // Full explanation for the top signal (if any BUY/WATCH exists)
  const topActionable = ranked.find((r) => r.classification !== 'AVOID');
  if (topActionable) {
    const fullExplanation = explanations.find(
      (e) => e.ticker === topActionable.ticker && e.strategy === topActionable.strategy
    ) as SignalExplanation;

    logger.info(`\n${'='.repeat(70)}`);
    logger.info(`TOP SIGNAL DETAIL: ${fullExplanation.ticker} — ${fullExplanation.strategy}`);
    logger.info('='.repeat(70));
    logger.info(`Classification: ${fullExplanation.classification}`);
    logger.info(`Score: ${fullExplanation.score.toFixed(1)}/100`);
    logger.info(
      `  Trend: ${fullExplanation.scoreBreakdown.trend.toFixed(1)} | Momentum: ${fullExplanation.scoreBreakdown.momentum.toFixed(1)} | Volume: ${fullExplanation.scoreBreakdown.volume.toFixed(1)}`
    );
    logger.info(
      `  Relative Strength: ${fullExplanation.scoreBreakdown.relativeStrength.toFixed(1)} | Chart Setup: ${fullExplanation.scoreBreakdown.chartSetup.toFixed(1)} | Market Regime: ${fullExplanation.scoreBreakdown.marketRegime.toFixed(1)} | Risk/Reward: ${fullExplanation.scoreBreakdown.riskReward.toFixed(1)}`
    );
    logger.info(
      `Entry: $${fullExplanation.entry?.toFixed(2)} | Stop: $${fullExplanation.stop?.toFixed(2)} | Target: $${fullExplanation.target?.toFixed(2)} | R:R: ${fullExplanation.riskRewardRatio?.toFixed(2)}`
    );
    logger.info('\nReasons:');
    fullExplanation.reasons.forEach((r) => logger.info(`  ✓ ${r}`));
    logger.info('\nRisks:');
    fullExplanation.risks.forEach((r) => logger.info(`  ⚠ ${r}`));
    logger.info(`\nInvalidation: ${fullExplanation.invalidation}`);
  } else {
    logger.info('\nNo BUY or WATCH signals found among the evaluated tickers/strategies.');
  }

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('IMPORTANT: These are rule-based signals with NO historical backtesting yet.');
  logger.info('Historical win-rate/return statistics are Phase 4 work. Do not treat any');
  logger.info('score or classification here as a probability of profit.');
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Signal generation script failed:', error);
  process.exit(1);
});
