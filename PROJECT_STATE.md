# PROJECT_STATE.md — AI-Assisted Stock Research & Paper-Trading Platform

**Last updated:** 2026-08-20
**Purpose of this document:** a complete, self-contained handoff. A new Claude Code session with zero prior context should be able to read this file alone and know exactly what exists, what works, what's proven, what's NOT proven, and what to do next. Where more detail exists in a dedicated report, this file says so and gives the path.

---

## 0. Non-Negotiable Rules (apply to every future session on this project)

These are hard constraints, not preferences. Any work that violates them should be treated as a bug in that work, not a judgment call.

1. **Stocks only.** No crypto, forex, options, or futures.
2. **No live trading, ever, without explicit new instruction.** Paper trading only. There is currently no brokerage integration of any kind, and none should be added without the user explicitly asking for it.
3. **No fabricated data, ever.** Never hard-code fake prices, fake API responses, or fake sector/fundamental data to make something look functional. If a data source is unavailable, say so and leave the gap visible (see Section 6 for two real examples of this already having happened and being handled correctly).
4. **No look-ahead bias.** Every piece of point-in-time logic in this codebase (`buildStrategyContext`, `Backtester.run`, `TradeFeatureExtractor`) has been built and tested specifically to prevent this. Any new code that touches historical simulation must preserve this property and should have an equivalence test proving it (see Section 11).
5. **Do not declare a strategy "good" because Profit Factor > 1 or because a backtest shows a positive return.** The diagnostics phase (Section 13) found the current best-performing strategy's edge is real but concentrated in 3-5 stocks — treat all backtest results as research evidence, not proof of a tradable edge, until validated out-of-sample.
6. **Do not optimize strategy parameters against the same dataset used to evaluate them.** Any parameter change must be pre-registered as a hypothesis and validated on data not used to generate the hypothesis (walk-forward, a new universe, or a genuine forward/holdout period). See Section 14, Experiments.
7. **The AI layer (Phase 5, implemented — Section 7) must not invent signals, indicators, or confidence scores it can't trace to a real computed value**, and must not override the deterministic risk/position-sizing rules. Design proposal in `MOMENTUM_DIAGNOSTICS_REPORT.md` Section 7; implementation detail in this file's Section 7.

---

## 1. What This Project Is

A quantitative research and paper-trading platform for U.S. equities: scans a stock universe, computes technical indicators and chart patterns, classifies market regime, runs three rule-based trading strategies, scores and ranks signals, and backtests everything with a real event-driven engine that avoids look-ahead bias. An AI reasoning layer (Phase 5, read-only decision-support only) has been implemented — see Section 7.

**Current overall verdict** (updated 2026-08-20 after all six pre-registered validation experiments — see `MOMENTUM_VALIDATION_REPORT.md` for full detail): `momentum_continuation` does **not** have a demonstrated, general, broad-based edge. It shows a real, temporally-persistent result on this project's specific 81-stock universe (replicated almost exactly on a genuinely untouched 2015-2019 holdout), but that result (a) does **not** transfer to a different, independently-selected 71-stock universe over the same period, (b) cannot be usefully ranked or filtered by the strategy's own `signalScore` (shown to carry no outcome information at all), and (c) could not be improved by any of three well-motivated, pre-registered refinement attempts. **Not validated for paper trading as a proven, general strategy.** See Section 14 for the full experiment-by-experiment results and Section 15 for what would actually resolve the remaining open question.

---

## 2. Quick Start

```bash
cd "/Users/zunaira/AI Trading Bot/backend"
npm install
cp .env.example .env   # then fill in TWELVE_DATA_API_KEY
npm test                # 441 tests should pass
npm run type-check      # should be clean
```

Key scripts (all in `backend/src/scripts/`, run via `npm run <name>`):

| Script | Command | What it does |
|---|---|---|
| `downloadHistoricalData.ts` | `npm run download-data -- AAPL MSFT` | Downloads/caches OHLCV for given tickers |
| `validateData.ts` | `npm run validate-data -- AAPL MSFT` | Runs data-quality checks + universe filter on cached tickers |
| `analyzeStock.ts` | `npm run analyze-stock -- AAPL` | Prints full Phase 2 quant-engine output for one ticker |
| `generateSignals.ts` | `npm run generate-signals -- AAPL MSFT` | Runs all 3 strategies + scoring on a ticker list, prints ranked signals |
| `downloadUniverse.ts` | `npm run download-universe` | Downloads/caches the full 81-stock hand-curated universe (see Section 8) |
| `runBacktest.ts` | `npm run run-backtest` | Backtests all 3 strategies + 2 benchmarks on the original 5-stock universe |
| `runExpandedBacktest.ts` | `npm run run-expanded-backtest` | Full Phase 4.5 pipeline on the 81-stock universe (~105 min — see Section 12 perf notes) |
| `runMomentumDiagnostics.ts` | `npm run run-momentum-diagnostics` | Deep feature/regime/concentration diagnostics on `momentum_continuation` (~17 min) |
| `analyzeSignalWithAI.ts` | `npm run analyze-signal-ai -- AAPL MSFT` | Phase 5: runs the same Phase 3 pipeline, then adds the read-only AI explanation layer on top of the top-ranked signal. Degrades to a deterministic fallback if `ANTHROPIC_API_KEY` is unset. |

