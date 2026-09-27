import { Portfolio } from '@/backtesting/Portfolio';
import { BacktestConfig } from '@/types/backtest';

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    startingCapital: 100000,
    maxRiskPerTradePct: 0.01,
    maxPositions: 5,
    maxPortfolioExposurePct: 0.8,
    slippageBps: 0,
    commissionBps: 0,
    fractionalShares: false,
    ...overrides,
  };
}

describe('Portfolio', () => {
  describe('openPosition / cash accounting', () => {
    it('should deduct notional + commission from cash, with no slippage/commission configured', () => {
      const portfolio = new Portfolio(100000);
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date('2024-01-01'),
        entryDate: new Date('2024-01-02'), intendedEntryPrice: 100, shares: 100,
        stopPrice: 95, targetPrice: 115, signalScore: 80, marketRegimeAtEntry: 'bullish',
        slippageBps: 0, commissionBps: 0,
      });
      expect(portfolio.cash).toBeCloseTo(100000 - 100 * 100, 8);
    });

    it('should apply entry slippage (worse fill) and commission', () => {
      const portfolio = new Portfolio(100000);
      const trade = portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date('2024-01-01'),
        entryDate: new Date('2024-01-02'), intendedEntryPrice: 100, shares: 100,
        stopPrice: 95, targetPrice: 115, signalScore: 80, marketRegimeAtEntry: 'bullish',
        slippageBps: 10, commissionBps: 2, // 10 bps slippage, 2 bps commission
      });
      // entryPrice = 100 * 1.001 = 100.1
      expect(trade.entryPrice).toBeCloseTo(100.1, 8);
      const notional = 100.1 * 100;
      const commission = notional * 0.0002;
      expect(portfolio.cash).toBeCloseTo(100000 - notional - commission, 6);
      expect(trade.fees).toBeCloseTo(commission, 8);
      expect(trade.slippageCost).toBeCloseTo((100.1 - 100) * 100, 8);
      expect(trade.status).toBe('open');
    });
  });

  describe('closePosition / P&L accounting', () => {
    it('should compute grossPnl, netPnl, and rMultiple correctly for a winning trade', () => {
      const portfolio = new Portfolio(100000);
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date('2024-01-01'),
        entryDate: new Date('2024-01-02'), intendedEntryPrice: 100, shares: 100,
        stopPrice: 95, targetPrice: 115, signalScore: 80, marketRegimeAtEntry: 'bullish',
        slippageBps: 0, commissionBps: 0,
      });

      const trade = portfolio.closePosition('AAPL', 115, new Date('2024-01-10'), 'target', 0, 0);

      expect(trade.grossPnl).toBeCloseTo((115 - 100) * 100, 8);
      expect(trade.netPnl).toBeCloseTo((115 - 100) * 100, 8); // no fees/slippage
      // risk/share = 100-95 = 5; netPnl=1500; rMultiple = 1500/(5*100) = 3.0
      expect(trade.rMultiple).toBeCloseTo(3.0, 8);
      expect(trade.status).toBe('closed');
      expect(portfolio.openPositions.has('AAPL')).toBe(false);
    });

    it('should account for fees and slippage in netPnl', () => {
      const portfolio = new Portfolio(100000);
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date('2024-01-01'),
        entryDate: new Date('2024-01-02'), intendedEntryPrice: 100, shares: 100,
        stopPrice: 95, targetPrice: 115, signalScore: 80, marketRegimeAtEntry: 'bullish',
        slippageBps: 10, commissionBps: 2,
      });
      const trade = portfolio.closePosition('AAPL', 115, new Date('2024-01-10'), 'target', 10, 2);

      // entryPrice=100.1, exitPrice=115*(1-0.001)=114.885
      expect(trade.entryPrice).toBeCloseTo(100.1, 6);
      expect(trade.exitPrice).toBeCloseTo(114.885, 6);
      const grossPnl = (114.885 - 100.1) * 100;
      expect(trade.grossPnl).toBeCloseTo(grossPnl, 4);
      expect(trade.netPnl as number).toBeLessThan(grossPnl); // fees reduce net vs gross
      expect(trade.fees).toBeGreaterThan(0);
    });

    it('should reflect a realized loss when exit is below entry', () => {
      const portfolio = new Portfolio(100000);
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date('2024-01-01'),
        entryDate: new Date('2024-01-02'), intendedEntryPrice: 100, shares: 100,
        stopPrice: 95, targetPrice: 115, signalScore: 80, marketRegimeAtEntry: 'bullish',
        slippageBps: 0, commissionBps: 0,
      });
      const trade = portfolio.closePosition('AAPL', 95, new Date('2024-01-05'), 'stop', 0, 0);
      expect(trade.netPnl).toBeCloseTo(-500, 8);
      expect(trade.rMultiple).toBeCloseTo(-1.0, 8);
    });

    it('should throw when closing a position that is not open', () => {
      const portfolio = new Portfolio(100000);
      expect(() => portfolio.closePosition('AAPL', 100, new Date(), 'stop', 0, 0)).toThrow(/No open position/);
    });

    it('cash should return to a value consistent with realized P&L after a full round trip', () => {
      const portfolio = new Portfolio(100000);
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date('2024-01-01'),
        entryDate: new Date('2024-01-02'), intendedEntryPrice: 100, shares: 100,
        stopPrice: 95, targetPrice: 115, signalScore: 80, marketRegimeAtEntry: 'bullish',
        slippageBps: 0, commissionBps: 0,
      });
      const trade = portfolio.closePosition('AAPL', 110, new Date('2024-01-05'), 'target', 0, 0);
      // No fees/slippage: cash should be startingCapital + netPnl exactly
      expect(portfolio.cash).toBeCloseTo(100000 + (trade.netPnl as number), 8);
    });
  });

  describe('getEquity / getExposurePct', () => {
    it('should mark open positions to the supplied latest prices', () => {
      const portfolio = new Portfolio(100000);
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date('2024-01-01'),
        entryDate: new Date('2024-01-02'), intendedEntryPrice: 100, shares: 100,
        stopPrice: 95, targetPrice: 115, signalScore: 80, marketRegimeAtEntry: 'bullish',
        slippageBps: 0, commissionBps: 0,
      });
      const latestPrices = new Map([['AAPL', 120]]);
      expect(portfolio.getMarketValue(latestPrices)).toBeCloseTo(12000, 8);
      expect(portfolio.getEquity(latestPrices)).toBeCloseTo(90000 + 12000, 8);
      expect(portfolio.getExposurePct(latestPrices)).toBeCloseTo(12000 / 102000, 6);
    });

    it('should fall back to entry price when a latest price is missing', () => {
      const portfolio = new Portfolio(100000);
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date('2024-01-01'),
        entryDate: new Date('2024-01-02'), intendedEntryPrice: 100, shares: 100,
        stopPrice: 95, targetPrice: 115, signalScore: 80, marketRegimeAtEntry: 'bullish',
        slippageBps: 0, commissionBps: 0,
      });
      expect(portfolio.getMarketValue(new Map())).toBeCloseTo(10000, 8);
    });
  });

  describe('canOpenPosition', () => {
    it('should reject a duplicate position in the same ticker', () => {
      const portfolio = new Portfolio(100000);
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date(), entryDate: new Date(),
        intendedEntryPrice: 100, shares: 10, stopPrice: 95, targetPrice: 115,
        signalScore: 80, marketRegimeAtEntry: null, slippageBps: 0, commissionBps: 0,
      });
      expect(portfolio.canOpenPosition('AAPL', 1000, makeConfig(), new Map([['AAPL', 100]]))).toBe(false);
    });

    it('should reject when max positions is reached', () => {
      const portfolio = new Portfolio(100000);
      const config = makeConfig({ maxPositions: 1 });
      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date(), entryDate: new Date(),
        intendedEntryPrice: 100, shares: 10, stopPrice: 95, targetPrice: 115,
        signalScore: 80, marketRegimeAtEntry: null, slippageBps: 0, commissionBps: 0,
      });
      expect(portfolio.canOpenPosition('MSFT', 1000, config, new Map([['AAPL', 100]]))).toBe(false);
    });

    it('should reject when cash is insufficient', () => {
      const portfolio = new Portfolio(500);
      expect(portfolio.canOpenPosition('AAPL', 1000, makeConfig(), new Map())).toBe(false);
    });

    it('should reject when projected exposure exceeds maxPortfolioExposurePct', () => {
      const portfolio = new Portfolio(100000);
      const config = makeConfig({ maxPortfolioExposurePct: 0.5 });
      // Trying to put 60% of equity into one position
      expect(portfolio.canOpenPosition('AAPL', 60000, config, new Map())).toBe(false);
    });

    it('should allow opening when all constraints are satisfied', () => {
      const portfolio = new Portfolio(100000);
      expect(portfolio.canOpenPosition('AAPL', 5000, makeConfig(), new Map())).toBe(true);
    });

    it('should be a no-op sector check when no sectorMap is configured (never blocks on sector alone)', () => {
      const portfolio = new Portfolio(100000);
      const config = makeConfig({ maxPortfolioExposurePct: 1.0 }); // no sectorMap set
      expect(portfolio.canOpenPosition('AAPL', 50000, config, new Map())).toBe(true);
    });

    it('should enforce sector exposure limits when a sectorMap is configured', () => {
      const portfolio = new Portfolio(100000);
      const sectorMap = new Map([['AAPL', 'Technology'], ['MSFT', 'Technology']]);
      const config = makeConfig({ maxPortfolioExposurePct: 1.0, sectorMap, maxSectorExposurePct: 0.3 });

      portfolio.openPosition({
        ticker: 'AAPL', strategy: 'trend_pullback', signalDate: new Date(), entryDate: new Date(),
        intendedEntryPrice: 100, shares: 250, stopPrice: 95, targetPrice: 115, // $25,000 = 25% of equity
        signalScore: 80, marketRegimeAtEntry: null, slippageBps: 0, commissionBps: 0,
      });

      // Adding another $10,000 Technology position would push sector exposure to 35% > 30% limit
      expect(portfolio.canOpenPosition('MSFT', 10000, config, new Map([['AAPL', 100]]))).toBe(false);
      // A tiny $1,000 addition stays under the sector limit
      expect(portfolio.canOpenPosition('MSFT', 1000, config, new Map([['AAPL', 100]]))).toBe(true);
    });
  });
});
