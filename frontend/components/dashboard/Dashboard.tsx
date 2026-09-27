'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Bell, FlaskConical, Grid3x3, LineChart, Newspaper, Radar } from 'lucide-react';
import { Navbar } from '@/components/common/Navbar';
import { PanelBoundary } from '@/components/common/ErrorBoundary';
import { WatchlistSection } from '@/components/dashboard/WatchlistSection';
import { PriceTicker } from '@/components/dashboard/PriceTicker';
import { ChartPanel } from '@/components/dashboard/ChartPanel';
import { AlertDialog, AlertsPanel } from '@/components/dashboard/AlertsPanel';
import { NewsFeed } from '@/components/dashboard/NewsFeed';
import { Heatmap } from '@/components/dashboard/Heatmap';
import { CompareView } from '@/components/dashboard/CompareView';
import { INDEX_ETFS } from '@/components/dashboard/MarketOverview';
import { ScannerResults } from '@/components/ai/ScannerResults';
import { AIInsights } from '@/components/ai/AIInsights';
import { TrackRecord } from '@/components/ai/TrackRecord';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { IndicatorKey } from '@/components/charts/TechnicalIndicators';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useProviders } from '@/hooks/useProviders';
import { useLivePrices } from '@/hooks/useLivePrices';
import { useAlerts } from '@/hooks/useAlerts';
import { useScanner, useTickerAnalysis } from '@/hooks/useScanner';
import { usePersistentState } from '@/hooks/usePersistentState';
import { describeAlert } from '@/lib/alerts';
import { INTERVALS, type AlertCondition, type Interval, type ScannerSignal } from '@/lib/types';

