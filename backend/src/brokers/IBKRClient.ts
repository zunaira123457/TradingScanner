import { IBApi, EventName, Stock, Order, OrderAction, OrderType, BarSizeSetting, WhatToShow } from '@stoqey/ib';
import {
  IBKRConfig,
  IBKRAccountSummary,
  IBKRPosition,
  BracketOrderRequest,
  BracketOrderIds,
  OrderStatusUpdate,
  IBKROpenOrder,
} from './IBKRTypes';
import { Candle } from '@/types';
import logger from '@/utils/logger';

/**
 * Thin wrapper around @stoqey/ib's IBApi for connecting to TWS (Trader
 * Workstation) and placing bracket orders (entry + stop-loss + take-profit)
 * against a paper trading account.
 *
 * This code makes no distinction between "paper" and "live" at the API
 * level — that distinction is entirely determined by which account is
 * logged into the TWS instance this connects to. Before using this against
 * anything but a paper account, that must be verified in TWS itself.
 *
 * Required TWS configuration (File -> Global Configuration -> API ->
 * Settings):
 *   - "Enable ActiveX and Socket Clients" checked
 *   - Socket port matches IBKR_PORT (default 7497 for TWS paper trading)
 *   - "Read-Only API" UNCHECKED (orders would otherwise be rejected)
 *   - 127.0.0.1 in trusted IPs (or "Allow connections from localhost only")
 */
export class IBKRClient {
  private api: IBApi;
  private nextOrderId: number | null = null;
  private connected = false;
  private orderStatusListeners: Array<(update: OrderStatusUpdate) => void> = [];
  private lastHistoricalRequestAt = 0;
  // Conservative spacing between reqHistoricalData calls — well under IBKR's
  // pacing limits (roughly 60 requests/10min) — rather than trying to model
  // those limits exactly.
  private readonly HISTORICAL_REQUEST_MIN_INTERVAL_MS = 2000;

  constructor(private config: IBKRConfig) {
    this.api = new IBApi({ host: config.host, port: config.port });
  }

  /**
   * Connects to TWS and waits for the nextValidId handshake that confirms
   * the connection is ready to accept orders. Rejects on error or a 15s
   * timeout (most commonly: TWS not running, wrong port, or API access not
   * enabled in TWS settings).
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Timed out connecting to TWS at ${this.config.host}:${this.config.port}. Check that TWS is running, ` +
              `logged into the paper trading account, and API access is enabled (File > Global Configuration > API > Settings).`
          )
        );
      }, 15000);

      this.api.once(EventName.nextValidId, (orderId: number) => {
        clearTimeout(timeout);
        this.nextOrderId = orderId;
        this.connected = true;
        logger.info(`Connected to TWS at ${this.config.host}:${this.config.port} (clientId=${this.config.clientId})`);
        resolve();
      });

      this.api.once(EventName.error, (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.api.on(EventName.orderStatus, (orderId, status, filled, remaining, avgFillPrice) => {
        const update: OrderStatusUpdate = { orderId, status, filled, remaining, avgFillPrice };
        this.orderStatusListeners.forEach((listener) => listener(update));
      });

      // Non-fatal errors (e.g. informational codes) after the initial
      // handshake should not crash the process — just log them.
      this.api.on(EventName.error, (error: Error, code: number, reqId: number) => {
        if (this.connected) {
          logger.warn(`IBKR error (code ${code}, reqId ${reqId}): ${error.message}`);
        }
      });

      this.api.connect(this.config.clientId);
    });
  }

  disconnect(): void {
    this.api.disconnect();
    this.connected = false;
  }

  onOrderStatus(listener: (update: OrderStatusUpdate) => void): void {
    this.orderStatusListeners.push(listener);
  }

  private requireOrderId(): number {
    if (this.nextOrderId === null) {
      throw new Error('IBKRClient is not connected — call connect() first');
    }
    const id = this.nextOrderId;
    this.nextOrderId += 1;
    return id;
  }

  /**
   * Fetches account summary (cash, net liquidation, buying power). Resolves
   * once TWS signals the summary is complete (accountSummaryEnd).
   */
  getAccountSummary(): Promise<IBKRAccountSummary> {
    return new Promise((resolve, reject) => {
      const reqId = Math.floor(Math.random() * 1_000_000);
      const summary: IBKRAccountSummary = {
        accountId: '',
        totalCashValue: null,
        netLiquidation: null,
        buyingPower: null,
        availableFunds: null,
      };

      const timeout = setTimeout(() => {
        reject(new Error('Timed out requesting account summary from TWS'));
      }, 10000);

      const onSummary = (id: number, account: string, tag: string, value: string) => {
        if (id !== reqId) return;
        summary.accountId = account;
        const num = parseFloat(value);
        if (tag === 'TotalCashValue') summary.totalCashValue = num;
        if (tag === 'NetLiquidation') summary.netLiquidation = num;
        if (tag === 'BuyingPower') summary.buyingPower = num;
        if (tag === 'AvailableFunds') summary.availableFunds = num;
      };

      const onEnd = (id: number) => {
        if (id !== reqId) return;
        clearTimeout(timeout);
        this.api.off(EventName.accountSummary, onSummary);
        this.api.off(EventName.accountSummaryEnd, onEnd);
        this.api.cancelAccountSummary(reqId);
        resolve(summary);
      };

      this.api.on(EventName.accountSummary, onSummary);
      this.api.on(EventName.accountSummaryEnd, onEnd);
      this.api.reqAccountSummary(reqId, 'All', 'TotalCashValue,NetLiquidation,BuyingPower,AvailableFunds');
    });
  }

