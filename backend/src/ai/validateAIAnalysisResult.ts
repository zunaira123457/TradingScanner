import { AIAnalysisContext, AIAnalysisResult } from '@/types/ai';

const QUANT_SCORE_NOTE =
  'Quantitative signal score — a ranking/scoring output, not a validated probability of success. ' +
  'This score has not been shown to be calibrated against actual trade outcomes.';

export class MalformedAIOutputError extends Error {
  constructor(reason: string) {
    super(`Malformed AI analysis output: ${reason}`);
    this.name = 'MalformedAIOutputError';
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!isStringArray(value)) throw new MalformedAIOutputError(`"${field}" must be an array of strings`);
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new MalformedAIOutputError(`"${field}" must be a string`);
  return value;
}

/**
 * Validates and normalizes raw model output into a safe AIAnalysisResult.
 *
 * This is the enforcement point for the hard safety constraints, applied
 * REGARDLESS of what the model actually returned — not merely requested by
 * the prompt:
 *   - `aiConfidence` is always overwritten to `null`. Even if the model
 *     ignores its instructions and emits a number, it is discarded here.
 *   - `quantitativeScore` is always overwritten with the value computed by
 *     the deterministic ScoringEngine/SignalExplainer (via `context`), never
 *     trusted from the model's echo — this is what makes it structurally
 *     impossible for the AI layer to alter the quantitative signal score.
 *
 * Throws MalformedAIOutputError for any structural problem (missing field,
 * wrong type) so the caller (SignalAnalysisService) can fall back to the
 * deterministic explanation rather than surface a partially-broken result.
 */
export function validateAIAnalysisResult(raw: unknown, context: AIAnalysisContext): AIAnalysisResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new MalformedAIOutputError('response is not an object');
  }
  const obj = raw as Record<string, unknown>;

  const summary = requireString(obj.summary, 'summary');
  const signalStatus = requireString(obj.signalStatus, 'signalStatus');
  const whyItQualified = requireStringArray(obj.whyItQualified, 'whyItQualified');
  const supportingEvidence = requireStringArray(obj.supportingEvidence, 'supportingEvidence');
  const conflictingEvidence = requireStringArray(obj.conflictingEvidence, 'conflictingEvidence');
  const riskFlags = requireStringArray(obj.riskFlags, 'riskFlags');
  const limitations = requireStringArray(obj.limitations, 'limitations');

  if (typeof obj.regimeContext !== 'object' || obj.regimeContext === null) {
    throw new MalformedAIOutputError('"regimeContext" must be an object');
  }
  const regimeContextRaw = obj.regimeContext as Record<string, unknown>;
  const regimeNote = requireString(regimeContextRaw.note, 'regimeContext.note');

  if (typeof obj.historicalContext !== 'object' || obj.historicalContext === null) {
    throw new MalformedAIOutputError('"historicalContext" must be an object');
  }
  const historicalContextRaw = obj.historicalContext as Record<string, unknown>;
  const historicalNote = requireString(historicalContextRaw.note, 'historicalContext.note');

  const asOptionalString = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new MalformedAIOutputError('expected string or null');
    return value;
  };

  return {
    summary,
    signalStatus,
    whyItQualified,
    supportingEvidence,
    conflictingEvidence,
    regimeContext: {
      // Never trust a model-invented regime label — always the real,
      // already-computed classification from context.
      regime: context.marketRegime?.label ?? null,
      note: regimeNote,
    },
    historicalContext: {
      note: historicalNote,
      baselineSummary: asOptionalString(historicalContextRaw.baselineSummary),
      regimeSummary: asOptionalString(historicalContextRaw.regimeSummary),
      tickerSummary: asOptionalString(historicalContextRaw.tickerSummary),
    },
    riskFlags,
    limitations,
    // Always re-derived from the deterministic context, never from the
    // model's response — see this function's doc comment.
    quantitativeScore: {
      total: context.quantitativeScore.total,
      classification: context.classification,
      note: QUANT_SCORE_NOTE,
    },
    aiConfidence: null,
  };
}
