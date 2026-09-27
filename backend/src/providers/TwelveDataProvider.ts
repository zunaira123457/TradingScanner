import axios, { AxiosInstance } from 'axios';
import { Candle, Quote, StockInfo, DataProviderConfig } from '@/types';
import { BaseMarketDataProvider, ProviderError } from './MarketDataProvider';
import logger from '@/utils/logger';

interface TwelveDataCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export type IntradayInterval = '1min' | '5min' | '15min' | '30min' | '1h';

interface TwelveDataResponse {
  meta?: {
    type?: string;
    currency?: string;
    exchange?: string;
    mic_code?: string;
    exchange_timezone?: string;
  };
  values?: TwelveDataCandle[];
  status?: string;
}

// Actual shape of GET /quote as returned by Twelve Data (verified against
// the live API — the free-tier stock quote has no bid/ask/last_price fields;
// "close" is the most recent traded price).
interface TwelveDataQuote {
  symbol?: string;
  name?: string;
  exchange?: string;
  mic_code?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  last_quote_at?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  average_volume?: string;
  is_market_open?: boolean;
  fifty_two_week?: {
    low?: string;
    high?: string;
  };
}

export class TwelveDataProvider extends BaseMarketDataProvider {
  private client: AxiosInstance;
  private requestCount = 0;
  private lastResetTime = Date.now();
  private readonly RATE_LIMIT: number;
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute

