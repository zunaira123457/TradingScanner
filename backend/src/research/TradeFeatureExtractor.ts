import { Candle } from '@/types';
import { Trade, BacktestUniverse } from '@/types/backtest';
import { TradeFeatureRecord } from '@/types/research';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { dateKey } from '@/backtesting/USMarketCalendar';

export interface ExtractOptions {
  sectorMap?: Map<string, string>;
}

/**
 * Reconstructs the full point-in-time feature set for every closed trade,
 * by rebuilding EXACTLY the same StrategyContext Backtester.ts built at
 * signal time — same buildStrategyContext(...) call, same asOfIndex
 * slicing, same auxiliary-data slicing pattern documented in Backtester.ts.
 * This is diagnostic-only: it never feeds back into signal generation, and
 * it introduces no new look-ahead risk because it reuses the identical,
 * already-audited context-construction path.
 *
 * Outcome fields (won, netPnl, MFE/MAE, etc.) are computed strictly from
 * the CLOSED trade's own entry->exit window and are clearly a separate
 * section of TradeFeatureRecord from the signal-time features — never
 * conflate the two when analyzing this data.
 */
export function extractTradeFeatures(
  trades: Trade[],
  universe: BacktestUniverse,
  options: ExtractOptions = {}
): TradeFeatureRecord[] {
  const records: TradeFeatureRecord[] = [];

  for (const trade of trades) {
    const candles = universe.tickers.get(trade.ticker);
    if (!candles) continue;

    const signalIndex = findIndexForDate(candles, trade.signalDate);
    if (signalIndex === -1) continue;

    const context = buildStrategyContext(trade.ticker, candles, {
      asOfIndex: signalIndex,
      marketIndexCandles: sliceIndexMapTo(universe.indexCandles, signalIndex),
      benchmarkCandles: universe.benchmarkCandles?.slice(0, signalIndex + 1),
      sectorCandles: universe.sectorCandlesByTicker?.get(trade.ticker)?.slice(0, signalIndex + 1) ?? null,
    });

    const snap = context.snapshots[context.snapshots.length - 1];
    const today = context.candles[context.candles.length - 1];

    const recentHighWindow = context.candles.slice(-20);
    const recentHigh = recentHighWindow.length > 0 ? Math.max(...recentHighWindow.map((c) => c.high)) : null;

    const { mfePct, maePct, holdingDays } = computeOutcomeWindow(candles, trade);

    const riskPerShare = trade.entryPrice - trade.stopPrice;

    records.push({
      tradeId: trade.id,
      ticker: trade.ticker,
      sector: options.sectorMap?.get(trade.ticker) ?? null,
      signalDate: trade.signalDate,
      entryDate: trade.entryDate,

      marketRegime: context.marketRegime?.label ?? null,
      regimeCompositeScore: context.marketRegime?.compositeScore ?? null,
      regimeHighVolatility: context.marketRegime?.isHighVolatility ?? null,

      entry: trade.entryPrice,
      stop: trade.stopPrice,
      target: trade.targetPrice,
      riskRewardRatio: riskPerShare > 0 ? (trade.targetPrice - trade.entryPrice) / riskPerShare : null,
      signalScore: trade.signalScore,

      close: today.close,
      sma20: snap.sma20,
      sma50: snap.sma50,
      sma100: snap.sma100,
      sma200: snap.sma200,
      ema9: snap.ema9,
      ema21: snap.ema21,
      ema50: snap.ema50,
      ema200: snap.ema200,
      rsi14: snap.rsi14,
      macd: snap.macd,
      macdSignal: snap.macdSignal,
      macdHistogram: snap.macdHistogram,
      stochK: snap.stochK,
      stochD: snap.stochD,
      roc12: snap.roc12,
      adx14: snap.adx14,
      plusDI14: snap.plusDI14,
      minusDI14: snap.minusDI14,
      atr14: snap.atr14,
      atrPct: snap.atr14 !== null && today.close !== 0 ? snap.atr14 / today.close : null,
      bbUpper: snap.bbUpper,
      bbMiddle: snap.bbMiddle,
      bbLower: snap.bbLower,
      bbWidth: snap.bbWidth,
      bbPosition:
        snap.bbUpper !== null && snap.bbLower !== null && snap.bbUpper !== snap.bbLower
          ? (today.close - snap.bbLower) / (snap.bbUpper - snap.bbLower)
          : null,
      historicalVolatility20: snap.historicalVolatility20,
      volumeSma20: snap.volumeSma20,
      relativeVolume: snap.relativeVolume,
      obv: snap.obv,
      avgDollarVolume30: snap.avgDollarVolume30,

      priceVsSma50Pct: snap.sma50 !== null && snap.sma50 !== 0 ? (today.close - snap.sma50) / snap.sma50 : null,
      priceVsSma200Pct: snap.sma200 !== null && snap.sma200 !== 0 ? (today.close - snap.sma200) / snap.sma200 : null,
      sma50VsSma200Pct:
        snap.sma50 !== null && snap.sma200 !== null && snap.sma200 !== 0
          ? (snap.sma50 - snap.sma200) / snap.sma200
          : null,
      distanceFromRecentHighPct: recentHigh !== null && recentHigh !== 0 ? (recentHigh - today.close) / recentHigh : null,

      trendStructure: context.structure.trend,

      dailyTrend: context.multiTimeframe.dailyTrend,
      weeklyTrend: context.multiTimeframe.weeklyTrend,
      mtfAligned: context.multiTimeframe.aligned,
      mtfAlignmentScore: context.multiTimeframe.alignmentScore,

      relativeStrengthVsBenchmark: context.relativeStrength?.vsBenchmark ?? null,
      outperformingBoth: context.relativeStrength?.outperformingBoth ?? null,

      won: (trade.netPnl ?? 0) > 0,
      netPnl: trade.netPnl,
      rMultiple: trade.rMultiple,
      exitReason: trade.exitReason,
      holdingDays,
      maxFavorableExcursionPct: mfePct,
      maxAdverseExcursionPct: maePct,
    });
  }

  return records;
}

function computeOutcomeWindow(
  candles: Candle[],
  trade: Trade
): { mfePct: number | null; maePct: number | null; holdingDays: number | null } {
  if (!trade.exitDate) return { mfePct: null, maePct: null, holdingDays: null };

  const entryIndex = findIndexForDate(candles, trade.entryDate);
  const exitIndex = findIndexForDate(candles, trade.exitDate);
  if (entryIndex === -1 || exitIndex === -1 || exitIndex < entryIndex) {
    return { mfePct: null, maePct: null, holdingDays: null };
  }

  const window = candles.slice(entryIndex, exitIndex + 1);
  const highestHigh = Math.max(...window.map((c) => c.high));
  const lowestLow = Math.min(...window.map((c) => c.low));

  return {
    mfePct: trade.entryPrice !== 0 ? (highestHigh - trade.entryPrice) / trade.entryPrice : null,
    maePct: trade.entryPrice !== 0 ? (trade.entryPrice - lowestLow) / trade.entryPrice : null,
    holdingDays: (trade.exitDate.getTime() - trade.entryDate.getTime()) / (1000 * 60 * 60 * 24),
  };
}

function findIndexForDate(candles: Candle[], date: Date): number {
  const key = dateKey(date);
  return candles.findIndex((c) => dateKey(c.timestamp) === key);
}

function sliceIndexMapTo(map: Map<string, Candle[]> | undefined, t: number): Map<string, Candle[]> | undefined {
  if (!map) return undefined;
  const sliced = new Map<string, Candle[]>();
  for (const [k, v] of map) sliced.set(k, v.slice(0, t + 1));
  return sliced;
}
