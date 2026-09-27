'use client';

import type { LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import { bollinger, ema, macd, rsi, sma, type Series } from '@/lib/utils/technicalAnalysis';
import { cn } from '@/lib/utils/cn';
import type { Candle } from '@/lib/types';

export type IndicatorKey = 'vol' | 'sma20' | 'ema50' | 'bb' | 'rsi' | 'macd';

export const INDICATORS: { key: IndicatorKey; label: string; title: string }[] = [
  { key: 'vol', label: 'Vol', title: 'Volume' },
  { key: 'sma20', label: 'SMA 20', title: 'Simple moving average (20)' },
  { key: 'ema50', label: 'EMA 50', title: 'Exponential moving average (50)' },
  { key: 'bb', label: 'BB', title: 'Bollinger Bands (20, 2σ)' },
  { key: 'rsi', label: 'RSI', title: 'Relative Strength Index (14, Wilder)' },
  { key: 'macd', label: 'MACD', title: 'MACD (12, 26, 9)' },
];

type Point = LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;

const toPoints = (candles: Candle[], s: Series): Point[] =>
  candles.map((c, i) => (s[i] === null ? { time: c.time as UTCTimestamp } : { time: c.time as UTCTimestamp, value: s[i] as number }));

/** Computes only the enabled indicators, keyed by the series ids StockChart uses. */
export function buildIndicatorData(candles: Candle[], enabled: Set<IndicatorKey>): Record<string, Point[]> {
  const close = candles.map((c) => c.close);
  const out: Record<string, Point[]> = {};
  if (enabled.has('sma20')) out.sma20 = toPoints(candles, sma(close, 20));
  if (enabled.has('ema50')) out.ema50 = toPoints(candles, ema(close, 50));
  if (enabled.has('bb')) {
    const b = bollinger(close, 20, 2);
    out.bbUpper = toPoints(candles, b.upper);
    out.bbMiddle = toPoints(candles, b.middle);
    out.bbLower = toPoints(candles, b.lower);
  }
  if (enabled.has('rsi')) out.rsi = toPoints(candles, rsi(close, 14));
  if (enabled.has('macd')) {
    const m = macd(close);
    out.macd = toPoints(candles, m.macd);
    out.macdSignal = toPoints(candles, m.signal);
    out.macdHist = toPoints(candles, m.histogram);
  }
  return out;
}

/** Toggle chips for the indicator overlays. */
export function IndicatorToggles({ enabled, onToggle }: { enabled: Set<IndicatorKey>; onToggle: (k: IndicatorKey) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Indicators">
      {INDICATORS.map((ind) => {
        const on = enabled.has(ind.key);
        return (
          <button
            key={ind.key}
            type="button"
            title={ind.title}
            aria-pressed={on}
            onClick={() => onToggle(ind.key)}
            className={cn(
              'h-7 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border text-muted hover:text-text'
            )}
          >
            {ind.label}
          </button>
        );
      })}
    </div>
  );
}
