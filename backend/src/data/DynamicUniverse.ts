import fs from 'fs';
import path from 'path';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import logger from '@/utils/logger';

interface CachedUniverse {
  timestamp: number;
  tickers: string[];
}

const CACHE_FILE = path.join(__dirname, '../../data/dynamic_universe_cache.json');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOP_N_STOCKS = 500;

/**
 * Fetches the top 500 most-liquid NASDAQ stocks by average volume.
 * Caches the list for 7 days to avoid re-fetching every run.
 * Call this to get a dynamic, broad universe instead of the fixed 81-stock set.
 */
export async function getTopLiquidStocks(provider: TwelveDataProvider): Promise<string[]> {
  // Check cache first
  if (fs.existsSync(CACHE_FILE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CachedUniverse;
    const ageMs = Date.now() - cached.timestamp;
    if (ageMs < CACHE_MAX_AGE_MS) {
      logger.info(`Using cached dynamic universe (${cached.tickers.length} stocks, ${Math.round(ageMs / 1000 / 60)} min old)`);
      return cached.tickers;
    }
  }

  // Fetch fresh list
  logger.info('Fetching top liquid stocks from Twelve Data...');
  try {
    // The /stocks endpoint returns all available stocks with metadata including average_volume
    const response = await (provider as any).client.get('/stocks', {
      params: { country: 'United States' },
    });

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Unexpected response format from /stocks endpoint');
    }

    // Sort by average_volume descending, take top N
    const sorted = (response.data as any[])
      .filter((s: any) => s.symbol && s.type === 'Common Stock' && s.average_volume > 0)
      .sort((a: any, b: any) => (b.average_volume || 0) - (a.average_volume || 0))
      .slice(0, TOP_N_STOCKS)
      .map((s: any) => s.symbol);

    if (sorted.length === 0) {
      throw new Error('No stocks returned after filtering');
    }

    // Cache it
    const cacheData: CachedUniverse = { timestamp: Date.now(), tickers: sorted };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));

    logger.info(`Cached top ${sorted.length} liquid stocks`);
    return sorted;
  } catch (error) {
    logger.error(`Failed to fetch top liquid stocks: ${error instanceof Error ? error.message : error}`);
    // Fall back to cache if fetch fails, even if expired
    if (fs.existsSync(CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CachedUniverse;
      logger.warn(`Falling back to stale cache (${cached.tickers.length} stocks)`);
      return cached.tickers;
    }
    throw error;
  }
}

/**
 * Force-refresh the cache immediately. Call this if you want fresh stock rankings
 * without waiting for the 7-day expiration.
 */
export async function refreshDynamicUniverse(provider: TwelveDataProvider): Promise<string[]> {
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
  }
  return getTopLiquidStocks(provider);
}
