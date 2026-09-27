/**
 * IBKR-specific types for paper trading integration via TWS (Trader
 * Workstation). All order placement here goes through the account's paper
 * trading mode — this code never distinguishes paper vs. live at the API
 * level, so IBKR_PORT/account selection in TWS itself is what guarantees
 * paper-only execution. See src/brokers/IBKRClient.ts's connect() doc for
 * the required TWS configuration.
 */

export interface IBKRConfig {
  host: string;
  port: number;
  clientId: number;
}

export interface IBKRAccountSummary {
  accountId: string;
  totalCashValue: number | null;
  netLiquidation: number | null;
  buyingPower: number | null;
  availableFunds: number | null;
}

export interface IBKRPosition {
  account: string;
  ticker: string;
  quantity: number;
  avgCost: number;
}

export interface BracketOrderRequest {
  ticker: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  entryLimitPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  /**
   * When set, the stop-loss child leg is placed as a TRAIL order that
   * trails price by this percent instead of a fixed STP order —
   * `stopLossPrice` is still used, as the TRAIL order's initial
   * `trailStopPrice` (the worst-case stop before the trail has engaged).
   */
  trailingPercent?: number;
}

export interface BracketOrderIds {
  parentOrderId: number;
  takeProfitOrderId: number;
  stopLossOrderId: number;
}

export interface OrderStatusUpdate {
  orderId: number;
  status: string;
  filled: number;
  remaining: number;
  avgFillPrice: number;
}

export interface IBKROpenOrder {
  orderId: number;
  ticker: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
}
