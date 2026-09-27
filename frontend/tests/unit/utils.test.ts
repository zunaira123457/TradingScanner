import { describe, expect, it } from 'vitest';
import {
  EM_DASH,
  formatChange,
  formatCompact,
  formatDate,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRelative,
  formatTimeET,
  humanize,
  trendClass,
} from '@/lib/utils/formatters';
import { SESSION_LABEL, sessionState } from '@/lib/utils/marketHours';
import { applyQuoteToCandles, INTERVAL_LABEL, isIntraday, toPercentSeries } from '@/lib/utils/chartHelpers';
import { describeAlert, evaluateAlerts, isTriggered, validateAlertInput } from '@/lib/alerts';
import { FetchError, fetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils/cn';
import { json, quote } from '../fixtures';
import { vi } from 'vitest';
import type { Candle, PriceAlert } from '@/lib/types';

const BAD = [null, undefined, NaN, Infinity, -Infinity];

describe('formatters', () => {
  it('formatPrice', () => {
    expect(formatPrice(341.07)).toBe('$341.07');
    expect(formatPrice(1234567.891)).toBe('$1,234,567.89');
    expect(formatPrice(0.1234)).toBe('$0.1234');
    expect(formatPrice(0)).toBe('$0.00');
    expect(formatPrice(-2.5)).toBe('-$2.50');
    BAD.forEach((v) => expect(formatPrice(v as number)).toBe(EM_DASH));
  });
  it('formatChange / formatPercent sign handling', () => {
    expect(formatChange(5.149)).toBe('+5.15');
    expect(formatChange(-0.5)).toBe('-0.50');
    expect(formatChange(0)).toBe('0.00');
    expect(formatPercent(1.5331)).toBe('+1.53%');
    expect(formatPercent(-3.333, 1)).toBe('-3.3%');
    BAD.forEach((v) => {
      expect(formatChange(v as number)).toBe(EM_DASH);
      expect(formatPercent(v as number)).toBe(EM_DASH);
    });
  });
  it('formatCompact / formatNumber', () => {
    expect(formatCompact(29_950_100)).toBe('29.95M');
    expect(formatCompact(1_200)).toBe('1.2K');
    expect(formatNumber(1.23456)).toBe('1.23');
    expect(formatNumber(1.25, 1)).toBe('1.3');
    BAD.forEach((v) => {
      expect(formatCompact(v as number)).toBe(EM_DASH);
      expect(formatNumber(v as number)).toBe(EM_DASH);
    });
  });
  it('formatRelative', () => {
    const now = 1_000_000_000_000;
    expect(formatRelative(now - 2_000, now)).toBe('just now');
    expect(formatRelative(now + 60_000, now)).toBe('just now'); // clock skew
    expect(formatRelative(now - 30_000, now)).toBe('30s ago');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelative(Date.UTC(2026, 0, 5, 12), Date.UTC(2026, 1, 1))).toBe('Jan 5');
  });
  it('formatTimeET / formatDate are timezone-stable', () => {
    expect(formatTimeET(Date.UTC(2026, 8, 25, 19, 59))).toBe('03:59:00 PM ET');
    expect(formatDate('2026-09-25')).toBe('Sep 25, 2026');
    expect(formatDate(Date.UTC(2026, 0, 1))).toBe('Jan 1, 2026');
  });
  it('humanize / trendClass / cn', () => {
    expect(humanize('momentum_continuation')).toBe('Momentum continuation');
    expect(humanize('')).toBe('');
    expect(trendClass(1)).toBe('up');
    expect(trendClass(-1)).toBe('down');
    expect(trendClass(0)).toBe('flat');
    BAD.forEach((v) => expect(trendClass(v as number)).toBe('flat'));
    expect(cn('px-2', false && 'hidden', 'px-4')).toBe('px-4');
  });
});

