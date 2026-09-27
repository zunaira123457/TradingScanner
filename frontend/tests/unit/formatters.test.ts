import { describe, expect, it } from 'vitest';
import { cleanAIText } from '@/lib/utils/formatters';

describe('cleanAIText', () => {
  it.each([
    ['Weekly and daily trends are aligned (mtfAligned: true)', 'Weekly and daily trends are aligned'],
    ['No pullback in progress (strategyWarnings).', 'No pullback in progress.'],
    ['Volatility is 64% annualized (historicalVolatility20)', 'Volatility is 64% annualized'],
    ['Lagging SPY (relativeStrength.vsBenchmark)', 'Lagging SPY'],
    ['Outperforming (relative strength vs benchmark: 0.326, outperformingBoth: true)', 'Outperforming (relative strength vs benchmark: 0.326)'],
    ['Evaluated under the trend_pullback strategy', 'Evaluated under the trend pullback strategy'],
    ['ADX 14 is 31.93 with +DI14 at 37.64', 'ADX 14 is 31.93 with +DI14 at 37.64'],
    ['RSI 14 is 63.22 (bullish, not extreme)', 'RSI 14 is 63.22 (bullish, not extreme)'],
  ])('%s', (input, expected) => expect(cleanAIText(input)).toBe(expected));
});
