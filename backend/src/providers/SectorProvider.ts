import * as fs from 'fs';
import * as path from 'path';

export interface SectorInfo {
  ticker: string;
  sector: string | null;
  industry: string | null;
}

/**
 * Provider-agnostic sector/industry lookup, deliberately separate from any
 * specific data vendor so it can be swapped for a different source later
 * (e.g. a vendor offering true historical point-in-time classifications)
 * without touching any code that consumes SectorInfo.
 */
export interface ISectorProvider {
  getSector(ticker: string): Promise<SectorInfo>;
  getName(): string;
}

/**
 * Wraps any (ticker) => Promise<{sector, industry}> lookup function with a
 * file-based cache, so repeated backtest runs don't re-fetch classifications
 * that rarely change. This is intentionally decoupled from any specific
 * HTTP client — pass in TwelveDataProvider.getCompanyProfile.bind(provider),
 * or any other vendor's equivalent lookup.
 *
 * LIMITATION (documented, not hidden): this caches and returns the
 * classification as of whenever it was fetched — there is no historical
 * versioning. If the current data provider tier only exposes CURRENT
 * classifications (true for Twelve Data's basic tier at the time this was
 * built), then sector-based analysis of past trades implicitly assumes the
 * company's sector has not changed since the trade occurred. For the vast
 * majority of established large/mid-cap companies this holds, but it is not
 * a guarantee — a company that changed sectors (rare, but it happens) would
 * be misclassified for its older trades.
 */
export class CachedSectorProvider implements ISectorProvider {
  private cache: Map<string, SectorInfo> = new Map();
  private cacheFilePath: string;

  constructor(
    private lookupFn: (ticker: string) => Promise<{ sector: string | null; industry: string | null }>,
    cacheDir: string,
    private providerName = 'cached-sector-provider'
  ) {
    this.cacheFilePath = path.join(cacheDir, 'sector_map.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf-8')) as Record<
          string,
          { sector: string | null; industry: string | null }
        >;
        for (const [ticker, info] of Object.entries(raw)) {
          this.cache.set(ticker, { ticker, sector: info.sector, industry: info.industry });
        }
      }
    } catch {
      // Corrupted cache file: start fresh rather than crashing.
    }
  }

  private saveToDisk(): void {
    const dir = path.dirname(this.cacheFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, { sector: string | null; industry: string | null }> = {};
    for (const [ticker, info] of this.cache) {
      obj[ticker] = { sector: info.sector, industry: info.industry };
    }
    fs.writeFileSync(this.cacheFilePath, JSON.stringify(obj, null, 2));
  }

  async getSector(ticker: string): Promise<SectorInfo> {
    const upper = ticker.toUpperCase();
    const cached = this.cache.get(upper);
    if (cached) return cached;

    const { sector, industry } = await this.lookupFn(upper);
    const info: SectorInfo = { ticker: upper, sector, industry };
    this.cache.set(upper, info);
    this.saveToDisk();
    return info;
  }

  /** Ticker -> sector, for tickers already resolved this session (no I/O). */
  toSectorMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const [ticker, info] of this.cache) {
      if (info.sector) map.set(ticker, info.sector);
    }
    return map;
  }

  getName(): string {
    return this.providerName;
  }
}
