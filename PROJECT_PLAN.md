# AI-Assisted Stock Market Research & Paper Trading Platform

## Architecture Overview

```
Frontend (React/TypeScript)
    ↓
API Gateway (Express.js)
    ↓
Application Services
    ├── Market Data Service
    ├── Stock Universe Service
    ├── Indicator Engine
    ├── Strategy Engine
    ├── Scoring Engine
    ├── Backtesting Engine
    ├── AI Analysis Service
    └── Paper Trading Service
    ↓
Quant Engine (Core Logic)
    ├── Market Data Provider (Abstraction)
    ├── Indicators (SMA, EMA, RSI, MACD, etc.)
    ├── Pattern Detection (Price structure, charts)
    ├── Multi-timeframe Analysis
    ├── Market Regime Detection
    ├── Sector Analysis
    ├── Historical Setup Analysis
    ├── Risk Management
    └── Position Sizing
    ↓
Database & Cache
    ├── PostgreSQL (Primary)
    ├── Redis (Real-time cache)
    └── Local file cache (Historical data)
```

## Technology Stack

### Backend
- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Cache**: Redis (optional for early phases)
- **Testing**: Jest
- **Environment**: dotenv

### Frontend
- **Framework**: React 18+
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Charts**: TradingView Lightweight Charts or Recharts
- **HTTP**: Axios or Fetch API

### Quantitative
- **Indicators**: custom TypeScript implementations
- **Backtesting**: custom event-driven engine
- **Data**: CSV/JSON file-based initially, PostgreSQL later

### AI
- **Claude API** via Anthropic SDK
- **Purpose**: Analysis and explanation layer only
- **Input**: Structured quantitative data
- **Output**: Reasoning, classification (BUY/WATCH/AVOID)

### Market Data
- **Primary**: Twelve Data API (free tier available)
- **Fallback**: Alpha Vantage, IEX Cloud
- **Local Cache**: SQLite/PostgreSQL + file system

## Folder Structure

```
ai-trading-bot/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── index.ts
│   │   │   ├── constants.ts
│   │   │   └── environment.ts
│   │   ├── types/
│   │   │   ├── index.ts
│   │   │   ├── market.ts
│   │   │   ├── strategy.ts
│   │   │   └── trade.ts
│   │   ├── providers/
│   │   │   ├── MarketDataProvider.ts (interface)
│   │   │   ├── TwelveDataProvider.ts
│   │   │   ├── AlphaVantageProvider.ts
│   │   │   └── CacheProvider.ts
│   │   ├── data/
│   │   │   ├── DataDownloader.ts
│   │   │   ├── DataValidator.ts
│   │   │   ├── StockUniverse.ts
│   │   │   └── CacheManager.ts
│   │   ├── indicators/
│   │   │   ├── index.ts
│   │   │   ├── MovingAverages.ts
│   │   │   ├── Momentum.ts
│   │   │   ├── Volatility.ts
│   │   │   └── Volume.ts
│   │   ├── patterns/
│   │   │   ├── PriceStructure.ts
│   │   │   └── ChartPatterns.ts
│   │   ├── analysis/
│   │   │   ├── MultiTimeframe.ts
│   │   │   ├── MarketRegime.ts
│   │   │   └── SectorStrength.ts
│   │   ├── strategies/
│   │   │   ├── Strategy.ts (interface)
│   │   │   ├── TrendPullback.ts
│   │   │   ├── Breakout.ts
│   │   │   ├── MomentumContinuation.ts
│   │   │   └── StrategyEngine.ts
│   │   ├── scoring/
│   │   │   └── ScoringEngine.ts
│   │   ├── backtesting/
│   │   │   ├── Backtester.ts
│   │   │   ├── Portfolio.ts
│   │   │   └── Metrics.ts
│   │   ├── ai/
│   │   │   ├── AnalysisEngine.ts
│   │   │   └── SignalExplainer.ts
│   │   ├── trading/
│   │   │   ├── PaperPortfolio.ts
│   │   │   └── RiskManager.ts
│   │   ├── database/
│   │   │   ├── connection.ts
│   │   │   ├── migrations/
│   │   │   └── schema.ts
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── market.ts
│   │   │   │   ├── stocks.ts
│   │   │   │   ├── strategies.ts
│   │   │   │   └── trading.ts
│   │   │   └── middleware/
│   │   │       └── errorHandler.ts
│   │   ├── utils/
│   │   │   ├── logger.ts
│   │   │   ├── dateUtils.ts
│   │   │   └── mathUtils.ts
│   │   ├── services/
│   │   │   ├── MarketDataService.ts
│   │   │   ├── StockUniverseService.ts
│   │   │   ├── StrategyService.ts
│   │   │   └── TradingService.ts
│   │   └── app.ts
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── fixtures/
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── store/
│   │   ├── types/
│   │   ├── utils/
│   │   └── App.tsx
│   ├── public/
│   ├── package.json
│   └── tsconfig.json
├── data/
│   ├── cache/ (ignored in git)
│   └── backtest-results/ (ignored in git)
├── .gitignore
├── .env.example
├── PROJECT_PLAN.md
└── README.md
```

