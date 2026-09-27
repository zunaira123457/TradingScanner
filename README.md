# AI-Assisted Stock Market Research & Paper Trading Platform

A quantitative research system for scanning U.S. equities, detecting technical
setups with explicit rules, evaluating them against historical evidence, and
producing explainable BUY / WATCH / AVOID signals — with paper trading only,
no live order execution.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for full architecture, phases, and
design decisions.

## Status: Phase 1 — Foundation (complete)

Built so far:
- TypeScript/Node backend project scaffold
- Configuration system (env vars, `.env.example`, validation)
- `MarketDataProvider` interface + Twelve Data implementation
- File-backed + in-memory hybrid cache for candles/quotes/metadata
- Historical data downloader (single + batch, retry, rate-limit aware)
- Data validator (OHLC consistency, gaps, duplicates, chronology, quality score)
- Configurable stock universe filter (price, volume, dollar volume, history length)
- 36 passing unit tests covering validation, universe filtering, and caching

Not yet built (later phases): indicators, pattern detection, strategies,
scoring, backtesting, AI analysis layer, dashboard, paper trading.

## Dashboard (frontend/) and scanner API

A Next.js real-time dashboard lives in [`frontend/`](frontend/README.md). It shows live quotes, charts
with indicators, alerts, and this project's scanner signals with AI explanations. It reads the
scanner through a small read-only HTTP API:

```bash
cd backend
npm run serve   # :4000 — GET /v1/scan, /v1/analysis/:ticker, /v1/performance (x-api-key: SCANNER_API_KEY)
```

See `frontend/README.md` for setup and [DEPLOY.md](DEPLOY.md) to host it on your own domain.

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` and set `TWELVE_DATA_API_KEY` (free tier at
[twelvedata.com](https://twelvedata.com)). Nothing in this repo will run
without a real API key — there is no mock/fake data path.

## Running

```bash
cd backend

# Type-check
npm run type-check

# Run unit tests
npm test

# Run the Phase 1 demo (downloads + validates AAPL, prints universe evaluation)
npm run dev

# Download historical data for specific tickers
npm run download-data -- AAPL MSFT GOOGL

# Validate cached data / check universe membership
npm run validate-data -- AAPL MSFT GOOGL
```

Downloaded data is cached under `backend/data/cache/` (gitignored) so repeat
runs don't re-hit the API unnecessarily.

## Non-negotiable rules this project follows

- Stocks only — no crypto, forex, options, or futures.
- No live/automatic trading. Paper trading only.
- No fabricated market data or fake API responses — if a provider call fails,
  the code raises an error rather than substituting placeholder data.
- No look-ahead bias in backtesting (enforced starting Phase 4).
- Every signal must be explainable and traceable to real, calculated data.
