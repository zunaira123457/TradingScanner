// Deterministic stand-in for Finnhub, Twelve Data and the scanner API, used by
// the Playwright suite. POST /__control adjusts behaviour mid-test.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const BASE = { AAPL: 341.07, MSFT: 516.17, NVDA: 225.07, AMZN: 249.67, GOOGL: 343.92, META: 751.66, TSLA: 372.11, AMD: 160.2, NFLX: 1200.5, JPM: 343.06, SPY: 771.35, QQQ: 600.12, DIA: 460.33, IWM: 245.8, PLTR: 180.25, SLOW: 10, LIMIT: 20 };
const state = { mode: 'normal', delayMs: 0, override: {}, calls: 0 };
const ticks = {};

function price(sym) {
  if (state.override[sym] !== undefined) return state.override[sym];
  ticks[sym] = (ticks[sym] ?? 0) + 1;
  const base = BASE[sym] ?? null;
  if (base === null) return null;
  // Small deterministic wiggle so every fetch looks like a new tick.
  return +(base + Math.sin(ticks[sym] / 2) * base * 0.002).toFixed(2);
}

function candles(sym, interval, n = 500) {
  const base = BASE[sym] ?? 100;
  const step = { '1min': 60, '5min': 300, '15min': 900, '1h': 3600, '1day': 86400, '1week': 604800 }[interval] ?? 86400;
  const end = Math.floor(Date.now() / 1000 / step) * step;
  let seed = [...sym].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  let close = base * 0.85;
  for (let i = n - 1; i >= 0; i--) {
    const open = close;
    close = Math.max(1, open * (1 + rnd() * 0.02 + 0.0004));
    const t = new Date((end - i * step) * 1000).toISOString();
    out.push({
      datetime: step >= 86400 ? t.slice(0, 10) : t.slice(0, 19).replace('T', ' '),
      open: open.toFixed(2), high: (Math.max(open, close) * 1.004).toFixed(2), low: (Math.min(open, close) * 0.996).toFixed(2), close: close.toFixed(2), volume: String(1_000_000 + Math.floor(Math.abs(rnd()) * 900_000)),
    });
  }
  return out;
}

const signal = (ticker, cls, score) => ({
  rank: 1, ticker, strategy: 'trend_pullback', classification: cls, score,
  scoreBreakdown: { trend: 20, momentum: 10, volume: 8, relativeStrength: 12, chartSetup: 10, marketRegime: 6, riskReward: 6, total: score },
  setupDetected: cls !== 'AVOID', setupStrength: 0.8,
  entry: cls === 'AVOID' ? null : 224.5, stop: cls === 'AVOID' ? null : 216.25, target: cls === 'AVOID' ? null : 241, riskRewardRatio: cls === 'AVOID' ? null : 2,
  reasons: ['Pullback to EMA21 in an uptrend'], risks: ['Earnings soon'], invalidation: 'Close below stop', asOf: new Date().toISOString(),
  historical: { baseline: { strategy: 'trend_pullback', trades: 226, profitFactor: 1.14, sharpe: 0.38, cagr: 3.71, expectancyPerTrade: 12, totalReturnPct: 40, medianStockPnlNegative: false, pctStocksProfitable: 55, concentrationNote: 'Returns concentrated in a few names.', datasetDescription: '81 stocks' }, regime: null, ticker: null },
});

