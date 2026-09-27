// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertDialog, AlertsPanel } from '@/components/dashboard/AlertsPanel';
import { SymbolSearch } from '@/components/dashboard/SymbolSearch';
import { WatchlistSection } from '@/components/dashboard/WatchlistSection';
import { PriceTicker } from '@/components/dashboard/PriceTicker';
import { NewsFeed } from '@/components/dashboard/NewsFeed';
import { Heatmap } from '@/components/dashboard/Heatmap';
import { MarketOverview, INDEX_ETFS } from '@/components/dashboard/MarketOverview';
import { ScannerResults } from '@/components/ai/ScannerResults';
import { TrackRecord } from '@/components/ai/TrackRecord';
import { AIInsights } from '@/components/ai/AIInsights';
import { ErrorState, LoadingState, StateMessage } from '@/components/common/StateMessage';
import { PanelBoundary } from '@/components/common/ErrorBoundary';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { ShortcutsDialog } from '@/components/common/ShortcutsDialog';
import { NotificationsDialog } from '@/components/common/NotificationsDialog';
import { Navbar } from '@/components/common/Navbar';
import { IndicatorToggles } from '@/components/charts/TechnicalIndicators';
import { FetchError } from '@/lib/fetcher';
import { analysis, json, news, performance, quote, routeFetch, signal, snapshot } from '../fixtures';
import { renderWithProviders } from '../render';
import type { PriceAlert } from '@/lib/types';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast, Toaster: () => null }));

beforeEach(() => Object.values(toast).forEach((f) => f.mockClear()));

