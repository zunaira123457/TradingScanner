/**
 * IBKR Day Trading: a long-running daemon that connects to TWS once, then
 * polls on an interval during 8:30am-3pm CST (configurable), scanning a
 * watchlist for intraday setups (src/strategies/intraday), ranking them,
 * and placing trailing-stop bracket orders for the top few each day —
 * up to IBKR_DAY_TRADING_MAX_TRADES_PER_DAY. Outside that window it sleeps;
 * at the end of the window it flattens any positions it opened that day.
 *
 * This places REAL orders through the TWS API against whichever account TWS
 * is logged into — VERIFY THAT ACCOUNT IS THE PAPER ACCOUNT IN TWS BEFORE
 * RUNNING. Requires TWS running and configured exactly as documented in
 * src/brokers/IBKRClient.ts's connect().
 *
 * Usage:
 *   npm run ibkr-day-trade -- AAPL MSFT NVDA   (manual watchlist)
 *   npm run ibkr-day-trade -- --universe        (top N of the cached liquid-stock universe)
 */
import * as path from 'path';
import { BarSizeSetting } from '@stoqey/ib';
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { IBKRClient } from '@/brokers/IBKRClient';
import { OrderExecutor, OrderExecutorConfig } from '@/brokers/OrderExecutor';
import { calculatePositionSize } from '@/backtesting/PositionSizing';
import { getTopLiquidStocks } from '@/data/DynamicUniverse';
import { buildIntradayContext } from '@/strategies/intraday/IntradayStrategyContext';
import { OpeningRangeBreakoutStrategy } from '@/strategies/intraday/OpeningRangeBreakout';
import { VwapTrendContinuationStrategy } from '@/strategies/intraday/VwapTrendContinuation';
import { MomentumBreakoutStrategy } from '@/strategies/intraday/MomentumBreakout';
import { calculateIntradayScore, IntradayMarketContext } from '@/scoring/IntradayScoringEngine';
import { explainIntradaySignal } from '@/scoring/IntradaySignalExplainer';
import { classifySignal, DEFAULT_CLASSIFICATION_THRESHOLDS } from '@/scoring/ScoringEngine';
import { SignalExplanation } from '@/types/scoring';
import { IntradayContext } from '@/types/intraday';
import { isWithinDayTradingWindow, isPastDayTradingWindow } from '@/utils/marketHours';
import {
  loadDayTradingState,
  saveDayTradingState,
  recordDayTrade,
  getStalePositions,
  removeOpenPosition,
  currentDayTradingDateKey,
  DayTradingStateData,
  DayTradingPosition,
} from '@/paperTrading/DayTradingState';
import logger from '@/utils/logger';

const STATE_PATH = path.join(__dirname, '../../data/daytrading-state.json');
const INTRADAY_BAR_SIZE = BarSizeSetting.MINUTES_FIVE;
const INTRADAY_DURATION = '2 D'; // 2 days of 5-min bars: warms up EMA21/RSI14 before today's opening range forms

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTickers(provider: TwelveDataProvider, args: string[]): Promise<string[]> {
  if (args.includes('--universe')) {
    const universe = await getTopLiquidStocks(provider);
    return universe.slice(0, config.ibkrDayTradingUniverseSize);
  }
  return args.filter((a) => !a.startsWith('--')).map((t) => t.toUpperCase());
}

/** Fetches intraday candles + builds context for one ticker; returns null (with a logged warning) on any failure so one bad ticker never aborts the whole scan cycle. */
async function tryBuildContext(client: IBKRClient, ticker: string): Promise<IntradayContext | null> {
  try {
    const candles = await client.getIntradayCandles(ticker, INTRADAY_BAR_SIZE, INTRADAY_DURATION, true);
    if (candles.length === 0) return null;
    return buildIntradayContext(ticker, candles);
  } catch (error) {
    logger.warn(`${ticker}: failed to fetch intraday candles (${error instanceof Error ? error.message : error})`);
    return null;
  }
}

/**
 * Cancels the still-working bracket legs and market-sells the live quantity
 * for each given position, then removes ONLY the positions actually
 * resolved (successfully flattened, or confirmed to have never filled)
 * from state.openPositions. A position that fails to flatten is
 * deliberately left in place so the next tick retries it, instead of being
 * silently forgotten — see loadDayTradingState's rollover-carry-forward doc
 * in DayTradingState.ts for why that distinction matters (a bulk "clear
 * everything regardless of outcome" here was the actual bug: a failed
 * flatten used to vanish from every check this system does while still
 * being open for real in the account). Leaves any non-day-trading positions
 * (e.g. swing positions) untouched.
 */
