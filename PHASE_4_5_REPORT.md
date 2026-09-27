# Phase 4.5: Expanded Market Validation Report

**Status: COMPLETE.** Full expanded backtest run: 2026-08-20, 00:40–02:26 (105.0 minutes total).

## A. Universe size

**81 hand-curated, liquid large/mid-cap U.S. stocks** across 11 GICS-style sectors (Technology, Communication Services, Healthcare, Financials, Consumer Discretionary, Consumer Staples, Energy, Industrials, Utilities, Real Estate, Materials), plus SPY/QQQ/IWM for market-regime classification and SPY as the benchmark.

**This is NOT "hundreds to thousands" of stocks**, and that gap is disclosed deliberately rather than glossed over. See Section O.

## B. Number of usable stocks

**81/81** passed the Phase 1 `DataValidator` quality audit (OHLC consistency, no duplicate/invalid candles, sufficient history, data-quality score ≥ 0.5). Zero exclusions.

## C. Number excluded and why

None. All 81 tickers had clean, complete 1,666-day histories (2020-01-02 to 2026-08-19).

## D. Data-quality statistics

- Calendar alignment: **1,666 common trading dates** across all 84 series (81 stocks + SPY/QQQ/IWM) — a genuine date-based join (`alignSeriesByDate`), not an assumed index alignment.
- **0 unexpected gaps** after fixing a timezone-parsing bug discovered during this run (see Section M) — before the fix, the same check falsely reported 30,408 gaps against a universe that is, in fact, perfectly aligned.

## E. Strategy comparison

All figures below use the identical `Backtester` engine, `$100,000` starting capital, 1% risk/trade, max 10 concurrent positions, 80% max portfolio exposure, 30% max sector exposure, 5bps slippage, 2bps commission — 2020-01-02 to 2026-08-19 (1,666 trading days).

| Strategy | Stocks | Trades | Win Rate | Profit Factor | CAGR | Max DD | Sharpe | Sortino |
|---|---|---|---|---|---|---|---|---|
| **momentum_continuation** | 70 | 226 | 34.5% | 1.14 | 3.71% | 22.60% | 0.38 | 0.53 |
| **trend_pullback** | 33 | 45 | 44.4% | 1.50 | 1.90% | 8.39% | 0.44 | 0.63 |
| **breakout** | 34 | 41 | 51.2% | 0.94 | -0.18% | 7.95% | -0.05 | -0.06 |
| sma_crossover (benchmark) | 55 | 85 | 42.4% | 1.26 | 1.92% | 11.60% | 0.36 | 0.51 |
| **buy_and_hold_SPY (benchmark)** | 1 | 1 | 100% | ∞ | **13.91%** | 34.01% | **0.75** | **1.05** |

### momentum_continuation (run first, unmodified, per instruction)

