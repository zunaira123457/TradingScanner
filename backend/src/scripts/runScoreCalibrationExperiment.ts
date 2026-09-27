/**
 * Experiment 1 — Signal Score Calibration.
 *
 * Diagnostic/research script ONLY. Rebuilds the exact same 81-stock
 * universe and unmodified momentum_continuation backtest used for the
 * Phase 4.5 report and MOMENTUM_DIAGNOSTICS_REPORT.md (same universe
 * construction, same BacktestConfig, same strategy — nothing here changes
 * strategy rules, scoring weights, risk parameters, or the backtester),
 * then asks a single question of the resulting 226 closed trades: does the
 * deterministic 0-100 signalScore contain any useful information about
 * trade outcome?
 *
 * This script does NOT modify the strategy and does NOT feed its output
 * back into scoring, risk, or the AI layer.
 *
 * Usage:
 *   npm run run-score-calibration
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { Backtester } from '@/backtesting/Backtester';
import { auditUniverse } from '@/backtesting/DataQualityAudit';
import { alignSeriesByDate } from '@/backtesting/CalendarAlignment';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { extractTradeFeatures } from '@/research/TradeFeatureExtractor';
import { getFullUniverseTickers, getHandCuratedSectorMap } from './downloadUniverse';
import { BacktestConfig, BacktestUniverse } from '@/types/backtest';
import { TradeFeatureRecord } from '@/types/research';
import { Candle } from '@/types';
import {
  buildScoreDeciles,
  checkMonotonicity,
  spearmanCorrelation,
  rocAuc,
  analyzeThreshold,
  ScorableTrade,
  ScoreDecile,
} from '@/research/ScoreCalibration';
import { mean } from '@/backtesting/Stats';
import logger from '@/utils/logger';

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];
const CONCENTRATION_TICKERS = ['LLY', 'GE', 'NVDA', 'AMD', 'NEM'];
const THRESHOLDS = [60, 70, 80, 85, 90];

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtPF(pf: number | null): string {
  if (pf === null) return 'n/a';
  if (!Number.isFinite(pf)) return '∞ (no losers)';
  return pf.toFixed(2);
}

function toScorable(records: TradeFeatureRecord[]): ScorableTrade[] {
  return records.map((r) => ({
    signalScore: r.signalScore,
    won: r.won,
    netPnl: r.netPnl,
    rMultiple: r.rMultiple,
    ticker: r.ticker,
    marketRegime: r.marketRegime,
  }));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function printDecileTable(deciles: ScoreDecile[], label: string): void {
  logger.info(`\n-- ${label} --`);
  logger.info(
    'Decile | ScoreRange       |   N | W  | L  | WinRate | AvgPnL   | MedPnL   | Expectancy | AvgR   | MedR   | PF'
  );
  for (const d of deciles) {
    logger.info(
      `${String(d.decile).padStart(6)} | ${d.n > 0 ? `${d.scoreMin.toFixed(1)}-${d.scoreMax.toFixed(1)}`.padEnd(16) : 'n/a'.padEnd(16)} | ${String(d.n).padStart(3)} | ${String(d.winners).padStart(2)} | ${String(d.losers).padStart(2)} | ${pct(d.winRate).padStart(7)} | $${d.avgNetPnl.toFixed(0).padStart(7)} | $${d.medianNetPnl.toFixed(0).padStart(7)} | $${d.expectancy.toFixed(0).padStart(9)} | ${d.avgRMultiple !== null ? d.avgRMultiple.toFixed(2).padStart(6) : '   n/a'} | ${d.medianRMultiple !== null ? d.medianRMultiple.toFixed(2).padStart(6) : '   n/a'} | ${fmtPF(d.profitFactor)}`
    );
  }
}

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }
  if (!config.twelveDataApiKey) throw new Error('TWELVE_DATA_API_KEY not configured');

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);
  const sectorMap = getHandCuratedSectorMap();

  logger.info('='.repeat(70));
  logger.info('EXPERIMENT 1 — SIGNAL SCORE CALIBRATION (research/diagnostic only)');
  logger.info('='.repeat(70));

  // --- Rebuild the EXACT SAME universe/config used for the Phase 4.5 /
  // diagnostics 226-trade baseline (identical to runMomentumDiagnostics.ts) ---
  const tickers = getFullUniverseTickers();
  const rawCandles = new Map<string, Candle[]>();
  for (const ticker of tickers) {
    const { candles } = await downloader.downloadStock(ticker);
    rawCandles.set(ticker, candles);
  }
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of INDEX_TICKERS) {
    const { candles } = await downloader.downloadStock(idx);
    indexCandles.set(idx, candles);
  }

  const audit = auditUniverse(rawCandles);
  const allSeries = new Map<string, Candle[]>([...rawCandles, ...indexCandles]);
  const { aligned } = alignSeriesByDate(allSeries);

  const stockTickersAligned = new Map<string, Candle[]>();
  for (const ticker of audit.validTickers) {
    const series = aligned.get(ticker);
    if (series) stockTickersAligned.set(ticker, series);
  }
  const indexCandlesAligned = new Map<string, Candle[]>();
  for (const idx of INDEX_TICKERS) {
    const series = aligned.get(idx);
    if (series) indexCandlesAligned.set(idx, series);
  }
  const benchmarkCandles = indexCandlesAligned.get('SPY') as Candle[];

  const universe: BacktestUniverse = {
    tickers: stockTickersAligned,
    benchmarkCandles,
    indexCandles: indexCandlesAligned,
  };

  const backtestConfig: BacktestConfig = {
    startingCapital: 100000,
    maxRiskPerTradePct: 0.01,
    maxPositions: 10,
    maxPortfolioExposurePct: 0.8,
    slippageBps: 5,
    commissionBps: 2,
    fractionalShares: false,
    sectorMap,
    maxSectorExposurePct: 0.3,
  };

  const startIndex = 0;
  const endIndex = benchmarkCandles.length - 1;
  const backtester = new Backtester();

  logger.info(`\nUniverse: ${stockTickersAligned.size} stocks, ${benchmarkCandles.length} trading days (unmodified from Phase 4.5)`);
  logger.info('Running baseline momentum_continuation backtest (strategy/scoring UNCHANGED)...');
  await yieldToEventLoop();
  const t0 = Date.now();
  const baseline = backtester.run(new MomentumContinuationStrategy(), universe, backtestConfig, startIndex, endIndex);
  logger.info(`[PROFILING] baseline backtest took ${((Date.now() - t0) / 1000).toFixed(1)}s, ${baseline.trades.length} trades`);
  await yieldToEventLoop();

  // ==========================================================================
  // SECTION 9: DATA INTEGRITY CHECKS
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('DATA INTEGRITY CHECKS');
  logger.info('='.repeat(70));

  const records = extractTradeFeatures(baseline.trades, universe, { sectorMap });
  logger.info(`Closed trades from backtest: ${baseline.trades.length}`);
  logger.info(`Feature records extracted: ${records.length}`);

  const expectedCount = 226;
  if (records.length !== expectedCount) {
    logger.warn(
      `⚠ Trade count is ${records.length}, not the previously reported ${expectedCount}. This can legitimately happen if cached candle data has been refreshed/extended since the original Phase 4.5 run (e.g. new trading days added). Proceeding with the ACTUAL current dataset — all analysis below reflects ${records.length} trades, not a hardcoded 226.`
    );
  } else {
    logger.info(`✓ Trade count matches the previously reported baseline (${expectedCount})`);
  }

  const missingScore = records.filter((r) => r.signalScore === null || r.signalScore === undefined || !Number.isFinite(r.signalScore));
  const missingOutcome = records.filter((r) => r.netPnl === null && r.rMultiple === null);
  const tradeIds = records.map((r) => r.tradeId);
  const duplicateIds = tradeIds.filter((id, i) => tradeIds.indexOf(id) !== i);

  logger.info(`Records missing signalScore: ${missingScore.length}`);
  logger.info(`Records missing outcome data (both netPnl and rMultiple null): ${missingOutcome.length}`);
  logger.info(`Duplicate trade IDs: ${duplicateIds.length}`);

  if (missingScore.length > 0 || duplicateIds.length > 0) {
    logger.error('STOPPING: data integrity check failed. Not proceeding with analysis on incomplete/duplicated data.');
    process.exit(1);
  }

  logger.info('✓ Every trade has a signalScore');
  logger.info('✓ No duplicate trade IDs');
  logger.info(
    '✓ signalScore was computed at signal time by the unmodified ScoringEngine (no code path in this script recomputes or alters it)'
  );
  logger.info(
    '✓ No future outcome data can have entered signalScore — it is read directly from TradeFeatureRecord.signalScore, which TradeFeatureExtractor populates from Trade.signalScore, itself recorded by Backtester.ts at the moment the signal fired (see StrategyContext no-look-ahead guarantees, unchanged here)'
  );

  const winners = records.filter((r) => r.won);
  const losers = records.filter((r) => !r.won);
  logger.info(`\nWinners: ${winners.length} | Losers: ${losers.length}`);

  const winnerScores = winners.map((r) => r.signalScore);
  const loserScores = losers.map((r) => r.signalScore);
  logger.info(`Winner signalScore: mean=${mean(winnerScores).toFixed(2)} median=${median(winnerScores).toFixed(2)}`);
  logger.info(`Loser signalScore:  mean=${mean(loserScores).toFixed(2)} median=${median(loserScores).toFixed(2)}`);

  const scorable = toScorable(records);

  // ==========================================================================
  // SECTION 2: PRIMARY ANALYSIS — SCORE DECILES
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 2: SCORE DECILES (ALL momentum_continuation trades)');
  logger.info('='.repeat(70));
  const deciles = buildScoreDeciles(scorable);
  printDecileTable(deciles, 'All trades, deciles 1 (lowest score) -> 10 (highest score)');

  // ==========================================================================
  // SECTION 3: MONOTONICITY CHECK
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 3: MONOTONICITY CHECK');
  logger.info('='.repeat(70));
  const monotonicity = checkMonotonicity(deciles);
  logger.info(`Win rates by decile (1->10): [${monotonicity.winRates.map((w) => pct(w)).join(', ')}]`);
  logger.info(`Monotonic non-decreasing: ${monotonicity.isMonotonicNonDecreasing}`);
  logger.info(`Reversal count: ${monotonicity.reversalCount}`);
  monotonicity.reversalTransitions.forEach((t) =>
    logger.info(`  Reversal: decile ${t.fromDecile} (${pct(t.fromWinRate)}) -> decile ${t.toDecile} (${pct(t.toWinRate)})`)
  );

  const scoreArr = scorable.map((t) => t.signalScore);
  const wonArr = scorable.map((t) => (t.won ? 1 : 0));
  const netPnlArr = scorable.map((t) => t.netPnl ?? 0);
  const rMultipleArr = scorable.map((t) => t.rMultiple ?? 0);

  const spearmanWin = spearmanCorrelation(scoreArr, wonArr);
  const spearmanPnl = spearmanCorrelation(scoreArr, netPnlArr);
  const spearmanR = spearmanCorrelation(scoreArr, rMultipleArr);
  logger.info(`\nSpearman correlation, signalScore vs win/loss (0/1): ${spearmanWin?.toFixed(3) ?? 'null'}`);
  logger.info(`Spearman correlation, signalScore vs netPnl: ${spearmanPnl?.toFixed(3) ?? 'null'}`);
  logger.info(`Spearman correlation, signalScore vs rMultiple: ${spearmanR?.toFixed(3) ?? 'null'}`);
  logger.info('(descriptive evidence only — not a significance test)');

  const auc = rocAuc(scoreArr, scorable.map((t) => t.won));
  logger.info(`\nROC-AUC (signalScore ranking winners above losers): ${auc?.toFixed(3) ?? 'null'} (0.5 = no discrimination, 1.0 = perfect)`);

  // ==========================================================================
  // SECTION 4: THRESHOLD DIAGNOSTICS
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 4: THRESHOLD DIAGNOSTICS (comparisons only — NOT a proposed rule)');
  logger.info('='.repeat(70));
  logger.info(`Baseline (all ${scorable.length} trades): winRate=${pct(wonArr.filter((w) => w === 1).length / wonArr.length)} expectancy=$${mean(netPnlArr).toFixed(0)}`);
  for (const threshold of THRESHOLDS) {
    const r = analyzeThreshold(scorable, threshold);
    logger.info(
      `score>=${threshold}: n=${r.tradesRetained} winRate=${pct(r.winRate)} expectancy=$${r.expectancy.toFixed(0)} PF=${fmtPF(r.profitFactor)} totalPnL=$${r.totalNetPnl.toFixed(0)} avgR=${r.avgRMultiple !== null ? r.avgRMultiple.toFixed(2) : 'n/a'}`
    );
  }

  // ==========================================================================
  // SECTION 6: CONCENTRATION ROBUSTNESS CHECK
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info(`SECTION 6: CONCENTRATION ROBUSTNESS (excluding ${CONCENTRATION_TICKERS.join(', ')})`);
  logger.info('='.repeat(70));
  const excludedTrades = scorable.filter((t) => !CONCENTRATION_TICKERS.includes(t.ticker));
  logger.info(`Trades remaining after exclusion: ${excludedTrades.length} (of ${scorable.length})`);
  if (excludedTrades.filter((t) => t.won).length >= 10 && excludedTrades.filter((t) => !t.won).length >= 10) {
    const excludedDeciles = buildScoreDeciles(excludedTrades);
    printDecileTable(excludedDeciles, `Excluding ${CONCENTRATION_TICKERS.join(', ')}`);
    const excludedMonotonicity = checkMonotonicity(excludedDeciles);
    logger.info(`Win rates by decile (excl. top winners): [${excludedMonotonicity.winRates.map((w) => pct(w)).join(', ')}]`);
    logger.info(`Reversal count (excl. top winners): ${excludedMonotonicity.reversalCount}`);
    const excludedSpearman = spearmanCorrelation(
      excludedTrades.map((t) => t.signalScore),
      excludedTrades.map((t) => (t.won ? 1 : 0))
    );
    const excludedAuc = rocAuc(excludedTrades.map((t) => t.signalScore), excludedTrades.map((t) => t.won));
    logger.info(`Spearman (score vs win, excl. top winners): ${excludedSpearman?.toFixed(3) ?? 'null'}`);
    logger.info(`ROC-AUC (excl. top winners): ${excludedAuc?.toFixed(3) ?? 'null'}`);
  } else {
    logger.warn('Insufficient winners/losers remaining after exclusion for a reliable decile re-analysis.');
  }

  // ==========================================================================
  // SECTION 7: REGIME BREAKDOWN
  // ==========================================================================
  logger.info(`\n${'='.repeat(70)}`);
  logger.info('SECTION 7: REGIME BREAKDOWN');
  logger.info('='.repeat(70));
  const regimes = [...new Set(records.map((r) => r.marketRegime).filter((r): r is string => r !== null))];
  const MIN_TRADES_FOR_REGIME_DECILES = 40; // need >=4 trades/decile on average to say anything about deciles
  const MIN_TRADES_FOR_REGIME_CORR = 10;
  for (const regime of regimes) {
    const regimeTrades = scorable.filter((t) => t.marketRegime === regime);
    const regimeWinners = regimeTrades.filter((t) => t.won).length;
    const regimeLosers = regimeTrades.filter((t) => !t.won).length;
    logger.info(`\n--- ${regime} (n=${regimeTrades.length}, ${regimeWinners}W/${regimeLosers}L) ---`);
    if (regimeTrades.length < MIN_TRADES_FOR_REGIME_CORR) {
      logger.info('  INSUFFICIENT SAMPLE — no correlation/decile analysis reported for this regime.');
      continue;
    }
    const regimeSpearman = spearmanCorrelation(
      regimeTrades.map((t) => t.signalScore),
      regimeTrades.map((t) => (t.won ? 1 : 0))
    );
    const regimeAuc = rocAuc(regimeTrades.map((t) => t.signalScore), regimeTrades.map((t) => t.won));
    logger.info(`  Spearman (score vs win): ${regimeSpearman?.toFixed(3) ?? 'null'}`);
    logger.info(`  ROC-AUC: ${regimeAuc?.toFixed(3) ?? 'null'}`);
    if (regimeTrades.length >= MIN_TRADES_FOR_REGIME_DECILES) {
      const regimeDeciles = buildScoreDeciles(regimeTrades);
      const regimeMonotonicity = checkMonotonicity(regimeDeciles);
      logger.info(`  Win rates by decile: [${regimeMonotonicity.winRates.map((w) => pct(w)).join(', ')}]`);
      logger.info(`  Reversal count: ${regimeMonotonicity.reversalCount}`);
    } else {
      logger.info(`  (n=${regimeTrades.length} is below the ${MIN_TRADES_FOR_REGIME_DECILES}-trade floor for a 10-decile breakdown — correlation/AUC only)`);
    }
  }

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('EXPERIMENT 1 COMPLETE — research/diagnostic only, no strategy/scoring changes made');
  logger.info('='.repeat(70));
}

main().catch((error) => {
  logger.error('Score calibration experiment failed:', error);
  process.exit(1);
});
