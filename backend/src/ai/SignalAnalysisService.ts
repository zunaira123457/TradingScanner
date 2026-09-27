import { StrategyContext, StrategyResult } from '@/types/strategy';
import { SignalExplanation } from '@/types/scoring';
import { AIAnalysisOutcome } from '@/types/ai';
import { AIAnalysisProvider } from '@/ai/AIAnalysisProvider';
import { buildAIAnalysisContext } from '@/ai/AIAnalysisContext';
import { buildDeterministicFallback } from '@/ai/deterministicFallback';
import { HistoricalStrategyStats } from '@/research/HistoricalStrategyStats';
import logger from '@/utils/logger';

export interface SignalAnalysisServiceOptions {
  timeoutMs?: number;
}

/**
 * Orchestrates the Phase 5 AI layer: builds the point-in-time-safe context,
 * calls the configured AIAnalysisProvider under a timeout, and falls back to
 * a purely deterministic explanation (buildDeterministicFallback) on ANY
 * failure — provider error, timeout, or malformed output. The deterministic
 * quantitative pipeline (Strategy -> ScoringEngine -> SignalExplainer) never
 * depends on this succeeding; see PROJECT_STATE.md Section 0.7.
 */
export class SignalAnalysisService {
  private readonly timeoutMs: number;

  constructor(
    private provider: AIAnalysisProvider | null,
    private historicalStats: HistoricalStrategyStats,
    options: SignalAnalysisServiceOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  async analyze(
    context: StrategyContext,
    strategyResult: StrategyResult,
    explanation: SignalExplanation
  ): Promise<AIAnalysisOutcome> {
    const aiContext = buildAIAnalysisContext(context, strategyResult, explanation, this.historicalStats);

    const logMeta = {
      strategy: aiContext.strategy,
      ticker: aiContext.ticker,
      signalDate: aiContext.asOfDate.toISOString(),
      provider: this.provider?.name ?? 'none',
    };

    if (!this.provider) {
      logger.info({ ...logMeta, result: 'fallback', reason: 'no_provider_configured' }, 'AI analysis skipped');
      return {
        status: 'fallback',
        result: buildDeterministicFallback(aiContext),
        source: 'deterministic_fallback',
        reason: 'no_provider_configured',
      };
    }

    const startedAt = Date.now();
    try {
      const result = await this.withTimeout(this.provider.analyze(aiContext), this.timeoutMs);
      logger.info(
        { ...logMeta, result: 'ok', latencyMs: Date.now() - startedAt, schemaValid: true },
        'AI analysis succeeded'
      );
      return { status: 'ok', result, source: 'ai' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        { ...logMeta, result: 'fallback', latencyMs: Date.now() - startedAt, reason },
        'AI analysis failed — falling back to deterministic explanation'
      );
      return {
        status: 'fallback',
        result: buildDeterministicFallback(aiContext),
        source: 'deterministic_fallback',
        reason,
      };
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`AI analysis timed out after ${ms}ms`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
}
