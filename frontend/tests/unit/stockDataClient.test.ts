import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, routeFetch, type Route } from '../fixtures';

type Client = typeof import('@/lib/api-clients/stockDataClient');

async function load(env: Record<string, string | undefined>, routes: Route[]) {
  vi.resetModules();
  for (const k of ['FINNHUB_API_KEY', 'TWELVE_DATA_API_KEY', 'AI_SCANNER_BASE_URL', 'FINNHUB_RPM', 'TWELVE_DATA_RPM']) vi.stubEnv(k, '');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? '');
  const f = routeFetch(routes);
  vi.stubGlobal('fetch', f);
  const client: Client = await import('@/lib/api-clients/stockDataClient');
  const rl = await import('@/lib/server/rateLimit');
  return { client, fetch: f, rl };
}

const twelveQuote = (symbol: string, close = '341.07') => ({
  symbol,
  close,
  change: '5.15',
  percent_change: '1.53',
  open: '336.04',
  high: '341.67',
  low: '334.53',
  previous_close: '335.92',
  volume: '29950100',
  timestamp: 1790366340,
});

describe('providerStatus', () => {
  it('reports nothing configured', async () => {
    const { client } = await load({}, []);
    expect(client.providerStatus()).toEqual({ quotes: null, candles: null, news: false, scanner: false });
  });
  it('prefers Finnhub for quotes when both keys exist and never exposes keys', async () => {
    const { client } = await load({ FINNHUB_API_KEY: 'fk-secret', TWELVE_DATA_API_KEY: 'tk-secret', AI_SCANNER_BASE_URL: 'http://s:4000' }, []);
    const s = client.providerStatus();
    expect(s).toEqual({ quotes: 'finnhub', candles: 'twelvedata', news: true, scanner: true });
    expect(JSON.stringify(s)).not.toMatch(/secret/);
  });
});

describe('quotes via Twelve Data', () => {
  it('maps fields, sends the key in a header (never the URL) and caches', async () => {
    const { client, fetch } = await load({ TWELVE_DATA_API_KEY: 'tk-secret' }, [['/quote', () => json(twelveQuote('AAPL'))]]);
    const q = await client.getQuote('AAPL');
    expect(q).toMatchObject({ symbol: 'AAPL', price: 341.07, change: 5.15, changePercent: 1.53, volume: 29950100, bid: null, source: 'twelvedata', timestamp: 1790366340000 });
    expect(fetch.calls[0].url).not.toContain('tk-secret');
    expect((fetch.calls[0].init?.headers as Record<string, string>).Authorization).toBe('apikey tk-secret');
    await client.getQuote('AAPL');
    expect(fetch.calls).toHaveLength(1);
    expect(client.isQuoteFresh('AAPL')).toBe(true);
    expect(client.peekQuote('AAPL')?.price).toBe(341.07);
    expect(client.quoteTtlMs()).toBe(60_000);
  });

  it('dedupes concurrent requests for the same symbol', async () => {
    const { client, fetch } = await load({ TWELVE_DATA_API_KEY: 'k' }, [['/quote', () => json(twelveQuote('MSFT'))]]);
    await Promise.all([client.getQuote('MSFT'), client.getQuote('MSFT'), client.getQuote('MSFT')]);
    expect(fetch.calls).toHaveLength(1);
  });

  it('rejects a quote with no price (invalid symbol)', async () => {
    const { client, rl } = await load({ TWELVE_DATA_API_KEY: 'k' }, [['/quote', () => json({ symbol: 'ZZZZ' })]]);
    await expect(client.getQuote('ZZZZ')).rejects.toBeInstanceOf(rl.UpstreamError);
  });

  it('maps Twelve Data error bodies: 429 → budget error, others → upstream error', async () => {
    const a = await load({ TWELVE_DATA_API_KEY: 'k' }, [['/quote', () => json({ status: 'error', code: 429, message: 'limit' })]]);
    await expect(a.client.getQuote('AAPL')).rejects.toBeInstanceOf(a.rl.UpstreamBudgetError);
    const b = await load({ TWELVE_DATA_API_KEY: 'k' }, [['/quote', () => json({ status: 'error', code: 400, message: '**symbol** not found' })]]);
    await expect(b.client.getQuote('AAPL')).rejects.toMatchObject({ status: 400, message: 'twelvedata: **symbol** not found' });
  });

  it('maps HTTP errors without leaking the key', async () => {
    const { client } = await load({ TWELVE_DATA_API_KEY: 'tk-secret' }, [['/quote', () => new Response('boom', { status: 500 })]]);
    const err = (await client.getQuote('AAPL').catch((e: Error) => e)) as Error;
    expect(err.message).toBe('twelvedata: HTTP 500');
    expect(err.message).not.toContain('tk-secret');
  });

  it('HTTP 429 from the provider becomes a budget error', async () => {
    const { client, rl } = await load({ TWELVE_DATA_API_KEY: 'k' }, [['/quote', () => new Response('', { status: 429 })]]);
    await expect(client.getQuote('AAPL')).rejects.toBeInstanceOf(rl.UpstreamBudgetError);
  });

  it('enforces the local request budget without calling upstream', async () => {
    const { client, fetch, rl } = await load({ TWELVE_DATA_API_KEY: 'k', TWELVE_DATA_RPM: '2' }, [['/quote', (u) => json(twelveQuote(u.searchParams.get('symbol')!))]]);
    await client.getQuote('A');
    await client.getQuote('B');
    await expect(client.getQuote('C')).rejects.toBeInstanceOf(rl.UpstreamBudgetError);
    expect(fetch.calls).toHaveLength(2);
  });

  it('getQuotes is best-effort: stale cache fills gaps, unknowns are listed as missing', async () => {
    let fail = false;
    const { client } = await load({ TWELVE_DATA_API_KEY: 'k' }, [
      ['/quote', (u) => (fail ? new Response('', { status: 500 }) : json(twelveQuote(u.searchParams.get('symbol')!)))],
    ]);
    await client.getQuotes(['AAPL']);
    fail = true;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000); // AAPL now stale
    const r = await client.getQuotes(['AAPL', 'NOPE']);
    expect(r.quotes.map((q) => q.symbol)).toEqual(['AAPL']);
    expect(r.missing).toEqual(['NOPE']);
  });

  it('throws NotConfigured with no provider key', async () => {
    const { client } = await load({}, []);
    await expect(client.getQuote('AAPL')).rejects.toBeInstanceOf(client.NotConfiguredError);
  });
});

