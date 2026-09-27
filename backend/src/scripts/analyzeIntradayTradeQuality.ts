/**
 * DIAGNOSTIC ONLY — does not modify any strategy, scoring, or backtester
 * logic. Re-runs the existing IntradayBacktester unmodified against the
 * baseline config to reproduce the exact trade list, then for each closed
 * trade reconstructs the IntradayContext/score the strategy actually saw at
 * signal time (same buildIntradayContext + strategy.evaluate +
 * calculateIntradayScore calls the backtester itself makes internally —
 * called again here purely to inspect their output, not to change it), and
 * computes MFE/MAE (max favorable/adverse excursion, in R-multiples of the
 * trade's own initial risk) from the raw candles between entry and exit.
 *
 * Answers: were losing trades' ENTRIES fundamentally lower-quality than
 * winning trades' entries (visible in the indicators/score at signal time),
 * or did losers look just as good at entry and only diverge afterward
 * (which would point at exit management / stop placement instead)?
 *
 * Usage:
 *   npm run analyze-intraday-trade-quality -- AAPL MSFT GOOGL NVDA TSLA AMD META AMZN NFLX JNJ
 */
import { config, validateConfig } from '@/config/environment';
import { getCachedIntradayCandles } from '@/data/IntradayDataCache';
import { IntradayBacktester, IntradayBacktestConfig } from '@/backtesting/IntradayBacktester';
import { OpeningRangeBreakoutStrategy } from '@/strategies/intraday/OpeningRangeBreakout';
import { VwapTrendContinuationStrategy } from '@/strategies/intraday/VwapTrendContinuation';
import { MomentumBreakoutStrategy } from '@/strategies/intraday/MomentumBreakout';
import { buildIntradayContext } from '@/strategies/intraday/IntradayStrategyContext';
import { calculateIntradayScore, IntradayMarketContext } from '@/scoring/IntradayScoringEngine';
import { latestIntradaySnapshot, IntradayStrategy } from '@/types/intraday';
import { mean, stdDev } from '@/backtesting/Stats';
import { BacktestConfig, Trade } from '@/types/backtest';
import { Candle } from '@/types';
import logger from '@/utils/logger';

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA', 'AMD', 'META', 'AMZN', 'NFLX', 'JNJ'];
const INTERVAL = '5min';

interface TradeDiagnostic {
  ticker: string;
  strategy: string;
  isWin: boolean;
  netPnl: number;
  entryRsi14: number | null;
  entryRelativeVolume: number | null;
  entryEmaAligned: boolean | null; // ema9 > ema21 at entry
  entryAboveVwap: boolean | null;
  entryAtrPctOfPrice: number | null; // atr14 / close — volatility-normalized
  scoreTrend: number;
  scoreMomentum: number;
  scoreVolume: number;
  scoreRelativeStrength: number;
  scoreChartSetup: number;
  scoreMarketRegime: number;
  scoreRiskReward: number;
  scoreTotal: number;
  mfeR: number; // max favorable excursion between entry and exit, in R (initial risk) multiples
  maeR: number; // max adverse excursion between entry and exit, in R multiples
}

function buildTimestampIndex(candles: Candle[]): Map<number, number> {
  const m = new Map<number, number>();
  candles.forEach((c, i) => m.set(c.timestamp.getTime(), i));
  return m;
}

