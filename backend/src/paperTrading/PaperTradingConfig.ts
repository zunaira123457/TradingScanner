import { isValidDateKey } from './DateIndexLookup';

/**
 * Phase 7 — Paper Trading.
 *
 * DESIGN: rather than an incremental state machine, every tick simply
 * re-runs the exact, unmodified Backtester.run(strategy, universe, config,
 * startIndex, endIndex) — the SAME function every backtest/experiment in
 * this project already uses — with a FIXED, locked `startIndex` (resolved
 * from this locked start DATE) and a growing `endIndex` (the latest
 * available trading day). Because Backtester.run() always builds a fresh
 * Portfolio internally and buildStrategyContext() always sees the FULL
 * historical candle array for indicator/regime warmup regardless of
 * `startIndex`, this reproduces the complete, authoritative paper-trading
 * account history every single run — deterministically, with ZERO changes
 * to Backtester.ts, Portfolio.ts, Execution.ts, PositionSizing.ts,
 * ScoringEngine.ts, or any strategy file, and zero incremental
 * position/cash state to persist or risk corrupting.
 *
 * The ONE thing that must survive between runs is this locked start date.
 * It is written once, on the very first run, and never changed again by
 * this code — see loadOrInitPaperTradingConfig in PaperTradingState.ts.
 *
 * SAFETY: this is a simulation only. Nothing in this module or its
 * siblings ever calls a brokerage or order-execution API — the only
 * external calls anywhere in Phase 7 are the existing, read-only market
 * data downloads already used throughout this project.
 */
export interface PaperTradingConfig {
  lockedStartDate: string; // "YYYY-MM-DD", locked forever after the first run
  strategyName: string;
  initialCapital: number;
  createdAt: string; // ISO timestamp, informational only
  universeVersion: string; // free-text audit tag, informational only
}

export class PaperTradingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaperTradingConfigError';
  }
}

/** Validates a freshly-loaded config object. Throws (does not silently
 * coerce or drop fields) on anything malformed — this is locked-forever
 * state, so a corrupted file must stop the run, never be quietly patched
 * over or re-created. */
export function validatePaperTradingConfig(raw: unknown): PaperTradingConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new PaperTradingConfigError('Paper trading config file is not a valid JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.lockedStartDate !== 'string' || !isValidDateKey(obj.lockedStartDate)) {
    throw new PaperTradingConfigError(
      `Paper trading config's lockedStartDate is missing or malformed (expected "YYYY-MM-DD", got: ${JSON.stringify(obj.lockedStartDate)}).`
    );
  }
  if (typeof obj.strategyName !== 'string' || obj.strategyName.length === 0) {
    throw new PaperTradingConfigError('Paper trading config is missing a valid strategyName.');
  }
  if (typeof obj.initialCapital !== 'number' || !Number.isFinite(obj.initialCapital) || obj.initialCapital <= 0) {
    throw new PaperTradingConfigError('Paper trading config is missing a valid positive initialCapital.');
  }
  if (typeof obj.createdAt !== 'string' || obj.createdAt.length === 0) {
    throw new PaperTradingConfigError('Paper trading config is missing createdAt.');
  }
  if (typeof obj.universeVersion !== 'string' || obj.universeVersion.length === 0) {
    throw new PaperTradingConfigError('Paper trading config is missing universeVersion.');
  }

  return {
    lockedStartDate: obj.lockedStartDate,
    strategyName: obj.strategyName,
    initialCapital: obj.initialCapital,
    createdAt: obj.createdAt,
    universeVersion: obj.universeVersion,
  };
}

export interface NewPaperTradingConfigParams {
  lockedStartDate: string;
  strategyName: string;
  initialCapital: number;
  universeVersion: string;
}

export function buildNewPaperTradingConfig(params: NewPaperTradingConfigParams): PaperTradingConfig {
  if (!isValidDateKey(params.lockedStartDate)) {
    throw new PaperTradingConfigError(
      `Cannot lock a malformed start date (expected "YYYY-MM-DD", got: ${params.lockedStartDate}).`
    );
  }
  if (!Number.isFinite(params.initialCapital) || params.initialCapital <= 0) {
    throw new PaperTradingConfigError(`Cannot lock a non-positive initialCapital (got: ${params.initialCapital}).`);
  }
  return {
    lockedStartDate: params.lockedStartDate,
    strategyName: params.strategyName,
    initialCapital: params.initialCapital,
    createdAt: new Date().toISOString(),
    universeVersion: params.universeVersion,
  };
}

/**
 * A strategyName mismatch is a hard error, not a warning — running a
 * different strategy against an already-locked paper account would corrupt
 * what "performance since inception" even means for that account.
 */
export function assertConfigMatches(config: PaperTradingConfig, expectedStrategyName: string): void {
  if (config.strategyName !== expectedStrategyName) {
    throw new PaperTradingConfigError(
      `Paper trading config was locked for strategy "${config.strategyName}", but this run is for "${expectedStrategyName}". Refusing to proceed — this would corrupt the account's history. To genuinely switch strategies, start a new paper trading account (move or delete the existing data/paper_trading/ directory first).`
    );
  }
}
