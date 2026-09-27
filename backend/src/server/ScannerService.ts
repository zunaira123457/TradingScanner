import * as fs from 'fs';
import * as path from 'path';
import { DataDownloader } from '@/data/DataDownloader';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { StrategyEngine } from '@/strategies/StrategyEngine';
import { TrendPullbackStrategy } from '@/strategies/TrendPullback';
import { BreakoutStrategy } from '@/strategies/Breakout';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { calculateScore, classifySignal } from '@/scoring/ScoringEngine';
import { explainSignal } from '@/scoring/SignalExplainer';
import { rankSignals } from '@/scoring/Ranking';
import { findSupport, findResistance } from '@/patterns/PriceStructure';
import { SignalAnalysisService } from '@/ai/SignalAnalysisService';
import { HistoricalStrategyStats } from '@/research/HistoricalStrategyStats';
import { SignalExplanation } from '@/types/scoring';
import { StrategyContext, StrategyResult } from '@/types/strategy';
import { AIAnalysisOutcome, HistoricalBucketStats, HistoricalStrategyBaseline } from '@/types/ai';
import { Candle } from '@/types';
import logger from '@/utils/logger';

/**
 * HTTP-facing wrapper around the existing Phase 3 (strategy/scoring/ranking)
 * and Phase 5 (AI explanation) pipelines. It adds NO new signal logic: every
 * number it returns is copied from StrategyEngine / ScoringEngine /
 * SignalExplainer / IndicatorEngine / HistoricalStrategyStats output, exactly
 * as the CLI scripts (generateSignals.ts, analyzeSignalWithAI.ts) print it.
 *
 * Scans run in the background and are served from an in-memory snapshot, so
 * a cold cache (which must download through the 8 req/min Twelve Data limit)
 * never blocks an HTTP request for minutes.
 */

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'];

export interface ScannerSignalDTO {
  rank: number;
  ticker: string;
  strategy: string;
  classification: SignalExplanation['classification'];
  score: number;
  scoreBreakdown: SignalExplanation['scoreBreakdown'];
  setupDetected: boolean;
  /** Strategy's deterministic 0-1 read on setup strength. NOT a probability of profit. */
  setupStrength: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskRewardRatio: number | null;
  reasons: string[];
  risks: string[];
  invalidation: string;
  asOf: string;
  historical: {
    baseline: HistoricalStrategyBaseline | null;
    regime: HistoricalBucketStats | null;
    ticker: HistoricalBucketStats | null;
  };
}

export interface ScanSnapshot {
  status: 'idle' | 'warming' | 'ready' | 'error';
  universe: string[];
  generatedAt: string | null;
  durationMs: number | null;
  progress: { done: number; total: number };
  marketRegime: StrategyContext['marketRegime'];
  signals: ScannerSignalDTO[];
  errors: { ticker: string; message: string }[];
}

interface Evaluated {
  context: StrategyContext;
  result: StrategyResult;
  explanation: SignalExplanation;
}

