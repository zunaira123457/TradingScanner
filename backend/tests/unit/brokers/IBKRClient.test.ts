// eslint-disable-next-line no-var
var mockApiInstance: any;

// Requiring @stoqey/ib's top-level barrel (even via jest.requireActual) pulls
// in its unrelated api-next/auto-connection module, which fails to load
// under ts-jest ("Class extends value #<Object> is not a constructor").
// Sidestepping that entirely by pulling only the plain, dependency-free
// submodules IBKRClient actually uses at runtime, and replacing IBApi with a
// fake EventEmitter-based implementation.
jest.mock('@stoqey/ib', () => {
  const { EventEmitter } = require('events');
  const { Stock } = require('@stoqey/ib/dist/api/contract/stock');
  const { EventName } = require('@stoqey/ib/dist/api/data/enum/event-name');
  const { OrderAction } = require('@stoqey/ib/dist/api/order/enum/order-action');
  const { OrderType } = require('@stoqey/ib/dist/api/order/enum/orderType');
  const { BarSizeSetting } = require('@stoqey/ib/dist/api/historical/bar-size-setting');
  const { WhatToShow } = require('@stoqey/ib/dist/api/historical/what-to-show');

  class FakeIBApi extends EventEmitter {
    placeOrder = jest.fn();
    cancelOrder = jest.fn();
    reqHistoricalData = jest.fn();
    reqPositions = jest.fn();
    cancelPositions = jest.fn();
    reqAllOpenOrders = jest.fn();
    reqAccountSummary = jest.fn();
    cancelAccountSummary = jest.fn();
    connect = jest.fn();
    disconnect = jest.fn();
  }

  return {
    Stock,
    EventName,
    OrderAction,
    OrderType,
    BarSizeSetting,
    WhatToShow,
    IBApi: jest.fn().mockImplementation(() => {
      mockApiInstance = new FakeIBApi();
      return mockApiInstance;
    }),
  };
});

import { EventName, OrderType, OrderAction, BarSizeSetting } from '@stoqey/ib';
import { IBKRClient } from '@/brokers/IBKRClient';

async function connectedClient(): Promise<IBKRClient> {
  const client = new IBKRClient({ host: '127.0.0.1', port: 7497, clientId: 1 });
  const connectPromise = client.connect();
  mockApiInstance.emit(EventName.nextValidId, 100);
  await connectPromise;
  return client;
}

