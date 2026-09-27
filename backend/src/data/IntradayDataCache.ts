import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const CACHE_DIR = path.join(__dirname, '../../data/intraday_cache');
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

interface CachedIntradaySeries {
  fetchedAt: number;
  candles: Array<Omit<Candle, 'timestamp'> & { timestamp: string }>;
}

function cachePath(ticker: string, interval: string): string {
  return path.join(CACHE_DIR, `${ticker}_${interval}.json`);
}

/**
 * A dedicated, hand-rolled cache for intraday candle series — NOT the
 * existing ICacheProvider/DataDownloader pair, which key by ticker alone
 * and assume one (daily) series per ticker. Reusing them here would
 * collide with the existing daily-candle cache entry for the same ticker.
 * Mirrors the same simple {fetchedAt, payload} file-cache pattern
 * DynamicUniverse.ts already uses for its own, differently-shaped cache.
 */
export function getCachedIntradayCandles(
  ticker: string,
  interval: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): Candle[] | null {
  const filePath = cachePath(ticker, interval);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CachedIntradaySeries;
    if (Date.now() - raw.fetchedAt > maxAgeMs) return null;
    return raw.candles.map((c) => ({ ...c, timestamp: new Date(c.timestamp) }));
  } catch (error) {
    logger.warn(`Could not read/parse intraday cache for ${ticker} (${error instanceof Error ? error.message : error}) — treating as no cache`);
    return null;
  }
}

export function saveIntradayCandles(ticker: string, interval: string, candles: Candle[]): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const payload: CachedIntradaySeries = {
    fetchedAt: Date.now(),
    candles: candles.map((c) => ({ ...c, timestamp: c.timestamp.toISOString() })),
  };
  fs.writeFileSync(cachePath(ticker, interval), JSON.stringify(payload, null, 2));
}
