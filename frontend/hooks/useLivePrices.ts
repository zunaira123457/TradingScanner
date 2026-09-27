'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DataSource, ProviderStatus, Quote } from '@/lib/types';

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'throttled' | 'reconnecting' | 'offline' | 'unconfigured';

const SWITCH_DEBOUNCE_MS = 400;
const MAX_BACKOFF_MS = 30_000;

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);


export interface LivePrices {
  quotes: Record<string, Quote>;
  status: FeedStatus;
  provider: DataSource | null;
  lastMessageAt: number | null;
  errors: Record<string, string>;
}

/**
 * Live quotes over Server-Sent Events from /api/stream.
 *
 * On (re)subscribe it first pulls a one-shot snapshot from /api/quotes so the
 * table fills immediately, then applies streamed deltas. EventSource handles
 * reconnection (the server closes streams every ~4.5 min by design).
 */
export function useLivePrices(symbols: string[], focus: string | null, providers: ProviderStatus | null): LivePrices {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  // Status is tagged with the connection it belongs to, so a new subscription
  // reads as 'connecting' without a synchronous setState in the effect.
  const [conn, setConn] = useState<{ id: string; status: FeedStatus } | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const provider = providers?.quotes ?? null;
  const online = useOnline();
  const key = symbols.join(',');
  const wanted = `${provider}|${key}|${focus}`;
  // Rapid symbol switching settles before we reconnect, so it opens one stream, not dozens.
  const [settled, setSettled] = useState(wanted);
  useEffect(() => {
    if (settled === wanted) return;
    const t = setTimeout(() => setSettled(wanted), SWITCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [wanted, settled]);
  // Bumped to force a fresh EventSource after the browser gives up on one.
  const [attempt, setAttempt] = useState(0);
  const connId = `${settled}|${attempt}`;
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(2_000);

  useEffect(() => {
    const [prov, k, f] = settled.split('|');
    const settledKey = k;
    const settledFocus = f === 'null' ? null : f;
    if (!provider || prov !== provider || !settledKey || !online) return;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const setStatus = (status: FeedStatus) => setConn({ id: connId, status });

    const merge = (list: Quote[]) => {
      setQuotes((prev) => {
        const next = { ...prev };
        for (const q of list) {
          const old = prev[q.symbol];
          // Never let an older quote overwrite a newer one.
          if (!old || q.timestamp > old.timestamp || q.fetchedAt > old.fetchedAt) next[q.symbol] = q;
        }
        return next;
      });
      setLastMessageAt(Date.now());
    };

    const controller = new AbortController();
    fetch(`/api/quotes?symbols=${encodeURIComponent(settledKey)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { quotes: Quote[] } | null) => body && merge(body.quotes))
      .catch(() => {});

    const url = `/api/stream?symbols=${encodeURIComponent(settledKey)}${settledFocus ? `&focus=${settledFocus}` : ''}`;
    const es = new EventSource(url);

    es.addEventListener('ready', () => {
      backoff.current = 2_000;
      setStatus('live');
    });
    es.addEventListener('quotes', (e) => {
      merge(JSON.parse((e as MessageEvent).data) as Quote[]);
      setErrors((prev) => (Object.keys(prev).length ? {} : prev));
    });
    es.addEventListener('status', (e) => {
      const { retryAfterMs } = JSON.parse((e as MessageEvent).data) as { retryAfterMs: number };
      setStatus('throttled');
      if (throttleTimer.current) clearTimeout(throttleTimer.current);
      throttleTimer.current = setTimeout(() => setStatus('live'), Math.min(retryAfterMs, 60_000));
    });
    es.addEventListener('quote_error', (e) => {
      const { symbol, message } = JSON.parse((e as MessageEvent).data) as { symbol: string; message: string };
      setErrors((prev) => ({ ...prev, [symbol]: message }));
    });
    es.onerror = () => {
      setStatus('reconnecting');
      // A non-200 answer (e.g. 429) makes the browser give up for good; retry ourselves.
      if (es.readyState === EventSource.CLOSED && !retryTimer) {
        retryTimer = setTimeout(() => setAttempt((n) => n + 1), backoff.current);
        backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
      }
    };
    es.onopen = () => setStatus('live');

    return () => {
      controller.abort();
      es.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (throttleTimer.current) clearTimeout(throttleTimer.current);
    };
  }, [settled, provider, connId, online]);

  // Back online → reconnect straight away rather than waiting for the browser.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) {
      backoff.current = 2_000;
      setAttempt((n) => n + 1);
    }
    wasOnline.current = online;
  }, [online]);

  const status: FeedStatus = !providers
    ? 'idle'
    : !provider
      ? 'unconfigured'
      : !online
        ? 'offline'
        : conn?.id === connId
          ? conn.status
          : key
            ? 'connecting'
            : 'idle';
  return { quotes, status, provider, lastMessageAt, errors };
}
