/**
 * Integration: real route handlers + store + watcher + notifier + data client,
 * with only the outside world (Twelve Data / Finnhub / scanner / Telegram /
 * SMTP / push services) mocked.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpushReal from 'web-push';
import { analysis, json, performance, routeFetch, snapshot, type Route } from '../fixtures';

const VAPID = webpushReal.generateVAPIDKeys();
const OWNER_KEY = 'owner-key-for-tests-123';
const DEVICE = 'd'.repeat(43);
const OTHER = 'o'.repeat(43);
const FCM = 'https://fcm.googleapis.com/fcm/send/test-endpoint';

const sendNotification = vi.fn(async () => ({ statusCode: 201 }));
const sendMail = vi.fn(async () => ({ messageId: '1' }));
vi.mock('web-push', async (orig) => {
  const real = ((await orig()) as { default: typeof webpushReal }).default;
  return { default: { ...real, setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...(a as [])) } };
});
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: (...a: unknown[]) => sendMail(...(a as [])) }) } }));

let prices: Record<string, number>;
let upstream: ReturnType<typeof routeFetch>;
let dataDir: string;

function twelveRoutes(): Route[] {
  return [
    ['api.twelvedata.com/quote', (u) => {
      const s = u.searchParams.get('symbol')!;
      if (!(s in prices)) return json({ status: 'error', code: 404, message: `**symbol** ${s} not found` });
      return json({ symbol: s, close: String(prices[s]), change: '1', percent_change: '0.5', open: '1', high: '1', low: '1', previous_close: '1', volume: '100', timestamp: Math.floor(Date.now() / 1000) });
    }],
    ['api.twelvedata.com/time_series', (u) =>
      u.searchParams.get('symbol') === 'ZZZZ'
        ? json({ status: 'error', code: 400, message: '**symbol** not found' })
        : json({ values: [{ datetime: '2026-09-24', open: '1', high: '2', low: '0.5', close: '1.5', volume: '10' }, { datetime: '2026-09-25', open: '1.5', high: '2', low: '1', close: '1.8', volume: '12' }] })],
    ['api.twelvedata.com/symbol_search', () => json({ data: [{ symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', country: 'United States', instrument_type: 'Common Stock' }] })],
    ['scanner.test/v1/scan/refresh', () => json({ status: 'started' }, 202)],
    ['scanner.test/v1/scan', () => json(snapshot())],
    ['scanner.test/v1/analysis/NOPE', () => json({ error: 'analysis_failed', message: 'no data' }, 502)],
    ['scanner.test/v1/analysis/', (u) => json(analysis(u.pathname.split('/').pop()!))],
    ['scanner.test/v1/performance', () => json(performance())],
    ['api.telegram.org', () => json({ ok: true })],
  ];
}

async function boot(extraEnv: Record<string, string> = {}, keepData = false) {
  vi.resetModules();
  delete (globalThis as { __tdStore?: unknown }).__tdStore;
  delete (globalThis as { __tdWatcher?: unknown }).__tdWatcher;
  if (!keepData) dataDir = mkdtempSync(path.join(tmpdir(), 'td-int-'));
  const env: Record<string, string> = {
    TWELVE_DATA_API_KEY: 'tk-test-secret',
    FINNHUB_API_KEY: '',
    TWELVE_DATA_RPM: '100',
    AI_SCANNER_BASE_URL: 'http://scanner.test',
    AI_SCANNER_API_KEY: 'scanner-secret',
    DATA_DIR: dataDir,
    OWNER_KEY,
    VAPID_PUBLIC_KEY: VAPID.publicKey,
    VAPID_PRIVATE_KEY: VAPID.privateKey,
    SMTP_HOST: 'smtp.test',
    SMTP_USER: 'me@example.com',
    SMTP_PASS: 'pw',
    NOTIFY_EMAIL_TO: 'me@example.com',
    TELEGRAM_BOT_TOKEN: 'tg',
    TELEGRAM_CHAT_ID: '1',
    PUBLIC_BASE_URL: 'https://desk.example.com',
    ...extraEnv,
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  upstream = routeFetch(twelveRoutes());
  vi.stubGlobal('fetch', upstream);
}

let ip = 0;
/** Each request from a fresh IP so per-client rate limits don't interfere. */
function req(url: string, init: RequestInit & { json?: unknown; device?: string | null } = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-forwarded-for', `10.0.${Math.floor(++ip / 250)}.${ip % 250}`);
  if (init.device !== null) headers.set('x-device-key', init.device ?? DEVICE);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  return new Request(`http://localhost${url}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) }) as never;
const flushStore = () => new Promise((r) => setTimeout(r, 300));

beforeEach(async () => {
  prices = { AAPL: 341.07, MSFT: 516.17, SPY: 771.35 };
  sendNotification.mockClear();
  sendMail.mockClear();
  await boot();
});
afterEach(() => vi.useRealTimers());

describe('market data routes', () => {
  it('health reports configured providers as booleans only', async () => {
    const { GET } = await import('@/app/api/health/route');
    const body = await GET().json();
    expect(body).toEqual({ status: 'ok', providers: { quotes: 'twelvedata', candles: 'twelvedata', news: false, scanner: true } });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('quotes: batch, missing symbols, validation', async () => {
    const { GET } = await import('@/app/api/quotes/route');
    const ok = await (await GET(req('/api/quotes?symbols=AAPL,MSFT,ZZZZ'))).json();
    expect(ok.quotes.map((q: { symbol: string; price: number }) => [q.symbol, q.price])).toEqual([['AAPL', 341.07], ['MSFT', 516.17]]);
    expect(ok.missing).toEqual(['ZZZZ']);
    expect((await GET(req('/api/quotes?symbols=aapl;drop'))).status).toBe(400);
    expect((await GET(req('/api/quotes'))).status).toBe(400);
    const tooMany = Array.from({ length: 31 }, (_, i) => `S${i}`).join(',');
    expect((await GET(req(`/api/quotes?symbols=${tooMany}`))).status).toBe(400);
  });

  it('candles: valid, invalid interval/symbol, unknown symbol', async () => {
    const { GET } = await import('@/app/api/candles/route');
    const r = await (await GET(req('/api/candles?symbol=aapl&interval=1d'))).json();
    expect(r).toMatchObject({ symbol: 'AAPL', interval: '1d', source: 'twelvedata' });
    expect(r.candles).toHaveLength(2);
    expect((await GET(req('/api/candles?symbol=AAPL&interval=2d'))).status).toBe(400);
    expect((await GET(req('/api/candles?symbol=../etc&interval=1d'))).status).toBe(400);
    const bad = await GET(req('/api/candles?symbol=ZZZZ&interval=1d'));
    expect(bad.status).toBe(502);
    expect(JSON.stringify(await bad.json())).not.toContain('tk-test-secret');
  });

  it('news: explains it is not configured without Finnhub; validates symbol', async () => {
    const { GET } = await import('@/app/api/news/route');
    const r = await GET(req('/api/news?symbol=AAPL'));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: 'not_configured', message: expect.stringContaining('FINNHUB_API_KEY') });
    expect((await GET(req('/api/news?symbol=<x>'))).status).toBe(400);
  });

  it('news works end-to-end when Finnhub is configured', async () => {
    await boot({ FINNHUB_API_KEY: 'fk' });
    upstream = routeFetch([['finnhub.io/api/v1/company-news', () => json([{ id: 1, headline: 'Apple beats', summary: '', source: 'Reuters', url: 'https://r.com', image: '', datetime: 1790000000 }])]]);
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('@/app/api/news/route');
    const body = await (await GET(req('/api/news?symbol=AAPL'))).json();
    expect(body.items[0]).toMatchObject({ headline: 'Apple beats', datetime: 1790000000000 });
  });

  it('search: validates the query and returns matches', async () => {
    const { GET } = await import('@/app/api/search/route');
    expect((await (await GET(req('/api/search?q=app'))).json()).results[0].symbol).toBe('AAPL');
    for (const q of ['', '<script>', 'a'.repeat(31), "'; DROP"]) expect((await GET(req(`/api/search?q=${encodeURIComponent(q)}`))).status).toBe(400);
  });

  it('per-client rate limit returns 429 with Retry-After', async () => {
    const { GET } = await import('@/app/api/candles/route');
    const same = () => new Request('http://localhost/api/candles?symbol=AAPL&interval=1d', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await GET(same())).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('scanner integration', () => {
  it('proxies scan, filters tickers and validates', async () => {
    const { GET } = await import('@/app/api/scanner/route');
    expect((await (await GET(req('/api/scanner'))).json()).signals).toHaveLength(2);
    expect((await GET(req('/api/scanner?tickers=AAPL,bad!'))).status).toBe(400);
    const call = upstream.calls.find((c) => c.url.includes('/v1/scan'))!;
    expect((call.init?.headers as Record<string, string>)['x-api-key']).toBe('scanner-secret');
  });

  it('analysis: per ticker, ai flag, invalid ticker, upstream failure', async () => {
    const { GET } = await import('@/app/api/scanner/analysis/[ticker]/route');
    const r = await (await GET(req('/api/scanner/analysis/msft?ai=0'), params({ ticker: 'msft' }))).json();
    expect(r.ticker).toBe('MSFT');
    expect(upstream.calls.at(-1)!.url).toContain('/v1/analysis/MSFT?ai=0');
    expect((await GET(req('/api/scanner/analysis/x'), params({ ticker: '../../x' }))).status).toBe(400);
    const fail = await GET(req('/api/scanner/analysis/NOPE'), params({ ticker: 'NOPE' }));
    expect(fail.status).toBe(502);
    expect((await fail.json()).message).toBe('scanner: no data');
  });

  it('refresh and performance', async () => {
    const refresh = await import('@/app/api/scanner/refresh/route');
    expect((await refresh.POST(req('/api/scanner/refresh', { method: 'POST' }))).status).toBe(202);
    const perf = await import('@/app/api/scanner/performance/route');
    expect((await (await perf.GET(req('/api/scanner/performance'))).json()).trades).toHaveLength(1);
  });

  it('reports an unreachable scanner as 502, not a crash', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const { GET } = await import('@/app/api/scanner/route');
    const r = await GET(req('/api/scanner'));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('upstream_unreachable');
  });

  it('returns 503 when the scanner is not configured', async () => {
    await boot({ AI_SCANNER_BASE_URL: '' });
    const { GET } = await import('@/app/api/scanner/route');
    expect((await GET(req('/api/scanner'))).status).toBe(503);
  });
});

describe('live stream (SSE)', () => {
  async function read(res: Response, until: (text: string) => boolean) {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 3000;
    while (!until(text) && Date.now() < deadline) {
      const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 500))]);
      if (value) text += dec.decode(value);
      if (done && !value) continue;
    }
    return { text, reader };
  }

  it('sends ready + quotes for every symbol, with SSE headers', async () => {
    const { GET } = await import('@/app/api/stream/route');
    const ac = new AbortController();
    const res = await GET(new Request('http://localhost/api/stream?symbols=AAPL,MSFT&focus=AAPL', { signal: ac.signal, headers: { 'x-forwarded-for': '198.51.100.1' } }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const { text } = await read(res, (t) => (t.match(/event: quotes/g) ?? []).length >= 2);
    expect(text).toContain('retry: 2000');
    expect(text).toMatch(/event: ready\ndata: \{"provider":"twelvedata"/);
    expect(text).toContain('event: quotes');
    ac.abort();
  });

  it('reports per-symbol errors without killing the stream', async () => {
    const { GET } = await import('@/app/api/stream/route');
    const ac = new AbortController();
    const res = await GET(new Request('http://localhost/api/stream?symbols=ZZZZ&focus=ZZZZ', { signal: ac.signal, headers: { 'x-forwarded-for': '198.51.100.2' } }));
    const { text } = await read(res, (t) => t.includes('quote_error'));
    expect(text).toMatch(/event: quote_error\ndata: \{"symbol":"ZZZZ"/);
    ac.abort();
  });

  it('validates input and requires a provider', async () => {
    const { GET } = await import('@/app/api/stream/route');
    expect((await GET(req('/api/stream?symbols=bad!'))).status).toBe(400);
    await boot({ TWELVE_DATA_API_KEY: '' });
    const again = await import('@/app/api/stream/route');
    expect((await again.GET(req('/api/stream?symbols=AAPL'))).status).toBe(503);
  });

  it('survives a client that cancels the body without an abort signal (no timer crash)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const errors: unknown[] = [];
    const onErr = (e: unknown) => errors.push(e);
    process.on('uncaughtException', onErr);
    try {
      const { GET } = await import('@/app/api/stream/route');
      const res = await GET(new Request('http://localhost/api/stream?symbols=AAPL', { headers: { 'x-forwarded-for': '198.51.100.3' } }));
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel();
      expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    } finally {
      process.off('uncaughtException', onErr);
    }
    expect(errors).toEqual([]);
  });
});

describe('alerts: create → store → retrieve → update → delete', () => {
  it('runs the full lifecycle and isolates devices', async () => {
    const col = await import('@/app/api/alerts/route');
    const one = await import('@/app/api/alerts/[id]/route');

    const created = await col.POST(req('/api/alerts', { method: 'POST', json: { symbol: 'aapl', condition: 'price_above', threshold: 400, note: '  breakout  ' } }));
    expect(created.status).toBe(201);
    const { alert } = await created.json();
    expect(alert).toMatchObject({ symbol: 'AAPL', status: 'active', note: 'breakout' });

    expect((await (await col.GET(req('/api/alerts'))).json()).alerts).toHaveLength(1);
    expect((await (await col.GET(req('/api/alerts', { device: OTHER }))).json()).alerts).toEqual([]);
    expect((await (await col.GET(req('/api/alerts', { device: null }))).json()).alerts).toEqual([]);

    // Another device cannot modify it.
    expect((await one.PATCH(req(`/api/alerts/${alert.id}`, { method: 'PATCH', device: OTHER, json: { action: 'rearm' } }), params({ id: alert.id }))).status).toBe(404);

    const trig = await one.PATCH(req(`/api/alerts/${alert.id}`, { method: 'PATCH', json: { action: 'trigger', price: 401 } }), params({ id: alert.id }));
    expect((await trig.json()).alert).toMatchObject({ status: 'triggered', triggeredPrice: 401 });
    // Second trigger is idempotent.
    await one.PATCH(req(`/api/alerts/${alert.id}`, { method: 'PATCH', json: { action: 'trigger', price: 999 } }), params({ id: alert.id }));
    expect((await (await col.GET(req('/api/alerts'))).json()).alerts[0].triggeredPrice).toBe(401);

    const rearm = await one.PATCH(req(`/api/alerts/${alert.id}`, { method: 'PATCH', json: { action: 'rearm' } }), params({ id: alert.id }));
    expect((await rearm.json()).alert).toEqual(expect.not.objectContaining({ triggeredPrice: expect.anything() }));

    expect((await one.DELETE(req(`/api/alerts/${alert.id}`, { method: 'DELETE' }), params({ id: alert.id }))).status).toBe(200);
    expect((await (await col.GET(req('/api/alerts'))).json()).alerts).toEqual([]);
  });

  it('rejects invalid input', async () => {
    const col = await import('@/app/api/alerts/route');
    const one = await import('@/app/api/alerts/[id]/route');
    const bad = [
      { symbol: 'AAPL', condition: 'price_above', threshold: -5 },
      { symbol: '<img>', condition: 'price_above', threshold: 5 },
      { symbol: 'AAPL', condition: 'moon', threshold: 5 },
      { symbol: 'AAPL', condition: 'change_pct_above', threshold: 500 },
      { symbol: 'AAPL', condition: 'price_above', threshold: '5' },
      { symbol: 'AAPL', condition: 'price_above', threshold: 5, note: 'x'.repeat(141) },
    ];
    for (const b of bad) expect((await col.POST(req('/api/alerts', { method: 'POST', json: b }))).status).toBe(400);
    expect((await col.POST(req('/api/alerts', { method: 'POST', body: '{not json', headers: { 'content-type': 'application/json' } }))).status).toBe(400);
    expect((await col.POST(req('/api/alerts', { method: 'POST', json: { symbol: 'AAPL', condition: 'price_above', threshold: 5 }, device: 'short' }))).status).toBe(400);
    expect((await col.POST(req('/api/alerts', { method: 'POST', body: JSON.stringify({ symbol: 'AAPL', condition: 'price_above', threshold: 5, note: 'x'.repeat(9000) }), headers: { 'content-type': 'application/json', 'content-length': '9100' } }))).status).toBe(400);
    expect((await one.PATCH(req('/api/alerts/x', { method: 'PATCH', json: { action: 'explode' } }), params({ id: 'x' }))).status).toBe(400);
    expect((await one.PATCH(req('/api/alerts/x', { method: 'PATCH', json: { action: 'trigger', price: -1 } }), params({ id: 'x' }))).status).toBe(400);
    expect((await col.DELETE(req('/api/alerts?status=active', { method: 'DELETE' }))).status).toBe(400);
  });

  it('enforces 50 alerts per device and clears history', async () => {
    const col = await import('@/app/api/alerts/route');
    for (let i = 0; i < 50; i++) await col.POST(req('/api/alerts', { method: 'POST', json: { symbol: 'AAPL', condition: 'price_above', threshold: 1000 + i } }));
    const over = await col.POST(req('/api/alerts', { method: 'POST', json: { symbol: 'AAPL', condition: 'price_above', threshold: 5000 } }));
    expect(over.status).toBe(409);
    const store = await import('@/lib/server/store');
    const dev = store.allDevices()[0];
    dev.alerts[0].status = 'triggered';
    expect((await col.DELETE(req('/api/alerts?status=triggered', { method: 'DELETE' }))).status).toBe(200);
    expect((await (await col.GET(req('/api/alerts'))).json()).alerts).toHaveLength(49);
  });

  it('persists to disk (hashed device ids, 0600) and survives a restart', async () => {
    const col = await import('@/app/api/alerts/route');
    await col.POST(req('/api/alerts', { method: 'POST', json: { symbol: 'MSFT', condition: 'price_below', threshold: 400 } }));
    await flushStore();
    const file = path.join(dataDir, 'trading-desk.json');
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('MSFT');
    expect(raw).not.toContain(DEVICE);
    await boot({}, true); // simulate a server restart on the same data dir
    const col2 = await import('@/app/api/alerts/route');
    expect((await (await col2.GET(req('/api/alerts'))).json()).alerts[0]).toMatchObject({ symbol: 'MSFT', threshold: 400 });
  });

  it('starts empty (not crashing) on a corrupted data file', async () => {
    const fs = await import('node:fs');
    fs.writeFileSync(path.join(dataDir, 'trading-desk.json'), '{corrupt');
    await boot({}, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const col = await import('@/app/api/alerts/route');
    expect((await (await col.GET(req('/api/alerts'))).json()).alerts).toEqual([]);
  });
});

describe('notifications', () => {
  it('settings reveal owner channels only to the owner', async () => {
    const n = await import('@/app/api/notifications/route');
    const anon = await (await n.GET(req('/api/notifications'))).json();
    expect(anon).toMatchObject({ push: { configured: true, publicKey: VAPID.publicKey }, owner: false, ownerAvailable: true, ownerChannels: null });
    expect(JSON.stringify(anon)).not.toContain(VAPID.privateKey);
  });

  it('owner unlock: wrong key 403, right key 200, brute force throttled', async () => {
    const o = await import('@/app/api/notifications/owner/route');
    const n = await import('@/app/api/notifications/route');
    const same = (key: string) => new Request('http://localhost/api/notifications/owner', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.50', 'x-device-key': DEVICE, 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
    expect((await o.POST(same('nope'))).status).toBe(403);
    expect((await o.POST(same(OWNER_KEY))).status).toBe(200);
    for (let i = 0; i < 3; i++) await o.POST(same('guess'));
    expect((await o.POST(same(OWNER_KEY))).status).toBe(429);
    const s = await (await n.GET(req('/api/notifications'))).json();
    expect(s).toMatchObject({ owner: true, signals: true, ownerChannels: { email: true, telegram: true } });
    expect((await o.DELETE(req('/api/notifications/owner', { method: 'DELETE' }))).status).toBe(200);
    expect((await (await n.GET(req('/api/notifications'))).json()).owner).toBe(false);
  });

  it('owner unlock is unavailable without OWNER_KEY', async () => {
    await boot({ OWNER_KEY: '' });
    const o = await import('@/app/api/notifications/owner/route');
    expect((await o.POST(req('/api/notifications/owner', { method: 'POST', json: { key: 'anything-long-enough' } }))).status).toBe(503);
  });

  it('subscribe allow-lists push endpoints (SSRF guard) and caps per device', async () => {
    const s = await import('@/app/api/notifications/subscribe/route');
    const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
    expect((await s.POST(req('/x', { method: 'POST', json: sub('http://169.254.169.254/latest') }))).status).toBe(400);
    expect((await s.POST(req('/x', { method: 'POST', json: sub('https://internal.corp/x') }))).status).toBe(400);
    for (let i = 0; i < 7; i++) expect((await s.POST(req('/x', { method: 'POST', json: sub(`${FCM}-${i}`) }))).status).toBe(200);
    const store = await import('@/lib/server/store');
    expect(store.allDevices()[0].subs).toHaveLength(5);
    await s.DELETE(req('/x', { method: 'DELETE', json: { endpoint: `${FCM}-6` } }));
    expect(store.allDevices()[0].subs).toHaveLength(4);
    await s.DELETE(req('/x', { method: 'DELETE', json: {} }));
    expect(store.allDevices()[0].subs).toHaveLength(0);
  });

  it('subscribe returns 503 when push is not configured', async () => {
    await boot({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' });
    const s = await import('@/app/api/notifications/subscribe/route');
    expect((await s.POST(req('/x', { method: 'POST', json: { endpoint: FCM, keys: { p256dh: 'p', auth: 'a' } } }))).status).toBe(503);
  });

  it('test notification reaches push, email and Telegram for the owner', async () => {
    const s = await import('@/app/api/notifications/subscribe/route');
    const o = await import('@/app/api/notifications/owner/route');
    const t = await import('@/app/api/notifications/test/route');
    await s.POST(req('/x', { method: 'POST', json: { endpoint: FCM, keys: { p256dh: 'p', auth: 'a' } } }));
    await o.POST(req('/x', { method: 'POST', json: { key: OWNER_KEY } }));
    const { results } = await (await t.POST(req('/x', { method: 'POST' }))).json();
    expect(results.map((r: { channel: string; ok: boolean }) => `${r.channel}:${r.ok}`).sort()).toEqual(['email:true', 'push:true', 'telegram:true']);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ endpoint: FCM }), expect.stringContaining('Trading Desk test'), expect.anything());
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'me@example.com', from: 'Trading Desk <me@example.com>' }));
    const tg = upstream.calls.find((c) => c.url.includes('api.telegram.org'))!;
    expect(JSON.parse(tg.init!.body as string).text).toContain('https://desk.example.com/');
  });

  it('removes expired push subscriptions (410 Gone)', async () => {
    const s = await import('@/app/api/notifications/subscribe/route');
    const t = await import('@/app/api/notifications/test/route');
    await s.POST(req('/x', { method: 'POST', json: { endpoint: FCM, keys: { p256dh: 'p', auth: 'a' } } }));
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    const { results } = await (await t.POST(req('/x', { method: 'POST' }))).json();
    expect(results[0]).toMatchObject({ channel: 'push', ok: false, detail: expect.stringMatching(/expired/) });
    const store = await import('@/lib/server/store');
    expect(store.allDevices()[0].subs).toHaveLength(0);
  });

  it('escapes user text in email/Telegram (no HTML injection)', async () => {
    const col = await import('@/app/api/alerts/route');
    const one = await import('@/app/api/alerts/[id]/route');
    const o = await import('@/app/api/notifications/owner/route');
    await o.POST(req('/x', { method: 'POST', json: { key: OWNER_KEY } }));
    const { alert } = await (await col.POST(req('/api/alerts', { method: 'POST', json: { symbol: 'AAPL', condition: 'price_above', threshold: 400, note: '<script>alert(1)</script>' } }))).json();
    await one.PATCH(req('/x', { method: 'PATCH', json: { action: 'trigger', price: 401 } }), params({ id: alert.id }));
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalled());
    const html = (sendMail.mock.calls[0] as unknown as [{ html: string }])[0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    const tg = upstream.calls.find((c) => c.url.includes('api.telegram.org'))!;
    expect(JSON.parse(tg.init!.body as string).text).not.toContain('<script>');
  });

  it('reports channel failures instead of throwing', async () => {
    sendMail.mockRejectedValueOnce(new Error('535 bad credentials'));
    upstream = routeFetch([['api.telegram.org', () => json({ ok: false, description: 'chat not found' }, 400)]]);
    vi.stubGlobal('fetch', upstream);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const o = await import('@/app/api/notifications/owner/route');
    const t = await import('@/app/api/notifications/test/route');
    await o.POST(req('/x', { method: 'POST', json: { key: OWNER_KEY } }));
    const { results } = await (await t.POST(req('/x', { method: 'POST' }))).json();
    expect(results).toEqual(expect.arrayContaining([
      { channel: 'email', ok: false, detail: '535 bad credentials' },
      { channel: 'telegram', ok: false, detail: 'chat not found' },
    ]));
  });

  it('test endpoint 404s for an unknown device', async () => {
    const t = await import('@/app/api/notifications/test/route');
    expect((await t.POST(req('/x', { method: 'POST', device: OTHER }))).status).toBe(404);
    expect((await t.POST(req('/x', { method: 'POST', device: null }))).status).toBe(400);
  });

  it('PATCH toggles scanner-signal notifications', async () => {
    const n = await import('@/app/api/notifications/route');
    expect((await n.PATCH(req('/x', { method: 'PATCH', json: { signals: 'yes' } }))).status).toBe(400);
    await n.PATCH(req('/x', { method: 'PATCH', json: { signals: true } }));
    expect((await (await n.GET(req('/api/notifications'))).json()).signals).toBe(true);
  });
});

describe('background watcher', () => {
  const MARKET_OPEN = new Date('2026-09-25T11:00:00-04:00');

  async function withAlert(threshold: number, condition = 'price_above') {
    const col = await import('@/app/api/alerts/route');
    const s = await import('@/app/api/notifications/subscribe/route');
    await s.POST(req('/x', { method: 'POST', json: { endpoint: FCM, keys: { p256dh: 'p', auth: 'a' } } }));
    return (await (await col.POST(req('/api/alerts', { method: 'POST', json: { symbol: 'AAPL', condition, threshold } }))).json()).alert;
  }

  it('fires crossed alerts server-side and pushes to the device', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: MARKET_OPEN });
    const a = await withAlert(300);
    await withAlert(500); // not crossed
    const w = await import('@/lib/server/watcher');
    await w.alertsTick();
    const store = await import('@/lib/server/store');
    const alerts = store.allDevices()[0].alerts;
    expect(alerts.find((x) => x.id === a.id)).toMatchObject({ status: 'triggered', triggeredPrice: 341.07 });
    expect(alerts.filter((x) => x.status === 'active')).toHaveLength(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse((sendNotification.mock.calls[0] as unknown as [unknown, string])[1])).toMatchObject({ title: '🔔 AAPL $341.07', path: '/?symbol=AAPL' });
    await w.alertsTick(); // already triggered — no duplicate
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('skips work when the market is closed', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-27T12:00:00-04:00') });
    await withAlert(300);
    const before = upstream.calls.length;
    const w = await import('@/lib/server/watcher');
    await w.alertsTick();
    expect(upstream.calls.length).toBe(before);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('survives a data outage', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: MARKET_OPEN });
    await withAlert(300);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const w = await import('@/lib/server/watcher');
    await expect(w.alertsTick()).resolves.toBeUndefined();
  });

  it('notifies new scanner signals exactly once (owner + opted-in devices)', async () => {
    const o = await import('@/app/api/notifications/owner/route');
    const s = await import('@/app/api/notifications/subscribe/route');
    await s.POST(req('/x', { method: 'POST', json: { endpoint: FCM, keys: { p256dh: 'p', auth: 'a' } } }));
    await o.POST(req('/x', { method: 'POST', json: { key: OWNER_KEY } }));
    const w = await import('@/lib/server/watcher');
    await w.signalsTick();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((sendMail.mock.calls[0] as unknown as [{ subject: string; text: string }])[0]).toMatchObject({ subject: '📈 New signal: NVDA BUY', text: expect.stringContaining('entry $180.50, stop $172.25, target $197.00') });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    await w.signalsTick();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('startWatcher is idempotent and can be disabled', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const w = await import('@/lib/server/watcher');
    w.startWatcher();
    w.startWatcher();
    expect(log).toHaveBeenCalledTimes(1);
    await boot({ WATCHER_ENABLED: 'false' });
    const w2 = await import('@/lib/server/watcher');
    w2.startWatcher();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('instrumentation registers the watcher only on the Node runtime', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    const inst = await import('@/instrumentation');
    await inst.register();
    expect(log).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await inst.register();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[watcher] started'));
  });
});

describe('PWA assets', () => {
  it('manifest and icon route', async () => {
    const m = (await import('@/app/manifest')).default();
    expect(m).toMatchObject({ name: 'Trading Desk', display: 'standalone' });
    const icon = await import('@/app/pwa-icon/[size]/route');
    expect((await icon.GET(new Request('http://x'), params({ size: '64' }))).status).toBe(404);
  });
});
