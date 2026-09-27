'use client';

import { useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { api } from '@/lib/device';
import { useHydrated } from '@/hooks/usePersistentState';
import { describeAlert, evaluateAlerts } from '@/lib/alerts';
import { formatPrice } from '@/lib/utils/formatters';
import type { AlertCondition, PriceAlert, Quote } from '@/lib/types';

type AlertsResponse = { alerts: PriceAlert[] };
const EMPTY: PriceAlert[] = [];
const LEGACY_KEY = 'sd.alerts.v1';

function announce(a: PriceAlert, systemNotification: boolean) {
  const title = `Alert: ${a.symbol} at ${formatPrice(a.triggeredPrice)}`;
  const body = describeAlert(a);
  toast.warning(title, { description: body, duration: 10_000 });
  if (!systemNotification) return;
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, tag: `alert-${a.id}` });
    }
  } catch {
    /* notifications unsupported */
  }
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/**
 * Alerts live on the server, which keeps evaluating them (and sends push /
 * email / Telegram) when no tab is open. While the dashboard is open it also
 * evaluates every live tick locally for instant feedback and reports the
 * trigger to the server.
 */
export function useAlerts(quotes: Record<string, Quote>) {
  const hydrated = useHydrated();
  const { data, mutate } = useSWR<AlertsResponse>(hydrated ? '/api/alerts' : null, async (u: string) => {
    const body = await api<AlertsResponse>(u);
    if (!Array.isArray(body?.alerts)) throw new Error('Unexpected response from /api/alerts');
    return body;
  }, {
    refreshInterval: 20_000,
    keepPreviousData: true,
  });
  const alerts = data?.alerts ?? EMPTY;

  // One-time migration of alerts saved by the old browser-only version.
  useEffect(() => {
    if (!hydrated) return;
    let legacy: PriceAlert[] = [];
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      return;
    }
    const active = Array.isArray(legacy) ? legacy.filter((a) => a?.status === 'active') : [];
    if (!active.length) return;
    void Promise.allSettled(
      active.map((a) => api('/api/alerts', { method: 'POST', body: { symbol: a.symbol, condition: a.condition, threshold: a.threshold, note: a.note } }))
    ).then(() => mutate());
  }, [hydrated, mutate]);

  // Local evaluation against the live stream.
  const firedHere = useRef(new Set<string>());
  useEffect(() => {
    if (!data) return;
    let current = data.alerts;
    const fired: PriceAlert[] = [];
    for (const q of Object.values(quotes)) {
      const r = evaluateAlerts(current, q);
      current = r.alerts;
      fired.push(...r.fired);
    }
    if (!fired.length) return;
    for (const a of fired) firedHere.current.add(a.id);
    void mutate({ alerts: current }, { revalidate: false });
    for (const a of fired) {
      announce(a, true);
      void api(`/api/alerts/${a.id}`, { method: 'PATCH', body: { action: 'trigger', price: a.triggeredPrice } }).catch(() => {});
    }
  }, [quotes, data, mutate]);

  // Alerts the server's watcher fired (e.g. while this tab was asleep).
  const lastStatus = useRef<Map<string, PriceAlert['status']> | null>(null);
  useEffect(() => {
    if (!data) return;
    const prev = lastStatus.current;
    if (prev) {
      for (const a of data.alerts) {
        if (a.status === 'triggered' && prev.get(a.id) === 'active' && !firedHere.current.has(a.id)) announce(a, false);
      }
    }
    lastStatus.current = new Map(data.alerts.map((a) => [a.id, a.status]));
  }, [data]);

  const create = useCallback(
    async (symbol: string, condition: AlertCondition, threshold: number, note?: string) => {
      try {
        const { alert } = await api<{ alert: PriceAlert }>('/api/alerts', { method: 'POST', body: { symbol, condition, threshold, note } });
        await mutate((cur) => ({ alerts: [alert, ...(cur?.alerts ?? [])] }), { revalidate: false });
        return alert;
      } catch (e) {
        toast.error('Could not create alert', { description: errMessage(e) });
        return null;
      }
    },
    [mutate]
  );

  const optimistic = useCallback(
    async (update: (a: PriceAlert[]) => PriceAlert[], request: () => Promise<unknown>) => {
      try {
        await mutate(
          async (cur) => {
            await request();
            return { alerts: update(cur?.alerts ?? []) };
          },
          { optimisticData: (cur) => ({ alerts: update(cur?.alerts ?? []) }), rollbackOnError: true, revalidate: false }
        );
      } catch (e) {
        toast.error('Could not update alerts', { description: errMessage(e) });
      }
    },
    [mutate]
  );

  const remove = useCallback(
    (id: string) => optimistic((l) => l.filter((a) => a.id !== id), () => api(`/api/alerts/${id}`, { method: 'DELETE' })),
    [optimistic]
  );
  const rearm = useCallback(
    (id: string) => {
      firedHere.current.delete(id);
      return optimistic(
        (l) => l.map((a) => (a.id === id ? { ...a, status: 'active' as const, triggeredAt: undefined, triggeredPrice: undefined } : a)),
        () => api(`/api/alerts/${id}`, { method: 'PATCH', body: { action: 'rearm' } })
      );
    },
    [optimistic]
  );
  const clearTriggered = useCallback(
    () => optimistic((l) => l.filter((a) => a.status === 'active'), () => api('/api/alerts?status=triggered', { method: 'DELETE' })),
    [optimistic]
  );

  return { alerts, loaded: !!data, create, remove, rearm, clearTriggered };
}
