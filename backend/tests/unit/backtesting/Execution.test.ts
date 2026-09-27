import { applyEntrySlippage, applyExitSlippage, calculateCommission, checkExit } from '@/backtesting/Execution';
import { Candle } from '@/types';

function c(open: number, high: number, low: number, close: number): Candle {
  return { timestamp: new Date(), open, high, low, close, volume: 1000000 };
}

describe('Execution', () => {
  describe('applyEntrySlippage', () => {
    it('should make a buy fill worse (higher) than the intended price', () => {
      // 5 bps = 0.05%
      expect(applyEntrySlippage(100, 5)).toBeCloseTo(100.05, 8);
    });
  });

  describe('applyExitSlippage', () => {
    it('should make a sell fill worse (lower) than the intended price', () => {
      expect(applyExitSlippage(100, 5)).toBeCloseTo(99.95, 8);
    });
  });

  describe('calculateCommission', () => {
    it('should compute commission as a fraction of notional', () => {
      expect(calculateCommission(10000, 2)).toBeCloseTo(2, 8); // 2 bps of $10,000
    });
  });

  describe('checkExit', () => {
    it('should not exit when neither stop nor target is touched', () => {
      const candle = c(100, 102, 98, 101);
      const result = checkExit(candle, 90, 110);
      expect(result.exited).toBe(false);
    });

    it('should exit at the stop price when only the stop is touched', () => {
      const candle = c(100, 101, 89, 92);
      const result = checkExit(candle, 90, 110);
      expect(result.exited).toBe(true);
      expect(result.reason).toBe('stop');
      expect(result.price).toBe(90);
    });

    it('should exit at the target price when only the target is touched', () => {
      const candle = c(100, 112, 99, 108);
      const result = checkExit(candle, 90, 110);
      expect(result.exited).toBe(true);
      expect(result.reason).toBe('target');
      expect(result.price).toBe(110);
    });

    it('should conservatively resolve a same-candle stop+target touch in favor of the stop', () => {
      // A huge-range candle whose low is below stop AND high is above target.
      const candle = c(100, 115, 85, 100);
      const result = checkExit(candle, 90, 110);
      expect(result.exited).toBe(true);
      expect(result.reason).toBe('stop');
      expect(result.price).toBe(90);
    });

    it('should fill at the open (not the stale stop price) when the open gaps through the stop', () => {
      const candle = c(85, 87, 83, 84); // opened below the stop
      const result = checkExit(candle, 90, 110);
      expect(result.exited).toBe(true);
      expect(result.reason).toBe('stop');
      expect(result.price).toBe(85); // fills at open, worse than the stated stop of 90
    });

    it('should fill exactly at the target price even when the open gaps through the target', () => {
      const candle = c(115, 118, 114, 116); // opened above the target
      const result = checkExit(candle, 90, 110);
      expect(result.exited).toBe(true);
      expect(result.reason).toBe('target');
      expect(result.price).toBe(110); // limit order still fills at the limit price
    });

    it('should treat an exact touch (low == stop) as a hit', () => {
      const candle = c(100, 101, 90, 95);
      const result = checkExit(candle, 90, 110);
      expect(result.exited).toBe(true);
      expect(result.reason).toBe('stop');
    });

    it('should treat an exact touch (high == target) as a hit', () => {
      const candle = c(100, 110, 99, 105);
      const result = checkExit(candle, 90, 110);
      expect(result.exited).toBe(true);
      expect(result.reason).toBe('target');
    });
  });
});
