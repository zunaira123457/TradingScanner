import { AIAnalysisContext, AIAnalysisResult } from '@/types/ai';

const GENERIC_SCORE_NOTE =
  'Quantitative signal score — a ranking/scoring output, not a validated probability of success. ' +
  'This score has not been shown to be calibrated against actual trade outcomes for this strategy.';

const MOMENTUM_CONTINUATION_SCORE_NOTE =
  'Quantitative signal score — a ranking/scoring output, not a validated probability of success. ' +
  "Diagnostic testing found no measurable relationship between this score and trade outcome for " +
  "momentum_continuation (Cohen's d = -0.121); treat it as a ranking signal only.";

function quantScoreNote(strategy: string): string {
  return strategy === 'momentum_continuation' ? MOMENTUM_CONTINUATION_SCORE_NOTE : GENERIC_SCORE_NOTE;
}

function bucketSummary(label: string, bucket: AIAnalysisContext['historicalContext']['regimeStats']): string | null {
  if (!bucket) return null;
  if (!bucket.sampleSizeSufficient) {
    return `${label}: only ${bucket.trades} historical trade(s) — insufficient sample for a reliable conclusion.`;
  }
  const winRate = bucket.winRatePct !== null ? `${bucket.winRatePct.toFixed(1)}% win rate` : 'win rate unavailable';
  return `${label}: ${bucket.trades} historical trades, ${winRate} (exploratory/in-sample).${bucket.note ? ' ' + bucket.note : ''}`;
}

/**
 * Builds a complete AIAnalysisResult from ONLY the deterministic data already
 * present in AIAnalysisContext — no LLM call. This is what the application
 * falls back to whenever the AI provider fails, times out, or returns
 * malformed output (PROJECT_STATE.md Section 0.7 / Section 14: "AI is an
 * enhancement, NOT a dependency for the trading engine"). It is deliberately
 * template-based, not prose-generated — the same discipline SignalExplainer.ts
 * already follows for the purely deterministic explanation layer.
 */
export function buildDeterministicFallback(context: AIAnalysisContext): AIAnalysisResult {
  const regimeLabel = context.marketRegime?.label ?? null;

  return {
    summary: context.setupDetected
      ? `${context.strategy} qualified for ${context.ticker} as of ${context.asOfDate.toISOString().slice(0, 10)}. ` +
        `Quantitative score: ${context.quantitativeScore.total.toFixed(1)}/100 (${context.classification}). ` +
        `AI analysis is unavailable — this summary is generated directly from the deterministic quantitative output.`
      : `${context.strategy} did not detect a setup for ${context.ticker}. AI analysis is unavailable.`,
    signalStatus: `${context.classification} (deterministic fallback — AI analysis unavailable)`,
    whyItQualified: [...context.strategyEvidence],
    supportingEvidence: [...context.deterministicReasons],
    conflictingEvidence: [...context.deterministicRisks],
    regimeContext: {
      regime: regimeLabel,
      note: regimeLabel
        ? `Current market regime: ${regimeLabel}.`
        : 'No market regime data available for this signal.',
    },
    historicalContext: {
      note: 'All historical statistics below are exploratory/in-sample findings, not validated predictive evidence.',
      baselineSummary: context.historicalContext.baseline
        ? `${context.historicalContext.baseline.strategy}: ${context.historicalContext.baseline.trades} trades, ` +
          `profit factor ${context.historicalContext.baseline.profitFactor}, ` +
          `${context.historicalContext.baseline.pctStocksProfitable}% of traded stocks profitable. ` +
          context.historicalContext.baseline.concentrationNote
        : null,
      regimeSummary: bucketSummary('Regime history', context.historicalContext.regimeStats),
      tickerSummary: bucketSummary('Ticker history', context.historicalContext.tickerStats),
    },
    riskFlags: [...context.deterministicRisks],
    limitations: [
      'AI analysis is unavailable for this signal — showing the deterministic quantitative explanation only.',
      'The quantitative signal score is not a validated probability of success.',
      ...(context.historicalContext.baseline ? [] : ['No historical strategy statistics are available for this strategy.']),
    ],
    quantitativeScore: {
      total: context.quantitativeScore.total,
      classification: context.classification,
      note: quantScoreNote(context.strategy),
    },
    aiConfidence: null,
  };
}
