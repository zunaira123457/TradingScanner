// @vitest-environment jsdom
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistentState } from '@/hooks/usePersistentState';
import { DEFAULT_WATCHLIST, MAX_WATCHLIST, useWatchlist } from '@/hooks/useWatchlist';
import { useLivePrices } from '@/hooks/useLivePrices';
import { useAlerts } from '@/hooks/useAlerts';
import { useCandles, useNews, useSymbolSearch } from '@/hooks/useStockData';
import { useProviders } from '@/hooks/useProviders';
import { usePerformance, useScanner, useTickerAnalysis } from '@/hooks/useScanner';
import { useNotifications } from '@/hooks/useNotifications';
import { deviceKey, api } from '@/lib/device';
import { FakeEventSource, json, quote, routeFetch, snapshot, signal, type Route } from '../fixtures';
import { renderHookWithProviders } from '../render';
import { useSWRConfig } from 'swr';
import type { PriceAlert, ProviderStatus } from '@/lib/types';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast, Toaster: () => null }));

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.values(toast).forEach((f) => f.mockClear());
});
afterEach(() => vi.useRealTimers());

describe('usePersistentState', () => {
  const isNum = (v: unknown): v is number => typeof v === 'number';
  it('persists, supports functional updates and syncs across hook instances', () => {
    const a = renderHookWithProviders(() => usePersistentState('k', 1, isNum));
    const b = renderHookWithProviders(() => usePersistentState('k', 1, isNum));
    expect(a.result.current[0]).toBe(1);
    expect(a.result.current[2]).toBe(true);
    act(() => a.result.current[1]((p) => p + 5));
    expect(a.result.current[0]).toBe(6);
    expect(b.result.current[0]).toBe(6);
    expect(localStorage.getItem('k')).toBe('6');
  });
  it('falls back to the initial value for corrupt or invalid storage', () => {
    localStorage.setItem('bad', '{not json');
    localStorage.setItem('wrong', '"a string"');
    expect(renderHookWithProviders(() => usePersistentState('bad', 3, isNum)).result.current[0]).toBe(3);
    expect(renderHookWithProviders(() => usePersistentState('wrong', 4, isNum)).result.current[0]).toBe(4);
    const { result } = renderHookWithProviders(() => usePersistentState('bad', 3, isNum));
    act(() => result.current[1]((p) => p * 2));
    expect(result.current[0]).toBe(6);
  });
  it('picks up changes from other tabs (storage event)', () => {
    const { result } = renderHookWithProviders(() => usePersistentState('tab', 0, isNum));
    act(() => {
      localStorage.setItem('tab', '9');
      window.dispatchEvent(new StorageEvent('storage', { key: 'tab' }));
    });
    expect(result.current[0]).toBe(9);
  });
  it('keeps working in memory when localStorage throws (private mode / quota)', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHookWithProviders(() => usePersistentState('mem', 1, isNum));
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
    set.mockRestore();
  });
});

describe('useWatchlist', () => {
  it('defaults, adds without duplicates, removes, caps at 20 and persists', () => {
    const { result, unmount } = renderHookWithProviders(() => useWatchlist());
    expect(result.current.symbols).toEqual(DEFAULT_WATCHLIST);
    act(() => result.current.add('AAPL'));
    expect(result.current.symbols).toHaveLength(DEFAULT_WATCHLIST.length);
    act(() => result.current.remove('AAPL'));
    expect(result.current.symbols).not.toContain('AAPL');
    for (let i = 0; i < 15; i++) act(() => result.current.add(`S${i}`));
    expect(result.current.symbols).toHaveLength(MAX_WATCHLIST);
    expect(result.current.full).toBe(true);
    unmount();
    const again = renderHookWithProviders(() => useWatchlist());
    expect(again.result.current.symbols).toHaveLength(MAX_WATCHLIST);
    expect(again.result.current.symbols).not.toContain('AAPL');
  });
});

