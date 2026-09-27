import { generateWalkForwardWindows, runWalkForward } from '@/backtesting/WalkForward';
import { Backtester } from '@/backtesting/Backtester';
import { SmaCrossoverStrategy } from '@/backtesting/SmaCrossoverStrategy';
import { BacktestConfig, BacktestUniverse } from '@/types/backtest';
import { Candle } from '@/types';

function c(close: number, dayOffset: number): Candle {
  return { timestamp: new Date(2018, 0, 1 + dayOffset), open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 1000000 };
}

function makeConfig(): BacktestConfig {
  return {
    startingCapital: 10000, maxRiskPerTradePct: 0.01, maxPositions: 5,
    maxPortfolioExposurePct: 0.8, slippageBps: 0, commissionBps: 0, fractionalShares: false,
  };
}

describe('generateWalkForwardWindows', () => {
  it('should produce 5 non-overlapping windows for totalDays=1000, minHistory=252, windowDays=126, stepDays=126', () => {
    const windows = generateWalkForwardWindows(1000, { minHistoryDays: 252, windowDays: 126, stepDays: 126 });
    expect(windows.length).toBe(5);
    expect(windows[0]).toEqual({ index: 0, testStart: 252, testEnd: 377 });
    expect(windows[1].testStart).toBe(378);
    expect(windows[4].testEnd).toBeLessThan(1000);
  });

  it('should produce overlapping windows when stepDays < windowDays', () => {
    const windows = generateWalkForwardWindows(600, { minHistoryDays: 252, windowDays: 126, stepDays: 63 });
    expect(windows[1].testStart - windows[0].testStart).toBe(63);
  });

  it('should produce zero windows when there is not enough history', () => {
    const windows = generateWalkForwardWindows(300, { minHistoryDays: 252, windowDays: 126, stepDays: 126 });
    expect(windows.length).toBe(0);
  });
});

describe('runWalkForward', () => {
  it('should run one independent backtest per window and compute consistency stats matching an independent recomputation', () => {
    // Oscillating series long enough for several windows + SMA200 warm-up.
    const candles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 900; i++) {
      price += Math.sin(i / 15) * 1.5 + 0.05;
      candles.push(c(price, i));
    }
    const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };
    const backtester = new Backtester();

    const wfResult = runWalkForward(
      backtester,
      new SmaCrossoverStrategy(),
      universe,
      makeConfig(),
      { minHistoryDays: 252, windowDays: 126, stepDays: 126 }
    );

    const expectedWindowCount = Math.floor((900 - 252 - 125) / 126) + 1;
    expect(wfResult.windows.length).toBe(expectedWindowCount);

    const winRates = wfResult.windows.map((w) => w.result.metrics.winRate);
    const expectedMean = winRates.reduce((a, b) => a + b, 0) / winRates.length;
    expect(wfResult.consistency.winRateMean).toBeCloseTo(expectedMean, 8);

    expect(typeof wfResult.consistency.isConsistent).toBe('boolean');
  });

  it('should return zero windows and zeroed consistency stats when there is insufficient history', () => {
    const candles: Candle[] = Array.from({ length: 100 }, (_, i) => c(100 + i, i));
    const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };
    const backtester = new Backtester();

    const wfResult = runWalkForward(
      backtester,
      new SmaCrossoverStrategy(),
      universe,
      makeConfig(),
      { minHistoryDays: 252, windowDays: 126, stepDays: 126 }
    );

    expect(wfResult.windows.length).toBe(0);
    expect(wfResult.consistency.winRateMean).toBe(0);
  });
});