## Data Flow

### Real-Time Analysis Pipeline
```
Market Data Provider
    ↓
Data Downloader (periodic)
    ↓
Cache Manager (local storage)
    ↓
Stock Universe Filter
    ↓
Indicator Calculation
    ↓
Pattern Detection
    ↓
Multi-timeframe Analysis
    ↓
Market Regime Detection
    ↓
Scoring Engine
    ↓
AI Analysis (explanation)
    ↓
Signal Generation (BUY/WATCH/AVOID)
    ↓
API → Dashboard
```

### Backtesting Pipeline
```
Historical Data (from cache)
    ↓
Walk-forward Iterator
    ↓
Strategy Entry/Exit Logic
    ↓
Position Management
    ↓
Risk Management
    ↓
Metrics Calculation
    ↓
Results Storage
```

## Database Design

### Core Tables

**stocks**
- id (PK)
- ticker (UNIQUE)
- company_name
- sector
- industry
- market_cap
- avg_volume_30d
- created_at
- updated_at

**price_history**
- id (PK)
- stock_id (FK)
- date
- open
- high
- low
- close
- adjusted_close
- volume
- created_at
- UNIQUE(stock_id, date)
- INDEX(stock_id, date DESC)

**indicators**
- id (PK)
- stock_id (FK)
- date
- sma_20, sma_50, sma_100, sma_200
- ema_9, ema_21, ema_50, ema_200
- rsi_14, macd, macd_signal, macd_hist
- atr, bb_upper, bb_middle, bb_lower
- stoch_k, stoch_d
- obv, volume_sma_20
- relative_volume
- created_at
- INDEX(stock_id, date DESC)

**signals**
- id (PK)
- stock_id (FK)
- date
- strategy
- signal_type (BUY/WATCH/AVOID)
- score (0-100)
- entry_price
- stop_price
- target_price
- risk_reward
- market_regime
- explanation
- historical_stats_json
- created_at

**paper_trades**
- id (PK)
- stock_id (FK)
- entry_date
- entry_price
- entry_shares
- stop_price
- target_price
- exit_date (nullable)
- exit_price (nullable)
- exit_reason
- realized_pnl
- status (OPEN/CLOSED)
- strategy
- created_at

**backtests**
- id (PK)
- name
- strategy_id
- start_date
- end_date
- total_return
- cagr
- win_rate
- profit_factor
- sharpe
- max_drawdown
- num_trades
- results_json
- created_at

## Market Data Provider Strategy

### Phase 1-3: File-based + Free API
- Use **Twelve Data** free tier (limited stocks/history)
- Cache locally in CSV/JSON
- SQLite for metadata
- No live connection until Phase 6

### Phase 4+: Upgrade to paid provider
- Consider Alpha Vantage Premium or Twelve Data Premium
- Add PostgreSQL for scalability
- Implement Redis for real-time caching

### Provider Interface
```typescript
interface MarketDataProvider {
  getHistoricalData(ticker: string, startDate: Date, endDate: Date): Promise<Candle[]>;
  getLatestPrice(ticker: string): Promise<Quote>;
  getStockMetadata(ticker: string): Promise<StockInfo>;
  getMultipleHistorical(tickers: string[]): Promise<Map<string, Candle[]>>;
}
```

## Indicator Engine

### Moving Averages
- SMA 20, 50, 100, 200
- EMA 9, 21, 50, 200

### Momentum
- RSI (14)
- MACD (12, 26, 9)
- Stochastic (14, 3, 3)
- ROC (12)
- ADX (14)

### Volatility
- ATR (14)
- Bollinger Bands (20, 2)
- Historical Volatility (20)

### Volume
- Relative Volume
- Volume SMA (20)
- On-Balance Volume (OBV)

**Key Rule**: Indicators calculated once, reused across all strategies.

## Pattern Detection

### Price Structure
- Higher highs / Higher lows (uptrend)
- Lower highs / Lower lows (downtrend)
- Consolidation zones
- Support/Resistance levels
- Gap detection

### Chart Patterns (Objective Rules)
1. **Breakout from consolidation**: Price > max(resistance, past 20 days), volume > avg
2. **Trend pullback**: Price above SMA, pullback to SMA, recovery setup
3. **Bull flag**: Higher lows during consolidation, breakout above
4. **Support bounce**: Price tests support, reverses with volume
5. More patterns added incrementally