describe('sessionState (America/New_York)', () => {
  const et = (iso: string) => new Date(iso); // ISO with explicit offset
  it.each([
    ['2026-09-25T03:59:00-04:00', 'closed'],
    ['2026-09-25T04:00:00-04:00', 'pre'],
    ['2026-09-25T09:29:00-04:00', 'pre'],
    ['2026-09-25T09:30:00-04:00', 'open'],
    ['2026-09-25T15:59:00-04:00', 'open'],
    ['2026-09-25T16:00:00-04:00', 'post'],
    ['2026-09-25T19:59:00-04:00', 'post'],
    ['2026-09-25T20:00:00-04:00', 'closed'],
    ['2026-09-26T12:00:00-04:00', 'closed'], // Saturday
    ['2026-09-27T12:00:00-04:00', 'closed'], // Sunday
    ['2026-12-15T10:00:00-05:00', 'open'], // EST (winter) handled
  ])('%s → %s', (iso, s) => expect(sessionState(et(iso))).toBe(s));
  it('has labels for every state', () => {
    expect(Object.keys(SESSION_LABEL).sort()).toEqual(['closed', 'open', 'post', 'pre']);
  });
});

describe('applyQuoteToCandles edge cases', () => {
  const bar = (time: number, close = 10): Candle => ({ time, open: 10, high: 11, low: 9, close, volume: 5 });
  const t0 = Date.UTC(2026, 8, 25, 14, 0) / 1000;

  it('returns the same array for empty input, old ticks and unchanged prices', () => {
    const empty: Candle[] = [];
    expect(applyQuoteToCandles(empty, quote(), '5m')).toBe(empty);
    const c = [bar(t0)];
    expect(applyQuoteToCandles(c, quote('X', { timestamp: (t0 - 10) * 1000 }), '5m')).toBe(c);
    expect(applyQuoteToCandles(c, quote('X', { price: 10, timestamp: (t0 + 10) * 1000 }), '5m')).toBe(c);
  });
  it('extends the high/low of the current intraday bar', () => {
    const r = applyQuoteToCandles([bar(t0)], quote('X', { price: 12, timestamp: (t0 + 60) * 1000 }), '5m');
    expect(r.at(-1)).toMatchObject({ time: t0, high: 12, close: 12, low: 9 });
  });
  it('opens a new aligned intraday bar with unknown (0) volume', () => {
    const r = applyQuoteToCandles([bar(t0)], quote('X', { price: 12, timestamp: (t0 + 11 * 60) * 1000 }), '5m');
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ time: t0 + 600, open: 12, high: 12, low: 12, close: 12, volume: 0 });
  });
  it('does not bridge multi-day gaps with synthetic bars', () => {
    const c = [bar(t0)];
    expect(applyQuoteToCandles(c, quote('X', { timestamp: (t0 + 3 * 86_400) * 1000 }), '1h')).toBe(c);
  });
  it('replaces today’s daily bar and appends a new day', () => {
    const day = Date.UTC(2026, 8, 25) / 1000;
    const sameDay = applyQuoteToCandles([bar(day)], quote('X', { price: 12, open: null, high: null, low: null, volume: null, timestamp: Date.UTC(2026, 8, 25, 18) }), '1d');
    expect(sameDay).toHaveLength(1);
    expect(sameDay[0]).toMatchObject({ open: 10, high: 12, low: 12, close: 12, volume: 5 });
    const nextDay = applyQuoteToCandles([bar(day)], quote('X', { price: 13, timestamp: Date.UTC(2026, 8, 28, 15) }), '1d');
    expect(nextDay).toHaveLength(2);
    expect(nextDay[1].time).toBe(Date.UTC(2026, 8, 28) / 1000);
  });
  it('updates the current weekly bar only within the week', () => {
    const wk = Date.UTC(2026, 8, 21) / 1000;
    expect(applyQuoteToCandles([bar(wk)], quote('X', { price: 8, timestamp: (wk + 3 * 86_400) * 1000 }), '1w')[0]).toMatchObject({ low: 8, close: 8 });
    const c = [bar(wk)];
    expect(applyQuoteToCandles(c, quote('X', { timestamp: (wk + 8 * 86_400) * 1000 }), '1w')).toBe(c);
  });
  it('toPercentSeries rebases to the first close; labels cover every interval', () => {
    expect(toPercentSeries([])).toEqual([]);
    expect(toPercentSeries([bar(1, 10), bar(2, 12), bar(3, 9)]).map((p) => +p.value.toFixed(6))).toEqual([0, 20, -10]);
    expect(isIntraday('1h')).toBe(true);
    expect(isIntraday('1d')).toBe(false);
    expect(Object.values(INTERVAL_LABEL)).toEqual(['1m', '5m', '15m', '1H', '1D', '1W']);
  });
});

