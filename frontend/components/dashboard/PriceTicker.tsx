'use client';

import { useEffect, useState } from 'react';
import { Bell, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tip } from '@/components/ui/tooltip';
import { formatChange, formatCompact, formatPercent, formatPrice, formatRelative, formatTimeET } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';
import type { Quote } from '@/lib/types';

interface Props {
  symbol: string;
  quote?: Quote;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
  onNewAlert: () => void;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const body = (
    <div className="min-w-0" tabIndex={hint ? 0 : undefined}>
      <dt className="text-[11px] uppercase tracking-wider text-faint">{label}</dt>
      <dd className="num truncate text-sm">{value}</dd>
    </div>
  );
  return hint ? <Tip content={hint}>{body}</Tip> : body;
}

/** Selected-symbol header: live price, change, session stats, bid/ask and freshness. */
export function PriceTicker({ symbol, quote, inWatchlist, onToggleWatchlist, onNewAlert }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const dir = quote?.change == null ? 'flat' : quote.change >= 0 ? 'up' : 'down';
  const spread = quote?.bid != null && quote?.ask != null ? quote.ask - quote.bid : null;
  const noBook = 'Bid/ask is not included in the free Finnhub / Twelve Data plans. Shown when the feed provides it.';

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="num text-xl font-semibold tracking-tight">{symbol}</h1>
          <Button variant="ghost" size="icon" onClick={onToggleWatchlist} aria-label={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'} title={inWatchlist ? 'In watchlist' : 'Add to watchlist'}>
            <Star className={cn(inWatchlist && 'fill-warn text-warn')} />
          </Button>
          <Button variant="outline" size="sm" onClick={onNewAlert} title="New alert (A)">
            <Bell /> Alert
          </Button>
        </div>
        {quote ? (
          <div className="mt-1 flex items-baseline gap-3" aria-live="polite">
            <span className="num text-3xl font-semibold tracking-tight">{formatPrice(quote.price)}</span>
            <span className={cn('num text-sm font-medium', dir === 'up' && 'text-up', dir === 'down' && 'text-down', dir === 'flat' && 'text-muted')}>
              {formatChange(quote.change)} ({formatPercent(quote.changePercent)})
            </span>
          </div>
        ) : (
          <Skeleton className="mt-2 h-8 w-48" />
        )}
        <p className="mt-1 text-[11px] text-faint">
          {quote ? (
            <>
              Last trade {formatTimeET(quote.timestamp)} · refreshed {formatRelative(quote.fetchedAt)} · {quote.source === 'finnhub' ? 'Finnhub' : 'Twelve Data'}
            </>
          ) : (
            'Waiting for first quote…'
          )}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-x-6 gap-y-2 sm:grid-cols-6">
        <Stat label="Open" value={formatPrice(quote?.open)} />
        <Stat label="High" value={formatPrice(quote?.high)} />
        <Stat label="Low" value={formatPrice(quote?.low)} />
        <Stat label="Prev close" value={formatPrice(quote?.prevClose)} />
        <Stat label="Volume" value={formatCompact(quote?.volume)} hint={quote && quote.volume === null ? 'Finnhub’s quote endpoint does not include volume; see the chart’s volume bars.' : undefined} />
        <Stat
          label="Bid / Ask"
          value={quote?.bid != null && quote?.ask != null ? `${formatPrice(quote.bid)} / ${formatPrice(quote.ask)}` : '— / —'}
          hint={spread !== null ? `Spread ${formatPrice(spread)}` : noBook}
        />
      </dl>
    </div>
  );
}
