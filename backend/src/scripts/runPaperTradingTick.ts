/**
 * Phase 7 — Paper Trading daily tick.
 *
 * SIMULATION ONLY. This script never places a real order and never talks to
 * a brokerage — the only external calls are the same read-only market-data
 * downloads used throughout this project. See src/paperTrading/*.ts for the
 * full design rationale.
 *
 * Run this once per trading day. It is safe to run more than once on the
 * same day, or on a non-trading day (weekend/holiday) — it detects that no
 * new data is available and does nothing.
 *
 * Usage:
 *   npm run paper-trade
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { Backtester } from '@/backtesting/Backtester';
import { auditUniverse } from '@/backtesting/DataQualityAudit';
import { alignSeriesByDate } from '@/backtesting/CalendarAlignment';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { getFullUniverseTickers, getHandCuratedSectorMap } from './downloadUniverse';
import { BacktestConfig, BacktestUniverse } from '@/types/backtest';
import { Candle } from '@/types';
import { resolveLockedStartIndex, parseDateKey, LockedDateNotFoundError } from '@/paperTrading/DateIndexLookup';
import { loadOrInitPaperTradingConfig, loadPersistedHistory, savePersistedHistory } from '@/paperTrading/PaperTradingState';
import { diffTrades, tradeKey, AICommentarySummary } from '@/paperTrading/PaperTradeRecord';
import { getAICommentaryForNewTrade } from '@/paperTrading/PaperTradingAICommentary';
import { formatFullReport, formatNoNewTradingDayMessage } from '@/paperTrading/PaperTradingReport';
import { dateKey } from '@/backtesting/USMarketCalendar';
import { SignalAnalysisService } from '@/ai/SignalAnalysisService';
import { AnthropicAnalysisProvider } from '@/ai/AnthropicAnalysisProvider';
import { JsonHistoricalStrategyStats } from '@/research/HistoricalStrategyStats';
import logger from '@/utils/logger';

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];
const STATE_DIR = './data/paper_trading';
const STRATEGY_NAME = 'momentum_continuation';

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
  logger.info('PHASE 7 — PAPER TRADING TICK (simulation only — no brokerage, no real orders)');
  logger.info('='.repeat(70));

  // --- Download/refresh the same 81-stock universe used throughout this project ---
  const tickers = getFullUniverseTickers();
  const rawCandles = new Map<string, Candle[]>();
  const downloadFailures: string[] = [];
  for (const ticker of tickers) {
    try {
      const { candles } = await downloader.downloadStock(ticker);
      rawCandles.set(ticker, candles);
    } catch (error) {
      downloadFailures.push(ticker);
      logger.warn(`✗ ${ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (downloadFailures.length > 0) {
    logger.info(`Download failures (${downloadFailures.length}): ${downloadFailures.join(', ')}`);
  }
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of INDEX_TICKERS) {
    const { candles } = await downloader.downloadStock(idx);
    indexCandles.set(idx, candles);
  }

  const audit = auditUniverse(rawCandles);
  if (audit.validTickers.length < rawCandles.size) {
    const excluded = [...rawCandles.keys()].filter((t) => !audit.validTickers.includes(t));
    logger.info(`Excluded by data-quality audit: ${excluded.join(', ')}`);
  }

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

  logger.info(`Universe: ${stockTickersAligned.size} stocks, ${benchmarkCandles.length} trading days available (through ${dateKey(benchmarkCandles[benchmarkCandles.length - 1].timestamp)})`);

  // --- Load or lock the paper trading config (first run only) ---
  const latestAvailableDate = dateKey(benchmarkCandles[benchmarkCandles.length - 1].timestamp);
  const { config: paperConfig, wasJustCreated } = loadOrInitPaperTradingConfig(STATE_DIR, STRATEGY_NAME, {
    lockedStartDate: latestAvailableDate,
    strategyName: STRATEGY_NAME,
    initialCapital: config.initialPortfolioValue,
    universeVersion: 'phase4.5-81-stock-v1',
  });
  if (wasJustCreated) {
    logger.info(`First run — locked paper trading start date to ${paperConfig.lockedStartDate}. This will never change.`);
  } else {
    logger.info(`Loaded existing paper trading config — locked start date: ${paperConfig.lockedStartDate}`);
  }

  // --- Idempotency: skip the (otherwise-cheap) backtest run entirely if no new data ---
  const previousHistory = loadPersistedHistory(STATE_DIR);
  if (previousHistory && previousHistory.asOfDate === latestAvailableDate) {
    formatNoNewTradingDayMessage(latestAvailableDate).forEach((line) => logger.info(line));
    return;
  }

  // --- Resolve the locked start date to an index in THIS run's freshly-built array ---
  let startIndex: number;
  try {
    startIndex = resolveLockedStartIndex(benchmarkCandles, paperConfig.lockedStartDate);
  } catch (error) {
    if (error instanceof LockedDateNotFoundError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const endIndex = benchmarkCandles.length - 1;

  // --- Build the paper-trading BacktestConfig from env vars (Section 6 wiring) ---
  const backtestConfig: BacktestConfig = {
    startingCapital: paperConfig.initialCapital, // locked at account creation, not re-read from env each run
    maxRiskPerTradePct: config.maxRiskPerTradePct / 100, // whole-percent env var -> fraction
    maxPositions: config.backtestMaxPositions,
    maxPortfolioExposurePct: 0.8, // no dedicated env var exists for this; matches runBacktest.ts's own default
    slippageBps: config.backtestSlippageBps,
    commissionBps: config.backtestCommissionBps,
    fractionalShares: false,
    sectorMap,
    maxSectorExposurePct: config.backtestMaxSectorExposurePct / 100,
  };
  // NOTE: MAX_PORTFOLIO_RISK_PCT and MAX_DRAWDOWN_PCT remain unused/deferred —
  // neither maps onto any concept Backtester/Portfolio currently compute
  // (no aggregate-risk calc, no drawdown kill-switch anywhere in the engine).
  // See the plan doc / PROJECT_STATE.md for why these are deliberately not
  // silently repurposed to mean something the variable name doesn't say.

  // --- The one and only simulation call: the exact, unmodified Backtester ---
  const backtester = new Backtester();
  const strategy = new MomentumContinuationStrategy();
  const result = backtester.run(strategy, universe, backtestConfig, startIndex, endIndex);

  // --- Diff against the last persisted snapshot for "what's new" reporting ---
  const diff = diffTrades(previousHistory?.trades ?? null, result.trades);

  // --- Optional AI commentary on newly-opened trades only ---
  const aiCommentaryByKey = new Map<string, AICommentarySummary>();
  // Carry forward any commentary already computed in a previous run for trades still present.
  if (previousHistory) {
    for (const [key, summary] of Object.entries(previousHistory.aiCommentaryByTradeKey)) {
      aiCommentaryByKey.set(key, summary);
    }
  }
  if (config.anthropicApiKey && diff.newlyOpened.length > 0) {
    const aiProvider = new AnthropicAnalysisProvider(config.anthropicApiKey, config.anthropicModel);
    const service = new SignalAnalysisService(aiProvider, new JsonHistoricalStrategyStats(), {
      timeoutMs: config.aiAnalysisTimeoutMs,
    });
    for (const trade of diff.newlyOpened) {
      const commentary = await getAICommentaryForNewTrade(trade, strategy, universe, service);
      if (commentary) aiCommentaryByKey.set(tradeKey(trade), commentary);
    }
  } else if (diff.newlyOpened.length > 0) {
    logger.info('ANTHROPIC_API_KEY not configured — new trades will not have AI commentary.');
  }

  // --- Report ---
  // asOfDate uses the same benchmark-derived latestAvailableDate used to lock
  // the config and check idempotency — deliberately NOT result.endDate, which
  // reads off Backtester.ts's internal dateAt() (an arbitrary "first ticker"
  // in the universe Map) and can transiently disagree during a live,
  // multi-minute download window. See PaperTradingReport.ts's doc comment.
  const finalSnapshot = result.equityCurve[result.equityCurve.length - 1];
  formatFullReport({
    config: paperConfig,
    diff,
    aiCommentaryByKey,
    finalSnapshot,
    metrics: result.metrics,
    asOfDate: parseDateKey(latestAvailableDate),
  }).forEach((line) => logger.info(line));

  // --- Persist (config.json only changes on first run; history.json every run) ---
  const aiCommentaryRecord: Record<string, AICommentarySummary> = {};
  for (const [key, summary] of aiCommentaryByKey) aiCommentaryRecord[key] = summary;
  savePersistedHistory(STATE_DIR, {
    asOfDate: latestAvailableDate,
    trades: result.trades,
    equityCurve: result.equityCurve,
    aiCommentaryByTradeKey: aiCommentaryRecord,
  });
}

main().catch((error) => {
  logger.error('Paper trading tick failed:', error);
  process.exit(1);
});
