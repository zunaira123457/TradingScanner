import 'server-only';
import { env } from '@/lib/server/env';
import { UpstreamError } from '@/lib/server/rateLimit';
import { NotConfiguredError } from '@/lib/api-clients/stockDataClient';
import type { PerformanceResponse, ScanSnapshot, TickerAnalysis } from '@/lib/types';

/**
 * Client for the AI scanner API (backend/src/server). Server-side only — the
 * scanner key is attached here and never exposed to the browser.
 */

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  if (!env.AI_SCANNER_BASE_URL) throw new NotConfiguredError('AI scanner', 'AI_SCANNER_BASE_URL');
  // Append (not resolve) so a base URL with a path prefix, e.g. https://host/scanner, is kept.
  const res = await fetch(`${env.AI_SCANNER_BASE_URL.replace(/\/+$/, '')}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...(env.AI_SCANNER_API_KEY ? { 'x-api-key': env.AI_SCANNER_API_KEY } : {}), ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new UpstreamError('scanner', res.status, message);
  }
  return res.json() as Promise<T>;
}

export const scannerClient = {
  scan: (tickers?: string[]) =>
    call<ScanSnapshot>(`/v1/scan${tickers?.length ? `?tickers=${encodeURIComponent(tickers.join(','))}` : ''}`),
  refresh: () => call<{ status: string }>('/v1/scan/refresh', { method: 'POST' }),
  // The AI explanation can take a while (LLM call with its own 60s timeout upstream).
  analysis: (ticker: string, ai = true) =>
    call<TickerAnalysis>(`/v1/analysis/${encodeURIComponent(ticker)}?ai=${ai ? 1 : 0}`, {}, 75_000),
  performance: () => call<PerformanceResponse>('/v1/performance'),
  health: () => call<{ status: string; aiEnabled: boolean }>('/health', {}, 5_000),
};