describe('IBKRClient', () => {
  describe('placeBracketOrder', () => {
    it('should place a fixed STP stop-loss leg when no trailingPercent is given', async () => {
      const client = await connectedClient();

      await client.placeBracketOrder({
        ticker: 'AAPL',
        action: 'BUY',
        quantity: 10,
        entryLimitPrice: 100,
        stopLossPrice: 95,
        takeProfitPrice: 110,
      });

      expect(mockApiInstance.placeOrder).toHaveBeenCalledTimes(3);
      const [, , stopLossOrder] = mockApiInstance.placeOrder.mock.calls.map((call: any[]) => call[2]);

      expect(stopLossOrder.orderType).toBe(OrderType.STP);
      expect(stopLossOrder.auxPrice).toBe(95);
      expect(stopLossOrder.action).toBe(OrderAction.SELL);
      expect(stopLossOrder.trailingPercent).toBeUndefined();
    });

    it('should place a TRAIL stop-loss leg with the initial trailStopPrice when trailingPercent is given', async () => {
      const client = await connectedClient();

      await client.placeBracketOrder({
        ticker: 'AAPL',
        action: 'BUY',
        quantity: 10,
        entryLimitPrice: 100,
        stopLossPrice: 95,
        takeProfitPrice: 110,
        trailingPercent: 1.5,
      });

      expect(mockApiInstance.placeOrder).toHaveBeenCalledTimes(3);
      const [parentCall, takeProfitCall, stopLossCall] = mockApiInstance.placeOrder.mock.calls;
      const [parentOrderId, , parentOrder] = parentCall;
      const [, , takeProfitOrder] = takeProfitCall;
      const [, , stopLossOrder] = stopLossCall;

      expect(parentOrder.orderType).toBe('LMT');
      expect(parentOrder.transmit).toBe(false);

      expect(takeProfitOrder.lmtPrice).toBe(110);
      expect(takeProfitOrder.parentId).toBe(parentOrderId);
      expect(takeProfitOrder.transmit).toBe(false);

      expect(stopLossOrder.orderType).toBe(OrderType.TRAIL);
      expect(stopLossOrder.trailingPercent).toBe(1.5);
      expect(stopLossOrder.trailStopPrice).toBe(95);
      expect(stopLossOrder.parentId).toBe(parentOrderId);
      expect(stopLossOrder.transmit).toBe(true);
    });

    it('should round prices to the nearest cent', async () => {
      const client = await connectedClient();

      await client.placeBracketOrder({
        ticker: 'AAPL',
        action: 'BUY',
        quantity: 10,
        entryLimitPrice: 100.001,
        stopLossPrice: 95.006,
        takeProfitPrice: 110.004,
      });

      const [, , parentOrder] = mockApiInstance.placeOrder.mock.calls[0];
      const [, , takeProfitOrder] = mockApiInstance.placeOrder.mock.calls[1];
      const [, , stopLossOrder] = mockApiInstance.placeOrder.mock.calls[2];

      expect(parentOrder.lmtPrice).toBe(100);
      expect(takeProfitOrder.lmtPrice).toBe(110);
      expect(stopLossOrder.auxPrice).toBe(95.01);
    });
  });

  describe('flattenPosition', () => {
    it('should place a market SELL order for the given quantity', async () => {
      const client = await connectedClient();

      await client.flattenPosition('AAPL', 25);

      expect(mockApiInstance.placeOrder).toHaveBeenCalledTimes(1);
      const [, , order] = mockApiInstance.placeOrder.mock.calls[0];
      expect(order.action).toBe(OrderAction.SELL);
      expect(order.orderType).toBe('MKT');
      expect(order.totalQuantity).toBe(25);
      expect(order.transmit).toBe(true);
    });
  });

  describe('cancelOrder', () => {
    it('should delegate to the underlying API', async () => {
      const client = await connectedClient();
      client.cancelOrder(42);
      expect(mockApiInstance.cancelOrder).toHaveBeenCalledWith(42);
    });
  });

  describe('getOpenOrders', () => {
    it('should resolve with parsed orders once openOrderEnd fires', async () => {
      const client = await connectedClient();

      const promise = client.getOpenOrders();
      mockApiInstance.emit(
        EventName.openOrder,
        200,
        { symbol: 'AAPL' },
        { action: OrderAction.SELL, orderType: OrderType.TRAIL, totalQuantity: 10, trailStopPrice: 95 },
        { status: 'Submitted' }
      );
      mockApiInstance.emit(EventName.openOrderEnd);

      const orders = await promise;

      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({
        orderId: 200,
        ticker: 'AAPL',
        action: OrderAction.SELL,
        orderType: OrderType.TRAIL,
        totalQuantity: 10,
        status: 'Submitted',
      });
    });

    it('should resolve with an empty array when there are no open orders', async () => {
      const client = await connectedClient();

      const promise = client.getOpenOrders();
      mockApiInstance.emit(EventName.openOrderEnd);

      const orders = await promise;
      expect(orders).toEqual([]);
    });
  });

  describe('getIntradayCandles', () => {
    it('should resolve with parsed candles once the "finished" sentinel is received', async () => {
      const client = await connectedClient();

      const promise = client.getIntradayCandles('AAPL', BarSizeSetting.MINUTES_FIVE, '1 D', true);
      // Let the internal throttle .then() resolve so reqHistoricalData is called.
      await new Promise((resolve) => setImmediate(resolve));

      const reqId = mockApiInstance.reqHistoricalData.mock.calls[0][0];
      mockApiInstance.emit(EventName.historicalData, reqId, '1705505400', 100, 101, 99, 100.5, 1000, 5, 100.2, false);
      mockApiInstance.emit(EventName.historicalData, reqId, '1705505700', 100.5, 102, 100, 101.5, 1200, 5, 101.0, false);
      mockApiInstance.emit(
        EventName.historicalData,
        reqId,
        'finished-20240117  09:30:00-20240117  16:00:00',
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        false
      );

      const candles = await promise;

      expect(candles).toHaveLength(2);
      expect(candles[0].close).toBe(100.5);
      expect(candles[0].volume).toBe(1000);
      expect(candles[0].timestamp.getTime()).toBe(1705505400 * 1000);
      expect(candles[1].close).toBe(101.5);
    });

    it('should ignore historicalData events for a different reqId', async () => {
      const client = await connectedClient();

      const promise = client.getIntradayCandles('AAPL');
      await new Promise((resolve) => setImmediate(resolve));
      const reqId = mockApiInstance.reqHistoricalData.mock.calls[0][0];
      const otherReqId = reqId + 1;

      mockApiInstance.emit(EventName.historicalData, otherReqId, '1705505400', 1, 2, 0.5, 1.5, 999, 1, 1.2, false);
      mockApiInstance.emit(EventName.historicalData, reqId, 'finished-x-y', -1, -1, -1, -1, -1, -1, -1, false);

      const candles = await promise;
      expect(candles).toHaveLength(0);
    });
  });
});
