'use client';

import { formatPercent, formatPrice } from '@/lib/utils/formatters';
import type { Quote } from '@/lib/types';

/**
 * Day-change heatmap for the watchlist. Colour intensity scales with |%
 * change| (capped at ±4%), mixed from the theme's up/down tokens so it reads
 * correctly in both themes.
 */
export function Heatmap({ symbols, quotes, onSelect }: { symbols: string[]; quotes: Record<string, Quote>; onSelect: (s: string) => void }) {
  const cells = symbols
    .map((s) => ({ s, q: quotes[s] }))
    .sort((a, b) => (b.q?.changePercent ?? -Infinity) - (a.q?.changePercent ?? -Infinity));

  return (
    <div className="p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1.5">
        {cells.map(({ s, q }) => {
          const pct = q?.changePercent ?? null;
          const intensity = pct === null ? 0 : Math.min(Math.abs(pct) / 4, 1);
          const token = pct === null || pct === 0 ? null : pct > 0 ? 'var(--up)' : 'var(--down)';
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              className="rounded-md border border-border p-3 text-left transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ background: token ? `color-mix(in srgb, ${token} ${Math.round(12 + intensity * 55)}%, var(--panel))` : 'var(--panel-2)' }}
              aria-label={`${s} ${q ? formatPercent(pct) : 'no data'}`}
            >
              <span className="num block text-sm font-semibold">{s}</span>
              <span className="num block text-lg font-semibold">{q ? formatPercent(pct) : '—'}</span>
              <span className="num block text-[11px] opacity-80">{q ? formatPrice(q.price) : 'awaiting quote'}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-faint">Sorted by today’s % change. Colour saturates at ±4%.</p>
    </div>
  );
}
