# Momentum Continuation — Validation Report (Experiments 1–6)

**Date:** 2026-08-20
**Purpose:** consolidated synthesis of the six pre-registered validation experiments listed in `MOMENTUM_DIAGNOSTICS_REPORT.md` Section 8. This report does not introduce new analysis — it pulls together six already-completed, independently-run experiments into one bottom-line answer to the question `PROJECT_STATE.md` has been asking since Phase 4.5: **does `momentum_continuation` have a real, usable edge?**

No strategy, scoring, risk, portfolio, backtester, or Phase 5 AI code was modified to produce any of these results. All six experiments are read-only research against the unmodified strategy.

---

## 1. Summary table

| # | Question | Verdict | Key evidence |
|---|---|---|---|
| 1 | Does `signalScore` predict trade outcome? | **NOT SUPPORTED** | ROC-AUC 0.478 (below random); Spearman ≈ 0 and sign-inconsistent across win/netPnl/R-multiple; win rate non-monotonic across deciles; score ≥85/≥90 buckets *underperform* baseline |
| 2 | Does the strategy work on a different, independent 71-stock universe (same period)? | **NOT SUPPORTED** (edge); **SUPPORTED** (concentration mechanism) | Baseline flips to a net loser (PF 0.81, -22.1% return) on the second universe; but the "top-3-winners-carry-everything" concentration pattern reappears there too |
| 3 | Does the strategy's edge persist on the same 81 stocks in a genuinely untouched 2015-2019 period? | **SUPPORTED** | Win rate 34.6% vs 34.5%, PF 1.16 vs 1.14, expectancy $115.75 vs $120.70 — near-exact match; concentration pattern also replicates (PF crosses below 1.0 at exactly the Top-3 exclusion point in both) |
| 4 | Does a neutral-regime RSI/relative-strength quality filter improve results? | **NOT SUPPORTED** | Opposite-signed effect on the two independent holdouts (PF 0.77→1.24 vs 1.21→0.83); post-filter samples (17, 11 trades) fall below the project's own 20-trade reliability floor |
| 5 | Does a bullish-regime broad-market-momentum gate improve results? | **NOT SUPPORTED** (strict joint criterion); **partial replicated signal** | Bullish-bucket PF improves consistently on both holdouts (0.87→0.95; 1.28→1.35), but whole-portfolio return is flat-to-worse in both (capital reallocates into other, non-improving regimes) |
| 6 | Does the minusDI14 anomaly (d=+0.569) replicate? | **NOT SUPPORTED** | d=+0.436 (same direction) on Holdout A, but d=-0.174 (opposite direction, noise) on Holdout B |

---

## 2. Cross-cutting synthesis

### 2.1 The central tension: robust across time, fragile across stocks

Experiments 2 and 3 together are the most important finding of this whole validation program, because they point in opposite directions and both are strong, well-powered results (181 and 104 trades respectively — not thin samples):

- **Same stocks, different time (Experiment 3):** the edge replicates almost exactly. Win rate, profit factor, and expectancy per trade on 2015-2019 are within a percentage point or two of 2020-2026, on a completely untouched period.
- **Different stocks, same time (Experiment 2):** the edge is completely absent — not just weaker, but a net loser from the first trade, with a *worse* concentration profile than the original.

The most defensible reading: whatever `momentum_continuation` is capturing is **not a general property of "momentum continuation works on liquid large/mid-cap U.S. stocks."** It looks much more specific — something about *this particular hand-curated list of 81 tickers* (its sector mix, its particular mega-cap composition, or simply which companies happened to be included) that has held up across two different multi-year windows on those same names, but is not shared by a different, comparably-built list of similarly liquid large/mid-cap names.

**Important limitation on this reading**: Experiment 2 tested exactly **one** alternate universe. A single non-replication is real evidence, but it's not proof the effect never generalizes — a different second universe might behave differently. This is a genuine open question this validation program cannot close with the data on hand (see Section 5).

### 2.2 `signalScore` carries no usable information (unambiguous)

Of all six experiments, Experiment 1 is the cleanest and most decisive — no split results, no caveats about small samples, consistent across every cut tested (deciles, thresholds, regimes, concentration-adjusted subsets). The score should continue to be treated as **ranking output only**, never as a quality or confidence signal. This was already the operating assumption baked into Phase 5 (`aiConfidence` forced to `null`, explicit "not a validated probability" language everywhere) — Experiment 1 confirms that caution was correct, not overcautious.

### 2.3 None of the three motivated refinements survive contact with independent data

