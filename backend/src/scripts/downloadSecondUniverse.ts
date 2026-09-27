/**
 * Experiment 2: downloads historical price data for the second,
 * non-overlapping universe defined in src/research/SecondUniverse.ts.
 * Mirrors downloadUniverse.ts's structure exactly — same provider, same
 * cache, same validation — applied to a different ticker list.
 *
 * Usage:
 *   npm run download-second-universe
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { DataValidator } from '@/data/DataValidator';
import { getSecondUniverseTickers, getSecondUniverseSectorMap } from '@/research/SecondUniverse';
import logger from '@/utils/logger';

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }
  if (!config.twelveDataApiKey) throw new Error('TWELVE_DATA_API_KEY not configured');

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);
  const sectorMap = getSecondUniverseSectorMap();

  const tickers = getSecondUniverseTickers();
  logger.info(`Downloading ${tickers.length} tickers (Experiment 2 second universe) across ${new Set(sectorMap.values()).size} sectors...`);
  logger.info(`At ${config.twelveDataRequestsPerMinute} req/min, expect ~${Math.ceil(tickers.length / config.twelveDataRequestsPerMinute)} minutes.`);

  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; reason: string }> = [];

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    try {
      const { candles, fromCache } = await downloader.downloadStock(ticker);
      const validation = DataValidator.validateCandles(ticker, candles);

      if (!validation.isValid) {
        failed.push({ ticker, reason: `Data validation failed: ${validation.errors.map((e) => e.code).join(', ')}` });
        logger.warn(`[${i + 1}/${tickers.length}] ✗ ${ticker}: validation failed`);
        continue;
      }

      succeeded.push(ticker);
      logger.info(
        `[${i + 1}/${tickers.length}] ✓ ${ticker} (${fromCache ? 'cached' : 'downloaded'}, ${candles.length} candles, sector=${sectorMap.get(ticker) ?? 'unknown'})`
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ ticker, reason });
      logger.warn(`[${i + 1}/${tickers.length}] ✗ ${ticker}: ${reason}`);
    }
  }

  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`DOWNLOAD COMPLETE: ${succeeded.length}/${tickers.length} succeeded`);
  logger.info('='.repeat(60));
  if (failed.length > 0) {
    logger.info(`Failed (${failed.length}):`);
    failed.forEach((f) => logger.info(`  ${f.ticker}: ${f.reason}`));
  }
}

main().catch((error) => {
  logger.error('Second-universe download failed:', error);
  process.exit(1);
});
