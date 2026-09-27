/**
 * Read-only snapshot of the connected TWS account: equity, every open
 * position, every working order, and (if present) today's day-trading
 * state. Places no orders and cancels nothing — safe to run any time to
 * check what's actually live before or after touching anything in TWS.
 *
 * Usage:
 *   npm run ibkr-status
 */
import * as path from 'path';
import { config } from '@/config/environment';
import { IBKRClient } from '@/brokers/IBKRClient';
import { loadDayTradingState, currentDayTradingDateKey } from '@/paperTrading/DayTradingState';
import logger from '@/utils/logger';

const STATE_PATH = path.join(__dirname, '../../data/daytrading-state.json');

async function main() {
  const client = new IBKRClient({ host: config.ibkrHost, port: config.ibkrPort, clientId: config.ibkrClientId });
  await client.connect();

  const account = await client.getAccountSummary();
  logger.info('='.repeat(70));
  logger.info(`Account ${account.accountId}`);
  logger.info(
    `  Net Liquidation: $${account.netLiquidation?.toFixed(2) ?? 'n/a'}   Buying Power: $${account.buyingPower?.toFixed(2) ?? 'n/a'}   ` +
      `Cash: $${account.totalCashValue?.toFixed(2) ?? 'n/a'}`
  );

  const positions = await client.getPositions();
  logger.info('-'.repeat(70));
  logger.info(`Open positions: ${positions.length}`);
  for (const p of positions) {
    logger.info(`  ${p.ticker}: ${p.quantity} shares @ avg cost $${p.avgCost.toFixed(2)}`);
  }

  const openOrders = await client.getOpenOrders();
  logger.info('-'.repeat(70));
  logger.info(`Working orders: ${openOrders.length}`);
  for (const o of openOrders) {
    const price = o.lmtPrice ?? o.auxPrice;
    logger.info(
      `  #${o.orderId} ${o.ticker}: ${o.action} ${o.totalQuantity} ${o.orderType}` +
        `${price !== null ? ` @ $${price.toFixed(2)}` : ''} — ${o.status}`
    );
  }

  const dayState = loadDayTradingState(STATE_PATH);
  logger.info('-'.repeat(70));
  if (dayState.date === currentDayTradingDateKey()) {
    logger.info(
      `Day-trading state (today, ${dayState.date}): ${dayState.tradesExecutedToday} trade(s) executed, ` +
        `tickers: ${dayState.tickersTradedToday.join(', ') || 'none'}, ${dayState.openPositions.length} tracked open position(s)`
    );
  } else {
    logger.info(`Day-trading state: no record for today (${currentDayTradingDateKey()}) — daemon hasn't run yet`);
  }
  logger.info('='.repeat(70));

  client.disconnect();
}

main().catch((error) => {
  logger.error('IBKR status check failed:', error);
  process.exit(1);
});