Experiments 4, 5, and 6 were all inspired by real, sizable effect sizes in the original in-sample diagnostics (RSI/relative-strength separation in neutral regime, broad-market ROC separating bullish from strong_bullish, the minusDI14 anomaly). All three were pre-registered with fixed, round-number thresholds and tested on the same two independent holdouts. **None produced a robust, generalizable improvement:**
- Experiment 4 flipped sign entirely between holdouts.
- Experiment 6 flipped sign entirely between holdouts.
- Experiment 5 is the most interesting partial result — a real, consistently-replicated effect at the targeted subset level — but it doesn't survive the shared-capital portfolio mechanics: filtering out weak bullish trades frees capital that the (correctly unchanged) portfolio engine reallocates into other trades that aren't any better, netting out to roughly nothing at the whole-portfolio level.

This is a strong, consistent pattern across three independent attempts: **patterns discovered by exploring the original 2020-2026/81-stock dataset tend to look weaker, inconsistent, or absent once tested on genuinely new data.** That's exactly the failure mode Section 6 of `MOMENTUM_DIAGNOSTICS_REPORT.md` was designed to catch, and it caught it three times.

### 2.4 Concentration is the one thing that replicates everywhere

Every single experiment that measured it found the same signature: a small number of stocks or trades account for most of whatever positive result exists.
- Original universe: removing the top 3 winners erases the edge; removing the top 5 makes it a net loser.
- Experiment 2 (different stocks): same signature, just starting from an already-negative baseline — removing top winners makes it monotonically worse.
- Experiment 3 (different time): PF crosses below 1.0 at *exactly* the Top-3 exclusion point, matching the original almost precisely.
- Experiments 4/5: the "other regimes" trade counts and outcomes shift noticeably whenever capital is freed up, consistent with a strategy whose results are sensitive to which specific handful of trades get taken.

This is the most structurally consistent finding across the entire validation program — more consistent than the edge itself.

---

## 3. Overall verdict

**`momentum_continuation` does not have a demonstrated, general, broad-based edge.** What the six experiments collectively support is a much narrower claim: on this project's specific 81-stock universe, the strategy has produced a real, temporally-persistent, but fragile and concentration-dependent positive result across two non-overlapping multi-year windows — a result that (a) does not transfer to a different comparable universe, (b) cannot be usefully ranked or filtered by the strategy's own quality score, and (c) could not be improved by any of three well-motivated, pre-registered refinement attempts.

This does **not** mean the strategy is worthless or that the original diagnostics were wrong — the temporal replication (Experiment 3) is genuinely strong evidence of *something* real and persistent on this specific stock list. But it falls well short of "a validated, tradeable, general momentum strategy," and the honest conclusion is that this is not ready for paper trading as a standalone edge.

## 4. Implication for Phase 5 AI

No changes needed — every piece of this validates the design choices already made:
- `aiConfidence` stays `null`. Nothing here provides new grounds to calibrate a confidence score, and Experiment 1 actively strengthens the case against ever deriving one from `signalScore` naively.
- The AI layer's regime-dependence and concentration framing (already implemented, citing the original diagnostics) remains accurate and is now further corroborated by Experiments 2, 3, 5.
- If the AI layer is ever extended to surface historical statistics per-experiment (not currently done — `HistoricalStrategyStats` only carries the original baseline/regime numbers), these six results would be excellent, honestly-labeled additions — clearly marked as exploratory validation findings, not proof of a tradable edge.

## 5. Recommended next steps (not executed — for your decision)

Ranked by how directly they'd resolve the biggest open question (Section 2.1):

1. **Test a second independent universe (or a third).** Experiment 2 is an n=1 result on the "does this generalize across stocks" question. One more non-overlapping universe, run through the identical pipeline, would meaningfully firm up or undermine the "universe-specific, not general" reading.
2. **A genuine forward test.** Experiment 3 used a pre-2020 holdout because no live paper-trading system exists yet. An actual forward period (even 3-6 months) on the original 81-stock universe would be the first truly prospective (not just historically-untouched) validation.
3. **Investigate *why* the original 81-stock universe works but the second doesn't.** Sector composition, average market cap, historical volatility regime, or simple survivorship bias (the original universe was picked based on being well-known *today* — see `PointInTimeUniverse.ts`'s disclosed limitation) are all plausible, testable explanations worth distinguishing before concluding anything stronger.

None of these are authorized to proceed automatically — this report is research output, not a plan of record.

---

*This report synthesizes results already reported in full detail in this session's Experiment 1-6 development reports. See those for complete decile tables, regime breakdowns, and per-holdout metrics.*
