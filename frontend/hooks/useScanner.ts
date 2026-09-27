'use client';

import { useEffect, useRef } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import { humanize } from '@/lib/utils/formatters';
import type { PerformanceResponse, ScanSnapshot, TickerAnalysis } from '@/lib/types';

/**
 * Polls the scanner snapshot. Faster while the scanner is warming up, and
 * raises a toast when a scan introduces a BUY/WATCH signal that wasn't in the
 * previous snapshot (never on first load).
 */
export function useScanner() {
  const swr = useSWR<ScanSnapshot>('/api/scanner', fetcher, {
    refreshInterval: (d) => (d && d.status !== 'ready' ? 5_000 : 60_000),
    revalidateOnFocus: false,
    shouldRetryOnError: true,
    errorRetryInterval: 30_000,
  });
  const seen = useRef<Set<string> | null>(null);
  const generatedAt = swr.data?.generatedAt;

  useEffect(() => {
    const data = swr.data;
    if (!data || data.status !== 'ready') return;
    const actionable = data.signals.filter((s) => s.classification !== 'AVOID');
    const keys = new Set(actionable.map((s) => `${s.ticker}:${s.strategy}:${s.classification}`));
    if (seen.current) {
      for (const s of actionable) {
        if (!seen.current.has(`${s.ticker}:${s.strategy}:${s.classification}`)) {
          toast.info(`New scanner signal: ${s.ticker} ${s.classification}`, {
            description: `${humanize(s.strategy)} · score ${s.score.toFixed(0)}/100`,
            duration: 12_000,
          });
        }
      }
    }
    seen.current = keys;
  }, [generatedAt, swr.data]);

  return swr;
}

export function useTickerAnalysis(ticker: string | null) {
  return useSWR<TickerAnalysis>(ticker ? `/api/scanner/analysis/${ticker}` : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10 * 60_000,
    shouldRetryOnError: false,
    keepPreviousData: false,
  });
}

export function usePerformance(enabled: boolean) {
  return useSWR<PerformanceResponse>(enabled ? '/api/scanner/performance' : null, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 10 * 60_000,
  });
}
