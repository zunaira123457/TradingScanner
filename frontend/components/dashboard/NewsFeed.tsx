'use client';

import { ExternalLink, Newspaper } from 'lucide-react';
import { ErrorState, LoadingState, StateMessage } from '@/components/common/StateMessage';
import { useNews } from '@/hooks/useStockData';
import { formatRelative } from '@/lib/utils/formatters';

export function NewsFeed({ symbol }: { symbol: string }) {
  const { data, error, isLoading } = useNews(symbol);
  if (error) return <ErrorState error={error} what="News" />;
  if (isLoading || !data) return <LoadingState label={`Loading ${symbol} news…`} />;
  if (data.items.length === 0) {
    return <StateMessage icon={<Newspaper className="size-5 text-muted" />} title={`No ${symbol} headlines in the last 7 days`} />;
  }
  return (
    <ul className="divide-y divide-border">
      {data.items.map((n) => (
        <li key={n.id}>
          <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="group flex gap-3 px-4 py-3 hover:bg-panel-2/60">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug group-hover:text-accent">{n.headline}</p>
              {n.summary && <p className="mt-1 line-clamp-2 text-xs text-muted">{n.summary}</p>}
              <p className="mt-1 text-[11px] text-faint">{n.source} · {formatRelative(n.datetime)}</p>
            </div>
            <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-faint" />
          </a>
        </li>
      ))}
    </ul>
  );
}
