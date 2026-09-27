import 'server-only';
import { UpstreamBudgetError, UpstreamError, clientRateLimit } from '@/lib/server/rateLimit';
import { NotConfiguredError } from '@/lib/api-clients/stockDataClient';

/** Maps known error types to consistent JSON error responses. */
export function errorResponse(error: unknown): Response {
  if (error instanceof NotConfiguredError) {
    return Response.json({ error: 'not_configured', message: error.message }, { status: 503 });
  }
  if (error instanceof UpstreamBudgetError) {
    const retryAfter = Math.ceil(error.retryAfterMs / 1000);
    return Response.json(
      { error: 'upstream_rate_limited', message: error.message, retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }
  if (error instanceof UpstreamError) {
    const status = error.status === 404 ? 404 : 502;
    return Response.json({ error: 'upstream_error', message: error.message }, { status });
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return Response.json({ error: 'upstream_timeout', message: 'Upstream request timed out' }, { status: 504 });
  }
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    return Response.json({ error: 'upstream_unreachable', message: 'Upstream service is unreachable' }, { status: 502 });
  }
  console.error('[api] unexpected error', error);
  return Response.json({ error: 'internal_error' }, { status: 500 });
}

/** Returns a 429 Response if this client is over `limit` req/min for `bucket`, else null. */
export function limitOr429(request: Request, bucket: string, limit: number): Response | null {
  const r = clientRateLimit(request, bucket, limit);
  if (r.ok) return null;
  return Response.json(
    { error: 'rate_limited', retryAfter: r.retryAfter },
    { status: 429, headers: { 'Retry-After': String(r.retryAfter) } }
  );
}

const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,5}$/;

export function parseSymbol(raw: string | null): string | null {
  const s = raw?.trim().toUpperCase() ?? '';
  return SYMBOL_RE.test(s) ? s : null;
}

export function parseSymbols(raw: string | null, max: number): string[] | null {
  if (!raw) return null;
  const list = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (list.length === 0 || list.length > max || !list.every((s) => SYMBOL_RE.test(s))) return null;
  return list;
}
