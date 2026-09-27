import { UNIVERSE_BY_SECTOR, getFullUniverseTickers, getHandCuratedSectorMap } from '@/scripts/downloadUniverse';

describe('downloadUniverse universe selection', () => {
  it('should contain no duplicate tickers across sectors', () => {
    const tickers = getFullUniverseTickers();
    const unique = new Set(tickers);
    expect(unique.size).toBe(tickers.length);
  });

  it('should span at least 8 distinct sectors for genuine diversity', () => {
    expect(Object.keys(UNIVERSE_BY_SECTOR).length).toBeGreaterThanOrEqual(8);
  });

  it('should have at least 3 tickers in every sector (no token single-stock sectors)', () => {
    for (const [sector, tickers] of Object.entries(UNIVERSE_BY_SECTOR)) {
      expect(tickers.length).toBeGreaterThanOrEqual(3);
      expect(sector).toBeTruthy();
    }
  });

  it('getHandCuratedSectorMap should invert UNIVERSE_BY_SECTOR completely and consistently', () => {
    const map = getHandCuratedSectorMap();
    const tickers = getFullUniverseTickers();

    expect(map.size).toBe(tickers.length);
    for (const [sector, sectorTickers] of Object.entries(UNIVERSE_BY_SECTOR)) {
      for (const ticker of sectorTickers) {
        expect(map.get(ticker)).toBe(sector);
      }
    }
  });

  it('should only contain plausible ticker symbols (uppercase letters, 1-5 chars)', () => {
    for (const ticker of getFullUniverseTickers()) {
      expect(ticker).toMatch(/^[A-Z]{1,5}$/);
    }
  });
});
