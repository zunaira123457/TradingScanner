/**
 * DIAGNOSTIC ONLY — no strategy, scoring, or backtester changes. Reproduces
 * the existing 6-month baseline day-trading backtest, extracts a richer
 * point-in-time feature set per trade (extractIntradayTradeFeatures), and
 * asks: does ANY feature available at entry time actually predict outcome,
 * using the same rigor (Cohen's d, effect-size thresholds) the daily
 * momentum_continuation research already established in
 * MOMENTUM_DIAGNOSTICS_REPORT.md — plus Spearman correlation, ROC-AUC, and
 * decile monotonicity for extra confidence before trusting any finding.
 *
 * Candidate features being tested go beyond what the current strategies/
 * score already gate on (which the earlier trade-quality diagnostic showed
 * has ~zero separating power, mirroring PROJECT_STATE.md's prior finding
 * that daily signalScore has AUC 0.478 — not supported): continuous VWAP/
 * EMA distance, price extension from a recent low ("chasing" test), time
 * of day, continuous SPY session momentum, momentum freshness/acceleration,
 * and an alternate-period RSI (tests whether RSI14 is simply miscalibrated
 * for 5-min bars rather than uninformative in principle).
 *
 * Usage:
 *   npm run analyze-intraday-entry-quality-features -- AAPL MSFT GOOGL NVDA TSLA AMD META AMZN NFLX JNJ
 */
import { config, validateConfig } from '@/config/environment';
import { getCachedIntradayCandles } from '@/data/IntradayDataCache';
import { IntradayBacktester, IntradayBacktestConfig } from '@/backtesting/IntradayBacktester';
import { OpeningRangeBreakoutStrategy } from '@/strategies/intraday/OpeningRangeBreakout';
import { VwapTrendContinuationStrategy } from '@/strategies/intraday/VwapTrendContinuation';
import { MomentumBreakoutStrategy } from '@/strategies/intraday/MomentumBreakout';
import { extractIntradayTradeFeatures } from '@/research/IntradayTradeFeatureExtractor';
import { compareFeature, rankFeatureComparisons, spearmanCorrelation, rocAuc, decileAnalysis, FeatureComparison } from '@/research/DistributionAnalysis';
import { BacktestConfig } from '@/types/backtest';
import { IntradayStrategy } from '@/types/intraday';
import { IntradayTradeFeatureRecord } from '@/types/research';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'JNJ'];
const INTERVAL = '5min';

// Feature accessor map — one place defining every feature under test, so
// every downstream analysis (Cohen's d, Spearman, AUC, deciles) iterates
// the exact same list rather than three separately-maintained lists.
const FEATURES: Array<{ name: string; get: (r: IntradayTradeFeatureRecord) => number | null }> = [
  { name: 'entryRsi14', get: (r) => r.entryRsi14 },
  { name: 'entryRelativeVolume', get: (r) => r.entryRelativeVolume },
  { name: 'entryAtrPctOfPrice', get: (r) => r.entryAtrPctOfPrice },
  { name: 'scoreTotal', get: (r) => r.scoreTotal },
  { name: 'scoreTrend', get: (r) => r.scoreTrend },
  { name: 'scoreMomentum', get: (r) => r.scoreMomentum },
  { name: 'scoreVolume', get: (r) => r.scoreVolume },
  { name: 'scoreRelativeStrength', get: (r) => r.scoreRelativeStrength },
  { name: 'scoreChartSetup', get: (r) => r.scoreChartSetup },
  { name: 'scoreMarketRegime', get: (r) => r.scoreMarketRegime },
  { name: 'vwapDistancePct', get: (r) => r.vwapDistancePct },
  { name: 'emaSpreadPct', get: (r) => r.emaSpreadPct },
  { name: 'extensionFromRecentLowPct', get: (r) => r.extensionFromRecentLowPct },
  { name: 'minutesSinceOpen', get: (r) => r.minutesSinceOpen },
  { name: 'spyIntradayPctChange', get: (r) => r.spyIntradayPctChange },
  { name: 'consecutiveUpBars', get: (r) => r.consecutiveUpBars },
  { name: 'rsi14Delta3Bars', get: (r) => r.rsi14Delta3Bars },
  { name: 'rsi9', get: (r) => r.rsi9 },
];