describe('AlertDialog (form validation)', () => {
  it('prefills +2% from the live price, validates and submits', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(<AlertDialog open onOpenChange={onOpenChange} symbol="AAPL" quote={quote()} onCreate={onCreate} />);
    const price = screen.getByRole('textbox', { name: /price \(usd\)/i });
    expect(price).toHaveValue('347.89');
    await user.clear(price);
    await user.type(price, '300');
    await user.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Already above — current price is $341.07');
    expect(onCreate).not.toHaveBeenCalled();
    await user.clear(price);
    await user.type(price, 'abc');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number');
    await user.clear(price);
    await user.type(price, '350');
    await user.type(screen.getByPlaceholderText(/breakout/), 'my note');
    await user.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(onCreate).toHaveBeenCalledWith('AAPL', 'price_above', 350, 'my note');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('switches to % conditions with sensible defaults and a note length cap', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(<AlertDialog open onOpenChange={() => {}} symbol="TSLA" onCreate={onCreate} />);
    expect(screen.getByRole('textbox', { name: /price/i })).toHaveValue(''); // no quote → no guess
    await user.selectOptions(screen.getByRole('combobox'), 'change_pct_below');
    const pct = screen.getByRole('textbox', { name: /percent change/i });
    expect(pct).toHaveValue('-3');
    expect(screen.getByPlaceholderText(/breakout/)).toHaveAttribute('maxLength', '80');
    await user.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(onCreate).toHaveBeenCalledWith('TSLA', 'change_pct_below', -3, '');
  });

  it('cancel closes without creating', async () => {
    const onOpenChange = vi.fn();
    const onCreate = vi.fn();
    renderWithProviders(<AlertDialog open onOpenChange={onOpenChange} symbol="AAPL" onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('AlertsPanel', () => {
  const alerts: PriceAlert[] = [
    { id: 'a', symbol: 'AAPL', condition: 'price_above', threshold: 350, note: 'breakout', createdAt: Date.now(), status: 'active' },
    { id: 'b', symbol: 'MSFT', condition: 'change_pct_above', threshold: 3, createdAt: Date.now(), status: 'active' },
    { id: 'c', symbol: 'NVDA', condition: 'price_below', threshold: 100, createdAt: 1, status: 'triggered', triggeredAt: Date.now(), triggeredPrice: 99.5 },
  ];
  it('shows an empty state with a create link', async () => {
    const onNew = vi.fn();
    renderWithProviders(<AlertsPanel alerts={[]} quotes={{}} onRemove={vi.fn()} onRearm={vi.fn()} onClearTriggered={vi.fn()} onSelect={vi.fn()} onNew={onNew} />);
    await userEvent.click(screen.getByRole('button', { name: 'create one' }));
    expect(onNew).toHaveBeenCalled();
  });
  it('lists active + history with distance, and wires every action', async () => {
    const h = { onRemove: vi.fn(), onRearm: vi.fn(), onClearTriggered: vi.fn(), onSelect: vi.fn(), onNew: vi.fn() };
    renderWithProviders(<AlertsPanel alerts={alerts} quotes={{ AAPL: quote() }} {...h} />);
    expect(screen.getByText(/2\.62% away/)).toBeInTheDocument();
    expect(screen.getByText(/breakout/)).toBeInTheDocument();
    expect(screen.getByText('$99.50')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /delete alert aapl/i }));
    expect(h.onRemove).toHaveBeenCalledWith('a');
    await userEvent.click(screen.getByRole('button', { name: /re-arm alert/i }));
    expect(h.onRearm).toHaveBeenCalledWith('c');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(h.onClearTriggered).toHaveBeenCalled();
    await userEvent.click(screen.getByText('NVDA · Price falls below $100.00'));
    expect(h.onSelect).toHaveBeenCalledWith('NVDA');
  });
  it('shows placeholders when one column is empty', () => {
    renderWithProviders(<AlertsPanel alerts={[alerts[2]]} quotes={{}} onRemove={vi.fn()} onRearm={vi.fn()} onClearTriggered={vi.fn()} onSelect={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText('No active alerts.')).toBeInTheDocument();
  });
});

describe('SymbolSearch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', routeFetch([
      ['q=ZZZ', () => json({ results: [] })],
      ['q=ERR', () => json({ error: 'upstream_error' }, 502)],
      ['/api/search', () => json({ results: [{ symbol: 'AAPL', description: 'Apple Inc' }, { symbol: 'AAPB', description: 'GraniteShares 2x' }] })],
    ]));
  });
  it('debounces, navigates with arrows and picks with Enter', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithProviders(<SymbolSearch onPick={onPick} />);
    const box = screen.getByRole('combobox');
    await user.type(box, 'aap');
    await screen.findByText('Apple Inc');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledWith('AAPB');
    expect(box).toHaveValue('');
  });
  it('click picks; Escape closes', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithProviders(<SymbolSearch onPick={onPick} />);
    await user.type(screen.getByRole('combobox'), 'aap');
    await user.click(await screen.findByText('Apple Inc'));
    expect(onPick).toHaveBeenCalledWith('AAPL');
    await user.type(screen.getByRole('combobox'), 'aap');
    await screen.findByText('Apple Inc');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Apple Inc')).not.toBeInTheDocument());
  });
  it('shows "no match" for invalid symbols and still allows adding a valid-looking ticker', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithProviders(<SymbolSearch onPick={onPick} />);
    await user.type(screen.getByRole('combobox'), 'ZZZ');
    await screen.findByText('No US stocks match');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('ZZZ');
    await user.type(screen.getByRole('combobox'), '$$$ bad');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1); // invalid input rejected
  });
  it('degrades gracefully when search is down', async () => {
    renderWithProviders(<SymbolSearch onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'ERR');
    expect(await screen.findByText(/Search unavailable/)).toBeInTheDocument();
  });
  it('is disabled when the watchlist is full', () => {
    renderWithProviders(<SymbolSearch onPick={vi.fn()} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByPlaceholderText('Watchlist full (20)')).toBeInTheDocument();
  });
});

