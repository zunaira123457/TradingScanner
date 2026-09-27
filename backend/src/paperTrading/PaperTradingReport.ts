import { Trade, PortfolioSnapshot, BacktestMetrics } from '@/types/backtest';
import { AICommentarySummary, TradeDiff, tradeKey } from './PaperTradeRecord';
import { PaperTradingConfig } from './PaperTradingConfig';

/**
 * Documented 81-stock backtest baseline (PROJECT_STATE.md Section 13 / this
 * project's Phase 4.5 report), for context only — never used in any
 * calculation, printed purely as a side-by-side reference so the paper
 * account's numbers are never read in a vacuum.
 */
const DOCUMENTED_BASELINE = {
  trades: 226,
  winRatePct: 34.5,
  profitFactor: 1.14,
  cagrPct: 3.71,
  sharpeRatio: 0.38,
  maxDrawdownPct: 22.6,
  totalReturnPct: 27.33,
};

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function fmtPF(pf: number): string {
  return Number.isFinite(pf) ? pf.toFixed(2) : '∞';
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtMoney(x: number): string {
  const sign = x < 0 ? '-' : '';
  return `${sign}$${Math.abs(x).toFixed(2)}`;
}

export function formatNoNewTradingDayMessage(lastKnownDate: string): string[] {
  return [`No new trading day since the last run (latest available data: ${lastKnownDate}). Nothing to do.`];
}

export function formatNewTradesSection(newlyOpened: Trade[], aiCommentaryByKey: Map<string, AICommentarySummary>): string[] {
  const lines = ['', '-- NEW TRADES OPENED SINCE LAST RUN --'];
  if (newlyOpened.length === 0) {
    lines.push('(none)');
    return lines;
  }
  for (const t of newlyOpened) {
    lines.push(
      `${t.ticker}: entry $${t.entryPrice.toFixed(2)} on ${fmtDate(t.entryDate)} | ${t.shares} shares | stop $${t.stopPrice.toFixed(2)} | target $${t.targetPrice.toFixed(2)} | score ${t.signalScore.toFixed(1)} | regime ${t.marketRegimeAtEntry ?? 'n/a'}`
    );
    const commentary = aiCommentaryByKey.get(tradeKey(t));
    if (commentary) {
      lines.push(`  AI (${commentary.source}): ${commentary.summary}`);
    }
  }
  return lines;
}

export function formatClosedTradesSection(newlyClosed: Trade[]): string[] {
  const lines = ['', '-- TRADES CLOSED SINCE LAST RUN --'];
  if (newlyClosed.length === 0) {
    lines.push('(none)');
    return lines;
  }
  for (const t of newlyClosed) {
    const pnl = t.netPnl ?? 0;
    const result = pnl >= 0 ? 'WIN' : 'LOSS';
    lines.push(
      `${t.ticker}: ${result} ${fmtMoney(pnl)} (${t.rMultiple !== null ? t.rMultiple.toFixed(2) + 'R' : 'n/a'}) | entry $${t.entryPrice.toFixed(2)} -> exit $${t.exitPrice?.toFixed(2) ?? 'n/a'} | reason: ${t.exitReason} | ${fmtDate(t.entryDate)} -> ${t.exitDate ? fmtDate(t.exitDate) : 'n/a'}`
    );
  }
  return lines;
}

export function formatOpenPositionsSection(stillOpen: Trade[], asOfDate: Date): string[] {
  const lines = ['', `-- CURRENT OPEN POSITIONS (marked at ${fmtDate(asOfDate)}'s close, unrealized) --`];
  if (stillOpen.length === 0) {
    lines.push('(none)');
    return lines;
  }
  for (const t of stillOpen) {
    const unrealizedPnl = t.netPnl ?? 0;
    lines.push(
      `${t.ticker}: entry $${t.entryPrice.toFixed(2)} on ${fmtDate(t.entryDate)} | ${t.shares} shares | mark $${t.exitPrice?.toFixed(2) ?? 'n/a'} | unrealized ${fmtMoney(unrealizedPnl)} | stop $${t.stopPrice.toFixed(2)} | target $${t.targetPrice.toFixed(2)}`
    );
  }
  return lines;
}

export function formatAccountSummary(
  finalSnapshot: PortfolioSnapshot | undefined,
  initialCapital: number,
  asOfDate: Date
): string[] {
  if (!finalSnapshot) {
    return ['', '-- ACCOUNT SUMMARY --', '(no equity snapshot available)'];
  }
  const totalReturnPct = ((finalSnapshot.equity - initialCapital) / initialCapital) * 100;
  return [
    '',
    '-- ACCOUNT SUMMARY --',
    `As of: ${fmtDate(asOfDate)}`,
    `Cash: ${fmtMoney(finalSnapshot.cash)} | Equity: ${fmtMoney(finalSnapshot.equity)} | Open positions: ${finalSnapshot.openPositionsCount} | Exposure: ${pct(finalSnapshot.exposurePct)}`,
    `Total return since inception: ${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}% (started at ${fmtMoney(initialCapital)})`,
  ];
}

export function formatPerformanceSinceInception(metrics: BacktestMetrics, lockedStartDate: string): string[] {
  return [
    '',
    `-- PERFORMANCE SINCE INCEPTION (locked start: ${lockedStartDate}) --`,
    `NOTE: these figures include any position still open as of today, marked at today's close — see "Current Open Positions" above for what isn't a final, realized outcome yet.`,
    `Trades: ${metrics.numTrades} | Win rate: ${pct(metrics.winRate)} | Profit factor: ${fmtPF(metrics.profitFactor)}`,
    `CAGR: ${pct(metrics.cagr)} | Sharpe: ${metrics.sharpeRatio.toFixed(2)} | Max drawdown: ${pct(metrics.maxDrawdown)}`,
    `Total return: ${pct(metrics.totalReturn)} | Expectancy: ${fmtMoney(metrics.expectancy)}/trade`,
  ];
}

export function formatBaselineComparison(): string[] {
  return [
    '',
    '-- VS. DOCUMENTED 81-STOCK BACKTEST BASELINE (2020-2026, PROJECT_STATE.md) --',
    `Baseline: ${DOCUMENTED_BASELINE.trades} trades | ${DOCUMENTED_BASELINE.winRatePct}% win rate | PF ${DOCUMENTED_BASELINE.profitFactor} | CAGR ${DOCUMENTED_BASELINE.cagrPct}% | Sharpe ${DOCUMENTED_BASELINE.sharpeRatio} | Max DD ${DOCUMENTED_BASELINE.maxDrawdownPct}% | Total return ${DOCUMENTED_BASELINE.totalReturnPct}%`,
    'IMPORTANT: MOMENTUM_VALIDATION_REPORT.md (Experiments 1-6) found momentum_continuation does NOT have a demonstrated, general, broad-based edge — it did not transfer to an independent universe, its own signalScore carries no outcome information, and none of three motivated refinements improved it out-of-sample. This paper-trading account exists to gather a genuine forward-test data point, not because the strategy is validated.',
  ];
}

/**
 * `asOfDate` is passed in explicitly rather than read off
 * `result.endDate`/`equityCurve[last].date` on purpose: those come from
 * Backtester.ts's own internal `dateAt()`, which reads the timestamp off
 * an arbitrary "first ticker" in the universe Map. In one observed live
 * run, that transiently disagreed by a day from the benchmark-derived date
 * this script uses for locking/idempotency (very likely a live data
 * provider's "latest available bar" changing mid-download across the ~10
 * minute, 80+-ticker download loop — alignSeriesByDate correctly
 * re-intersects on every run, so it self-corrects, but the display should
 * never depend on a second, independent date source when one authoritative
 * value already exists). Always pass the same date used to resolve
 * startIndex/lock the config.
 */
export function formatFullReport(params: {
  config: PaperTradingConfig;
  diff: TradeDiff;
  aiCommentaryByKey: Map<string, AICommentarySummary>;
  finalSnapshot: PortfolioSnapshot | undefined;
  metrics: BacktestMetrics;
  asOfDate: Date;
}): string[] {
  return [
    '='.repeat(70),
    `PAPER TRADING UPDATE — ${fmtDate(params.asOfDate)}`,
    '='.repeat(70),
    ...formatNewTradesSection(params.diff.newlyOpened, params.aiCommentaryByKey),
    ...formatClosedTradesSection(params.diff.newlyClosed),
    ...formatOpenPositionsSection(params.diff.stillOpen, params.asOfDate),
    ...formatAccountSummary(params.finalSnapshot, params.config.initialCapital, params.asOfDate),
    ...formatPerformanceSinceInception(params.metrics, params.config.lockedStartDate),
    ...formatBaselineComparison(),
    '',
    '='.repeat(70),
  ];
}
