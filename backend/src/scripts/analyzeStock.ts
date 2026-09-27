/**
 * Phase 2 demonstration: runs the full quant engine (indicators, price
 * structure, chart patterns, multi-timeframe analysis, market regime,
 * sector strength) against real downloaded market data for one ticker.
 *
 * Usage:
 *   npm run analyze-stock -- AAPL
 *   npm run analyze-stock -- AAPL XLK   (optional sector ETF for relative strength)
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { IndicatorEngine } from '@/indicators/IndicatorEngine';
import {
  findSwingHighs,
  findSwingLows,
  classifyStructure,
  detectBreakout,
  detectConsolidation,
} from '@/patterns/PriceStructure';
import {
  detectBreakoutFromConsolidation,
  detectPullbackToEma21,
  detectVolatilityContraction,
  detectSupportBounce,
  detectResistanceRejection,
} from '@/patterns/ChartPatterns';
import { analyzeMultiTimeframe } from '@/analysis/MultiTimeframe';
import { classifyMarketRegime } from '@/analysis/MarketRegime';
import { calculateRelativeStrength } from '@/analysis/SectorStrength';
import { Candle } from '@/types';
import logger from '@/utils/logger';

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  const [ticker, sectorEtf] = process.argv.slice(2).map((t) => t.toUpperCase());
  if (!ticker) {
    logger.error('Usage: npm run analyze-stock -- AAPL [SECTOR_ETF]');
    process.exit(1);
  }

  if (!config.twelveDataApiKey) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);

  const isConnected = await provider.validateConnection();
  if (!isConnected) {
    logger.error('Failed to connect to Twelve Data. Check your API key.');
    process.exit(1);
  }

  logger.info('='.repeat(70));
  logger.info(`PHASE 2 QUANT ENGINE — ${ticker}`);
  logger.info('='.repeat(70));

  // -- 1. Indicators -------------------------------------------------------
  const { candles } = await downloader.downloadStock(ticker);
  logger.info(`\nLoaded ${candles.length} daily candles for ${ticker}`);

  const snapshots = IndicatorEngine.calculateAll(candles);
  const latest = snapshots[snapshots.length - 1];
  logger.info('\n--- Indicators (latest) ---');
  logger.info(`Close: $${latest.close.toFixed(2)}`);
  logger.info(
    `SMA20/50/200: ${fmt(latest.sma20)} / ${fmt(latest.sma50)} / ${fmt(latest.sma200)}`
  );
  logger.info(`EMA9/21/50: ${fmt(latest.ema9)} / ${fmt(latest.ema21)} / ${fmt(latest.ema50)}`);
  logger.info(`RSI14: ${fmt(latest.rsi14)}`);
  logger.info(
    `MACD/Signal/Hist: ${fmt(latest.macd)} / ${fmt(latest.macdSignal)} / ${fmt(latest.macdHistogram)}`
  );
  logger.info(`ADX14 (+DI/-DI): ${fmt(latest.adx14)} (${fmt(latest.plusDI14)}/${fmt(latest.minusDI14)})`);
  logger.info(`ATR14: ${fmt(latest.atr14)}`);
  logger.info(`Bollinger Width: ${fmt(latest.bbWidth)}`);
  logger.info(`Historical Vol (20d, annualized): ${fmt(latest.historicalVolatility20)}`);
  logger.info(`Relative Volume: ${fmt(latest.relativeVolume)}`);
  logger.info(`Avg Dollar Volume (30d): $${fmt(latest.avgDollarVolume30, 0)}`);

  // -- 2. Price structure ---------------------------------------------------
  const swingHighs = findSwingHighs(candles, 3);
  const swingLows = findSwingLows(candles, 3);
  const structure = classifyStructure(swingHighs, swingLows);

  logger.info('\n--- Price Structure ---');
  logger.info(`Trend structure: ${structure.trend}`);
  logger.info(
    `Last confirmed swing high: ${structure.lastSwingHigh ? `$${structure.lastSwingHigh.price.toFixed(2)} on ${structure.lastSwingHigh.date.toDateString()}` : 'none'}`
  );
  logger.info(
    `Last confirmed swing low: ${structure.lastSwingLow ? `$${structure.lastSwingLow.price.toFixed(2)} on ${structure.lastSwingLow.date.toDateString()}` : 'none'}`
  );

  const breakout = detectBreakout(candles, latest.relativeVolume);
  const consolidation = detectConsolidation(candles);
  logger.info(
    `Breakout: detected=${breakout.detected} resistance=${fmt(breakout.resistance)} confidence=${fmt(breakout.confidence)}`
  );
  logger.info(
    `Consolidation: detected=${consolidation.detected} rangePct=${fmt(consolidation.rangePct)} confidence=${fmt(consolidation.confidence)}`
  );

  // -- 3. Chart patterns -----------------------------------------------------
  logger.info('\n--- Chart Patterns ---');
  const boFromConsolidation = detectBreakoutFromConsolidation(candles, latest.relativeVolume);
  logPattern('Breakout from consolidation', boFromConsolidation);

  const pullback = detectPullbackToEma21(candles, latest.ema21, structure);
  logPattern('Pullback to EMA21', pullback);

  const bbWidths = snapshots.map((s) => s.bbWidth);
  const volContraction = detectVolatilityContraction(bbWidths);
  logPattern('Volatility contraction', volContraction);

  const supportBounce = detectSupportBounce(candles);
  logPattern('Support bounce', supportBounce);

  const resistanceRejection = detectResistanceRejection(candles);
  logPattern('Resistance rejection', resistanceRejection);

  // -- 4. Multi-timeframe -----------------------------------------------------
  const mtf = analyzeMultiTimeframe(candles);
  logger.info('\n--- Multi-Timeframe ---');
  logger.info(`Daily trend: ${mtf.dailyTrend}`);
  logger.info(`Weekly trend: ${mtf.weeklyTrend}`);
  logger.info(`Aligned: ${mtf.aligned} (score: ${mtf.alignmentScore})`);

  // -- 5. Market regime (S&P 500 / Nasdaq / Russell 2000 via ETF proxies) ----
  logger.info('\n--- Market Regime ---');
  const indexTickers = ['SPY', 'QQQ', 'IWM'];
  const indexCandles = new Map<string, Candle[]>();
  for (const idx of indexTickers) {
    try {
      const { candles: idxCandles } = await downloader.downloadStock(idx);
      indexCandles.set(idx, idxCandles);
    } catch (error) {
      logger.warn(`Could not load index data for ${idx}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (indexCandles.size > 0) {
    const regime = classifyMarketRegime(indexCandles);
    logger.info(`Regime: ${regime.label} (composite score: ${regime.compositeScore.toFixed(3)})`);
    logger.info(`High volatility: ${regime.isHighVolatility}`);
    regime.indexScores.forEach((s) => {
      logger.info(
        `  ${s.ticker}: trend=${s.trendScore} momentum=${fmt(s.momentumScore)} drawdown=${fmt(s.drawdownPct)} vol=${fmt(s.annualizedVolatility)} composite=${s.compositeScore.toFixed(3)}`
      );
    });
  } else {
    logger.warn('No index data available — skipping market regime classification.');
  }

  // -- 6. Sector strength (optional, if a sector ETF ticker was provided) ----
  if (sectorEtf && indexCandles.has('SPY')) {
    logger.info('\n--- Sector Strength ---');
    try {
      const { candles: sectorCandles } = await downloader.downloadStock(sectorEtf);
      const rs = calculateRelativeStrength(candles, indexCandles.get('SPY') as Candle[], sectorCandles, 63);
      logger.info(`${ticker} 63d return: ${fmt(rs.stockReturn)}`);
      logger.info(`${sectorEtf} 63d return: ${fmt(rs.sectorReturn)}`);
      logger.info(`SPY 63d return: ${fmt(rs.benchmarkReturn)}`);
      logger.info(`Outperforming both: ${rs.outperformingBoth}`);
      logger.info(`Score adjustment: ${rs.scoreAdjustment >= 0 ? '+' : ''}${rs.scoreAdjustment}`);
    } catch (error) {
      logger.warn(`Could not load sector data for ${sectorEtf}: ${error instanceof Error ? error.message : error}`);
    }
  }

  logger.info(`\n${'='.repeat(70)}`);
  logger.info('✓ PHASE 2: Quant engine verified against real market data');
  logger.info('='.repeat(70));
}

function fmt(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined) return 'n/a';
  return value.toFixed(decimals);
}

function logPattern(
  label: string,
  result: { detected: boolean; confidence: number; invalidationPrice: number | null }
): void {
  logger.info(
    `${label}: detected=${result.detected} confidence=${result.confidence.toFixed(2)} invalidation=${result.invalidationPrice !== null ? '$' + result.invalidationPrice.toFixed(2) : 'n/a'}`
  );
}

main().catch((error) => {
  logger.error('Analysis script failed:', error);
  process.exit(1);
});
