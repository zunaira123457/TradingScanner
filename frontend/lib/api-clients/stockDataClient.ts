import 'server-only';
import { env } from '@/lib/server/env';
import { TTLCache } from '@/lib/server/cache';
import { TokenBucket, UpstreamBudgetError, UpstreamError } from '@/lib/server/rateLimit';
import type { Candle, CandleResponse, DataSource, Interval, NewsItem, ProviderStatus, Quote, SymbolMatch } from '@/lib/types';

/**
 * Market-data access for route handlers.
 *
 *  - Quotes: Finnhub (60 req/min free, real-time US) when FINNHUB_API_KEY is
 *    set, otherwise Twelve Data (8 req/min, 800/day free).
 *  - Candles: Twelve Data (Finnhub's candle endpoint is not on its free plan).
 *  - News / symbol search: Finnhub, with Twelve Data search as a fallback.
 *
 * No function here ever fabricates a value. If a provider is unconfigured,
 * over budget, or errors, the caller gets an error (or explicitly-flagged
 * stale data) and the UI says so.
 */

const FINNHUB = env.FINNHUB_BASE_URL.replace(/\/$/, '');
const TWELVE = env.TWELVE_DATA_BASE_URL.replace(/\/$/, '');
const TIMEOUT_MS = 8_000;

const finnhubBudget = TokenBucket.perMinute(env.FINNHUB_RPM);
const twelveBudget = TokenBucket.perMinute(env.TWELVE_DATA_RPM);

const quoteCache = new TTLCache<Quote>();
const candleCache = new TTLCache<Candle[]>(200);
const newsCache = new TTLCache<NewsItem[]>(200);
const searchCache = new TTLCache<SymbolMatch[]>(500);

export function providerStatus(): ProviderStatus {
  return {
    quotes: env.FINNHUB_API_KEY ? 'finnhub' : env.TWELVE_DATA_API_KEY ? 'twelvedata' : null,
    candles: env.TWELVE_DATA_API_KEY ? 'twelvedata' : null,
    news: Boolean(env.FINNHUB_API_KEY),
    scanner: Boolean(env.AI_SCANNER_BASE_URL),
  };
}

export class NotConfiguredError extends Error {
  constructor(what: string, envVar: string) {
    super(`${what} is not configured — set ${envVar}`);
  }
}

async function getJSON(provider: DataSource, url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 429) throw new UpstreamBudgetError(provider, 60_000);
  if (!res.ok) throw new UpstreamError(provider, res.status, `HTTP ${res.status}`);
  return res.json();
}

function finnhub(path: string, params: Record<string, string>) {
  if (!env.FINNHUB_API_KEY) throw new NotConfiguredError('Finnhub', 'FINNHUB_API_KEY');
  if (!finnhubBudget.take()) throw new UpstreamBudgetError('finnhub', finnhubBudget.waitMs());
  const qs = new URLSearchParams(params).toString();
  return getJSON('finnhub', `${FINNHUB}${path}?${qs}`, { 'X-Finnhub-Token': env.FINNHUB_API_KEY });
}

