import { MarketRegimeLabel, TimeframeTrend } from '@/types/analysis';
import { TrendStructure } from '@/types/patterns';
import { SignalClassification, ScoreBreakdown } from '@/types/scoring';

/**
 * A single historical statistics bucket (e.g. "momentum_continuation in the
 * bullish regime", or "momentum_continuation on ticker AAPL"). Always
 * exploratory/in-sample — see HistoricalStrategyStats.ts — never presented
 * as a validated predictive relationship.
 */
export interface HistoricalBucketStats {
  label: string;
  trades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  note: string | null;
  /** Below the project's 20-trade floor (StatisticalEvidence.ts) for any
   * confidence at all — callers must not draw conclusions from this bucket. */
  sampleSizeSufficient: boolean;
}

export interface HistoricalStrategyBaseline {
  strategy: string;
  trades: number;
  profitFactor: number;
  sharpe: number;
  cagr: number;
  expectancyPerTrade: number;
  totalReturnPct: number;
  medianStockPnlNegative: boolean;
  pctStocksProfitable: number;
  concentrationNote: string;
  datasetDescription: string;
}

/**
 * The historical-statistics slice relevant to ONE signal (its strategy, its
 * current regime, its ticker). All fields are read from
 * HistoricalStrategyStats — nothing here is computed or estimated by the AI
 * layer itself.
 */
export interface AIHistoricalContext {
  baseline: HistoricalStrategyBaseline | null;
  regimeStats: HistoricalBucketStats | null;
  tickerStats: HistoricalBucketStats | null;
}

/**
 * The ONLY data the AI layer is allowed to see for one signal explanation.
 *
 * This is a strict, explicit DTO — deliberately NOT the full StrategyContext
 * (which carries the entire candle/snapshot history for the ticker). Every
 * field here is a scalar or small object copied out of already-computed,
 * point-in-time-safe sources (StrategyContext, StrategyResult, ScoreBreakdown,
 * SignalExplanation, HistoricalStrategyStats) as of `asOfDate`. See
 * src/ai/AIAnalysisContext.ts for the builder that enforces this and the
 * accompanying no-look-ahead test.
 */
export interface AIAnalysisContext {
  ticker: string;
  strategy: string;
  asOfDate: Date;

  setupDetected: boolean;
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskRewardRatio: number | null;

  classification: SignalClassification;
  quantitativeScore: ScoreBreakdown;

  strategyEvidence: string[];
  strategyWarnings: string[];
  deterministicReasons: string[];
  deterministicRisks: string[];
  invalidation: string;

  indicators: {
    close: number;
    rsi14: number | null;
    adx14: number | null;
    plusDI14: number | null;
    minusDI14: number | null;
    macdHistogram: number | null;
    atr14: number | null;
    relativeVolume: number | null;
    historicalVolatility20: number | null;
    sma50: number | null;
    sma200: number | null;
  };

  trendStructure: TrendStructure;
  dailyTrend: TimeframeTrend;
  weeklyTrend: TimeframeTrend;
  mtfAligned: boolean;

  marketRegime: {
    label: MarketRegimeLabel;
    compositeScore: number;
    isHighVolatility: boolean;
  } | null;

  relativeStrength: {
    vsBenchmark: number;
    vsSector: number | null;
    outperformingBoth: boolean;
    periodDays: number;
  } | null;

  historicalContext: AIHistoricalContext;
}

/**
 * Structured Phase 5 output. `aiConfidence` MUST remain null — see
 * PROJECT_STATE.md Section 0.7 and MOMENTUM_DIAGNOSTICS_REPORT.md Section 7.
 * No numeric probability/confidence is permitted until a dedicated
 * calibration experiment (ranked #1 in that report) validates one.
 */
export interface AIAnalysisResult {
  summary: string;
  signalStatus: string;
  whyItQualified: string[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  regimeContext: {
    regime: MarketRegimeLabel | null;
    note: string;
  };
  historicalContext: {
    note: string;
    baselineSummary: string | null;
    regimeSummary: string | null;
    tickerSummary: string | null;
  };
  riskFlags: string[];
  limitations: string[];
  quantitativeScore: {
    total: number;
    classification: SignalClassification;
    note: string;
  };
  aiConfidence: null;
}

export type AIAnalysisOutcome =
  | { status: 'ok'; result: AIAnalysisResult; source: 'ai' }
  | { status: 'fallback'; result: AIAnalysisResult; source: 'deterministic_fallback'; reason: string };
