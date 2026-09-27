import { SignalAnalysisService } from '@/ai/SignalAnalysisService';
import { AIAnalysisProvider } from '@/ai/AIAnalysisProvider';
import { NullHistoricalStrategyStats } from '@/research/HistoricalStrategyStats';
import { AIAnalysisContext, AIAnalysisOutcome, AIAnalysisResult } from '@/types/ai';
import { makeOscillatingCandles, buildPipelineAt } from './fixtures';

function expectFallback(outcome: AIAnalysisOutcome): Extract<AIAnalysisOutcome, { status: 'fallback' }> {
  if (outcome.status !== 'fallback') throw new Error(`expected a fallback outcome, got status "${outcome.status}"`);
  return outcome;
}

function makeSuccessfulProvider(overrides: Partial<AIAnalysisResult> = {}): AIAnalysisProvider {
  return {
    name: 'test-provider',
    async analyze(context: AIAnalysisContext): Promise<AIAnalysisResult> {
      return {
        summary: `AI summary for ${context.ticker}`,
        signalStatus: context.classification,
        whyItQualified: ['reason A'],
        supportingEvidence: ['evidence A'],
        conflictingEvidence: [],
        regimeContext: { regime: context.marketRegime?.label ?? null, note: 'note' },
        historicalContext: { note: 'exploratory', baselineSummary: null, regimeSummary: null, tickerSummary: null },
        riskFlags: [],
        limitations: [],
        quantitativeScore: { total: context.quantitativeScore.total, classification: context.classification, note: 'note' },
        aiConfidence: null,
        ...overrides,
      };
    },
  };
}

function makeFailingProvider(error: Error): AIAnalysisProvider {
  return {
    name: 'failing-provider',
    async analyze(): Promise<AIAnalysisResult> {
      throw error;
    },
  };
}

function makeHangingProvider(): AIAnalysisProvider {
  return {
    name: 'hanging-provider',
    analyze(): Promise<AIAnalysisResult> {
      return new Promise(() => {
        /* never resolves */
      });
    },
  };
}

describe('SignalAnalysisService', () => {
  const stats = new NullHistoricalStrategyStats();

  function pipeline() {
    const candles = makeOscillatingCandles(60);
    return buildPipelineAt(candles, 40);
  }

  it('returns the provider result on success', async () => {
    const { context, result, explanation } = pipeline();
    const service = new SignalAnalysisService(makeSuccessfulProvider(), stats);

    const outcome = await service.analyze(context, result, explanation);

    expect(outcome.status).toBe('ok');
    expect(outcome.source).toBe('ai');
    expect(outcome.result.summary).toContain('TEST');
    expect(outcome.result.aiConfidence).toBeNull();
  });

  it('falls back to the deterministic explanation when the provider throws', async () => {
    const { context, result, explanation } = pipeline();
    const service = new SignalAnalysisService(makeFailingProvider(new Error('provider unreachable')), stats);

    const outcome = await service.analyze(context, result, explanation);

    const fallback = expectFallback(outcome);
    expect(fallback.source).toBe('deterministic_fallback');
    expect(fallback.reason).toContain('provider unreachable');
    expect(fallback.result.aiConfidence).toBeNull();
    expect(fallback.result.quantitativeScore.total).toBe(explanation.scoreBreakdown.total);
  });

  it('falls back to the deterministic explanation on malformed AI output (validation failure)', async () => {
    const { context, result, explanation } = pipeline();
    const malformedProvider: AIAnalysisProvider = {
      name: 'malformed-provider',
      async analyze(): Promise<AIAnalysisResult> {
        // Simulates what AnthropicAnalysisProvider does when
        // validateAIAnalysisResult rejects the model's output.
        throw new Error('Malformed AI analysis output: "summary" must be a string');
      },
    };
    const service = new SignalAnalysisService(malformedProvider, stats);

    const outcome = await service.analyze(context, result, explanation);

    expect(expectFallback(outcome).reason).toContain('Malformed AI analysis output');
  });

  it('falls back when the provider times out, without hanging the caller', async () => {
    const { context, result, explanation } = pipeline();
    const service = new SignalAnalysisService(makeHangingProvider(), stats, { timeoutMs: 25 });

    const outcome = await service.analyze(context, result, explanation);

    expect(expectFallback(outcome).reason).toContain('timed out');
  }, 1000);

  it('falls back immediately when no provider is configured, without throwing', async () => {
    const { context, result, explanation } = pipeline();
    const service = new SignalAnalysisService(null, stats);

    const outcome = await service.analyze(context, result, explanation);

    expect(expectFallback(outcome).reason).toBe('no_provider_configured');
  });

  it('never mutates the StrategyResult, ScoreBreakdown, or StrategyContext passed in — the AI layer cannot alter the deterministic pipeline', async () => {
    const { context, result, explanation } = pipeline();
    const resultSnapshot = JSON.parse(JSON.stringify(result));
    const explanationSnapshot = JSON.parse(JSON.stringify(explanation));
    const contextTickerSnapshot = context.ticker;

    const service = new SignalAnalysisService(makeSuccessfulProvider(), stats);
    await service.analyze(context, result, explanation);

    expect(JSON.parse(JSON.stringify(result))).toEqual(resultSnapshot);
    expect(JSON.parse(JSON.stringify(explanation))).toEqual(explanationSnapshot);
    expect(context.ticker).toBe(contextTickerSnapshot);
  });

  it('produces exactly one AIAnalysisResult for one signal — it cannot generate a list of new candidates', async () => {
    const { context, result, explanation } = pipeline();
    const service = new SignalAnalysisService(makeSuccessfulProvider(), stats);

    const outcome = await service.analyze(context, result, explanation);

    // The result type has no field that could represent a generated list of
    // trading candidates/signals — this is a structural guarantee (see
    // AIAnalysisResult in src/types/ai.ts), asserted here at the object level.
    expect(outcome.result).not.toHaveProperty('candidates');
    expect(outcome.result).not.toHaveProperty('signals');
    expect(outcome.result).not.toHaveProperty('newSignal');
  });
});