  constructor(apiKey: string, requestsPerMinute = 8) {
    super({ apiKey });
    // Default of 8 matches the observed free-tier limit ("You have run out
    // of API credits for the current minute... limit being 8"). Paid tiers
    // support far higher throughput — pass requestsPerMinute to match your
    // actual plan rather than relying on 429-retry-backoff to self-correct.
    this.RATE_LIMIT = requestsPerMinute;

    this.client = axios.create({
      baseURL: 'https://api.twelvedata.com',
      timeout: 10000,
      params: {
        apikey: apiKey,
      },
    });
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/quote', {
        params: {
          symbol: 'AAPL',
        },
      });
      return response.status === 200 && !response.data.message;
    } catch (error) {
      logger.error('Twelve Data validation failed:', error);
      return false;
    }
  }

  getName(): string {
    return 'TwelveData';
  }

  async getHistoricalData(
    ticker: string,
    startDate: Date,
    endDate: Date,
    retries = 3
  ): Promise<Candle[]> {
    await this.throttle();

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await this.client.get('/time_series', {
          params: {
            symbol: ticker,
            interval: '1day',
            start_date: this.formatDate(startDate),
            end_date: this.formatDate(endDate),
            country: 'United States',
          },
        });

        if (response.data.status === 'error' || response.data.message) {
          throw new ProviderError(
            this.getName(),
            'API_ERROR',
            response.data.message || 'Unknown API error',
            ticker
          );
        }

        this.assertUSInstrument(ticker, response.data.meta?.currency);

        if (!response.data.values) {
          return [];
        }

        const candles = response.data.values.map((item: TwelveDataCandle, index: number) => {
          const candle: Candle = {
            timestamp: new Date(item.datetime),
            open: parseFloat(item.open),
            high: parseFloat(item.high),
            low: parseFloat(item.low),
            close: parseFloat(item.close),
            volume: parseInt(item.volume),
          };
          this.validateCandle(candle, ticker, index);
          return candle;
        });

        const sorted = this.sortCandles(candles);
        const deduplicated = this.removeDuplicates(sorted);

        return deduplicated;
      } catch (error) {
        if (attempt === retries - 1) {
          throw error;
        }
        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    throw new ProviderError(
      this.getName(),
      'UNKNOWN_ERROR',
      'Failed to fetch historical data after retries',
      ticker
    );
  }

  /**
   * Intraday counterpart to getHistoricalData. Kept as a separate method
   * (matching this class's existing one-method-per-concern pattern) rather
   * than parameterizing getHistoricalData, since the pagination strategy
   * differs: a single /time_series call is capped at outputsize=5000, which
   * daily bars never come close to but intraday bars (78/day at 5min) do
   * for any request spanning more than ~2-3 months — so this paginates
   * backward in time, one 5000-bar page at a time, until the full requested
   * range is covered or the provider runs out of data.
   */
  async getIntradayHistoricalData(
    ticker: string,
    interval: IntradayInterval,
    startDate: Date,
    endDate: Date,
    retries = 3
  ): Promise<Candle[]> {
    const allCandles: Candle[] = [];
    let cursorEnd = endDate;
    const MAX_PAGES = 20; // safety cap — real ranges this tool is used for need far fewer pages

    for (let page = 0; page < MAX_PAGES; page++) {
      await this.throttle();

      let pageCandles: Candle[] | null = null;

      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const response = await this.client.get('/time_series', {
            params: {
              symbol: ticker,
              interval,
              start_date: this.formatDate(startDate),
              end_date: this.formatDateTime(cursorEnd),
              outputsize: 5000,
              timezone: 'UTC',
              country: 'United States',
            },
          });

          if (response.data.status === 'error' || response.data.message) {
            throw new ProviderError(
              this.getName(),
              'API_ERROR',
              response.data.message || 'Unknown API error',
              ticker
            );
          }

          this.assertUSInstrument(ticker, response.data.meta?.currency);

          if (!response.data.values || response.data.values.length === 0) {
            pageCandles = [];
            break;
          }

          pageCandles = response.data.values.map((item: TwelveDataCandle, index: number) => {
            const candle: Candle = {
              timestamp: this.parseUtcDatetime(item.datetime),
              open: parseFloat(item.open),
              high: parseFloat(item.high),
              low: parseFloat(item.low),
              close: parseFloat(item.close),
              volume: parseInt(item.volume),
            };
            this.validateCandle(candle, ticker, index);
            return candle;
          });
          break;
        } catch (error) {
          if (attempt === retries - 1) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }

      if (pageCandles === null || pageCandles.length === 0) {
        break;
      }

      allCandles.push(...pageCandles);

      const earliestInPage = pageCandles.reduce(
        (min, c) => (c.timestamp < min ? c.timestamp : min),
        pageCandles[0].timestamp
      );

      // Either we've covered the requested range, or this page came back
      // short of outputsize — both mean there's no more (or no more needed)
      // data further back, so pagination is done.
      if (earliestInPage <= startDate || pageCandles.length < 5000) {
        break;
      }

      cursorEnd = new Date(earliestInPage.getTime() - 1000);
    }

    const sorted = this.sortCandles(allCandles);
    const deduplicated = this.removeDuplicates(sorted);
    return deduplicated.filter((c) => c.timestamp >= startDate && c.timestamp <= endDate);
  }

  async getLatestQuote(ticker: string): Promise<Quote> {
    await this.throttle();

    try {
      const response = await this.client.get('/quote', {
        params: {
          symbol: ticker,
          country: 'United States',
        },
      });

      if (response.data.message) {
        throw new ProviderError(
          this.getName(),
          'API_ERROR',
          response.data.message,
          ticker
        );
      }

      const data = response.data as TwelveDataQuote;
      this.assertUSInstrument(ticker, data.currency);

      if (!data.close) {
        throw new ProviderError(
          this.getName(),
          'MISSING_FIELD',
          `Quote response for ${ticker} did not include a "close" price`,
          ticker
        );
      }

      return {
        timestamp: new Date((data.timestamp ?? Math.floor(Date.now() / 1000)) * 1000),
        price: parseFloat(data.close),
        volume: data.volume ? parseInt(data.volume) : undefined,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        this.getName(),
        'NETWORK_ERROR',
        `Failed to fetch quote: ${error instanceof Error ? error.message : 'unknown'}`,
        ticker,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getStockMetadata(ticker: string): Promise<StockInfo> {
    await this.throttle();

    try {
      const response = await this.client.get('/quote', {
        params: {
          symbol: ticker,
          country: 'United States',
        },
      });

      if (response.data.message) {
        throw new ProviderError(
          this.getName(),
          'API_ERROR',
          response.data.message,
          ticker
        );
      }

      const data = response.data as TwelveDataQuote;
      this.assertUSInstrument(ticker, data.currency);

      return {
        ticker,
        name: data.name || ticker,
        currency: data.currency,
        exchange: data.exchange,
        price: data.close ? parseFloat(data.close) : undefined,
        avgVolume30d: data.average_volume ? parseInt(data.average_volume) : undefined,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        this.getName(),
        'NETWORK_ERROR',
        `Failed to fetch metadata: ${error instanceof Error ? error.message : 'unknown'}`,
        ticker,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Company profile lookup (sector/industry) via GET /profile. This reflects
   * the company's CURRENT classification only — Twelve Data's available
   * tier does not expose historical point-in-time sector reclassification
   * history, so callers applying this to historical trades are assuming
   * sector stability over the backtest period, which is a reasonable
   * approximation for established companies but is not point-in-time-exact.
   * Returns nulls (not a thrown error) when sector/industry are unavailable
   * for a given symbol, since a missing profile is a normal, expected case
   * for some instruments — this method's contract is "best effort," not
   * "existing history is guaranteed."
   */
  async getCompanyProfile(ticker: string): Promise<{ sector: string | null; industry: string | null }> {
    await this.throttle();

    try {
      const response = await this.client.get('/profile', {
        params: { symbol: ticker },
      });

      // No separate error pre-check needed: on a genuine error response
      // `sector`/`industry` simply aren't present, so `?? null` already
      // does the right thing. (An earlier version checked truthy
      // `response.data.code` as an error signal, which incorrectly treated
      // SOME successful responses as errors — Twelve Data echoes a numeric
      // status code on success too, not only on failure.)
      return {
        sector: response.data.sector ?? null,
        industry: response.data.industry ?? null,
      };
    } catch {
      return { sector: null, industry: null };
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private formatDateTime(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  /**
   * Twelve Data intraday responses (requested with timezone=UTC) come back
   * as "YYYY-MM-DD HH:mm:ss" — not full ISO 8601 (no 'T'/'Z'), which Node
   * would otherwise parse as the process's LOCAL time rather than UTC.
   * Forces the correct interpretation regardless of server timezone.
   */
  private parseUtcDatetime(datetime: string): Date {
    return new Date(`${datetime.replace(' ', 'T')}Z`);
  }

  /**
   * Defense-in-depth guard against symbol collisions. Ambiguous tickers
   * (e.g. "QQQ" also exists as an unrelated Canadian Securities Exchange
   * listing) can silently resolve to the wrong instrument even with
   * `country: 'United States'` passed on the request. Since this system is
   * U.S.-equities-only, any non-USD-currency response is treated as a data
   * integrity failure rather than silently accepted.
   */
  private assertUSInstrument(ticker: string, currency: string | undefined): void {
    if (currency && currency !== 'USD') {
      throw new ProviderError(
        this.getName(),
        'NON_US_INSTRUMENT',
        `${ticker} resolved to a non-USD instrument (currency: ${currency}) — likely a symbol collision with a non-U.S. listing`,
        ticker
      );
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const timeSinceReset = now - this.lastResetTime;

    if (timeSinceReset > this.RATE_LIMIT_WINDOW) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }

    if (this.requestCount >= this.RATE_LIMIT) {
      const waitTime = this.RATE_LIMIT_WINDOW - timeSinceReset;
      logger.warn(
        `Rate limit approaching. Waiting ${waitTime}ms before next request.`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.lastResetTime = Date.now();
    }

    this.requestCount++;
  }
}
