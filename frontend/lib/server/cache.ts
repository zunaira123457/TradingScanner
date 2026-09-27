import 'server-only';

/**
 * Tiny in-memory TTL cache with in-flight request de-duplication.
 *
 * Scope is one server instance (one Node process / one serverless instance).
 * That is deliberate: its job is to stop N concurrent viewers from turning
 * into N upstream calls against a free-tier API, not to be a shared store.
 * Stale entries are kept so callers can fall back to them when the upstream
 * budget is exhausted.
 */
export class TTLCache<T> {
  private entries = new Map<string, { value: T; at: number }>();
  private inflight = new Map<string, Promise<T>>();

  constructor(private maxEntries = 500) {}

  get(key: string, ttlMs: number): T | undefined {
    const e = this.entries.get(key);
    return e && Date.now() - e.at < ttlMs ? e.value : undefined;
  }

  /** Returns the entry regardless of age, with its age in ms. */
  peek(key: string): { value: T; ageMs: number } | undefined {
    const e = this.entries.get(key);
    return e ? { value: e.value, ageMs: Date.now() - e.at } : undefined;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, { value, at: Date.now() });
  }

  /** Fresh value if cached, otherwise runs `load` once even for concurrent callers. */
  async getOrLoad(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.get(key, ttlMs);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = load()
      .then((v) => {
        this.set(key, v);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
