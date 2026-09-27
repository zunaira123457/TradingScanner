import { Candle, Quote, StockInfo, DataProviderConfig } from '@/types';

/**
 * Abstract interface for market data providers.
 * Implementations must handle their own API rate limiting, retries, and errors.
 */
export interface IMarketDataProvider {
  /**
   * Get historical OHLCV data for a stock.
   * Data should be ordered chronologically (oldest first).
   */
  getHistoricalData(
    ticker: string,
    startDate: Date,
    endDate: Date,
    retries?: number
  ): Promise<Candle[]>;

  /**
   * Get the latest price and quote for a stock.
   */
  getLatestQuote(ticker: string): Promise<Quote>;

  /**
   * Get stock metadata (name, sector, market cap, etc.)
   */
  getStockMetadata(ticker: string): Promise<StockInfo>;

  /**
   * Get historical data for multiple stocks.
   * Should handle partial failures gracefully.
   */
  getMultipleHistorical(
    tickers: string[],
    startDate: Date,
    endDate: Date
  ): Promise<Map<string, Candle[]>>;

  /**
   * Validate that the provider is properly configured and accessible.
   */
  validateConnection(): Promise<boolean>;

  /**
   * Get the provider name for logging/debugging.
   */
  getName(): string;
}

/**
 * Base class with common functionality for providers.
 */
export abstract class BaseMarketDataProvider implements IMarketDataProvider {
  protected config: DataProviderConfig;

  constructor(config: DataProviderConfig) {
    this.config = config;
  }

  abstract getHistoricalData(
    ticker: string,
    startDate: Date,
    endDate: Date,
    retries?: number
  ): Promise<Candle[]>;

  abstract getLatestQuote(ticker: string): Promise<Quote>;

  abstract getStockMetadata(ticker: string): Promise<StockInfo>;

  abstract validateConnection(): Promise<boolean>;

  abstract getName(): string;

  async getMultipleHistorical(
    tickers: string[],
    startDate: Date,
    endDate: Date
  ): Promise<Map<string, Candle[]>> {
    const results = new Map<string, Candle[]>();

    for (const ticker of tickers) {
      try {
        const data = await this.getHistoricalData(ticker, startDate, endDate);
        results.set(ticker, data);
      } catch (error) {
        // Log but continue with other stocks
        console.error(`Failed to get data for ${ticker}:`, error);
      }
    }

    return results;
  }

  /**
   * Validate OHLC relationships (high >= low, etc.)
   */
  protected validateCandle(candle: Candle, ticker: string, index: number): void {
    if (candle.high < candle.low) {
      throw new Error(
        `Invalid candle for ${ticker} at index ${index}: high (${candle.high}) < low (${candle.low})`
      );
    }
    if (candle.close < 0 || candle.open < 0) {
      throw new Error(
        `Invalid candle for ${ticker} at index ${index}: negative prices (open=${candle.open}, close=${candle.close})`
      );
    }
    if (candle.volume < 0) {
      throw new Error(
        `Invalid candle for ${ticker} at index ${index}: negative volume (${candle.volume})`
      );
    }
  }

  /**
   * Ensure candles are sorted chronologically.
   */
  protected sortCandles(candles: Candle[]): Candle[] {
    return [...candles].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Detect and remove duplicate candles.
   */
  protected removeDuplicates(candles: Candle[]): Candle[] {
    const seen = new Set<number>();
    return candles.filter((candle) => {
      const key = candle.timestamp.getTime();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public code: string,
    message: string,
    public ticker?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
