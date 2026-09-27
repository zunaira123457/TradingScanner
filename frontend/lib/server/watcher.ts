import 'server-only';
import { getQuotes } from '@/lib/api-clients/stockDataClient';
import { scannerClient } from '@/lib/api-clients/scannerClient';
import { env } from '@/lib/server/env';
import { allDevices, data, LIMITS, persist, type Device } from '@/lib/server/store';
import { notifyDevice, sendOwner, sendPush, type NotifyMessage } from '@/lib/server/notify';
import { describeAlert, evaluateAlerts } from '@/lib/alerts';
import { sessionState } from '@/lib/utils/marketHours';
import { humanize } from '@/lib/utils/formatters';
import type { PriceAlert, Quote, ScannerSignal } from '@/lib/types';

/**
 * Background loop (started from instrumentation.ts) so alerts and scanner
 * signals reach you even when no dashboard tab is open.
 */

const ALERT_TICK_MS = 30_000;
const SIGNAL_TICK_MS = 5 * 60_000;
const MAX_WATCH_SYMBOLS = 40;

const g = globalThis as unknown as { __tdWatcher?: boolean };

export function alertMessage(a: PriceAlert, q?: Pick<Quote, 'changePercent'>): NotifyMessage {
  const price = a.triggeredPrice !== undefined ? `$${a.triggeredPrice.toFixed(2)}` : '';
  const change = q?.changePercent != null ? ` (${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}% today)` : '';
  return {
    title: `🔔 ${a.symbol} ${price}`.trim(),
    body: `${describeAlert(a)}\nNow ${price}${change}${a.note ? `\nNote: ${a.note}` : ''}`,
    path: `/?symbol=${encodeURIComponent(a.symbol)}`,
    tag: `alert-${a.id}`,
  };
}

export async function alertsTick() {
  if (sessionState() === 'closed') return;
  const devices = allDevices().filter((d) => d.alerts.some((a) => a.status === 'active'));
  if (devices.length === 0) return;
  const symbols = [...new Set(devices.flatMap((d) => d.alerts.filter((a) => a.status === 'active').map((a) => a.symbol)))].slice(0, MAX_WATCH_SYMBOLS);
  let quotes: Quote[];
  try {
    quotes = (await getQuotes(symbols)).quotes;
  } catch {
    return; // no data provider configured
  }
  const fired: { device: Device; alert: PriceAlert; quote: Quote }[] = [];
  for (const device of devices) {
    for (const q of quotes) {
      const r = evaluateAlerts(device.alerts, q);
      if (r.fired.length) {
        device.alerts = r.alerts;
        for (const a of r.fired) fired.push({ device, alert: a, quote: q });
      }
    }
  }
  if (!fired.length) return;
  persist();
  await Promise.allSettled(fired.map(({ device, alert, quote }) => notifyDevice(device, alertMessage(alert, quote))));
}

let lastScan: string | null = null;

export function signalKey(s: Pick<ScannerSignal, 'ticker' | 'strategy' | 'asOf'>) {
  return `${s.ticker}:${s.strategy}:${s.asOf.slice(0, 10)}`;
}

export async function signalsTick() {
  if (!env.AI_SCANNER_BASE_URL) return;
  let snap;
  try {
    snap = await scannerClient.scan();
  } catch {
    return;
  }
  if (snap.status !== 'ready' || snap.generatedAt === lastScan) return;
  lastScan = snap.generatedAt;

  const store = data();
  const seen = new Set(store.notifiedSignals);
  const fresh = snap.signals.filter((s) => s.classification !== 'AVOID' && !seen.has(signalKey(s)));
  if (!fresh.length) return;
  store.notifiedSignals = [...store.notifiedSignals, ...fresh.map(signalKey)].slice(-LIMITS.notifiedSignals);
  persist();

  const lines = fresh.slice(0, 8).map((s) => {
    const plan = s.entry && s.stop && s.target ? ` — entry $${s.entry.toFixed(2)}, stop $${s.stop.toFixed(2)}, target $${s.target.toFixed(2)}` : '';
    return `${s.ticker} ${s.classification} · ${humanize(s.strategy)} · score ${s.score.toFixed(0)}${plan}`;
  });
  const msg: NotifyMessage = {
    title: fresh.length === 1 ? `📈 New signal: ${fresh[0].ticker} ${fresh[0].classification}` : `📈 ${fresh.length} new scanner signals`,
    body: lines.join('\n') + (fresh.length > 8 ? `\n…and ${fresh.length - 8} more` : ''),
    path: `/?symbol=${encodeURIComponent(fresh[0].ticker)}`,
    tag: `signals-${snap.generatedAt}`,
  };
  await Promise.allSettled([
    sendOwner(msg),
    ...allDevices()
      .filter((d) => d.signals && d.subs.length)
      .map((d) => sendPush(d, msg)),
  ]);
}

function loop(fn: () => Promise<void>, every: number, firstDelay: number) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error('[watcher]', fn.name, e);
    } finally {
      running = false;
    }
  };
  setTimeout(() => {
    void run();
    setInterval(run, every).unref();
  }, firstDelay).unref();
}

export function startWatcher() {
  if (g.__tdWatcher || env.WATCHER_ENABLED === 'false') return;
  g.__tdWatcher = true;
  loop(alertsTick, ALERT_TICK_MS, 10_000);
  loop(signalsTick, SIGNAL_TICK_MS, 30_000);
  console.log('[watcher] started — alerts every 30s (market hours), scanner every 5m');
}