## Strategies (Phase 3)

### 1. Trend Pullback
Requirements:
- Price > 50 SMA
- 50 SMA > 200 SMA (bull market)
- Recent strong uptrend
- Pullback to 20 or 50 SMA
- Relative volume rising
- Support below entry

### 2. Breakout
Requirements:
- Consolidation (low volatility)
- Clear resistance level
- Breakout above resistance with volume
- Favorable market regime

### 3. Momentum Continuation
Requirements:
- Strong uptrend
- RSI > 60
- Price above all major EMAs
- Volume confirmation
- Relative strength positive

## Scoring System (Phase 3)

**Weights** (configurable):
- Trend: 20%
- Momentum: 15%
- Volume: 15%
- Relative Strength: 15%
- Chart Setup: 20%
- Market Regime: 5%
- Risk/Reward: 10%

**Output**: Transparent score 0-100 with component breakdown.

## Backtesting Engine (Phase 4)

### Features
- Event-driven simulation
- Entry/exit logic
- Position sizing (risk-based)
- Stop loss and take profit
- Slippage (configurable)
- Transaction costs
- Portfolio exposure limits
- Sector exposure limits

### Metrics
- Total return %
- CAGR
- Win rate %
- Profit factor
- Sharpe ratio
- Sortino ratio
- Maximum drawdown %
- Expectancy
- Average holding period
- Number of trades

### Bias Prevention
- **No look-ahead**: Only data available at time T
- **Walk-forward**: Training → validation → out-of-sample
- **Sensitivity analysis**: Parameter robustness check

## AI Layer (Phase 5)

### Input to Claude
Structured data packet:
```json
{
  "ticker": "AAPL",
  "date": "2024-08-19",
  "currentPrice": 220.15,
  "setup": {
    "pattern": "breakout_from_consolidation",
    "confidence": 0.92,
    "resistance_broken": 219.50,
    "volume_confirmation": true
  },
  "indicators": {
    "trend": "bullish_strong",
    "momentum": "positive",
    "rsi": 62,
    "relative_strength": 1.35
  },
  "scoring": {
    "total_score": 87,
    "components": { ... }
  },
  "market_regime": "strong_bullish",
  "historical_stats": {
    "similar_setups_found": 24,
    "win_rate": 0.71,
    "avg_5d_return": 0.023,
    "avg_10d_return": 0.041
  },
  "risk_reward": 2.3
}
```

### Claude's Role
1. Analyze the structured data
2. Reason about the setup
3. Consider historical context
4. Identify invalidation triggers
5. Assign classification (BUY/WATCH/AVOID)
6. Provide explanation

### Output
```json
{
  "signal": "BUY",
  "confidence": 0.85,
  "reasoning": [
    "Strong breakout from 4-week consolidation with volume confirmation",
    "All major moving averages in bullish alignment",
    "Historical: 71% win rate on similar setups",
    "Market regime strongly bullish"
  ],
  "risks": [
    "Earnings announced in 8 days",
    "Elevated volatility vs. 6-month average"
  ],
  "invalidation_triggers": [
    "Close below $218.50",
    "Large red candle on high volume"
  ]
}
```

## Paper Trading (Phase 7)

### Record Structure
- Entry timestamp
- Ticker, shares, entry price
- Stop loss, take profit (calculated)
- Strategy used
- Score at entry
- Market regime at entry
- AI reasoning

### Tracking
- Monitor price movement
- Compare to predictions
- Record exit (stop hit, target hit, manual exit)
- Calculate P&L
- Track win rate

### NO automatic execution or live trading.

## Testing Strategy

### Unit Tests
- Indicator calculations (verify math)
- Pattern detection (known examples)
- Score calculation (weights)
- Position sizing (formulas)
- Risk management (limits)

### Integration Tests
- Data pipeline (download → cache → analyze)
- Strategy signals (full flow)
- Backtesting (known dataset, known result)

### Backtesting Tests
- Look-ahead prevention (date ranges)
- Walk-forward integrity
- Metrics calculation

### Fixtures
- Sample price data (known OHLCV)
- Known technical setups
- Expected indicator values
- Backtest benchmarks

## Development Phases

### PHASE 1: Foundation ✓ (Now)
- [ ] Project initialization (Node/TypeScript)
- [ ] Configuration system
- [ ] Market data provider abstraction
- [ ] Twelve Data API integration
- [ ] Historical data downloader
- [ ] Local cache management
- [ ] Stock universe scanner
- [ ] Data validation
- [ ] Basic tests

