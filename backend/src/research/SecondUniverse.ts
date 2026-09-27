/**
 * Experiment 2 (cross-universe replication) — a second, non-overlapping
 * ~50-80 stock universe, selected BEFORE any backtest is run on it, so it
 * cannot have been influenced by how any strategy performs on it. Same
 * good-faith, hand-curated, sector-diversified methodology as
 * downloadUniverse.ts's UNIVERSE_BY_SECTOR (documented there), applied to a
 * disjoint set of liquid large/mid-cap U.S. tickers.
 *
 * Zero-overlap guarantee: every ticker below was checked against
 * downloadUniverse.ts's UNIVERSE_BY_SECTOR and confirmed absent from it.
 * See tests/unit/research/SecondUniverse.test.ts for an automated
 * regression test of that guarantee.
 *
 * Sector labels are hand-curated, not vendor-verified — same disclosed
 * limitation as the original universe (Twelve Data's /profile endpoint is
 * not available on the current plan; see downloadUniverse.ts).
 */

export const SECOND_UNIVERSE_BY_SECTOR: Record<string, string[]> = {
  Technology: ['QCOM', 'TXN', 'AVGO', 'NOW', 'INTU', 'ADI', 'AMAT', 'MU', 'LRCX'],
  'Communication Services': ['WBD', 'PARA', 'EA', 'TTWO', 'OMC'],
  Healthcare: ['CVS', 'CI', 'HUM', 'ELV', 'MDT', 'SYK', 'BSX', 'ISRG', 'VRTX'],
  Financials: ['C', 'USB', 'PNC', 'TFC', 'COF', 'AIG', 'MET', 'PRU', 'ICE'],
  'Consumer Discretionary': ['TJX', 'ROST', 'YUM', 'CMG', 'MAR', 'HLT', 'GM', 'F'],
  'Consumer Staples': ['MDLZ', 'KHC', 'GIS', 'KMB', 'STZ', 'EL'],
  Energy: ['PSX', 'MPC', 'VLO', 'WMB', 'KMI'],
  Industrials: ['MMM', 'DE', 'ETN', 'EMR', 'ITW', 'NOC'],
  Utilities: ['EXC', 'XEL', 'ED', 'PEG', 'WEC'],
  'Real Estate': ['PSA', 'WELL', 'DLR', 'AVB', 'EQR'],
  Materials: ['ECL', 'NUE', 'DOW', 'PPG', 'ALB'],
};

export function getSecondUniverseTickers(): string[] {
  return Object.values(SECOND_UNIVERSE_BY_SECTOR).flat();
}

export function getSecondUniverseSectorMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [sector, tickers] of Object.entries(SECOND_UNIVERSE_BY_SECTOR)) {
    for (const ticker of tickers) map.set(ticker, sector);
  }
  return map;
}