  /** Fetches all open positions across accessible accounts. */
  getPositions(): Promise<IBKRPosition[]> {
    return new Promise((resolve, reject) => {
      const positions: IBKRPosition[] = [];

      const timeout = setTimeout(() => {
        reject(new Error('Timed out requesting positions from TWS'));
      }, 10000);

      const onPosition = (account: string, contract: { symbol?: string }, pos: number, avgCost?: number) => {
        if (pos === 0) return;
        positions.push({
          account,
          ticker: contract.symbol ?? 'UNKNOWN',
          quantity: pos,
          avgCost: avgCost ?? 0,
        });
      };

      const onEnd = () => {
        clearTimeout(timeout);
        this.api.off(EventName.position, onPosition);
        this.api.off(EventName.positionEnd, onEnd);
        this.api.cancelPositions();
        resolve(positions);
      };

      this.api.on(EventName.position, onPosition);
      this.api.on(EventName.positionEnd, onEnd);
      this.api.reqPositions();
    });
  }

  /** Fetches all currently-working orders (unlike historicalData, openOrderEnd is a real dedicated completion event). */
  getOpenOrders(): Promise<IBKROpenOrder[]> {
    return new Promise((resolve, reject) => {
      const orders: IBKROpenOrder[] = [];

      const timeout = setTimeout(() => {
        reject(new Error('Timed out requesting open orders from TWS'));
      }, 10000);

      const onOpenOrder = (
        orderId: number,
        contract: { symbol?: string },
        order: Order,
        orderState: { status: string }
      ) => {
        orders.push({
          orderId,
          ticker: contract.symbol ?? 'UNKNOWN',
          action: String(order.action),
          orderType: String(order.orderType),
          totalQuantity: order.totalQuantity ?? 0,
          lmtPrice: order.lmtPrice ?? null,
          auxPrice: order.auxPrice ?? null,
          status: orderState.status,
        });
      };

      const onEnd = () => {
        clearTimeout(timeout);
        this.api.off(EventName.openOrder, onOpenOrder);
        this.api.off(EventName.openOrderEnd, onEnd);
        resolve(orders);
      };

      this.api.on(EventName.openOrder, onOpenOrder);
      this.api.on(EventName.openOrderEnd, onEnd);
      this.api.reqAllOpenOrders();
    });
  }

