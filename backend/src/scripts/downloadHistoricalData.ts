/**
 * CLI script to download and cache historical data for a list of tickers.
 *
 * Usage:
 *   npm run download-data -- AAPL MSFT GOOGL
 *   npm run download-data -- --file tickers.txt
 */
import * as fs from 'fs';
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import logger from '@/utils/logger';

function parseArgs(): string[] {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    logger.error('No tickers provided. Usage: npm run download-data -- AAPL MSFT GOOGL');
    logger.error('   or: npm run download-data -- --file tickers.txt');
    process.exit(1);
  }

  if (args[0] === '--file') {
    const filePath = args[1];
    if (!filePath || !fs.existsSync(filePath)) {
      logger.error(`Ticker file not found: ${filePath}`);
      process.exit(1);
    }
    return fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .map((line) => line.trim().toUpperCase())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  return args.map((t) => t.toUpperCase());
}

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  const tickers = parseArgs();
  logger.info(`Downloading historical data for ${tickers.length} ticker(s): ${tickers.join(', ')}`);

  if (!config.twelveDataApiKey) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);

  const isConnected = await provider.validateConnection();
  if (!isConnected) {
    logger.error(`Failed to connect to ${provider.getName()}. Check your API key.`);
    process.exit(1);
  }

  const result = await downloader.downloadBatch(tickers);

  logger.info('='.repeat(60));
  logger.info('DOWNLOAD SUMMARY');
  logger.info('='.repeat(60));
  logger.info(`Successful: ${result.successful.length}/${result.totalRequests}`);
  if (result.successful.length > 0) {
    logger.info(`  ${result.successful.join(', ')}`);
  }

  if (result.failed.size > 0) {
    logger.warn(`Failed: ${result.failed.size}/${result.totalRequests}`);
    result.failed.forEach((reason, ticker) => {
      logger.warn(`  ${ticker}: ${reason}`);
    });
  }
}

main().catch((error) => {
  logger.error('Download script failed:', error);
  process.exit(1);
});
