import dotenv from 'dotenv';
import path from 'path';

// Load .env file
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
}

function getEnvOptional(key: string, defaultValue: string): string;
function getEnvOptional(key: string): string | undefined;
function getEnvOptional(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Environment variable ${key} is not set`);
  }
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return num;
}

function getEnvBoolean(key: string, defaultValue = false): boolean {
  const value = getEnvOptional(key);
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

export const config = {
  // Application
  env: getEnvOptional('NODE_ENV', 'development'),
  apiPort: getEnvNumber('API_PORT', 3000),
  apiHost: getEnvOptional('API_HOST', 'localhost'),

  // Market Data Provider
  marketDataProvider: getEnvOptional('MARKET_DATA_PROVIDER', 'twelve-data'),
  twelveDataApiKey: getEnvOptional('TWELVE_DATA_API_KEY'),
  twelveDataRequestsPerMinute: getEnvNumber('TWELVE_DATA_REQUESTS_PER_MINUTE', 8),
  alphaVantageApiKey: getEnvOptional('ALPHA_VANTAGE_API_KEY'),

  // Database
  databaseType: getEnvOptional('DATABASE_TYPE', 'sqlite'),
  databaseUrl: getEnvOptional('DATABASE_URL', 'sqlite:///./data/trading_bot.db'),

  // Cache
  cacheDir: getEnvOptional('CACHE_DIR', './data/cache'),
  cacheMaxAgeHours: getEnvNumber('CACHE_MAX_AGE_HOURS', 24),

  // Stock Universe Filters
  minPrice: getEnvNumber('MIN_PRICE', 1.0),
  minAvgVolume: getEnvNumber('MIN_AVG_VOLUME', 100000),
  minAvgDollarVolume: getEnvNumber('MIN_AVG_DOLLAR_VOLUME', 1000000),
  minHistoryDays: getEnvNumber('MIN_HISTORY_DAYS', 252),

  // Data Download
  dataStartDate: getEnvOptional('DATA_START_DATE', '2020-01-01'),
  dataBatchSize: getEnvNumber('DATA_BATCH_SIZE', 50),
  dataRetryAttempts: getEnvNumber('DATA_RETRY_ATTEMPTS', 3),

  // Logging
  logLevel: getEnvOptional('LOG_LEVEL', 'info'),

  // AI
  anthropicApiKey: getEnvOptional('ANTHROPIC_API_KEY'),
  anthropicModel: getEnvOptional('ANTHROPIC_MODEL', 'claude-sonnet-5'),
  aiAnalysisTimeoutMs: getEnvNumber('AI_ANALYSIS_TIMEOUT_MS', 60000),

  // Backtesting
  backtestSlippageBps: getEnvNumber('BACKTEST_SLIPPAGE_BPS', 5),
  backtestCommissionBps: getEnvNumber('BACKTEST_COMMISSION_BPS', 2),
  backtestMaxPositions: getEnvNumber('BACKTEST_MAX_POSITIONS', 10),
  backtestMaxSectorExposurePct: getEnvNumber('BACKTEST_MAX_SECTOR_EXPOSURE_PCT', 30),
  backtestMaxStockExposurePct: getEnvNumber('BACKTEST_MAX_STOCK_EXPOSURE_PCT', 10),

  // Paper Trading
  initialPortfolioValue: getEnvNumber('INITIAL_PORTFOLIO_VALUE', 10000),
  maxRiskPerTradePct: getEnvNumber('MAX_RISK_PER_TRADE_PCT', 1),
  maxPortfolioRiskPct: getEnvNumber('MAX_PORTFOLIO_RISK_PCT', 5),
  maxDrawdownPct: getEnvNumber('MAX_DRAWDOWN_PCT', 20),

  // IBKR (TWS/IB Gateway) — paper trading order execution
  ibkrHost: getEnvOptional('IBKR_HOST', '127.0.0.1'),
  ibkrPort: getEnvNumber('IBKR_PORT', 7497),
  ibkrClientId: getEnvNumber('IBKR_CLIENT_ID', 1),
  ibkrMaxRiskPerTradePct: getEnvNumber('IBKR_MAX_RISK_PER_TRADE_PCT', 0.25),
  ibkrMaxPositionValueUsd: getEnvNumber('IBKR_MAX_POSITION_VALUE_USD', 5000),

  // IBKR Day Trading (intraday signals, trailing-stop bracket orders)
  ibkrDayTradingStartTimeCst: getEnvOptional('IBKR_DAY_TRADING_START_TIME_CST', '08:30'),
  ibkrDayTradingEndTimeCst: getEnvOptional('IBKR_DAY_TRADING_END_TIME_CST', '15:00'),
  ibkrDayTradingPollIntervalMinutes: getEnvNumber('IBKR_DAY_TRADING_POLL_INTERVAL_MINUTES', 5),
  ibkrDayTradingMaxTradesPerDay: getEnvNumber('IBKR_DAY_TRADING_MAX_TRADES_PER_DAY', 5),
  ibkrDayTradingMaxRiskPerTradePct: getEnvNumber('IBKR_DAY_TRADING_MAX_RISK_PER_TRADE_PCT', 0.5),
  ibkrDayTradingMaxPositionValueUsd: getEnvNumber('IBKR_DAY_TRADING_MAX_POSITION_VALUE_USD', 2000),
  ibkrDayTradingTrailPercent: getEnvNumber('IBKR_DAY_TRADING_TRAIL_PERCENT', 1.0),
  ibkrDayTradingUniverseSize: getEnvNumber('IBKR_DAY_TRADING_UNIVERSE_SIZE', 50),

  // Computed
  isDevelopment: getEnvOptional('NODE_ENV', 'development') === 'development',
  isProduction: getEnvOptional('NODE_ENV', 'development') === 'production',
};

export function validateConfig(): string[] {
  const errors: string[] = [];

  // Required keys based on provider
  if (!config.marketDataProvider) {
    errors.push('MARKET_DATA_PROVIDER is required');
  } else if (config.marketDataProvider === 'twelve-data' && !config.twelveDataApiKey) {
    errors.push('TWELVE_DATA_API_KEY is required when using twelve-data provider');
  } else if (config.marketDataProvider === 'alpha-vantage' && !config.alphaVantageApiKey) {
    errors.push('ALPHA_VANTAGE_API_KEY is required when using alpha-vantage provider');
  }

  // Validate numbers
  if (config.minPrice <= 0) errors.push('MIN_PRICE must be positive');
  if (config.minAvgVolume <= 0) errors.push('MIN_AVG_VOLUME must be positive');
  if (config.minAvgDollarVolume <= 0) errors.push('MIN_AVG_DOLLAR_VOLUME must be positive');
  if (config.minHistoryDays <= 0) errors.push('MIN_HISTORY_DAYS must be positive');

  return errors;
}