  /**
   * Fetches intraday historical bars for `ticker` via TWS's reqHistoricalData.
   *
   * @stoqey/ib does not expose a dedicated "historical data complete" event
   * — per its decoder (core/io/decoder.js), completion is signaled by a
   * final `historicalData` event whose `time` argument starts with
   * "finished" and whose OHLCV fields are all -1. That sentinel is what
   * resolves this promise.
   */
  getIntradayCandles(
    ticker: string,
    barSizeSetting: BarSizeSetting = BarSizeSetting.MINUTES_FIVE,
    durationStr = '2 D',
    useRTH = true
  ): Promise<Candle[]> {
    return new Promise((resolve, reject) => {
      this.throttleHistoricalRequest().then(() => {
        const reqId = Math.floor(Math.random() * 1_000_000);
        const candles: Candle[] = [];

        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out requesting intraday candles for ${ticker} from TWS`));
        }, 20000);

        const cleanup = () => {
          clearTimeout(timeout);
          this.api.off(EventName.historicalData, onData);
        };

        const onData = (
          id: number,
          time: string,
          open: number,
          high: number,
          low: number,
          close: number,
          volume: number
        ) => {
          if (id !== reqId) return;
          if (time.startsWith('finished')) {
            cleanup();
            resolve(candles);
            return;
          }
          candles.push({
            timestamp: new Date(parseInt(time, 10) * 1000),
            open,
            high,
            low,
            close,
            volume,
          });
        };

        this.api.on(EventName.historicalData, onData);
        this.api.reqHistoricalData(
          reqId,
          new Stock(ticker, 'SMART', 'USD'),
          '',
          durationStr,
          barSizeSetting,
          WhatToShow.TRADES,
          useRTH,
          2, // formatDate: 2 = bar time as epoch seconds
          false
        );
      });
    });
  }

  private async throttleHistoricalRequest(): Promise<void> {
    const elapsed = Date.now() - this.lastHistoricalRequestAt;
    if (elapsed < this.HISTORICAL_REQUEST_MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, this.HISTORICAL_REQUEST_MIN_INTERVAL_MS - elapsed));
    }
    this.lastHistoricalRequestAt = Date.now();
  }

  /**
   * Places a bracket order: a parent entry (limit) order plus two attached
   * child orders (take-profit limit, stop-loss stop) that are OCA-linked by
   * IBKR automatically via parentId — whichever child fills first cancels
   * the other. Only the last child order transmits; the parent and first
   * child are queued but not sent until the final transmit=true order is
   * placed, so all three reach TWS as one atomic bracket.
   */
  async placeBracketOrder(request: BracketOrderRequest): Promise<BracketOrderIds> {
    const contract = new Stock(request.ticker, 'SMART', 'USD');

    const parentOrderId = this.requireOrderId();
    const takeProfitOrderId = this.requireOrderId();
    const stopLossOrderId = this.requireOrderId();

    const oppositeAction = request.action === 'BUY' ? OrderAction.SELL : OrderAction.BUY;

    // IBKR rejects prices that aren't exact cent increments ("does not
    // conform to the minimum price variation"). Strategy-computed stop/
    // target prices (entry +/- ATR multiples, reward multiples) are plain
    // JS floating-point arithmetic and can produce values like
    // 143.57000000000001 — round every price sent to IBKR to the nearest
    // cent to guarantee a clean 2-decimal value.
    const roundToCent = (price: number): number => Math.round(price * 100) / 100;

    const entryLimitPrice = roundToCent(request.entryLimitPrice);
    const takeProfitPrice = roundToCent(request.takeProfitPrice);
    const stopLossPrice = roundToCent(request.stopLossPrice);

    const parent: Order = {
      orderId: parentOrderId,
      action: request.action as OrderAction,
      orderType: OrderType.LMT,
      totalQuantity: request.quantity,
      lmtPrice: entryLimitPrice,
      transmit: false,
    };

    const takeProfit: Order = {
      orderId: takeProfitOrderId,
      action: oppositeAction,
      orderType: OrderType.LMT,
      totalQuantity: request.quantity,
      lmtPrice: takeProfitPrice,
      parentId: parentOrderId,
      transmit: false,
    };

    const stopLoss: Order = request.trailingPercent
      ? {
          orderId: stopLossOrderId,
          action: oppositeAction,
          orderType: OrderType.TRAIL,
          totalQuantity: request.quantity,
          trailingPercent: request.trailingPercent,
          trailStopPrice: stopLossPrice,
          parentId: parentOrderId,
          transmit: true,
        }
      : {
          orderId: stopLossOrderId,
          action: oppositeAction,
          orderType: OrderType.STP,
          totalQuantity: request.quantity,
          auxPrice: stopLossPrice,
          parentId: parentOrderId,
          transmit: true,
        };

    this.api.placeOrder(parentOrderId, contract, parent);
    this.api.placeOrder(takeProfitOrderId, contract, takeProfit);
    this.api.placeOrder(stopLossOrderId, contract, stopLoss);

    const stopDescription = request.trailingPercent
      ? `trailing stop ${request.trailingPercent}% (initial $${request.stopLossPrice.toFixed(2)})`
      : `stop $${request.stopLossPrice.toFixed(2)}`;
    logger.info(
      `Bracket order submitted: ${request.action} ${request.quantity} ${request.ticker} @ $${request.entryLimitPrice.toFixed(2)} ` +
        `(${stopDescription}, target $${request.takeProfitPrice.toFixed(2)}) — orderIds ${parentOrderId}/${takeProfitOrderId}/${stopLossOrderId}`
    );

    return { parentOrderId, takeProfitOrderId, stopLossOrderId };
  }

  /** Cancels a single working order by id (e.g. an unfilled bracket leg). */
  cancelOrder(orderId: number): void {
    this.api.cancelOrder(orderId);
  }

  /**
   * Closes an open long position with a market SELL for `quantity` shares.
   * Does NOT cancel any still-working bracket legs (take-profit/stop) for
   * that position — callers must cancelOrder() those first, since otherwise
   * a stale bracket leg firing later would flip this into a short position.
   */
  async flattenPosition(ticker: string, quantity: number): Promise<void> {
    const contract = new Stock(ticker, 'SMART', 'USD');
    const orderId = this.requireOrderId();

    const order: Order = {
      orderId,
      action: OrderAction.SELL,
      orderType: OrderType.MKT,
      totalQuantity: quantity,
      transmit: true,
    };

    this.api.placeOrder(orderId, contract, order);
    logger.info(`Flatten order submitted: SELL ${quantity} ${ticker} @ MKT — orderId ${orderId}`);
  }
}
