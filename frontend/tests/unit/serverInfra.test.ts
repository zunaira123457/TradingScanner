import { afterEach, describe, expect, it, vi } from 'vitest';
import { TTLCache } from '@/lib/server/cache';
import { TokenBucket, UpstreamBudgetError, UpstreamError, clientRateLimit } from '@/lib/server/rateLimit';
import { errorResponse, limitOr429, parseSymbol, parseSymbols } from '@/lib/server/respond';
import { NotConfiguredError } from '@/lib/api-clients/stockDataClient';
import { json, routeFetch } from '../fixtures';

afterEach(() => vi.useRealTimers());

describe('TTLCache', () => {
  it('expires by ttl but keeps stale entries peekable', () => {
    vi.useFakeTimers();
    const c = new TTLCache<number>();
    c.set('a', 1);
    expect(c.get('a', 1000)).toBe(1);
    vi.advanceTimersByTime(1500);
    expect(c.get('a', 1000)).toBeUndefined();
    expect(c.peek('a')).toEqual({ value: 1, ageMs: 1500 });
    expect(c.peek('missing')).toBeUndefined();
  });

  it('evicts the oldest entry at capacity (LRU on write)', () => {
    const c = new TTLCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 3); // refresh a
    c.set('c', 4); // evicts b
    expect(c.peek('b')).toBeUndefined();
    expect(c.peek('a')?.value).toBe(3);
  });

  it('shares one in-flight load and does not cache failures', async () => {
    const c = new TTLCache<number>();
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(7);
    await expect(Promise.all([c.getOrLoad('k', 1000, load), c.getOrLoad('k', 1000, load)])).rejects.toThrow('x');
    expect(load).toHaveBeenCalledTimes(1);
    expect(await c.getOrLoad('k', 1000, load)).toBe(7);
    expect(await c.getOrLoad('k', 1000, load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('TokenBucket', () => {
  it('spends, refills over time and reports wait time', () => {
    let t = 0;
    const b = TokenBucket.perMinute(6, () => t);
    for (let i = 0; i < 6; i++) expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.available()).toBe(0);
    expect(b.waitMs()).toBe(10_000);
    t += 10_000;
    expect(b.take()).toBe(true);
    expect(b.waitMs(0)).toBe(0);
  });
  it('never exceeds capacity', () => {
    let t = 0;
    const b = TokenBucket.perMinute(2, () => t);
    t += 10 * 60_000;
    expect(b.available()).toBe(2);
  });
});

describe('clientRateLimit', () => {
  const req = (ip: string) => new Request('http://x', { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });
  it('limits per client IP and bucket, then resets after the window', () => {
    vi.useFakeTimers();
    expect(clientRateLimit(req('1.1.1.1'), 'b', 2).ok).toBe(true);
    expect(clientRateLimit(req('1.1.1.1'), 'b', 2).ok).toBe(true);
    const r = clientRateLimit(req('1.1.1.1'), 'b', 2);
    expect(r).toEqual({ ok: false, retryAfter: 60 });
    expect(clientRateLimit(req('2.2.2.2'), 'b', 2).ok).toBe(true);
    expect(clientRateLimit(req('1.1.1.1'), 'other', 2).ok).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(clientRateLimit(req('1.1.1.1'), 'b', 2).ok).toBe(true);
  });
  it('falls back to a shared key without a forwarded header', () => {
    expect(clientRateLimit(new Request('http://x'), 'local-test', 1).ok).toBe(true);
    expect(clientRateLimit(new Request('http://x'), 'local-test', 1).ok).toBe(false);
  });
});

describe('errorResponse', () => {
  const body = async (r: Response) => ({ status: r.status, body: await r.json(), retry: r.headers.get('retry-after') });

  it.each([
    [new NotConfiguredError('Finnhub', 'FINNHUB_API_KEY'), 503, 'not_configured'],
    [new UpstreamBudgetError('twelvedata', 12_300), 429, 'upstream_rate_limited'],
    [new UpstreamError('finnhub', 404, 'no quote'), 404, 'upstream_error'],
    [new UpstreamError('finnhub', 500, 'HTTP 500'), 502, 'upstream_error'],
    [Object.assign(new Error('t'), { name: 'TimeoutError' }), 504, 'upstream_timeout'],
    [Object.assign(new Error('a'), { name: 'AbortError' }), 504, 'upstream_timeout'],
    [new TypeError('fetch failed'), 502, 'upstream_unreachable'],
  ])('%s → %i', async (err, status, code) => {
    const r = await body(errorResponse(err));
    expect(r.status).toBe(status);
    expect(r.body.error).toBe(code);
  });

  it('sets Retry-After for budget errors', async () => {
    expect((await body(errorResponse(new UpstreamBudgetError('x', 12_300)))).retry).toBe('13');
  });

  it('hides internals of unexpected errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await body(errorResponse(new Error('SELECT * FROM secrets; key=sk-live-123')));
    expect(r).toEqual({ status: 500, body: { error: 'internal_error' }, retry: null });
    expect(spy).toHaveBeenCalled();
  });
});

describe('limitOr429', () => {
  it('returns null under the limit and a 429 over it', async () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect(limitOr429(req, 'l429', 1)).toBeNull();
    const r = limitOr429(req, 'l429', 1)!;
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect((await r.json()).error).toBe('rate_limited');
  });
});

describe('symbol parsing (input validation)', () => {
  it.each([
    ['aapl', 'AAPL'],
    [' brk.b ', 'BRK.B'],
    ['A', 'A'],
    ['', null],
    [null, null],
    ['1ABC', null],
    ['TOOLONGX', null],
    ['AA PL', null],
    ['../etc', null],
    ['<script>', null],
    ["A'OR'1", null],
  ])('parseSymbol(%j) → %j', (raw, expected) => expect(parseSymbol(raw as string | null)).toBe(expected));

  it('parseSymbols dedupes, uppercases and enforces a max', () => {
    expect(parseSymbols('aapl,MSFT,aapl, ', 5)).toEqual(['AAPL', 'MSFT']);
    expect(parseSymbols('A,B,C', 2)).toBeNull();
    expect(parseSymbols('AAPL,bad!', 5)).toBeNull();
    expect(parseSymbols(',', 5)).toBeNull();
    expect(parseSymbols(null, 5)).toBeNull();
  });
});

describe('scannerClient', () => {
  async function load(env: Record<string, string>, routes: Parameters<typeof routeFetch>[0]) {
    vi.resetModules();
    vi.stubEnv('AI_SCANNER_BASE_URL', '');
    vi.stubEnv('AI_SCANNER_API_KEY', '');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const f = routeFetch(routes);
    vi.stubGlobal('fetch', f);
    return { ...(await import('@/lib/api-clients/scannerClient')), fetch: f };
  }

  it('throws NotConfigured without a base URL', async () => {
    const { scannerClient } = await load({}, []);
    await expect(scannerClient.scan()).rejects.toThrow(/AI_SCANNER_BASE_URL/);
  });

  it('attaches the API key header and builds each endpoint', async () => {
    const { scannerClient, fetch } = await load({ AI_SCANNER_BASE_URL: 'http://scanner:4000', AI_SCANNER_API_KEY: 'sk' }, [[/.*/, () => json({ ok: true })]]);
    await scannerClient.scan(['AAPL', 'MSFT']);
    await scannerClient.refresh();
    await scannerClient.analysis('BRK.B', false);
    await scannerClient.performance();
    await scannerClient.health();
    expect(fetch.calls.map((c) => c.url)).toEqual([
      'http://scanner:4000/v1/scan?tickers=AAPL%2CMSFT',
      'http://scanner:4000/v1/scan/refresh',
      'http://scanner:4000/v1/analysis/BRK.B?ai=0',
      'http://scanner:4000/v1/performance',
      'http://scanner:4000/health',
    ]);
    expect(fetch.calls[1].init?.method).toBe('POST');
    expect((fetch.calls[0].init?.headers as Record<string, string>)['x-api-key']).toBe('sk');
  });

  it('keeps a path prefix in the base URL', async () => {
    const { scannerClient, fetch } = await load({ AI_SCANNER_BASE_URL: 'https://host.example/scanner/' }, [[/.*/, () => json({})]]);
    await scannerClient.scan();
    expect(fetch.calls[0].url).toBe('https://host.example/scanner/v1/scan');
  });

  it('surfaces the upstream error message and status', async () => {
    const { scannerClient } = await load({ AI_SCANNER_BASE_URL: 'http://s' }, [
      ['/analysis', () => json({ error: 'analysis_failed', message: 'no data for ZZZ' }, 502)],
      ['/scan', () => new Response('<html>', { status: 503 })],
    ]);
    await expect(scannerClient.analysis('ZZZ')).rejects.toMatchObject({ status: 502, message: 'scanner: no data for ZZZ' });
    await expect(scannerClient.scan()).rejects.toMatchObject({ status: 503, message: 'scanner: HTTP 503' });
  });
});

describe('env validation', () => {
  it('treats blank values as unset and applies defaults', async () => {
    vi.resetModules();
    vi.stubEnv('FINNHUB_API_KEY', '   ');
    vi.stubEnv('FINNHUB_RPM', '');
    const { env } = await import('@/lib/server/env');
    expect(env.FINNHUB_API_KEY).toBeUndefined();
    expect(env.FINNHUB_RPM).toBe(50);
    expect(env.FINNHUB_BASE_URL).toBe('https://finnhub.io/api/v1');
  });

  it('rejects a weak OWNER_KEY and a malformed scanner URL at startup', async () => {
    vi.resetModules();
    vi.stubEnv('OWNER_KEY', 'short');
    await expect(import('@/lib/server/env')).rejects.toThrow(/OWNER_KEY/);
    vi.resetModules();
    vi.stubEnv('OWNER_KEY', '');
    vi.stubEnv('AI_SCANNER_BASE_URL', 'not a url');
    await expect(import('@/lib/server/env')).rejects.toThrow();
  });
});
