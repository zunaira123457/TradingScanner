import * as fs from 'fs';
import * as path from 'path';
import { Trade, PortfolioSnapshot } from '@/types/backtest';
import {
  PaperTradingConfig,
  PaperTradingConfigError,
  NewPaperTradingConfigParams,
  validatePaperTradingConfig,
  buildNewPaperTradingConfig,
  assertConfigMatches,
} from './PaperTradingConfig';
import { AICommentarySummary } from './PaperTradeRecord';
import logger from '@/utils/logger';

export function getConfigPath(stateDir: string): string {
  return path.join(stateDir, 'config.json');
}

export function getHistoryPath(stateDir: string): string {
  return path.join(stateDir, 'history.json');
}

export interface LoadOrInitConfigResult {
  config: PaperTradingConfig;
  wasJustCreated: boolean;
}

/**
 * Loads the locked config, or creates it on the very first run.
 *
 * A missing file means genuinely-first-run — create and lock it.
 * A malformed/corrupted file, or a strategyName mismatch, is a HARD ERROR
 * (throws) — this is locked-forever state; silently re-creating it would
 * silently discard paper-trading history or restart the account's clock
 * without anyone noticing. Recovery is a human decision (restore from
 * backup, or intentionally delete the file to start a new account).
 */
export function loadOrInitPaperTradingConfig(
  stateDir: string,
  expectedStrategyName: string,
  newConfigParams: NewPaperTradingConfigParams
): LoadOrInitConfigResult {
  const configPath = getConfigPath(stateDir);

  if (!fs.existsSync(configPath)) {
    const config = buildNewPaperTradingConfig(newConfigParams);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { config, wasJustCreated: true };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error) {
    throw new PaperTradingConfigError(
      `Failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}. ` +
        'This file is locked-forever paper-trading state — refusing to silently re-create it.'
    );
  }
  const config = validatePaperTradingConfig(raw);
  assertConfigMatches(config, expectedStrategyName);
  return { config, wasJustCreated: false };
}

/**
 * The last run's trade list + equity curve, persisted PURELY so the next
 * run can diff against it for "what's new today" reporting. Explicitly
 * NON-authoritative: the real, authoritative account history is always
 * whatever Backtester.run() computes fresh each time. Deleting this file
 * only loses the "since last run" diff — the next tick will report
 * everything as "since inception" instead of "since yesterday," but the
 * underlying trades/equity are unaffected, since they're recomputed from
 * the same locked start date every time.
 */
export interface PersistedHistory {
  asOfDate: string; // ISO date of the run that produced this snapshot
  trades: Trade[];
  equityCurve: PortfolioSnapshot[];
  aiCommentaryByTradeKey: Record<string, AICommentarySummary>;
}

interface SerializedTrade extends Omit<Trade, 'signalDate' | 'entryDate' | 'exitDate'> {
  signalDate: string;
  entryDate: string;
  exitDate: string | null;
}

interface SerializedSnapshot extends Omit<PortfolioSnapshot, 'date'> {
  date: string;
}

function reviveTrade(t: SerializedTrade): Trade {
  return {
    ...t,
    signalDate: new Date(t.signalDate),
    entryDate: new Date(t.entryDate),
    exitDate: t.exitDate === null ? null : new Date(t.exitDate),
  };
}

function reviveSnapshot(s: SerializedSnapshot): PortfolioSnapshot {
  return { ...s, date: new Date(s.date) };
}

/**
 * Loads the last persisted snapshot. A missing or CORRUPTED history.json is
 * NOT locked-forever state (unlike config.json) — it's a disposable
 * reporting cache, so any problem here is logged and treated as "no prior
 * snapshot" rather than a hard error.
 */
export function loadPersistedHistory(stateDir: string): PersistedHistory | null {
  const historyPath = getHistoryPath(stateDir);
  if (!fs.existsSync(historyPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(historyPath, 'utf-8')) as {
      asOfDate: string;
      trades: SerializedTrade[];
      equityCurve: SerializedSnapshot[];
      aiCommentaryByTradeKey?: Record<string, AICommentarySummary>;
    };
    return {
      asOfDate: raw.asOfDate,
      trades: raw.trades.map(reviveTrade),
      equityCurve: raw.equityCurve.map(reviveSnapshot),
      aiCommentaryByTradeKey: raw.aiCommentaryByTradeKey ?? {},
    };
  } catch (error) {
    logger.warn(
      `Could not read/parse ${historyPath} (${error instanceof Error ? error.message : error}) — treating as no prior snapshot. This is a disposable cache; the account's real history is unaffected.`
    );
    return null;
  }
}

export function savePersistedHistory(stateDir: string, history: PersistedHistory): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(getHistoryPath(stateDir), JSON.stringify(history, null, 2));
}
