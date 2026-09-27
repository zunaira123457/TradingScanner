import { getSecondUniverseTickers, SECOND_UNIVERSE_BY_SECTOR } from '@/research/SecondUniverse';
import { getFullUniverseTickers } from '@/scripts/downloadUniverse';

describe('SecondUniverse (Experiment 2 cross-universe replication)', () => {
  it('has zero ticker overlap with the original Phase 4.5 universe', () => {
    const original = new Set(getFullUniverseTickers());
    const second = getSecondUniverseTickers();
    const overlap = second.filter((t) => original.has(t));
    expect(overlap).toEqual([]);
  });

  it('has no internal duplicate tickers', () => {
    const tickers = getSecondUniverseTickers();
    expect(new Set(tickers).size).toBe(tickers.length);
  });

  it('is sized within the pre-registered ~50-80 stock range', () => {
    const tickers = getSecondUniverseTickers();
    expect(tickers.length).toBeGreaterThanOrEqual(50);
    expect(tickers.length).toBeLessThanOrEqual(80);
  });

  it('spans all 11 sectors represented in the original universe', () => {
    const sectors = Object.keys(SECOND_UNIVERSE_BY_SECTOR);
    expect(sectors).toHaveLength(11);
  });
});