describe('WatchlistSection', () => {
  const base = {
    symbols: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
    quotes: { AAPL: quote('AAPL', { changePercent: 1 }), MSFT: quote('MSFT', { changePercent: 3, price: 516.17 }), TSLA: quote('TSLA', { changePercent: -2 }) },
    errors: { NVDA: 'not found' },
    selected: 'AAPL',
    signalsByTicker: new Map([['MSFT', signal({ ticker: 'MSFT', classification: 'WATCH' })], ['TSLA', signal({ ticker: 'TSLA', classification: 'AVOID' })]]),
    full: false,
  };
  const rows = () => within(screen.getByRole('list', { name: 'Watchlist symbols' })).getAllByRole('button').filter((b) => !b.getAttribute('aria-label')?.startsWith('Remove')).map((b) => b.querySelector('.num')!.textContent!);

  it('renders prices, errors, badges, selection; filters and sorts', async () => {
    const h = { onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() };
    renderWithProviders(<WatchlistSection {...base} {...h} />);
    expect(screen.getByText('$516.17')).toBeInTheDocument();
    expect(screen.getByText('unavailable')).toHaveAttribute('title', 'not found');
    expect(screen.getByText('WATCH')).toBeInTheDocument();
    expect(screen.queryByText('AVOID')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'true')!.textContent).toMatch(/^AAPL/);
    expect(rows()).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
    await userEvent.click(screen.getByRole('button', { name: 'My order' }));
    expect(rows()).toEqual(['MSFT', 'AAPL', 'TSLA', 'NVDA']);
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter watchlist' }), 'ts');
    expect(rows()).toEqual(['TSLA']);
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter watchlist' }), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('select and remove', async () => {
    const h = { onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() };
    renderWithProviders(<WatchlistSection {...base} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /^MSFT/ }));
    expect(h.onSelect).toHaveBeenCalledWith('MSFT');
    await userEvent.click(screen.getByRole('button', { name: 'Remove TSLA from watchlist' }));
    expect(h.onRemove).toHaveBeenCalledWith('TSLA');
  });

  it('flashes a row when the price ticks and shows the empty state', () => {
    const h = { onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() };
    const { rerender } = renderWithProviders(<WatchlistSection {...base} {...h} />);
    rerender(<WatchlistSection {...base} quotes={{ ...base.quotes, AAPL: quote('AAPL', { price: 342 }) }} {...h} />);
    expect(screen.getByText('$342.00')).toHaveClass('flash-up');
    rerender(<WatchlistSection {...base} quotes={{ ...base.quotes, AAPL: quote('AAPL', { price: 340 }) }} {...h} />);
    expect(screen.getByText('$340.00')).toHaveClass('flash-down');
    rerender(<WatchlistSection {...base} symbols={[]} {...h} />);
    expect(screen.getByText('Add a symbol to start')).toBeInTheDocument();
  });
});

describe('PriceTicker', () => {
  it('shows live quote stats, handles missing data and wires buttons', async () => {
    const onToggle = vi.fn();
    const onNewAlert = vi.fn();
    const { rerender } = renderWithProviders(<PriceTicker symbol="AAPL" quote={quote()} inWatchlist onToggleWatchlist={onToggle} onNewAlert={onNewAlert} />);
    expect(screen.getByText('$341.07')).toBeInTheDocument();
    expect(screen.getByText('+5.15 (+1.53%)')).toHaveClass('text-up');
    expect(screen.getByText('29.95M')).toBeInTheDocument();
    expect(screen.getByText('— / —')).toBeInTheDocument();
    expect(screen.getByText(/Last trade 03:59:00 PM ET/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove from watchlist' }));
    expect(onToggle).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /alert/i }));
    expect(onNewAlert).toHaveBeenCalled();
    rerender(<PriceTicker symbol="X" quote={quote('X', { change: -1, bid: 1, ask: 1.02, source: 'finnhub', volume: null })} inWatchlist={false} onToggleWatchlist={onToggle} onNewAlert={onNewAlert} />);
    expect(screen.getByText('$1.00 / $1.02')).toBeInTheDocument();
    expect(screen.getByText(/Finnhub/)).toBeInTheDocument();
    expect(screen.getByText(/-1.00/)).toHaveClass('text-down');
    rerender(<PriceTicker symbol="NEW" inWatchlist={false} onToggleWatchlist={onToggle} onNewAlert={onNewAlert} />);
    expect(screen.getByText('Waiting for first quote…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to watchlist' })).toBeInTheDocument();
  });
});

