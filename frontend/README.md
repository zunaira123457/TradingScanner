# Trading Desk — real-time market dashboard with an explainable AI scanner

A Next.js trading dashboard: live US equity quotes, interactive candlestick charts with technical indicators, price alerts, and the rule-based + AI **trade scanner** from [`../backend`](../backend) surfaced as signals, chart overlays, and plain-English explanations.

> **Live demo:** _add your URL here_ · **Screenshot/GIF:** _add to `public/` and link here_

## Features

| Area | What it does |
|---|---|
| **Live prices** | Watchlist + index ETFs (SPY/QQQ/DIA/IWM) stream over Server-Sent Events. Rows flash on each tick. The feed status shows live, throttled, or reconnecting. |
| **Charts** | TradingView Lightweight Charts (canvas) with 1m / 5m / 15m / 1H / 1D / 1W candles, zoom/pan/crosshair, and an OHLCV legend. Live ticks update the current bar between refetches. |
| **Indicators** | Volume, SMA 20, EMA 50, Bollinger (20, 2σ), and RSI 14 and MACD (12/26/9) in their own panes. These are pure functions with unit tests. |
| **Annotations** | Scanner entry/stop/target lines, a signal marker, computed 20d/60d support and resistance, and your alert levels. Each can be toggled. |
| **Alerts** | Price above/below and day-%-change alerts with validation, an active list and history. They're stored and evaluated **on the server**, so they fire even when no tab is open. |
| **Notifications** | Web push to phone/desktop (installable PWA — works on iPhone from the Home Screen), plus email and Telegram for the site owner. New BUY/WATCH scanner signals can notify you too. "Send test" checks every channel. |
| **AI scanner** | Ranked BUY/WATCH/AVOID signals across the scan universe, a "rules passed" view for every ticker, market regime, manual re-scan, and a toast when a new signal appears. |
| **AI insights** | For each stock: the scanner's call, a computed trend bias, a trade plan, key levels, and Claude's evidence-based explanation. It also shows the in-sample historical context with its caveats. |
| **Track record** | The forward paper-trading log (out-of-sample) next to the backtest baseline. |
| **Also** | News (Finnhub), a watchlist heatmap, a compare view (normalised % performance), symbol search, dark/light themes, keyboard shortcuts, a responsive layout, and per-panel error boundaries. |

### Keyboard shortcuts
`↑/↓` or `j/k` move through the watchlist · `1–6` pick a timeframe · `/` searches · `a` creates an alert · `n` opens notifications · `t` switches theme · `?` opens help

## Architecture

```
Browser ──(SWR / EventSource)──► Next.js route handlers (app/api/*) ──► Finnhub      (quotes, news, search)
                                   │  • API keys stay server-side     ├─► Twelve Data  (candles, quote fallback)
                                   │  • TTL cache + in-flight dedupe  └─► Scanner API  (backend/src/server)
                                   │  • token-bucket upstream budgets        └─ StrategyEngine → ScoringEngine → Claude explanation
                                   └  • per-client rate limits, zod-validated env, input validation
   ▲
   └── Web Push / email / Telegram ◄── watcher (instrumentation.ts): alerts every 30s in market hours, scanner every 5m
```

Design decisions worth calling out:

- **SSE, not a browser WebSocket.** A direct vendor socket would put the API key in the browser. `/api/stream` keeps keys on the server, and all viewers share one upstream budget through the quote cache. `EventSource` reconnects automatically. The stream refreshes the charted symbol first and round-robins the rest, so the free tier goes where you're looking.
- **Budgets never block.** Upstream calls go through a token bucket that fails fast. When it's empty, routes serve the last good data flagged `stale`, or return 429 with `Retry-After`. No request waits a minute for quota.
- **No fabricated data.** A missing key, an exhausted quota, or a provider error shows up as a visible state in the UI. Bid/ask shows "—" because the free plans don't provide it. Index *levels* are shown through their tracking ETFs and labelled that way.
- **Server-side alerts without accounts.** Each browser generates a random 256-bit key that owns its alerts and push subscriptions; the server stores only its hash. The site owner unlocks email/Telegram with an `OWNER_KEY`, so visitors can't make the site message you. Push endpoints are allow-listed to the real push services (no SSRF).
- **No invented confidence.** The scanner's backtests (see `../MOMENTUM_VALIDATION_REPORT.md`) showed its 0–100 score doesn't predict outcomes. So the UI shows the score as a *ranking*, never as a "win probability", and there's no 24–48h forecast. The AI layer only explains computed values. Historical win rates appear only with their sample sizes and are labelled in-sample.

### Project layout
```
app/api/            route handlers: quotes, stream (SSE), candles, news, search, health, scanner/*
components/charts/  StockChart (Lightweight Charts), TechnicalIndicators
components/dashboard/  Dashboard, WatchlistSection, PriceTicker, ChartPanel, AlertsPanel, NewsFeed, Heatmap, CompareView, MarketOverview
components/ai/      ScannerResults, AIInsights, TrackRecord
components/ui/      shadcn-style primitives (Radix + CVA)
hooks/              useLivePrices (SSE), useStockData (SWR), useAlerts, useWatchlist, useScanner, usePersistentState
lib/api-clients/    stockDataClient (Finnhub/Twelve Data), scannerClient
lib/server/         env (zod), TTL cache, token bucket + client rate limit, error mapping
lib/utils/          technicalAnalysis, chartHelpers, formatters, marketHours
lib/alerts.ts       pure alert evaluation
tests/              vitest: indicators, alerts, live-bar folding
```

## Setup

Prerequisites: Node 20+ and free API keys from [Finnhub](https://finnhub.io/register) and [Twelve Data](https://twelvedata.com).

```bash
# 1. Scanner API (in ../backend)
cd backend && npm install
# add SCANNER_API_KEY=<random string> to backend/.env (plus TWELVE_DATA_API_KEY / ANTHROPIC_API_KEY)
npm run serve            # :4000 — first scan downloads daily bars at 8 req/min

# 2. Dashboard
cd ../frontend && npm install
cp .env.example .env.local   # fill in the keys; AI_SCANNER_API_KEY = backend's SCANNER_API_KEY
npm run dev              # http://localhost:3000
```

The app degrades per feature. Without `FINNHUB_API_KEY`, quotes fall back to Twelve Data at about a 30s cadence, and news is disabled. Without `AI_SCANNER_BASE_URL`, the AI panels explain how to connect it.

**Twelve Data budget.** The free plan allows 8 requests/min and 800/day *per key*. If the dashboard and the scanner share one key, keep `TWELVE_DATA_RPM` at 6 or lower, or use two keys.

### Scripts
```bash
npm run dev         # dev server
npm run build       # production build (type-checks)
npm test            # unit + integration + component tests (Vitest)
npm run test:e2e    # Playwright on 6 browser/device profiles against the production build
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (incl. React Compiler rules)
npm run vapid       # generate Web Push keys
```

Full test strategy and commands: [TESTING.md](TESTING.md).

## Deploying

Self-hosted on your own server and domain with Docker Compose (dashboard + scanner + Caddy for automatic HTTPS). Step-by-step guide: [../DEPLOY.md](../DEPLOY.md).

## Known limitations

- There are no user accounts: alerts belong to the browser that created them (clearing site data starts fresh). The watchlist stays in `localStorage`.
- Storage is a JSON file for a single server instance — simple to run and back up, but not built for horizontal scaling.
- Caches and rate limits are per server instance, which is good enough to protect free-tier quotas but isn't a global quota.
- The market-session badge follows the weekday 9:30–16:00 ET schedule and doesn't know about exchange holidays.

---
Research and paper-trading output only — not investment advice.