function diagnoseOne(
  trade: Trade,
  universe: Map<string, Candle[]>,
  spyCandles: Candle[],
  timestampIndex: Map<string, Map<number, number>>,
  strategiesByName: Map<string, IntradayStrategy>
): TradeDiagnostic | null {
  const candles = universe.get(trade.ticker);
  if (!candles) return null;

  const signalIdx = timestampIndex.get(trade.ticker)?.get(trade.signalDate.getTime());
  const entryIdx = timestampIndex.get(trade.ticker)?.get(trade.entryDate.getTime());
  const exitIdx = trade.exitDate ? timestampIndex.get(trade.ticker)?.get(trade.exitDate.getTime()) : undefined;
  if (signalIdx === undefined || entryIdx === undefined || exitIdx === undefined) return null;

  // --- Reconstruct exactly what the strategy saw at signal time ---
  const spyIdx = timestampIndex.get('SPY')?.get(trade.signalDate.getTime());
  const spyContext = spyIdx !== undefined ? buildIntradayContext('SPY', spyCandles.slice(0, spyIdx + 1)) : null;
  const market: IntradayMarketContext = { spy: spyContext };

  const context = buildIntradayContext(trade.ticker, candles.slice(0, signalIdx + 1));
  const strategy = strategiesByName.get(trade.strategy);
  const snap = latestIntradaySnapshot(context);

  let scoreTotal = 0,
    scoreTrend = 0,
    scoreMomentum = 0,
    scoreVolume = 0,
    scoreRelativeStrength = 0,
    scoreChartSetup = 0,
    scoreMarketRegime = 0,
    scoreRiskReward = 0;

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

  // --- MFE/MAE: scan every bar from entry through exit (inclusive) ---
  const riskPerShare = trade.entryPrice - trade.stopPrice;
  let maxHigh = -Infinity;
  let minLow = Infinity;
  for (let i = entryIdx; i <= exitIdx; i++) {
    maxHigh = Math.max(maxHigh, candles[i].high);
    minLow = Math.min(minLow, candles[i].low);
  }
  const mfeR = riskPerShare > 0 ? (maxHigh - trade.entryPrice) / riskPerShare : 0;
  const maeR = riskPerShare > 0 ? (trade.entryPrice - minLow) / riskPerShare : 0;

  return {
    ticker: trade.ticker,
    strategy: trade.strategy,
    isWin: (trade.netPnl ?? 0) > 0,
    netPnl: trade.netPnl ?? 0,
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
    mfeR,
    maeR,
  };
}

