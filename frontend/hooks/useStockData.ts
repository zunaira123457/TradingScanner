'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { CandleResponse, Interval, NewsItem, SymbolMatch } from '@/lib/types';

const REFRESH_MS: Record<Interval, number> = {
  '1m': 60_000, '5m': 120_000, '15m': 300_000, '1h': 600_000, '1d': 1_800_000, '1w': 3_600_000,
};

/** OHLCV candles; live ticks are folded in by the chart between refreshes. */
export function useCandles(symbol: string | null, interval: Interval) {
  return useSWR<CandleResponse>(symbol ? `/api/candles?symbol=${symbol}&interval=${interval}` : null, fetcher, {
    refreshInterval: REFRESH_MS[interval],
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });
}

export function useNews(symbol: string | null) {
  return useSWR<{ items: NewsItem[] }>(symbol ? `/api/news?symbol=${symbol}` : null, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 10 * 60_000,
    shouldRetryOnError: false,
  });
}

export function useSymbolSearch(query: string) {
  const q = query.trim();
  return useSWR<{ results: SymbolMatch[] }>(q.length >= 1 ? `/api/search?q=${encodeURIComponent(q)}` : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    shouldRetryOnError: false,
  });
}
