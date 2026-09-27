/**
 * IBKR Paper Trading: connects to TWS (Trader Workstation), generates
 * signals for a given watchlist using the existing Phase 3 pipeline, and
 * places bracket orders (entry + stop + target) for any BUY-classified
 * signal against IBKR's paper trading account.
 *
 * This places REAL orders through the TWS API — "real" in the sense that
 * they are live orders IBKR's paper-trading matching engine will actually
 * fill, not a local simulation. Whether they are paper or live money is
 * determined entirely by which account TWS is logged into — VERIFY THIS IN
 * TWS BEFORE RUNNING.
 *
 * Requires TWS running and configured:
 *   File > Global Configuration > API > Settings
 *     - "Enable ActiveX and Socket Clients" checked
 *     - Socket port = IBKR_PORT (.env, default 7497)
 *     - "Read-Only API" UNCHECKED
 *
 * Usage:
 *   npm run ibkr-paper-trade -- AAPL MSFT NVDA
 *   npm run ibkr-paper-trade -- --universe   (scans the full 81-stock universe)
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { StrategyEngine } from '@/strategies/StrategyEngine';
import { TrendPullbackStrategy } from '@/strategies/TrendPullback';
import { BreakoutStrategy } from '@/strategies/Breakout';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { calculateScore, classifySignal } from '@/scoring/ScoringEngine';
import { explainSignal } from '@/scoring/SignalExplainer';
import { SignalExplanation } from '@/types/scoring';
import { Candle } from '@/types';
import { IBKRClient } from '@/brokers/IBKRClient';
import { OrderExecutor } from '@/brokers/OrderExecutor';
import { getFullUniverseTickers } from './downloadUniverse';
import { getTopLiquidStocks, refreshDynamicUniverse } from '@/data/DynamicUniverse';
import logger from '@/utils/logger';

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  const args = process.argv.slice(2);

  if (!config.twelveDataApiKey) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }

  logger.info('='.repeat(70));
  logger.info('IBKR PAPER TRADING');
  logger.info('='.repeat(70));

  // --- Set up data provider early (needed for dynamic universe) ---
  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);

  // --- Determine which tickers to scan ---
  let tickers: string[];

  if (args.includes('--universe')) {
    // Scan top 500 liquid stocks (refreshed weekly)
    tickers = await getTopLiquidStocks(provider);
  } else if (args.includes('--refresh-universe')) {
    // Force-refresh the dynamic universe cache and then scan
    tickers = await refreshDynamicUniverse(provider);
  } else {
    // Scan manually-specified tickers
    tickers = args.map((t) => t.toUpperCase());
  }

  if (tickers.length === 0) {
    logger.error('Usage: npm run ibkr-paper-trade -- AAPL MSFT NVDA');
    logger.error('   or: npm run ibkr-paper-trade -- --universe            (scans top 500 liquid stocks, cached weekly)');
    logger.error('   or: npm run ibkr-paper-trade -- --refresh-universe   (force-refresh and scan)');
    process.exit(1);
  }

  logger.info(
    `Scanning ${tickers.length} ticker(s)${args.includes('--universe') || args.includes('--refresh-universe') ? ' (top 500 liquid stocks)' : ''}...`
  );

  // --- Connect to TWS first, fail fast if it's not reachable ---
  const client = new IBKRClient({
    host: config.ibkrHost,
    port: config.ibkrPort,
    clientId: config.ibkrClientId,
  });

  try {
    await client.connect();
  } catch (error) {
    logger.error(`Could not connect to TWS: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  client.onOrderStatus((update) => {
    logger.info(
      `  Order ${update.orderId}: ${update.status} (filled ${update.filled}, remaining ${update.remaining}` +
        `${update.avgFillPrice > 0 ? `, avg fill $${update.avgFillPrice.toFixed(2)}` : ''})`
    );
  });

  const account = await client.getAccountSummary();
  logger.info(
    `Account ${account.accountId}: Net Liquidation $${account.netLiquidation?.toFixed(2) ?? 'n/a'}, ` +
      `Buying Power $${account.buyingPower?.toFixed(2) ?? 'n/a'}`
  );

  if (account.netLiquidation === null || account.netLiquidation <= 0) {
    logger.error('Could not read a usable account equity value from TWS — aborting before placing any orders.');
    client.disconnect();
    process.exit(1);
  }

  const existingPositions = await client.getPositions();
  if (existingPositions.length > 0) {
    logger.info(`Existing positions: ${existingPositions.map((p) => `${p.ticker} x${p.quantity}`).join(', ')}`);
  }

  // --- Generate signals using the exact same pipeline as generate-signals ---
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);

  const isConnected = await provider.validateConnection();
  if (!isConnected) {
    logger.error('Failed to connect to Twelve Data. Check your API key.');
    client.disconnect();
    process.exit(1);
  }

  const indexTickers = ['SPY', 'QQQ', 'IWM'];
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of indexTickers) {
    try {
      const { candles } = await downloader.downloadStock(idx);
      indexCandles.set(idx, candles);
    } catch (error) {
      logger.warn(`Could not load index data for ${idx}: ${error instanceof Error ? error.message : error}`);
    }
  }
  const benchmarkCandles = indexCandles.get('SPY');

  const engine = new StrategyEngine();
  engine.register(new TrendPullbackStrategy());
  engine.register(new BreakoutStrategy());
  engine.register(new MomentumContinuationStrategy());

  const explanations: SignalExplanation[] = [];
  for (const ticker of tickers) {
    try {
      const { candles } = await downloader.downloadStock(ticker);
      const context = buildStrategyContext(ticker, candles, {
        marketIndexCandles: indexCandles.size > 0 ? indexCandles : undefined,
        benchmarkCandles,
      });

      const results = engine.evaluateAll(context);
      for (const result of results) {
        const scoreBreakdown = calculateScore(context, result);
        const classification = classifySignal(scoreBreakdown.total, result.setupDetected);
        explanations.push(explainSignal(context, result, scoreBreakdown, classification));
      }
      logger.info(`✓ ${ticker}: evaluated ${results.length} strategies`);
    } catch (error) {
      logger.warn(`✗ ${ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // --- Only BUY-classified signals result in an order. WATCH/AVOID never do. ---
  const buySignals = explanations.filter((e) => e.classification === 'BUY');

  logger.info(`\n${'='.repeat(70)}`);
  logger.info(`${buySignals.length} BUY signal(s) found among ${tickers.length} ticker(s) x 3 strategies`);
  logger.info('='.repeat(70));

  if (buySignals.length === 0) {
    logger.info('No orders to place.');
    client.disconnect();
    return;
  }

  const executor = new OrderExecutor(client, {
    accountEquity: account.netLiquidation,
    maxRiskPerTradePct: config.ibkrMaxRiskPerTradePct / 100,
    maxPositionValueUsd: config.ibkrMaxPositionValueUsd,
  });
  logger.info(
    `Position sizing: risk ${config.ibkrMaxRiskPerTradePct}% per trade, capped at $${config.ibkrMaxPositionValueUsd} notional per trade`
  );

  for (const signal of buySignals) {
    logger.info(
      `\n${signal.ticker} — ${signal.strategy} (score ${signal.score.toFixed(1)}): ` +
        `entry $${signal.entry?.toFixed(2)}, stop $${signal.stop?.toFixed(2)}, target $${signal.target?.toFixed(2)}`
    );
    try {
      await executor.executeSignal(signal);
    } catch (error) {
      logger.error(`  Failed to place order for ${signal.ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Give TWS a moment to emit initial order status events before disconnecting.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('Done. Check TWS for live order/fill status.');
  logger.info('='.repeat(70));

  client.disconnect();
}

main().catch((error) => {
  logger.error('IBKR paper trading script failed:', error);
  process.exit(1);
});
