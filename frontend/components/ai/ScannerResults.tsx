'use client';

import { useMemo, useState } from 'react';
import { RefreshCw, Radar } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, StateMessage } from '@/components/common/StateMessage';
import { useScanner } from '@/hooks/useScanner';
import { formatDate, formatNumber, formatPrice, formatRelative, humanize } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';
import type { ScannerSignal, SignalClassification } from '@/lib/types';

export const CLASS_TONE: Record<SignalClassification, 'up' | 'warn' | 'neutral'> = { BUY: 'up', WATCH: 'warn', AVOID: 'neutral' };

export const REGIME_LABEL: Record<string, string> = {
  strong_bullish: 'Strong bullish', bullish: 'Bullish', neutral: 'Neutral', bearish: 'Bearish', strong_bearish: 'Strong bearish',
};

/** Per-ticker summary: best-scoring strategy, plus how many rules it passed. */
function bestPerTicker(signals: ScannerSignal[]) {
  const map = new Map<string, ScannerSignal>();
  for (const s of signals) {
    const cur = map.get(s.ticker);
    if (!cur || s.score > cur.score || (s.score === cur.score && s.reasons.length > cur.reasons.length)) map.set(s.ticker, s);
  }
  return [...map.values()];
}

export function ScannerResults({ onSelect, selected }: { onSelect: (t: string) => void; selected: string }) {
  const { data, error, isLoading, mutate } = useScanner();
  const [view, setView] = useState<'actionable' | 'all'>('actionable');
  const [refreshing, setRefreshing] = useState(false);

  const actionable = useMemo(() => (data?.signals ?? []).filter((s) => s.classification !== 'AVOID'), [data]);
  const all = useMemo(() => bestPerTicker(data?.signals ?? []).sort((a, b) => b.score - a.score || b.reasons.length - a.reasons.length), [data]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await fetch('/api/scanner/refresh', { method: 'POST' });
      if (!r.ok) throw new Error(r.status === 429 ? 'Refresh is rate-limited — try again in a minute' : `Refresh failed (${r.status})`);
      toast.info('Re-scan started', { description: 'Results update automatically when it finishes.' });
      setTimeout(() => void mutate(), 3_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !data) return <ErrorState error={error} what="AI scanner" />;
  if (isLoading || !data) return <LoadingState label="Contacting scanner…" />;
  if (data.status === 'warming' || data.status === 'idle') {
    return (
      <LoadingState label={`Scanner warming up — ${data.progress.done}/${data.progress.total} tickers loaded`} />
    );
  }

  const rows = view === 'actionable' ? actionable : all;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5 text-xs text-muted">
        <span>
          Universe <b className="num text-text">{data.universe.length}</b>
        </span>
        {data.marketRegime && (
          <span>
            Regime <b className="text-text">{REGIME_LABEL[data.marketRegime.label]}</b>
            {data.marketRegime.isHighVolatility && <Badge tone="warn" className="ml-1">High vol</Badge>}
          </span>
        )}
        <span>
          Setups <b className="num text-text">{actionable.length}</b>
        </span>
        {data.generatedAt && <span title={new Date(data.generatedAt).toLocaleString()}>Scanned {formatRelative(Date.parse(data.generatedAt))}</span>}
        {data.errors.length > 0 && <span className="text-warn" title={data.errors.map((e) => `${e.ticker}: ${e.message}`).join('\n')}>{data.errors.length} tickers failed</span>}
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-md border border-border p-0.5">
            {(['actionable', 'all'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                className={cn('h-6 rounded px-2 font-medium capitalize', view === v ? 'bg-panel-2 text-text' : 'text-muted hover:text-text')}>
                {v === 'actionable' ? 'Setups' : 'All tickers'}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={refreshing} aria-label="Re-run scan" title="Re-run scan">
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <StateMessage icon={<Radar className="size-5 text-muted" />} title="No active setups in the latest scan">
          None of the three strategies (trend pullback, breakout, momentum continuation) triggered on the last daily close.
          That’s a real result, not an error — switch to <button type="button" className="font-medium text-accent hover:underline" onClick={() => setView('all')}>All tickers</button> to see how close each stock is.
        </StateMessage>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-faint">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Ticker</th>
                <th className="px-2 py-2 font-medium">Signal</th>
                <th className="px-2 py-2 font-medium">Strategy</th>
                <th className="px-2 py-2 text-right font-medium" title="Deterministic 0-100 score. Not a probability.">Score</th>
                <th className="px-2 py-2 text-right font-medium">Entry</th>
                <th className="px-2 py-2 text-right font-medium">Stop</th>
                <th className="px-2 py-2 text-right font-medium">Target</th>
                <th className="px-2 py-2 text-right font-medium">R:R</th>
                <th className="px-4 py-2 font-medium">{view === 'all' ? 'Rules passed' : 'As of'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={`${s.ticker}:${s.strategy}`}
                  onClick={() => onSelect(s.ticker)}
                  className={cn('cursor-pointer border-b border-border/60 last:border-0 hover:bg-panel-2/60', s.ticker === selected && 'bg-panel-2')}
                >
                  <td className="px-4 py-2">
                    <button type="button" className="num font-semibold hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(e) => { e.stopPropagation(); onSelect(s.ticker); }}>
                      {s.ticker}
                    </button>
                  </td>
                  <td className="px-2 py-2"><Badge tone={CLASS_TONE[s.classification]}>{s.classification}</Badge></td>
                  <td className="px-2 py-2 text-muted">{humanize(s.strategy)}</td>
                  <td className="px-2 py-2 text-right">
                    <span className="num">{s.score.toFixed(0)}</span>
                    <span className="ml-2 inline-block h-1.5 w-12 overflow-hidden rounded-full bg-panel-2 align-middle">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, s.score)}%` }} />
                    </span>
                  </td>
                  <td className="num px-2 py-2 text-right">{formatPrice(s.entry)}</td>
                  <td className="num px-2 py-2 text-right text-down">{formatPrice(s.stop)}</td>
                  <td className="num px-2 py-2 text-right text-up">{formatPrice(s.target)}</td>
                  <td className="num px-2 py-2 text-right">{formatNumber(s.riskRewardRatio)}</td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {view === 'all' ? (
                      <span title={[...s.reasons.map((r) => `✓ ${r}`), ...s.risks.map((r) => `⚠ ${r}`)].join('\n')}>
                        <span className="text-up">{s.reasons.length} ✓</span> · <span className="text-warn">{s.risks.length} ⚠</span>
                      </span>
                    ) : (
                      formatDate(s.asOf)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border px-4 py-2 text-[11px] leading-relaxed text-faint">
        Scores are the scanner’s deterministic 0–100 ranking, not win probabilities — the project’s own calibration experiment found they don’t predict outcomes. Signals are computed on daily closes.
      </p>
    </div>
  );
}