describe('useLivePrices', () => {
  const providers: ProviderStatus = { quotes: 'twelvedata', candles: 'twelvedata', news: false, scanner: true };
  beforeEach(() => vi.stubGlobal('fetch', routeFetch([['/api/quotes', () => json({ quotes: [quote('AAPL', { price: 100, timestamp: 1 })], missing: [] })]])));

  it('is idle without providers and unconfigured without a quote provider', () => {
    expect(renderHookWithProviders(() => useLivePrices(['AAPL'], 'AAPL', null)).result.current.status).toBe('idle');
    const r = renderHookWithProviders(() => useLivePrices(['AAPL'], 'AAPL', { ...providers, quotes: null }));
    expect(r.result.current.status).toBe('unconfigured');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('snapshots, then streams; newer quotes win; errors, throttle and reconnect states', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHookWithProviders(() => useLivePrices(['AAPL', 'MSFT'], 'AAPL', providers));
    expect(result.current.status).toBe('connecting');
    await waitFor(() => expect(result.current.quotes.AAPL?.price).toBe(100));
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe('/api/stream?symbols=AAPL%2CMSFT&focus=AAPL');
    act(() => es.emit('ready', {}));
    expect(result.current.status).toBe('live');
    act(() => es.emit('quotes', [quote('AAPL', { price: 101, timestamp: 5, fetchedAt: 5 })]));
    expect(result.current.quotes.AAPL.price).toBe(101);
    act(() => es.emit('quotes', [quote('AAPL', { price: 99, timestamp: 2, fetchedAt: 2 })]));
    expect(result.current.quotes.AAPL.price).toBe(101); // stale tick ignored
    act(() => es.emit('quote_error', { symbol: 'MSFT', message: 'not found' }));
    expect(result.current.errors).toEqual({ MSFT: 'not found' });
    act(() => es.emit('quotes', [quote('MSFT')]));
    expect(result.current.errors).toEqual({});
    act(() => es.emit('status', { state: 'throttled', retryAfterMs: 5000 }));
    expect(result.current.status).toBe('throttled');
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.status).toBe('live');
    act(() => es.fail());
    expect(result.current.status).toBe('reconnecting');
    act(() => es.onopen?.(new Event('open')));
    expect(result.current.status).toBe('live');
    expect(result.current.lastMessageAt).not.toBeNull();
  });

  it('rapid switching opens ONE new stream after things settle; old ones are closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender, unmount } = renderHookWithProviders(({ f }: { f: string }) => useLivePrices(['AAPL', 'MSFT', 'NVDA'], f, providers), { initialProps: { f: 'AAPL' } });
    expect(FakeEventSource.instances).toHaveLength(1);
    for (const f of ['MSFT', 'NVDA', 'AAPL', 'MSFT', 'NVDA']) {
      rerender({ f });
      act(() => vi.advanceTimersByTime(100));
    }
    expect(FakeEventSource.instances).toHaveLength(1); // still debouncing
    act(() => vi.advanceTimersByTime(400));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.open).toHaveLength(1);
    expect(FakeEventSource.open[0].url).toContain('focus=NVDA');
    unmount();
    expect(FakeEventSource.open).toHaveLength(0);
  });

  it('self-heals when the browser permanently closes the stream (e.g. HTTP 429), with backoff', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHookWithProviders(() => useLivePrices(['AAPL'], 'AAPL', providers));
    const first = FakeEventSource.instances[0];
    act(() => {
      first.readyState = 2;
      first.fail();
    });
    expect(result.current.status).toBe('reconnecting');
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeEventSource.instances).toHaveLength(2);
    const second = FakeEventSource.instances[1];
    act(() => {
      second.readyState = 2;
      second.fail();
    });
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeEventSource.instances).toHaveLength(2); // backoff doubled to 4s
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeEventSource.instances).toHaveLength(3);
    act(() => FakeEventSource.instances[2].emit('ready', {}));
    expect(result.current.status).toBe('live');
  });

  it('shows Offline immediately and reconnects the moment the network returns', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result } = renderHookWithProviders(() => useLivePrices(['AAPL'], 'AAPL', providers));
    expect(FakeEventSource.open).toHaveLength(1);
    onLine.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.status).toBe('offline');
    expect(FakeEventSource.open).toHaveLength(0);
    onLine.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(FakeEventSource.open).toHaveLength(1);
    expect(result.current.status).toBe('connecting');
  });

  it('tolerates a failing snapshot request', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    const { result } = renderHookWithProviders(() => useLivePrices(['AAPL'], null, providers));
    act(() => FakeEventSource.instances[0].emit('quotes', [quote('AAPL')]));
    expect(result.current.quotes.AAPL.price).toBe(341.07);
    expect(FakeEventSource.instances[0].url).toBe('/api/stream?symbols=AAPL');
  });
});

