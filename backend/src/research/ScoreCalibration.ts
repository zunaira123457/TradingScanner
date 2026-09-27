import { mean, stdDev } from '@/backtesting/Stats';

/**
 * Experiment 1 (signal score calibration) analysis functions. Pure,
 * read-only statistics over already-closed trades — computes nothing that
 * feeds back into the strategy, scoring engine, or AI layer. See
 * src/scripts/runScoreCalibrationExperiment.ts for the script that produces
 * the trade dataset this operates on, and PROJECT_STATE.md Section 14 /
 * MOMENTUM_DIAGNOSTICS_REPORT.md Section 8 for the pre-registered hypothesis
 * this experiment tests.
 */

export interface ScorableTrade {
  signalScore: number;
  won: boolean;
  netPnl: number | null;
  rMultiple: number | null;
  ticker: string;
  marketRegime: string | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function numericOrNull(values: Array<number | null>): number[] {
  return values.filter((v): v is number => v !== null && Number.isFinite(v));
}

/** grossProfit / grossLoss. null when there are no trades; Infinity when there are winners and zero losses. */
export function profitFactor(netPnls: number[]): number | null {
  if (netPnls.length === 0) return null;
  const grossProfit = netPnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(netPnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : null;
  return grossProfit / grossLoss;
}

export interface ScoreDecile {
  decile: number; // 1 (lowest scores) .. 10 (highest scores)
  scoreMin: number;
  scoreMax: number;
  n: number;
  winners: number;
  losers: number;
  winRate: number;
  avgNetPnl: number;
  medianNetPnl: number;
  expectancy: number; // classic (winRate*avgWin) - (lossRate*avgLoss) formula; should equal avgNetPnl
  avgRMultiple: number | null;
  medianRMultiple: number | null;
  profitFactor: number | null;
}

/**
 * Deterministic decile bucketing: trades are sorted ascending by
 * signalScore (ties broken by original array order — a stable sort, so the
 * result never depends on anything other than the input order and score),
 * then split into 10 groups of as-equal-as-possible size using the same
 * convention as numpy.array_split: the first `n % 10` groups (the LOWEST
 * score deciles) get one extra trade, the rest get `floor(n / 10)`. For
 * n=226: deciles 1-6 get 23 trades, deciles 7-10 get 22 trades. This
 * allocation is fixed by the algorithm before any result is seen — it is
 * not chosen to favor either end of the distribution.
 */
export function buildScoreDeciles(trades: ScorableTrade[]): ScoreDecile[] {
  const sorted = [...trades].sort((a, b) => a.signalScore - b.signalScore);
  const n = sorted.length;
  const baseSize = Math.floor(n / 10);
  const remainder = n % 10;

  const deciles: ScoreDecile[] = [];
  let cursor = 0;
  for (let d = 0; d < 10; d++) {
    const size = baseSize + (d < remainder ? 1 : 0);
    const bucket = sorted.slice(cursor, cursor + size);
    cursor += size;

    const netPnls = numericOrNull(bucket.map((t) => t.netPnl));
    const rMultiples = numericOrNull(bucket.map((t) => t.rMultiple));
    const winners = bucket.filter((t) => t.won);
    const losers = bucket.filter((t) => !t.won);
    const winnerPnls = numericOrNull(winners.map((t) => t.netPnl));
    const loserPnls = numericOrNull(losers.map((t) => t.netPnl));
    const winRate = bucket.length > 0 ? winners.length / bucket.length : 0;
    const avgWin = winnerPnls.length > 0 ? mean(winnerPnls) : 0;
    const avgLoss = loserPnls.length > 0 ? mean(loserPnls.map((p) => Math.abs(p))) : 0;

    deciles.push({
      decile: d + 1,
      scoreMin: bucket.length > 0 ? bucket[0].signalScore : NaN,
      scoreMax: bucket.length > 0 ? bucket[bucket.length - 1].signalScore : NaN,
      n: bucket.length,
      winners: winners.length,
      losers: losers.length,
      winRate,
      avgNetPnl: netPnls.length > 0 ? mean(netPnls) : 0,
      medianNetPnl: netPnls.length > 0 ? median(netPnls) : 0,
      expectancy: winRate * avgWin - (1 - winRate) * avgLoss,
      avgRMultiple: rMultiples.length > 0 ? mean(rMultiples) : null,
      medianRMultiple: rMultiples.length > 0 ? median(rMultiples) : null,
      profitFactor: profitFactor(netPnls),
    });
  }
  return deciles;
}

export interface MonotonicityResult {
  winRates: number[]; // decile 1..10 order
  isMonotonicNonDecreasing: boolean;
  reversalCount: number; // number of adjacent decile pairs where win rate DECREASED
  reversalTransitions: Array<{ fromDecile: number; toDecile: number; fromWinRate: number; toWinRate: number }>;
}

export function checkMonotonicity(deciles: ScoreDecile[]): MonotonicityResult {
  const winRates = deciles.map((d) => d.winRate);
  const reversalTransitions: MonotonicityResult['reversalTransitions'] = [];
  for (let i = 1; i < winRates.length; i++) {
    if (winRates[i] < winRates[i - 1]) {
      reversalTransitions.push({
        fromDecile: deciles[i - 1].decile,
        toDecile: deciles[i].decile,
        fromWinRate: winRates[i - 1],
        toWinRate: winRates[i],
      });
    }
  }
  return {
    winRates,
    isMonotonicNonDecreasing: reversalTransitions.length === 0,
    reversalCount: reversalTransitions.length,
    reversalTransitions,
  };
}

/** Average-rank assignment (standard tie handling for Spearman/AUC). 1-indexed ranks. */
function rankValues(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + 1 + j + 1) / 2; // 1-indexed average rank across the tie block [i, j]
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation with average-rank tie handling. Returns null
 * when either series has zero variance (undefined correlation) or fewer
 * than 2 paired observations. Descriptive only — no significance testing.
 */
export function spearmanCorrelation(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 2) return null;
  const rx = rankValues(x);
  const ry = rankValues(y);
  if (stdDev(rx) === 0 || stdDev(ry) === 0) return null;
  const mx = mean(rx);
  const my = mean(ry);
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < rx.length; i++) {
    cov += (rx[i] - mx) * (ry[i] - my);
    varX += (rx[i] - mx) ** 2;
    varY += (ry[i] - my) ** 2;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

/**
 * ROC-AUC for a binary outcome via the Mann-Whitney U statistic:
 * AUC = (sum of ranks of the positive class - nPos*(nPos+1)/2) / (nPos * nNeg).
 * 0.5 = no discrimination, 1.0 = perfect ranking of winners above losers,
 * 0.0 = perfect ranking inverted. Returns null if either class is empty.
 */
export function rocAuc(scores: number[], positive: boolean[]): number | null {
  if (scores.length !== positive.length || scores.length === 0) return null;
  const nPos = positive.filter(Boolean).length;
  const nNeg = positive.length - nPos;
  if (nPos === 0 || nNeg === 0) return null;
  const ranks = rankValues(scores);
  const sumPosRanks = ranks.reduce((sum, r, i) => sum + (positive[i] ? r : 0), 0);
  return (sumPosRanks - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export interface ThresholdResult {
  threshold: number;
  tradesRetained: number;
  winRate: number;
  expectancy: number;
  profitFactor: number | null;
  totalNetPnl: number;
  avgRMultiple: number | null;
}

export function analyzeThreshold(trades: ScorableTrade[], threshold: number): ThresholdResult {
  const retained = trades.filter((t) => t.signalScore >= threshold);
  const netPnls = numericOrNull(retained.map((t) => t.netPnl));
  const rMultiples = numericOrNull(retained.map((t) => t.rMultiple));
  const winners = retained.filter((t) => t.won);
  const winRate = retained.length > 0 ? winners.length / retained.length : 0;
  return {
    threshold,
    tradesRetained: retained.length,
    winRate,
    expectancy: netPnls.length > 0 ? mean(netPnls) : 0,
    profitFactor: profitFactor(netPnls),
    totalNetPnl: netPnls.reduce((a, b) => a + b, 0),
    avgRMultiple: rMultiples.length > 0 ? mean(rMultiples) : null,
  };
}
