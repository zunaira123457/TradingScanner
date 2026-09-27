/**
 * One research record per closed trade: everything knowable at the moment
 * the signal fired (point-in-time features), clearly separated from the
 * trade's eventual outcome (only knowable after the fact). Never mix the
 * two sections when using this for analysis — the "outcome" fields exist
 * for studying what happened, never for feeding back into signal generation.
 */
export interface TradeFeatureRecord {
  // --- Identity ---
  tradeId: string;
  ticker: string;
  sector: string | null;
  signalDate: Date;
  entryDate: Date;

  // --- Signal-time context (point-in-time safe: reconstructed via the same
  //     buildStrategyContext(..., { asOfIndex }) call Backtester.ts uses) ---
  marketRegime: string | null;
  regimeCompositeScore: number | null;
  regimeHighVolatility: boolean | null;

  entry: number; // actual fill price (includes slippage), not the strategy's raw reference price
  stop: number;
  target: number;
  riskRewardRatio: number | null;
  signalScore: number;

  close: number;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochK: number | null;
  stochD: number | null;
  roc12: number | null;
  adx14: number | null;
  plusDI14: number | null;
  minusDI14: number | null;
  atr14: number | null;
  atrPct: number | null; // atr14 / close
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  bbPosition: number | null; // 0 = at lower band, 1 = at upper band
  historicalVolatility20: number | null;
  volumeSma20: number | null;
  relativeVolume: number | null;
  obv: number | null;
  avgDollarVolume30: number | null;

  priceVsSma50Pct: number | null;
  priceVsSma200Pct: number | null;
  sma50VsSma200Pct: number | null;
  distanceFromRecentHighPct: number | null; // vs. trailing 20-day high

  trendStructure: string;

  dailyTrend: string;
  weeklyTrend: string;
  mtfAligned: boolean;
  mtfAlignmentScore: number;

  relativeStrengthVsBenchmark: number | null;
  outperformingBoth: boolean | null;

  // --- Outcome (post-hoc only; NEVER available at signal time) ---
  won: boolean;
  netPnl: number | null;
  rMultiple: number | null;
  exitReason: string | null;
  holdingDays: number | null;
  maxFavorableExcursionPct: number | null;
  maxAdverseExcursionPct: number | null;
}

/**
 * Intraday counterpart to TradeFeatureRecord — same two-section discipline
 * (signal-time features vs. post-hoc outcome), reconstructed via the same
 * buildIntradayContext(..., precomputedSnapshots) point-in-time-safe path
 * the live daemon and IntradayBacktester both use. Includes both the
 * features the current strategies/scoring already gate on, AND several new
 * candidate features (extension, continuous VWAP/EMA distance, time of
 * day, continuous SPY momentum, momentum freshness, an alternate RSI
 * period) being evaluated for predictive power — none of these candidates
 * feed back into signal generation just by existing here.
 */
export interface IntradayTradeFeatureRecord {
  tradeId: string;
  ticker: string;
  strategy: string;
  signalDate: Date;
  entryDate: Date;

  // --- Existing strategy/score inputs at signal time ---
  entryRsi14: number | null;
  entryRelativeVolume: number | null;
  entryEmaAligned: boolean | null; // ema9 > ema21
  entryAboveVwap: boolean | null;
  entryAtrPctOfPrice: number | null;
  scoreTrend: number;
  scoreMomentum: number;
  scoreVolume: number;
  scoreRelativeStrength: number;
  scoreChartSetup: number;
  scoreMarketRegime: number;
  scoreRiskReward: number;
  scoreTotal: number;

  // --- Candidate features NOT currently used by any strategy/score ---
  vwapDistancePct: number | null; // (close - vwap) / vwap, continuous version of entryAboveVwap
  emaSpreadPct: number | null; // (ema9 - ema21) / ema21, continuous version of entryEmaAligned
  extensionFromRecentLowPct: number | null; // (close - min low, trailing 12 bars) / close — "how far has this already run"
  minutesSinceOpen: number | null;
  spyIntradayPctChange: number | null; // continuous SPY session % change at signal time (vs. the binned marketRegime score component)
  consecutiveUpBars: number | null; // momentum freshness/exhaustion proxy, capped at 10
  rsi14Delta3Bars: number | null; // rsi14 now minus rsi14 3 bars ago — momentum acceleration, not just level
  rsi9: number | null; // alternate faster-period RSI, tests whether RSI14 is mis-calibrated for 5-min bars

  // --- Outcome (post-hoc only) ---
  won: boolean;
  netPnl: number | null;
  rMultiple: number | null;
  exitReason: string | null;
  holdingMinutes: number | null;
  mfeR: number | null; // max favorable excursion, entry->exit, in R (initial risk) multiples
  maeR: number | null; // max adverse excursion, entry->exit, in R multiples
}