export class ScannerService {
  private engine = new StrategyEngine();
  private snapshot: ScanSnapshot;
  private running: Promise<void> | null = null;
  private analysisCache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private downloader: DataDownloader,
    private analysisService: SignalAnalysisService,
    private historicalStats: HistoricalStrategyStats,
    private universe: string[],
    private options: { analysisCacheMs: number; paperTradingDir: string }
  ) {
    this.engine.register(new TrendPullbackStrategy());
    this.engine.register(new BreakoutStrategy());
    this.engine.register(new MomentumContinuationStrategy());
    this.snapshot = {
      status: 'idle',
      universe,
      generatedAt: null,
      durationMs: null,
      progress: { done: 0, total: universe.length },
      marketRegime: null,
      signals: [],
      errors: [],
    };
  }

  getSnapshot(): ScanSnapshot {
    return this.snapshot;
  }

  /** Starts a background scan unless one is already in flight. */
  refresh(): Promise<void> {
    if (!this.running) {
      this.running = this.runScan().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async loadIndexCandles(): Promise<Map<string, Candle[]>> {
    const indexCandles = new Map<string, Candle[]>();
    for (const idx of INDEX_TICKERS) {
      try {
        const { candles } = await this.downloader.downloadStock(idx);
        indexCandles.set(idx, candles);
      } catch (error) {
        logger.warn(`Scanner: could not load index ${idx}: ${errorMessage(error)}`);
      }
    }
    return indexCandles;
  }

  private evaluateTicker(ticker: string, candles: Candle[], indexCandles: Map<string, Candle[]>): Evaluated[] {
    const context = buildStrategyContext(ticker, candles, {
      marketIndexCandles: indexCandles.size > 0 ? indexCandles : undefined,
      benchmarkCandles: indexCandles.get('SPY'),
    });
    return this.engine.evaluateAll(context).map((result) => {
      const scoreBreakdown = calculateScore(context, result);
      const classification = classifySignal(scoreBreakdown.total, result.setupDetected);
      const explanation = explainSignal(context, result, scoreBreakdown, classification);
      return { context, result, explanation };
    });
  }

  private toDTO(rank: number, e: Evaluated): ScannerSignalDTO {
    const { explanation, result, context } = e;
    const regime = context.marketRegime?.label;
    return {
      rank,
      ticker: explanation.ticker,
      strategy: explanation.strategy,
      classification: explanation.classification,
      score: round(explanation.score, 1),
      scoreBreakdown: explanation.scoreBreakdown,
      setupDetected: result.setupDetected,
      setupStrength: round(result.confidence, 3),
      entry: explanation.entry,
      stop: explanation.stop,
      target: explanation.target,
      riskRewardRatio: explanation.riskRewardRatio,
      reasons: explanation.reasons,
      risks: explanation.risks,
      invalidation: explanation.invalidation,
      asOf: new Date(explanation.date).toISOString(),
      historical: {
        baseline: this.historicalStats.getBaseline(explanation.strategy),
        regime: regime ? this.historicalStats.getRegimeStats(explanation.strategy, regime) : null,
        ticker: this.historicalStats.getTickerStats(explanation.strategy, explanation.ticker),
      },
    };
  }

  private async runScan(): Promise<void> {
    const started = Date.now();
    this.snapshot = {
      ...this.snapshot,
      status: this.snapshot.signals.length > 0 ? 'ready' : 'warming',
      progress: { done: 0, total: this.universe.length },
    };

    try {
      const indexCandles = await this.loadIndexCandles();
      const evaluated: Evaluated[] = [];
      const errors: ScanSnapshot['errors'] = [];

      for (const ticker of this.universe) {
        try {
          const { candles } = await this.downloader.downloadStock(ticker);
          evaluated.push(...this.evaluateTicker(ticker, candles, indexCandles));
        } catch (error) {
          errors.push({ ticker, message: errorMessage(error) });
        }
        this.snapshot = {
          ...this.snapshot,
          progress: { done: this.snapshot.progress.done + 1, total: this.universe.length },
        };
      }

      const ranked = rankSignals(evaluated.map((e) => e.explanation));
      const byKey = new Map(evaluated.map((e) => [`${e.explanation.ticker}:${e.explanation.strategy}`, e]));
      const signals = ranked.map((r) => this.toDTO(r.rank, byKey.get(`${r.ticker}:${r.strategy}`)!));

      this.snapshot = {
        status: 'ready',
        universe: this.universe,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        progress: { done: this.universe.length, total: this.universe.length },
        marketRegime: evaluated[0]?.context.marketRegime ?? null,
        signals,
        errors,
      };
      logger.info(`Scanner: scan complete — ${signals.length} signals, ${errors.length} errors, ${Date.now() - started}ms`);
    } catch (error) {
      logger.error(`Scanner: scan failed: ${errorMessage(error)}`);
      this.snapshot = { ...this.snapshot, status: 'error', errors: [{ ticker: '*', message: errorMessage(error) }] };
    }
  }

  /**
   * Full per-ticker analysis: all three strategy evaluations, computed
   * support/resistance, latest indicators, and (optionally) the Phase 5 AI
   * explanation of the best-scoring strategy for this ticker.
   */
  async analyzeTicker(ticker: string, withAI: boolean) {
    const cacheKey = `${ticker}:${withAI ? 'ai' : 'noai'}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.options.analysisCacheMs) return cached.value;

    const indexCandles = await this.loadIndexCandles();
    const { candles } = await this.downloader.downloadStock(ticker);
    const evaluated = this.evaluateTicker(ticker, candles, indexCandles);
    const ranked = rankSignals(evaluated.map((e) => e.explanation));
    const best = evaluated.find((e) => e.explanation.strategy === ranked[0]?.strategy);
    if (!best) throw new Error(`No strategy results for ${ticker}`);

    const { context } = best;
    const snap = context.snapshots[context.snapshots.length - 1];
    const last = context.candles[context.candles.length - 1];

    let ai: AIAnalysisOutcome | null = null;
    if (withAI) {
      ai = await this.analysisService.analyze(context, best.result, best.explanation);
    }

    const value = {
      ticker,
      asOf: last.timestamp.toISOString(),
      lastClose: last.close,
      levels: {
        support20: findSupport(context.candles, 20),
        resistance20: findResistance(context.candles, 20),
        support60: findSupport(context.candles, 60),
        resistance60: findResistance(context.candles, 60),
        lastSwingHigh: context.structure.lastSwingHigh?.price ?? null,
        lastSwingLow: context.structure.lastSwingLow?.price ?? null,
      },
      structure: context.structure.trend,
      multiTimeframe: context.multiTimeframe,
      marketRegime: context.marketRegime,
      relativeStrength: context.relativeStrength,
      indicators: {
        rsi14: snap.rsi14,
        macd: snap.macd,
        macdSignal: snap.macdSignal,
        macdHistogram: snap.macdHistogram,
        adx14: snap.adx14,
        atr14: snap.atr14,
        sma50: snap.sma50,
        sma200: snap.sma200,
        relativeVolume: snap.relativeVolume,
        historicalVolatility20: snap.historicalVolatility20,
      },
      signals: ranked.map((r) =>
        this.toDTO(r.rank, evaluated.find((e) => e.explanation.strategy === r.strategy)!)
      ),
      ai,
    };
    this.analysisCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  /** Paper-trading record kept by runPaperTradingTick.ts, returned verbatim. */
  getPaperTradingPerformance() {
    const read = (file: string) => {
      const p = path.join(this.options.paperTradingDir, file);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
    };
    const history = read('history.json');
    return {
      config: read('config.json'),
      asOfDate: history?.asOfDate ?? null,
      trades: history?.trades ?? [],
      equityCurve: history?.equityCurve ?? [],
      baselines: ['momentum_continuation', 'trend_pullback', 'breakout']
        .map((s) => this.historicalStats.getBaseline(s))
        .filter((b): b is HistoricalStrategyBaseline => b !== null),
    };
  }
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
