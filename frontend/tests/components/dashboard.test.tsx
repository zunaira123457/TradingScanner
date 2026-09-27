// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { charts, markerSets, resetCharts, type MockChart } from '../stubs/lightweightCharts';
import { StockChart } from '@/components/charts/StockChart';
import { ChartPanel } from '@/components/dashboard/ChartPanel';
import { CompareView } from '@/components/dashboard/CompareView';
import { Dashboard } from '@/components/dashboard/Dashboard';
import Home from '@/app/page';
import RootError from '@/app/error';
import Loading from '@/app/loading';
import { Providers as AppProviders } from '@/app/providers';
import { analysis, candles, FakeEventSource, json, quote, routeFetch, signal, snapshot, type Route } from '../fixtures';
import { Providers, renderWithProviders } from '../render';
import type { IndicatorKey } from '@/components/charts/TechnicalIndicators';
import type { PriceAlert } from '@/lib/types';

vi.mock('lightweight-charts', () => import('../stubs/lightweightCharts'));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast, Toaster: () => null }));

const frame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
const last = (): MockChart => charts[charts.length - 1];
const byType = (c: MockChart, t: string) => c.series.filter((s) => s.type === t);

beforeEach(() => {
  resetCharts();
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.values(toast).forEach((f) => f.mockClear());
});

