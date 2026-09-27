'use client';

import { catchError, type ErrorInfo } from 'next/error';
import { AlertTriangle } from 'lucide-react';

function PanelError({ label }: { label: string }, { error, retry }: ErrorInfo) {
  return (
    <div role="alert" className="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-panel p-6 text-center">
      <AlertTriangle className="size-5 text-warn" />
      <p className="text-sm font-medium">{label} failed to render</p>
      <p className="max-w-sm text-xs text-muted">{error instanceof Error ? error.message : String(error)}</p>
      <button type="button" onClick={() => retry()} className="mt-1 text-xs font-medium text-accent hover:underline">
        Try again
      </button>
    </div>
  );
}

/** Per-panel error boundary: one broken widget never takes down the dashboard. */
export const PanelBoundary = catchError(PanelError);
