import { analyzeIndexRegime, classifyMarketRegime } from '@/analysis/MarketRegime';
import { Candle } from '@/types';

function makeTrendingCandles(n: number, opts: { start: number; dailyChange: number; noiseAmplitude?: number }): Candle[] {
  const { start, dailyChange, noiseAmplitude = 0 } = opts;
  const candles: Candle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    price += dailyChange;
    const noise = noiseAmplitude ? Math.sin(i) * noiseAmplitude : 0;
    const close = price + noise;
    candles.push({
      timestamp: new Date(2020, 0, 1 + i),
      open: close - 0.1,
      high: close + Math.abs(noise) + 0.5,
      low: close - Math.abs(noise) - 0.5,
      close,
      volume: 1000000,
    });
  }
  return candles;
}

function makeChoppyHighVolCandles(n: number, base: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < n; i++) {
    // Large alternating swings -> high realized volatility
    const close = base + (i % 2 === 0 ? base * 0.08 : -base * 0.08);
    candles.push({
      timestamp: new Date(2020, 0, 1 + i),
      open: base,
      high: close + base * 0.05,
      low: close - base * 0.05,
      close,
      volume: 1000000,
    });
  }
  return candles;
}

describe('MarketRegime', () => {
  describe('analyzeIndexRegime', () => {
    it('should score a sustained low-volatility uptrend as strongly positive', () => {
      const candles = makeTrendingCandles(260, { start: 100, dailyChange: 0.5 });
      const result = analyzeIndexRegime(candles, 'SPY');

      expect(result.trendScore).toBe(1);
      expect(result.momentumScore).toBeGreaterThan(0);
      expect(result.drawdownPct).toBeCloseTo(0, 1); // near highs, minimal drawdown
      expect(result.compositeScore).toBeGreaterThan(0.5);
    });

    it('should score a sustained downtrend as strongly negative', () => {
      const candles = makeTrendingCandles(260, { start: 300, dailyChange: -0.5 });
      const result = analyzeIndexRegime(candles, 'SPY');

      expect(result.trendScore).toBe(-1);
      expect(result.momentumScore).toBeLessThan(0);
      expect(result.drawdownPct).toBeLessThan(-0.05);
      expect(result.compositeScore).toBeLessThan(-0.5);
    });

    it('should report high annualized volatility for a choppy whipsaw series', () => {
      const candles = makeChoppyHighVolCandles(60, 100);
      const result = analyzeIndexRegime(candles, 'SPY');
      expect(result.annualizedVolatility).not.toBeNull();
      expect(result.annualizedVolatility as number).toBeGreaterThan(0.35);
    });
  });

  describe('classifyMarketRegime', () => {
    it('should classify strong_bullish when all indexes are in strong low-vol uptrends', () => {
      const indexCandles = new Map<string, Candle[]>([
        ['SPY', makeTrendingCandles(260, { start: 100, dailyChange: 0.5 })],
        ['QQQ', makeTrendingCandles(260, { start: 100, dailyChange: 0.6 })],
        ['IWM', makeTrendingCandles(260, { start: 100, dailyChange: 0.4 })],
      ]);

      const result = classifyMarketRegime(indexCandles);
      expect(result.label).toBe('strong_bullish');
      expect(result.isHighVolatility).toBe(false);
    });

    it('should classify strong_bearish when all indexes are in strong downtrends', () => {
      const indexCandles = new Map<string, Candle[]>([
        ['SPY', makeTrendingCandles(260, { start: 300, dailyChange: -0.5 })],
        ['QQQ', makeTrendingCandles(260, { start: 300, dailyChange: -0.6 })],
        ['IWM', makeTrendingCandles(260, { start: 300, dailyChange: -0.4 })],
      ]);

      const result = classifyMarketRegime(indexCandles);
      expect(result.label).toBe('strong_bearish');
    });

    it('should override to high_volatility regardless of trend direction', () => {
      const indexCandles = new Map<string, Candle[]>([
        ['SPY', makeChoppyHighVolCandles(60, 100)],
        ['QQQ', makeChoppyHighVolCandles(60, 100)],
      ]);

      const result = classifyMarketRegime(indexCandles, { highVolatilityThreshold: 0.35 });
      expect(result.label).toBe('high_volatility');
      expect(result.isHighVolatility).toBe(true);
    });

    it('should return neutral default with no index data', () => {
      const result = classifyMarketRegime(new Map());
      expect(result.label).toBe('neutral');
      expect(result.indexScores).toEqual([]);
    });
  });
});
