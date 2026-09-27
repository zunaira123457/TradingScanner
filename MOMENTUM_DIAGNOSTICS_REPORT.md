# Momentum Continuation: Research Diagnostics Report

**Status: COMPLETE.** Live diagnostic run: 2026-08-20, 08:37-08:54 (17.3 minutes).

This is a research and diagnostic phase on top of the completed Phase 4.5 expanded backtest. **No strategy code was modified. No parameters were changed or optimized.** Everything here is exploratory analysis of already-generated backtest results, using the same 81-stock universe, same engine, same fixed `momentum_continuation` rule set from Phase 4.5.

---

## 1. Regime Analysis

Winners vs. losers, feature-by-feature, **within** each regime (so this isolates what separates a good trade from a bad one *given* the regime already fired — not the regime effect itself, which is Section 5).

### strong_bullish (n=57, 24W/33L)
| Feature | Cohen's d | Strength | Winners mean | Losers mean |
|---|---|---|---|---|
| bbPosition | -1.113 | **interesting** | 0.914 | 1.079 |
| minusDI14 | +0.661 | **interesting** | 13.27 | 11.16 |
| relativeVolume | -0.544 | **interesting** | 1.392 | 1.973 |
| rsi14 | -0.462 | weak | 72.3 | 75.2 |
| signalScore | -0.352 | weak | 82.8 | 84.4 |

**Reading this**: losing trades in `strong_bullish` tend to be MORE extended (higher Bollinger position — i.e. closer to or above the upper band) and fire on notably HIGHER relative volume than winners. This is consistent with a "buying a volume-driven blow-off spike" failure pattern — not a clean, statistically airtight conclusion, but a coherent, plausible one.

### neutral (n=52, 20W/32L) — the most differentiated regime
| Feature | Cohen's d | Strength | Winners mean | Losers mean |
|---|---|---|---|---|
| minusDI14 | +1.194 | **interesting** | 16.83 | 13.00 |
| stochK | -0.862 | **interesting** | 75.4 | 84.9 |
| rsi14 | -0.833 | **interesting** | 65.5 | 70.4 |
| stochD | -0.786 | **interesting** | 75.4 | 83.8 |
| relativeStrengthVsBenchmark | +0.779 | **interesting** | 0.208 | 0.128 |
| distanceFromRecentHighPct | +0.775 | **interesting** | 0.030 | 0.016 |
| riskRewardRatio | +0.529 | **interesting** | 2.468 | 2.463 |

**Reading this**: in `neutral` regime, winners are systematically LESS overbought (lower RSI/stochastic), have notably BETTER relative strength vs. SPY, and sit further from their recent high than losers. This is the cleanest, most internally-coherent pattern in the whole dataset: when the broad market isn't giving a tailwind, momentum trades only work when the STOCK itself is genuinely outperforming and not already extended — exactly what you'd intuitively expect a "real" momentum edge to look like.

### bullish (n=82, 25W/57L) — the largest, most important bucket
| Feature | Cohen's d | Strength | Winners mean | Losers mean |
|---|---|---|---|---|
| adx14 | -0.420 | weak | 33.2 | 36.6 |
| stochD | +0.416 | weak | 85.6 | 81.4 |
| stochK | +0.387 | weak | 86.3 | 82.8 |
| distanceFromRecentHighPct | +0.362 | weak | 0.028 | 0.020 |
| bbPosition | -0.358 | weak | 0.917 | 0.983 |

**No feature reaches "interesting" (|d| ≥ 0.5) in this regime.** This is itself the key finding: in the strategy's single largest trade bucket, there is no strong quantitative signal separating winners from losers among the features tested. This is directly consistent with the Phase 4.5 finding that `bullish`-regime trades are roughly breakeven in aggregate — the strategy isn't just unlucky here, it genuinely lacks a differentiating edge within this regime as currently configured.

