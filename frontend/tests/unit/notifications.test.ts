import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'td-test-'));

let notify: typeof import('@/lib/server/notify');
let watcher: typeof import('@/lib/server/watcher');
let store: typeof import('@/lib/server/store');

beforeAll(async () => {
  notify = await import('@/lib/server/notify');
  watcher = await import('@/lib/server/watcher');
  store = await import('@/lib/server/store');
});

const req = (key?: string) => new Request('http://x/api', { headers: key ? { 'x-device-key': key } : {} });

describe('push endpoint allowlist', () => {
  it('accepts real push services', () => {
    for (const u of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGx',
      'https://wns2-by3p.notify.windows.com/w/?token=abc',
    ]) expect(notify.isAllowedPushEndpoint(u), u).toBe(true);
  });

  it('rejects anything that could reach internal or arbitrary hosts', () => {
    for (const u of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evilpush.apple.com.attacker.net/x',
      'not a url',
    ]) expect(notify.isAllowedPushEndpoint(u), u).toBe(false);
  });
});

describe('device identity', () => {
  it('requires a well-formed key and stores only its hash', () => {
    expect(store.getDevice(req(), true)).toBeNull();
    expect(store.getDevice(req('short'), true)).toBeNull();
    const key = 'k'.repeat(43);
    const d = store.getDevice(req(key), true)!;
    expect(d.id).toMatch(/^[0-9a-f]{64}$/);
    expect(d.id).not.toContain(key);
    expect(store.getDevice(req(key))).toBe(d);
    expect(store.getDevice(req('j'.repeat(43)))).toBeNull();
  });
});

describe('notification messages', () => {
  it('formats a triggered alert with a deep link', () => {
    const m = watcher.alertMessage(
      { id: 'a1', symbol: 'AAPL', condition: 'price_above', threshold: 200, createdAt: 0, status: 'triggered', triggeredPrice: 201.5, note: 'breakout' },
      { changePercent: 2.345 }
    );
    expect(m.title).toBe('🔔 AAPL $201.50');
    expect(m.body).toContain('Price rises above $200.00');
    expect(m.body).toContain('+2.35% today');
    expect(m.body).toContain('Note: breakout');
    expect(m.path).toBe('/?symbol=AAPL');
    expect(m.tag).toBe('alert-a1');
  });

  it('keys scanner signals by ticker, strategy and day', () => {
    expect(watcher.signalKey({ ticker: 'MSFT', strategy: 'trend_pullback', asOf: '2026-09-25T20:00:00Z' })).toBe('MSFT:trend_pullback:2026-09-25');
  });

  it('sends nothing to non-owner devices without push', async () => {
    const d = store.getDevice(req('m'.repeat(43)), true)!;
    expect(await notify.notifyDevice(d, { title: 't', body: 'b', path: '/', tag: 't' })).toEqual([]);
  });
});