describe('quotes via Finnhub', () => {
  it('maps the Finnhub payload and uses a 2s freshness window', async () => {
    const { client, fetch } = await load({ FINNHUB_API_KEY: 'fk' }, [
      ['finnhub.io/api/v1/quote', () => json({ c: 10, d: 0.5, dp: 5.26, h: 11, l: 9, o: 9.5, pc: 9.5, t: 1790366340 })],
    ]);
    const q = await client.getQuote('SOFI');
    expect(q).toMatchObject({ price: 10, changePercent: 5.26, volume: null, source: 'finnhub', timestamp: 1790366340000 });
    expect((fetch.calls[0].init?.headers as Record<string, string>)['X-Finnhub-Token']).toBe('fk');
    expect(client.quoteTtlMs()).toBe(2_000);
  });

  it('treats Finnhub all-zero payload as unknown symbol', async () => {
    const { client, rl } = await load({ FINNHUB_API_KEY: 'fk' }, [['/quote', () => json({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 })]]);
    await expect(client.getQuote('ZZZZ')).rejects.toBeInstanceOf(rl.UpstreamError);
  });
});

describe('candles', () => {
  const series = {
    values: [
      { datetime: '2026-09-24', open: '10', high: '11', low: '9', close: '10.5', volume: '100' },
      { datetime: '2026-09-23', open: '9', high: '10', low: '8', close: '9.5', volume: 'bad' },
      { datetime: '2026-09-25', open: 'x', high: '11', low: '9', close: '10', volume: '1' },
    ],
  };

  it('parses, sorts, drops malformed bars and defaults volume', async () => {
    const { client, fetch } = await load({ TWELVE_DATA_API_KEY: 'k' }, [['/time_series', () => json(series)]]);
    const r = await client.getCandles('AAPL', '1d');
    expect(r.candles.map((c) => c.time)).toEqual([Date.UTC(2026, 8, 23) / 1000, Date.UTC(2026, 8, 24) / 1000]);
    expect(r.candles[0].volume).toBe(0);
    expect(new URL(fetch.calls[0].url).searchParams.get('interval')).toBe('1day');
    expect(r.stale).toBeUndefined();
  });

  it('parses intraday timestamps as UTC', async () => {
    const { client } = await load({ TWELVE_DATA_API_KEY: 'k' }, [
      ['/time_series', () => json({ values: [{ datetime: '2026-09-25 19:55:00', open: '1', high: '1', low: '1', close: '1', volume: '1' }] })],
    ]);
    const r = await client.getCandles('AAPL', '5m');
    expect(r.candles[0].time).toBe(Date.UTC(2026, 8, 25, 19, 55) / 1000);
  });

  it('errors when a symbol has no candles', async () => {
    const { client } = await load({ TWELVE_DATA_API_KEY: 'k' }, [['/time_series', () => json({ values: [] })]]);
    await expect(client.getCandles('ZZZZ', '1d')).rejects.toMatchObject({ status: 404 });
  });

  it('serves the last good series flagged stale when over budget', async () => {
    let limited = false;
    const { client } = await load({ TWELVE_DATA_API_KEY: 'k' }, [
      ['/time_series', () => (limited ? json({ status: 'error', code: 429 }) : json(series))],
    ]);
    await client.getCandles('AAPL', '1m');
    limited = true;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    const r = await client.getCandles('AAPL', '1m');
    expect(r.stale).toBe(true);
    expect(r.candles).toHaveLength(2);
  });

  it('rethrows non-budget errors even with a cached series', async () => {
    let broken = false;
    const { client } = await load({ TWELVE_DATA_API_KEY: 'k' }, [['/time_series', () => (broken ? new Response('', { status: 500 }) : json(series))]]);
    await client.getCandles('AAPL', '1m');
    broken = true;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    await expect(client.getCandles('AAPL', '1m')).rejects.toMatchObject({ status: 500 });
  });
});

