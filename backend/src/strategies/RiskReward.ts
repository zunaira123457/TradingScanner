export interface RiskRewardMetrics {
  riskPerShare: number;
  rewardPerShare: number;
  riskRewardRatio: number | null;
}

/**
 * Long-only risk/reward calculation. All three Phase 3 strategies are
 * long-side setups (matching the spec's own BUY/WATCH/AVOID examples);
 * short-side support is out of scope for this phase.
 */
export function calculateRiskReward(entry: number, stop: number, target: number): RiskRewardMetrics {
  const riskPerShare = entry - stop;
  const rewardPerShare = target - entry;
  const riskRewardRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : null;
  return { riskPerShare, rewardPerShare, riskRewardRatio };
}

/**
 * A target price built from a fixed reward multiple of the risk already
 * taken (e.g. target = entry + 2x the entry-to-stop distance). Used as the
 * default/fallback target methodology when no measured-move or structural
 * target is available.
 */
export function targetFromRewardMultiple(entry: number, stop: number, rewardMultiple: number): number {
  const risk = entry - stop;
  return entry + rewardMultiple * risk;
}

/**
 * An ATR-based stop: `multiple` average true ranges below entry. Used when
 * there is no clean structural level (e.g. a fresh swing low) to anchor to.
 */
export function atrStop(entry: number, atr: number, multiple: number): number {
  return entry - multiple * atr;
}
