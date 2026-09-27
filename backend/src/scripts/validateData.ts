/**
 * CLI script to validate cached historical data for a list of tickers
 * and report which ones qualify for the stock universe.
 *
 * Usage:
 *   npm run validate-data -- AAPL MSFT GOOGL
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { DataValidator } from '@/data/DataValidator';
import { StockUniverse } from '@/data/StockUniverse';
import { StockUniverseStock } from '@/types';
import logger from '@/utils/logger';

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
  if (tickers.length === 0) {
    logger.error('No tickers provided. Usage: npm run validate-data -- AAPL MSFT GOOGL');
    process.exit(1);
  }

  if (!config.twelveDataApiKey) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);
  const universe = new StockUniverse();

  const results: StockUniverseStock[] = [];

  for (const ticker of tickers) {
    try {
      const { candles, fromCache } = await downloader.downloadStock(ticker);
      const validation = DataValidator.validateCandles(ticker, candles);
      DataValidator.logResults(ticker, validation);

      const metadata = await downloader.getStockMetadata(ticker);

      // Prefer the provider's own 30-day average volume over any single-day
      // quote volume, which is not a valid proxy for a 30-day average.
      const evaluation = universe.evaluateStock(ticker, candles, metadata, metadata.avgVolume30d);
      results.push(evaluation);

      logger.info(
        `${ticker} (${fromCache ? 'cached' : 'downloaded'}): ${evaluation.includesInUniverse ? 'QUALIFIES' : 'EXCLUDED'}`
      );
    } catch (error) {
      logger.error(`${ticker}: Failed - ${error instanceof Error ? error.message : error}`);
    }
  }

  const { included, excluded } = universe.filterStocks(results);
  StockUniverse.logResults(included, excluded);
}

main().catch((error) => {
  logger.error('Validation script failed:', error);
  process.exit(1);
});
