export type TimeframeTrend = 'bullish' | 'bearish' | 'neutral';

export interface MultiTimeframeResult {
  weeklyTrend: TimeframeTrend;
  dailyTrend: TimeframeTrend;
  aligned: boolean;
  alignmentScore: number; // 0-1
}

export type MarketRegimeLabel =
  | 'strong_bullish'
  | 'bullish'
  | 'neutral'
  | 'bearish'
  | 'strong_bearish'
  | 'high_volatility';

export interface IndexRegimeScore {
  ticker: string;
  trendScore: number; // -1, 0, or 1
  momentumScore: number; // -1..1
  drawdownPct: number; // <= 0
  annualizedVolatility: number | null;
  compositeScore: number;
}

export interface MarketRegimeResult {
  label: MarketRegimeLabel;
  compositeScore: number;
  isHighVolatility: boolean;
  indexScores: IndexRegimeScore[];
}

export interface RelativeStrengthResult {
  periodDays: number;
  stockReturn: number;
  sectorReturn: number | null;
  benchmarkReturn: number;
  vsSector: number | null;
  vsBenchmark: number;
  sectorVsBenchmark: number | null;
  outperformingBoth: boolean;
  scoreAdjustment: number;
}
