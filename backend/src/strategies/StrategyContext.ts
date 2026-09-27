import { Candle } from '@/types';
import { StrategyContext } from '@/types/strategy';
import { IndicatorEngine } from '@/indicators/IndicatorEngine';
import { findSwingHighs, findSwingLows, classifyStructure } from '@/patterns/PriceStructure';
import { analyzeMultiTimeframe } from '@/analysis/MultiTimeframe';
import { classifyMarketRegime } from '@/analysis/MarketRegime';
import { calculateRelativeStrength } from '@/analysis/SectorStrength';

export interface BuildStrategyContextOptions {
  /**
   * If provided, ONLY `fullCandles[0..asOfIndex]` is used — this is the
   * primary no-look-ahead safeguard: pass the full historical array plus
   * the index representing "today" and this function does the slicing for
   * you, rather than relying on every caller to remember to slice first.
   */
  asOfIndex?: number;
  swingLookback?: number; // passed to findSwingHighs/findSwingLows, default 3
  /**
   * Index candles for market regime detection. MUST already be sliced by
   * the caller to the same as-of date as `fullCandles` — this function has
   * no way to verify that alignment across independent ticker series.
   */
  marketIndexCandles?: Map<string, Candle[]>;
  /** Sector ETF candles, pre-sliced to the same as-of date. */
  sectorCandles?: Candle[] | null;
  /** Benchmark (e.g. SPY) candles, pre-sliced to the same as-of date. */
  benchmarkCandles?: Candle[];
  relativeStrengthPeriodDays?: number;
}

/**
 * Builds a StrategyContext from a point-in-time candle series. This is the
 * single place that wires the Phase 2 modules (indicators, price structure,
 * multi-timeframe, market regime, sector strength) together — strategies
 * never call those modules directly, so there is exactly one code path that
 * can get the no-look-ahead slicing wrong, and it is tested accordingly.
 */
export function buildStrategyContext(
  ticker: string,
  fullCandles: Candle[],
  options: BuildStrategyContextOptions = {}
): StrategyContext {
  const { swingLookback = 3, relativeStrengthPeriodDays = 63 } = options;

  const candles =
    options.asOfIndex !== undefined ? fullCandles.slice(0, options.asOfIndex + 1) : fullCandles;

  const snapshots = IndicatorEngine.calculateAll(candles);

  const swingHighs = findSwingHighs(candles, swingLookback);
  const swingLows = findSwingLows(candles, swingLookback);
  const structure = classifyStructure(swingHighs, swingLows);

  const multiTimeframe = analyzeMultiTimeframe(candles);

  const marketRegime =
    options.marketIndexCandles && options.marketIndexCandles.size > 0
      ? classifyMarketRegime(options.marketIndexCandles)
      : null;

  const relativeStrength = options.benchmarkCandles
    ? calculateRelativeStrength(
        candles,
        options.benchmarkCandles,
        options.sectorCandles ?? null,
        relativeStrengthPeriodDays
      )
    : null;

  return { ticker, candles, snapshots, structure, multiTimeframe, marketRegime, relativeStrength };
}