describe('news', () => {
  it('requires Finnhub', async () => {
    const { client } = await load({ TWELVE_DATA_API_KEY: 'k' }, []);
    await expect(client.getNews('AAPL')).rejects.toThrow(/FINNHUB_API_KEY/);
  });

  it('maps and caps company news', async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i, headline: `h${i}`, summary: '', source: 's', url: 'https://x', image: '', datetime: 1790000000 }));
    const { client } = await load({ FINNHUB_API_KEY: 'fk' }, [['/company-news', () => json(items)]]);
    const r = await client.getNews('AAPL');
    expect(r).toHaveLength(30);
    expect(r[0]).toMatchObject({ id: 0, image: null, datetime: 1790000000000 });
  });

  it('handles a non-array response as empty', async () => {
    const { client } = await load({ FINNHUB_API_KEY: 'fk' }, [['/company-news', () => json({ error: 'x' })]]);
    expect(await client.getNews('AAPL')).toEqual([]);
  });
});

describe('symbol search', () => {
  it('uses Finnhub and filters to US stocks/ETFs', async () => {
    const { client } = await load({ FINNHUB_API_KEY: 'fk' }, [
      ['/search', () => json({ result: [
        { symbol: 'AAPL', description: 'APPLE INC', type: 'Common Stock' },
        { symbol: 'AAPL.MX', description: 'x', type: 'Common Stock' },
        { symbol: 'BMV:AAPL', description: 'x', type: 'Common Stock' },
        { symbol: 'AAPLW', description: 'warrant', type: 'Warrant' },
      ] })],
    ]);
    const r = await client.searchSymbols(' aapl ');
    expect(r.map((m) => m.symbol)).toEqual(['AAPL', 'AAPL.MX']);
  });

  it('falls back to Twelve Data search (free, no credit cost)', async () => {
    const { client } = await load({ TWELVE_DATA_API_KEY: 'k', TWELVE_DATA_RPM: '1' }, [
      ['/symbol_search', () => json({ data: [
        { symbol: 'TSLA', instrument_name: 'Tesla Inc', exchange: 'NASDAQ', country: 'United States', instrument_type: 'Common Stock' },
        { symbol: 'TSLA', instrument_name: 'Tesla', exchange: 'BMV', country: 'Mexico', instrument_type: 'Common Stock' },
      ] })],
    ]);
    expect(await client.searchSymbols('tsla')).toEqual([{ symbol: 'TSLA', description: 'Tesla Inc', exchange: 'NASDAQ' }]);
    expect(await client.searchSymbols('TSLA')).toHaveLength(1); // cached
  });

  it('returns [] for empty provider results', async () => {
    const { client } = await load({ FINNHUB_API_KEY: 'fk' }, [['/search', () => json({})]]);
    expect(await client.searchSymbols('QQQQQ')).toEqual([]);
  });
});

describe('timeouts', () => {
  it('propagates an abort as a TimeoutError', async () => {
    const { client } = await load({ TWELVE_DATA_API_KEY: 'k' }, [
      ['/quote', () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))],
    ]);
    await expect(client.getQuote('AAPL')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

beforeEach(() => vi.restoreAllMocks());