describe('device + api helper', () => {
  it('creates one stable 256-bit key and attaches it to requests', async () => {
    const k = deviceKey();
    expect(k).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deviceKey()).toBe(k);
    const f = routeFetch([['/api/x', () => json({ ok: 1 })], ['/api/err', () => json({ error: 'bad', message: 'Nope' }, 400)], ['/api/html', () => new Response('<h1>', { status: 502 })]]);
    vi.stubGlobal('fetch', f);
    await api('/api/x', { method: 'POST', body: { a: 1 } });
    const h = f.calls[0].init!.headers as Record<string, string>;
    expect(h['x-device-key']).toBe(k);
    expect(h['content-type']).toBe('application/json');
    expect(f.calls[0].init!.body).toBe('{"a":1}');
    await expect(api('/api/err')).rejects.toMatchObject({ status: 400, message: 'Nope' });
    await expect(api('/api/html')).rejects.toMatchObject({ status: 502 });
  });
  it('falls back to an in-memory key when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(deviceKey()).toBe(deviceKey());
  });
});

describe('useAlerts (server-backed)', () => {
  let server: PriceAlert[];
  const routes = (): Route[] => [
    [/\/api\/alerts\?status=triggered/, () => { server = server.filter((a) => a.status === 'active'); return json({ ok: true }); }],
    [/\/api\/alerts\/[^/?]+$/, (u, init) => {
      const id = u.pathname.split('/').pop()!;
      if (init?.method === 'DELETE') { server = server.filter((a) => a.id !== id); return json({ ok: true }); }
      const body = JSON.parse(init!.body as string);
      const a = server.find((x) => x.id === id)!;
      if (body.action === 'rearm') Object.assign(a, { status: 'active', triggeredAt: undefined, triggeredPrice: undefined });
      else Object.assign(a, { status: 'triggered', triggeredPrice: body.price });
      return json({ alert: a });
    }],
    ['/api/alerts', (_u, init) => {
      if (init?.method === 'POST') {
        const b = JSON.parse(init.body as string);
        if (b.symbol === 'FAIL') return json({ error: 'limit_reached', message: 'Up to 50 alerts' }, 409);
        const a: PriceAlert = { id: `id${server.length + 1}`, createdAt: 1, status: 'active', ...b };
        server.unshift(a);
        return json({ alert: a }, 201);
      }
      return json({ alerts: server });
    }],
  ];
  beforeEach(() => {
    server = [];
    vi.stubGlobal('fetch', routeFetch(routes()));
  });

  it('creates, fires locally on a live tick, reports to server, re-arms, removes and clears', async () => {
    const { result, rerender } = renderHookWithProviders(({ q }: { q: Record<string, ReturnType<typeof quote>> }) => useAlerts(q), { initialProps: { q: {} } });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await result.current.create('AAPL', 'price_above', 350, 'note');
    });
    expect(result.current.alerts).toHaveLength(1);
    rerender({ q: { AAPL: quote('AAPL', { price: 351 }) } });
    await waitFor(() => expect(result.current.alerts[0].status).toBe('triggered'));
    expect(toast.warning).toHaveBeenCalledWith('Alert: AAPL at $351.00', expect.anything());
    await waitFor(() => expect(server[0].status).toBe('triggered'));
    rerender({ q: { AAPL: quote('AAPL', { price: 352 }) } });
    expect(toast.warning).toHaveBeenCalledTimes(1); // no repeat
    rerender({ q: { AAPL: quote('AAPL', { price: 340 }) } }); // back below before re-arming
    await act(async () => { await result.current.rearm('id1'); });
    expect(server[0].status).toBe('active');
    await act(async () => { await result.current.remove('id1'); });
    expect(result.current.alerts).toEqual([]);
    await act(async () => { await result.current.clearTriggered(); });
  });

  it('announces alerts fired by the server watcher while the tab was away', async () => {
    server = [{ id: 's1', symbol: 'MSFT', condition: 'price_below', threshold: 400, createdAt: 1, status: 'active' }];
    const { result } = renderHookWithProviders(() => ({ ...useAlerts({}), swr: useSWRConfig() }));
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    server = [{ ...server[0], status: 'triggered', triggeredPrice: 399 }];
    // Revalidate like the 20s poll would.
    await act(async () => {
      await result.current.swr.mutate('/api/alerts');
    });
    await waitFor(() => expect(result.current.alerts[0]?.status).toBe('triggered'), { timeout: 3000 });
    expect(toast.warning).toHaveBeenCalledWith('Alert: MSFT at $399.00', expect.anything());
  });

  it('surfaces a server error on create', async () => {
    const { result } = renderHookWithProviders(() => useAlerts({}));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      expect(await result.current.create('FAIL', 'price_above', 1)).toBeNull();
    });
    expect(toast.error).toHaveBeenCalledWith('Could not create alert', { description: 'Up to 50 alerts' });
  });

  it('rolls back an optimistic delete that fails', async () => {
    server = [{ id: 'x', symbol: 'AAPL', condition: 'price_above', threshold: 1, createdAt: 1, status: 'active' }];
    const { result } = renderHookWithProviders(() => useAlerts({}));
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    vi.stubGlobal('fetch', routeFetch([['/api/alerts/x', () => json({ error: 'internal_error' }, 500)], ['/api/alerts', () => json({ alerts: server })]]));
    await act(async () => { await result.current.remove('x'); });
    expect(result.current.alerts).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith('Could not update alerts', expect.anything());
  });

  it('migrates alerts saved by the old browser-only version', async () => {
    localStorage.setItem('sd.alerts.v1', JSON.stringify([
      { id: 'old', symbol: 'TSLA', condition: 'price_above', threshold: 500, createdAt: 1, status: 'active' },
      { id: 'done', symbol: 'TSLA', condition: 'price_above', threshold: 1, createdAt: 1, status: 'triggered' },
    ]));
    const { result } = renderHookWithProviders(() => useAlerts({}));
    await waitFor(() => expect(result.current.alerts.map((a) => a.symbol)).toEqual(['TSLA']));
    expect(localStorage.getItem('sd.alerts.v1')).toBeNull();
  });
});

