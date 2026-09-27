/**
 * Interface for a point-in-time historical stock universe source: given a
 * date, returns the set of tickers that were actually tradeable/listed
 * members of a reference universe (e.g. S&P 500 constituents) AS OF that
 * date — including companies later delisted, acquired, or removed, which a
 * "use today's ticker list" approach silently excludes.
 *
 * STATUS: NOT IMPLEMENTED. No source currently integrated with this system
 * supplies true historical point-in-time constituent membership. Twelve
 * Data's available tier exposes only the CURRENT stock/ETF universe via
 * /stocks — no endpoint was found that returns "what was in the S&P 500 on
 * 2020-06-15" including names later delisted.
 *
 * This interface exists so a genuine point-in-time provider (e.g. a vendor
 * offering historical index-constituent files) can be plugged in later
 * without changing any code that consumes a stock universe.
 */
export interface PointInTimeUniverseProvider {
  getUniverseAsOf(date: Date): Promise<string[]>;
  getName(): string;
}

/**
 * Explicit placeholder that documents the limitation via a thrown error if
 * ever called, rather than silently returning today's universe disguised as
 * historical membership. Callers should catch this and fall back to (and
 * clearly LABEL) a today's-universe-projected-backward approach, which is
 * what every backtest in this system currently does.
 */
export class UnimplementedPointInTimeUniverseProvider implements PointInTimeUniverseProvider {
  async getUniverseAsOf(_date: Date): Promise<string[]> {
    throw new Error(
      'No point-in-time historical universe source is configured. This system ' +
        "currently cannot supply true historical index constituent membership. " +
        "Backtests use a survivorship-biased universe (today's liquid stocks " +
        'projected backward) and must be labeled as such — see SURVIVORSHIP_BIAS_DISCLOSURE.'
    );
  }

  getName(): string {
    return 'unimplemented-point-in-time-universe';
  }
}

export const SURVIVORSHIP_BIAS_DISCLOSURE = `
This backtest's stock universe was selected based on liquidity and listing
status as of TODAY, then applied across the entire historical backtest
period. This is survivorship bias: it structurally excludes companies that
were delisted, went bankrupt, were acquired, or became illiquid during the
backtest window, because they don't appear in today's "current stocks"
list to begin with.

The practical effect is that survivorship bias tends to modestly-to-
significantly INFLATE backtested returns relative to what a trader running
the same rules in real time, against the true point-in-time universe,
would have experienced — failed/delisted companies (which would have
contributed real losing trades) are structurally absent from the data,
while "the stocks that turned out to survive and stay liquid" is, by
construction, a biased sample.

No source currently integrated with this system supplies genuine
historical point-in-time index-constituent data (see
PointInTimeUniverseProvider in this file). Every result in this report
should be read with this limitation in mind, not treated as free of
survivorship bias.
`.trim();