const INDICES = Object.keys(INDEX_ETFS);
const isInterval = (v: unknown): v is Interval => typeof v === 'string' && (INTERVALS as readonly string[]).includes(v);
const isIndicatorList = (v: unknown): v is IndicatorKey[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isSymbol = (v: unknown): v is string => typeof v === 'string' && /^[A-Z][A-Z0-9.]{0,5}$/.test(v);

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function Dashboard() {
  const watchlist = useWatchlist();
  const providers = useProviders();
  const [selected, setSelected] = usePersistentState<string>('sd.selected.v1', 'AAPL', isSymbol);
  const [interval, setInterval] = usePersistentState<Interval>('sd.interval.v1', '5m', isInterval);
  const [indicatorList, setIndicatorList] = usePersistentState<IndicatorKey[]>('sd.indicators.v1', ['vol', 'sma20', 'ema50'], isIndicatorList);
  const indicators = useMemo(() => new Set(indicatorList), [indicatorList]);
  const [tab, setTab] = useState('scanner');
  const [alertOpen, setAlertOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { resolvedTheme, setTheme } = useTheme();

  // Stream: watchlist + index ETFs + whatever is on the chart.
  const streamSymbols = useMemo(
    () => [...new Set([selected, ...watchlist.symbols, ...INDICES])].slice(0, 30),
    [selected, watchlist.symbols]
  );
  const live = useLivePrices(watchlist.hydrated ? streamSymbols : [], selected, providers);
  const alerts = useAlerts(live.quotes);
  const scanner = useScanner();
  const analysis = useTickerAnalysis(providers?.scanner ? selected : null);

  // Best actionable signal per ticker, for badges and chart overlays.
  const signalsByTicker = useMemo(() => {
    const m = new Map<string, ScannerSignal>();
    for (const s of scanner.data?.signals ?? []) {
      const cur = m.get(s.ticker);
      if (!cur || s.score > cur.score) m.set(s.ticker, s);
    }
    return m;
  }, [scanner.data]);

  const select = useCallback((s: string) => setSelected(s.toUpperCase()), [setSelected]);

  // Notification clicks open "/?symbol=XYZ" — jump to that stock, then tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const sym = url.searchParams.get('symbol')?.toUpperCase();
    if (!sym) return;
    if (isSymbol(sym)) setSelected(sym);
    url.searchParams.delete('symbol');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [setSelected]);

  const createAlert = useCallback(
    async (symbol: string, condition: AlertCondition, threshold: number, note?: string) => {
      const alert = await alerts.create(symbol, condition, threshold, note);
      if (alert) {
        toast.success('Alert created', {
          description: `${describeAlert(alert)} — watched on the server, even when this tab is closed.`,
          action: { label: 'Notify me', onClick: () => setNotificationsOpen(true) },
        });
      }
    },
    [alerts]
  );
  const toggleIndicator = useCallback(
    (k: IndicatorKey) => setIndicatorList((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k])),
    [setIndicatorList]
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      const list = watchlist.symbols;
      const idx = list.indexOf(selected);
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        if (list.length) select(list[idx < 0 ? 0 : (idx + 1) % list.length]);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        if (list.length) select(list[idx <= 0 ? list.length - 1 : idx - 1]);
      } else if (/^[1-6]$/.test(e.key)) {
        setInterval(INTERVALS[Number(e.key) - 1]);
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'a') {
        e.preventDefault();
        setAlertOpen(true);
      } else if (e.key === 'n') {
        e.preventDefault();
        setNotificationsOpen(true);
      } else if (e.key === 't') {
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
      } else if (e.key === '?') {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [watchlist.symbols, selected, select, setInterval, resolvedTheme, setTheme]);

  const quote = live.quotes[selected];
  const activeAlerts = alerts.alerts.filter((a) => a.status === 'active').length;

  return (
    <TooltipProvider>
      <Navbar
        quotes={live.quotes}
        indices={INDICES}
        feedStatus={live.status}
        provider={live.provider}
        lastMessageAt={live.lastMessageAt}
        shortcutsOpen={shortcutsOpen}
        onShortcutsOpenChange={setShortcutsOpen}
        notificationsOpen={notificationsOpen}
        onNotificationsOpenChange={setNotificationsOpen}
        onSelect={select}
      />

      <main className="mx-auto grid w-full max-w-[1800px] gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_380px]">
        {/* Watchlist */}
        <div className="max-h-80 min-h-0 lg:sticky lg:top-[4.5rem] lg:row-span-2 lg:h-[calc(100vh-5.5rem)] lg:max-h-none">
          <PanelBoundary label="Watchlist">
            <WatchlistSection
              ref={searchRef}
              symbols={watchlist.symbols}
              quotes={live.quotes}
              errors={live.errors}
              selected={selected}
              signalsByTicker={signalsByTicker}
              full={watchlist.full}
              onSelect={select}
              onAdd={(s) => {
                watchlist.add(s);
                select(s);
              }}
              onRemove={watchlist.remove}
            />
          </PanelBoundary>
        </div>

        {/* Price + chart */}
        <Card className="flex min-w-0 flex-col">
          <div className="border-b border-border px-4 py-3">
            <PriceTicker
              symbol={selected}
              quote={quote}
              inWatchlist={watchlist.symbols.includes(selected)}
              onToggleWatchlist={() => (watchlist.symbols.includes(selected) ? watchlist.remove(selected) : watchlist.add(selected))}
              onNewAlert={() => setAlertOpen(true)}
            />
          </div>
          <div className="h-[440px] sm:h-[520px]">
            <PanelBoundary label="Chart">
              <ChartPanel
                symbol={selected}
                interval={interval}
                onIntervalChange={setInterval}
                quote={quote}
                signal={signalsByTicker.get(selected)}
                analysis={analysis.data}
                alerts={alerts.alerts}
                indicators={indicators}
                onToggleIndicator={toggleIndicator}
              />
            </PanelBoundary>
          </div>
        </Card>

        {/* AI insights (right rail on xl, below chart otherwise) */}
        <div className="min-h-0 xl:sticky xl:top-[4.5rem] xl:row-span-2 xl:h-[calc(100vh-5.5rem)]">
          <PanelBoundary label="AI insights">
            {providers && !providers.scanner ? (
              <Card className="p-6 text-sm text-muted">
                <p className="font-medium text-text">AI scanner not connected</p>
                <p className="mt-1 text-xs leading-relaxed">Set <code className="num">AI_SCANNER_BASE_URL</code> (and <code className="num">AI_SCANNER_API_KEY</code>) to the scanner API from <code className="num">backend/</code> — see the README.</p>
              </Card>
            ) : (
              <AIInsights symbol={selected} />
            )}
          </PanelBoundary>
        </div>

        {/* Bottom tabs */}
        <Card className="min-w-0 lg:col-start-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Dashboard sections">
              <TabsTrigger value="scanner"><Radar /> Scanner</TabsTrigger>
              <TabsTrigger value="alerts">
                <Bell /> Alerts{activeAlerts > 0 && <span className="num rounded bg-accent-soft px-1 text-[10px] text-accent">{activeAlerts}</span>}
              </TabsTrigger>
              <TabsTrigger value="news"><Newspaper /> News</TabsTrigger>
              <TabsTrigger value="heatmap"><Grid3x3 /> Heatmap</TabsTrigger>
              <TabsTrigger value="compare"><LineChart /> Compare</TabsTrigger>
              <TabsTrigger value="record"><FlaskConical /> Track record</TabsTrigger>
            </TabsList>
            <TabsContent value="scanner">
              <PanelBoundary label="Scanner"><ScannerResults onSelect={select} selected={selected} /></PanelBoundary>
            </TabsContent>
            <TabsContent value="alerts">
              <PanelBoundary label="Alerts">
                <AlertsPanel
                  alerts={alerts.alerts}
                  quotes={live.quotes}
                  onRemove={alerts.remove}
                  onRearm={alerts.rearm}
                  onClearTriggered={alerts.clearTriggered}
                  onSelect={select}
                  onNew={() => setAlertOpen(true)}
                />
              </PanelBoundary>
            </TabsContent>
            <TabsContent value="news">
              <PanelBoundary label="News"><NewsFeed symbol={selected} /></PanelBoundary>
            </TabsContent>
            <TabsContent value="heatmap">
              <PanelBoundary label="Heatmap"><Heatmap symbols={watchlist.symbols} quotes={live.quotes} onSelect={select} /></PanelBoundary>
            </TabsContent>
            <TabsContent value="compare">
              <PanelBoundary label="Compare"><CompareView key={selected} base={selected} candidates={watchlist.symbols} /></PanelBoundary>
            </TabsContent>
            <TabsContent value="record">
              <PanelBoundary label="Track record"><TrackRecord enabled={tab === 'record'} /></PanelBoundary>
            </TabsContent>
          </Tabs>
        </Card>
      </main>

      <footer className="mx-auto max-w-[1800px] px-4 pb-6 text-[11px] leading-relaxed text-faint">
        Market data from Finnhub / Twelve Data free tiers; index levels shown via tracking ETFs. Scanner signals are research output from a paper-trading system — not investment advice.
      </footer>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen} symbol={selected} quote={quote} onCreate={createAlert} />
    </TooltipProvider>
  );
}