describe('StockChart', () => {
  const props = { interval: '1d' as const, priceLines: [], markers: [], theme: 'dark' as const, resetKey: 'AAPL:1d' };

  it('renders 500 bars with every indicator in the right panes, and frames the last 150 bars', async () => {
    const data = candles(500);
    const all = new Set<IndicatorKey>(['vol', 'sma20', 'ema50', 'bb', 'rsi', 'macd']);
    renderWithProviders(<StockChart {...props} candles={data} indicators={all} />);
    await frame();
    const c = last();
    expect(byType(c, 'Candlestick')).toHaveLength(1);
    expect(byType(c, 'Line')).toHaveLength(8); // sma, ema, 3×bb, rsi, macd, signal
    expect(byType(c, 'Histogram')).toHaveLength(2); // volume + macd hist
    expect(c.series.find((s) => s.type === 'Line' && s.pane === 1)).toBeTruthy(); // RSI pane
    expect(c.series.filter((s) => s.pane === 2)).toHaveLength(3); // MACD pane
    expect(byType(c, 'Candlestick')[0].setData).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ time: data[0].time })]));
    expect(byType(c, 'Candlestick')[0].setData.mock.calls.at(-1)![0]).toHaveLength(500);
    expect(c.timeScaleApi.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 350, to: 505 });
    expect(screen.getByRole('img', { name: 'Candlestick price chart' })).toBeInTheDocument();
    expect(screen.getByText(`$${data.at(-1)!.open.toFixed(2)}`)).toBeInTheDocument(); // OHLC legend
  });

  it('live tick on the last bar uses the fast update path (no full re-render)', async () => {
    const data = candles(200);
    const { rerender } = renderWithProviders(<StockChart {...props} candles={data} indicators={new Set(['vol'])} />);
    await frame();
    const cs = byType(last(), 'Candlestick')[0];
    const fullRenders = cs.setData.mock.calls.length;
    const bumped = [...data.slice(0, -1), { ...data.at(-1)!, close: data.at(-1)!.close + 1 }];
    rerender(<StockChart {...props} candles={bumped} indicators={new Set(['vol'])} />);
    expect(cs.update).toHaveBeenCalledTimes(1);
    expect(cs.setData.mock.calls.length).toBe(fullRenders);
    const appended = [...bumped, { ...bumped.at(-1)!, time: bumped.at(-1)!.time + 86_400 }];
    rerender(<StockChart {...props} candles={appended} indicators={new Set(['vol'])} />);
    expect(cs.update).toHaveBeenCalledTimes(2);
  });

  it('re-frames on symbol change, draws price lines + markers, clears on empty data, cleans up on unmount', async () => {
    const data = candles(300);
    const lines = [{ price: 110, title: 'Entry', tone: 'accent' as const, style: 'solid' as const }, { price: 90, title: 'Stop', tone: 'down' as const }];
    const markers = [{ time: data[10].time, text: 'BUY', tone: 'up' as const, position: 'belowBar' as const }, { time: 1, text: 'orphan', tone: 'up' as const, position: 'aboveBar' as const }];
    const { rerender, unmount } = renderWithProviders(<StockChart {...props} candles={data} indicators={new Set()} priceLines={lines} markers={markers} />);
    await frame();
    const c = last();
    const cs = byType(c, 'Candlestick')[0];
    expect(cs.createPriceLine).toHaveBeenCalledTimes(2);
    expect(markerSets.at(-1)).toEqual([expect.objectContaining({ text: 'BUY', shape: 'arrowUp' })]);
    rerender(<StockChart {...props} resetKey="MSFT:1d" candles={candles(300, { base: 300 })} indicators={new Set()} priceLines={[]} markers={[]} />);
    expect(c.timeScaleApi.setVisibleLogicalRange).toHaveBeenCalledTimes(2);
    expect(cs.removePriceLine).toHaveBeenCalledTimes(2);
    rerender(<StockChart {...props} resetKey="MSFT:1d" candles={[]} indicators={new Set()} priceLines={[]} markers={[]} />);
    expect(cs.setData).toHaveBeenLastCalledWith([]);
    unmount();
    expect(c.removed).toBe(true);
  });

  it('crosshair legend follows the hovered bar', async () => {
    const data = candles(50);
    renderWithProviders(<StockChart {...props} candles={data} indicators={new Set(['vol'])} />);
    await frame();
    const c = last();
    const cs = byType(c, 'Candlestick')[0];
    const vol = byType(c, 'Histogram')[0];
    act(() => c.crosshair!({ time: 1, seriesData: new Map<unknown, unknown>([[cs, { open: 1, high: 2, low: 0.5, close: 1.5 }], [vol, { value: 1234 }]]) }));
    expect(screen.getByText('$2.00')).toBeInTheDocument();
    expect(screen.getByText('1.23K')).toBeInTheDocument();
    act(() => c.crosshair!({ time: undefined, seriesData: new Map() }));
    act(() => c.crosshair!({ time: 2, seriesData: new Map() }));
  });

  it('intraday axis options are applied', async () => {
    renderWithProviders(<StockChart {...props} interval="5m" candles={candles(20, { step: 300 })} indicators={new Set()} />);
    await frame();
    const opts = last().applyOptions.mock.calls.map((c) => c[0]).find((o) => o.timeScale?.tickMarkFormatter);
    expect(opts.timeScale.timeVisible).toBe(true);
    expect(opts.timeScale.tickMarkFormatter(Date.UTC(2026, 8, 25, 14, 30) / 1000, 3)).toBe('10:30');
    expect(opts.localization.timeFormatter(Date.UTC(2026, 8, 25, 14, 30) / 1000)).toBe('Sep 25 10:30 ET');
    const daily = render(<StockChart {...props} candles={candles(20)} indicators={new Set()} />, { wrapper: Providers });
    await frame();
    const d = last().applyOptions.mock.calls.map((c) => c[0]).find((o) => o.timeScale?.tickMarkFormatter);
    const t = Date.UTC(2026, 0, 1) / 1000;
    expect([d.timeScale.tickMarkFormatter(t, 0), d.timeScale.tickMarkFormatter(t, 1), d.timeScale.tickMarkFormatter(t, 2)]).toEqual(['2026', 'Jan', 'Jan 1']);
    daily.unmount();
  });
});