describe('StateMessage / ErrorState', () => {
  it.each([
    [new FetchError(503, { error: 'not_configured', message: 'Set FINNHUB_API_KEY' }), 'News not configured', 'Set FINNHUB_API_KEY'],
    [new FetchError(429, { error: 'rate_limited', retryAfter: 12 }), 'Free-tier rate limit reached', 'News will retry automatically in ~12s.'],
    [new FetchError(429, null), 'Free-tier rate limit reached', 'News will retry automatically.'],
    [new Error('boom'), 'Couldn’t load news', 'boom'],
    ['weird', 'Couldn’t load news', 'Unknown error'],
  ])('%s', (err, title, body) => {
    renderWithProviders(<ErrorState error={err} what="News" />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
  });
  it('LoadingState and StateMessage', () => {
    renderWithProviders(<><LoadingState label="Loading…" /><StateMessage title="T">child</StateMessage></>);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});

describe('NewsFeed', () => {
  it('lists headlines as safe external links', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/news', () => json({ symbol: 'AAPL', items: news(2) })]]));
    renderWithProviders(<NewsFeed symbol="AAPL" />);
    const link = (await screen.findByText('Headline 1')).closest('a')!;
    expect(link).toHaveAttribute('href', 'https://example.com/news/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getAllByText(/Reuters/)).toHaveLength(2);
  });
  it('empty, loading and not-configured states', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/news', () => json({ items: [] })]]));
    const { unmount } = renderWithProviders(<NewsFeed symbol="AAPL" />);
    expect(screen.getByText('Loading AAPL news…')).toBeInTheDocument();
    expect(await screen.findByText('No AAPL headlines in the last 7 days')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', routeFetch([['/api/news', () => json({ error: 'not_configured', message: 'Finnhub is not configured — set FINNHUB_API_KEY' }, 503)]]));
    renderWithProviders(<NewsFeed symbol="AAPL" />);
    expect(await screen.findByText('News not configured')).toBeInTheDocument();
  });
});

describe('Heatmap and MarketOverview', () => {
  it('sorts tiles by change and handles missing quotes', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<Heatmap symbols={['A', 'B', 'C', 'D']} quotes={{ A: quote('A', { changePercent: -5 }), B: quote('B', { changePercent: 6 }), D: quote('D', { changePercent: 0 }) }} onSelect={onSelect} />);
    const tiles = screen.getAllByRole('button');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['B +6.00%', 'D 0.00%', 'A -5.00%', 'C no data']);
    expect(screen.getByText('awaiting quote')).toBeInTheDocument();
    await userEvent.click(tiles[0]);
    expect(onSelect).toHaveBeenCalledWith('B');
  });
  it('labels index ETFs and selects on click', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<MarketOverview quotes={{ SPY: quote('SPY', { price: 771.35, changePercent: 0.54 }), QQQ: quote('QQQ', { changePercent: -0.2 }) }} symbols={Object.keys(INDEX_ETFS)} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /S&P 500/ })).toHaveTextContent('S&P 500$771.35+0.54%');
    expect(screen.getByText('-0.20%')).toHaveClass('text-down');
    await userEvent.click(screen.getByRole('button', { name: /Dow 30/ }));
    expect(onSelect).toHaveBeenCalledWith('DIA');
  });
});