function printComparison(c: FeatureComparison): void {
  const d = c.cohensD !== null ? c.cohensD.toFixed(3) : 'n/a';
  logger.info(
    `${c.feature.padEnd(26)} | d=${d.padStart(7)} (${c.effectStrength.padEnd(18)}) | winners: ${c.winners.mean.toFixed(3)} | losers: ${c.losers.mean.toFixed(3)}`
  );
}

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const tickers = args.length > 0 ? args.map((t) => t.toUpperCase()) : DEFAULT_TICKERS;

  const universe = new Map<string, Candle[]>();
  for (const ticker of tickers) {
    const candles = getCachedIntradayCandles(ticker, INTERVAL);
    if (candles) universe.set(ticker, candles);
  }
  const spyCandles = getCachedIntradayCandles('SPY', INTERVAL);
  if (!spyCandles || universe.size === 0) {
    logger.error('Missing cached intraday data — run download-intraday-data first.');
    process.exit(1);
  }

  logger.info('='.repeat(70));
  logger.info('INTRADAY ENTRY-QUALITY FEATURE DIAGNOSTIC (read-only — no strategy changes)');
  logger.info(`Universe: ${[...universe.keys()].join(', ')}`);
  logger.info('='.repeat(70));

  const backtestConfig: BacktestConfig = {
    startingCapital: 10000,
    maxRiskPerTradePct: config.ibkrDayTradingMaxRiskPerTradePct / 100,
    maxPositions: config.ibkrDayTradingMaxTradesPerDay,
    maxPortfolioExposurePct: 0.9,
    slippageBps: 5,
    commissionBps: 2,
    fractionalShares: false,
  };
  const dayConfig: IntradayBacktestConfig = {
    maxTradesPerDay: config.ibkrDayTradingMaxTradesPerDay,
    maxPositionValueUsd: config.ibkrDayTradingMaxPositionValueUsd,
    trailingPercent: config.ibkrDayTradingTrailPercent,
    startTimeCst: config.ibkrDayTradingStartTimeCst,
    endTimeCst: config.ibkrDayTradingEndTimeCst,
  };
  const strategies: IntradayStrategy[] = [
    new OpeningRangeBreakoutStrategy(),
    new VwapTrendContinuationStrategy(),
    new MomentumBreakoutStrategy(),
  ];
  const strategiesByName = new Map(strategies.map((s) => [s.name, s]));

  const result = new IntradayBacktester().run(strategies, universe, spyCandles, backtestConfig, dayConfig);
  logger.info(`Reproduced baseline run: ${result.trades.length} trades\n`);

  const records = extractIntradayTradeFeatures(result.trades, universe, spyCandles, strategiesByName);
  logger.info(`Extracted features for ${records.length}/${result.trades.length} trades\n`);

  const winners = records.filter((r) => r.won);
  const losers = records.filter((r) => !r.won);
  logger.info(`Winners: ${winners.length} | Losers: ${losers.length}\n`);

  // --- Section 1: Cohen's d, winners vs losers, ranked (same methodology as MOMENTUM_DIAGNOSTICS_REPORT.md) ---
  logger.info('--- SECTION 1: Cohen\'s d (winners vs losers), ranked by |d| ---');
  const comparisons = FEATURES.map((f) => compareFeature(f.name, winners.map(f.get), losers.map(f.get)));
  for (const c of rankFeatureComparisons(comparisons)) printComparison(c);

  // --- Section 2: Spearman correlation + ROC-AUC vs outcome ---
  logger.info('\n--- SECTION 2: Spearman correlation (vs R-multiple) + ROC-AUC (vs win/loss) ---');
  const withOutcome = records.filter((r) => r.rMultiple !== null);
  const rMultiples = withOutcome.map((r) => r.rMultiple as number);
  const wonFlags = withOutcome.map((r) => r.won);

  interface Ranked { name: string; spearman: number | null; auc: number | null; }
  const ranked: Ranked[] = FEATURES.map((f) => {
    const values = withOutcome.map(f.get);
    const validPairs = values.map((v, i) => ({ v, r: rMultiples[i], w: wonFlags[i] })).filter((p) => p.v !== null) as Array<{ v: number; r: number; w: boolean }>;
    const spearman = validPairs.length >= 3 ? spearmanCorrelation(validPairs.map((p) => p.v), validPairs.map((p) => p.r)) : null;
    const auc = validPairs.length >= 3 ? rocAuc(validPairs.map((p) => p.v), validPairs.map((p) => p.w)) : null;
    return { name: f.name, spearman, auc };
  });
  ranked.sort((a, b) => Math.abs(b.auc !== null ? b.auc - 0.5 : 0) - Math.abs(a.auc !== null ? a.auc - 0.5 : 0));
  for (const r of ranked) {
    logger.info(
      `${r.name.padEnd(26)} | Spearman (vs R): ${(r.spearman ?? NaN).toFixed(3).padStart(7)} | ROC-AUC (vs win): ${(r.auc ?? NaN).toFixed(3).padStart(6)}`
    );
  }

  // --- Section 3: three-way bucket comparison — winners / never-worked (<0.3R) / reversed (>=0.7R then lost) ---
  logger.info('\n--- SECTION 3: winners vs "never worked" (<0.3R) vs "worked then reversed" (>=0.7R) ---');
  const neverWorked = losers.filter((r) => (r.mfeR ?? 0) < 0.3);
  const reversed = losers.filter((r) => (r.mfeR ?? 0) >= 0.7);
  logger.info(`winners=${winners.length}, neverWorked=${neverWorked.length}, reversed=${reversed.length}\n`);

  logger.info('winners vs neverWorked:');
  for (const f of FEATURES) {
    const c = compareFeature(f.name, winners.map(f.get), neverWorked.map(f.get));
    if (c.effectStrength !== 'insufficient_sample') printComparison(c);
  }
  logger.info('\nwinners vs reversed:');
  for (const f of FEATURES) {
    const c = compareFeature(f.name, winners.map(f.get), reversed.map(f.get));
    if (c.effectStrength !== 'insufficient_sample') printComparison(c);
  }

  // --- Section 4: decile tables for the top-3 features by |AUC - 0.5| ---
  logger.info('\n--- SECTION 4: decile tables (top 3 features by ROC-AUC separation) ---');
  const top3 = ranked.filter((r) => r.auc !== null).slice(0, 3);
  for (const feat of top3) {
    const featureDef = FEATURES.find((f) => f.name === feat.name);
    if (!featureDef) continue;
    const pairs = withOutcome
      .map((r, i) => ({ v: featureDef.get(r), r: rMultiples[i], w: wonFlags[i] }))
      .filter((p): p is { v: number; r: number; w: boolean } => p.v !== null);
    if (pairs.length < 20) continue;
    const buckets = decileAnalysis(pairs.map((p) => p.v), pairs.map((p) => p.r), pairs.map((p) => p.w));
    logger.info(`\n${feat.name} (AUC=${feat.auc?.toFixed(3)}):`);
    logger.info('Decile | n   | mean value | win rate | mean R');
    for (const b of buckets) {
      logger.info(`  ${String(b.decile).padStart(2)}   | ${String(b.n).padStart(3)} | ${b.meanFeatureValue.toFixed(3).padStart(10)} | ${(b.winRate * 100).toFixed(1).padStart(7)}% | ${b.meanOutcome.toFixed(3).padStart(6)}`);
    }
  }

  // --- Section 5: out-of-sample check on the two closest candidates (extensionFromRecentLowPct, entryAtrPctOfPrice) ---
  // Same discipline as the daily system's Experiment 3/6 temporal holdouts:
  // an "interesting" or "weak" effect found on the full sample means
  // nothing until it's shown to hold on data that did NOT produce it.
  // Chronological split (first half = discovery, second half = validation)
  // rather than a random split, since a random split would let bars from
  // the same trading day leak across both halves.
  logger.info('\n--- SECTION 5: temporal out-of-sample check (first half discovers, second half validates) ---');
  const sortedByDate = [...records].sort((a, b) => a.signalDate.getTime() - b.signalDate.getTime());
  const midpoint = Math.floor(sortedByDate.length / 2);
  const firstHalf = sortedByDate.slice(0, midpoint);
  const secondHalf = sortedByDate.slice(midpoint);
  logger.info(
    `First half: ${firstHalf.length} trades (${firstHalf[0]?.signalDate.toISOString().slice(0, 10)} to ${firstHalf[firstHalf.length - 1]?.signalDate.toISOString().slice(0, 10)})`
  );
  logger.info(
    `Second half: ${secondHalf.length} trades (${secondHalf[0]?.signalDate.toISOString().slice(0, 10)} to ${secondHalf[secondHalf.length - 1]?.signalDate.toISOString().slice(0, 10)})\n`
  );

  for (const featureName of ['extensionFromRecentLowPct', 'entryAtrPctOfPrice']) {
    const featureDef = FEATURES.find((f) => f.name === featureName)!;
    for (const [label, half] of [['first half (discovery)', firstHalf], ['second half (validation)', secondHalf]] as const) {
      const w = half.filter((r) => r.won).map(featureDef.get);
      const l = half.filter((r) => !r.won).map(featureDef.get);
      const c = compareFeature(featureName, w, l);
      logger.info(`${label.padEnd(28)} ${featureName.padEnd(26)} | d=${(c.cohensD ?? NaN).toFixed(3).padStart(7)} (${c.effectStrength})`);
    }
    logger.info('');
  }

  // pino-pretty's transport is a worker thread; without this, the process
  // can exit (and the last batch of log lines silently drop) before it
  // finishes flushing — observed losing this exact section's output.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

main().catch((error) => {
  logger.error('Entry-quality feature diagnostic failed:', error);
  process.exit(1);
});
