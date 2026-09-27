'use client';

import { FetchError } from '@/lib/fetcher';
import type { ApiError } from '@/lib/types';

/**
 * Each browser gets a random key that owns its alerts and push subscriptions
 * on the server (no sign-up). Clearing site data starts a fresh device.
 */
const KEY = 'td.device.v1';
let memory: string | null = null;

function generate() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deviceKey(): string {
  try {
    let k = localStorage.getItem(KEY);
    if (!k) localStorage.setItem(KEY, (k = memory ?? generate()));
    return k;
  } catch {
    return (memory ??= generate());
  }
}

/** fetch() for device-scoped endpoints: attaches the device key, sends/reads JSON, throws FetchError. */
export async function api<T>(url: string, init: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'x-device-key': deviceKey(), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* not JSON */
    }
    throw new FetchError(res.status, body);
  }
  return res.json() as Promise<T>;
}
