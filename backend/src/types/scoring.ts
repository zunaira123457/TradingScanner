export interface ScoringWeights {
  trend: number;
  momentum: number;
  volume: number;
  relativeStrength: number;
  chartSetup: number;
  marketRegime: number;
  riskReward: number;
}

export interface ScoreBreakdown {
  trend: number;
  momentum: number;
  volume: number;
  relativeStrength: number;
  chartSetup: number;
  marketRegime: number;
  riskReward: number;
  total: number; // 0-100
}

export type SignalClassification = 'BUY' | 'WATCH' | 'AVOID';

export interface ClassificationThresholds {
  buy: number; // score at/above this (with a detected setup) -> BUY
  watch: number; // score at/above this (with a detected setup) -> WATCH
}

export interface SignalExplanation {
  ticker: string;
  date: Date;
  strategy: string;
  classification: SignalClassification;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskRewardRatio: number | null;
  reasons: string[];
  risks: string[];
  invalidation: string;
}

export interface RankedSignal {
  rank: number;
  ticker: string;
  score: number;
  classification: SignalClassification;
  strategy: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskRewardRatio: number | null;
}
