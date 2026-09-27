import 'server-only';

/**
 * Token bucket. `take()` never waits: callers decide whether to serve stale
 * data or return 429 when the budget is spent, so no request ever hangs for
 * a minute waiting on a free-tier quota.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private capacity: number,
    private refillPerMs: number,
    private now: () => number = Date.now
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  static perMinute(n: number, now?: () => number) {
    return new TokenBucket(n, n / 60_000, now);
  }

  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (t - this.last) * this.refillPerMs);
    this.last = t;
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  take(n = 1): boolean {
    this.refill();
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  /** Milliseconds until `n` tokens are available. */
  waitMs(n = 1): number {
    this.refill();
    return this.tokens >= n ? 0 : Math.ceil((n - this.tokens) / this.refillPerMs);
  }
}

export class UpstreamBudgetError extends Error {
  constructor(
    public provider: string,
    public retryAfterMs: number
  ) {
    super(`${provider} request budget exhausted; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
  }
}

export class UpstreamError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string
  ) {
    super(`${provider}: ${message}`);
  }
}

/**
 * Per-client limiter for our own route handlers (fixed window, in memory).
 * On serverless this is per instance — a best-effort abuse guard, not a
 * billing-grade quota. Put a platform firewall rule in front for that.
 */
const clientWindows = new Map<string, { start: number; count: number }>();

export function clientRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowMs = 60_000
): { ok: true } | { ok: false; retryAfter: number } {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const key = `${bucket}:${ip}`;
  const t = Date.now();
  const w = clientWindows.get(key);
  if (!w || t - w.start >= windowMs) {
    clientWindows.set(key, { start: t, count: 1 });
    if (clientWindows.size > 10_000) clientWindows.clear();
    return { ok: true };
  }
  w.count += 1;
  if (w.count > limit) return { ok: false, retryAfter: Math.ceil((w.start + windowMs - t) / 1000) };
  return { ok: true };
}