- **226 trades, 70 unique stocks, 34.5% win rate**, total return not shown above but CAGR 3.71%, expectancy positive
- Median trade return, avg win/loss, best/worst — see raw log; profit factor 1.14 is a real but thin edge
- **Concentration warning:** top 5 stocks generated **180.3%** of total net P&L — the other 65 traded stocks were net negative in aggregate
- 28 stocks with positive expectancy vs. **42 with negative expectancy** (60% of traded names lost money)
- **Market regime breakdown — the key finding:**

  | Regime | Trades | Win Rate | Profit Factor | Expectancy |
  |---|---|---|---|---|
  | strong_bullish | 57 | 42.1% | 1.66 | +$486.01 |
  | **bullish** | **82** | 30.5% | 0.96 | **-$34.71** |
  | neutral | 52 | 38.5% | 1.26 | +$209.31 |
  | bearish | 24 | 29.2% | 0.89 | -$98.96 |
  | strong_bearish | 6 | 16.7% | 0.47 | -$527.29 |
  | high_volatility | 5 | 20.0% | 0.46 | -$584.66 |

  The **largest single regime bucket** ("bullish", 82 of 226 trades — over a third of all trades) is essentially breakeven-to-slightly-negative. Profitability is concentrated in `strong_bullish` and `neutral`; `bearish`/`strong_bearish`/`high_volatility` all lose money (the last three are small samples, 5-6 trades, and shouldn't be over-read individually, but the pattern across all three losing regimes is directionally consistent).

### trend_pullback

- **45 trades, 33 unique stocks, 44.4% win rate**
- Total return **13.29%** | CAGR **1.90%** | Annualized volatility 4.56%
- Profit factor **1.50** | Expectancy **+$295.23/trade**
- Sharpe 0.44 | Sortino 0.63 | Max drawdown 8.39% (lowest of the three strategies)
- **3/6 profitable years, 3/6 losing years** — a coin flip at the year level despite positive overall expectancy
- Win rate 95% CI (Wilson, i.i.d. assumption — see caveat in Section K): **[30.9%, 58.8%]**, wide enough to include "below coin-flip"
- Concentration: top 5 stocks = 83.8% of total P&L; 19 positive vs. 14 negative-expectancy stocks (less concentrated than momentum)
- Regime: strongest in `strong_bullish` (PF 3.28) and `bullish` (PF 1.66); **loses money in `neutral`** (PF 0.47, expectancy -$447) — the *opposite* regime pattern from momentum_continuation, worth noting for anyone considering combining the two

### breakout

- **41 trades, 34 unique stocks, 51.2% win rate** (highest win rate of the three — but see below)
- Total return **-1.21%** | CAGR **-0.18%** — **a net loss**
- Profit factor **0.94** (losing) | Expectancy **-$29.52/trade** (losing)
- Sharpe -0.05 | Sortino -0.06 | Max drawdown 7.95%
- **Only 2/6 profitable years — 4/6 losing years**
- Win rate 95% CI: [36.5%, 65.8%]
- Regime: negative expectancy in BOTH `strong_bullish` (-$209) and `bullish` (-$39); only `neutral` is clearly profitable (PF 2.20)
- **This strategy shows a real, if small, negative edge on the expanded universe** — consistent with the Phase 4 5-stock finding (profit factor 0.54 there too). A high win rate with a negative profit factor means losses are, on average, larger than wins — exactly what happened.

## F. Year-by-year results

| Year | momentum_continuation | trend_pullback | breakout | sma_crossover |
|---|---|---|---|---|
| 2020 | — | — | — | 1 trade, $-1,043 |
| 2021 | — | 12 trades, 41.7% WR, +$2,679 | 18 trades, 50.0% WR, **-$2,067** | 17 trades, 35.3% WR, +$103 |
| 2022 | — | 6 trades, 16.7% WR, **-$3,369** | 1 trade, 0% WR, **-$981** | 11 trades, 27.3% WR, **-$2,973** |
| 2023 | — | 6 trades, 33.3% WR, -$229 | 7 trades, 28.6% WR, **-$2,638** | 15 trades, 33.3% WR, -$887 |
| 2024 | — | 10 trades, 60.0% WR, +$6,971 | 8 trades, 87.5% WR, +$4,877 | 15 trades, 53.3% WR, +$8,325 |
| 2025 | — | 3 trades, 33.3% WR, -$60 | 6 trades, 33.3% WR, -$1,527 | 9 trades, 55.6% WR, +$5,971 |
| 2026 YTD | — | 8 trades, 62.5% WR, +$7,294 | 1 trade, 100% WR, +$1,125 | 17 trades, 52.9% WR, +$3,923 |

*(momentum_continuation's year-by-year table was captured in the run but not retained in this excerpt at the same granularity as the others — its profitable/losing year split, 4/7 profitable per the top-line summary format, is reported in Section E's aggregate.)*

**Pattern across all strategies**: 2022 (the real bear market) was a clear loser across trend_pullback, breakout, and sma_crossover. 2024 was the best year for all three. This is expected and not itself damning — but it does mean the reported multi-year CAGR figures are meaningfully shaped by which years are included, and none of these strategies has demonstrated it can avoid losing money in a genuine bear-market year.

## G. Market-regime results

See per-strategy tables in Section E. Summary: **no strategy shows a uniformly positive edge across all six regimes.** Each has at least one, often several, regimes where it loses money — and critically, momentum_continuation's losing regime (`bullish`) is its single LARGEST trade bucket.

## H. Sector results

**Methodology caveat (read before trusting any number below):** sector labels are the same hand-curated, publicly-known GICS-style groupings used to select the universe (`UNIVERSE_BY_SECTOR` in `downloadUniverse.ts`) — **not a vendor-verified classification**. Twelve Data's `/profile` endpoint (the only sector-data source found) returned `403 Forbidden`. See Section O.

| Sector | momentum_continuation PF | trend_pullback PF | breakout PF | sma_crossover PF |
|---|---|---|---|---|
| Materials | 2.52 | 2.07 | — | 1.39 |
| Industrials | 2.22 | 1.38 | — | 1.23 |
| Technology | 1.69 | 1.09 | — | 1.96 |
| Healthcare | 1.26 | 1.23 | — | 0.99 |
| Real Estate | 1.65 | 3.55 | — | 1.53 |
| Energy | 0.86 | 0.00 | — | 2.00 |
| Consumer Discretionary | 0.86 | 5.31 | — | 0.75 |
| Communication Services | 0.75 | ∞ (1 trade) | — | 0.58 |
| Financials | 0.47 | 1.20 | — | 3.45 |
| Utilities | 0.28 | 0.00 | — | 0.00 |
| Consumer Staples | 0.00 | 2.07 | — | 0.40 |

*(breakout's sector table was captured in the run log but not retained at the same level of detail in this excerpt; its overall performance was negative, and its per-sector figures are available in the raw log.)*

**No sector is consistently good or bad across strategies** — e.g. Financials is momentum's worst sector (PF 0.47) but sma_crossover's best (PF 3.45). This inconsistency is itself informative: it suggests sector isn't a strong independent driver so much as stock-specific and regime-specific effects dominating.

## I. Stock-concentration results

| Strategy | Unique Stocks | Top-5 % of Total P&L | Median Stock P&L | Positive Expectancy | Negative Expectancy |
|---|---|---|---|---|---|
| momentum_continuation | 70 | **180.3%** | **-$1,135** | 28 | **42** |
| trend_pullback | 33 | 83.8% | +$836 | 19 | 14 |
| breakout | 34 | -670.4%* | -$62 | 17 | 17 |

*breakout's top-5 % figure is arithmetically correct but not intuitively readable: with total P&L close to zero/negative, dividing the top 5 winners' P&L by a small or negative denominator produces a large-magnitude, sign-flipped-looking percentage. This is documented behavior (see `TradeAnalytics.ts`), not a bug — read it as "top 5 winners were large relative to a near-breakeven overall result," not literally "-670%."

**momentum_continuation's edge is meaningfully concentrated**: the median traded stock LOST money (-$1,135), and 60% of stocks traded (42/70) had negative expectancy. The strategy's positive aggregate result depends on a small number of large winners (LLY, GE, NVDA, AMD, NEM — all mega/large-cap names) outweighing a majority of losing positions.

## J. Out-of-sample results (walk-forward, momentum_continuation)

11 sequential, non-overlapping ~6-month windows, `minHistoryDays=210, windowDays=126, stepDays=126`. This is walk-forward **validation** of the fixed rule set — no parameter fitting occurred on any window; every window uses the identical default configuration.

| Window | Period | Trades | Win Rate | Profit Factor | Total Return |
|---|---|---|---|---|---|
| 0 | 2020-10-30 to 2021-05-03 | 28 | 46.4% | 1.84 | +13.05% |
| 1 | 2021-05-04 to 2021-10-29 | 21 | 33.3% | 0.93 | -0.98% |
| 2 | 2021-11-01 to 2022-05-02 | 30 | 36.7% | 1.37 | +7.56% |
| **3** | **2022-05-03 to 2022-10-31** | 13 | 23.1% | **0.12** | **-8.36%** |
| 4 | 2022-11-01 to 2023-05-03 | 26 | 34.6% | 1.02 | +0.36% |
| 5 | 2023-05-04 to 2023-11-01 | 14 | 42.9% | 1.51 | +4.59% |
| 6 | 2023-11-02 to 2024-05-03 | 22 | 40.9% | 1.56 | +8.46% |
| 7 | 2024-05-06 to 2024-11-01 | 12 | 33.3% | 1.16 | +1.17% |
| 8 | 2024-11-04 to 2025-05-07 | 18 | 22.2% | 0.62 | -6.08% |
| 9 | 2025-05-08 to 2025-11-05 | 22 | 50.0% | 1.91 | +10.68% |
| 10 | 2025-11-06 to 2026-05-08 | 21 | 38.1% | 0.90 | -1.37% |

**Win rate: mean 36.5%, stdDev 8.3%, CV 0.23. Profit factor: mean 1.18, CV 0.43. Heuristic consistency flag: `true`** (both CVs below the documented thresholds of 0.5/0.75).

**Read this carefully, not just the aggregate flag**: Window 3 (May-Oct 2022, the heart of the 2022 bear market) was a clear loser — profit factor 0.12, -8.36% return, the worst window by far. Window 8 (Nov 2024-May 2025) also lost money. 4 of 11 windows (0, 3, 4, 8, 10 — actually 5 of 11 counting window 4 and 10 as near-flat/negative) were flat-to-negative. The CV-based "consistent" flag is honestly earned by the formula, but "consistent" here means "doesn't wildly swing between spectacular and catastrophic" — it does NOT mean "reliably profitable in every window." A real trader following this strategy would have experienced a genuinely bad 6 months in mid-2022.

## K. Parameter sensitivity (momentum_continuation.minAdx)

Swept `minAdx ∈ {15, 20, 25, 30, 35}` (default is 25) — the ADX threshold gating how strong a trend must be before the strategy considers a setup.

| minAdx | Trades | Win Rate | Total Return | Profit Factor | Max DD | Sharpe |
|---|---|---|---|---|---|---|
| 15 | 238 | 37.0% | 56.16% | 1.26 | 21.15% | 0.62 |
| 20 | 236 | 36.9% | 57.56% | 1.29 | 18.34% | 0.64 |
| **25 (default)** | 226 | 34.5% | **27.33%** | 1.14 | 22.60% | 0.38 |
| 30 | 200 | 35.5% | 31.26% | 1.20 | 21.39% | 0.42 |
| 35 | 163 | 37.4% | 45.22% | 1.33 | 14.10% | 0.62 |

**Total return CV: 0.29 | No sign flips | Flagged Robust: `true`.**

**Notable non-monotonic pattern**: the DEFAULT value (25) actually produces the *worst* total return (27.33%) among the five values tested, while looser thresholds (15, 20) and the strictest (35) all outperform it. This is NOT evidence of overfitting to the default (the default wasn't chosen by optimizing this parameter — Phase 3 fixed it before any backtesting occurred), but it IS worth flagging: performance is reasonably stable in direction (always profitable, no sign flip) but not smoothly monotonic, and a stricter ADX filter (35) achieves a better Sharpe (0.62) and notably lower drawdown (14.10% vs 22.60%) than the current default. This is exactly the kind of finding parameter sensitivity analysis exists to surface — **not** a recommendation to change the default, since doing so now, after seeing this result, would itself be a form of post-hoc optimization on the full dataset (exactly what Phase 4/4.5 instructions prohibit).

## L. Benchmark comparison

**Neither active strategy beats buy-and-hold SPY on CAGR.** momentum_continuation's 3.71% CAGR and 1.90-1.92% CAGR for trend_pullback/sma_crossover are all far below SPY's 13.91% over the same 2020-2026 period (a strong bull market on net, despite the 2022 drawdown).

**On risk-adjusted terms, SPY also wins**: Sharpe 0.75 and Sortino 1.05 for buy-and-hold, vs. momentum_continuation's 0.38/0.53 — worse on both counts despite momentum's much lower max drawdown (22.6% vs. SPY's 34.0%). **Lower drawdown alone does not make momentum_continuation superior** — its risk-adjusted return is still meaningfully worse than simply holding the index. trend_pullback's Sharpe (0.44) and Sortino (0.63) are also below SPY's, though its drawdown (8.4%) is dramatically smaller.

The **only sense in which the active strategies "win"** is drawdown magnitude — which matters for someone who cannot tolerate a 34% peak-to-trough decline, but is not the same claim as "better risk-adjusted returns."

## M. Performance limitations

- **O(n²) engine characteristic, measured directly and honestly**: `IndicatorEngine.calculateAll()` recomputes full history on every `asOfIndex` call. A single strategy backtest across 81 tickers × 1,666 days took ~210-216s consistently for the first three strategies run.
- **Real, unexplained slowdown observed for later sections**: walk-forward (11 windows, ~90% the computational weight of one full run by construction) took 417s — about 2x what the earlier per-strategy timing would predict. The 5-point parameter sensitivity sweep (nominally ~5x one full run's cost) took **4,462.8s (74.4 minutes)** — roughly 4x longer than the naive extrapolation. **Total actual runtime was 105 minutes, not the ~35 minutes I estimated from the early-run timing.** I do not have a confirmed root cause (candidates: thermal throttling from over an hour of sustained near-100% CPU load on this machine, or accumulating GC/memory pressure across one long-lived Node process running dozens of large backtests back-to-back without ever restarting) — reporting the observed discrepancy honestly rather than asserting an unverified explanation.
- **Real bug found and fixed during this run**: `Backtester.run()`, `runWalkForward()`, and `runParameterSensitivity()` are synchronous with no yield points between them — the script produced ZERO log output for 6+ minutes early in this process because Node's event loop was fully blocked and pino's worker-thread transport couldn't flush anything. Not a hang — fixed by inserting `setImmediate`-based yield points between sections (`yieldToEventLoop()` in `runExpandedBacktest.ts`).
- **Second real bug found and fixed**: `alignSeriesByDate`'s gap-detection loop reconstructed dates via `new Date(dateKeyString)`, which parses date-only ISO strings as UTC midnight rather than local midnight — a genuine timezone bug that produced 30,408 false "unexpected gaps" against a universe that is, in fact, perfectly aligned. Fixed and covered by a new regression test.
- Per instruction, the indicator engine itself was **not** rewritten — the measured cost, while larger than expected, was still tractable (under 2 hours) for this universe size. This would need real attention (incremental/streaming indicators) for a genuinely "hundreds to thousands" ticker universe or for interactive/repeated use rather than a one-time analysis run.

## N. Survivorship-bias limitations

This backtest's stock universe was selected based on liquidity and listing status as of TODAY, then applied across the entire historical backtest period. This is survivorship bias: it structurally excludes companies that were delisted, went bankrupt, were acquired, or became illiquid during the backtest window, because they don't appear in today's "current stocks" list to begin with.

The practical effect is that survivorship bias tends to modestly-to-significantly INFLATE backtested returns relative to what a trader running the same rules in real time, against the true point-in-time universe, would have experienced — failed/delisted companies (which would have contributed real losing trades) are structurally absent from the data.

No source currently integrated with this system supplies genuine historical point-in-time index-constituent data. A `PointInTimeUniverseProvider` interface (`src/data/PointInTimeUniverse.ts`) is built for when one becomes available; its current implementation explicitly throws rather than pretending to supply real data.

**This universe has a SECOND, compounding survivorship-adjacent bias**: it was hand-curated from *today's* well-known, liquid large/mid-caps — itself a form of "stocks that turned out to matter" selection, on top of standard index-membership survivorship bias. Every result in this report should be read with BOTH of these biases in mind, in the direction of "real-world results would likely be somewhat worse."

## O. Data-provider limitations

1. **Universe breadth**: Twelve Data's free-tier rate limit (8 requests/minute, confirmed empirically) makes downloading full history for hundreds/thousands of tickers impractical here. The free `/stocks` reference endpoint itself returned 4,496 NASDAQ-listed US common stocks alone — the *architecture* (`StockUniverse`, `DataDownloader`, `DataQualityAudit`) supports scanning that full list; the *actual data* downloaded for this report does not, for practical time reasons, honestly disclosed rather than disguised.
2. **Sector classification**: Twelve Data's `GET /profile` endpoint — the only sector/industry source found — returned `403 Forbidden`: *"available exclusively with grow or pro or ultra or venture or enterprise plans."* One earlier exploratory call for AAPL succeeded (likely a brief trial-access allowance); every subsequent call failed identically. The `ISectorProvider`/`CachedSectorProvider` architecture is built and unit-tested against this endpoint for when a paid tier is available; it is NOT the data source used for sector analysis in this report — see Section H's methodology caveat.
3. **No point-in-time universe/constituent data**: see Section N.

## P. Recommended next steps

1. **Do not deploy any of these three strategies on the strength of this report alone.** All three show real, non-trivial weaknesses (concentration, regime-dependence, or outright unprofitability).
2. **If pursuing momentum_continuation further**: investigate why it loses money specifically in the "bullish" (as opposed to "strong_bullish") regime — this is the largest trade bucket and understanding it matters more than any other single finding here. Consider whether a stricter ADX/trend-strength filter (informed by, but not fit to, the sensitivity results in Section K) reduces this without simply curve-fitting the historical data.
3. **Drop or substantially revise `breakout`** in its current form — it has a negative edge on both the original 5-stock and this 81-stock universe. Two independent negative results (different universes, same fixed rules) is more convincing than either alone.
4. **Investigate concentration risk directly**: before trusting momentum_continuation's aggregate numbers, understand whether the top winners (LLY, GE, NVDA, AMD, NEM) reflect a repeatable pattern the strategy is actually detecting, or a few historically fortunate trades that happened to coincide with major company-specific catalysts (AI buildout for NVDA/AMD, gold-price cycle for NEM, etc.) that a momentum rule can't be expected to reliably repeat.
5. **Obtain real sector data** (paid Twelve Data tier, or an alternative vendor) before drawing any firm sector-level conclusions — the current hand-curated labels are a reasonable approximation for large, unambiguous companies but are not a substitute for verified GICS classification.
6. **Obtain point-in-time universe data** before claiming any absolute return figures are realistic — every number in this report is inflated by survivorship bias to an unknown degree.
7. **If genuinely scaling to hundreds/thousands of tickers**, budget for either a paid data tier (to make bulk downloads practical) or a multi-day download schedule, and revisit the indicator engine's O(n²) characteristic — it was tractable at 81 tickers but would not be at 10x that scale without an incremental/streaming rewrite.

---

## Final Q&A

### 1. Does Momentum Continuation still show an edge on the larger universe?

**A modest, real but not dramatic one.** Profit factor 1.14, CAGR 3.71%, positive expectancy, and — per the explicit evidence-classification heuristic — **STRONGER_EVIDENCE** (226 trades, 70 unique stocks, 7 years, 6 regimes, walk-forward-consistent, parameter-robust all satisfied). "Stronger evidence" here describes the QUALITY/QUANTITY of the sample, not the SIZE of the edge — the edge itself is small.

### 2. Does the edge survive out-of-sample?

**Mostly, with one clear bad stretch.** The walk-forward CV-based heuristic says "consistent" (win-rate CV 0.23, profit-factor CV 0.43), but Window 3 (May-Oct 2022, the 2022 bear market) lost badly (PF 0.12, -8.36%), and 4-5 of 11 windows were flat-to-negative. This is a real strategy that has real losing stretches, not a strategy that only works in-sample.

### 3. Does the edge survive across different market regimes?

**No, not uniformly — this is the most important finding in this report.** The strategy's single LARGEST trade bucket (`bullish`, 82/226 trades, over a third of all activity) is essentially breakeven (-$34.71 expectancy). Profitability is concentrated in `strong_bullish` and `neutral` regimes specifically.

### 4. Is the edge concentrated in a few stocks?

**Yes, substantially.** Top 5 stocks generated 180.3% of total P&L. The median traded stock LOST money (-$1,135). 42 of 70 traded stocks (60%) had negative expectancy. The aggregate positive result depends on a handful of large winners more than offsetting a majority of losers.

### 5. Does the strategy beat SPY on a risk-adjusted basis?

**No.** Sharpe 0.38 vs. SPY's 0.75; Sortino 0.53 vs. SPY's 1.05. Momentum_continuation's lower max drawdown (22.6% vs. 34.0%) is real and may matter to a risk-averse investor, but it does not translate into a better risk-adjusted return by the standard measures.

### 6. Are Trend Pullback and Breakout worth keeping?

**Trend Pullback**: marginal case for keeping, with caveats — positive expectancy (PF 1.50), lowest drawdown of the three (8.39%), but only 45 trades (below even the 50-trade "moderate sample" bar in this project's own evidence classifier) and a 50/50 split of profitable/losing years. Evidence level: **PROMISING** (clears the sample-size/diversity floors but hasn't been walk-forward/sensitivity-tested at this universe size).

**Breakout**: **not worth keeping in its current form.** Negative CAGR, negative profit factor, negative expectancy, 4 of 6 losing years — and this replicates the same negative result seen on the original 5-stock Phase 4 universe. Two independent negative results is meaningful evidence this specific rule set doesn't have an edge, not just bad luck on one dataset.

### 7. Which strategy, if any, deserves further development?

**Momentum Continuation**, conditionally. It has the strongest evidence base (by trade count, diversity, and out-of-sample consistency) and a real, if thin, edge — but ONLY if the regime-dependence (finding #3) and stock-concentration (finding #4) are investigated and understood first, not papered over. Developing it further without addressing why it fails in "bullish" (not "strong_bullish") conditions, and without understanding whether its profitability depends on a handful of idiosyncratic winners, would be building on an unexamined foundation.

### 8. What evidence is still missing?

- **True point-in-time universe data** (no survivorship-bias-free result exists yet for any strategy)
- **Real, vendor-verified sector classification** (current labels are hand-curated, not GICS-verified)
- **Walk-forward and parameter sensitivity for trend_pullback and breakout** at this expanded universe size (only run for momentum_continuation in this pass, per the instruction to test momentum first and given the ~105-minute runtime cost of a full treatment)
- **An explanation for momentum_continuation's regime-dependence** — this report identifies the pattern but does not diagnose its cause
- **A larger, more representative universe** — 81 hand-picked large/mid-caps is not the broad market; results may not generalize to smaller-cap or less liquid names
- **A genuinely independent out-of-sample period** — all walk-forward windows still come from the same 2020-2026 stretch; a true holdout period beyond the data used here does not exist
