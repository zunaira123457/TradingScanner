import { Candle } from '@/types';
import { Trade } from '@/types/backtest';
import { IntradayTradeFeatureRecord } from '@/types/research';
import { IntradayStrategy, IntradaySnapshot, latestIntradaySnapshot } from '@/types/intraday';
import { buildIntradayContext } from '@/strategies/intraday/IntradayStrategyContext';
import { IntradayIndicatorEngine } from '@/indicators/IntradayIndicatorEngine';
import { rsi } from '@/indicators/Momentum';
import { tradingDayKey } from '@/indicators/VWAP';
import { calculateIntradayScore, IntradayMarketContext, intradaySessionPctChange } from '@/scoring/IntradayScoringEngine';

function buildTimestampIndex(candles: Candle[]): Map<number, number> {
  const m = new Map<number, number>();
  candles.forEach((c, i) => m.set(c.timestamp.getTime(), i));
  return m;
}

/** Index of the first bar of the same trading day as candles[idx] — scans backward, so O(bars in that session). */
function sessionStartIndex(candles: Candle[], idx: number): number {
  const key = tradingDayKey(candles[idx].timestamp);
  let start = idx;
  while (start > 0 && tradingDayKey(candles[start - 1].timestamp) === key) start -= 1;
  return start;
}

/**
 * Reconstructs the full point-in-time feature set for every closed intraday
 * trade, by rebuilding EXACTLY the same IntradayContext the backtester
 * built at signal time (same buildIntradayContext + precomputed-snapshot
 * pattern IntradayBacktester.ts uses), then re-running the SAME strategy
 * that produced the trade to get its score breakdown. Diagnostic-only: read
 * access to already-computed, already-audited logic — never feeds back
 * into signal generation. Candidate features not used by any strategy are
 * computed directly from the same context/candles, introducing no new
 * look-ahead risk since they only ever read candles[0..signalIndex].
 */