function compareGroups(label: string, winners: number[], losers: number[]): void {
  const wMean = mean(winners);
  const lMean = mean(losers);
  logger.info(
    `${label.padEnd(24)} | winners: ${wMean.toFixed(3)} (sd ${stdDev(winners).toFixed(3)}) | losers: ${lMean.toFixed(3)} (sd ${stdDev(losers).toFixed(3)}) | diff: ${(wMean - lMean).toFixed(3)}`
  );
}

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const tickers = args.length > 0 ? args.map((t) => t.toUpperCase()) : DEFAULT_TICKERS;

  const universe = new Map<string, Candle[]>();
  for (const ticker of tickers) {
    const candles = getCachedIntradayCandles(ticker, INTERVAL);
    if (candles) universe.set(ticker, candles);
  }
  const spyCandles = getCachedIntradayCandles('SPY', INTERVAL);
  if (!spyCandles || universe.size === 0) {
    logger.error('Missing cached intraday data — run download-intraday-data first.');
    process.exit(1);
  }

  logger.info('='.repeat(70));
  logger.info('INTRADAY TRADE QUALITY DIAGNOSTIC (read-only — no strategy changes)');
  logger.info(`Universe: ${[...universe.keys()].join(', ')}`);
  logger.info('='.repeat(70));

  // --- Reproduce the exact baseline run (unmodified strategies/config) ---
  const backtestConfig: BacktestConfig = {
    startingCapital: 10000,
    maxRiskPerTradePct: config.ibkrDayTradingMaxRiskPerTradePct / 100,
    maxPositions: config.ibkrDayTradingMaxTradesPerDay,
    maxPortfolioExposurePct: 0.9,
    slippageBps: 5,
    commissionBps: 2,
    fractionalShares: false,
  };
  const dayConfig: IntradayBacktestConfig = {
    maxTradesPerDay: config.ibkrDayTradingMaxTradesPerDay,
    maxPositionValueUsd: config.ibkrDayTradingMaxPositionValueUsd,
    trailingPercent: config.ibkrDayTradingTrailPercent,
    startTimeCst: config.ibkrDayTradingStartTimeCst,
    endTimeCst: config.ibkrDayTradingEndTimeCst,
  };
  const strategies: IntradayStrategy[] = [
    new OpeningRangeBreakoutStrategy(),
    new VwapTrendContinuationStrategy(),
    new MomentumBreakoutStrategy(),
  ];
  const strategiesByName = new Map(strategies.map((s) => [s.name, s]));

  const result = new IntradayBacktester().run(strategies, universe, spyCandles, backtestConfig, dayConfig);
  logger.info(`Reproduced baseline run: ${result.trades.length} trades\n`);

  const timestampIndex = new Map<string, Map<number, number>>();
  for (const [ticker, candles] of universe) timestampIndex.set(ticker, buildTimestampIndex(candles));
  timestampIndex.set('SPY', buildTimestampIndex(spyCandles));

  const diagnostics: TradeDiagnostic[] = [];
  for (const trade of result.trades) {
    const d = diagnoseOne(trade, universe, spyCandles, timestampIndex, strategiesByName);
    if (d) diagnostics.push(d);
  }
  logger.info(`Diagnosed ${diagnostics.length}/${result.trades.length} trades (some may be skipped if timestamps don't align exactly)\n`);

  const winners = diagnostics.filter((d) => d.isWin);
  const losers = diagnostics.filter((d) => !d.isWin);
  logger.info(`Winners: ${winners.length} | Losers: ${losers.length}\n`);

  logger.info('--- ENTRY-TIME FEATURES (winners vs losers) ---');
  compareGroups('RSI14', winners.map((d) => d.entryRsi14 ?? NaN).filter((v) => !isNaN(v)), losers.map((d) => d.entryRsi14 ?? NaN).filter((v) => !isNaN(v)));
  compareGroups(
    'Relative volume',
    winners.map((d) => d.entryRelativeVolume ?? NaN).filter((v) => !isNaN(v)),
    losers.map((d) => d.entryRelativeVolume ?? NaN).filter((v) => !isNaN(v))
  );
  compareGroups(
    'ATR % of price',
    winners.map((d) => (d.entryAtrPctOfPrice ?? NaN) * 100).filter((v) => !isNaN(v)),
    losers.map((d) => (d.entryAtrPctOfPrice ?? NaN) * 100).filter((v) => !isNaN(v))
  );
  const pctTrue = (arr: (boolean | null)[]) => {
    const valid = arr.filter((v) => v !== null) as boolean[];
    return valid.length === 0 ? 0 : (valid.filter((v) => v).length / valid.length) * 100;
  };
  logger.info(
    `EMA9>EMA21 at entry        | winners: ${pctTrue(winners.map((d) => d.entryEmaAligned)).toFixed(1)}% | losers: ${pctTrue(losers.map((d) => d.entryEmaAligned)).toFixed(1)}%`
  );
  logger.info(
    `Above VWAP at entry        | winners: ${pctTrue(winners.map((d) => d.entryAboveVwap)).toFixed(1)}% | losers: ${pctTrue(losers.map((d) => d.entryAboveVwap)).toFixed(1)}%`
  );

  logger.info('\n--- SCORE BREAKDOWN AT ENTRY (winners vs losers) ---');
  compareGroups('Trend component', winners.map((d) => d.scoreTrend), losers.map((d) => d.scoreTrend));
  compareGroups('Momentum component', winners.map((d) => d.scoreMomentum), losers.map((d) => d.scoreMomentum));
  compareGroups('Volume component', winners.map((d) => d.scoreVolume), losers.map((d) => d.scoreVolume));
  compareGroups('RelativeStrength component', winners.map((d) => d.scoreRelativeStrength), losers.map((d) => d.scoreRelativeStrength));
  compareGroups('ChartSetup component', winners.map((d) => d.scoreChartSetup), losers.map((d) => d.scoreChartSetup));
  compareGroups('MarketRegime component', winners.map((d) => d.scoreMarketRegime), losers.map((d) => d.scoreMarketRegime));
  compareGroups('RiskReward component', winners.map((d) => d.scoreRiskReward), losers.map((d) => d.scoreRiskReward));
  compareGroups('TOTAL score', winners.map((d) => d.scoreTotal), losers.map((d) => d.scoreTotal));

  logger.info('\n--- MFE / MAE (R-multiples of initial risk, entry through exit) ---');
  compareGroups('MFE (max favorable)', winners.map((d) => d.mfeR), losers.map((d) => d.mfeR));
  compareGroups('MAE (max adverse)', winners.map((d) => d.maeR), losers.map((d) => d.maeR));

  const loserMfeR = losers.map((d) => d.mfeR);
  const losersNeverMovedFavorably = loserMfeR.filter((v) => v < 0.3).length;
  const losersThatMovedThenReversed = loserMfeR.filter((v) => v >= 0.7).length;
  logger.info(
    `\nOf ${losers.length} losing trades: ${losersNeverMovedFavorably} (${((losersNeverMovedFavorably / Math.max(losers.length, 1)) * 100).toFixed(1)}%) ` +
      `never reached even 0.3R favorable before losing (entry-quality signature); ${losersThatMovedThenReversed} (${((losersThatMovedThenReversed / Math.max(losers.length, 1)) * 100).toFixed(1)}%) ` +
      `reached 0.7R+ favorable before reversing into a loss (exit-management signature).`
  );
}

main().catch((error) => {
  logger.error('Trade quality diagnostic failed:', error);
  process.exit(1);
});
