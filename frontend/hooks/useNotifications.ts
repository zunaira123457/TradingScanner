'use client';

import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/device';
import { useHydrated } from '@/hooks/usePersistentState';

export interface NotificationSettings {
  push: { configured: boolean; publicKey: string | null };
  subscriptions: number;
  signals: boolean;
  owner: boolean;
  ownerAvailable: boolean;
  ownerChannels: { email: boolean; telegram: boolean } | null;
}

const isSettings = (v: unknown): v is NotificationSettings =>
  !!v && typeof v === 'object' && typeof (v as NotificationSettings).push === 'object' && (v as NotificationSettings).push !== null;

export type ChannelResult = { channel: 'push' | 'email' | 'telegram'; ok: boolean; detail?: string };

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS only allows web push for sites added to the Home Screen. */
function iosNeedsInstall() {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}

/**
 * Push APIs are only touched once `active` (the notifications panel has been
 * opened), so page load never depends on a browser's service-worker/push stack.
 */
export function useNotifications(active = true) {
  const hydrated = useHydrated();
  const settings = useSWR<NotificationSettings>(
    hydrated ? '/api/notifications' : null,
    async (u: string) => {
      const body = await api<unknown>(u);
      if (!isSettings(body)) throw new Error('Unexpected response from /api/notifications');
      return body;
    },
    { revalidateOnFocus: false }
  );
  // undefined = still checking the browser's current subscription.
  const [subscription, setSubscription] = useState<PushSubscription | null | undefined>(undefined);
  const supported = hydrated && pushSupported();

  useEffect(() => {
    if (!supported || !active) return;
    let cancelled = false;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => !cancelled && setSubscription(s))
      .catch(() => !cancelled && setSubscription(null));
    return () => {
      cancelled = true;
    };
  }, [supported, active]);

  // Re-register with the server if its copy was lost (e.g. data reset).
  const serverSubs = settings.data?.subscriptions;
  const { mutate } = settings;
  useEffect(() => {
    if (subscription && serverSubs === 0) {
      void api('/api/notifications/subscribe', { method: 'POST', body: subscription.toJSON() })
        .then(() => mutate())
        .catch(() => {});
    }
  }, [subscription, serverSubs, mutate]);

  const enablePush = useCallback(async () => {
    const key = settings.data?.push.publicKey;
    if (!key) throw new Error('Push is not configured on the server yet');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications are blocked for this site — allow them in your browser settings');
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
    await api('/api/notifications/subscribe', { method: 'POST', body: sub.toJSON() });
    setSubscription(sub);
    await mutate();
  }, [settings.data, mutate]);

  const disablePush = useCallback(async () => {
    const sub = subscription;
    setSubscription(null);
    await sub?.unsubscribe().catch(() => {});
    await api('/api/notifications/subscribe', { method: 'DELETE', body: { endpoint: sub?.endpoint } }).catch(() => {});
    await mutate();
  }, [subscription, mutate]);

  const setSignals = useCallback(
    async (signals: boolean) => {
      await mutate(
        async (cur) => {
          await api('/api/notifications', { method: 'PATCH', body: { signals } });
          return cur && { ...cur, signals };
        },
        { optimisticData: (cur) => ({ ...cur!, signals }), rollbackOnError: true, revalidate: false }
      );
    },
    [mutate]
  );

  const unlockOwner = useCallback(
    async (key: string) => {
      await api('/api/notifications/owner', { method: 'POST', body: { key } });
      await mutate();
    },
    [mutate]
  );

  const leaveOwner = useCallback(async () => {
    await api('/api/notifications/owner', { method: 'DELETE' });
    await mutate();
  }, [mutate]);

  const sendTest = useCallback(() => api<{ results: ChannelResult[] }>('/api/notifications/test', { method: 'POST' }).then((r) => r.results), []);

  return {
    settings: settings.data,
    error: settings.error as Error | undefined,
    supported,
    iosNeedsInstall: hydrated && iosNeedsInstall(),
    permission: supported ? Notification.permission : 'default',
    subscribed: !!subscription,
    checking: supported && subscription === undefined,
    enablePush,
    disablePush,
    setSignals,
    unlockOwner,
    leaveOwner,
    sendTest,
  };
}