describe('ScannerResults', () => {
  it('shows actionable setups, toggles to all tickers, selects and refreshes', async () => {
    const f = routeFetch([['/api/scanner/refresh', () => json({ status: 'started' }, 202)], ['/api/scanner', () => json(snapshot({ errors: [{ ticker: 'XYZ', message: 'no data' }], marketRegime: { label: 'bullish', compositeScore: 0.3, isHighVolatility: true } }))]]);
    vi.stubGlobal('fetch', f);
    const onSelect = vi.fn();
    renderWithProviders(<ScannerResults onSelect={onSelect} selected="NVDA" />);
    expect(await screen.findByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('BUY')).toBeInTheDocument();
    expect(screen.getByText('$180.50')).toBeInTheDocument();
    expect(screen.getByText('High vol')).toBeInTheDocument();
    expect(screen.getByText('1 tickers failed')).toBeInTheDocument();
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All tickers' }));
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('Rules passed')).toBeInTheDocument();
    await userEvent.click(screen.getByText('AAPL'));
    expect(onSelect).toHaveBeenCalledWith('AAPL');
    await userEvent.click(screen.getAllByRole('row')[2]);
    await userEvent.click(screen.getByRole('button', { name: 'Re-run scan' }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Re-scan started', expect.anything()));
  });

  it('explains an empty scan and a rate-limited refresh', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/refresh', () => json({ error: 'rate_limited' }, 429)], ['/api/scanner', () => json(snapshot({ signals: [signal({ classification: 'AVOID', ticker: 'MSFT' })] }))]]));
    renderWithProviders(<ScannerResults onSelect={vi.fn()} selected="AAPL" />);
    expect(await screen.findByText('No active setups in the latest scan')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Re-run scan' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Refresh is rate-limited — try again in a minute'));
    await userEvent.click(screen.getByRole('button', { name: 'All tickers', pressed: false }));
    expect(screen.getByText('MSFT')).toBeInTheDocument();
  });

  it('warming up and error states', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/scanner', () => json(snapshot({ status: 'warming', progress: { done: 12, total: 81 } }))]]));
    const { unmount } = renderWithProviders(<ScannerResults onSelect={vi.fn()} selected="AAPL" />);
    expect(await screen.findByText('Scanner warming up — 12/81 tickers loaded')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', routeFetch([['/api/scanner', () => json({ error: 'upstream_unreachable', message: 'Upstream service is unreachable' }, 502)]]));
    renderWithProviders(<ScannerResults onSelect={vi.fn()} selected="AAPL" />);
    expect(await screen.findByText('Upstream service is unreachable')).toBeInTheDocument();
  });
});

describe('TrackRecord', () => {
  it('shows forward results next to the backtest baseline', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/performance', () => json(performance())]]));
    renderWithProviders(<TrackRecord enabled />);
    expect(await screen.findByText('+0.50%')).toBeInTheDocument();
    expect(screen.getByText('Momentum continuation')).toBeInTheDocument();
    expect(screen.getByText('226')).toBeInTheDocument();
  });
  it('handles an uninitialised paper account and empty trades', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/performance', () => json({ ...performance(), config: null, equityCurve: [], trades: [] })]]));
    const { unmount } = renderWithProviders(<TrackRecord enabled />);
    expect(await screen.findByText(/hasn’t been initialised/)).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/performance', () => json({ ...performance(), trades: [], asOfDate: null })]]));
    renderWithProviders(<TrackRecord enabled />);
    expect(await screen.findByText(/No trades have closed yet/)).toBeInTheDocument();
  });
  it('shows an error state', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/performance', () => json({ error: 'upstream_error', message: 'scanner: HTTP 500' }, 502)]]));
    renderWithProviders(<TrackRecord enabled />);
    expect(await screen.findByText('scanner: HTTP 500')).toBeInTheDocument();
  });
});

describe('AIInsights', () => {
  it('shows scanner call, computed bias, cleaned AI text, levels, evidence and history', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/analysis/AAPL', () => json(analysis('AAPL', { signals: [signal({ ticker: 'AAPL' })] }))]]));
    renderWithProviders(<AIInsights symbol="AAPL" />);
    expect(await screen.findByText('AAPL is in an uptrend under the trend pullback strategy.')).toBeInTheDocument();
    expect(screen.getAllByText('Bullish').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('$172.25')).toBeInTheDocument(); // stop
    expect(screen.getByText('No pullback in progress')).toBeInTheDocument();
    expect(screen.getByText('Extended above SMA50')).toBeInTheDocument();
    expect(screen.getByText(/51\.1%/)).toBeInTheDocument();
    expect(screen.getByText(/\+20\.2%/)).toBeInTheDocument();
    expect(screen.queryByText(/mtfAligned|strategyWarnings/)).not.toBeInTheDocument();
  });
  it('uses the deterministic fallback and bearish/mixed bias', async () => {
    const a = analysis('TSLA', {
      multiTimeframe: { dailyTrend: 'bearish', weeklyTrend: 'bearish', aligned: true },
      relativeStrength: null,
      marketRegime: null,
      ai: null,
    });
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/analysis/TSLA', () => json(a)]]));
    const { unmount } = renderWithProviders(<AIInsights symbol="TSLA" />);
    expect(await screen.findByText('Bearish')).toBeInTheDocument();
    expect(screen.getByText('Rule evidence')).toBeInTheDocument();
    expect(screen.getByText(/No strategy triggered/)).toBeInTheDocument();
    unmount();
    const b = analysis('AMD', { multiTimeframe: { dailyTrend: 'bullish', weeklyTrend: 'bearish', aligned: false } });
    b.ai = { ...b.ai!, status: 'fallback', source: 'deterministic_fallback', reason: 'timeout' } as never;
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/analysis/AMD', () => json(b)]]));
    renderWithProviders(<AIInsights symbol="AMD" />);
    expect(await screen.findByText('Neutral / mixed')).toBeInTheDocument();
    expect(screen.getByText('Rule-based fallback')).toBeInTheDocument();
  });
  it('loading and error', async () => {
    vi.stubGlobal('fetch', routeFetch([['/api/scanner/analysis', () => json({ error: 'upstream_timeout', message: 'Upstream request timed out' }, 504)]]));
    renderWithProviders(<AIInsights symbol="AAPL" />);
    expect(screen.getByText(/can take ~20s/)).toBeInTheDocument();
    expect(await screen.findByText('Upstream request timed out')).toBeInTheDocument();
  });
});

