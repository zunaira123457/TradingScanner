import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Small, dependency-free HTTP helpers for the scanner API. Kept separate from
 * the server entry point so they can be unit-tested without starting express
 * or touching any market-data provider.
 */

const TICKER_RE = /^[A-Z][A-Z0-9.]{0,5}$/;

/** Parses a comma-separated ticker list; returns null if any entry is malformed. */
export function parseTickers(raw: string | undefined, max: number): string[] | null {
  if (!raw) return [];
  const tickers = [...new Set(raw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (tickers.length > max || tickers.some((t) => !TICKER_RE.test(t))) return null;
  return tickers;
}

export function isValidTicker(t: string): boolean {
  return TICKER_RE.test(t);
}

/**
 * Requires `x-api-key` to match `expectedKey`. When no key is configured the
 * API is left open, which is only acceptable for local development — the
 * server logs a warning at startup in that case.
 */
export function apiKeyAuth(expectedKey: string | undefined) {
  const expected = expectedKey ? Buffer.from(expectedKey) : null;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!expected) return next();
    const provided = Buffer.from(String(req.header('x-api-key') ?? ''));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}

/** Fixed-window per-client rate limiter (in-memory; one process). */
export function rateLimit(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { windowStart: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.windowStart >= windowMs) {
      hits.set(key, { windowStart: t, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.setHeader('Retry-After', Math.ceil((entry.windowStart + windowMs - t) / 1000));
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}
