import type {
  Candle,
  NewsItem,
  PerformanceResponse,
  Quote,
  ScanSnapshot,
  ScannerSignal,
  TickerAnalysis,
} from '@/lib/types';

export const NOW = Date.UTC(2026, 8, 25, 19, 59); // Fri 2026-09-25 15:59 ET

export function quote(symbol = 'AAPL', over: Partial<Quote> = {}): Quote {
  return {
    symbol,
    price: 341.07,
    change: 5.15,
    changePercent: 1.53,
    open: 336.04,
    high: 341.67,
    low: 334.53,
    prevClose: 335.92,
    volume: 29_950_100,
    bid: null,
    ask: null,
    timestamp: NOW,
    fetchedAt: NOW,
    source: 'twelvedata',
    ...over,
  };
}

/** Deterministic random-walk candles (seeded) so indicator math is reproducible. */
export function candles(n = 120, { start = Date.UTC(2026, 0, 2) / 1000, step = 86_400, base = 100 } = {}): Candle[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out: Candle[] = [];
  let close = base;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, open + rnd() * 4);
    const high = Math.max(open, close) + Math.abs(rnd()) * 2;
    const low = Math.min(open, close) - Math.abs(rnd()) * 2;
    out.push({ time: start + i * step, open, high, low, close, volume: 1_000_000 + Math.round(Math.abs(rnd()) * 500_000) });
  }
  return out;
}

export function news(n = 3): NewsItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    headline: `Headline ${i + 1}`,
    summary: `Summary ${i + 1}`,
    source: 'Reuters',
    url: `https://example.com/news/${i + 1}`,
    image: null,
    datetime: NOW - i * 3_600_000,
  }));
}

export function signal(over: Partial<ScannerSignal> = {}): ScannerSignal {
  return {
    rank: 1,
    ticker: 'NVDA',
    strategy: 'trend_pullback',
    classification: 'BUY',
    score: 72,
    scoreBreakdown: { trend: 20, momentum: 10, volume: 8, relativeStrength: 12, chartSetup: 10, marketRegime: 6, riskReward: 6, total: 72 },
    setupDetected: true,
    setupStrength: 0.8,
    entry: 180.5,
    stop: 172.25,
    target: 197,
    riskRewardRatio: 2,
    reasons: ['Pullback to EMA21 in an uptrend'],
    risks: ['Earnings in 9 days'],
    invalidation: 'Close below $172.25',
    asOf: '2026-09-25T20:00:00.000Z',
    historical: {
      baseline: {
        strategy: 'trend_pullback',
        trades: 226,
        profitFactor: 1.14,
        sharpe: 0.38,
        cagr: 3.71,
        expectancyPerTrade: 12,
        totalReturnPct: 40,
        medianStockPnlNegative: false,
        pctStocksProfitable: 55,
        concentrationNote: 'Returns concentrated in a few names.',
        datasetDescription: '81 stocks 2015-2025',
      },
      regime: { label: 'trend_pullback / bullish', trades: 90, winRatePct: 51.1, profitFactor: 1.2, note: null, sampleSizeSufficient: true },
      ticker: null,
    },
    ...over,
  };
}

export function snapshot(over: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return {
    status: 'ready',
    universe: ['AAPL', 'MSFT', 'NVDA'],
    generatedAt: '2026-09-27T05:00:00.000Z',
    durationMs: 1200,
    progress: { done: 3, total: 3 },
    marketRegime: { label: 'bullish', compositeScore: 0.27, isHighVolatility: false },
    signals: [signal(), signal({ rank: 2, ticker: 'AAPL', classification: 'AVOID', score: 0, setupDetected: false, entry: null, stop: null, target: null, riskRewardRatio: null })],
    errors: [],
    ...over,
  };
}

export function analysis(ticker = 'AAPL', over: Partial<TickerAnalysis> = {}): TickerAnalysis {
  return {
    ticker,
    asOf: '2026-09-25',
    lastClose: 341.07,
    levels: { support20: 309.4, resistance20: 345.34, support60: 289.2, resistance60: 345.34, lastSwingHigh: 345.34, lastSwingLow: 309.9 },
    structure: 'uptrend',
    multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bullish', aligned: true },
    marketRegime: { label: 'bullish', compositeScore: 0.27, isHighVolatility: false },
    relativeStrength: { periodDays: 63, stockReturn: 0.202, vsBenchmark: 0.144, outperformingBoth: true },
    indicators: { rsi14: 65.7, macd: 1.2, macdSignal: 0.9, macdHistogram: 0.3, adx14: 20.2, atr14: 6.98, sma50: 320, sma200: 290, relativeVolume: 1.1, historicalVolatility20: 0.25 },
    signals: [signal({ ticker, classification: 'AVOID', score: 0, setupDetected: false, entry: null, stop: null, target: null, riskRewardRatio: null, invalidation: 'No active setup.' })],
    ai: {
      status: 'ok',
      source: 'ai',
      result: {
        summary: `${ticker} is in an uptrend (mtfAligned: true) under the trend_pullback strategy.`,
        signalStatus: 'AVOID',
        whyItQualified: [],
        supportingEvidence: ['Daily and weekly trends are bullish'],
        conflictingEvidence: ['No pullback in progress (strategyWarnings)'],
        regimeContext: { regime: 'bullish', note: 'Bullish regime' },
        historicalContext: { note: '', baselineSummary: null, regimeSummary: null, tickerSummary: null },
        riskFlags: ['Extended above SMA50'],
        limitations: ['Daily data only.'],
        quantitativeScore: { total: 0, classification: 'AVOID', note: '' },
        aiConfidence: null,
      },
    },
    ...over,
  };
}

export function performance(): PerformanceResponse {
  return {
    config: { lockedStartDate: '2026-08-18', strategyName: 'momentum_continuation', initialCapital: 10_000, universeVersion: 'v1' },
    asOfDate: '2026-09-25',
    trades: [{ ticker: 'MSFT', entryDate: '2026-08-20', exitDate: '2026-09-01', entryPrice: 400, exitPrice: 420, pnl: 50 }],
    equityCurve: [
      { date: '2026-08-18', cash: 10_000, equity: 10_000, openPositionsCount: 0, exposurePct: 0 },
      { date: '2026-09-25', cash: 9_000, equity: 10_050, openPositionsCount: 1, exposurePct: 10 },
    ],
    baselines: [snapshot().signals[0].historical.baseline!],
  };
}

/** Routes fetch() by URL substring (first match wins); unmatched URLs reject. */
export type Route = [match: string | RegExp, respond: (url: URL, init?: RequestInit) => Response | Promise<Response>];

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function routeFetch(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://localhost');
    calls.push({ url: url.toString(), init });
    for (const [m, respond] of routes) {
      if (typeof m === 'string' ? url.toString().includes(m) : m.test(url.toString())) return respond(url, init);
    }
    throw new TypeError(`fetch failed: unmocked ${url}`);
  };
  return Object.assign(fn, { calls });
}

/** Minimal EventSource double: tests push events with `emit`. */
export class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(cb);
  }
  emit(type: string, data: unknown) {
    this.readyState = 1;
    for (const cb of this.listeners.get(type) ?? []) cb(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  static reset() {
    FakeEventSource.instances = [];
  }
  static get open() {
    return FakeEventSource.instances.filter((s) => !s.closed);
  }
}
