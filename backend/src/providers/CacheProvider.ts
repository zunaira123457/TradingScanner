import * as fs from 'fs';
import * as path from 'path';
import { Candle, Quote, StockInfo, CacheError } from '@/types';
import logger from '@/utils/logger';

export interface ICacheProvider {
  getCandles(ticker: string, startDate: Date, endDate: Date): Promise<Candle[] | null>;
  setCandles(ticker: string, candles: Candle[]): Promise<void>;
  getQuote(ticker: string): Promise<Quote | null>;
  setQuote(ticker: string, quote: Quote): Promise<void>;
  getStockInfo(ticker: string): Promise<StockInfo | null>;
  setStockInfo(ticker: string, info: StockInfo): Promise<void>;
  invalidate(ticker?: string): Promise<void>;
  exists(ticker: string): Promise<boolean>;
}

export class FileSystemCacheProvider implements ICacheProvider {
  private cacheDir: string;
  private maxAgeMs: number;

  constructor(cacheDir: string, maxAgeHours: number = 24) {
    this.cacheDir = cacheDir;
    this.maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (error) {
      throw new CacheError(`Failed to create cache directory: ${this.cacheDir}`, error instanceof Error ? error : undefined);
    }
  }

  async exists(ticker: string): Promise<boolean> {
    try {
      const filePath = this.getCandlesPath(ticker);
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  async getCandles(ticker: string, startDate: Date, endDate: Date): Promise<Candle[] | null> {
    try {
      const filePath = this.getCandlesPath(ticker);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stats = fs.statSync(filePath);
      const age = Date.now() - stats.mtimeMs;

      if (age > this.maxAgeMs) {
        logger.debug(`Cache expired for ${ticker}, age: ${age}ms`);
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      if (!Array.isArray(data.candles)) {
        throw new CacheError(`Invalid candles cache format for ${ticker}`);
      }

      // Convert timestamps back to Date objects and filter by range
      const candles = data.candles
        .map((c: any) => ({
          ...c,
          timestamp: new Date(c.timestamp),
        }))
        .filter((c: Candle) => c.timestamp >= startDate && c.timestamp <= endDate);

      return candles.length > 0 ? candles : null;
    } catch (error) {
      if (error instanceof CacheError) throw error;
      logger.warn(`Error reading candles cache for ${ticker}:`, error);
      return null;
    }
  }

  async setCandles(ticker: string, candles: Candle[]): Promise<void> {
    try {
      const filePath = this.getCandlesPath(ticker);
      const data = {
        ticker,
        candles,
        cachedAt: new Date().toISOString(),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      throw new CacheError(
        `Failed to cache candles for ${ticker}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getQuote(ticker: string): Promise<Quote | null> {
    try {
      const filePath = this.getQuotePath(ticker);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stats = fs.statSync(filePath);
      const age = Date.now() - stats.mtimeMs;

      // Quotes should be fresher (max 1 hour old)
      if (age > 60 * 60 * 1000) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      return {
        timestamp: new Date(data.timestamp),
        price: data.price,
        volume: data.volume,
        bid: data.bid,
        ask: data.ask,
      };
    } catch (error) {
      logger.warn(`Error reading quote cache for ${ticker}:`, error);
      return null;
    }
  }

  async setQuote(ticker: string, quote: Quote): Promise<void> {
    try {
      const filePath = this.getQuotePath(ticker);
      const data = {
        ticker,
        timestamp: quote.timestamp.toISOString(),
        price: quote.price,
        volume: quote.volume,
        bid: quote.bid,
        ask: quote.ask,
        cachedAt: new Date().toISOString(),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      throw new CacheError(
        `Failed to cache quote for ${ticker}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getStockInfo(ticker: string): Promise<StockInfo | null> {
    try {
      const filePath = this.getStockInfoPath(ticker);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stats = fs.statSync(filePath);
      const age = Date.now() - stats.mtimeMs;

      // Stock info can be older (max 7 days)
      if (age > 7 * 24 * 60 * 60 * 1000) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.warn(`Error reading stock info cache for ${ticker}:`, error);
      return null;
    }
  }

  async setStockInfo(ticker: string, info: StockInfo): Promise<void> {
    try {
      const filePath = this.getStockInfoPath(ticker);
      const data = {
        ...info,
        cachedAt: new Date().toISOString(),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      throw new CacheError(
        `Failed to cache stock info for ${ticker}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async invalidate(ticker?: string): Promise<void> {
    try {
      if (ticker) {
        const paths = [
          this.getCandlesPath(ticker),
          this.getQuotePath(ticker),
          this.getStockInfoPath(ticker),
        ];
        for (const filePath of paths) {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      } else {
        // Clear entire cache
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
      }
    } catch (error) {
      throw new CacheError(
        `Failed to invalidate cache`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getCandlesPath(ticker: string): string {
    return path.join(this.cacheDir, `candles_${ticker.toUpperCase()}.json`);
  }

  private getQuotePath(ticker: string): string {
    return path.join(this.cacheDir, `quote_${ticker.toUpperCase()}.json`);
  }

  private getStockInfoPath(ticker: string): string {
    return path.join(this.cacheDir, `info_${ticker.toUpperCase()}.json`);
  }
}

/**
 * Dual-layer cache: memory + file system
 */
export class HybridCacheProvider implements ICacheProvider {
  private memoryCache = new Map<string, { data: any; timestamp: number }>();
  private fileCache: FileSystemCacheProvider;
  private memoryTtlMs: number;

  constructor(cacheDir: string, maxAgeHours: number = 24, memoryTtlMs: number = 3600000) {
    this.fileCache = new FileSystemCacheProvider(cacheDir, maxAgeHours);
    this.memoryTtlMs = memoryTtlMs;
  }

  private getMemoryCacheKey(type: string, ticker: string): string {
    return `${type}:${ticker.toUpperCase()}`;
  }

  async getCandles(ticker: string, startDate: Date, endDate: Date): Promise<Candle[] | null> {
    const key = this.getMemoryCacheKey('candles', ticker);
    const cached = this.memoryCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.memoryTtlMs) {
      const filtered = (cached.data as Candle[]).filter(
        (c) => c.timestamp >= startDate && c.timestamp <= endDate
      );
      return filtered.length > 0 ? filtered : null;
    }

    // Read the full unfiltered range from file cache so the memory layer can
    // serve arbitrary sub-ranges without re-reading the file each time.
    const full = await this.fileCache.getCandles(ticker, new Date(0), new Date(8640000000000000));
    if (!full) return null;

    this.memoryCache.set(key, { data: full, timestamp: Date.now() });

    const filtered = full.filter((c) => c.timestamp >= startDate && c.timestamp <= endDate);
    return filtered.length > 0 ? filtered : null;
  }

  async setCandles(ticker: string, candles: Candle[]): Promise<void> {
    const key = this.getMemoryCacheKey('candles', ticker);
    this.memoryCache.set(key, { data: candles, timestamp: Date.now() });
    await this.fileCache.setCandles(ticker, candles);
  }

  async getQuote(ticker: string): Promise<Quote | null> {
    const key = this.getMemoryCacheKey('quote', ticker);
    const cached = this.memoryCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.memoryTtlMs) {
      return cached.data;
    }

    const quote = await this.fileCache.getQuote(ticker);
    if (quote) {
      this.memoryCache.set(key, { data: quote, timestamp: Date.now() });
    }
    return quote;
  }

  async setQuote(ticker: string, quote: Quote): Promise<void> {
    const key = this.getMemoryCacheKey('quote', ticker);
    this.memoryCache.set(key, { data: quote, timestamp: Date.now() });
    await this.fileCache.setQuote(ticker, quote);
  }

  async getStockInfo(ticker: string): Promise<StockInfo | null> {
    const key = this.getMemoryCacheKey('info', ticker);
    const cached = this.memoryCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.memoryTtlMs) {
      return cached.data;
    }

    const info = await this.fileCache.getStockInfo(ticker);
    if (info) {
      this.memoryCache.set(key, { data: info, timestamp: Date.now() });
    }
    return info;
  }

  async setStockInfo(ticker: string, info: StockInfo): Promise<void> {
    const key = this.getMemoryCacheKey('info', ticker);
    this.memoryCache.set(key, { data: info, timestamp: Date.now() });
    await this.fileCache.setStockInfo(ticker, info);
  }

  async invalidate(ticker?: string): Promise<void> {
    if (ticker) {
      this.memoryCache.delete(this.getMemoryCacheKey('candles', ticker));
      this.memoryCache.delete(this.getMemoryCacheKey('quote', ticker));
      this.memoryCache.delete(this.getMemoryCacheKey('info', ticker));
    } else {
      this.memoryCache.clear();
    }
    await this.fileCache.invalidate(ticker);
  }

  async exists(ticker: string): Promise<boolean> {
    const key = this.getMemoryCacheKey('candles', ticker);
    const inMemory = this.memoryCache.has(key);
    if (inMemory) return true;
    return this.fileCache.exists(ticker);
  }
}
