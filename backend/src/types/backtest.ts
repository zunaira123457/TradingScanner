import { Candle } from '@/types';

export type ExitReason = 'stop' | 'target' | 'end_of_data';

/**
 * The set of series a backtest run operates over. Every series here must
 * share an identical trading calendar (validated by TradingCalendar.ts) —
 * candles[t] across every map/array must all refer to the same date.
 */
export interface BacktestUniverse {
  tickers: Map<string, Candle[]>;
  /** e.g. SPY, for relative-strength scoring and the buy-and-hold benchmark. */
  benchmarkCandles?: Candle[];
  /** e.g. SPY/QQQ/IWM, for market regime classification. */
  indexCandles?: Map<string, Candle[]>;
  /** ticker -> that ticker's sector ETF candles, for relative-strength scoring. */
  sectorCandlesByTicker?: Map<string, Candle[]>;
}

/**
 * One fully reproducible historical trade. Every field a re-audit would
 * need is recorded — nothing about a trade's outcome is derivable only
 * from aggregate metrics.
 */
export interface Trade {
  id: string;
  ticker: string;
  strategy: string;
  signalDate: Date; // date the setup was detected (decision made using that day's close)
  entryDate: Date; // date of actual execution (next trading day's open)
  entryPrice: number; // actual fill price, after slippage
  shares: number;
  stopPrice: number; // anchored to the actual fill price, see Backtester docs
  targetPrice: number;
  exitDate: Date | null;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  grossPnl: number | null;
  fees: number;
  slippageCost: number;
  netPnl: number | null;
  rMultiple: number | null; // netPnl / (riskPerShare * shares)
  signalScore: number;
  marketRegimeAtEntry: string | null;
  status: 'open' | 'closed';
}

export interface PortfolioSnapshot {
  date: Date;
  cash: number;
  equity: number;
  openPositionsCount: number;
  exposurePct: number;
}

export interface BacktestConfig {
  startingCapital: number;
  maxRiskPerTradePct: number; // fraction of equity risked per trade, e.g. 0.01 = 1%
  maxPositions: number;
  maxPortfolioExposurePct: number; // fraction of equity allowed in open positions at once
  slippageBps: number;
  commissionBps: number;
  fractionalShares: boolean;
  /** Optional ticker->sector map. Sector exposure is unconstrained (a no-op) without one. */
  sectorMap?: Map<string, string>;
  maxSectorExposurePct?: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  cagr: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  numTrades: number;
  avgHoldingPeriodDays: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  bestTrade: number;
  worstTrade: number;
}

export interface BacktestResult {
  strategyName: string;
  startDate: Date;
  endDate: Date;
  trades: Trade[];
  equityCurve: PortfolioSnapshot[];
  metrics: BacktestMetrics;
  config: BacktestConfig;
}