### PHASE 2: Quant Engine ✓ (Complete)
- [x] Indicator calculations (shared IndicatorEngine: SMA/EMA, RSI, MACD, Stochastic, ROC, ADX, ATR, Bollinger Bands, historical volatility, OBV, relative/dollar volume)
- [x] Price structure detection (swing highs/lows, trend structure, support/resistance, breakout/breakdown, consolidation, gaps, pullback, trend continuation)
- [x] Chart pattern detection (14 patterns with explicit rules and deterministic confidence scores)
- [x] Multi-timeframe analysis (weekly aggregation from daily data, trend alignment scoring)
- [x] Market regime detection (index-based composite scoring across trend/momentum/drawdown/volatility, 6 regime labels)
- [x] Sector relative strength (stock vs. sector vs. benchmark, explicit score adjustments)

### PHASE 3: Strategies & Scoring ✓ (Complete)
- [x] Strategy engine framework (pluggable registry, shared point-in-time StrategyContext builder reusing all Phase 2 modules)
- [x] Trend pullback strategy
- [x] Breakout strategy
- [x] Momentum continuation strategy
- [x] Scoring engine (transparent 0-100, configurable weights, weight validation)
- [x] Ranking system

### PHASE 4: Backtesting ✓ (Complete)
- [x] Event-driven backtester (signal on close T, execute at open T+1, conservative same-candle stop/target resolution)
- [x] Portfolio and position management (cash, multi-position, exposure/sector limits, risk-based sizing)
- [x] Metrics calculation (15 metrics: total return, CAGR, win rate, avg win/loss, profit factor, expectancy, Sharpe, Sortino, max drawdown, trade count, avg holding period, consecutive streaks, best/worst trade)
- [x] Walk-forward testing (sequential out-of-sample window validation, consistency scoring)
- [x] Look-ahead prevention tests (point-in-time equivalence + dedicated injected-violation detection proof)
- [x] Sensitivity analysis (parameter sweeps, robustness flagging, never auto-selects a "best" value)
- [x] Benchmarks: buy-and-hold S&P 500 + SMA-crossover (run through the same engine)

### PHASE 5: AI Analysis
- [ ] Claude API integration
- [ ] Structured input generation
- [ ] Signal explanation generation
- [ ] Historical context analysis

### PHASE 6: Dashboard
- [ ] Market overview
- [ ] Stock scanner
- [ ] Stock detail view
- [ ] Charts and technicals
- [ ] Backtest visualizations
- [ ] Signal explanations

### PHASE 7: Paper Trading
- [ ] Paper portfolio
- [ ] Trade entry recording
- [ ] Trade tracking
- [ ] Trade journal
- [ ] P&L calculation
- [ ] Alerts

## Success Criteria

### Phase 1
- Data successfully downloaded and cached
- Stock universe filtered correctly
- Data validated
- Unit tests passing

### Phase 2
- All indicators calculated correctly
- Pattern detection working on known examples
- Multi-timeframe analysis producing logical results

### Phase 3
- Strategies generating signals
- Scores between 0-100 with visible component breakdown
- Rankings sortable and filterable

### Phase 4
- Backtest reproduces known strategy results
- No look-ahead bias (tests pass)
- Walk-forward testing producing reasonable results
- Sensitivity analysis showing parameter robustness

### Phase 5
- Claude receives structured data correctly
- Explanations are logical and evidence-based
- No invented numerical claims

### Phase 6
- Dashboard loads market overview
- Can click a stock and see detailed analysis
- Charts render correctly
- Signals display with explanations

### Phase 7
- Can open paper trade
- Can close paper trade
- Trade journal shows P&L
- Actual performance vs. prediction tracked

## Important Rules (Non-negotiable)

1. **No fabricated data** — only use real market data
2. **No look-ahead bias** — never use future data in backtests
3. **No fake API connections** — fail gracefully if API unavailable
4. **No LLM indicator invention** — indicators calculated mathematically
5. **No guaranteed predictions** — always label historical stats appropriately
6. **Modular architecture** — each component testable independently
7. **Explainable signals** — every claim traceable to source
8. **No automatic trading** — paper trading only
9. **Configuration over hard-code** — use .env and config files
10. **Incremental development** — test before moving forward

## Next Steps

**PHASE 1 Implementation:**
1. Initialize Node/TypeScript project
2. Set up configuration and environment
3. Create market data provider abstraction
4. Implement Twelve Data API integration
5. Build historical data downloader
6. Implement local cache system
7. Create stock universe scanner with filters
8. Add data validation
9. Write unit tests
10. Verify end-to-end data flow

Expected completion: PHASE 1 ready for PHASE 2 with all unit tests passing.