export function extractIntradayTradeFeatures(
  trades: Trade[],
  universe: Map<string, Candle[]>,
  spyCandles: Candle[],
  strategiesByName: Map<string, IntradayStrategy>
): IntradayTradeFeatureRecord[] {
  const timestampIndex = new Map<string, Map<number, number>>();
  const snapshotsByTicker = new Map<string, IntradaySnapshot[]>();
  const rsi9ByTicker = new Map<string, (number | null)[]>();

  for (const [ticker, candles] of universe) {
    timestampIndex.set(ticker, buildTimestampIndex(candles));
    snapshotsByTicker.set(ticker, IntradayIndicatorEngine.calculateAll(candles));
    rsi9ByTicker.set(ticker, rsi(candles.map((c) => c.close), 9));
  }
  timestampIndex.set('SPY', buildTimestampIndex(spyCandles));
  const spySnapshots = IntradayIndicatorEngine.calculateAll(spyCandles);

  const records: IntradayTradeFeatureRecord[] = [];

  for (const trade of trades) {
    const candles = universe.get(trade.ticker);
    if (!candles) continue;

    const signalIdx = timestampIndex.get(trade.ticker)?.get(trade.signalDate.getTime());
    const entryIdx = timestampIndex.get(trade.ticker)?.get(trade.entryDate.getTime());
    const exitIdx = trade.exitDate ? timestampIndex.get(trade.ticker)?.get(trade.exitDate.getTime()) : undefined;
    if (signalIdx === undefined || entryIdx === undefined || exitIdx === undefined) continue;

    const context = buildIntradayContext(trade.ticker, candles.slice(0, signalIdx + 1), {
      precomputedSnapshots: snapshotsByTicker.get(trade.ticker),
    });
    const snap = latestIntradaySnapshot(context);

    const spyIdx = timestampIndex.get('SPY')?.get(trade.signalDate.getTime());
    const spyContext =
      spyIdx !== undefined
        ? buildIntradayContext('SPY', spyCandles.slice(0, spyIdx + 1), { precomputedSnapshots: spySnapshots })
        : null;
    const market: IntradayMarketContext = { spy: spyContext };

    let scoreTotal = 0,
      scoreTrend = 0,
      scoreMomentum = 0,
      scoreVolume = 0,
      scoreRelativeStrength = 0,
      scoreChartSetup = 0,
      scoreMarketRegime = 0,
      scoreRiskReward = 0;

    const strategy = strategiesByName.get(trade.strategy);
    if (strategy) {
      const result = strategy.evaluate(context);
      if (result.setupDetected) {
        const breakdown = calculateIntradayScore(context, market, result);
        scoreTotal = breakdown.total;
        scoreTrend = breakdown.trend;
        scoreMomentum = breakdown.momentum;
        scoreVolume = breakdown.volume;
        scoreRelativeStrength = breakdown.relativeStrength;
        scoreChartSetup = breakdown.chartSetup;
        scoreMarketRegime = breakdown.marketRegime;
        scoreRiskReward = breakdown.riskReward;
      }
    }

    // --- Candidate features ---
    const vwapDistancePct = snap.vwap !== null && snap.vwap !== 0 ? (snap.close - snap.vwap) / snap.vwap : null;
    const emaSpreadPct =
      snap.ema9 !== null && snap.ema21 !== null && snap.ema21 !== 0 ? (snap.ema9 - snap.ema21) / snap.ema21 : null;

    const recentWindow = context.candles.slice(-12);
    const recentLow = recentWindow.length > 0 ? Math.min(...recentWindow.map((c) => c.low)) : null;
    const extensionFromRecentLowPct =
      recentLow !== null && snap.close !== 0 ? (snap.close - recentLow) / snap.close : null;

    const todayStartIdx = sessionStartIndex(candles, signalIdx);
    const minutesSinceOpen = (candles[signalIdx].timestamp.getTime() - candles[todayStartIdx].timestamp.getTime()) / 60000;

    const spyIntradayPctChange = spyContext !== null ? intradaySessionPctChange(spyContext) : null;

    let consecutiveUpBars = 0;
    for (let i = signalIdx; i >= 0 && consecutiveUpBars < 10; i--) {
      if (candles[i].close > candles[i].open) consecutiveUpBars += 1;
      else break;
    }

    const fullSnaps = snapshotsByTicker.get(trade.ticker) ?? [];
    const rsi14Delta3Bars =
      snap.rsi14 !== null && signalIdx >= 3 && fullSnaps[signalIdx - 3]?.rsi14 !== null
        ? snap.rsi14 - (fullSnaps[signalIdx - 3].rsi14 as number)
        : null;

    const rsi9 = rsi9ByTicker.get(trade.ticker)?.[signalIdx] ?? null;

    // --- MFE/MAE, entry through exit, in R-multiples of initial risk ---
    const riskPerShare = trade.entryPrice - trade.stopPrice;
    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (let i = entryIdx; i <= exitIdx; i++) {
      maxHigh = Math.max(maxHigh, candles[i].high);
      minLow = Math.min(minLow, candles[i].low);
    }
    const mfeR = riskPerShare > 0 ? (maxHigh - trade.entryPrice) / riskPerShare : null;
    const maeR = riskPerShare > 0 ? (trade.entryPrice - minLow) / riskPerShare : null;

    records.push({
      tradeId: trade.id,
      ticker: trade.ticker,
      strategy: trade.strategy,
      signalDate: trade.signalDate,
      entryDate: trade.entryDate,

      entryRsi14: snap.rsi14,
      entryRelativeVolume: snap.relativeVolume,
      entryEmaAligned: snap.ema9 !== null && snap.ema21 !== null ? snap.ema9 > snap.ema21 : null,
      entryAboveVwap: snap.vwap !== null ? snap.close > snap.vwap : null,
      entryAtrPctOfPrice: snap.atr14 !== null && snap.close > 0 ? snap.atr14 / snap.close : null,
      scoreTrend,
      scoreMomentum,
      scoreVolume,
      scoreRelativeStrength,
      scoreChartSetup,
      scoreMarketRegime,
      scoreRiskReward,
      scoreTotal,

      vwapDistancePct,
      emaSpreadPct,
      extensionFromRecentLowPct,
      minutesSinceOpen,
      spyIntradayPctChange,
      consecutiveUpBars,
      rsi14Delta3Bars,
      rsi9,

      won: (trade.netPnl ?? 0) > 0,
      netPnl: trade.netPnl,
      rMultiple: trade.rMultiple,
      exitReason: trade.exitReason,
      holdingMinutes: trade.exitDate ? (trade.exitDate.getTime() - trade.entryDate.getTime()) / 60000 : null,
      mfeR,
      maeR,
    });
  }

  return records;
}
