/**
 * Experiment 3 — true temporal holdout.
 *
 * Downloads the SAME 81 tickers (+ SPY/QQQ/IWM) used in the original Phase
 * 4.5 universe, for a genuinely untouched period: 2015-01-01 to
 * 2019-12-31 — ending exactly where the original 2020-01-01 analysis
 * window begins, with zero calendar overlap. This is the pre-committed
 * out-of-time holdout for MOMENTUM_DIAGNOSTICS_REPORT.md Section 8,
 * Experiment 3 option (b) (no live paper-trading system exists yet for
 * option (a) — see PROJECT_STATE.md "What Has NOT Been Built").
 *
 * CRITICAL SAFETY NOTE: this uses a COMPLETELY SEPARATE cache directory
 * (data/cache_holdout_pre2020/) from the production cache (data/cache/).
 * The production cache is keyed by ticker only, and HybridCacheProvider's
 * setCandles() OVERWRITES the entire cached file for a ticker — requesting
 * a 2015-2019 range against the production cache's existing 2020-2026
 * files would silently destroy the dataset every prior experiment in this
 * project depends on. Using an isolated directory makes that impossible by
 * construction, not by discipline alone.
 *
 * Usage:
 *   npm run download-holdout-pre2020
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { DataValidator } from '@/data/DataValidator';
import { getFullUniverseTickers, getHandCuratedSectorMap } from './downloadUniverse';
import logger from '@/utils/logger';

const HOLDOUT_CACHE_DIR = './data/cache_holdout_pre2020';
const HOLDOUT_START = new Date('2015-01-01');
const HOLDOUT_END = new Date('2019-12-31');
const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }
  if (!config.twelveDataApiKey) throw new Error('TWELVE_DATA_API_KEY not configured');

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  // ISOLATED cache directory — see file header. Never data/cache/.
  const cache = new HybridCacheProvider(HOLDOUT_CACHE_DIR, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);
  const sectorMap = getHandCuratedSectorMap();

  const tickers = [...getFullUniverseTickers(), ...INDEX_TICKERS];
  logger.info(`Downloading ${tickers.length} tickers for the 2015-2019 holdout window into ISOLATED cache dir: ${HOLDOUT_CACHE_DIR}`);
  logger.info(`At ${config.twelveDataRequestsPerMinute} req/min, expect ~${Math.ceil(tickers.length / config.twelveDataRequestsPerMinute)} minutes.`);

  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; reason: string }> = [];

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    try {
      const { candles, fromCache } = await downloader.downloadStock(ticker, {
        startDate: HOLDOUT_START,
        endDate: HOLDOUT_END,
      });
      const validation = DataValidator.validateCandles(ticker, candles);

      if (!validation.isValid) {
        failed.push({ ticker, reason: `Data validation failed: ${validation.errors.map((e) => e.code).join(', ')}` });
        logger.warn(`[${i + 1}/${tickers.length}] ✗ ${ticker}: validation failed`);
        continue;
      }

      succeeded.push(ticker);
      const first = candles[0]?.timestamp.toISOString().slice(0, 10);
      const last = candles[candles.length - 1]?.timestamp.toISOString().slice(0, 10);
      logger.info(
        `[${i + 1}/${tickers.length}] ✓ ${ticker} (${fromCache ? 'cached' : 'downloaded'}, ${candles.length} candles, ${first}..${last}, sector=${sectorMap.get(ticker) ?? 'index'})`
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
  logger.error('Holdout (2015-2019) download failed:', error);
  process.exit(1);
});