### bearish (n=24, 7W/17L), strong_bearish (n=6), high_volatility (n=5)
All three flagged `insufficient_sample` (the winner or loser sub-group falls below the 10-trade floor even though total regime n may be larger) — no reliable conclusion possible. Numerically large d-values appear for some features (e.g. bearish's `relativeVolume` d=1.59) but are explicitly NOT trustworthy at this sample size and are not treated as findings.

## 2. Stock-Concentration Analysis

**Baseline (full 70-stock universe that actually traded):**
- 226 trades | Profit factor 1.14 | CAGR 3.71% | Sharpe 0.38 | Sortino 0.53 | Expectancy $120.70/trade | Total return 27.33%
- **Median stock P&L: -$1,135.46 | Mean stock P&L: +$389.69** — the median/mean gap alone confirms a right-skewed, few-big-winners distribution
- **40.00% of stocks were profitable; 40.00% had positive expectancy**

**Re-runs excluding top winners (actual engine re-runs, not post-hoc trade filtering — capital that would have gone to the excluded stock is genuinely reallocated or left idle, exactly as it would in reality):**

| Excluded | Trades | Profit Factor | CAGR | Sharpe | Sortino | Expectancy | Total Return |
|---|---|---|---|---|---|---|---|
| *(none, baseline)* | 226 | 1.14 | 3.71% | 0.38 | 0.53 | +$120.70 | +27.33% |
| Top 1 (LLY) | 216 | 1.11 | 2.66% | 0.29 | 0.41 | +$87.88 | +19.03% |
| **Top 3** (+GE, NVDA) | 202 | **1.00** | **-0.06%** | 0.05 | 0.07 | **-$2.28** | **-0.42%** |
| **Top 5** (+AMD, NEM) | 204 | **0.95** | **-1.19%** | **-0.05** | **-0.07** | **-$37.44** | **-7.60%** |
| Top 10 (+TMO, FCX, UPS, HD, SHW) | 196 | 0.95 | -1.31% | -0.07 | -0.09 | -$42.97 | -8.39% |

**This is the single clearest, most decisive finding in this entire diagnostic pass.** Removing just the top 3 winning stocks — 3 names out of the 70 that actually traded, 3 out of 81 in the universe — takes the strategy from a modestly profitable Sharpe-0.38 result to **exactly breakeven** (profit factor 1.00, CAGR -0.06%). Removing the top 5 makes it a **net loser** on every single metric (negative CAGR, negative Sharpe, negative Sortino, negative expectancy), and removing the top 10 doesn't meaningfully change that picture (it's already lost almost everything by top 5).

**The entire positive result reported in Phase 4.5 depends on 3-5 specific stocks (LLY, GE, NVDA, AMD, NEM) having performed exceptionally well during this specific 2020-2026 period.** This is not "a broad edge with some concentration risk" — it is closer to "no demonstrated broad edge, plus a handful of large individual winners." This directly and unambiguously answers the phase's core question.

## 3. Feature → Outcome Dataset

**Methodology, confirmed by tests before running on real data:**

For every closed `momentum_continuation` trade, the research dataset (`TradeFeatureRecord`) is built by calling the exact same `buildStrategyContext(ticker, candles, { asOfIndex, ... })` construction `Backtester.ts` uses internally at signal time — not a separate, potentially-inconsistent reimplementation. This guarantees the extracted features are provably identical to what the strategy actually saw when it fired, because it's the same function, called the same way, at the same index.

**No-look-ahead verification**: `tests/unit/research/TradeFeatureExtractor.test.ts` includes a dedicated test that extends the stock/index/benchmark series 50 days beyond the last trade's signal date with a sharp, unmistakable future price move, and asserts the extracted feature records are **byte-identical** whether that future data exists or not. This is the same equivalence-testing technique used throughout Phases 2-4.5 to prove point-in-time safety, applied here to a new code path.

**Outcome fields are a clearly separate section** of the record (`won`, `netPnl`, `rMultiple`, `exitReason`, `holdingDays`, `maxFavorableExcursionPct`, `maxAdverseExcursionPct`) — computed strictly from the trade's own already-closed entry→exit window, never fed back into the signal-time feature set. MFE/MAE (maximum favorable/adverse excursion) are standard post-hoc trade-quality metrics, not new trading signals.