describe('PanelBoundary', () => {
  it('contains a crashing widget and offers retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let crash = true;
    function Boom() {
      if (crash) throw new Error('widget exploded');
      return <p>recovered</p>;
    }
    renderWithProviders(<div><PanelBoundary label="Chart"><Boom /></PanelBoundary><p>sibling ok</p></div>);
    expect(screen.getByRole('alert')).toHaveTextContent('Chart failed to render');
    expect(screen.getByText('sibling ok')).toBeInTheDocument();
    crash = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('recovered')).toBeInTheDocument());
  });
});

describe('Navbar, theme and shortcuts', () => {
  it('shows feed status/provider and session, opens dialogs', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-25T11:00:00-04:00') });
    vi.stubGlobal('fetch', routeFetch([['/api/notifications', () => json({ push: { configured: false, publicKey: null }, subscriptions: 0, signals: false, owner: false, ownerAvailable: false, ownerChannels: null })]]));
    const onShortcuts = vi.fn();
    const onNotif = vi.fn();
    const { rerender } = renderWithProviders(
      <Navbar quotes={{}} indices={['SPY']} feedStatus="live" provider="finnhub" lastMessageAt={Date.now()} shortcutsOpen={false} onShortcutsOpenChange={onShortcuts} notificationsOpen={false} onNotificationsOpenChange={onNotif} onSelect={vi.fn()} />
    );
    expect(screen.getByText('Trading Desk')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(await screen.findByText('Market open')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(onShortcuts).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Notification settings' }));
    expect(onNotif).toHaveBeenCalledWith(true);
    for (const [status, label] of [['throttled', 'Throttled'], ['reconnecting', 'Reconnecting'], ['unconfigured', 'No data feed']] as const) {
      rerender(<Navbar quotes={{}} indices={[]} feedStatus={status} provider={null} lastMessageAt={null} shortcutsOpen={false} onShortcutsOpenChange={onShortcuts} notificationsOpen={false} onNotificationsOpenChange={onNotif} onSelect={vi.fn()} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    vi.useRealTimers();
  });

  it('theme toggle flips the theme', async () => {
    renderWithProviders(<ThemeToggle />);
    const btn = await screen.findByRole('button', { name: 'Switch to light theme' });
    await userEvent.click(btn);
    expect(await screen.findByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('shortcuts dialog lists every shortcut', () => {
    renderWithProviders(<ShortcutsDialog open onOpenChange={() => {}} />);
    for (const k of ['/', 'A', 'N', 'T', '?']) expect(screen.getByText(k)).toBeInTheDocument();
  });

  it('indicator toggles report pressed state', async () => {
    const onToggle = vi.fn();
    renderWithProviders(<IndicatorToggles enabled={new Set(['rsi'])} onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'RSI', pressed: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'MACD', pressed: false }));
    expect(onToggle).toHaveBeenCalledWith('macd');
  });
});

describe('NotificationsDialog', () => {
  const base = { push: { configured: true, publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' }, subscriptions: 0, signals: false, owner: false, ownerAvailable: true, ownerChannels: null as { email: boolean; telegram: boolean } | null };

  function stubBrowserPush(permission = 'default') {
    const sub = { endpoint: 'https://fcm.googleapis.com/x', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn(async () => true) };
    const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => sub) } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn(async () => reg), ready: Promise.resolve(reg) } });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', Object.assign(class {}, { permission, requestPermission: vi.fn(async () => 'granted') }));
  }

  it('enables push, unlocks owner (with error), shows channels and sends a test', async () => {
    stubBrowserPush();
    let s = { ...base };
    vi.stubGlobal('fetch', routeFetch([
      ['/api/notifications/subscribe', () => ((s = { ...s, subscriptions: 1 }), json({ ok: true }))],
      ['/api/notifications/owner', (_u, init) => JSON.parse(init!.body as string).key === 'right-key-123'
        ? ((s = { ...s, owner: true, signals: true, ownerChannels: { email: true, telegram: false } }), json({ ok: true }))
        : json({ error: 'invalid_key', message: 'Wrong owner key' }, 403)],
      ['/api/notifications/test', () => json({ results: [{ channel: 'push', ok: true }, { channel: 'email', ok: false, detail: 'bad creds' }] })],
      ['/api/notifications', () => json(s)],
    ]));
    const user = userEvent.setup();
    renderWithProviders(<NotificationsDialog open onOpenChange={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /enable/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Push enabled on this device'));
    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Owner key'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Wrong owner key')).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Owner key'));
    await user.type(screen.getByPlaceholderText('Owner key'), 'right-key-123');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText(/This browser is the site owner/)).toBeInTheDocument();
    expect(screen.getByText(/Telegram/)).toHaveTextContent('(not configured)');
    await user.click(screen.getByRole('button', { name: /send test/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Email: failed', { description: 'bad creds' }));
    expect(toast.success).toHaveBeenCalledWith('Push: sent');
  });

  it('explains blocked permission, missing VAPID and the iPhone install step', async () => {
    stubBrowserPush('denied');
    vi.stubGlobal('fetch', routeFetch([['/api/notifications', () => json(base)]]));
    const { unmount } = renderWithProviders(<NotificationsDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Notifications are blocked/)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
    unmount();
    vi.stubGlobal('fetch', routeFetch([['/api/notifications', () => json({ ...base, push: { configured: false, publicKey: null } })]]));
    const r2 = renderWithProviders(<NotificationsDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText(/npm run vapid/)).toBeInTheDocument();
    r2.unmount();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    vi.stubGlobal('fetch', routeFetch([['/api/notifications', () => json(base)]]));
    renderWithProviders(<NotificationsDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
  });

  it('toggles scanner signals for a subscribed owner and can leave owner mode', async () => {
    stubBrowserPush('granted');
    let s = { ...base, owner: true, signals: false, ownerChannels: { email: true, telegram: true } };
    vi.stubGlobal('fetch', routeFetch([
      ['/api/notifications/owner', () => ((s = { ...s, owner: false, ownerChannels: null as never }), json({ ok: true }))],
      ['/api/notifications/test', () => json({ results: [] })],
      ['/api/notifications', (_u, init) => (init?.method === 'PATCH' ? ((s = { ...s, ...JSON.parse(init.body as string) }), json({ ok: true })) : json(s))],
    ]));
    renderWithProviders(<NotificationsDialog open onOpenChange={() => {}} />);
    const sw = await screen.findByRole('switch');
    await userEvent.click(sw);
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(screen.getByRole('button', { name: /send test/i }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Nothing to send to yet', expect.anything()));
    await userEvent.click(screen.getByRole('button', { name: /stop using this browser/i }));
    expect(await screen.findByPlaceholderText('Owner key')).toBeInTheDocument();
  });
});

// Keep `act`/`fireEvent` referenced for ad-hoc debugging without lint noise.
void act;
void fireEvent;
