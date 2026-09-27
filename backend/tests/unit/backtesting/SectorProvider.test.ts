import { CachedSectorProvider } from '@/providers/SectorProvider';
import * as fs from 'fs';
import * as path from 'path';

describe('CachedSectorProvider', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = path.join(__dirname, '../../.sector-cache-test');
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true });
  });

  it('should call the lookup function on a cache miss and return the result', async () => {
    const lookupFn = jest.fn().mockResolvedValue({ sector: 'Technology', industry: 'Software' });
    const provider = new CachedSectorProvider(lookupFn, cacheDir);

    const info = await provider.getSector('AAPL');

    expect(info).toEqual({ ticker: 'AAPL', sector: 'Technology', industry: 'Software' });
    expect(lookupFn).toHaveBeenCalledTimes(1);
  });

  it('should NOT call the lookup function again on a cache hit (same instance)', async () => {
    const lookupFn = jest.fn().mockResolvedValue({ sector: 'Technology', industry: 'Software' });
    const provider = new CachedSectorProvider(lookupFn, cacheDir);

    await provider.getSector('AAPL');
    await provider.getSector('AAPL');
    await provider.getSector('aapl'); // case-insensitive

    expect(lookupFn).toHaveBeenCalledTimes(1);
  });

  it('should persist the cache to disk and reuse it across instances', async () => {
    const lookupFn = jest.fn().mockResolvedValue({ sector: 'Healthcare', industry: 'Biotechnology' });
    const provider1 = new CachedSectorProvider(lookupFn, cacheDir);
    await provider1.getSector('JNJ');

    const lookupFn2 = jest.fn().mockResolvedValue({ sector: 'SHOULD_NOT_BE_CALLED', industry: null });
    const provider2 = new CachedSectorProvider(lookupFn2, cacheDir);
    const info = await provider2.getSector('JNJ');

    expect(info.sector).toBe('Healthcare');
    expect(lookupFn2).not.toHaveBeenCalled();
  });

  it('should cache null results too (avoid re-querying known-unavailable tickers every run)', async () => {
    const lookupFn = jest.fn().mockResolvedValue({ sector: null, industry: null });
    const provider = new CachedSectorProvider(lookupFn, cacheDir);

    await provider.getSector('UNKNOWNTICKER');
    await provider.getSector('UNKNOWNTICKER');

    expect(lookupFn).toHaveBeenCalledTimes(1);
  });

  it('toSectorMap should only include tickers with a known (non-null) sector', async () => {
    const lookupFn = jest
      .fn()
      .mockResolvedValueOnce({ sector: 'Technology', industry: 'Software' })
      .mockResolvedValueOnce({ sector: null, industry: null });
    const provider = new CachedSectorProvider(lookupFn, cacheDir);

    await provider.getSector('AAPL');
    await provider.getSector('UNKNOWN');

    const map = provider.toSectorMap();
    expect(map.get('AAPL')).toBe('Technology');
    expect(map.has('UNKNOWN')).toBe(false);
  });

  it('should start fresh (not crash) if the cache file is corrupted', () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'sector_map.json'), '{ not valid json');

    const lookupFn = jest.fn();
    expect(() => new CachedSectorProvider(lookupFn, cacheDir)).not.toThrow();
  });
});
