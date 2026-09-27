'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { ColorType, LineSeries, createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import useSWR from 'swr';
import { X } from 'lucide-react';
import { LoadingState } from '@/components/common/StateMessage';
import { fetcher } from '@/lib/fetcher';
import { toPercentSeries } from '@/lib/utils/chartHelpers';
import { formatPercent } from '@/lib/utils/formatters';
import type { CandleResponse } from '@/lib/types';

const COLORS = ['var(--accent)', '#e0a100', '#b36ae2', '#1fb5a8'];
const LOOKBACK_BARS = 126; // ~6 months of daily bars

function resolveColor(c: string) {
  if (!c.startsWith('var(')) return c;
  return getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim();
}

/** Normalised % performance of up to 4 symbols over ~6 months of daily closes. */
export function CompareView({ base, candidates }: { base: string; candidates: string[] }) {
  const [extra, setExtra] = useState<string[]>(() => candidates.filter((s) => s !== base).slice(0, 1).concat('SPY').filter((v, i, a) => a.indexOf(v) === i && v !== base));
  const symbols = [base, ...extra.filter((s) => s !== base)].slice(0, 4);
  const key = symbols.join(',');
  const { data, isLoading } = useSWR<(CandleResponse | { error: string; symbol: string })[]>(
    `compare:${key}`,
    () =>
      Promise.all(
        symbols.map((s) =>
          fetcher<CandleResponse>(`/api/candles?symbol=${s}&interval=1d`).catch((e: Error) => ({ error: e.message, symbol: s }))
        )
      ),
    { revalidateOnFocus: false }
  );
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  const series = useMemo(
    () =>
      (data ?? []).map((d) =>
        'candles' in d ? { symbol: d.symbol, points: toPercentSeries(d.candles.slice(-LOOKBACK_BARS)) } : { symbol: d.symbol, error: d.error }
      ),
    [data]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let chart: IChartApi | null = null;
    // Wait a frame so theme CSS variables reflect the newly applied class.
    const raf = requestAnimationFrame(() => {
      const muted = resolveColor('var(--muted)');
      const grid = resolveColor('var(--chart-grid)');
      chart = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: muted, fontSize: 11, attributionLogo: false },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
        localization: { priceFormatter: (p: number) => `${p.toFixed(1)}%` },
      });
      series.forEach((s, i) => {
        if (!('points' in s) || !s.points) return;
        const line = chart!.addSeries(LineSeries, { color: resolveColor(COLORS[i]), lineWidth: 2, priceLineVisible: false, title: s.symbol });
        line.setData(s.points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      });
      chart.timeScale().fitContent();
    });
    return () => {
      cancelAnimationFrame(raf);
      chart?.remove();
    };
  }, [series, resolvedTheme]);

  const [adding, setAdding] = useState('');

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {series.map((s, i) => (
          <span key={s.symbol} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
            <span className="size-2 rounded-full" style={{ background: COLORS[i] }} />
            <span className="num font-semibold">{s.symbol}</span>
            {'points' in s && s.points && s.points.length > 0 && <span className="num text-muted">{formatPercent(s.points.at(-1)!.value, 1)}</span>}
            {'error' in s && <span className="text-down">unavailable</span>}
            {i > 0 && (
              <button type="button" onClick={() => setExtra((e) => e.filter((x) => x !== s.symbol))} aria-label={`Remove ${s.symbol} from comparison`} className="text-faint hover:text-down">
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {symbols.length < 4 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const s = adding.trim().toUpperCase();
              if (/^[A-Z][A-Z0-9.]{0,5}$/.test(s) && !symbols.includes(s)) setExtra((x) => [...x, s]);
              setAdding('');
            }}
          >
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              placeholder="+ symbol"
              aria-label="Add symbol to comparison"
              className="num h-7 w-24 rounded-md border border-border bg-panel-2 px-2 text-xs uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
        )}
      </div>
      <div className="relative h-72">
        {isLoading && <LoadingState label="Loading daily bars…" className="absolute inset-0" />}
        <div ref={ref} className="h-full w-full" role="img" aria-label="Relative performance chart" />
      </div>
      <p className="mt-2 text-[11px] text-faint">Close-to-close % change over the last ~6 months of daily bars. Each symbol costs one candle request (cached 30 min).</p>
    </div>
  );
}
