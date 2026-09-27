'use client';

import { useState } from 'react';
import { BellOff, BellRing, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { StateMessage } from '@/components/common/StateMessage';
import { CONDITION_LABEL, describeAlert, validateAlertInput } from '@/lib/alerts';
import { formatPrice, formatRelative } from '@/lib/utils/formatters';
import type { AlertCondition, PriceAlert, Quote } from '@/lib/types';

interface FormProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  symbol: string;
  quote?: Quote;
  onCreate: (symbol: string, c: AlertCondition, threshold: number, note?: string) => void;
}

function defaultThreshold(c: AlertCondition, price: number | null): string {
  if (c.startsWith('price')) return price ? (price * (c === 'price_above' ? 1.02 : 0.98)).toFixed(2) : '';
  return c === 'change_pct_above' ? '3' : '-3';
}

/** Mounted fresh each time the dialog opens, so its state starts from the current quote. */
function AlertForm({ symbol, quote, onCreate, onDone }: { symbol: string; quote?: Quote; onCreate: FormProps['onCreate']; onDone: () => void }) {
  const price = quote?.price ?? null;
  const [condition, setCondition] = useState<AlertCondition>('price_above');
  const [value, setValue] = useState(() => defaultThreshold('price_above', price));
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  const threshold = parseFloat(value);
  const err = validateAlertInput(condition, threshold, price);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (err) return;
        onCreate(symbol, condition, threshold, note);
        onDone();
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">Condition</span>
        <Select
          value={condition}
          onChange={(e) => {
            const c = e.target.value as AlertCondition;
            setCondition(c);
            setValue(defaultThreshold(c, price));
            setTouched(false);
          }}
        >
          {(Object.keys(CONDITION_LABEL) as AlertCondition[]).map((c) => (
            <option key={c} value={c}>{CONDITION_LABEL[c]}{c.startsWith('change') ? ' (%)' : ' ($)'}</option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">{condition.startsWith('price') ? 'Price (USD)' : 'Percent change today'}</span>
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !!err}
          className="num"
          autoFocus
        />
        {touched && err && <span className="text-xs text-down" role="alert">{err}</span>}
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">Note (optional)</span>
        <Input value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder="e.g. breakout above range" />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit">Create alert</Button>
      </div>
    </form>
  );
}

export function AlertDialog({ open, onOpenChange, symbol, quote, onCreate }: FormProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`New alert · ${symbol}`}
        description={quote ? `Last ${formatPrice(quote.price)}. Alerts are watched on the server, so they fire even when this page is closed — turn on push with the bell icon.` : undefined}
      >
        <AlertForm symbol={symbol} quote={quote} onCreate={onCreate} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function AlertsPanel({ alerts, quotes, onRemove, onRearm, onClearTriggered, onSelect, onNew }: {
  alerts: PriceAlert[];
  quotes: Record<string, Quote>;
  onRemove: (id: string) => void;
  onRearm: (id: string) => void;
  onClearTriggered: () => void;
  onSelect: (s: string) => void;
  onNew: () => void;
}) {
  const active = alerts.filter((a) => a.status === 'active');
  const history = alerts.filter((a) => a.status !== 'active').sort((a, b) => (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0));

  if (alerts.length === 0) {
    return (
      <StateMessage icon={<BellOff className="size-5 text-muted" />} title="No alerts yet">
        Press <kbd className="num rounded bg-panel-2 px-1">A</kbd> or <button type="button" onClick={onNew} className="font-medium text-accent hover:underline">create one</button> for the selected stock. Price targets also appear as dotted lines on the chart.
      </StateMessage>
    );
  }

  const distance = (a: PriceAlert) => {
    const q = quotes[a.symbol];
    if (!q) return null;
    if (a.condition.startsWith('price')) return ((a.threshold - q.price) / q.price) * 100;
    return null;
  };

  return (
    <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border">
      <section>
        <h3 className="flex items-center justify-between px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
          Active <span className="num">{active.length}</span>
        </h3>
        <ul>
          {active.map((a) => {
            const d = distance(a);
            return (
              <li key={a.id} className="group flex items-center gap-3 px-4 py-2 hover:bg-panel-2/60">
                <button type="button" onClick={() => onSelect(a.symbol)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm">{describeAlert(a)}</p>
                  <p className="text-[11px] text-faint">
                    {d !== null ? `${Math.abs(d).toFixed(2)}% away · ` : ''}created {formatRelative(a.createdAt)}{a.note ? ` · ${a.note}` : ''}
                  </p>
                </button>
                <Button variant="ghost" size="icon" onClick={() => onRemove(a.id)} aria-label={`Delete alert ${describeAlert(a)}`}>
                  <Trash2 />
                </Button>
              </li>
            );
          })}
          {active.length === 0 && <li className="px-4 py-4 text-xs text-muted">No active alerts.</li>}
        </ul>
      </section>
      <section>
        <h3 className="flex items-center justify-between px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
          History
          {history.length > 0 && (
            <button type="button" onClick={onClearTriggered} className="normal-case tracking-normal text-muted hover:text-text">Clear</button>
          )}
        </h3>
        <ul>
          {history.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2 hover:bg-panel-2/60">
              <BellRing className="size-4 shrink-0 text-warn" />
              <button type="button" onClick={() => onSelect(a.symbol)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm">{describeAlert(a)}</p>
                <p className="text-[11px] text-faint">
                  Fired at <span className="num">{formatPrice(a.triggeredPrice)}</span> · {a.triggeredAt ? formatRelative(a.triggeredAt) : ''}
                </p>
              </button>
              <Badge tone="warn">Triggered</Badge>
              <Button variant="ghost" size="icon" onClick={() => onRearm(a.id)} aria-label="Re-arm alert" title="Re-arm">
                <RotateCcw />
              </Button>
            </li>
          ))}
          {history.length === 0 && <li className="px-4 py-4 text-xs text-muted">Nothing has fired yet.</li>}
        </ul>
      </section>
    </div>
  );
}