**Important runtime note**: `ts-node`'s default type-checking mode is drastically slower than plain `tsc --noEmit` on this codebase for reasons never fully root-caused (see Section 12). For any long-running script, prefer:
```bash
TS_NODE_TRANSPILE_ONLY=1 npx ts-node -r tsconfig-paths/register src/scripts/<script>.ts
```
after first confirming `npm run type-check` passes cleanly (transpile-only skips type-checking, so only use it once you've verified correctness separately).

---

## 3. Tech Stack

- **Language**: TypeScript (strict mode), Node.js, `ts-node` for direct execution (no compiled build step used day-to-day)
- **Testing**: Jest + ts-jest, `@/` path alias via `tsconfig-paths`
- **HTTP**: axios
- **Logging**: pino + pino-pretty (note: pino's worker-thread transport can silently buffer output during long synchronous computations — see Section 12)
- **Database**: **none yet.** All persistence is a flat-file JSON cache (`backend/data/cache/*.json`) keyed by ticker. `sqlite3` is an installed dependency but unused; `.env.example` references a `DATABASE_URL` that nothing currently reads. A real DB has not been needed because nothing beyond local research scripts exists yet.
- **Market data**: Twelve Data API (free tier) — see Section 6 for capabilities/limits.

## 4. Folder Structure (backend/)

```
backend/
├── src/
│   ├── config/environment.ts       # all env var reading + defaults, validateConfig()
│   ├── types/                      # one file per domain: backtest, strategy, scoring, indicators,
│   │                                # patterns, chartPatterns, analysis, analytics, research, index
│   ├── providers/                  # MarketDataProvider interface, TwelveDataProvider, CacheProvider,
│   │                                # SectorProvider (built but not usable on current API tier — Section 6)
│   ├── data/                       # DataDownloader, DataValidator, StockUniverse, PointInTimeUniverse
│   ├── indicators/                 # MovingAverages, Momentum, Volatility, Volume, IndicatorEngine (the
│   │                                # single shared source every other module reads from)
│   ├── patterns/                   # PriceStructure (swings/trend/support-resistance), ChartPatterns (14
│   │                                # named patterns)
│   ├── analysis/                   # MultiTimeframe, MarketRegime, SectorStrength
│   ├── strategies/                 # StrategyContext (point-in-time context builder — the single riskiest
│   │                                # function in the codebase, see Section 11), TrendPullback, Breakout,
│   │                                # MomentumContinuation, StrategyEngine, RiskReward
│   ├── scoring/                    # ScoringEngine, SignalExplainer, Ranking
│   ├── backtesting/                # Backtester (the event loop), Portfolio, Execution, PositionSizing,
│   │                                # Metrics, TradingCalendar (legacy index-based check),
│   │                                # USMarketCalendar + CalendarAlignment (real date-based join, Phase
│   │                                # 4.5), UniverseFilter, TradeAnalytics, StatisticalEvidence,
│   │                                # WalkForward, SensitivityAnalysis, BuyAndHold, SmaCrossoverStrategy,
│   │                                # DataQualityAudit, Stats
│   ├── research/                   # TradeFeatureExtractor, DistributionAnalysis (built for the
│   │                                # diagnostics phase, Section 13)
│   ├── scripts/                    # all the CLI entry points listed in Section 2
│   └── utils/                      # logger, mathUtils
├── tests/unit/                     # mirrors src/ structure, 45 test files, 398 tests
├── data/cache/                     # gitignored; 91 files currently cached (81-stock universe + SPY/QQQ/
│                                    # IWM/XLK + a couple leftover info/quote files from early testing)
├── .env.example
└── package.json
```

Root-level docs (`/Users/zunaira/AI Trading Bot/`):
- `PROJECT_PLAN.md` — original architecture plan, written at project start, phase checklist
- `PHASE_4_5_REPORT.md` — full expanded-universe backtest report (81 stocks, all breakdowns)
- `MOMENTUM_DIAGNOSTICS_REPORT.md` — the deepest in-sample analysis: feature-level research on `momentum_continuation`, including the concentration finding, and the 6 pre-registered validation experiments (Section 8)
- `MOMENTUM_VALIDATION_REPORT.md` — results and consolidated synthesis of all 6 experiments (2026-08-20): the edge does not generalize across stocks, does replicate across time on the original universe, and none of three motivated refinements survive independent validation
- `PROJECT_STATE.md` — this file

---

## 5. Environment & Configuration

Copy `backend/.env.example` to `backend/.env` and fill in `TWELVE_DATA_API_KEY`. Key variables (all read/defaulted in `src/config/environment.ts`):

| Variable | Default | Notes |
|---|---|---|
| `TWELVE_DATA_API_KEY` | — | required |
| `TWELVE_DATA_REQUESTS_PER_MINUTE` | 8 | matches the actual observed free-tier limit (confirmed empirically twice — see Section 6). Raise this if upgrading plans. |
| `CACHE_DIR` | `./data/cache` | flat-file JSON cache |
| `CACHE_MAX_AGE_HOURS` | 24 | |
| `MIN_PRICE` / `MIN_AVG_VOLUME` / `MIN_AVG_DOLLAR_VOLUME` / `MIN_HISTORY_DAYS` | 1.0 / 100000 / 1000000 / 252 | stock universe liquidity filters |
| `DATA_START_DATE` | 2020-01-01 | default history start for downloads |
| `ANTHROPIC_API_KEY` | — | present in `.env.example` for the future AI layer; **nothing reads it yet** |
| `BACKTEST_SLIPPAGE_BPS` / `BACKTEST_COMMISSION_BPS` | 5 / 2 | used as defaults in backtest scripts, but each script currently hard-codes its own `BacktestConfig` object rather than reading these — check the script if you need to change them |

---

## 6. Data Provider: Twelve Data — Capabilities and Confirmed Limitations

**Everything in this section was verified against the live API, not assumed.**

### What works
- `GET /time_series` — daily OHLCV history. Works reliably once `country: 'United States'` is passed (see bug below).
- `GET /quote` — latest price/volume/`average_volume`. Works with `country: 'United States'`.
- `GET /stocks` — free reference-data endpoint. Returned **4,496 NASDAQ-listed US common stocks** in one call when tested. This means the *architecture* for scanning a large universe exists and works; the *actual downloaded data* in this project (81 stocks) is far smaller for the practical reason below.
- `GET /profile` (sector/industry) — **confirmed `403 Forbidden`** on the current plan: *"available exclusively with grow or pro or ultra or venture or enterprise plans."* One single early exploratory call for AAPL succeeded (likely a brief trial-access allowance); every subsequent call failed identically. **Do not rely on this endpoint being available.** `CachedSectorProvider`/`ISectorProvider` (`src/providers/SectorProvider.ts`) is built and unit-tested against it for when a paid tier exists, but is NOT what's used for sector labels today.

### Two real bugs found and fixed in this provider (both worth knowing about before writing new provider code)
1. **Symbol collision**: with `type: 'stock'` in the request params, the ticker `"QQQ"` silently resolved to an unrelated Canadian Securities Exchange listing (CAD currency) instead of the Nasdaq-100 ETF — a 200 OK response with completely wrong data. Fixed by using `country: 'United States'` instead of `type`, plus a defense-in-depth `assertUSInstrument()` check that now throws on any non-USD response.
2. **`/profile`'s success-response also carries a numeric `code` field**, which an earlier check mistakenly treated as an error signal (`if (response.data.code)`), silently nulling out every sector lookup. Fixed by removing that check and relying on `status === 'error'` / field-presence instead.

### Rate limit
**8 requests/minute confirmed** (not the 800/minute originally guessed and hard-coded — that bug existed for a while before being caught and fixed; `TwelveDataProvider`'s constructor now takes `requestsPerMinute` as a parameter, defaulting to 8, wired from `config.twelveDataRequestsPerMinute`).

### Practical consequence
Downloading full history for "hundreds to thousands" of tickers is **not practical** in this environment at 8 req/min (a 500-ticker universe would take over an hour just for price history). The 81-stock universe currently in `data/cache/` was a deliberate, disclosed compromise — see Section 8.

---

## 7. Phase-by-Phase Summary

### Phase 1 — Foundation (complete)
Market data provider abstraction (`IMarketDataProvider`), `TwelveDataProvider` implementation, file+memory hybrid cache, `DataDownloader`, `DataValidator` (OHLC consistency, gaps, duplicates, quality scoring 0-1), `StockUniverse` liquidity filtering. Verified against real downloaded data (AAPL, 1,666 real candles).

### Phase 2 — Quant Engine (complete)
- **`IndicatorEngine`** — the single shared source for every other module. Computes SMA(20/50/100/200), EMA(9/21/50/200), RSI14, MACD(12/26/9), Stochastic(14/3/3), ROC12, ADX14+DI, ATR14, Bollinger Bands(20,2), historical volatility(20), volume SMA(20), relative volume, OBV, avg dollar volume(30). Every indicator hand-verified or differentially tested against an independent recomputation in `tests/unit/indicators/`. Critically, has a passing test proving `snapshot[i]` is byte-identical whether computed from a truncated or full candle array — this is the property the entire backtesting engine depends on.
- **`PriceStructure`** — swing highs/lows (fractal, retrospective by design), trend structure classification (uptrend/downtrend/sideways via HH/HL/LH/LL), support/resistance, breakout/breakdown detection, consolidation, gaps, pullback detection.
- **`ChartPatterns`** — 14 named patterns (breakout-from-consolidation, breakout-with-volume, pullback-to-EMA21/SMA50, MA-reclaim/rejection, bull/bear flag, double-top/bottom, higher-low-reversal, volatility-contraction, support-bounce, resistance-rejection), each returning `{detected, confidence, invalidationPrice, details}` with a documented deterministic confidence formula.
- **`MultiTimeframe`** — weekly aggregation from daily candles, trend alignment scoring.
- **`MarketRegime`** — classifies `strong_bullish | bullish | neutral | bearish | strong_bearish | high_volatility` from a weighted composite of trend/momentum/drawdown across index tickers (SPY/QQQ/IWM), with `high_volatility` as a hard override regardless of trend direction.
- **`SectorStrength`** — stock vs. sector vs. benchmark relative return with explicit score adjustments.

### Phase 3 — Strategies & Scoring (complete)
- **`buildStrategyContext`** (`strategies/StrategyContext.ts`) — the one function every strategy, the backtester, and the research tooling all call to get a point-in-time-safe `StrategyContext`. Takes an `asOfIndex` and slices the ticker's own candles internally; auxiliary data (index/benchmark/sector candles) must be pre-sliced by the caller — this is the single highest-risk spot for a look-ahead bug and is exactly where Phase 4/4.5 found and fixed real issues (Section 11).
- **Three strategies** (exact current configs in Section 9): `TrendPullbackStrategy`, `BreakoutStrategy`, `MomentumContinuationStrategy`. All implement the same `Strategy` interface (`evaluate(context) → StrategyResult`).
- **`ScoringEngine`** — transparent 0-100 score across 7 weighted categories (Section 10), never AI-influenced.
- **`Ranking`** / **`SignalExplainer`** — deterministic, evidence-cited natural-language explanation (NOT the AI layer — pure template logic reading real computed values).

### Phase 4 — Backtesting Engine (complete)
Event-driven `Backtester`: signal detected using day T's close → queued → filled at day T+1's open (+ slippage) → stop/target monitored day-by-day with a documented conservative same-candle resolution rule (stop wins ties) → 15 metrics computed (`Metrics.ts`) → walk-forward validation (`WalkForward.ts`, sequential out-of-sample windows, no parameter fitting) → parameter sensitivity sweeps (`SensitivityAnalysis.ts`, never auto-selects a "best" value) → two benchmarks (`BuyAndHold.ts`, `SmaCrossoverStrategy.ts` — the latter is a real `Strategy` reusing `sma()`, run through the identical engine). Full methodology in Section 11.

**Original 5-stock result** (AAPL/MSFT/GOOGL/NVDA/TSLA, 2020-2026): momentum_continuation 70 trades, PF 1.59, CAGR 4.29%; trend_pullback 3 trades (too few to matter); breakout 6 trades, PF 0.54 (losing). All three underperformed buy-and-hold SPY (CAGR 13.91%). This small-universe result is what motivated Phase 4.5.

### Phase 4.5 — Expanded Market Validation (complete)
81-stock hand-curated universe (Section 8), real US market holiday calendar + date-based series alignment (`USMarketCalendar.ts` + `CalendarAlignment.ts`, replacing an index-position assumption), data-quality audit before including any ticker, survivorship-bias documentation (`PointInTimeUniverse.ts`), full year/regime/sector/stock-concentration breakdowns (`TradeAnalytics.ts`), Wilson-score confidence intervals + an explicit evidence-classification heuristic (`StatisticalEvidence.ts`). **Full results in Section 13 and in `PHASE_4_5_REPORT.md`.**

### Phase 4.5 Diagnostics — Momentum Continuation Deep-Dive (complete)
Feature-level research: `TradeFeatureExtractor` reconstructs the exact point-in-time indicator/pattern/regime state for every closed trade (reusing `buildStrategyContext`, proven look-ahead-safe by the same equivalence-test technique used everywhere else), `DistributionAnalysis` compares winner vs. loser feature distributions via Cohen's d with explicit sample-size floors. **This is where the concentration finding was made — see Section 13.** Full detail in `MOMENTUM_DIAGNOSTICS_REPORT.md`.

### Phase 5 — AI Layer (complete, read-only decision-support only)
Implemented per the design proposal in `MOMENTUM_DIAGNOSTICS_REPORT.md` Section 7. Sits strictly downstream of `ScoringEngine`/`SignalExplainer`, consuming their outputs only — never upstream of the strategy, never inside the `Backtester`.

- **`src/types/ai.ts`** — `AIAnalysisContext` (the strict, point-in-time-safe DTO the AI layer is allowed to see — deliberately excludes the full candle/snapshot history) and `AIAnalysisResult` (structured output schema; `aiConfidence` is always `null`).
- **`src/ai/AIAnalysisContext.ts`** — `buildAIAnalysisContext()`, the enforcement point for the no-look-ahead/DTO contract. Covered by an equivalence test mirroring `LookAheadAudit.test.ts`.
- **`src/research/HistoricalStrategyStats.ts`** + **`data/research/historicalStrategyStats.json`** — read-only, structured lookup for the exploratory/in-sample regime and baseline statistics from Section 13 below (never hardcoded into a prompt string). 20-trade sufficiency floor, matching `StatisticalEvidence.ts`'s existing convention. No real per-ticker statistics have been extracted yet — `getTickerStats` returns `null` until that's built.
- **`src/ai/AIAnalysisProvider.ts`** — provider interface (mirrors `ISectorProvider`'s pattern), so the app doesn't couple to one LLM vendor.
- **`src/ai/AnthropicAnalysisProvider.ts`** — Claude-backed implementation. Tightly constrained system prompt; forces JSON-only output.
- **`src/ai/validateAIAnalysisResult.ts`** — safety enforcement independent of the prompt: always overwrites `aiConfidence` to `null` and always re-derives `quantitativeScore` from the deterministic context, regardless of what the model returned.
- **`src/ai/deterministicFallback.ts`** + **`src/ai/SignalAnalysisService.ts`** — orchestrator with a timeout (`AI_ANALYSIS_TIMEOUT_MS`, default 20s) that falls back to a purely template-based explanation on any provider failure, timeout, or malformed output. The quantitative pipeline never depends on the AI call succeeding.
- **`src/scripts/analyzeSignalWithAI.ts`** — CLI demonstration (`npm run analyze-signal-ai`) since no frontend exists yet; prints the QUANTITATIVE SIGNAL and AI INTERPRETATION sections clearly separated, the latter always labeled "AI-generated explanation — not a trading signal."
- 43 new tests in `tests/unit/ai/` (see Section 16) covering: context field allowlist, no-look-ahead equivalence + violation-detection, malformed-output handling, `aiConfidence`/score-tampering resistance, sample-size-insufficient labeling, and fallback-on-failure behavior.

Not built yet, deliberately out of scope for this pass: any numeric AI confidence/probability (gated on the Section 14 Experiment 1 calibration check), real per-ticker historical statistics (would require re-running `TradeFeatureExtractor` and persisting the output), and any UI (no frontend exists — see Section 17).

### Phase 6 (Dashboard) / Phase 7 (Paper Trading): NOT STARTED

---

## 8. Current Stock Universe

**81 hand-curated, liquid large/mid-cap U.S. stocks** across 11 sectors, defined in `src/scripts/downloadUniverse.ts` (`UNIVERSE_BY_SECTOR`), all currently cached in `backend/data/cache/` with 1,666 trading days each (2020-01-02 to 2026-08-19), plus SPY/QQQ/IWM for regime/benchmark and a leftover XLK from early Phase 2 testing.

**This is explicitly NOT a random or comprehensive sample** — see Section 6 for why (rate limit makes a larger download impractical). It's a good-faith attempt at sector diversity, selected before any backtest was run (not cherry-picked for results).

**Sector labels are hand-curated** (the same grouping used to build the universe), **not vendor-verified** — see Section 6's `/profile` 403 finding. `getHandCuratedSectorMap()` in `downloadUniverse.ts` inverts `UNIVERSE_BY_SECTOR` into a ticker→sector map used everywhere sector analysis appears.

**No point-in-time universe membership exists.** Every ticker was selected based on being liquid and well-known TODAY, then applied backward across 2020-2026. This is survivorship bias, fully documented in `src/data/PointInTimeUniverse.ts` (`SURVIVORSHIP_BIAS_DISCLOSURE`) and `PointInTimeUniverseProvider` (an interface stub for a future real point-in-time source — currently throws rather than faking data).

---

## 9. Current Strategy Definitions (exact, as of this writing — verified from source, not memory)

All three implement `Strategy { name, description, evaluate(context) → StrategyResult }`. **None have been modified based on diagnostic findings** — every result in this document is from these exact, original, Phase-3-frozen rule sets.

### `trend_pullback` (`src/strategies/TrendPullback.ts`)
Fires when: `close > SMA50 > SMA200` (bullish MA alignment) AND a pullback to EMA21 or SMA50 is detected (via `ChartPatterns.detectPullbackToEma21/Sma50`, which itself requires `structure.trend === 'uptrend'`) AND `RSI14 < 70`.
- Entry = today's close. Stop = last swing low − 0.5×ATR14 (or ATR/percent fallback if no usable swing low). Target = entry + 2.0×risk (reward multiple).
- Default config: `{ rewardMultiple: 2.0, swingLowAtrBuffer: 0.5, fallbackAtrStopMultiple: 2.0, fallbackPercentStop: 0.05, maxRsiForEntry: 70, maxDistancePct: 0.02 }`

### `breakout` (`src/strategies/Breakout.ts`)
Fires when `ChartPatterns.detectBreakoutFromConsolidation` detects a breakout above resistance from a prior ≤8% consolidation range, with relative volume ≥1.5x.
- Entry = breakout close. Stop = the pattern's own invalidation price (resistance × 0.98). Target = measured-move (consolidation range height projected from the breakout point), falling back to a 2.0× reward multiple if the range can't be measured.
- Default config: `{ consolidationLookback: 15, maxRangePct: 0.08, breakoutLookback: 20, volumeMultiplier: 1.5, fallbackRewardMultiple: 2.0 }`

### `momentum_continuation` (`src/strategies/MomentumContinuation.ts`) — the most-studied strategy
Fires when ALL of: `structure.trend === 'uptrend'` AND `ADX14 ≥ 25` AND `+DI14 > -DI14` AND `55 ≤ RSI14 ≤ 85` AND `MACD histogram > 0` AND (`relativeVolume` null or `≥ 1.0`) AND price within 8% of its 20-day high AND (`relativeStrength` null or `outperformingBoth === true`).
- Entry = today's close. Stop = entry − 2.0×ATR14. Target = entry + 2.5×risk.
- Confidence = `min(1, 0.5×(outperforming ? 1 : 0.3) + 0.5×min(1, ADX14/40))`.
- Default config: `{ minAdx: 25, minRsi: 55, maxRsi: 85, minRelativeVolume: 1.0, maxDistanceFromHighPct: 0.08, recentHighLookback: 20, atrStopMultiple: 2.0, rewardMultiple: 2.5 }`

### `sma_crossover` (benchmark, `src/backtesting/SmaCrossoverStrategy.ts`)
Golden-cross benchmark: fires when the 50-day SMA crosses above the 200-day SMA. Stop = entry×0.92 (8% below), target via 2.0× reward multiple. Implemented as a real `Strategy` so it runs through the identical `Backtester`, not a separately-computed approximation.

---

## 10. Scoring Engine (`src/scoring/ScoringEngine.ts`)

Transparent 0-100 score, 7 weighted categories (weights must sum to 1.0, enforced by `validateWeights`):

| Category | Weight | Formula basis |
|---|---|---|
| Trend | 20% | 0.5×multi-timeframe alignment score + 0.5×(uptrend=1/sideways=0.5/downtrend=0) |
| Momentum | 15% | 0.4×RSI(normalized 30-70) + 0.3×(MACD histogram>0?1:0) + 0.3×(ADX/40, gated by +DI>-DI) |
| Volume | 15% | relativeVolume/2.0, capped at 1 |
| Relative Strength | 15% | (scoreAdjustment + 0.10)/0.25, from `SectorStrength` |
| Chart Setup | 20% | the strategy's own `StrategyResult.confidence` directly |
| Market Regime | 5% | fixed mapping: strong_bullish=1.0, bullish=0.75, neutral=0.5, bearish=0.25, strong_bearish=0, high_volatility=0.3 |
| Risk/Reward | 10% | riskRewardRatio/3.0, capped at 1, 0 if ≤0 |

**Classification**: `score ≥ 75` → BUY, `≥ 50` → WATCH, else AVOID — but ALWAYS `AVOID` if `setupDetected === false`, regardless of score (a high score can never manufacture a signal the strategy's own rules didn't fire).

**⚠️ Important finding (Section 13)**: for `momentum_continuation` specifically, this composite `signalScore` was found to have **no measurable relationship with actual trade outcome** (Cohen's d = -0.121, "noise", losers scored marginally higher on average) across 226 real backtested trades. Do not treat this score as validated for ranking or filtering until Experiment 1 (Section 14) is run.

---

## 11. Backtesting Methodology (the part most likely to matter if you touch this code)

**Core loop** (`Backtester.run()`, fully synchronous, no `await` inside — see Section 12 for the practical consequence of this):
1. Execute any entries queued from yesterday's signal, at TODAY's open (+ slippage). Risk/reward *distances* from the original signal are preserved but re-anchored to the actual fill price (not the stale signal-day reference price).
2. Check today's candle for stop/target hits on all open positions.
3. Evaluate new signals as of today's close (`asOfIndex = t`), queue any BUY classification for tomorrow.
4. Record end-of-day equity snapshot.

**Same-candle stop+target ambiguity**: if a candle's range could have hit both, the stop is always assumed to trigger first (documented, deliberately conservative — can only understate performance, never overstate it).

**Position sizing**: risk-based. `shares = floor((equity × maxRiskPerTradePct) / (entry − stop))`.

**No-look-ahead guarantee**: proven via equivalence testing throughout every phase — running the same backtest on a candle array truncated exactly to the as-of date vs. one extended arbitrarily far into the future must produce byte-identical results. This exact technique caught two real bugs:
- A dedicated test (`LookAheadAudit.test.ts`) deliberately reproduces the exact mistake of passing an *unsliced* benchmark array into `buildStrategyContext` and proves the equivalence check catches it (materially different `benchmarkReturn`, not rounding noise) — this is the mandated "prove the test suite detects an injected violation" test from Phase 4.
- `CalendarAlignment.ts`'s gap-detection loop had a timezone bug (`new Date(dateString)` parses as UTC, not local) that produced 30,408 false "gaps" against a universe that was actually perfectly aligned — found during the Phase 4.5 live run, fixed, covered by a regression test.

**Trading calendar**: `USMarketCalendar.ts` computes the real NYSE holiday schedule algorithmically (including Easter/Good Friday via the Meeus/Jones/Butcher algorithm), not from an external API. `CalendarAlignment.ts` joins multiple candle series by actual calendar date (not array index) — this REPLACED an earlier, more fragile index-position assumption (`TradingCalendar.ts` still exists as a legacy length+spot-check validator, kept for backward compatibility with earlier tests, but `CalendarAlignment.alignSeriesByDate` is the real join used in Phase 4.5+).

**Sector exposure limits** are enforced (`Portfolio.canOpenPosition`) but are a **no-op without a `sectorMap` supplied** in `BacktestConfig` — documented, not silently pretended.

**Performance characteristic**: `IndicatorEngine.calculateAll()` recomputes full history on every `asOfIndex` call — O(n²) per ticker. Measured directly: ~210s for one strategy across 81 tickers × 1,666 days. This was NOT rewritten (per explicit instruction to only optimize if a measured bottleneck justifies it) — see Section 12 for the actual numbers and the unresolved question of why later runs in a long-lived process were slower than expected.

---

## 12. Performance & Tooling Notes (learned the hard way — read before running a long script)

1. **`ts-node`'s default mode type-checks the whole program before running anything**, which on this codebase can take minutes with zero output, looking exactly like a hang. Use `TS_NODE_TRANSPILE_ONLY=1` for any long-running script (after confirming `npm run type-check` passes separately).
2. **`Backtester.run()` and friends are synchronous with no yield points.** A script that calls several of them back-to-back with only `logger.info()` between them (pino uses a worker-thread transport) will produce ZERO log output until the entire synchronous chain finishes — this looked like a 6+-minute hang before being diagnosed. Fix: insert `await new Promise(resolve => setImmediate(resolve))` between major sections in any diagnostic/report script (see `yieldToEventLoop()` in `runExpandedBacktest.ts` and `runMomentumDiagnostics.ts` for the pattern).
3. **Unexplained slowdown observed once**: in the Phase 4.5 expanded-backtest run, the sensitivity sweep (nominally ~5x one full backtest's cost) took ~4x longer than that extrapolation predicted, and total runtime was 105 minutes against a ~35-minute estimate. Root cause NOT confirmed (candidates: thermal throttling from over an hour of sustained near-100% CPU, or accumulating memory/GC pressure in one long-lived process running dozens of large backtests back-to-back). The subsequent diagnostics run (a fresh process) was back to the expected ~210s/backtest baseline, which is weak evidence for "long-lived-process degradation" over "the machine was just having a bad hour," but this is genuinely unresolved. **If a future long script seems to be running far slower than its early sections predict, consider restarting it as a fresh process before assuming something is broken.**
4. All three of the above were found during real background runs against live data, not anticipated in advance — a reminder that this project's development pattern has consistently been "unit tests pass" ≠ "the real thing works," and real-data runs have caught genuine bugs every single phase so far.

---

## 13. Key Results Summary

### Phase 4 (5-stock universe: AAPL, MSFT, GOOGL, NVDA, TSLA, 2020-2026)
| Strategy | Trades | Win Rate | Profit Factor | CAGR | Sharpe |
|---|---|---|---|---|---|
| momentum_continuation | 70 | 42.9% | 1.59 | 4.29% | 0.68 |
| trend_pullback | 3 | — | — | — | — (too few trades to matter) |
| breakout | 6 | — | 0.54 | — | — (losing) |
| buy_and_hold SPY | 1 | 100% | ∞ | 13.91% | 0.75 |

### Phase 4.5 (81-stock expanded universe, full detail in `PHASE_4_5_REPORT.md`)
| Strategy | Trades | Stocks | Win Rate | Profit Factor | CAGR | Max DD | Sharpe |
|---|---|---|---|---|---|---|---|
| **momentum_continuation** | 226 | 70 | 34.5% | 1.14 | 3.71% | 22.6% | 0.38 |
| trend_pullback | 45 | 33 | 44.4% | 1.50 | 1.90% | 8.4% | 0.44 |
| breakout | 41 | 34 | 51.2% | 0.94 | -0.18% | 8.0% | -0.05 |
| sma_crossover (benchmark) | 85 | 55 | 42.4% | 1.26 | 1.92% | 11.6% | 0.36 |
| **buy_and_hold SPY (benchmark)** | 1 | 1 | 100% | ∞ | **13.91%** | 34.0% | **0.75** |

No active strategy beat buy-and-hold SPY on CAGR or risk-adjusted return. `momentum_continuation`'s largest trade bucket (`bullish` regime, 82/226 trades) was breakeven-to-negative.

### Diagnostics on `momentum_continuation` (the deepest analysis — full detail in `MOMENTUM_DIAGNOSTICS_REPORT.md`) — **THE MOST IMPORTANT FINDING IN THE PROJECT SO FAR**

Re-running the actual backtest engine with top winning stocks excluded from the tradeable universe:

| Excluded | Trades | Profit Factor | CAGR | Sharpe | Total Return |
|---|---|---|---|---|---|
| *(none, baseline)* | 226 | 1.14 | 3.71% | 0.38 | +27.33% |
| Top 1 (LLY) | 216 | 1.11 | 2.66% | 0.29 | +19.03% |
| **Top 3** (+GE, NVDA) | 202 | **1.00** | **-0.06%** | 0.05 | **-0.42%** |
| **Top 5** (+AMD, NEM) | 204 | **0.95** | **-1.19%** | **-0.05** | **-7.60%** |
| Top 10 | 196 | 0.95 | -1.31% | -0.07 | -8.39% |

**Removing just 3 of the 70 stocks that traded (out of 81 in the universe) completely erases the strategy's edge. Removing 5 makes it a net loser on every metric.** 60% of traded stocks (42/70) had negative expectancy; the median stock lost money (-$1,135) despite a positive mean (+$390) — classic few-big-winners signature.

Other confirmed findings:
- `bullish` regime (largest bucket): no feature reaches "interesting" effect size separating winners from losers — the strategy has no discriminating quality filter there.
- `neutral` regime: the cleanest pattern found — winners are less overbought, better relative-strength performers, further from recent highs (multiple features at Cohen's d ≥ 0.5-1.2).
- `bullish` vs `strong_bullish` regimes differ almost entirely in broad-market 12-day ROC (d=+0.624); the strategy's own filters (ADX, MTF alignment) are statistically identical between the two (d≈0) — the strategy doesn't itself check for market-wide momentum even though that's what's actually driving the regime-level performance gap.
- The system's own `signalScore` shows no relationship with outcome (d=-0.121) — see the warning in Section 10.
- The single strongest overall (pooled) feature separator is `minusDI14` (d=+0.569) — counter-intuitively, winners have HIGHER -DI14 than losers, which contradicts the naive expectation for a bullish-momentum strategy. Flagged as "interesting" — **replication attempted and failed, see Section 14.**

---

## 14. Validation Experiments 1–6 — COMPLETE (2026-08-20)

All six pre-registered experiments from `MOMENTUM_DIAGNOSTICS_REPORT.md` Section 8 have been run. **Full detail, tables, and per-holdout numbers: `MOMENTUM_VALIDATION_REPORT.md`.** Summary:

| # | Question | Verdict |
|---|---|---|
| 1 | Does `signalScore` predict outcome? | **NOT SUPPORTED** — no measurable relationship (ROC-AUC 0.478, below random) |
| 2 | Does the strategy work on a different, independent 71-stock universe (same period)? | Edge: **NOT SUPPORTED** (net loser, PF 0.81). Concentration mechanism: **SUPPORTED** (same top-winner-dependency pattern reappears) |
| 3 | Does the edge persist on the same 81 stocks in a genuinely untouched 2015-2019 period? | **SUPPORTED** — win rate/PF/expectancy nearly identical to 2020-2026; concentration pattern also replicates |
| 4 | Neutral-regime RSI/relative-strength quality filter — does it help? | **NOT SUPPORTED** — opposite-signed effect on the two independent holdouts |
| 5 | Bullish-regime broad-market-momentum gate — does it help? | **NOT SUPPORTED** (strict criterion) — subset itself improves consistently on both holdouts, but portfolio-level capital reallocation cancels the gain |
| 6 | Does the minusDI14 anomaly (d=+0.569) replicate? | **NOT SUPPORTED** — opposite sign on one of two holdouts |

**Bottom line** (see `MOMENTUM_VALIDATION_REPORT.md` Section 3 for the full synthesis): `momentum_continuation` does not have a demonstrated, general, broad-based edge. It shows a real, temporally-persistent result specific to this project's 81-stock universe, but that result does not transfer to a different comparable universe, cannot be usefully filtered by its own quality score, and could not be improved by any of three well-motivated refinement attempts. Not validated for paper trading as a proven, general strategy.

**None of the tested refinements (Experiments 4-6) should be implemented as strategy changes** — all failed their pre-registered out-of-sample validation per `MOMENTUM_DIAGNOSTICS_REPORT.md` Section 6's discipline.

---

## 15. Recommended Next Steps for a Fresh Session

**If continuing quantitative work — Experiments 1-6 are DONE (Section 14, full detail in `MOMENTUM_VALIDATION_REPORT.md`).** The open question they leave behind, ranked by how directly it would resolve things:
1. **Test a second (or third) independent universe.** Experiment 2 is an n=1 result on "does this generalize across stocks" — one non-replication is real evidence but not proof it never generalizes. Another independent universe would meaningfully firm this up either way.
2. **A genuine forward test.** Experiment 3 used a pre-2020 holdout because no live paper-trading system exists (Phase 7). An actual forward period on the original 81-stock universe would be the first truly prospective validation.
3. **Investigate *why* the original universe works but the second doesn't** — sector composition, average market cap, historical volatility regime, or survivorship bias (the original universe was picked for being well-known *today* — see `PointInTimeUniverse.ts`) are all plausible, testable explanations.

Two research infrastructure pieces now exist and are reusable for any of the above: `src/research/SecondUniverse.ts` (a second, verified-non-overlapping 71-stock universe) and `data/cache_holdout_pre2020/` (an isolated, pre-committed 2015-2019 cache — **never** point a download at the production `data/cache/` with a pre-2020 date range, since `HybridCacheProvider.setCandles()` overwrites the whole cached file per ticker and would destroy the 2020-2026 dataset every other result in this project depends on).

**Phase 5 (AI layer) is implemented** — see Section 7 for exactly what exists. If extending it further:
- Do NOT add a numeric AI confidence/probability — `validateAIAnalysisResult.ts` currently forces `aiConfidence` to `null` regardless of what the model returns, and Experiment 1 (Section 14) actively strengthens the case for keeping it that way: `signalScore` has now been shown to carry no outcome information at all.
- Real per-ticker historical stats (`HistoricalStrategyStats.getTickerStats`) would need `TradeFeatureExtractor` re-run and its output persisted into `data/research/historicalStrategyStats.json`'s `tickers` section — currently empty, by design, rather than fabricated.
- If a frontend gets built later (Phase 6), integrate the AI layer via `SignalAnalysisService` — it already returns a structured `AIAnalysisOutcome` a UI can render section-by-section, with the "AI-generated explanation — not a trading signal" framing preserved.

**If asked to make the strategies "better" or "more profitable":**
- Push back / clarify scope before touching strategy code. The honest current state, now with Experiments 1-6 complete: `momentum_continuation` has a real but universe-specific, concentration-dependent, and unfilterable-by-its-own-score edge that did not survive any of three independent, well-motivated improvement attempts; `trend_pullback` is under-tested (too few trades even at 81 stocks); `breakout` shows a negative edge and is a reasonable candidate to drop rather than fix.
- Any proposed rule change must go through the pre-registration + out-of-sample validation process (`MOMENTUM_DIAGNOSTICS_REPORT.md` Section 6) — this has been stated explicitly to the user multiple times across phases, was just demonstrated three more times in Experiments 4-6, and violating it would break trust in the whole research process.

**If asked to expand the universe further:**
- Check whether a paid Twelve Data tier is now available (would unlock `/profile` for real sector data and remove the 8 req/min bottleneck) before assuming the same constraints still apply.

---

## 16. Test Suite Status

**488 tests passing, 55 test files, clean `tsc --noEmit`** (verified 2026-08-20, after completing Experiments 1-6).

Breakdown by area: `backtesting/` (19 files — the largest, covers execution/portfolio/metrics/walk-forward/sensitivity/calendar/analytics/statistical-evidence), `ai/` (6 files, Phase 5), `research/` (6 files — `TradeFeatureExtractor`, `DistributionAnalysis`, `ScoreCalibration`, `SecondUniverse`, `NeutralQualityFilterVariant`, `BullishMomentumGateVariant`, Experiments 1/4/5), `strategies/` (6), `indicators/` (5), `scoring/` (3), `analysis/` (3), `patterns/` (2), plus single files for `CacheProvider`, `DataValidator`, `StockUniverse`, and the universe-selection script.

Every phase's core no-look-ahead property has a dedicated equivalence test (truncated vs. extended candle arrays must produce identical results) — this is the load-bearing test pattern of the entire codebase and should be the template for testing any new point-in-time logic.

---

## 17. What Has NOT Been Built (be explicit about this with the user if asked)

- No database (flat-file cache only)
- No dashboard/UI of any kind (Phase 5's AI layer is CLI-only for this reason — see Section 7)
- No paper-trading execution/tracking system (Phase 7)
- No calibrated AI confidence score — Phase 5 explicitly does not add one; `aiConfidence` is always `null` until the Section 14 Experiment 1 calibration check is run
- No real per-ticker historical statistics feeding the AI layer yet (`HistoricalStrategyStats.getTickerStats` always returns `null` today — would require re-running `TradeFeatureExtractor` and persisting results)
- No real (vendor-verified) sector/industry classification
- No point-in-time historical universe/constituent data
- No brokerage integration (and none should be added without explicit instruction)
- `trend_pullback` and `breakout` have NOT had the same feature-level diagnostic treatment as `momentum_continuation` — only aggregate Phase 4.5 metrics exist for them
