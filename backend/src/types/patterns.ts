export interface SwingPoint {
  index: number;
  date: Date;
  price: number;
}

export type TrendStructure = 'uptrend' | 'downtrend' | 'sideways' | 'insufficient_data';

export interface StructureAnalysis {
  trend: TrendStructure;
  lastSwingHigh: SwingPoint | null;
  lastSwingLow: SwingPoint | null;
  higherHigh: boolean;
  higherLow: boolean;
  lowerHigh: boolean;
  lowerLow: boolean;
}

export interface BreakoutResult {
  pattern: 'breakout';
  detected: boolean;
  confidence: number; // 0-1
  resistance: number | null;
  breakoutPrice: number | null;
  breakoutPct: number | null;
  volumeConfirmation: boolean;
  invalidationPrice: number | null;
}

export interface BreakdownResult {
  pattern: 'breakdown';
  detected: boolean;
  confidence: number; // 0-1
  support: number | null;
  breakdownPrice: number | null;
  breakdownPct: number | null;
  volumeConfirmation: boolean;
  invalidationPrice: number | null;
}

export interface ConsolidationResult {
  pattern: 'consolidation';
  detected: boolean;
  confidence: number; // 0-1
  rangeHigh: number | null;
  rangeLow: number | null;
  rangePct: number | null;
  days: number;
}

export interface GapResult {
  type: 'gap_up' | 'gap_down' | 'none';
  gapPct: number;
}

export interface PullbackResult {
  pattern: 'pullback';
  detected: boolean;
  confidence: number; // 0-1
  pullbackToLevel: 'ema21' | 'sma50' | null;
  distancePct: number | null;
  trendIntact: boolean;
  invalidationPrice: number | null;
}
