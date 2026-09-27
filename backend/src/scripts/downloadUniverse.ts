/**
 * Phase 4.5: downloads historical price data for an expanded, diversified
 * stock universe.
 *
 * IMPORTANT — universe selection methodology, documented honestly:
 * This is a hand-curated list of well-known, liquid large/mid-cap U.S.
 * stocks spread across all 11 GICS-style sectors, NOT a random or
 * comprehensive sample of the ~4,500+ US common stocks Twelve Data's
 * /stocks reference endpoint actually lists. The free-tier rate limit
 * (8 requests/minute) makes downloading full history for hundreds/thousands
 * of tickers impractical in this environment (a 500-ticker universe at
 * 2 requests/ticker would take over 2 hours). This list is a genuine,
 * good-faith attempt at sector diversity within that constraint — it is
 * NOT selected based on which stocks would make any strategy look good,
 * and it is disclosed as a limitation in the Phase 4.5 report rather than
 * presented as "the U.S. stock market."
 *
 * IMPORTANT — sector data source, documented honestly:
 * Twelve Data's GET /profile endpoint (the only sector/industry
 * classification source found) returned 403 Forbidden when tested:
 * "available exclusively with grow or pro or ultra or venture or
 * enterprise plans." The CachedSectorProvider/ISectorProvider architecture
 * in src/providers/SectorProvider.ts is built and tested against that
 * endpoint for when a paid tier (or an alternative vendor) is available,
 * but it is NOT used for the live sector labels in this script. Instead,
 * sector labels for analysis come directly from the UNIVERSE_BY_SECTOR
 * grouping below — a hand-curated, publicly-known GICS-style
 * categorization made while selecting the universe, NOT a vendor-verified
 * classification. This is disclosed wherever sector results are reported.
 *
 * Usage:
 *   npm run download-universe
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { DataValidator } from '@/data/DataValidator';
import logger from '@/utils/logger';

export const UNIVERSE_BY_SECTOR: Record<string, string[]> = {
  Technology: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'ORCL', 'CRM', 'ADBE', 'AMD', 'INTC', 'CSCO', 'IBM'],
  'Communication Services': ['DIS', 'NFLX', 'CMCSA', 'T', 'VZ', 'TMUS'],
  Healthcare: ['JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY', 'TMO', 'ABT', 'DHR', 'BMY'],
  Financials: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'V', 'MA', 'AXP', 'BLK', 'SCHW'],
  'Consumer Discretionary': ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'SBUX', 'LOW', 'BKNG'],
  'Consumer Staples': ['PG', 'KO', 'PEP', 'WMT', 'COST', 'CL', 'MO'],
  Energy: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY'],
  Industrials: ['BA', 'CAT', 'GE', 'UPS', 'HON', 'LMT', 'RTX'],
  Utilities: ['NEE', 'DUK', 'SO', 'D', 'AEP'],
  'Real Estate': ['AMT', 'PLD', 'SPG', 'O', 'EQIX'],
  Materials: ['LIN', 'SHW', 'FCX', 'NEM', 'APD'],
};

export function getFullUniverseTickers(): string[] {
  return Object.values(UNIVERSE_BY_SECTOR).flat();
}

/**
 * Hand-curated ticker -> sector map, inverted from UNIVERSE_BY_SECTOR. See
 * the file header for why this — not a data-provider API — is the sector
 * source used in this phase.
 */
export function getHandCuratedSectorMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [sector, tickers] of Object.entries(UNIVERSE_BY_SECTOR)) {
    for (const ticker of tickers) map.set(ticker, sector);
  }
  return map;
}

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
  const sectorMap = getHandCuratedSectorMap();

  const tickers = getFullUniverseTickers();
  logger.info(`Downloading ${tickers.length} tickers across ${Object.keys(UNIVERSE_BY_SECTOR).length} sectors...`);
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

if (require.main === module) {
  main().catch((error) => {
    logger.error('Universe download failed:', error);
    process.exit(1);
  });
}
