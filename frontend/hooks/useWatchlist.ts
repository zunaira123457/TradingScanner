'use client';

import { useCallback } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

export const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'NFLX', 'JPM'];
export const MAX_WATCHLIST = 20;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

export function useWatchlist() {
  const [symbols, setSymbols, hydrated] = usePersistentState<string[]>('sd.watchlist.v1', DEFAULT_WATCHLIST, isStringArray);

  const add = useCallback(
    (s: string) => setSymbols((prev) => (prev.includes(s) || prev.length >= MAX_WATCHLIST ? prev : [...prev, s])),
    [setSymbols]
  );
  const remove = useCallback((s: string) => setSymbols((prev) => prev.filter((x) => x !== s)), [setSymbols]);

  return { symbols, add, remove, hydrated, full: symbols.length >= MAX_WATCHLIST };
}