describe('alerts edge cases', () => {
  const a = (over: Partial<PriceAlert>): PriceAlert => ({ id: '1', symbol: 'AAPL', condition: 'price_above', threshold: 100, createdAt: 0, status: 'active', ...over });
  it('ignores other symbols, inactive alerts and null change%', () => {
    expect(isTriggered(a({}), quote('MSFT', { price: 999 }))).toBe(false);
    expect(isTriggered(a({ status: 'triggered' }), quote('AAPL', { price: 999 }))).toBe(false);
    expect(isTriggered(a({ condition: 'change_pct_above', threshold: 1 }), quote('AAPL', { changePercent: null }))).toBe(false);
    expect(isTriggered(a({ condition: 'change_pct_below', threshold: -1 }), quote('AAPL', { changePercent: -1 }))).toBe(true);
    expect(isTriggered(a({ condition: 'price_below', threshold: 100 }), quote('AAPL', { price: 100 }))).toBe(true);
  });
  it('evaluateAlerts keeps array identity when nothing fires', () => {
    const list = [a({ threshold: 1000 })];
    expect(evaluateAlerts(list, quote()).alerts).toBe(list);
    const r = evaluateAlerts(list, quote('AAPL', { price: 1001 }), 42);
    expect(r.fired[0]).toMatchObject({ status: 'triggered', triggeredAt: 42, triggeredPrice: 1001 });
  });
  it('describeAlert formats every condition', () => {
    expect(describeAlert(a({ condition: 'change_pct_above', threshold: 3 }))).toBe('AAPL · Day change ≥ +3%');
    expect(describeAlert(a({ condition: 'change_pct_below', threshold: -2 }))).toBe('AAPL · Day change ≤ -2%');
    expect(describeAlert(a({ condition: 'price_below', threshold: 99.5 }))).toBe('AAPL · Price falls below $99.50');
  });
  it.each([
    ['price_above', NaN, 10, 'Enter a number'],
    ['price_above', -1, null, 'Price must be positive'],
    ['price_above', 5, 10, 'Already above — current price is $10.00'],
    ['price_below', 15, 10, 'Already below — current price is $10.00'],
    ['price_below', 5, null, null],
    ['change_pct_above', 0, null, 'Percent must be non-zero and within ±100'],
    ['change_pct_above', 150, null, 'Percent must be non-zero and within ±100'],
    ['change_pct_above', -2, null, 'Use a positive % for "change ≥"'],
    ['change_pct_below', 2, null, 'Use a negative % for "change ≤"'],
    ['change_pct_below', -2, null, null],
  ] as const)('validate %s %s (price %s) → %s', (c, t, p, msg) => expect(validateAlertInput(c, t, p)).toBe(msg));
});

describe('fetcher', () => {
  it('returns JSON on success', async () => {
    vi.stubGlobal('fetch', async () => json({ a: 1 }));
    expect(await fetcher('/x')).toEqual({ a: 1 });
  });
  it('wraps API errors with flags and falls back for non-JSON bodies', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'not_configured', message: 'Set KEY' }, 503));
    const e = (await fetcher('/x').catch((x) => x)) as FetchError;
    expect(e).toBeInstanceOf(FetchError);
    expect([e.status, e.message, e.notConfigured, e.rateLimited]).toEqual([503, 'Set KEY', true, false]);
    vi.stubGlobal('fetch', async () => new Response('<html>', { status: 429 }));
    const r = (await fetcher('/x').catch((x) => x)) as FetchError;
    expect([r.message, r.rateLimited, r.body]).toEqual(['Request failed (429)', true, null]);
  });
});
