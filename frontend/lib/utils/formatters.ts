const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdSmall = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

export const EM_DASH = '—';

export function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  return Math.abs(v) < 1 && v !== 0 ? usdSmall.format(v) : usd.format(v);
}

export function formatChange(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

export function formatPercent(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  return `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`;
}

export function formatCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  return compact.format(v);
}

export function formatNumber(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  return v.toFixed(dp);
}

/** "12s ago", "4m ago", "3h ago", or a date for anything older than a day. */
export function formatRelative(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatTimeET(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET';
}

export function formatDate(iso: string | number): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** momentum_continuation -> Momentum continuation */
export function humanize(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function trendClass(v: number | null | undefined): 'up' | 'down' | 'flat' {
  if (v === null || v === undefined || v === 0 || !Number.isFinite(v)) return 'flat';
  return v > 0 ? 'up' : 'down';
}

/**
 * Strips raw data-field references the LLM sometimes echoes, e.g.
 * "(mtfAligned: true)", "(strategyWarnings)", "trend_pullback".
 */
export function cleanAIText(s: string): string {
  return s
    .replace(/(?:,\s*)?\b[a-z]+[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*:\s*[^,;)]+(?=[,;)])/g, '')
    .replace(/\(\s*(?:(?:per\s+)?[a-z]+[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*\s*(?:,|and)?\s*)+\)/g, '')
    .replace(/\(\s*[,;]\s*/g, '(')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, (m) => m.replace(/_/g, ' '))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}