describe('SWR data hooks', () => {
  const dataRoutes = () =>
    routeFetch([
      ['/api/candles', () => json({ symbol: 'AAPL', interval: '5m', candles: [], source: 'twelvedata', fetchedAt: 1 })],
      ['/api/news', () => json({ items: [{ id: 1 }] })],
      ['/api/search', () => json({ results: [{ symbol: 'AAPL', description: 'Apple' }] })],
      ['/api/health', () => json({ providers: { quotes: 'finnhub', candles: 'twelvedata', news: true, scanner: true } })],
    ]);
  it('useCandles', async () => {
    vi.stubGlobal('fetch', dataRoutes());
    const c = renderHookWithProviders(() => useCandles('AAPL', '5m'));
    await waitFor(() => expect(c.result.current.data?.symbol).toBe('AAPL'));
    expect(renderHookWithProviders(() => useCandles(null, '1d')).result.current.data).toBeUndefined();
  });
  it('useNews', async () => {
    vi.stubGlobal('fetch', dataRoutes());
    const n = renderHookWithProviders(() => useNews('AAPL'));
    await waitFor(() => expect(n.result.current.data?.items).toHaveLength(1));
  });
  it('useSymbolSearch encodes the query and skips blank input', async () => {
    const f = dataRoutes();
    vi.stubGlobal('fetch', f);
    const s = renderHookWithProviders(() => useSymbolSearch(' a&b '));
    await waitFor(() => expect(s.result.current.data?.results).toHaveLength(1));
    expect(f.calls[0].url).toContain('/api/search?q=a%26b');
    expect(renderHookWithProviders(() => useSymbolSearch('  ')).result.current.data).toBeUndefined();
  });
  it('useProviders', async () => {
    vi.stubGlobal('fetch', dataRoutes());
    const p = renderHookWithProviders(() => useProviders());
    await waitFor(() => expect(p.result.current?.news).toBe(true));
  });

  it('useScanner toasts only for NEW actionable signals, never on first load', async () => {
    let snap = snapshot();
    vi.stubGlobal('fetch', routeFetch([['/api/scanner', () => json(snap)]]));
    const { result } = renderHookWithProviders(() => useScanner());
    await waitFor(() => expect(result.current.data?.status).toBe('ready'));
    expect(toast.info).not.toHaveBeenCalled();
    snap = snapshot({ generatedAt: '2026-09-27T06:00:00Z', signals: [...snap.signals, signal({ ticker: 'AMD', classification: 'WATCH' })] });
    await act(async () => { await result.current.mutate(); });
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith('New scanner signal: AMD WATCH', expect.anything());
  });

  it('useTickerAnalysis / usePerformance only fetch when enabled', async () => {
    const f = routeFetch([[/.*/, () => json({})]]);
    vi.stubGlobal('fetch', f);
    renderHookWithProviders(() => useTickerAnalysis(null));
    renderHookWithProviders(() => usePerformance(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(f.calls).toHaveLength(0);
    renderHookWithProviders(() => useTickerAnalysis('AAPL'));
    renderHookWithProviders(() => usePerformance(true));
    await waitFor(() => expect(f.calls.map((c) => new URL(c.url).pathname).sort()).toEqual(['/api/scanner/analysis/AAPL', '/api/scanner/performance']));
  });
});

describe('useNotifications', () => {
  const settings = { push: { configured: true, publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' }, subscriptions: 0, signals: false, owner: false, ownerAvailable: true, ownerChannels: null };

  function stubPush(existing: PushSubscription | null = null) {
    const sub = { endpoint: 'https://fcm.googleapis.com/x', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn(async () => true) } as unknown as PushSubscription;
    const pushManager = { getSubscription: vi.fn(async () => existing), subscribe: vi.fn(async () => sub) };
    const reg = { pushManager };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn(async () => reg), ready: Promise.resolve(reg) } });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', Object.assign(class {}, { permission: 'default', requestPermission: vi.fn(async () => 'granted') }));
    return { sub, pushManager };
  }

  it('enables push, toggles signals, unlocks owner and sends a test', async () => {
    const { pushManager } = stubPush();
    let s = { ...settings };
    const f = routeFetch([
      ['/api/notifications/subscribe', (_u, init) => { s = { ...s, subscriptions: init?.method === 'DELETE' ? 0 : 1 }; return json({ ok: true }); }],
      ['/api/notifications/owner', (_u, init) => {
        if (init?.method === 'DELETE') { s = { ...s, owner: false }; return json({ ok: true }); }
        return JSON.parse(init!.body as string).key === 'right-key-123' ? (s = { ...s, owner: true }, json({ ok: true })) : json({ error: 'invalid_key', message: 'Wrong owner key' }, 403);
      }],
      ['/api/notifications/test', () => json({ results: [{ channel: 'push', ok: true }] })],
      ['/api/notifications', (_u, init) => {
        if (init?.method === 'PATCH') { s = { ...s, ...JSON.parse(init.body as string) }; return json({ ok: true }); }
        return json(s);
      }],
    ]);
    vi.stubGlobal('fetch', f);
    const { result } = renderHookWithProviders(() => useNotifications());
    await waitFor(() => expect(result.current.settings).toBeTruthy());
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.supported).toBe(true);
    expect(result.current.subscribed).toBe(false);
    await act(async () => { await result.current.enablePush(); });
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }));
    expect(result.current.subscribed).toBe(true);
    await act(async () => { await result.current.setSignals(true); });
    expect(result.current.settings?.signals).toBe(true);
    await expect(act(() => result.current.unlockOwner('wrong'))).rejects.toThrow('Wrong owner key');
    await act(async () => { await result.current.unlockOwner('right-key-123'); });
    expect(result.current.settings?.owner).toBe(true);
    expect(await result.current.sendTest()).toEqual([{ channel: 'push', ok: true }]);
    await act(async () => { await result.current.leaveOwner(); });
    await act(async () => { await result.current.disablePush(); });
    expect(result.current.subscribed).toBe(false);
  });

  it('refuses to enable when permission is denied or push is unconfigured', async () => {
    stubPush();
    (Notification as unknown as { requestPermission: () => Promise<string> }).requestPermission = async () => 'denied';
    vi.stubGlobal('fetch', routeFetch([['/api/notifications', () => json(settings)]]));
    const { result } = renderHookWithProviders(() => useNotifications());
    await waitFor(() => expect(result.current.settings).toBeTruthy());
    await expect(result.current.enablePush()).rejects.toThrow(/blocked/);
    vi.stubGlobal('fetch', routeFetch([['/api/notifications', () => json({ ...settings, push: { configured: false, publicKey: null } })]]));
    const r2 = renderHookWithProviders(() => useNotifications());
    await waitFor(() => expect(r2.result.current.settings).toBeTruthy());
    await expect(r2.result.current.enablePush()).rejects.toThrow(/not configured/);
  });

  it('re-registers a browser subscription the server lost', async () => {
    const { sub } = stubPush();
    stubPush(sub);
    const f = routeFetch([['/api/notifications/subscribe', () => json({ ok: true })], ['/api/notifications', () => json(settings)]]);
    vi.stubGlobal('fetch', f);
    renderHookWithProviders(() => useNotifications());
    await waitFor(() => expect(f.calls.some((c) => c.url.includes('/subscribe'))).toBe(true));
  });

  it('flags iPhone Safari outside the Home Screen', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    vi.stubGlobal('fetch', routeFetch([['/api/notifications', () => json(settings)]]));
    const { result } = renderHookWithProviders(() => useNotifications());
    expect(result.current.iosNeedsInstall).toBe(true);
  });
});
