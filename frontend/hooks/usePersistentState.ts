'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * localStorage-backed state via useSyncExternalStore:
 *  - server render and hydration use `initial` (no mismatch),
 *  - updates propagate to every hook using the same key, including other tabs
 *    (the `storage` event), so alerts created in one tab arm in all of them,
 *  - if storage is unavailable (private mode, quota) it degrades to memory.
 */

const memory = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, raw: string) {
  memory.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    /* memory fallback already updated */
  }
  listeners.get(key)?.forEach((l) => l());
}

function subscribe(key: string, cb: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    set.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

const noopSubscribe = () => () => {};

/** True after hydration on the client, false during SSR/hydration. */
export function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function usePersistentState<T>(key: string, initial: T, validate?: (v: unknown) => v is T) {
  const sub = useCallback((cb: () => void) => subscribe(key, cb), [key]);
  const raw = useSyncExternalStore(sub, () => read(key), () => null);
  const hydrated = useHydrated();

  const value = useMemo<T>(() => {
    if (raw === null) return initial;
    try {
      const parsed: unknown = JSON.parse(raw);
      return !validate || validate(parsed) ? (parsed as T) : initial;
    } catch {
      return initial;
    }
    // `initial` is intentionally excluded: callers pass fresh literals each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, validate]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      let prev = initial;
      const cur = read(key);
      if (cur !== null) {
        try {
          const parsed: unknown = JSON.parse(cur);
          if (!validate || validate(parsed)) prev = parsed as T;
        } catch {
          /* keep initial */
        }
      }
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      write(key, JSON.stringify(resolved));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, validate]
  );

  return [value, setValue, hydrated] as const;
}
