import { Trade, PortfolioSnapshot, BacktestMetrics } from '@/types/backtest';

function closedTrades(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.status === 'closed' && t.netPnl !== null);
}

export function calculateTotalReturn(startingCapital: number, endingEquity: number): number {
  return startingCapital <= 0 ? 0 : (endingEquity - startingCapital) / startingCapital;
}

/**
 * Compound Annual Growth Rate. Returns -1 (total loss) if ending equity is
 * zero or negative rather than producing NaN/Infinity.
 */
export function calculateCAGR(startingCapital: number, endingEquity: number, years: number): number {
  if (startingCapital <= 0 || years <= 0) return 0;
  if (endingEquity <= 0) return -1;
  return Math.pow(endingEquity / startingCapital, 1 / years) - 1;
}

export function calculateWinRate(trades: Trade[]): number {
  const closed = closedTrades(trades);
  if (closed.length === 0) return 0;
  const wins = closed.filter((t) => (t.netPnl as number) > 0).length;
  return wins / closed.length;
}

export function calculateAvgWin(trades: Trade[]): number {
  const wins = closedTrades(trades).filter((t) => (t.netPnl as number) > 0);
  if (wins.length === 0) return 0;
  return wins.reduce((s, t) => s + (t.netPnl as number), 0) / wins.length;
}

/** Returns a negative number (or 0 if there are no losses). */
export function calculateAvgLoss(trades: Trade[]): number {
  const losses = closedTrades(trades).filter((t) => (t.netPnl as number) < 0);
  if (losses.length === 0) return 0;
  return losses.reduce((s, t) => s + (t.netPnl as number), 0) / losses.length;
}

/**
 * Gross profit / gross loss. Returns Infinity if there are wins and zero
 * losses, and 0 if there are neither wins nor losses.
 */
export function calculateProfitFactor(trades: Trade[]): number {
  const closed = closedTrades(trades);
  const grossProfit = closed
    .filter((t) => (t.netPnl as number) > 0)
    .reduce((s, t) => s + (t.netPnl as number), 0);
  const grossLoss = Math.abs(
    closed.filter((t) => (t.netPnl as number) < 0).reduce((s, t) => s + (t.netPnl as number), 0)
  );
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}

export function calculateExpectancy(trades: Trade[]): number {
  const closed = closedTrades(trades);
  if (closed.length === 0) return 0;
  return closed.reduce((s, t) => s + (t.netPnl as number), 0) / closed.length;
}

/** Daily fractional returns derived from a portfolio equity curve. */
export function calculateDailyReturns(equityCurve: PortfolioSnapshot[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    const curr = equityCurve[i].equity;
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  return returns;
}

export function calculateSharpeRatio(
  dailyReturns: number[],
  riskFreeRateAnnual = 0,
  tradingDaysPerYear = 252
): number {
  if (dailyReturns.length === 0) return 0;
  const dailyRf = riskFreeRateAnnual / tradingDaysPerYear;
  const excess = dailyReturns.map((r) => r - dailyRf);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((s, r) => s + (r - mean) ** 2, 0) / excess.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean / stdDev) * Math.sqrt(tradingDaysPerYear);
}

/**
 * Sortino ratio using downside deviation against a 0 target (the standard
 * convention): only negative excess-return periods contribute to the
 * denominator, but the mean is still divided by the full period count.
 */
export function calculateSortinoRatio(
  dailyReturns: number[],
  riskFreeRateAnnual = 0,
  tradingDaysPerYear = 252
): number {
  if (dailyReturns.length === 0) return 0;
  const dailyRf = riskFreeRateAnnual / tradingDaysPerYear;
  const excess = dailyReturns.map((r) => r - dailyRf);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const downsideVariance =
    excess.reduce((s, r) => s + Math.pow(Math.min(0, r), 2), 0) / excess.length;
  const downsideDeviation = Math.sqrt(downsideVariance);
  if (downsideDeviation === 0) return 0;
  return (mean / downsideDeviation) * Math.sqrt(tradingDaysPerYear);
}

/** Maximum peak-to-trough drawdown as a positive fraction (e.g. 0.15 = 15%). */
export function calculateMaxDrawdown(equityCurve: PortfolioSnapshot[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const snap of equityCurve) {
    if (snap.equity > peak) peak = snap.equity;
    if (peak > 0) {
      const dd = (peak - snap.equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

/** A breakeven (netPnl === 0) trade resets both streaks. */
export function calculateConsecutiveStreaks(
  trades: Trade[]
): { maxConsecutiveWins: number; maxConsecutiveLosses: number } {
  const closed = closedTrades(trades)
    .filter((t) => t.exitDate !== null)
    .sort((a, b) => (a.exitDate as Date).getTime() - (b.exitDate as Date).getTime());

  let maxWins = 0;
  let maxLosses = 0;
  let curWins = 0;
  let curLosses = 0;

  for (const t of closed) {
    const pnl = t.netPnl as number;
    if (pnl > 0) {
      curWins++;
      curLosses = 0;
      maxWins = Math.max(maxWins, curWins);
    } else if (pnl < 0) {
      curLosses++;
      curWins = 0;
      maxLosses = Math.max(maxLosses, curLosses);
    } else {
      curWins = 0;
      curLosses = 0;
    }
  }

  return { maxConsecutiveWins: maxWins, maxConsecutiveLosses: maxLosses };
}

export function calculateAvgHoldingPeriod(trades: Trade[]): number {
  const closed = closedTrades(trades).filter((t) => t.exitDate !== null);
  if (closed.length === 0) return 0;
  const totalDays = closed.reduce(
    (s, t) => s + ((t.exitDate as Date).getTime() - t.entryDate.getTime()) / (1000 * 60 * 60 * 24),
    0
  );
  return totalDays / closed.length;
}

export function calculateBestTrade(trades: Trade[]): number {
  const closed = closedTrades(trades);
  if (closed.length === 0) return 0;
  return Math.max(...closed.map((t) => t.netPnl as number));
}

export function calculateWorstTrade(trades: Trade[]): number {
  const closed = closedTrades(trades);
  if (closed.length === 0) return 0;
  return Math.min(...closed.map((t) => t.netPnl as number));
}

export function calculateAllMetrics(
  trades: Trade[],
  equityCurve: PortfolioSnapshot[],
  startingCapital: number,
  startDate: Date,
  endDate: Date
): BacktestMetrics {
  const endingEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : startingCapital;
  const years = Math.max(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25),
    1 / 365.25
  );
  const dailyReturns = calculateDailyReturns(equityCurve);
  const streaks = calculateConsecutiveStreaks(trades);

  return {
    totalReturn: calculateTotalReturn(startingCapital, endingEquity),
    cagr: calculateCAGR(startingCapital, endingEquity, years),
    winRate: calculateWinRate(trades),
    avgWin: calculateAvgWin(trades),
    avgLoss: calculateAvgLoss(trades),
    profitFactor: calculateProfitFactor(trades),
    expectancy: calculateExpectancy(trades),
    sharpeRatio: calculateSharpeRatio(dailyReturns),
    sortinoRatio: calculateSortinoRatio(dailyReturns),
    maxDrawdown: calculateMaxDrawdown(equityCurve),
    numTrades: closedTrades(trades).length,
    avgHoldingPeriodDays: calculateAvgHoldingPeriod(trades),
    maxConsecutiveWins: streaks.maxConsecutiveWins,
    maxConsecutiveLosses: streaks.maxConsecutiveLosses,
    bestTrade: calculateBestTrade(trades),
    worstTrade: calculateWorstTrade(trades),
  };
}
