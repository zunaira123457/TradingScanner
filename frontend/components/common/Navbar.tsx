'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { ShortcutsDialog } from '@/components/common/ShortcutsDialog';
import { NotificationsDialog } from '@/components/common/NotificationsDialog';
import { MarketOverview } from '@/components/dashboard/MarketOverview';
import { Tip } from '@/components/ui/tooltip';
import { SESSION_LABEL, sessionState, type SessionState } from '@/lib/utils/marketHours';
import { formatRelative } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';
import type { FeedStatus } from '@/hooks/useLivePrices';
import type { DataSource, Quote } from '@/lib/types';

const FEED: Record<FeedStatus, { label: string; dot: string }> = {
  idle: { label: 'Idle', dot: 'bg-faint' },
  connecting: { label: 'Connecting', dot: 'bg-warn animate-pulse' },
  live: { label: 'Live', dot: 'bg-up' },
  throttled: { label: 'Throttled', dot: 'bg-warn' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-warn animate-pulse' },
  offline: { label: 'Offline', dot: 'bg-down' },
  unconfigured: { label: 'No data feed', dot: 'bg-down' },
};

interface Props {
  quotes: Record<string, Quote>;
  indices: string[];
  feedStatus: FeedStatus;
  provider: DataSource | null;
  lastMessageAt: number | null;
  shortcutsOpen: boolean;
  onShortcutsOpenChange: (o: boolean) => void;
  notificationsOpen: boolean;
  onNotificationsOpenChange: (o: boolean) => void;
  onSelect: (s: string) => void;
}

export function Navbar({ quotes, indices, feedStatus, provider, lastMessageAt, shortcutsOpen, onShortcutsOpenChange, notificationsOpen, onNotificationsOpenChange, onSelect }: Props) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [, forceTick] = useState(0);
  useEffect(() => {
    const update = () => {
      setSession(sessionState());
      forceTick((n) => n + 1);
    };
    update();
    const id = setInterval(update, 5_000);
    return () => clearInterval(id);
  }, []);

  const feed = FEED[feedStatus];
  const feedTip =
    provider === 'twelvedata'
      ? 'Quotes from Twelve Data (free tier: ~30s cadence). Set FINNHUB_API_KEY for real-time.'
      : provider === 'finnhub'
        ? 'Real-time quotes via Finnhub, streamed over Server-Sent Events.'
        : 'Set FINNHUB_API_KEY or TWELVE_DATA_API_KEY on the server.';

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-4 px-4">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-md bg-accent text-white">
            <Activity className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Trading Desk</span>
        </div>

        <div className="hidden min-w-0 flex-1 lg:block">
          <MarketOverview quotes={quotes} symbols={indices} onSelect={onSelect} />
        </div>

        <div className="ml-auto flex items-center gap-1">
          {session && (
            <span className="hidden items-center gap-1.5 rounded-md px-2 text-xs text-muted lg:inline-flex" title="Regular session 9:30–16:00 ET, Mon–Fri. Holidays not modelled.">
              <span className={cn('size-1.5 rounded-full', session === 'open' ? 'bg-up' : 'bg-faint')} />
              {SESSION_LABEL[session]}
            </span>
          )}
          <Tip content={<span>{feedTip}{lastMessageAt ? <><br />Last update {formatRelative(lastMessageAt)}</> : null}</span>}>
            <span tabIndex={0} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted" aria-live="polite">
              <span className={cn('size-2 rounded-full', feed.dot)} />
              {feed.label}
              {provider && <span className="hidden text-faint sm:inline">· {provider === 'finnhub' ? 'Finnhub' : 'Twelve Data'}</span>}
            </span>
          </Tip>
          <NotificationsDialog open={notificationsOpen} onOpenChange={onNotificationsOpenChange} />
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={onShortcutsOpenChange} />
          <ThemeToggle />
        </div>
      </div>
      <div className="scroll-thin overflow-x-auto border-t border-border px-4 lg:hidden">
        <MarketOverview quotes={quotes} symbols={indices} onSelect={onSelect} />
      </div>
    </header>
  );
}
