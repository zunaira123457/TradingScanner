/**
 * Shared types for the dashboard. Everything that crosses the API boundary
 * (route handler -> browser) is described here so client and server agree.
 */

export type DataSource = 'finnhub' | 'twelvedata';

export interface Quote {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  /** Session volume. Not provided by Finnhub's /quote, so null there. */
  volume: number | null;
  /** Bid/ask are not included in either provider's free tier; null unless a feed supplies them. */
  bid: number | null;
  ask: number | null;
  /** Exchange timestamp of the last trade/quote (ms since epoch). */
  timestamp: number;
  /** When our server fetched it (ms since epoch). */
  fetchedAt: number;
  source: DataSource;
}

export const INTERVALS = ['1m', '5m', '15m', '1h', '1d', '1w'] as const;
export type Interval = (typeof INTERVALS)[number];

export interface Candle {
  /** Bar open time, UTC seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleResponse {
  symbol: string;
  interval: Interval;
  candles: Candle[];
  source: DataSource;
  fetchedAt: number;
  stale?: boolean;
}

export interface NewsItem {
  id: number | string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image: string | null;
  datetime: number;
}

export interface SymbolMatch {
  symbol: string;
  description: string;
  exchange?: string;
}

/* ---------------- Alerts ---------------- */

export type AlertCondition = 'price_above' | 'price_below' | 'change_pct_above' | 'change_pct_below';

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  /** Price in USD for price_* conditions; percent (e.g. 3 = +3%) for change_pct_*. */
  threshold: number;
  note?: string;
  createdAt: number;
  status: 'active' | 'triggered' | 'dismissed';
  triggeredAt?: number;
  triggeredPrice?: number;
}

/* ---------------- Scanner (backend/src/server) ---------------- */

export type SignalClassification = 'BUY' | 'WATCH' | 'AVOID';

export interface ScoreBreakdown {
  trend: number;
  momentum: number;
  volume: number;
  relativeStrength: number;
  chartSetup: number;
  marketRegime: number;
  riskReward: number;
  total: number;
}

export interface HistoricalBucketStats {
  label: string;
  trades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  note: string | null;
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

export interface ScannerSignal {
  rank: number;
  ticker: string;
  strategy: string;
  classification: SignalClassification;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  setupDetected: boolean;
  setupStrength: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskRewardRatio: number | null;
  reasons: string[];
  risks: string[];
  invalidation: string;
  asOf: string;
  historical: {
    baseline: HistoricalStrategyBaseline | null;
    regime: HistoricalBucketStats | null;
    ticker: HistoricalBucketStats | null;
  };
}

export type MarketRegimeLabel = 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';

export interface MarketRegime {
  label: MarketRegimeLabel;
  compositeScore: number;
  isHighVolatility: boolean;
}

export interface ScanSnapshot {
  status: 'idle' | 'warming' | 'ready' | 'error';
  universe: string[];
  generatedAt: string | null;
  durationMs: number | null;
  progress: { done: number; total: number };
  marketRegime: MarketRegime | null;
  signals: ScannerSignal[];
  errors: { ticker: string; message: string }[];
}

export type TimeframeTrend = 'bullish' | 'bearish' | 'neutral';

export interface AIAnalysisResult {
  summary: string;
  signalStatus: string;
  whyItQualified: string[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  regimeContext: { regime: MarketRegimeLabel | null; note: string };
  historicalContext: {
    note: string;
    baselineSummary: string | null;
    regimeSummary: string | null;
    tickerSummary: string | null;
  };
  riskFlags: string[];
  limitations: string[];
  quantitativeScore: { total: number; classification: SignalClassification; note: string };
  aiConfidence: null;
}

export type AIAnalysisOutcome =
  | { status: 'ok'; result: AIAnalysisResult; source: 'ai' }
  | { status: 'fallback'; result: AIAnalysisResult; source: 'deterministic_fallback'; reason: string };

export interface TickerAnalysis {
  ticker: string;
  asOf: string;
  lastClose: number;
  levels: {
    support20: number | null;
    resistance20: number | null;
    support60: number | null;
    resistance60: number | null;
    lastSwingHigh: number | null;
    lastSwingLow: number | null;
  };
  structure: 'uptrend' | 'downtrend' | 'sideways' | 'insufficient_data';
  multiTimeframe: { weeklyTrend: TimeframeTrend; dailyTrend: TimeframeTrend; aligned: boolean };
  marketRegime: MarketRegime | null;
  relativeStrength: { periodDays: number; stockReturn: number; outperformingBoth?: boolean; vsBenchmark?: number } | null;
  indicators: {
    rsi14: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    adx14: number | null;
    atr14: number | null;
    sma50: number | null;
    sma200: number | null;
    relativeVolume: number | null;
    historicalVolatility20: number | null;
  };
  signals: ScannerSignal[];
  ai: AIAnalysisOutcome | null;
}

export interface PaperTrade {
  ticker?: string;
  entryDate?: string;
  exitDate?: string;
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number;
  [key: string]: unknown;
}

export interface PerformanceResponse {
  config: { lockedStartDate: string; strategyName: string; initialCapital: number; universeVersion: string } | null;
  asOfDate: string | null;
  trades: PaperTrade[];
  equityCurve: { date: string; cash: number; equity: number; openPositionsCount: number; exposurePct: number }[];
  baselines: HistoricalStrategyBaseline[];
}

/** Which upstream services this deployment has keys for. Booleans only — never the keys. */
export interface ProviderStatus {
  quotes: DataSource | null;
  candles: DataSource | null;
  news: boolean;
  scanner: boolean;
}

export interface ApiError {
  error: string;
  message?: string;
  retryAfter?: number;
}
