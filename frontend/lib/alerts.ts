import type { AlertCondition, PriceAlert, Quote } from '@/lib/types';

/**
 * Pure alert evaluation, kept free of React/storage so it can be unit-tested.
 */

export const CONDITION_LABEL: Record<AlertCondition, string> = {
  price_above: 'Price rises above',
  price_below: 'Price falls below',
  change_pct_above: 'Day change ≥',
  change_pct_below: 'Day change ≤',
};

export function describeAlert(a: Pick<PriceAlert, 'condition' | 'threshold' | 'symbol'>): string {
  const t = a.condition.startsWith('change_pct') ? `${a.threshold > 0 ? '+' : ''}${a.threshold}%` : `$${a.threshold.toFixed(2)}`;
  return `${a.symbol} · ${CONDITION_LABEL[a.condition]} ${t}`;
}

export function isTriggered(alert: PriceAlert, quote: Quote): boolean {
  if (alert.status !== 'active' || alert.symbol !== quote.symbol) return false;
  switch (alert.condition) {
    case 'price_above':
      return quote.price >= alert.threshold;
    case 'price_below':
      return quote.price <= alert.threshold;
    case 'change_pct_above':
      return quote.changePercent !== null && quote.changePercent >= alert.threshold;
    case 'change_pct_below':
      return quote.changePercent !== null && quote.changePercent <= alert.threshold;
  }
}

/**
 * Returns the alerts with any newly-triggered ones marked, plus the list of
 * those that just fired. Returns the same array instance when nothing fired so
 * React state updates can bail out.
 */
export function evaluateAlerts(alerts: PriceAlert[], quote: Quote, now = Date.now()) {
  const fired: PriceAlert[] = [];
  const next = alerts.map((a) => {
    if (!isTriggered(a, quote)) return a;
    const t: PriceAlert = { ...a, status: 'triggered', triggeredAt: now, triggeredPrice: quote.price };
    fired.push(t);
    return t;
  });
  return { alerts: fired.length ? next : alerts, fired };
}

/** Validation for the create-alert form; returns an error message or null. */
export function validateAlertInput(condition: AlertCondition, threshold: number, currentPrice: number | null): string | null {
  if (!Number.isFinite(threshold)) return 'Enter a number';
  if (condition.startsWith('price')) {
    if (threshold <= 0) return 'Price must be positive';
    if (currentPrice !== null) {
      if (condition === 'price_above' && threshold <= currentPrice) return `Already above — current price is $${currentPrice.toFixed(2)}`;
      if (condition === 'price_below' && threshold >= currentPrice) return `Already below — current price is $${currentPrice.toFixed(2)}`;
    }
  } else {
    if (threshold === 0 || Math.abs(threshold) > 100) return 'Percent must be non-zero and within ±100';
    if (condition === 'change_pct_above' && threshold < 0) return 'Use a positive % for "change ≥"';
    if (condition === 'change_pct_below' && threshold > 0) return 'Use a negative % for "change ≤"';
  }
  return null;
}