function analysis(t) {
  return {
    ticker: t, asOf: new Date().toISOString().slice(0, 10), lastClose: BASE[t] ?? 100,
    levels: { support20: (BASE[t] ?? 100) * 0.9, resistance20: (BASE[t] ?? 100) * 1.02, support60: (BASE[t] ?? 100) * 0.85, resistance60: (BASE[t] ?? 100) * 1.05, lastSwingHigh: null, lastSwingLow: null },
    structure: 'uptrend', multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bullish', aligned: true },
    marketRegime: { label: 'bullish', compositeScore: 0.27, isHighVolatility: false },
    relativeStrength: { periodDays: 63, stockReturn: 0.1, vsBenchmark: 0.05 },
    indicators: { rsi14: 61, macd: 1, macdSignal: 0.8, macdHistogram: 0.2, adx14: 24, atr14: 5, sma50: 300, sma200: 280, relativeVolume: 1.2, historicalVolatility20: 0.3 },
    signals: [signal(t, t === 'NVDA' ? 'BUY' : 'AVOID', t === 'NVDA' ? 72 : 0)],
    ai: { status: 'ok', source: 'ai', result: { summary: `${t} shows a bullish daily and weekly trend (mtfAligned: true).`, signalStatus: 'x', whyItQualified: [], supportingEvidence: ['Trend aligned'], conflictingEvidence: [], regimeContext: { regime: 'bullish', note: '' }, historicalContext: { note: '', baselineSummary: null, regimeSummary: null, tickerSummary: null }, riskFlags: ['Volatility elevated'], limitations: ['Daily bars only.'], quantitativeScore: { total: 0, classification: 'AVOID', note: '' }, aiConfidence: null } },
  };
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const q = (k) => url.searchParams.get(k);

  if (p === '/__control') {
    let body = '';
    for await (const chunk of req) body += chunk;
    Object.assign(state, JSON.parse(body || '{}'));
    return send(res, 200, state);
  }
  if (p === '/__state') return send(res, 200, state);
  state.calls++;
  if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
  if (state.mode === 'down' && !p.startsWith('/scanner/health')) return send(res, 503, { error: 'unavailable' });
  if (state.mode === 'ratelimit' && p.startsWith('/twelve')) return send(res, 200, { status: 'error', code: 429, message: 'You have run out of API credits' });

  // Finnhub
  if (p === '/finnhub/quote') {
    const sym = q('symbol'); const c = price(sym);
    if (c === null) return send(res, 200, { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    const pc = BASE[sym] * 0.99;
    return send(res, 200, { c, d: +(c - pc).toFixed(2), dp: +(((c - pc) / pc) * 100).toFixed(4), h: c * 1.01, l: c * 0.98, o: pc * 1.002, pc, t: Math.floor(Date.now() / 1000) });
  }
  if (p === '/finnhub/company-news') {
    const sym = q('symbol');
    return send(res, 200, Array.from({ length: 5 }, (_, i) => ({ id: i + 1, headline: `${sym} headline ${i + 1}`, summary: `Summary for ${sym} story ${i + 1}.`, source: 'MockWire', url: `https://example.com/${sym}/${i + 1}`, image: '', datetime: Math.floor(Date.now() / 1000) - i * 3600 })));
  }
  if (p === '/finnhub/search') {
    const term = (q('q') ?? '').toUpperCase();
    const result = Object.keys(BASE).filter((s) => s.startsWith(term)).map((s) => ({ symbol: s, description: `${s} Inc`, type: 'Common Stock' }));
    return send(res, 200, { count: result.length, result });
  }
  // Twelve Data
  if (p === '/twelve/time_series') {
    const sym = q('symbol');
    if (sym === 'SLOW') await new Promise((r) => setTimeout(r, 10_000)); // > the app's 8s upstream timeout
    if (sym === 'LIMIT') return send(res, 200, { status: 'error', code: 429, message: 'You have run out of API credits' });
    if (!(sym in BASE)) return send(res, 200, { status: 'error', code: 400, message: `**symbol** ${sym} not found` });
    return send(res, 200, { meta: { symbol: sym }, values: candles(sym, q('interval')), status: 'ok' });
  }
  if (p === '/twelve/quote') {
    const sym = q('symbol'); const c = price(sym);
    if (c === null) return send(res, 200, { status: 'error', code: 404, message: 'not found' });
    return send(res, 200, { symbol: sym, close: String(c), change: '1', percent_change: '0.5', open: String(c), high: String(c), low: String(c), previous_close: String(c - 1), volume: '1000', timestamp: Math.floor(Date.now() / 1000) });
  }
  // Scanner
  if (p === '/scanner/health') return send(res, 200, { status: 'ok', aiEnabled: true });
  if (p === '/scanner/v1/scan/refresh') return send(res, 202, { status: 'started' });
  if (p === '/scanner/v1/scan') {
    return send(res, 200, { status: 'ready', universe: Object.keys(BASE), generatedAt: new Date(Date.now() - 60_000).toISOString(), durationMs: 900, progress: { done: 15, total: 15 }, marketRegime: { label: 'bullish', compositeScore: 0.27, isHighVolatility: false }, signals: [signal('NVDA', 'BUY', 72), signal('AAPL', 'AVOID', 0), signal('MSFT', 'AVOID', 0)], errors: [] });
  }
  if (p.startsWith('/scanner/v1/analysis/')) return send(res, 200, analysis(decodeURIComponent(p.split('/').pop())));
  if (p === '/scanner/v1/performance') {
    return send(res, 200, { config: { lockedStartDate: '2026-08-18', strategyName: 'momentum_continuation', initialCapital: 10000, universeVersion: 'v1' }, asOfDate: '2026-09-25', trades: [], equityCurve: [{ date: '2026-08-18', cash: 10000, equity: 10000, openPositionsCount: 0, exposurePct: 0 }], baselines: [signal('X', 'BUY', 1).historical.baseline] });
  }
  send(res, 404, { error: 'mock: no route', path: p });
}).listen(PORT, '127.0.0.1', () => console.log(`mock market on :${PORT}`));
