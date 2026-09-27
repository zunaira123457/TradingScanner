'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { buildIndicatorData, type IndicatorKey } from '@/components/charts/TechnicalIndicators';
import { isIntraday } from '@/lib/utils/chartHelpers';
import { formatCompact, formatPrice } from '@/lib/utils/formatters';
import type { Candle, Interval } from '@/lib/types';

export interface ChartPriceLine {
  price: number;
  title: string;
  tone: 'accent' | 'up' | 'down' | 'muted' | 'warn';
  style?: 'solid' | 'dashed' | 'dotted';
}

export interface ChartMarker {
  time: number;
  text: string;
  tone: 'up' | 'down' | 'accent';
  position: 'aboveBar' | 'belowBar';
}

interface Props {
  candles: Candle[];
  interval: Interval;
  indicators: Set<IndicatorKey>;
  priceLines: ChartPriceLine[];
  markers: ChartMarker[];
  theme: 'dark' | 'light';
  /** Changes when the symbol/interval changes, to reset the visible range. */
  resetKey: string;
}

type Palette = Record<'bg' | 'text' | 'muted' | 'faint' | 'grid' | 'border' | 'up' | 'down' | 'accent' | 'warn', string>;

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    bg: v('--panel'), text: v('--text'), muted: v('--muted'), faint: v('--faint'), grid: v('--chart-grid'),
    border: v('--border'), up: v('--up'), down: v('--down'), accent: v('--accent'), warn: v('--warn'),
  };
}

const ET_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ET_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const UTC_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const UTC_MONTH = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });

const LINE_STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;

interface Legend {
  o: number; h: number; l: number; c: number; v: number; time: number;
}

/**
 * Candlestick chart on TradingView Lightweight Charts (canvas; handles
 * thousands of bars smoothly, native zoom/pan/crosshair).
 *
 * Series are rebuilt only when the indicator set or theme changes. Live ticks
 * that only touch the last bar go through `series.update()` so the chart
 * doesn't re-layout on every price change.
 */