describe('ChartPanel', () => {
  const base = {
    symbol: 'AAPL',
    interval: '1d' as const,
    onIntervalChange: vi.fn(),
    alerts: [{ id: 'x', symbol: 'AAPL', condition: 'price_above', threshold: 400, createdAt: 1, status: 'active' }] as PriceAlert[],
    indicators: new Set<IndicatorKey>(['vol']),
    onToggleIndicator: vi.fn(),
  };
  const series = candles(120, { start: Date.UTC(2026, 3, 1) / 1000 });
  const candleRoute = (over: object = {}): Route => ['/api/candles', (u) => json({ symbol: u.searchParams.get('symbol'), interval: u.searchParams.get('interval'), candles: series, source: 'twelvedata', fetchedAt: Date.now(), ...over })];

  it('loads candles, overlays signal/levels/alerts and switches intervals', async () => {
    vi.stubGlobal('fetch', routeFetch([candleRoute()]));
    const sig = signal({ ticker: 'AAPL', asOf: new Date(series[100].time * 1000).toISOString() });
    renderWithProviders(<ChartPanel {...base} signal={sig} analysis={analysis('AAPL')} quote={quote('AAPL', { timestamp: (series.at(-1)!.time + 3600) * 1000 })} />);
    expect(screen.getByText('Loading AAPL · 1D')).toBeInTheDocument();
    await screen.findByRole('img', { name: 'Candlestick price chart' });
    await frame();
    const cs = byType(last(), 'Candlestick')[0];
    await waitFor(() => expect(cs.createPriceLine.mock.calls.map((c) => c[0].title)).toEqual(expect.arrayContaining(['Entry', 'Stop', 'Target', '🔔'])));
    await userEvent.click(screen.getByRole('button', { name: 'levels' }));
    await waitFor(() => expect(cs.createPriceLine.mock.calls.map((c) => c[0].title)).toContain('R 20d'));
    await userEvent.click(screen.getByRole('button', { name: 'signal' }));
    await userEvent.click(screen.getByRole('radio', { name: '1H' }));
    expect(base.onIntervalChange).toHaveBeenCalledWith('1h');
    await userEvent.click(screen.getByRole('button', { name: 'RSI' }));
    expect(base.onToggleIndicator).toHaveBeenCalledWith('rsi');
    expect(markerSets.some((m) => m.length === 0 || m.length === 1)).toBe(true);
  });

  it('shows stale-cache badge and error states', async () => {
    vi.stubGlobal('fetch', routeFetch([candleRoute({ stale: true, fetchedAt: Date.now() - 120_000 })]));
    const { unmount } = renderWithProviders(<ChartPanel {...base} />);
    expect(await screen.findByText(/Cached 2m ago — rate limit reached/)).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', routeFetch([['/api/candles', () => json({ error: 'upstream_error', message: 'twelvedata: **symbol** not found' }, 404)]]));
    renderWithProviders(<ChartPanel {...base} symbol="ZZZZ" />);
    expect(await screen.findByText('Couldn’t load chart data')).toBeInTheDocument();
  });

  it('ignores stale responses for a previous symbol during rapid switching', async () => {
    const slow = vi.fn();
    vi.stubGlobal('fetch', routeFetch([['/api/candles', async (u) => {
      const s = u.searchParams.get('symbol');
      if (s === 'AAPL') await new Promise((r) => setTimeout(r, 50));
      slow(s);
      return json({ symbol: s, interval: '1d', candles: candles(30, { base: s === 'AAPL' ? 100 : 500 }), source: 'twelvedata', fetchedAt: Date.now() });
    }]]));
    const { rerender } = renderWithProviders(<ChartPanel {...base} />);
    rerender(<ChartPanel {...base} symbol="MSFT" />);
    await waitFor(() => expect(slow).toHaveBeenCalledWith('AAPL'));
    await frame();
    const cs = byType(last(), 'Candlestick')[0];
    const lastData = cs.setData.mock.calls.at(-1)![0] as { close: number }[];
    expect(lastData[0].close).toBeGreaterThan(400); // MSFT series, never AAPL's late response
  });
});