async function flattenPositions(
  client: IBKRClient,
  state: DayTradingStateData,
  positions: DayTradingPosition[],
  reason: string
): Promise<void> {
  if (positions.length === 0) return;

  logger.info(`Flattening ${positions.length} position(s) (${reason}): ${positions.map((p) => p.ticker).join(', ')}`);

  const livePositions = await client.getPositions();
  const liveByTicker = new Map(livePositions.map((p) => [p.ticker, p]));

  for (const position of positions) {
    client.cancelOrder(position.takeProfitOrderId);
    client.cancelOrder(position.stopLossOrderId);

    const live = liveByTicker.get(position.ticker);
    if (!live || live.quantity <= 0) {
      logger.info(`${position.ticker}: no live position found (entry likely never filled) — nothing to flatten`);
      removeOpenPosition(state, position.ticker);
      continue;
    }

    try {
      await client.flattenPosition(position.ticker, live.quantity);
      removeOpenPosition(state, position.ticker);
    } catch (error) {
      logger.error(
        `${position.ticker}: failed to flatten (${error instanceof Error ? error.message : error}) — will retry next cycle`
      );
    }
  }

  saveDayTradingState(STATE_PATH, state);
}

async function runScanCycle(
  client: IBKRClient,
  executorConfig: OrderExecutorConfig,
  tickers: string[],
  state: DayTradingStateData,
  dryRun: boolean
): Promise<void> {
  const slotsRemaining = config.ibkrDayTradingMaxTradesPerDay - state.tradesExecutedToday;
  if (slotsRemaining <= 0) {
    logger.info(`Daily trade cap reached (${state.tradesExecutedToday}/${config.ibkrDayTradingMaxTradesPerDay}) — skipping scan this cycle`);
    return;
  }

  const spyContext = await tryBuildContext(client, 'SPY');
  const market: IntradayMarketContext = { spy: spyContext };

  const strategies = [
    new OpeningRangeBreakoutStrategy(),
    new VwapTrendContinuationStrategy(),
    new MomentumBreakoutStrategy(),
  ];

  const candidates: SignalExplanation[] = [];

  for (const ticker of tickers) {
    if (state.tickersTradedToday.includes(ticker)) continue;

    const context = await tryBuildContext(client, ticker);
    if (context === null) continue;

    for (const strategy of strategies) {
      const result = strategy.evaluate(context);
      const scoreBreakdown = calculateIntradayScore(context, market, result);
      const classification = classifySignal(scoreBreakdown.total, result.setupDetected, DEFAULT_CLASSIFICATION_THRESHOLDS);
      if (classification !== 'BUY') continue;
      candidates.push(explainIntradaySignal(context, market, result, scoreBreakdown, classification));
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates.slice(0, slotsRemaining);

  logger.info(
    `Scan cycle: ${candidates.length} BUY signal(s) found, taking top ${selected.length} (${slotsRemaining} slot(s) remaining today)` +
      (dryRun ? ' [DRY RUN — no orders will be placed]' : '')
  );

  for (const signal of selected) {
    logger.info(
      `${signal.ticker} — ${signal.strategy} (score ${signal.score.toFixed(1)}): entry $${signal.entry?.toFixed(2)}, ` +
        `stop $${signal.stop?.toFixed(2)}, target $${signal.target?.toFixed(2)}`
    );

    if (dryRun) {
      // Same sizing formula OrderExecutor uses, without ever calling placeBracketOrder.
      const riskBasedQuantity = calculatePositionSize(
        executorConfig.accountEquity,
        signal.entry as number,
        signal.stop as number,
        executorConfig.maxRiskPerTradePct,
        false
      );
      const notionalCapQuantity = Math.floor(executorConfig.maxPositionValueUsd / (signal.entry as number));
      const quantity = Math.min(riskBasedQuantity, notionalCapQuantity);
      logger.info(
        `  [DRY RUN] would BUY ${quantity} shares, trailing stop ${executorConfig.trailingStopPercent}% (initial stop $${signal.stop?.toFixed(2)})`
      );
      continue;
    }

    try {
      const executor = new OrderExecutor(client, executorConfig);
      const ids = await executor.executeSignal(signal);
      if (ids === null) continue;
      recordDayTrade(state, {
        ticker: signal.ticker,
        quantity: ids.quantity,
        parentOrderId: ids.parentOrderId,
        takeProfitOrderId: ids.takeProfitOrderId,
        stopLossOrderId: ids.stopLossOrderId,
        openedDate: currentDayTradingDateKey(),
      });
      saveDayTradingState(STATE_PATH, state);
    } catch (error) {
      logger.error(`${signal.ticker}: failed to place order (${error instanceof Error ? error.message : error})`);
    }
  }
}

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }
  if (!config.twelveDataApiKey) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  const tickers = await resolveTickers(provider, args);

  if (tickers.length === 0) {
    logger.error('Usage: npm run ibkr-day-trade -- AAPL MSFT NVDA [--dry-run]');
    logger.error('   or: npm run ibkr-day-trade -- --universe [--dry-run]   (top liquid-stock universe, size via IBKR_DAY_TRADING_UNIVERSE_SIZE)');
    process.exit(1);
  }

  logger.info('='.repeat(70));
  logger.info(`IBKR DAY TRADING${dryRun ? ' — DRY RUN (no orders will be placed)' : ''}`);
  logger.info(
    `Window: ${config.ibkrDayTradingStartTimeCst}-${config.ibkrDayTradingEndTimeCst} CST, poll every ${config.ibkrDayTradingPollIntervalMinutes} min, ` +
      `max ${config.ibkrDayTradingMaxTradesPerDay} trades/day, ${tickers.length} ticker(s) watched`
  );
  logger.info('='.repeat(70));

  const client = new IBKRClient({ host: config.ibkrHost, port: config.ibkrPort, clientId: config.ibkrClientId });
  await client.connect();

  client.onOrderStatus((update) => {
    logger.info(
      `  Order ${update.orderId}: ${update.status} (filled ${update.filled}, remaining ${update.remaining}` +
        `${update.avgFillPrice > 0 ? `, avg fill $${update.avgFillPrice.toFixed(2)}` : ''})`
    );
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down — disconnecting from TWS.');
    client.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const pollIntervalMs = config.ibkrDayTradingPollIntervalMinutes * 60 * 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = new Date();
    const today = currentDayTradingDateKey(now);
    const state = loadDayTradingState(STATE_PATH, now);

    // Carried-over positions from a prior day (a flatten that failed, or a
    // restart that missed the end-of-day window entirely) are flattened
    // immediately on every tick, regardless of the trading-hours window —
    // this isn't a new day-trade decision, it's cleanup of a stuck one, and
    // it self-retries until flattenPositions actually confirms success.
    const stalePositions = getStalePositions(state, today);
    if (stalePositions.length > 0) {
      try {
        await flattenPositions(client, state, stalePositions, `carried over from a prior day`);
      } catch (error) {
        logger.error(`Failed to flatten carried-over positions: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (isPastDayTradingWindow(now, config.ibkrDayTradingEndTimeCst)) {
      const todaysPositions = state.openPositions.filter((p) => p.openedDate === today);
      if (todaysPositions.length > 0) {
        try {
          await flattenPositions(client, state, todaysPositions, 'end of day-trading window');
        } catch (error) {
          logger.error(`Failed to flatten end-of-day positions: ${error instanceof Error ? error.message : error}`);
        }
      }
    } else if (isWithinDayTradingWindow(now, config.ibkrDayTradingStartTimeCst, config.ibkrDayTradingEndTimeCst)) {
      const account = await client.getAccountSummary();
      if (account.netLiquidation === null || account.netLiquidation <= 0) {
        logger.warn('Could not read account equity from TWS — skipping scan this cycle');
      } else {
        const executorConfig: OrderExecutorConfig = {
          accountEquity: account.netLiquidation,
          maxRiskPerTradePct: config.ibkrDayTradingMaxRiskPerTradePct / 100,
          maxPositionValueUsd: config.ibkrDayTradingMaxPositionValueUsd,
          trailingStopPercent: config.ibkrDayTradingTrailPercent,
        };
        try {
          await runScanCycle(client, executorConfig, tickers, state, dryRun);
        } catch (error) {
          logger.error(`Scan cycle failed: ${error instanceof Error ? error.message : error}`);
        }
      }
    } else {
      logger.info(`Outside the ${config.ibkrDayTradingStartTimeCst}-${config.ibkrDayTradingEndTimeCst} CST window — sleeping`);
    }

    await sleep(pollIntervalMs);
  }
}

main().catch((error) => {
  logger.error('IBKR day trading script failed:', error);
  process.exit(1);
});