export function StockChart({ candles, interval, indicators, priceLines, markers, theme, resetKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlayRefs = useRef<Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>>(new Map());
  const priceLineRefs = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastDataRef = useRef<{ len: number; first: number; lastTime: number } | null>(null);
  // Set when symbol/interval changes; consumed by the first full setData after it.
  const pendingResetRef = useRef<string | null>(resetKey);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);

  const indicatorKey = [...indicators].sort().join(',');
  const intraday = isIntraday(interval);

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: 11, attributionLogo: false },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 6, timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    const overlays = overlayRefs.current;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      overlays.clear();
      priceLineRefs.current = [];
      markersRef.current = null;
      lastDataRef.current = null;
    };
  }, []);

  // Theme → colours (read after the `dark` class has been applied).
  useEffect(() => {
    const id = requestAnimationFrame(() => setPalette(readPalette()));
    return () => cancelAnimationFrame(id);
  }, [theme]);

  // Time axis formatting: ET clock for intraday, calendar dates for daily/weekly.
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: {
        timeFormatter: (t: Time) => {
          const d = new Date((t as number) * 1000);
          return intraday ? `${ET_DATE.format(d)} ${ET_TIME.format(d)} ET` : UTC_DATE.format(d);
        },
      },
      timeScale: {
        timeVisible: intraday,
        tickMarkFormatter: (t: Time, type: number) => {
          const d = new Date((t as number) * 1000);
          // TickMarkType: 0 year, 1 month, 2 day, 3+ time.
          if (!intraday) {
            if (type === 0) return String(d.getUTCFullYear());
            if (type === 1) return UTC_MONTH.format(d);
            return UTC_DATE.format(d).replace(/, \d{4}$/, '');
          }
          return type >= 3 ? ET_TIME.format(d) : ET_DATE.format(d);
        },
      },
    });
  }, [intraday]);

  // (Re)build series when the theme or indicator selection changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !palette) return;

    chart.applyOptions({
      layout: { textColor: palette.muted },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      crosshair: {
        vertLine: { color: palette.faint, labelBackgroundColor: palette.border },
        horzLine: { color: palette.faint, labelBackgroundColor: palette.border },
      },
    });

    // Tear down everything, then add back only what's enabled.
    for (const s of overlayRefs.current.values()) chart.removeSeries(s);
    overlayRefs.current.clear();
    if (volumeRef.current) chart.removeSeries(volumeRef.current);
    volumeRef.current = null;
    if (candleRef.current) chart.removeSeries(candleRef.current);
    markersRef.current = null;
    priceLineRefs.current = [];
    lastDataRef.current = null;
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: palette.up, downColor: palette.down, borderUpColor: palette.up, borderDownColor: palette.down,
      wickUpColor: palette.up, wickDownColor: palette.down, priceLineColor: palette.faint,
    });
    markersRef.current = createSeriesMarkers(candleRef.current, []);

    if (indicators.has('vol')) {
      volumeRef.current = chart.addSeries(HistogramSeries, {
        priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }

    const line = (key: string, color: string, pane = 0, width: 1 | 2 = 1, style: LineStyle = LineStyle.Solid) => {
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      }, pane);
      overlayRefs.current.set(key, s);
    };

    if (indicators.has('sma20')) line('sma20', palette.warn, 0, 2);
    if (indicators.has('ema50')) line('ema50', palette.accent, 0, 2);
    if (indicators.has('bb')) {
      line('bbUpper', palette.faint, 0, 1, LineStyle.Dashed);
      line('bbMiddle', palette.faint, 0, 1, LineStyle.Dotted);
      line('bbLower', palette.faint, 0, 1, LineStyle.Dashed);
    }
    let pane = 1;
    if (indicators.has('rsi')) {
      line('rsi', palette.accent, pane, 2);
      const rsiSeries = overlayRefs.current.get('rsi') as ISeriesApi<'Line'>;
      rsiSeries.createPriceLine({ price: 70, color: palette.down, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: '' });
      rsiSeries.createPriceLine({ price: 30, color: palette.up, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: '' });
      pane++;
    }
    if (indicators.has('macd')) {
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      overlayRefs.current.set('macdHist', hist);
      line('macd', palette.accent, pane, 1);
      line('macdSignal', palette.warn, pane, 1);
    }
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes.slice(1).forEach((p) => p.setStretchFactor(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indicatorKey captures `indicators`
  }, [palette, indicatorKey]);

  // Symbol/interval changed → force a full setData and re-frame the view.
  // Declared before the data effect so it runs first in the same commit.
  useEffect(() => {
    pendingResetRef.current = resetKey;
    lastDataRef.current = null;
  }, [resetKey]);

  // Push data. Fast path: only the last bar changed.
  const indicatorData = useMemo(() => buildIndicatorData(candles, indicators), [candles, indicators]);

  useEffect(() => {
    const cs = candleRef.current;
    const chart = chartRef.current;
    if (!cs || !chart || !palette) return;
    if (candles.length === 0) {
      cs.setData([]);
      volumeRef.current?.setData([]);
      for (const s of overlayRefs.current.values()) s.setData([]);
      lastDataRef.current = null;
      return;
    }

    const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
    const toVol = (c: Candle) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: (c.close >= c.open ? palette.up : palette.down) + '55',
    });

    const prev = lastDataRef.current;
    const last = candles[candles.length - 1];
    const lastOnly =
      prev &&
      prev.first === candles[0].time &&
      (candles.length === prev.len || candles.length === prev.len + 1) &&
      last.time >= prev.lastTime;

    if (lastOnly) {
      cs.update(toBar(last));
      volumeRef.current?.update(toVol(last));
    } else {
      cs.setData(candles.map(toBar));
      volumeRef.current?.setData(candles.map(toVol));
      if (pendingResetRef.current !== null) {
        pendingResetRef.current = null;
        const n = candles.length;
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 5 });
      }
    }
    lastDataRef.current = { len: candles.length, first: candles[0].time, lastTime: last.time };

    for (const [key, series] of overlayRefs.current) {
      const data = indicatorData[key];
      if (!data) continue;
      if (key === 'macdHist') {
        (series as ISeriesApi<'Histogram'>).setData(
          data.map((p) => ('value' in p ? { ...p, color: (p.value >= 0 ? palette.up : palette.down) + '99' } : p))
        );
      } else {
        (series as ISeriesApi<'Line'>).setData(data);
      }
    }
  }, [candles, indicatorData, palette, indicatorKey]);

  // Price lines (signal levels, support/resistance, alert thresholds).
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs || !palette) return;
    priceLineRefs.current.forEach((l) => cs.removePriceLine(l));
    const toneColor = { accent: palette.accent, up: palette.up, down: palette.down, muted: palette.faint, warn: palette.warn };
    priceLineRefs.current = priceLines.map((l) =>
      cs.createPriceLine({
        price: l.price, color: toneColor[l.tone], lineWidth: 1, lineStyle: LINE_STYLE[l.style ?? 'dashed'],
        axisLabelVisible: true, title: l.title,
      })
    );
  }, [priceLines, palette, indicatorKey]);

  // Markers.
  useEffect(() => {
    if (!markersRef.current || !palette) return;
    const toneColor = { accent: palette.accent, up: palette.up, down: palette.down };
    const list: SeriesMarker<Time>[] = markers
      .filter((m) => candles.some((c) => c.time === m.time))
      .map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.position,
        shape: m.position === 'belowBar' ? 'arrowUp' : 'arrowDown',
        color: toneColor[m.tone],
        text: m.text,
      }));
    markersRef.current.setMarkers(list);
  }, [markers, candles, palette, indicatorKey]);

  // Crosshair legend.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (p: MouseEventParams<Time>) => {
      const cs = candleRef.current;
      if (!cs || !p.time) return setLegend(null);
      const bar = p.seriesData.get(cs) as { open: number; high: number; low: number; close: number } | undefined;
      if (!bar) return setLegend(null);
      const vol = volumeRef.current ? (p.seriesData.get(volumeRef.current) as { value: number } | undefined) : undefined;
      setLegend({ o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: vol?.value ?? NaN, time: p.time as number });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, []);

  const shown = legend ?? (candles.length ? { ...pick(candles[candles.length - 1]) } : null);

  return (
    <div className="relative h-full w-full">
      {shown && (
        <div className="num pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 text-[11px] text-muted" aria-hidden>
          <span>O <b className="font-medium text-text">{formatPrice(shown.o)}</b></span>
          <span>H <b className="font-medium text-text">{formatPrice(shown.h)}</b></span>
          <span>L <b className="font-medium text-text">{formatPrice(shown.l)}</b></span>
          <span>C <b className={shown.c >= shown.o ? 'font-medium text-up' : 'font-medium text-down'}>{formatPrice(shown.c)}</b></span>
          {Number.isFinite(shown.v) && shown.v > 0 && <span>Vol <b className="font-medium text-text">{formatCompact(shown.v)}</b></span>}
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" role="img" aria-label="Candlestick price chart" />
    </div>
  );
}

function pick(c: Candle): Legend {
  return { o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume, time: c.time };
}
