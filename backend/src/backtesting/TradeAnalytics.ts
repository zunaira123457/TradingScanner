import { Trade } from '@/types/backtest';
import { BucketMetrics, StockContribution, ConcentrationReport } from '@/types/analytics';
import { calculateWinRate, calculateProfitFactor, calculateExpectancy } from './Metrics';

/**
 * Groups CLOSED trades by an arbitrary key (year, market regime, sector,
 * ticker, ...). Trades for which keyFn returns null are excluded from every
 * bucket (used e.g. when a trade has no known sector).
 */
export function bucketTradesBy(trades: Trade[], keyFn: (trade: Trade) => string | null): Map<string, Trade[]> {
  const buckets = new Map<string, Trade[]>();
  for (const trade of trades) {
    if (trade.status !== 'closed') continue;
    const key = keyFn(trade);
    if (key === null) continue;
    const existing = buckets.get(key);
    if (existing) existing.push(trade);
    else buckets.set(key, [trade]);
  }
  return buckets;
}

export function summarizeBucket(label: string, trades: Trade[]): BucketMetrics {
  const netPnl = trades.reduce((s, t) => s + (t.netPnl ?? 0), 0);
  return {
    label,
    trades: trades.length,
    winRate: calculateWinRate(trades),
    profitFactor: calculateProfitFactor(trades),
    expectancy: calculateExpectancy(trades),
    netPnl,
    avgReturn: trades.length > 0 ? netPnl / trades.length : 0,
  };
}

/** Buckets by the calendar year of each trade's EXIT date. */
export function analyzeByYear(trades: Trade[]): BucketMetrics[] {
  const buckets = bucketTradesBy(trades, (t) => (t.exitDate ? String(t.exitDate.getFullYear()) : null));
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, ts]) => summarizeBucket(label, ts));
}

/** Buckets by the market regime recorded at trade ENTRY (Trade.marketRegimeAtEntry). */
export function analyzeByRegime(trades: Trade[]): BucketMetrics[] {
  const buckets = bucketTradesBy(trades, (t) => t.marketRegimeAtEntry);
  return [...buckets.entries()].map(([label, ts]) => summarizeBucket(label, ts));
}

/**
 * Buckets by sector via an external ticker->sector map (from
 * CachedSectorProvider.toSectorMap()). Trades for tickers with no known
 * sector are excluded — NOT silently lumped into an "unknown" bucket that
 * could be misread as a real category.
 */
export function analyzeBySector(trades: Trade[], sectorMap: Map<string, string>): BucketMetrics[] {
  const buckets = bucketTradesBy(trades, (t) => sectorMap.get(t.ticker) ?? null);
  return [...buckets.entries()].map(([label, ts]) => summarizeBucket(label, ts));
}

/**
 * Per-stock P&L contribution and concentration risk. `top5PctOfTotalPnl`
 * can behave non-intuitively (exceed 100%, or be negative) whenever losing
 * stocks partly or fully offset winners — this is arithmetically correct,
 * not a bug, and is exactly the kind of number worth reading carefully
 * rather than skimming.
 */
export function analyzeStockConcentration(trades: Trade[]): ConcentrationReport {
  const buckets = bucketTradesBy(trades, (t) => t.ticker);

  const contributions: StockContribution[] = [...buckets.entries()]
    .map(([ticker, ts]) => ({
      ticker,
      trades: ts.length,
      netPnl: ts.reduce((s, t) => s + (t.netPnl ?? 0), 0),
      winRate: calculateWinRate(ts),
      expectancy: calculateExpectancy(ts),
    }))
    .sort((a, b) => b.netPnl - a.netPnl);

  const totalPnl = contributions.reduce((s, c) => s + c.netPnl, 0);
  const top5Pnl = contributions.slice(0, 5).reduce((s, c) => s + c.netPnl, 0);
  const top5PctOfTotalPnl = totalPnl !== 0 ? (top5Pnl / totalPnl) * 100 : 0;

  const sortedForMedian = [...contributions].sort((a, b) => a.netPnl - b.netPnl);
  const mid = Math.floor(sortedForMedian.length / 2);
  const medianContribution =
    sortedForMedian.length === 0
      ? 0
      : sortedForMedian.length % 2 === 0
        ? (sortedForMedian[mid - 1].netPnl + sortedForMedian[mid].netPnl) / 2
        : sortedForMedian[mid].netPnl;

  return {
    uniqueStocks: contributions.length,
    contributions,
    top10: contributions.slice(0, 10),
    top5PctOfTotalPnl,
    medianContribution,
    stocksWithPositiveExpectancy: contributions.filter((c) => c.expectancy > 0).length,
    stocksWithNegativeExpectancy: contributions.filter((c) => c.expectancy < 0).length,
  };
}
