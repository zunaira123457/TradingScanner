import type { ReactNode } from 'react';
import { AlertTriangle, KeyRound, Loader2, Timer } from 'lucide-react';
import { FetchError } from '@/lib/fetcher';
import { cn } from '@/lib/utils/cn';

/** Consistent empty / error / not-configured states for panels. */
export function StateMessage({ icon, title, children, className }: { icon?: ReactNode; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center', className)}>
      {icon}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, what, className }: { error: unknown; what: string; className?: string }) {
  if (error instanceof FetchError && error.notConfigured) {
    return (
      <StateMessage className={className} icon={<KeyRound className="size-5 text-muted" />} title={`${what} not configured`}>
        {error.message}
      </StateMessage>
    );
  }
  if (error instanceof FetchError && error.rateLimited) {
    return (
      <StateMessage className={className} icon={<Timer className="size-5 text-warn" />} title="Free-tier rate limit reached">
        {what} will retry automatically{error.body?.retryAfter ? ` in ~${error.body.retryAfter}s` : ''}.
      </StateMessage>
    );
  }
  return (
    <StateMessage className={className} icon={<AlertTriangle className="size-5 text-down" />} title={`Couldn’t load ${what.toLowerCase()}`}>
      {error instanceof Error ? error.message : 'Unknown error'}
    </StateMessage>
  );
}

export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <StateMessage className={className} icon={<Loader2 className="size-5 animate-spin text-muted" />} title={label} />
  );
}
