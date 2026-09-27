/**
 * Phase 5 demonstration: runs the same Phase 3 strategy/scoring/ranking
 * pipeline as generateSignals.ts, then adds the read-only AI explanation
 * layer on top of the top-ranked actionable signal.
 *
 * This does not change generateSignals.ts or anything upstream of it — the
 * AI layer is strictly additive, and the quantitative ranking/classification
 * shown here is identical to what generateSignals.ts would produce.
 *
 * Usage:
 *   npm run analyze-signal-ai -- AAPL MSFT GOOGL NVDA TSLA
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
import { StrategyContext, StrategyResult } from '@/types/strategy';
import { Candle } from '@/types';
import { SignalAnalysisService } from '@/ai/SignalAnalysisService';
import { AnthropicAnalysisProvider } from '@/ai/AnthropicAnalysisProvider';
import { JsonHistoricalStrategyStats } from '@/research/HistoricalStrategyStats';
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
    logger.error('Usage: npm run analyze-signal-ai -- AAPL MSFT GOOGL NVDA TSLA');
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
  const contextsByKey = new Map<string, { context: StrategyContext; result: StrategyResult }>();

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
        contextsByKey.set(`${ticker}:${result.strategy}`, { context, result });
      }

      logger.info(`✓ ${ticker}: evaluated ${results.length} strategies`);
    } catch (error) {
      logger.warn(`✗ ${ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Deterministic ranking, unchanged by the AI layer — the AI never
  // reorders or re-scores candidates the ScoringEngine already ranked.
  const ranked = rankSignals(explanations);
  const topActionable = ranked.find((r) => r.classification !== 'AVOID');

  if (!topActionable) {
    logger.info('No BUY or WATCH signals found among the evaluated tickers/strategies.');
    return;
  }

  const explanation = explanations.find(
    (e) => e.ticker === topActionable.ticker && e.strategy === topActionable.strategy
  ) as SignalExplanation;
  const { context, result } = contextsByKey.get(`${topActionable.ticker}:${topActionable.strategy}`)!;

  logger.info('='.repeat(70));
  logger.info(`QUANTITATIVE SIGNAL — ${explanation.ticker} / ${explanation.strategy}`);
  logger.info('='.repeat(70));
  logger.info(`Classification: ${explanation.classification}`);
  logger.info(`Score: ${explanation.score.toFixed(1)}/100`);
  logger.info(
    `Entry: ${explanation.entry?.toFixed(2) ?? 'n/a'} | Stop: ${explanation.stop?.toFixed(2) ?? 'n/a'} | Target: ${explanation.target?.toFixed(2) ?? 'n/a'}`
  );

  const historicalStats = new JsonHistoricalStrategyStats();
  const aiProvider = config.anthropicApiKey
    ? new AnthropicAnalysisProvider(config.anthropicApiKey, config.anthropicModel)
    : null;
  const analysisService = new SignalAnalysisService(aiProvider, historicalStats, {
    timeoutMs: config.aiAnalysisTimeoutMs,
  });

  const outcome = await analysisService.analyze(context, result, explanation);

  logger.info('');
  logger.info('='.repeat(70));
  logger.info('AI INTERPRETATION — AI-generated explanation, NOT a trading signal');
  logger.info(`(source: ${outcome.source}${outcome.status === 'fallback' ? `, reason: ${outcome.reason}` : ''})`);
  logger.info('='.repeat(70));
  logger.info(outcome.result.summary);
  logger.info(`Status: ${outcome.result.signalStatus}`);
  logger.info(`Quantitative score note: ${outcome.result.quantitativeScore.note}`);
  logger.info('Supporting evidence:');
  outcome.result.supportingEvidence.forEach((e) => logger.info(`  + ${e}`));
  logger.info('Conflicting evidence:');
  outcome.result.conflictingEvidence.forEach((e) => logger.info(`  - ${e}`));
  logger.info('Risk flags:');
  outcome.result.riskFlags.forEach((r) => logger.info(`  ! ${r}`));
  logger.info('Limitations:');
  outcome.result.limitations.forEach((l) => logger.info(`  * ${l}`));
  logger.info(`AI confidence: ${outcome.result.aiConfidence ?? 'not provided (Phase 5 does not calibrate a confidence score)'}`);
}

main().catch((error) => {
  logger.error('Signal analysis script failed:', error);
  process.exit(1);
});
