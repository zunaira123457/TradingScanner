'use client';

import { useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { StockChart, type ChartMarker, type ChartPriceLine } from '@/components/charts/StockChart';
import { IndicatorToggles, type IndicatorKey } from '@/components/charts/TechnicalIndicators';
import { ErrorState, LoadingState } from '@/components/common/StateMessage';
import { Badge } from '@/components/ui/badge';
import { useCandles } from '@/hooks/useStockData';
import { applyQuoteToCandles, INTERVAL_LABEL, isIntraday } from '@/lib/utils/chartHelpers';
import { formatRelative, humanize } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';
import { INTERVALS, type Candle, type Interval, type PriceAlert, type Quote, type ScannerSignal, type TickerAnalysis } from '@/lib/types';

type OverlayKey = 'signal' | 'levels' | 'alerts';

interface Props {
  symbol: string;
  interval: Interval;
  onIntervalChange: (i: Interval) => void;
  quote?: Quote;
  signal?: ScannerSignal;
  analysis?: TickerAnalysis;
  alerts: PriceAlert[];
  indicators: Set<IndicatorKey>;
  onToggleIndicator: (k: IndicatorKey) => void;
}

export function ChartPanel({ symbol, interval, onIntervalChange, quote, signal, analysis, alerts, indicators, onToggleIndicator }: Props) {
  const { resolvedTheme } = useTheme();
  const { data, error, isLoading } = useCandles(symbol, interval);
  const [overlays, setOverlays] = useState<Set<OverlayKey>>(() => new Set(['signal', 'alerts']));

  // Base series for *this* symbol/interval only (SWR keeps the previous key's data while loading).
  const base = data && data.symbol === symbol && data.interval === interval ? data.candles : null;
  // Live series = fetched bars + every tick since, accumulated (so a new
  // intraday bar keeps its running high/low). Updated during render — React's
  // recommended pattern for state derived from changing props.
  const [liveState, setLiveState] = useState<{ base: Candle[] | null; quote?: Quote; candles: Candle[] }>({ base: null, candles: [] });
  if (liveState.base !== base || liveState.quote !== quote) {
    let candles = liveState.base !== base ? (base ?? []) : liveState.candles;
    if (quote && quote.symbol === symbol) candles = applyQuoteToCandles(candles, quote, interval);
    setLiveState({ base, quote, candles });
  }
  const live = liveState.candles;

  const priceLines = useMemo<ChartPriceLine[]>(() => {
    const lines: ChartPriceLine[] = [];
    if (overlays.has('signal') && signal?.setupDetected) {
      if (signal.entry) lines.push({ price: signal.entry, title: 'Entry', tone: 'accent', style: 'solid' });
      if (signal.stop) lines.push({ price: signal.stop, title: 'Stop', tone: 'down' });
      if (signal.target) lines.push({ price: signal.target, title: 'Target', tone: 'up' });
    }
    if (overlays.has('levels') && analysis) {
      const { support20, resistance20, support60, resistance60 } = analysis.levels;
      if (resistance20) lines.push({ price: resistance20, title: 'R 20d', tone: 'muted' });
      if (support20) lines.push({ price: support20, title: 'S 20d', tone: 'muted' });
      if (resistance60 && resistance60 !== resistance20) lines.push({ price: resistance60, title: 'R 60d', tone: 'muted', style: 'dotted' });
      if (support60 && support60 !== support20) lines.push({ price: support60, title: 'S 60d', tone: 'muted', style: 'dotted' });
    }
    if (overlays.has('alerts')) {
      for (const a of alerts) {
        if (a.symbol === symbol && a.status === 'active' && a.condition.startsWith('price')) {
          lines.push({ price: a.threshold, title: '🔔', tone: 'warn', style: 'dotted' });
        }
      }
    }
    return lines;
  }, [overlays, signal, analysis, alerts, symbol]);

  const markers = useMemo<ChartMarker[]>(() => {
    if (!overlays.has('signal') || !signal || signal.classification === 'AVOID' || isIntraday(interval)) return [];
    const t = Math.floor(Date.parse(signal.asOf.slice(0, 10) + 'T00:00:00Z') / 1000);
    // Weekly bars start on Monday; snap the marker to the bar containing the signal date.
    const time = interval === '1w' ? (live.filter((c) => c.time <= t).at(-1)?.time ?? t) : t;
    return [{ time, text: `${signal.classification} · ${humanize(signal.strategy)}`, tone: signal.classification === 'BUY' ? 'up' : 'accent', position: 'belowBar' }];
  }, [overlays, signal, interval, live]);

  const toggleOverlay = (k: OverlayKey) =>
    setOverlays((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Timeframe">
          {INTERVALS.map((i, idx) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === interval}
              onClick={() => onIntervalChange(i)}
              title={`${INTERVAL_LABEL[i]} (${idx + 1})`}
              className={cn(
                'num h-6 rounded px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                i === interval ? 'bg-panel-2 text-text' : 'text-muted hover:text-text'
              )}
            >
              {INTERVAL_LABEL[i]}
            </button>
          ))}
        </div>
        <IndicatorToggles enabled={indicators} onToggle={onToggleIndicator} />
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Chart overlays">
          {(['signal', 'levels', 'alerts'] as OverlayKey[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={overlays.has(k)}
              onClick={() => toggleOverlay(k)}
              className={cn(
                'h-7 rounded-md px-2 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                overlays.has(k) ? 'text-text underline decoration-accent decoration-2 underline-offset-4' : 'text-faint hover:text-muted'
              )}
              title={k === 'signal' ? 'Scanner entry/stop/target' : k === 'levels' ? 'Computed support/resistance (from scanner)' : 'Your price alerts'}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {base && live.length > 0 ? (
          <StockChart
            candles={live}
            interval={interval}
            indicators={indicators}
            priceLines={priceLines}
            markers={markers}
            theme={resolvedTheme === 'light' ? 'light' : 'dark'}
            resetKey={`${symbol}:${interval}`}
          />
        ) : error ? (
          <ErrorState error={error} what="Chart data" className="h-full" />
        ) : isLoading || !base ? (
          <LoadingState label={`Loading ${symbol} · ${INTERVAL_LABEL[interval]}`} className="h-full" />
        ) : null}
        {data?.stale && base && (
          <Badge tone="warn" className="absolute bottom-2 left-2 z-10">
            Cached {formatRelative(data.fetchedAt)} — rate limit reached
          </Badge>
        )}
      </div>
    </div>
  );
}
