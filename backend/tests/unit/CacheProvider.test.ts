import { HybridCacheProvider, FileSystemCacheProvider } from '@/providers/CacheProvider';
import { Candle, Quote } from '@/types';
import * as fs from 'fs';
import * as path from 'path';

describe('HybridCacheProvider', () => {
  let cacheDir: string;
  let cache: HybridCacheProvider;

  beforeEach(() => {
    cacheDir = path.join(__dirname, '../../.cache-test');
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true });
    }
    cache = new HybridCacheProvider(cacheDir, 24, 1000);
  });

  afterEach(() => {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true });
    }
  });

  const createCandle = (
    timestamp: Date,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number
  ): Candle => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  });

  const createQuote = (price: number): Quote => ({
    timestamp: new Date(),
    price,
    volume: 1000000,
  });

  describe('candles cache', () => {
    it('should store and retrieve candles', async () => {
      const candles = [
        createCandle(new Date('2024-01-01'), 100, 105, 95, 102, 1000000),
        createCandle(new Date('2024-01-02'), 102, 110, 101, 108, 1200000),
      ];

      await cache.setCandles('TEST', candles);
      const retrieved = await cache.getCandles('TEST', new Date('2024-01-01'), new Date('2024-01-02'));

      expect(retrieved).not.toBeNull();
      expect(retrieved!.length).toBe(2);
      expect(retrieved![0].close).toBe(102);
    });

    it('should filter candles by date range', async () => {
      const candles = [
        createCandle(new Date('2024-01-01'), 100, 105, 95, 102, 1000000),
        createCandle(new Date('2024-01-02'), 102, 110, 101, 108, 1200000),
        createCandle(new Date('2024-01-03'), 108, 115, 105, 112, 1100000),
      ];

      await cache.setCandles('TEST', candles);

      // Query only middle date
      const retrieved = await cache.getCandles('TEST', new Date('2024-01-02'), new Date('2024-01-02'));

      expect(retrieved).not.toBeNull();
      expect(retrieved!.length).toBe(1);
      expect(retrieved![0].close).toBe(108);
    });

    it('should return null for non-existent candles', async () => {
      const retrieved = await cache.getCandles('NOEXIST', new Date('2024-01-01'), new Date('2024-01-02'));
      expect(retrieved).toBeNull();
    });

    it('should use memory cache for subsequent requests', async () => {
      const candles = [
        createCandle(new Date('2024-01-01'), 100, 105, 95, 102, 1000000),
      ];

      await cache.setCandles('TEST', candles);

      // First request hits file cache
      const first = await cache.getCandles('TEST', new Date('2024-01-01'), new Date('2024-01-02'));

      // Second request should come from memory cache
      const second = await cache.getCandles('TEST', new Date('2024-01-01'), new Date('2024-01-02'));

      expect(first).toEqual(second);
    });
  });

  describe('quote cache', () => {
    it('should store and retrieve quotes', async () => {
      const quote = createQuote(150.5);

      await cache.setQuote('TEST', quote);
      const retrieved = await cache.getQuote('TEST');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.price).toBe(150.5);
    });

    it('should return null for non-existent quote', async () => {
      const retrieved = await cache.getQuote('NOEXIST');
      expect(retrieved).toBeNull();
    });
  });

  describe('stock info cache', () => {
    it('should store and retrieve stock info', async () => {
      const info = {
        ticker: 'TEST',
        name: 'Test Corp',
        sector: 'Technology',
        price: 100,
      };

      await cache.setStockInfo('TEST', info);
      const retrieved = await cache.getStockInfo('TEST');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test Corp');
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate specific ticker cache', async () => {
      const candles = [createCandle(new Date('2024-01-01'), 100, 105, 95, 102, 1000000)];

      await cache.setCandles('TEST', candles);
      expect(await cache.exists('TEST')).toBe(true);

      await cache.invalidate('TEST');
      expect(await cache.exists('TEST')).toBe(false);
    });

    it('should invalidate all cache when no ticker specified', async () => {
      const candles = [createCandle(new Date('2024-01-01'), 100, 105, 95, 102, 1000000)];

      await cache.setCandles('TEST1', candles);
      await cache.setCandles('TEST2', candles);

      await cache.invalidate();

      expect(await cache.exists('TEST1')).toBe(false);
      expect(await cache.exists('TEST2')).toBe(false);
    });
  });

  describe('cache expiration', () => {
    it('should expire old quotes after 1 hour', async () => {
      // Exercise the file-system layer directly: the in-memory layer of
      // HybridCacheProvider intentionally serves from memory within its own
      // short TTL and has no way to observe an externally-mutated file mtime.
      const fileCache = new FileSystemCacheProvider(cacheDir, 24);
      const quote = createQuote(150.5);

      await fileCache.setQuote('TEST', quote);

      // Mock file modification time to be > 1 hour ago
      const filePath = path.join(cacheDir, 'quote_TEST.json');
      const oldTime = Date.now() - 61 * 60 * 1000; // 61 minutes ago
      fs.utimesSync(filePath, oldTime / 1000, oldTime / 1000);

      const retrieved = await fileCache.getQuote('TEST');
      expect(retrieved).toBeNull();
    });
  });
});
