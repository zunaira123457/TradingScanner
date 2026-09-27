import * as fs from 'fs';
import * as path from 'path';
import { HistoricalBucketStats, HistoricalStrategyBaseline } from '@/types/ai';

/**
 * Below this trade count, a bucket is flagged `sampleSizeSufficient: false`
 * and the AI layer must not draw a conclusion from it. Matches the 20-trade
 * floor already established in StatisticalEvidence.ts ("Only N trades —
 * below the 20-trade floor for any confidence at all") — reused here rather
 * than inventing a second threshold for the same judgment.
 */
export const MIN_SAMPLE_SIZE = 20;

/**
 * Read-only lookup for exploratory/in-sample historical strategy statistics
 * (Phase 4.5 + diagnostics findings). Deliberately separate from any prompt
 * string: the AI layer reads structured data through this interface rather
 * than having numbers hardcoded into a prompt template, so the numbers stay
 * in one place and are labeled/thresholded consistently everywhere they're
 * used (see PROJECT_STATE.md Section 5's explicit instruction on this).
 *
 * Every value returned here is EXPLORATORY / IN-SAMPLE — see
 * MOMENTUM_DIAGNOSTICS_REPORT.md Section 6. Nothing in this interface should
 * ever be presented as a validated predictive relationship.
 */
export interface HistoricalStrategyStats {
  getBaseline(strategy: string): HistoricalStrategyBaseline | null;
  getRegimeStats(strategy: string, regime: string): HistoricalBucketStats | null;
  getTickerStats(strategy: string, ticker: string): HistoricalBucketStats | null;
}

interface RawRegimeOrTickerEntry {
  trades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  note?: string | null;
}

interface RawStrategyEntry {
  baseline: Omit<HistoricalStrategyBaseline, 'strategy'>;
  regimes: Record<string, RawRegimeOrTickerEntry>;
  tickers: Record<string, RawRegimeOrTickerEntry>;
}

type RawStatsFile = Record<string, RawStrategyEntry>;

function toBucketStats(label: string, entry: RawRegimeOrTickerEntry | undefined): HistoricalBucketStats | null {
  if (!entry) return null;
  return {
    label,
    trades: entry.trades,
    winRatePct: entry.winRatePct,
    profitFactor: entry.profitFactor,
    note: entry.note ?? null,
    sampleSizeSufficient: entry.trades >= MIN_SAMPLE_SIZE,
  };
}

/**
 * Loads exploratory historical statistics from a flat JSON file
 * (data/research/historicalStrategyStats.json), matching the flat-file-cache
 * pattern already used elsewhere in this project (no database exists yet —
 * see PROJECT_STATE.md Section 3). Read-only: this provider never writes.
 */
export class JsonHistoricalStrategyStats implements HistoricalStrategyStats {
  private data: RawStatsFile;

  constructor(filePath: string = path.resolve(__dirname, '../../data/research/historicalStrategyStats.json')) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    this.data = JSON.parse(raw) as RawStatsFile;
  }

  getBaseline(strategy: string): HistoricalStrategyBaseline | null {
    const entry = this.data[strategy];
    if (!entry) return null;
    return { strategy, ...entry.baseline };
  }

  getRegimeStats(strategy: string, regime: string): HistoricalBucketStats | null {
    const entry = this.data[strategy];
    if (!entry) return null;
    return toBucketStats(`${strategy} / ${regime}`, entry.regimes[regime]);
  }

  getTickerStats(strategy: string, ticker: string): HistoricalBucketStats | null {
    const entry = this.data[strategy];
    if (!entry) return null;
    return toBucketStats(`${strategy} / ${ticker}`, entry.tickers[ticker]);
  }
}

/**
 * Returns null for everything. Used when no historical statistics source is
 * configured, or in tests — the AI layer must treat a null return exactly
 * like "insufficient data," never fabricate a substitute.
 */
export class NullHistoricalStrategyStats implements HistoricalStrategyStats {
  getBaseline(_strategy: string): HistoricalStrategyBaseline | null {
    return null;
  }
  getRegimeStats(_strategy: string, _regime: string): HistoricalBucketStats | null {
    return null;
  }
  getTickerStats(_strategy: string, _ticker: string): HistoricalBucketStats | null {
    return null;
  }
}
