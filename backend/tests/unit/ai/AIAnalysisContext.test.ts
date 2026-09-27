/**
 * No-look-ahead audit for the Phase 5 AI context, in the same spirit as
 * tests/unit/backtesting/LookAheadAudit.test.ts and
 * tests/unit/research/TradeFeatureExtractor.test.ts: prove the real builder
 * is point-in-time safe, then prove the equivalence-check technique used to
 * prove it would actually catch a real violation.
 */
import { buildAIAnalysisContext } from '@/ai/AIAnalysisContext';
import { NullHistoricalStrategyStats } from '@/research/HistoricalStrategyStats';
import { AIAnalysisContext } from '@/types/ai';
import { makeOscillatingCandles, buildPipelineAt } from './fixtures';

const stats = new NullHistoricalStrategyStats();

describe('buildAIAnalysisContext', () => {
  describe('field allowlist', () => {
    it('contains only the approved top-level fields — no raw candle/snapshot history', () => {
      const candles = makeOscillatingCandles(60);
      const { context, result, explanation } = buildPipelineAt(candles, 40);

      const aiContext = buildAIAnalysisContext(context, result, explanation, stats);

      const expectedKeys: (keyof AIAnalysisContext)[] = [
        'ticker',
        'strategy',
        'asOfDate',
        'setupDetected',
        'entry',
        'stop',
        'target',
        'riskRewardRatio',
        'classification',
        'quantitativeScore',
        'strategyEvidence',
        'strategyWarnings',
        'deterministicReasons',
        'deterministicRisks',
        'invalidation',
        'indicators',
        'trendStructure',
        'dailyTrend',
        'weeklyTrend',
        'mtfAligned',
        'marketRegime',
        'relativeStrength',
        'historicalContext',
      ];

      expect(Object.keys(aiContext).sort()).toEqual([...expectedKeys].sort());
      // Explicitly assert the two highest-risk fields (full history arrays)
      // are not present under any key name.
      expect(JSON.stringify(aiContext)).not.toMatch(/"candles"|"snapshots"/);
    });

    it('missing historical statistics are represented as null, never fabricated', () => {
      const candles = makeOscillatingCandles(60);
      const { context, result, explanation } = buildPipelineAt(candles, 40);

      const aiContext = buildAIAnalysisContext(context, result, explanation, new NullHistoricalStrategyStats());

      expect(aiContext.historicalContext.baseline).toBeNull();
      expect(aiContext.historicalContext.regimeStats).toBeNull();
      expect(aiContext.historicalContext.tickerStats).toBeNull();
    });
  });

  describe('Part 1: the real builder is point-in-time safe', () => {
    it('gives an identical AIAnalysisContext whether the candle array is truncated exactly to asOfIndex or extended arbitrarily into the future', () => {
      const fullCandles = makeOscillatingCandles(300);
      const asOfIndex = 150;

      const truncated = buildPipelineAt(fullCandles.slice(0, asOfIndex + 1), asOfIndex);
      const extended = buildPipelineAt(fullCandles, asOfIndex);

      const truncatedContext = buildAIAnalysisContext(
        truncated.context,
        truncated.result,
        truncated.explanation,
        stats
      );
      const extendedContext = buildAIAnalysisContext(extended.context, extended.result, extended.explanation, stats);

      expect(extendedContext).toEqual(truncatedContext);
    });
  });

  describe('Part 2: proof the equivalence-check technique DOES detect a violation', () => {
    it('two different as-of dates on the same series produce different AIAnalysisContexts (the technique is sensitive, not vacuous)', () => {
      const fullCandles = makeOscillatingCandles(300);

      const atDay150 = buildPipelineAt(fullCandles, 150);
      const atDay200 = buildPipelineAt(fullCandles, 200);

      const contextAt150 = buildAIAnalysisContext(atDay150.context, atDay150.result, atDay150.explanation, stats);
      const contextAt200 = buildAIAnalysisContext(atDay200.context, atDay200.result, atDay200.explanation, stats);

      expect(contextAt150).not.toEqual(contextAt200);
      expect(contextAt150.asOfDate).not.toEqual(contextAt200.asOfDate);
      expect(contextAt150.indicators.close).not.toEqual(contextAt200.indicators.close);
    });
  });
});
