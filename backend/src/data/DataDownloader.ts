import { Candle, BatchDownloadResult, MarketDataError } from '@/types';
import { IMarketDataProvider } from '@/providers/MarketDataProvider';
import { ICacheProvider } from '@/providers/CacheProvider';
import { DataValidator } from './DataValidator';
import { config } from '@/config/environment';
import logger from '@/utils/logger';

export interface DownloadOptions {
  overrideCache?: boolean;
  startDate?: Date;
  endDate?: Date;
  retries?: number;
}

/**
 * Manages downloading and caching market data.
 */
export class DataDownloader {
  private provider: IMarketDataProvider;
  private cache: ICacheProvider;

  constructor(provider: IMarketDataProvider, cache: ICacheProvider) {
    this.provider = provider;
    this.cache = cache;
  }

  /**
   * Download historical data for a single stock.
   * Uses cache if available and not expired.
   */
  async downloadStock(
    ticker: string,
    options: DownloadOptions = {}
  ): Promise<{
    candles: Candle[];
    fromCache: boolean;
    validation: { isValid: boolean; warnings: number };
  }> {
    const startDate = options.startDate || this.getDefaultStartDate();
    const endDate = options.endDate || new Date();

    // Try cache first
    if (!options.overrideCache) {
      const cached = await this.cache.getCandles(ticker, startDate, endDate);
      if (cached && cached.length > 0) {
        logger.debug(`${ticker}: Using cached data (${cached.length} candles)`);
        const validation = DataValidator.validateCandles(ticker, cached);
        return {
          candles: cached,
          fromCache: true,
          validation: {
            isValid: validation.isValid,
            warnings: validation.warnings.length,
          },
        };
      }
    }

    // Download from provider
    logger.info(`${ticker}: Downloading from provider...`);
    const candles = await this.provider.getHistoricalData(
      ticker,
      startDate,
      endDate,
      options.retries
    );

    if (candles.length === 0) {
      throw new MarketDataError(
        'NO_DATA',
        `No data available for ${ticker}`,
        ticker
      );
    }

    // Validate
    const validation = DataValidator.validateCandles(ticker, candles);
    DataValidator.logResults(ticker, validation);

    if (!validation.isValid) {
      throw new MarketDataError(
        'VALIDATION_FAILED',
        `Data validation failed for ${ticker}`,
        ticker
      );
    }

    // Cache the data
    await this.cache.setCandles(ticker, candles);
    logger.info(`${ticker}: Cached ${candles.length} candles`);

    return {
      candles,
      fromCache: false,
      validation: {
        isValid: validation.isValid,
        warnings: validation.warnings.length,
      },
    };
  }

  /**
   * Download data for multiple stocks.
   * Handles partial failures gracefully.
   */
  async downloadBatch(
    tickers: string[],
    options: DownloadOptions = {}
  ): Promise<BatchDownloadResult> {
    const result: BatchDownloadResult = {
      successful: [],
      failed: new Map(),
      partial: new Map(),
      totalRequests: tickers.length,
    };

    logger.info(`Downloading data for ${tickers.length} stocks...`);
    const startTime = Date.now();

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];

      try {
        const { candles } = await this.downloadStock(ticker, options);
        result.successful.push(ticker);
        logger.info(`[${i + 1}/${tickers.length}] ✓ ${ticker}`);
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        result.failed.set(ticker, errorMsg);
        logger.warn(`[${i + 1}/${tickers.length}] ✗ ${ticker}: ${errorMsg}`);
      }

      // Simple rate limiting
      if (i < tickers.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `Batch download complete: ${result.successful.length}/${tickers.length} successful in ${(elapsed / 1000).toFixed(1)}s`
    );

    return result;
  }

  /**
   * Get the latest quote for a stock.
   */
  async getLatestQuote(ticker: string) {
    // Try cache first
    const cached = await this.cache.getQuote(ticker);
    if (cached) {
      return cached;
    }

    const quote = await this.provider.getLatestQuote(ticker);
    await this.cache.setQuote(ticker, quote);
    return quote;
  }

  /**
   * Get stock metadata.
   */
  async getStockMetadata(ticker: string) {
    // Try cache first
    const cached = await this.cache.getStockInfo(ticker);
    if (cached) {
      return cached;
    }

    const info = await this.provider.getStockMetadata(ticker);
    await this.cache.setStockInfo(ticker, info);
    return info;
  }

  /**
   * Invalidate cache for a stock.
   */
  async invalidateCache(ticker?: string): Promise<void> {
    await this.cache.invalidate(ticker);
    logger.info(`Cache invalidated${ticker ? ` for ${ticker}` : ' (all)'}`);
  }

  /**
   * Check if a stock exists in cache.
   */
  async hasCache(ticker: string): Promise<boolean> {
    return this.cache.exists(ticker);
  }

  private getDefaultStartDate(): Date {
    const date = new Date(config.dataStartDate);
    if (isNaN(date.getTime())) {
      // Default to 5 years ago
      const d = new Date();
      d.setFullYear(d.getFullYear() - 5);
      return d;
    }
    return date;
  }
}