**Dataset**: 226 feature records extracted (100% of closed trades — every trade's signal date resolved cleanly). 78 winners, 148 losers.

## 4. Feature → Outcome Ranking

**All 226 trades, winners vs. losers, pooled across every regime** (see Section 1 for the more informative per-regime breakdown — pooling across regimes as done here can mask regime-specific patterns, which is exactly what happened to `regimeCompositeScore`, ranked as "noise" here despite being the single strongest per-regime separator in Section 5).

| Rank | Feature | Cohen's d | Strength | Winners mean | Losers mean |
|---|---|---|---|---|---|
| 1 | minusDI14 | +0.569 | **interesting** | 14.54 | 12.49 |
| 2 | bbPosition | -0.397 | weak | 0.917 | 0.987 |
| 3 | rsi14 | -0.332 | weak | 69.4 | 71.6 |
| 4 | distanceFromRecentHighPct | +0.294 | weak | 0.024 | 0.019 |
| 5 | plusDI14 | -0.245 | weak | 37.0 | 38.8 |
| 6 | riskRewardRatio | +0.222 | weak | 2.467 | 2.465 |
| 7 | relativeVolume | -0.207 | weak | 1.458 | 1.616 |
| 8 | bbWidth | +0.207 | weak | 0.203 | 0.180 |
| — | *(remaining 19 features)* | \|d\| < 0.19 | noise | — | — |

**The single most-ranked feature (minusDI14) is genuinely counter-intuitive**: `MomentumContinuationStrategy` requires `+DI > -DI` to fire at all, so one might expect a LOWER `-DI` to mean a "cleaner" bullish signal and a better trade. The data shows the opposite direction — winners have modestly HIGHER `-DI` on average. This is flagged as "interesting" by the effect-size threshold but should NOT be read as "the strategy should require higher -DI" without out-of-sample validation (see Section 6/8) — it may just as easily be a marker of healthy two-sided volatility during a still-winning trend as a real causal signal.

**Notably, the strategy's own core filter (ADX) shows almost no discriminating power** (d=-0.185, barely below the noise threshold) once a trade has already cleared the `minAdx=25` gate — more ADX beyond the threshold doesn't clearly predict a better outcome in this dataset.

**More concerning: `signalScore` — the system's own composite 0-100 score, the exact number Phase 3's scoring engine and any future ranking/dashboard would present as "how good is this signal" — is ALSO noise** (d=-0.121; losers actually scored marginally HIGHER on average, 81.7 vs. 81.2 for winners). In this dataset, the score the system already produces does not predict which trades win. This is an important, honest gap: it means the score is not yet validated as useful for ranking or filtering `momentum_continuation` signals specifically, and it's the direct reason Section 7's AI-layer proposal treats any AI-stated confidence as requiring its own calibration test before being trusted (Experiment 1, Section 8).

**Win rate by category:**

| Regime | n | Win Rate | Sufficient Sample |
|---|---|---|---|
| strong_bullish | 57 | 42.1% | yes |
| bullish | 82 | 30.5% | yes |
| neutral | 52 | 38.5% | yes |
| bearish | 24 | 29.2% | yes |
| strong_bearish | 6 | 16.7% | no |
| high_volatility | 5 | 20.0% | no |

| Sector | n | Win Rate | Sufficient Sample |
|---|---|---|---|
| Materials | 17 | 52.9% | yes |
| Industrials | 22 | 50.0% | yes |
| Technology | 48 | 43.8% | yes |
| Healthcare | 30 | 36.7% | yes |
| Real Estate | 5 | 40.0% | no |
| Consumer Discretionary | 23 | 30.4% | yes |
| Energy | 26 | 26.9% | yes |
| Communication Services | 20 | 25.0% | yes |
| Financials | 19 | 21.1% | yes |
| Utilities | 9 | 11.1% | no |
| Consumer Staples | 7 | 0.0% | no |

`trendStructure` was `uptrend` for literally 100% of trades (n=226) — unsurprising, since `MomentumContinuationStrategy` requires `context.structure.trend === 'uptrend'` to fire at all. This confirms the feature extraction correctly reproduces the strategy's own deterministic gate rather than an independent signal — not a new finding, a consistency check. — the standardized mean difference between winning and losing trades' values for that feature, using pooled standard deviation. This is a standard exploratory effect-size measure, explicitly **not** a hypothesis test or p-value, and is reported alongside an honest classification:

- `insufficient_sample`: fewer than 10 trades in either group — no conclusion possible
- `noise`: |d| < 0.2 — negligible separation
- `weak`: 0.2 ≤ |d| < 0.5 — a real but small difference
- `interesting`: |d| ≥ 0.5 — a meaningfully large separation, worth investigating further (NOT worth acting on without validation — see Section 6)

## 5. Bullish vs. Strong_Bullish

Comparing ALL trades' signal-time features between the two regime buckets directly (not winners vs. losers — the two regime populations themselves).

| Feature | Cohen's d | Strength | strong_bullish mean | bullish mean |
|---|---|---|---|---|
| regimeCompositeScore | +2.424 | interesting *(tautological — this defines the regime split)* | 0.663 | 0.463 |
| **roc12 (12-day ROC)** | **+0.624** | **interesting** | **16.06** | **10.36** |
| priceVsSma50Pct | +0.485 | weak | 0.209 | 0.157 |
| priceVsSma200Pct | +0.472 | weak | 0.362 | 0.247 |
| bbWidth | +0.470 | weak | 0.238 | 0.182 |
| rsi14 | +0.469 | weak | 74.0 | 71.0 |
| relativeStrengthVsBenchmark | +0.450 | weak | 0.288 | 0.191 |
| signalScore | +0.387 | weak | 83.7 | 82.1 |
| **mtfAlignmentScore** | **-0.038** | **noise** | 0.789 | 0.799 |
| **adx14** | **-0.026** | **noise** | 35.34 | 35.56 |

**The answer to "what separates bullish from strong_bullish trades"**: almost nothing at the individual-stock level. The strategy's own core filters — ADX (trend strength) and multi-timeframe alignment — are statistically indistinguishable between the two regime buckets (d ≈ 0, noise). The real difference is in the BROADER MARKET's own momentum: 12-day rate of change (a genuine, non-tautological "interesting" effect) is 55% higher in `strong_bullish` periods. Everything else (RSI, relative strength, Bollinger width) shows the same direction but only weakly.

**Interpretation**: `momentum_continuation` fires on essentially the SAME quality of individual-stock setup regardless of whether the broader market is in `bullish` or `strong_bullish` mode — it doesn't itself measure or require strong market-wide momentum, only that the STOCK'S OWN trend and ADX clear their thresholds. The regime classification (built entirely from SPY/QQQ/IWM index data, per Phase 2's `MarketRegime` module) is picking up a real market-environment difference (index-level ROC) that the strategy's signal generation doesn't currently use at all. This is a coherent, plausible explanation for why the same rule set performs so differently across these two regimes — it's benefiting from (or lacking) a market tailwind it never actually checks for.

---

## 6. Out-of-Sample Discipline

This section is a **methodology commitment**, written before seeing the diagnostic results, so it can't be quietly bent to fit whatever the data shows.

### A. Exploratory / in-sample analysis (this document)

Everything in Sections 1-5 and 9 of this report is exploratory analysis of the **same 2020-2026 dataset** already used for the Phase 4.5 backtest. Any pattern found here — a feature that separates winners from losers, a regime-specific behavior, a stock-concentration finding — is an **observation**, not a validated result. It was found by looking at data the strategy's rules were never fit to (the rules were fixed in Phase 3, before any backtesting), which is better than nothing, but it is still fundamentally in-sample: the same 2020-2026 window that produced the trades is the window used to study them.

### B. Hypotheses generated from this analysis

Any specific, falsifiable claim of the form *"trades where [feature] is [above/below] [threshold] tend to outperform"* that emerges from Sections 1-5 is logged as a **hypothesis**, not a finding. See Section 8 for the ranked list of hypotheses this diagnostic pass actually produced, each written as a testable claim.

### C. Tests required to validate those hypotheses

A hypothesis from this report may NOT be used to modify `MomentumContinuationStrategy` or its scoring until it has been tested on data this analysis did not touch. Concretely, before any rule change:

1. **A genuine forward holdout is required** — either (a) new data collected after today (2026-08-20) that this analysis has never seen, or (b) a formal train/validation/test split of the EXISTING 2020-2026 data where the split boundary is fixed *before* looking at how a proposed rule performs on either side, and the test segment is touched exactly once.
2. **The hypothesis must be pre-registered** (stated in writing, with its exact rule and success criterion) before being run against the holdout — not adjusted after seeing the holdout result. Section 8 does this pre-registration for the leading hypotheses this pass identified.
3. **A single hypothesis test is not enough** — Phase 4's own walk-forward and sensitivity-analysis tooling (already built, already run once on the unmodified strategy) should be re-run on any modified rule to check the modification isn't just newly overfit to a different slice of the same data.

**No rule changes are proposed or implemented in this document.** That is explicitly Section 8's "next experiments," not this document's output.

---

## 7. AI Layer Design (Proposal Only — Not Implemented)

Based on everything found in this diagnostic pass (to be finalized once Sections 1-5 are filled in, but the *shape* of the proposal is determined by the general character of the findings, not their exact numbers):

### What the AI layer must NOT do

Per the explicit instruction, restated here as hard constraints on the design:

- Must not invent trading signals or hallucinate technical indicators — every number it discusses must trace back to a real, already-computed value from `IndicatorEngine`, `PriceStructure`, `ChartPatterns`, `MarketRegime`, or `SectorStrength`.
- Must not override the deterministic risk rules in `RiskManager`/`Portfolio`/`Backtester` — position sizing, stop placement, and exposure limits stay fully rule-based.
- Must not use future data — any AI call that evaluates a live or historical setup must receive only the same point-in-time `StrategyContext`/`TradeFeatureRecord` data the quant engine itself is limited to.
- Must not optimize itself against the backtest — no fine-tuning, prompt iteration, or scoring-weight adjustment driven by backtest performance, which would just be a slower, less transparent form of the same in-sample overfitting risk Section 6 exists to guard against.
- Must not claim a confidence number it cannot back with measurable evidence — see the calibration requirement below.
- Must not replace the quantitative engine — it sits strictly on top of it, consuming outputs, never recalculating or second-guessing raw indicator math.

### What the AI layer SHOULD plausibly do, based on this diagnostic's likely findings

Whatever Sections 1-5 turn out to show in detail, the diagnostic work so far already tells us three durable things about `momentum_continuation` that any AI layer needs to respect:

1. **The edge is regime-dependent** (the single largest trade bucket, "bullish," is roughly breakeven per the Phase 4.5 report). An AI layer that can correctly identify "this signal is firing in a regime where this strategy has historically been weak" and say so explicitly — using the ACTUAL regime classification and historical regime-bucket statistics already computed, not a vibe — is directly useful and safely bounded.
2. **The edge is concentrated in a minority of names** (per Phase 4.5, 60% of traded stocks had negative expectancy). An AI layer that flags "this ticker's historical performance under this strategy has been [good/poor/neutral], based on N prior signals" is a legitimate, evidence-grounded thing to surface — again, reading from real computed history, not guessing.
3. **The strategy's own confidence score (`StrategyResult.confidence` / the composite `score`) is not yet validated as calibrated** — nothing in Phases 3-4.5 checked whether a signal scored 85 actually wins more often than one scored 60. This is exactly the kind of gap an AI layer should NOT paper over with an invented number; instead, it's exactly the kind of gap that should be closed with real calibration data (Section 8, Experiment on score calibration) before any AI-presented confidence is trustworthy.

Concretely, the AI layer's responsibilities should be:

- **Evaluate existing quantitative signals** — read a `StrategyResult` + `TradeFeatureRecord`-equivalent context and produce a structured summary of what fired and why, using only fields that already exist.
- **Summarize technical evidence** in natural language for a human reader (this is squarely an LLM's strength and a legitimate use), always citing the specific number behind each claim.
- **Classify setup quality relative to historical feature distributions** — e.g. "this trade's ADX (31) sits in the range historically associated with winners in `strong_bullish` regimes (interesting effect, d=X)" — but ONLY once Section 8's calibration experiment confirms that distribution comparison is itself predictive out-of-sample, not just in-sample pattern-matching dressed up as AI reasoning.
- **Identify conflicting signals** — e.g. daily/weekly trend misalignment, a strategy signal firing against the sector's own relative-strength trend — surfaced from data already computed by Phase 2/3 modules.
- **Provide a confidence score ONLY if calibrated** — meaning: if, and only if, a calibration experiment (Section 8) demonstrates that the AI's stated confidence bucket (e.g. "high/medium/low") actually correlates with realized win rate on holdout data, is the AI permitted to state a confidence level at all. Absent that, it should describe evidence, not manufacture a number.
- **Explain why a signal passed or failed** the strategy's deterministic rules — a natural-language rendering of already-computed boolean/threshold checks (`MomentumContinuationStrategy`'s own warnings/evidence arrays already do a version of this; the AI layer's job is to make it more readable, not more authoritative).
- **Identify regime-specific risk** — directly surfacing the regime-dependence finding from this diagnostic (once Section 1 is filled in with real per-regime data) as context alongside any live signal.
- **Rank already-generated candidates** — ordering, not creating, candidates the quant engine has already scored, using the SAME scoring engine output (`ScoringEngine.calculateScore`), not a separate AI-invented ranking.
- **Help determine when the strategy should be avoided** — this is arguably the single most valuable, safest AI-layer responsibility given what this diagnostic is finding: an AI that says "the current market regime (X) has historically been unfavorable for this strategy (Y trades, Z% win rate, per Section 1)" is providing exactly the kind of judgment a human trader needs and that pure rule-based logic doesn't currently surface at decision time.

### Architecture implication

The AI layer should be a **read-only consumer** sitting after `ScoringEngine`/`SignalExplainer` in the pipeline, never before it and never inside the `Backtester`. Its inputs should be exactly the same `StrategyContext` + `StrategyResult` + `ScoreBreakdown` + (once built) historical regime/feature-distribution lookups the deterministic engine already produces. Its output should be natural-language explanation and risk framing, not a new number that isn't traceable to an existing computed value — with the single, explicitly-gated exception of a calibrated confidence label, which requires its own dedicated validation (Section 8) before it's allowed to exist at all.

---

## 8. Next Validation Experiments (Ranked)

None of these are implemented in this document. Each is a pre-registered, falsifiable hypothesis per Section 6's discipline.

### Experiment 1 (highest priority): Score calibration check
- **Hypothesis**: `signalScore` (the composite 0-100 score from `ScoringEngine`) does not currently predict `momentum_continuation` trade outcomes.
- **Why it matters**: Section 4 found `signalScore` is "noise" (d=-0.121) — if the system's own score can't separate winners from losers for this strategy, no dashboard ranking, no AI-stated confidence, and no future paper-trading filter based on score should be trusted until this is understood or fixed.
- **Data required**: the same 226-trade dataset already extracted (no new data needed) plus a formal binned calibration check (e.g. does win rate actually increase monotonically across score deciles?).
- **Methodology**: bucket trades by `signalScore` decile, compute win rate and expectancy per decile, check for monotonicity; repeat per-strategy for `trend_pullback` and `breakout` once their feature datasets are extracted (not yet done — see Section 6/limitation).
- **Look-ahead prevention**: none needed — this is pure post-hoc analysis of already-closed trades' already-known scores, no new signal generation involved.
- **Success**: a clear, monotonic (even if noisy) relationship between score and win rate emerges. **Failure**: no relationship (consistent with what Section 4 already suggests) — in which case the score should not be presented to a user (or an AI layer) as meaningful without being rebuilt or reweighted.
- **New holdout required?** No — this is diagnostic on existing data.

### Experiment 2: Cross-universe replication of stock concentration
- **Hypothesis**: the 3-5-stock dependency found in Section 2 is specific to this 81-stock hand-curated universe and 2020-2026 period, not a general property of `momentum_continuation`.
- **Why it matters**: if a *different* set of ~50-80 liquid U.S. stocks (no overlap with the current universe) shows the SAME "remove top 3, edge disappears" pattern, that's strong evidence the strategy structurally depends on catching a small number of outsized winners rather than having a broad edge. If a different universe shows a genuinely broad edge instead, the current result may be specific to this universe's composition (e.g., heavy tilt toward 2020-2026's AI/gold/industrial winners).
- **Data required**: a second, non-overlapping ~50-80 stock universe (different sector composition ideally), same 2020-2026 date range, downloaded and quality-audited the same way as Phase 4.5.
- **Methodology**: identical to Phase 4.5 + this diagnostic pass, run on the new universe.
- **Look-ahead prevention**: none introduced — same engine, same no-look-ahead guarantees already tested.
- **Success**: a similarly broad-based (or similarly concentrated) result emerges, clarifying whether concentration is structural or universe-specific. **Failure**: inconclusive if the new universe has too few trades to compare meaningfully.
- **New holdout required?** New universe, same time period — not a temporal holdout, but a genuine independent sample in the cross-sectional (stock) dimension.

### Experiment 3: True temporal holdout / forward test
- **Hypothesis**: `momentum_continuation`'s modest baseline edge (before considering concentration) persists on data this analysis has never seen.
- **Why it matters**: every finding in this report, including the walk-forward results from Phase 4.5, comes from the same 2020-2026 window. A genuine forward test is the only way to know if any of this generalizes.
- **Data required**: either (a) live paper-trading forward from today (2026-08-20) for a meaningful period (6+ months, ideally 1+ year), or (b) additional pre-2020 historical data if it can be obtained, used as a pre-committed holdout never touched by this or the Phase 4.5 analysis.
- **Methodology**: run the UNCHANGED strategy (no rule changes from any hypothesis in this report) forward; compare win rate, profit factor, and stock-concentration pattern against the 2020-2026 baseline.
- **Look-ahead prevention**: trivial by construction for (a); for (b), the holdout period must be fixed and never inspected before the experiment concludes.
- **Success**: directionally similar profit factor/win rate, and a similarly-shaped (or better) concentration profile. **Failure**: profit factor drops to ≤1 or below, or the edge again depends entirely on 1-2 stocks — both would suggest the 2020-2026 result doesn't generalize.
- **New holdout required?** Yes — this experiment's entire purpose IS the holdout.

### Experiment 4: Neutral-regime "quality filter" hypothesis test
- **Hypothesis**: within `neutral` market regime specifically, restricting `momentum_continuation` entries to trades where RSI < ~70 AND relative-strength-vs-SPY is clearly positive would improve that regime's results (motivated by, not fit to, Section 1's neutral-regime findings: RSI d=-0.833, relativeStrengthVsBenchmark d=+0.779).
- **Why it matters**: `neutral` showed the cleanest, most internally-coherent winner/loser separation of any regime — if this generalizes, it's the most promising lead for an eventual rule refinement (NOT to be implemented yet).
- **Data required**: same universe; would need the rule change formally specified BEFORE testing, then run through the existing walk-forward and sensitivity tooling.
- **Methodology**: pre-register the exact threshold (e.g. RSI < 68, vsBenchmark > 0.10 — picked from a round-number/robustness standpoint, not fit to this dataset's exact means), implement as a strategy variant, run Phase 4's walk-forward + sensitivity analysis on the variant, NOT just the aggregate return.
- **Look-ahead prevention**: the threshold must be chosen without looking at how it performs on this same dataset first (pre-registration is the safeguard) — the temptation to "tune to the numbers already seen" is exactly the risk Section 6 exists to block.
- **Success**: the `neutral`-regime subset improves without degrading other regimes and without failing walk-forward consistency. **Failure**: the filter reduces trade count so much the result becomes unreliable, or fails walk-forward.
- **New holdout required?** Yes — per Section 6, any rule change must be validated on data not used to generate the hypothesis.

### Experiment 5: Bullish-regime market-momentum gate
- **Hypothesis**: requiring broad-market 12-day ROC above some threshold before taking `bullish`-regime signals (motivated by Section 5's roc12 finding, d=+0.624 favoring `strong_bullish`) would filter out some of the currently-unprofitable `bullish`-regime trades.
- **Why it matters**: `bullish` is the largest trade bucket (82/226) and currently near-breakeven; if a simple, pre-registered market-momentum gate can be shown (out-of-sample) to improve it, that's a meaningful, well-motivated potential fix.
- **Data required/methodology/look-ahead prevention**: same pattern as Experiment 4.
- **Success/failure**: same evaluation standard as Experiment 4 (must survive walk-forward and sensitivity testing, not just look better on the same 2020-2026 data it was inspired by).
- **New holdout required?** Yes.

### Experiment 6: minusDI14 anomaly replication
- **Hypothesis**: higher `-DI14` at signal time is genuinely (mildly) associated with better outcomes for this strategy, not a dataset-specific artifact.
- **Why it matters**: it's the single strongest overall (pooled) feature separator (d=+0.569) and directly contradicts the naive expectation that lower `-DI` (cleaner bullish dominance) should be better — worth understanding before dismissing OR acting on it.
- **Data/methodology**: test on Experiment 2's independent universe and/or Experiment 3's holdout period; if it doesn't replicate, treat it as noise specific to 2020-2026's particular winners.
- **Success/failure**: replicates in direction and rough magnitude vs. doesn't replicate.
- **New holdout required?** Same holdout as Experiments 2/3.

---

## 9. Final Verdict

**Is `momentum_continuation` showing evidence of a real but weak edge?**
Evidence of a real edge, yes — but "weak" understates it once concentration is accounted for. The BASELINE aggregate numbers (profit factor 1.14, Sharpe 0.38) are real and were produced by an unmodified, pre-registered rule set tested out-of-sample-in-spirit via walk-forward (Phase 4.5). But Section 2 shows that edge is not resilient: it evaporates entirely once the top 3 winning stocks are removed, and turns net-negative once the top 5 are removed.

**Is the edge broad-based or concentrated?**
**Concentrated — decisively so.** This is the clearest finding in the entire diagnostic pass. 3 stocks (LLY, GE, NVDA) account for the difference between "modestly profitable" and "exactly breakeven." 5 stocks account for the difference between "profitable" and "net loser." 60% of the 70 stocks that actually traded had negative expectancy; the median stock lost money. This is not a strategy with a broad, repeatable edge across many names — it is closer to a strategy that correctly held onto a handful of exceptional 2020-2026 winners (heavily overlapping with the AI buildout and industrial/gold cycles of this specific period) while being roughly a coin-flip-or-worse on the rest of its trades.

**What conditions does it appear to work best in?**
`strong_bullish` and `neutral` market regimes. `neutral` in particular shows the most internally coherent pattern: winners are less overbought, better relative-strength performers, and further from recent highs than losers — a plausible, "real momentum, not just chasing" signature. `strong_bullish` benefits from a genuine market-wide momentum tailwind (higher 12-day ROC) that the strategy doesn't explicitly require but happens to correlate with.

**What conditions does it fail in?**
The `bullish` regime (its single largest trade bucket, 82/226 trades) shows no feature reaching "interesting" effect size separating winners from losers — the strategy doesn't have a clear quality filter operating there, and in aggregate this bucket is roughly breakeven-to-negative. `bearish`, `strong_bearish`, and `high_volatility` are too thin to characterize reliably but show no evidence of working.

**Is the current strategy ready for paper trading?**
**No — not in its current, unmodified form, and not as a strategy anyone should expect to be broadly profitable.** The concentration finding alone is disqualifying for the specific claim "this has a real, repeatable, tradeable edge": an investor who happened to miss LLY/GE/NVDA (or who trades this rule set forward, when a similarly outsized handful of winners is neither known in advance nor guaranteed to repeat) has a meaningfully worse-than-shown, quite possibly negative, expected result. Paper trading COULD still proceed as a genuine forward-validation exercise (Experiment 3) specifically BECAUSE it's cheap and reversible — but it should be framed and monitored as "testing whether this replicates," not as "deploying a validated edge."

**What evidence is still required before paper trading (or any stronger claim)?**
1. Experiment 1 (score calibration) — the system currently can't tell a user which signals are more trustworthy.
2. Experiment 2 (cross-universe replication) — is 3-5-stock dependency structural or an accident of this universe?
3. Experiment 3 (true forward/temporal holdout) — everything so far is the same 2020-2026 window.
4. `trend_pullback` and `breakout` have NOT had this same feature-level diagnostic treatment — only `momentum_continuation` was analyzed this deeply, per the instruction to prioritize it. `trend_pullback`'s Phase 4.5 result (PF 1.50, but only 45 trades) and `breakout`'s (net negative) both deserve at least the concentration check before either is trusted or discarded with confidence.

**What should Phase 5 AI actually be responsible for?**
Given everything above, the single most valuable, safely-scoped thing an AI layer can do right now is **surface exactly these limitations at the point of decision** — not generate new signals, not invent a confidence score, but say, in effect: *"this signal is from momentum_continuation, whose historical edge in this regime has been [X], and whose aggregate profitability has been shown to depend heavily on a small number of historically exceptional trades — treat this signal's presence alone as weak evidence."* That is squarely within the bounds Section 7 already lays out (evaluate, summarize, flag conflicting signals, identify regime-specific risk, help determine when to avoid the strategy) and requires no new invented capability — it requires faithfully relaying what this diagnostic phase actually found, including the parts that are not flattering to the strategy.
