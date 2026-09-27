/**
 * Risk-based position sizing:
 *   riskDollars = equity * maxRiskPerTradePct
 *   shares = riskDollars / (entryPrice - stopPrice)
 *
 * Whole-share mode floors the result (a fraction of a share can't be
 * bought); fractional mode returns the raw value.
 */
export function calculatePositionSize(
  equity: number,
  entryPrice: number,
  stopPrice: number,
  maxRiskPerTradePct: number,
  fractionalShares: boolean
): number {
  const riskPerShare = entryPrice - stopPrice;
  if (riskPerShare <= 0 || equity <= 0) return 0;

  const riskDollars = equity * maxRiskPerTradePct;
  const rawShares = riskDollars / riskPerShare;

  return fractionalShares ? rawShares : Math.floor(rawShares);
}
