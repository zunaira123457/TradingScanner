import { mean, stdDev } from '@/backtesting/Stats';

export interface GroupStats {
  n: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
}

export type EffectStrength = 'interesting' | 'weak' | 'noise' | 'insufficient_sample';

export interface FeatureComparison {
  feature: string;
  winners: GroupStats;
  losers: GroupStats;
  /** Cohen's d: (meanWinners - meanLosers) / pooledStdDev. Standard effect-size
   * measure for exploratory two-group comparison — NOT a significance test. */
  cohensD: number | null;
  effectStrength: EffectStrength;
}

const MIN_SAMPLE_SIZE = 10; // per group, below this the comparison is flagged insufficient
const NOISE_THRESHOLD = 0.2; // |d| below this: noise
const WEAK_THRESHOLD = 0.5; // |d| in [0.2, 0.5): weak; [0.5, 0.8): interesting; >=0.8: interesting (large)

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeGroupStats(values: number[]): GroupStats {
  if (values.length === 0) {
    return { n: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0 };
  }
  return {
    n: values.length,
    mean: mean(values),
    median: median(values),
    stdDev: stdDev(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * Pooled-standard-deviation Cohen's d between two independent samples.
 * Positive d means winners have a higher mean than losers.
 */
export function cohensD(winners: number[], losers: number[]): number | null {
  if (winners.length < 2 || losers.length < 2) return null;
  const meanW = mean(winners);
  const meanL = mean(losers);
  const varW = winners.reduce((s, v) => s + (v - meanW) ** 2, 0) / (winners.length - 1);
  const varL = losers.reduce((s, v) => s + (v - meanL) ** 2, 0) / (losers.length - 1);
  const pooledSd = Math.sqrt(((winners.length - 1) * varW + (losers.length - 1) * varL) / (winners.length + losers.length - 2));
  if (pooledSd === 0) return null;
  return (meanW - meanL) / pooledSd;
}

function classifyEffect(d: number | null, nWinners: number, nLosers: number): EffectStrength {
  if (nWinners < MIN_SAMPLE_SIZE || nLosers < MIN_SAMPLE_SIZE) return 'insufficient_sample';
  if (d === null) return 'noise';
  const abs = Math.abs(d);
  if (abs < NOISE_THRESHOLD) return 'noise';
  if (abs < WEAK_THRESHOLD) return 'weak';
  return 'interesting';
}

/**
 * Compares a numeric feature between winning and losing trades. Filters out
 * null/undefined values from each group before computing statistics (a
 * feature that's null for most trades in a group will naturally have a
 * small effective n, which the sample-size floor accounts for).
 */
export function compareFeature(
  featureName: string,
  winnerValues: Array<number | null>,
  loserValues: Array<number | null>
): FeatureComparison {
  const w = winnerValues.filter((v): v is number => v !== null && Number.isFinite(v));
  const l = loserValues.filter((v): v is number => v !== null && Number.isFinite(v));

  const d = cohensD(w, l);

  return {
    feature: featureName,
    winners: computeGroupStats(w),
    losers: computeGroupStats(l),
    cohensD: d,
    effectStrength: classifyEffect(d, w.length, l.length),
  };
}

/**
 * Ranks a set of feature comparisons by |Cohen's d| descending, so the most
 * separated features surface first. Comparisons with insufficient sample
 * size are pushed to the end regardless of their (unreliable) d value.
 */
export function rankFeatureComparisons(comparisons: FeatureComparison[]): FeatureComparison[] {
  return [...comparisons].sort((a, b) => {
    if (a.effectStrength === 'insufficient_sample' && b.effectStrength !== 'insufficient_sample') return 1;
    if (b.effectStrength === 'insufficient_sample' && a.effectStrength !== 'insufficient_sample') return -1;
    const absA = a.cohensD !== null ? Math.abs(a.cohensD) : 0;
    const absB = b.cohensD !== null ? Math.abs(b.cohensD) : 0;
    return absB - absA;
  });
}

export interface CategoryWinRate {
  category: string;
  n: number;
  winRate: number;
  sufficientSample: boolean;
}

/**
 * Win rate broken down by a categorical feature (e.g. sector, regime,
 * trendStructure). Categories with fewer than MIN_SAMPLE_SIZE trades are
 * flagged, not excluded — the caller decides whether to display them with
 * a caveat.
 */
export function winRateByCategory(
  categories: Array<string | null>,
  won: boolean[]
): CategoryWinRate[] {
  const buckets = new Map<string, boolean[]>();
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    if (cat === null) continue;
    const existing = buckets.get(cat);
    if (existing) existing.push(won[i]);
    else buckets.set(cat, [won[i]]);
  }

  return [...buckets.entries()].map(([category, outcomes]) => ({
    category,
    n: outcomes.length,
    winRate: outcomes.filter(Boolean).length / outcomes.length,
    sufficientSample: outcomes.length >= MIN_SAMPLE_SIZE,
  }));
}

/** 1-indexed ranks, ties given the average rank of the tied positions (standard tie-handling for rank correlation/AUC). */
function rankValues(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation between a feature and a continuous outcome
 * (e.g. R-multiple). Rank-based rather than Pearson so it captures any
 * monotonic relationship, not just a linear one, and isn't distorted by
 * outlier trades. Returns null when there isn't enough data or either
 * series has zero variance in rank (every value tied).
 */
export function spearmanCorrelation(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  const rx = rankValues(x);
  const ry = rankValues(y);
  const n = x.length;
  const meanRx = mean(rx);
  const meanRy = mean(ry);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - meanRx) * (ry[i] - meanRy);
    denX += (rx[i] - meanRx) ** 2;
    denY += (ry[i] - meanRy) ** 2;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

/**
 * ROC-AUC via the rank-sum (Mann-Whitney U) identity — the probability
 * that a randomly-chosen winning trade's feature value is higher than a
 * randomly-chosen losing trade's. 0.5 = the feature has no more separating
 * power than a coin flip; this is the same metric and the same "no better
 * than random" bar PROJECT_STATE.md's Experiment 1 used for signalScore
 * (AUC 0.478, not supported).
 */
export function rocAuc(featureValues: number[], isPositive: boolean[]): number | null {
  if (featureValues.length !== isPositive.length) return null;
  const n = featureValues.length;
  const nPos = isPositive.filter(Boolean).length;
  const nNeg = n - nPos;
  if (nPos === 0 || nNeg === 0) return null;
  const ranks = rankValues(featureValues);
  let sumRanksPos = 0;
  for (let i = 0; i < n; i++) {
    if (isPositive[i]) sumRanksPos += ranks[i];
  }
  return (sumRanksPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export interface DecileBucket {
  decile: number; // 1 = lowest feature values, numBuckets = highest
  n: number;
  meanFeatureValue: number;
  winRate: number;
  meanOutcome: number;
}

/**
 * Buckets trades into `numBuckets` groups by feature value (ascending) and
 * reports win rate / mean outcome per bucket — a monotonic trend across
 * buckets is much stronger evidence of a real relationship than a single
 * pooled correlation number, and surfaces non-linear (e.g. U-shaped)
 * relationships a single correlation coefficient would hide.
 */
export function decileAnalysis(
  featureValues: number[],
  outcomes: number[],
  won: boolean[],
  numBuckets = 10
): DecileBucket[] {
  const n = featureValues.length;
  if (n === 0 || featureValues.length !== outcomes.length || featureValues.length !== won.length) return [];

  const indexed = featureValues.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const bucketSize = Math.ceil(n / numBuckets);
  const buckets: DecileBucket[] = [];

  for (let b = 0; b < numBuckets; b++) {
    const slice = indexed.slice(b * bucketSize, (b + 1) * bucketSize);
    if (slice.length === 0) continue;
    const idxs = slice.map((s) => s.i);
    buckets.push({
      decile: b + 1,
      n: idxs.length,
      meanFeatureValue: mean(idxs.map((i) => featureValues[i])),
      winRate: idxs.filter((i) => won[i]).length / idxs.length,
      meanOutcome: mean(idxs.map((i) => outcomes[i])),
    });
  }

  return buckets;
}