async function twelve(path: string, params: Record<string, string>, cost = 1) {
  if (!env.TWELVE_DATA_API_KEY) throw new NotConfiguredError('Twelve Data', 'TWELVE_DATA_API_KEY');
  if (!twelveBudget.take(cost)) throw new UpstreamBudgetError('twelvedata', twelveBudget.waitMs(cost));
  const qs = new URLSearchParams(params).toString();
  const body = (await getJSON('twelvedata', `${TWELVE}${path}?${qs}`, {
    Authorization: `apikey ${env.TWELVE_DATA_API_KEY}`,
  })) as { status?: string; code?: number; message?: string };
  if (body && body.status === 'error') {
    if (body.code === 429) throw new UpstreamBudgetError('twelvedata', 60_000);
    throw new UpstreamError('twelvedata', body.code ?? 500, body.message ?? 'unknown error');
  }
  return body;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/* ---------------------------------- Quotes --------------------------------- */

interface FinnhubQuote {
  c: number; d: number | null; dp: number | null; h: number; l: number; o: number; pc: number; t: number;
}

async function fetchFinnhubQuote(symbol: string): Promise<Quote> {
  const q = (await finnhub('/quote', { symbol })) as FinnhubQuote;
  // Finnhub answers unknown symbols with an all-zero payload rather than an error.
  if (!q || !q.c || !q.t) throw new UpstreamError('finnhub', 404, `no quote for ${symbol}`);
  return {
    symbol,
    price: q.c,
    change: q.d,
    changePercent: q.dp,
    open: q.o || null,
    high: q.h || null,
    low: q.l || null,
    prevClose: q.pc || null,
    volume: null,
    bid: null,
    ask: null,
    timestamp: q.t * 1000,
    fetchedAt: Date.now(),
    source: 'finnhub',
  };
}

type TwelveQuote = Record<string, unknown>;

function mapTwelveQuote(symbol: string, q: TwelveQuote): Quote {
  const price = num(q.close);
  if (price === null) throw new UpstreamError('twelvedata', 404, `no quote for ${symbol}`);
  return {
    symbol,
    price,
    change: num(q.change),
    changePercent: num(q.percent_change),
    open: num(q.open),
    high: num(q.high),
    low: num(q.low),
    prevClose: num(q.previous_close),
    volume: num(q.volume),
    bid: null,
    ask: null,
    timestamp: (num(q.last_quote_at) ?? num(q.timestamp) ?? Date.now() / 1000) * 1000,
    fetchedAt: Date.now(),
    source: 'twelvedata',
  };
}

async function fetchTwelveQuote(symbol: string): Promise<Quote> {
  const q = (await twelve('/quote', { symbol, country: 'United States' })) as TwelveQuote;
  return mapTwelveQuote(symbol, q);
}

/** Freshness window per provider — how long a cached quote counts as current. */
export function quoteTtlMs(): number {
  return env.FINNHUB_API_KEY ? 2_000 : 60_000;
}

export async function getQuote(symbol: string): Promise<Quote> {
  const fetcher = env.FINNHUB_API_KEY ? fetchFinnhubQuote : fetchTwelveQuote;
  return quoteCache.getOrLoad(symbol, quoteTtlMs(), () => fetcher(symbol));
}

/** Last known quote regardless of age (used to fill a snapshot without spending budget). */
export function peekQuote(symbol: string): Quote | undefined {
  return quoteCache.peek(symbol)?.value;
}

export function isQuoteFresh(symbol: string): boolean {
  return quoteCache.get(symbol, quoteTtlMs()) !== undefined;
}

/**
 * Best-effort multi-symbol quote: returns what it could fetch within the
 * current budget plus any older cached quotes, and lists symbols it could not
 * provide at all. Never throws for a single symbol's failure.
 */
export async function getQuotes(symbols: string[]): Promise<{ quotes: Quote[]; missing: string[] }> {
  const results = await Promise.allSettled(symbols.map((s) => getQuote(s)));
  const quotes: Quote[] = [];
  const missing: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') quotes.push(r.value);
    else {
      const stale = peekQuote(symbols[i]);
      if (stale) quotes.push(stale);
      else missing.push(symbols[i]);
    }
  });
  return { quotes, missing };
}

/* --------------------------------- Candles --------------------------------- */

const TWELVE_INTERVAL: Record<Interval, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1h', '1d': '1day', '1w': '1week',
};

/** How long a candle series stays fresh. Live ticks update the last bar in the browser in between. */
const CANDLE_TTL_MS: Record<Interval, number> = {
  '1m': 60_000, '5m': 120_000, '15m': 300_000, '1h': 600_000, '1d': 1_800_000, '1w': 3_600_000,
};

