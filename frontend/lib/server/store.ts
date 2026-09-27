import 'server-only';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '@/lib/server/env';
import type { PriceAlert } from '@/lib/types';

/**
 * Tiny JSON-file store for alerts and push subscriptions. The app runs as a
 * single long-lived Node process, so an in-memory object flushed atomically
 * to disk is enough — no database to operate.
 *
 * A browser is identified by a random 256-bit "device key" it generates and
 * keeps in localStorage; only its SHA-256 is stored, so the file never holds
 * a usable credential.
 */

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
}

export interface Device {
  id: string;
  createdAt: number;
  lastSeen: number;
  owner: boolean;
  /** Receive push notifications for new scanner BUY/WATCH signals. */
  signals: boolean;
  subs: PushSub[];
  alerts: PriceAlert[];
}

interface StoreData {
  version: 1;
  devices: Record<string, Device>;
  notifiedSignals: string[];
}

export const LIMITS = { alertsPerDevice: 50, subsPerDevice: 5, devices: 5_000, notifiedSignals: 500 };

const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;

// globalThis so route handlers and the instrumentation watcher (separate
// bundles in the same process) share one copy.
const g = globalThis as unknown as { __tdStore?: { data: StoreData; timer: NodeJS.Timeout | null } };

function file() {
  return path.resolve(env.DATA_DIR, 'trading-desk.json');
}

function load(): StoreData {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as StoreData;
    if (parsed?.version === 1 && parsed.devices) return { ...parsed, notifiedSignals: parsed.notifiedSignals ?? [] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[store] could not read data file, starting empty', e);
  }
  return { version: 1, devices: {}, notifiedSignals: [] };
}

function state() {
  g.__tdStore ??= { data: load(), timer: null };
  return g.__tdStore;
}

export function data(): StoreData {
  return state().data;
}

function flush() {
  const s = state();
  s.timer = null;
  try {
    mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.tmp`;
    writeFileSync(tmp, JSON.stringify(s.data), { mode: 0o600 });
    renameSync(tmp, file());
  } catch (e) {
    console.error('[store] write failed', e);
  }
}

/** Schedule an atomic write (coalesces bursts of changes). */
export function persist() {
  const s = state();
  if (!s.timer) s.timer = setTimeout(flush, 250);
}

export function deviceIdFromRequest(request: Request): string | null {
  const key = request.headers.get('x-device-key');
  if (!key || !DEVICE_KEY_RE.test(key)) return null;
  return createHash('sha256').update(key).digest('hex');
}

function prune(d: StoreData) {
  const idle = Object.values(d.devices)
    .filter((x) => x.alerts.length === 0 && x.subs.length === 0 && !x.owner)
    .sort((a, b) => a.lastSeen - b.lastSeen);
  for (const x of idle.slice(0, Math.max(1, Math.ceil(idle.length / 4)))) delete d.devices[x.id];
}

export class StoreFullError extends Error {}

/** Look up (or lazily create) the device for this request. */
export function getDevice(request: Request, create: true): Device | null;
export function getDevice(request: Request, create?: false): Device | null;
export function getDevice(request: Request, create = false): Device | null {
  const id = deviceIdFromRequest(request);
  if (!id) return null;
  const d = data();
  let dev = d.devices[id];
  if (!dev && create) {
    if (Object.keys(d.devices).length >= LIMITS.devices) prune(d);
    if (Object.keys(d.devices).length >= LIMITS.devices) throw new StoreFullError('device limit reached');
    dev = d.devices[id] = { id, createdAt: Date.now(), lastSeen: Date.now(), owner: false, signals: false, subs: [], alerts: [] };
    persist();
  }
  if (dev) dev.lastSeen = Date.now();
  return dev ?? null;
}

export function allDevices(): Device[] {
  return Object.values(data().devices);
}
