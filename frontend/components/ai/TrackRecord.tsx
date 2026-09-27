'use client';

import { FlaskConical } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/common/StateMessage';
import { usePerformance } from '@/hooks/useScanner';
import { formatDate, formatNumber, formatPrice, humanize } from '@/lib/utils/formatters';

/**
 * Scanner track record: the forward paper-trading log (the honest, out-of-
 * sample evidence) next to the in-sample backtest baseline (with its caveats).
 */
export function TrackRecord({ enabled }: { enabled: boolean }) {
  const { data, error, isLoading } = usePerformance(enabled);
  if (error) return <ErrorState error={error} what="Scanner track record" />;
  if (isLoading || !data) return <LoadingState label="Loading track record…" />;

  const eq = data.equityCurve;
  const start = eq[0]?.equity ?? data.config?.initialCapital ?? null;
  const end = eq.at(-1)?.equity ?? null;
  const ret = start && end ? ((end - start) / start) * 100 : null;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <section className="rounded-lg border border-border p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Forward paper trading (out-of-sample)</h3>
        {data.config ? (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              <div><dt className="text-[11px] text-faint">Strategy</dt><dd className="text-sm">{humanize(data.config.strategyName)}</dd></div>
              <div><dt className="text-[11px] text-faint">Since</dt><dd className="num text-sm">{formatDate(data.config.lockedStartDate)}</dd></div>
              <div><dt className="text-[11px] text-faint">Closed trades</dt><dd className="num text-sm">{data.trades.length}</dd></div>
              <div><dt className="text-[11px] text-faint">Equity</dt><dd className="num text-sm">{formatPrice(end)}</dd></div>
              <div><dt className="text-[11px] text-faint">Return</dt><dd className="num text-sm">{ret === null ? '—' : `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`}</dd></div>
              <div><dt className="text-[11px] text-faint">As of</dt><dd className="num text-sm">{data.asOfDate ? formatDate(data.asOfDate) : '—'}</dd></div>
            </dl>
            {data.trades.length === 0 && (
              <p className="mt-3 text-xs leading-relaxed text-muted">
                No trades have closed yet in the forward test. This is the number that will actually validate the scanner, so it’s shown even while empty.
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-xs text-muted">Paper trading hasn’t been initialised on the scanner host.</p>
        )}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <FlaskConical className="size-3.5" /> Backtest baseline (in-sample)
        </h3>
        {data.baselines.map((b) => (
          <div key={b.strategy} className="mt-3">
            <p className="text-sm font-medium">{humanize(b.strategy)}</p>
            <dl className="mt-2 grid grid-cols-4 gap-3">
              <div><dt className="text-[11px] text-faint">Trades</dt><dd className="num text-sm">{b.trades}</dd></div>
              <div><dt className="text-[11px] text-faint">Profit factor</dt><dd className="num text-sm">{formatNumber(b.profitFactor)}</dd></div>
              <div><dt className="text-[11px] text-faint">Sharpe</dt><dd className="num text-sm">{formatNumber(b.sharpe)}</dd></div>
              <div><dt className="text-[11px] text-faint">CAGR</dt><dd className="num text-sm">{formatNumber(b.cagr)}%</dd></div>
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{b.concentrationNote}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-faint">{b.datasetDescription}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
