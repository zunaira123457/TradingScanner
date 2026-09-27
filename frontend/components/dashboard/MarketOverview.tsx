'use client';

import { formatPercent, formatPrice } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';
import type { Quote } from '@/lib/types';

/**
 * Index proxies. Real index levels (SPX, NDX, DJI) need a paid feed, so the
 * tracking ETFs are shown instead and labelled as such.
 */
export const INDEX_ETFS: Record<string, string> = {
  SPY: 'S&P 500',
  QQQ: 'Nasdaq 100',
  DIA: 'Dow 30',
  IWM: 'Russell 2000',
};

export function MarketOverview({ quotes, symbols, onSelect }: { quotes: Record<string, Quote>; symbols: string[]; onSelect: (s: string) => void }) {
  return (
    <ul className="flex items-center gap-1 py-1.5 md:py-0" aria-label="Market overview (index ETFs)">
      {symbols.map((s) => {
        const q = quotes[s];
        const dir = q?.changePercent == null ? 'flat' : q.changePercent >= 0 ? 'up' : 'down';
        return (
          <li key={s}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              title={`${INDEX_ETFS[s] ?? s} (via ${s} ETF)`}
              className="flex items-baseline gap-2 whitespace-nowrap rounded-md px-2.5 py-1 text-xs hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium text-muted">{INDEX_ETFS[s] ?? s}</span>
              <span className="num text-text">{q ? formatPrice(q.price) : '—'}</span>
              <span className={cn('num', dir === 'up' && 'text-up', dir === 'down' && 'text-down', dir === 'flat' && 'text-faint')}>
                {q ? formatPercent(q.changePercent) : ''}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
