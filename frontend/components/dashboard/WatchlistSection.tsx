'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SymbolSearch } from '@/components/dashboard/SymbolSearch';
import { formatPercent, formatPrice } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';
import type { Quote, ScannerSignal } from '@/lib/types';

interface Props {
  symbols: string[];
  quotes: Record<string, Quote>;
  errors: Record<string, string>;
  selected: string;
  signalsByTicker: Map<string, ScannerSignal>;
  full: boolean;
  onSelect: (s: string) => void;
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
}

/** Remembers the previous price per symbol so rows can flash on each tick. */
function useFlash(symbol: string, price: number | undefined) {
  const prev = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; n: number } | null>(null);
  useEffect(() => {
    if (price !== undefined && prev.current !== undefined && price !== prev.current) {
      setFlash((f) => ({ dir: price > (prev.current as number) ? 'up' : 'down', n: (f?.n ?? 0) + 1 }));
    }
    prev.current = price;
  }, [price, symbol]);
  return flash;
}

function Row({ symbol, quote, error, selected, signal, onSelect, onRemove }: {
  symbol: string; quote?: Quote; error?: string; selected: boolean; signal?: ScannerSignal;
  onSelect: () => void; onRemove: () => void;
}) {
  const flash = useFlash(symbol, quote?.price);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const dir = quote?.changePercent == null ? 'flat' : quote.changePercent >= 0 ? 'up' : 'down';

  return (
    <li ref={ref} className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          selected ? 'border-accent bg-panel-2' : 'border-transparent hover:bg-panel-2/60'
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="num text-sm font-semibold">{symbol}</span>
          {signal && signal.classification !== 'AVOID' && (
            <span className={cn('rounded px-1 text-[10px] font-bold', signal.classification === 'BUY' ? 'bg-up-soft text-up' : 'bg-warn-soft text-warn')} title={`Scanner: ${signal.classification}`}>
              {signal.classification}
            </span>
          )}
        </span>
        {quote ? (
          <span key={flash?.n} className={cn('num rounded px-1 text-right text-sm', flash && (flash.dir === 'up' ? 'flash-up' : 'flash-down'))}>
            {formatPrice(quote.price)}
          </span>
        ) : error ? (
          <span className="text-right text-[11px] text-down" title={error}>unavailable</span>
        ) : (
          <Skeleton className="h-4 w-16" />
        )}
        <span
          className={cn(
            'num w-[4.5rem] rounded px-1.5 py-0.5 text-right text-xs font-medium',
            dir === 'up' && 'bg-up-soft text-up',
            dir === 'down' && 'bg-down-soft text-down',
            dir === 'flat' && 'text-faint'
          )}
        >
          {quote ? formatPercent(quote.changePercent) : '—'}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${symbol} from watchlist`}
        className="absolute left-0.5 top-1/2 hidden -translate-y-1/2 rounded p-0.5 text-faint hover:text-down focus-visible:block group-hover:block [@media(hover:none)]:block"
      >
        <X className="size-3" />
      </button>
    </li>
  );
}

export const WatchlistSection = forwardRef<HTMLInputElement, Props>(function WatchlistSection(
  { symbols, quotes, errors, selected, signalsByTicker, full, onSelect, onAdd, onRemove },
  searchRef
) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'list' | 'change'>('list');
  const f = filter.trim().toUpperCase();
  let shown = f ? symbols.filter((s) => s.includes(f)) : symbols;
  if (sort === 'change') {
    shown = [...shown].sort((a, b) => (quotes[b]?.changePercent ?? -Infinity) - (quotes[a]?.changePercent ?? -Infinity));
  }

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader>
        <CardTitle>Watchlist</CardTitle>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSort((s) => (s === 'list' ? 'change' : 'list'))}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-panel-2 hover:text-text"
            title="Toggle sort order"
          >
            {sort === 'list' ? 'My order' : 'By % change'}
          </button>
          <span className="num text-[11px] text-faint">{symbols.length}/20</span>
        </div>
      </CardHeader>
      <div className="space-y-2 border-b border-border p-3">
        <SymbolSearch ref={searchRef} onPick={onAdd} disabled={full} />
        <div className="relative">
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter watchlist"
            aria-label="Filter watchlist"
            className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-xs placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1" aria-label="Watchlist symbols">
        {shown.map((s) => (
          <Row
            key={s}
            symbol={s}
            quote={quotes[s]}
            error={errors[s]}
            selected={s === selected}
            signal={signalsByTicker.get(s)}
            onSelect={() => onSelect(s)}
            onRemove={() => onRemove(s)}
          />
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted">{f ? 'No matches' : 'Add a symbol to start'}</li>}
      </ul>
    </Card>
  );
});
