import { describe, expect, it } from 'vitest';
import { evaluateAlerts, isTriggered, validateAlertInput } from '@/lib/alerts';
import type { PriceAlert, Quote } from '@/lib/types';

const quote = (price: number, changePercent: number | null = 0, symbol = 'AAPL'): Quote => ({
  symbol, price, change: null, changePercent, open: null, high: null, low: null, prevClose: null,
  volume: null, bid: null, ask: null, timestamp: 0, fetchedAt: 0, source: 'finnhub',
});
const alert = (p: Partial<PriceAlert>): PriceAlert => ({
  id: 'a', symbol: 'AAPL', condition: 'price_above', threshold: 100, createdAt: 0, status: 'active', ...p,
});

describe('isTriggered', () => {
  it('price_above / price_below are inclusive', () => {
    expect(isTriggered(alert({ condition: 'price_above', threshold: 100 }), quote(100))).toBe(true);
    expect(isTriggered(alert({ condition: 'price_above', threshold: 100 }), quote(99.99))).toBe(false);
    expect(isTriggered(alert({ condition: 'price_below', threshold: 100 }), quote(100))).toBe(true);
  });
  it('percent alerts use the day change and ignore missing data', () => {
    expect(isTriggered(alert({ condition: 'change_pct_above', threshold: 3 }), quote(1, 3.2))).toBe(true);
    expect(isTriggered(alert({ condition: 'change_pct_below', threshold: -2 }), quote(1, -1.9))).toBe(false);
    expect(isTriggered(alert({ condition: 'change_pct_above', threshold: 3 }), quote(1, null))).toBe(false);
  });
  it('ignores other symbols and non-active alerts', () => {
    expect(isTriggered(alert({}), quote(200, 0, 'MSFT'))).toBe(false);
    expect(isTriggered(alert({ status: 'triggered' }), quote(200))).toBe(false);
  });
});

describe('evaluateAlerts', () => {
  it('marks fired alerts once and keeps the same array when nothing fires', () => {
    const list = [alert({ id: '1' }), alert({ id: '2', threshold: 500 })];
    const r1 = evaluateAlerts(list, quote(150), 42);
    expect(r1.fired.map((a) => a.id)).toEqual(['1']);
    expect(r1.alerts[0]).toMatchObject({ status: 'triggered', triggeredAt: 42, triggeredPrice: 150 });
    const r2 = evaluateAlerts(r1.alerts, quote(151));
    expect(r2.fired).toEqual([]);
    expect(r2.alerts).toBe(r1.alerts);
  });
});

describe('validateAlertInput', () => {
  it('rejects targets already satisfied by the current price', () => {
    expect(validateAlertInput('price_above', 90, 100)).toMatch(/Already above/);
    expect(validateAlertInput('price_below', 110, 100)).toMatch(/Already below/);
    expect(validateAlertInput('price_above', 110, 100)).toBeNull();
  });
  it('enforces sign on percent alerts', () => {
    expect(validateAlertInput('change_pct_above', -2, null)).not.toBeNull();
    expect(validateAlertInput('change_pct_below', -2, null)).toBeNull();
  });
});
