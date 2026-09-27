import { EvidenceAssessment, EvidenceCriteria, EvidenceLevel } from '@/types/analytics';

export interface ConfidenceInterval {
  lower: number;
  upper: number;
  methodology: string;
}

/**
 * Wilson score interval for a binomial proportion (e.g. win rate) — chosen
 * over the simpler normal-approximation interval because it stays well-
 * behaved for small n and proportions near 0 or 1, both common in trading
 * backtests with modest trade counts.
 *
 * IMPORTANT CAVEAT (state this alongside any reported interval): this
 * assumes trades are independent, identically-distributed Bernoulli draws.
 * Real trades are NOT strictly independent — they can be serially
 * correlated (shared market regime, sector co-movement, overlapping
 * holding periods). Treat this interval as an illustrative approximate
 * range under a simplifying assumption, not a rigorous guarantee.
 */
export function wilsonScoreInterval(successes: number, n: number, z = 1.96): ConfidenceInterval {
  if (n === 0) {
    return { lower: 0, upper: 0, methodology: 'Wilson score interval (95%, z=1.96); n=0, undefined' };
  }
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
    methodology: `Wilson score interval (95%, z=${z}), assumes i.i.d. Bernoulli trials — real trades are not strictly independent`,
  };
}

/**
 * Explicit, DOCUMENTED-AS-A-HEURISTIC evidence classifier. This is NOT a
 * statistical significance test — it is a transparent point score over
 * fixed, disclosed thresholds, built specifically so "the backtest made
 * money" can never by itself imply strong evidence of a real edge.
 */
export function classifyEvidence(criteria: EvidenceCriteria): EvidenceAssessment {
  const reasons: string[] = [];

  if (criteria.numTrades < 20) {
    reasons.push(`Only ${criteria.numTrades} trades — below the 20-trade floor for any confidence at all`);
    return { level: 'INSUFFICIENT_SAMPLE', reasons, criteria };
  }
  if (criteria.uniqueStocks < 5) {
    reasons.push(`Only ${criteria.uniqueStocks} unique stocks traded — any apparent edge may be a single-stock artifact`);
    return { level: 'INSUFFICIENT_SAMPLE', reasons, criteria };
  }

  let score = 0;

  if (criteria.numTrades >= 50) {
    score++;
    reasons.push(`${criteria.numTrades} trades meets the 50-trade bar for a moderate sample`);
  } else {
    reasons.push(`${criteria.numTrades} trades is a thin sample (50+ preferred)`);
  }

  if (criteria.uniqueStocks >= 15) {
    score++;
    reasons.push(`${criteria.uniqueStocks} unique stocks traded, reducing single-name concentration risk`);
  } else {
    reasons.push(`Only ${criteria.uniqueStocks} unique stocks traded — some concentration risk`);
  }

  if (criteria.yearsCovered >= 4) {
    score++;
    reasons.push(`${criteria.yearsCovered} calendar years covered`);
  } else {
    reasons.push(`Only ${criteria.yearsCovered} year(s) covered — limited market-environment variety`);
  }

  if (criteria.regimesCovered >= 3) {
    score++;
    reasons.push(`${criteria.regimesCovered} distinct market regimes represented`);
  } else {
    reasons.push(`Only ${criteria.regimesCovered} market regime(s) represented`);
  }

  if (criteria.outOfSampleConsistent === true) {
    score++;
    reasons.push('Walk-forward windows show consistent performance');
  } else if (criteria.outOfSampleConsistent === false) {
    reasons.push('Walk-forward windows show INCONSISTENT performance — a real concern, not a footnote');
  }

  if (criteria.parameterRobust === true) {
    score++;
    reasons.push('Performance is stable across nearby parameter values');
  } else if (criteria.parameterRobust === false) {
    reasons.push('Performance is sensitive to parameter choice — possible overfitting risk');
  }

  let level: EvidenceLevel;
  if (score <= 1) level = 'WEAK_EVIDENCE';
  else if (score <= 3) level = 'PROMISING';
  else level = 'STRONGER_EVIDENCE';

  return { level, reasons, criteria };
}