describe('CompareView', () => {
  it('compares vs SPY, adds/removes symbols, validates input and survives a failing symbol', async () => {
    vi.stubGlobal('fetch', routeFetch([
      ['symbol=BAD', () => json({ error: 'upstream_error', message: 'not found' }, 404)],
      ['/api/candles', (u) => json({ symbol: u.searchParams.get('symbol'), interval: '1d', candles: candles(200), source: 'twelvedata', fetchedAt: 1 })],
    ]));
    renderWithProviders(<CompareView base="AAPL" candidates={['AAPL', 'MSFT']} />);
    expect(await screen.findByText('SPY')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/%$/).length).toBeGreaterThanOrEqual(3));
    await frame();
    await waitFor(() => expect(byType(last(), 'Line')).toHaveLength(3));
    const input = screen.getByRole('textbox', { name: 'Add symbol to comparison' });
    await userEvent.type(input, 'bad{Enter}');
    expect(await screen.findByText('unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add symbol to comparison' })).not.toBeInTheDocument(); // 4 max
    await userEvent.click(screen.getByRole('button', { name: 'Remove BAD from comparison' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Add symbol to comparison' }), '$$${Enter}');
    expect(screen.queryByText('$$$')).not.toBeInTheDocument();
  });
});

describe('Dashboard (full composition)', () => {
  let alertsServer: PriceAlert[];
  function routes(extra: Partial<{ scanner: boolean }> = {}): Route[] {
    return [
      ['/api/health', () => json({ status: 'ok', providers: { quotes: 'twelvedata', candles: 'twelvedata', news: false, scanner: extra.scanner ?? true } })],
      ['/api/quotes', (u) => json({ quotes: u.searchParams.get('symbols')!.split(',').map((s, i) => quote(s, { price: 100 + i })), missing: [] })],
      ['/api/candles', (u) => json({ symbol: u.searchParams.get('symbol'), interval: u.searchParams.get('interval'), candles: candles(120), source: 'twelvedata', fetchedAt: Date.now() })],
      ['/api/scanner/analysis', (u) => json(analysis(u.pathname.split('/').pop()!))],
      ['/api/scanner', () => json(snapshot())],
      ['/api/news', () => json({ error: 'not_configured', message: 'Finnhub is not configured — set FINNHUB_API_KEY' }, 503)],
      [/\/api\/alerts\/?[^?]*$/, (_u, init) => {
        if (init?.method === 'POST') {
          const a = { id: `a${alertsServer.length}`, createdAt: Date.now(), status: 'active', ...JSON.parse(init.body as string) };
          alertsServer.unshift(a);
          return json({ alert: a }, 201);
        }
        return json({ alerts: alertsServer });
      }],
      ['/api/notifications', () => json({ push: { configured: false, publicKey: null }, subscriptions: 0, signals: false, owner: false, ownerAvailable: false, ownerChannels: null })],
    ];
  }
  beforeEach(() => {
    alertsServer = [];
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('boots, streams prices, and supports every keyboard shortcut', async () => {
    vi.stubGlobal('fetch', routeFetch(routes()));
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);
    await waitFor(() => expect(FakeEventSource.open).toHaveLength(1));
    const es = FakeEventSource.open[0];
    expect(es.url).toContain('focus=AAPL');
    act(() => es.emit('ready', {}));
    act(() => es.emit('quotes', [quote('AAPL', { price: 222.22, timestamp: Date.now() + 1000, fetchedAt: Date.now() + 1000 })]));
    expect((await screen.findAllByText('$222.22')).length).toBeGreaterThan(0);

    await user.keyboard('j');
    expect(await screen.findByRole('heading', { name: 'MSFT' })).toBeInTheDocument();
    await user.keyboard('k');
    expect(await screen.findByRole('heading', { name: 'AAPL' })).toBeInTheDocument();
    await user.keyboard('{ArrowUp}');
    expect(await screen.findByRole('heading', { name: 'JPM' })).toBeInTheDocument(); // wraps
    await user.keyboard('{ArrowDown}');
    await user.keyboard('5');
    expect(screen.getByRole('radio', { name: '1D' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('/');
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('j'); // typing in an input must not trigger shortcuts
    expect(screen.getByRole('heading', { name: 'AAPL' })).toBeInTheDocument();
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('?');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.keyboard('n');
    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.keyboard('t');
    await user.keyboard('a');
    const dialog = await screen.findByRole('dialog', { name: /New alert · AAPL/ });
    await user.click(within(dialog).getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alert created', expect.anything()));
    expect(alertsServer).toHaveLength(1);
  });

  it('only one live stream exists after rapid stock switching', async () => {
    vi.stubGlobal('fetch', routeFetch(routes()));
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);
    await waitFor(() => expect(FakeEventSource.open).toHaveLength(1));
    for (let i = 0; i < 25; i++) await user.keyboard('j');
    await waitFor(() => expect(FakeEventSource.open[0]?.url).toContain('focus=META'));
    expect(FakeEventSource.open).toHaveLength(1);
    expect(FakeEventSource.instances.length).toBeLessThan(10); // debounced, not one per keypress
    expect(screen.getByRole('heading', { name: 'META' })).toBeInTheDocument(); // 25 steps through 10 names → index 5
  });

  it('deep link ?symbol= selects the stock and tidies the URL', async () => {
    window.history.replaceState(null, '', '/?symbol=nvda&x=1');
    vi.stubGlobal('fetch', routeFetch(routes()));
    renderWithProviders(<Dashboard />);
    expect(await screen.findByRole('heading', { name: 'NVDA' })).toBeInTheDocument();
    expect(window.location.search).toBe('?x=1');
  });

  it('ignores a malicious deep link', async () => {
    window.history.replaceState(null, '', '/?symbol=%3Cscript%3E');
    vi.stubGlobal('fetch', routeFetch(routes()));
    renderWithProviders(<Dashboard />);
    await screen.findAllByRole('heading');
    expect(screen.queryByRole('heading', { name: /script/i })).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('tabs render their panels; scanner-less deployments get setup guidance', async () => {
    vi.stubGlobal('fetch', routeFetch(routes({ scanner: false })));
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('AI scanner not connected')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /News/ }));
    expect(await screen.findByText('News not configured')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Heatmap/ }));
    expect(await screen.findByText(/Colour saturates at ±4%/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Alerts/ }));
    expect(await screen.findByText('No alerts yet')).toBeInTheDocument();
  });

  it('watchlist add/remove persists across reloads', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/search', () => json({ results: [{ symbol: 'PLTR', description: 'Palantir' }] })], ...routes()]));
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<Dashboard />);
    await user.type(await screen.findByRole('combobox'), 'pltr');
    await user.click(await screen.findByText('Palantir'));
    expect(await screen.findByRole('heading', { name: 'PLTR' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove from watchlist' }));
    await user.click(screen.getByRole('button', { name: 'Add to watchlist' }));
    unmount();
    renderWithProviders(<Dashboard />);
    const list = await screen.findByRole('list', { name: 'Watchlist symbols' });
    expect(within(list).getByText('PLTR')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PLTR' })).toBeInTheDocument(); // selection persisted too
  });
});

describe('app shell', () => {
  it('page, loading, error boundary and providers render', async () => {
    // Reverse proxy down mid-deploy: every endpoint returns a 502 HTML page.
    vi.stubGlobal('fetch', routeFetch([[/.*/, () => new Response('<html>502 Bad Gateway</html>', { status: 502 })]]));
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onErr);
    const { unmount } = render(<AppProviders><Home /></AppProviders>);
    expect(await screen.findByText('Trading Desk')).toBeInTheDocument();
    expect(await screen.findByText('Couldn’t load ai scanner')).toBeInTheDocument();
    window.removeEventListener('error', onErr);
    expect(errors).toEqual([]);
    unmount();
    render(<Loading />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    const retry = vi.fn();
    render(<RootError error={new Error('')} retry={retry} />);
    expect(screen.getByText('The dashboard hit an unexpected error.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