function parseTwelveDatetime(s: string): number {
  // With timezone=UTC Twelve Data returns "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss" in UTC.
  const iso = s.length === 10 ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`;
  return Math.floor(Date.parse(iso) / 1000);
}

async function fetchCandles(symbol: string, interval: Interval): Promise<Candle[]> {
  const body = (await twelve('/time_series', {
    symbol,
    interval: TWELVE_INTERVAL[interval],
    outputsize: '500',
    timezone: 'UTC',
    country: 'United States',
    order: 'ASC',
  })) as { values?: Record<string, string>[] };
  const values = body.values ?? [];
  const candles: Candle[] = [];
  for (const v of values) {
    const c = {
      time: parseTwelveDatetime(v.datetime),
      open: num(v.open),
      high: num(v.high),
      low: num(v.low),
      close: num(v.close),
      volume: num(v.volume) ?? 0,
    };
    if (c.open === null || c.high === null || c.low === null || c.close === null || !Number.isFinite(c.time)) continue;
    candles.push(c as Candle);
  }
  candles.sort((a, b) => a.time - b.time);
  if (candles.length === 0) throw new UpstreamError('twelvedata', 404, `no candles for ${symbol}`);
  return candles;
}

export async function getCandles(symbol: string, interval: Interval): Promise<CandleResponse> {
  const key = `${symbol}:${interval}`;
  try {
    const candles = await candleCache.getOrLoad(key, CANDLE_TTL_MS[interval], () => fetchCandles(symbol, interval));
    return { symbol, interval, candles, source: 'twelvedata', fetchedAt: Date.now() };
  } catch (error) {
    // Over budget: serve the last good series, clearly flagged as stale.
    const stale = candleCache.peek(key);
    if (error instanceof UpstreamBudgetError && stale) {
      return { symbol, interval, candles: stale.value, source: 'twelvedata', fetchedAt: Date.now() - stale.ageMs, stale: true };
    }
    throw error;
  }
}

/* ---------------------------------- News ----------------------------------- */

interface FinnhubNews {
  id: number; headline: string; summary: string; source: string; url: string; image: string; datetime: number;
}

export async function getNews(symbol: string): Promise<NewsItem[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return newsCache.getOrLoad(symbol, 10 * 60_000, async () => {
    const items = (await finnhub('/company-news', { symbol, from: day(from), to: day(to) })) as FinnhubNews[];
    return (Array.isArray(items) ? items : []).slice(0, 30).map((n) => ({
      id: n.id,
      headline: n.headline,
      summary: n.summary,
      source: n.source,
      url: n.url,
      image: n.image || null,
      datetime: n.datetime * 1000,
    }));
  });
}

/* --------------------------------- Search ---------------------------------- */

export async function searchSymbols(query: string): Promise<SymbolMatch[]> {
  const q = query.trim().toUpperCase();
  return searchCache.getOrLoad(q, 24 * 3_600_000, async () => {
    if (env.FINNHUB_API_KEY) {
      const body = (await finnhub('/search', { q, exchange: 'US' })) as {
        result?: { symbol: string; description: string; type: string }[];
      };
      return (body.result ?? [])
        .filter((r) => (r.type === 'Common Stock' || r.type === 'ETP') && !r.symbol.includes(':'))
        .slice(0, 10)
        .map((r) => ({ symbol: r.symbol, description: r.description }));
    }
    const body = (await twelve('/symbol_search', { symbol: q, outputsize: '20' }, 0)) as {
      data?: { symbol: string; instrument_name: string; exchange: string; country: string; instrument_type: string }[];
    };
    return (body.data ?? [])
      .filter((r) => r.country === 'United States' && ['Common Stock', 'ETF'].includes(r.instrument_type))
      .slice(0, 10)
      .map((r) => ({ symbol: r.symbol, description: r.instrument_name, exchange: r.exchange }));
  });
}
