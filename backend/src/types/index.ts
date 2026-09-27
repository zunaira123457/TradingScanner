// Core market data types
export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number;
}

export interface Quote {
  timestamp: Date;
  price: number;
  volume?: number;
  bid?: number;
  ask?: number;
}

export interface StockInfo {
  ticker: string;
  name: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  avgVolume30d?: number;
  price?: number;
  currency?: string;
  exchange?: string;
}

// Stock universe types
export interface StockUniverseFilter {
  minPrice: number;
  minAvgVolume: number;
  minAvgDollarVolume: number;
  minHistoryDays: number;
  excludeETFs: boolean;
  excludeInverseLeveraged: boolean;
  requireUSListed: boolean;
}

export interface StockUniverseStock {
  ticker: string;
  name: string;
  sector?: string;
  industry?: string;
  avgVolume30d: number;
  avgDollarVolume30d: number;
  currentPrice: number;
  dataQualityScore: number; // 0-1, higher is better
  includesInUniverse: boolean;
  reason?: string; // if excluded
}

// Validation types
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  ticker?: string;
  date?: Date;
  value?: unknown;
}

export interface ValidationWarning {
  code: string;
  message: string;
  ticker?: string;
  date?: Date;
  severity: 'low' | 'medium' | 'high';
}

// Cache types
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

// Data provider types
export interface DataProviderConfig {
  apiKey: string;
  rateLimit?: number; // requests per minute
  timeout?: number; // ms
}

// Batch operation types
export interface BatchDownloadResult {
  successful: string[];
  failed: Map<string, string>; // ticker -> error message
  partial: Map<string, Candle[]>; // ticker -> partial data
  totalRequests: number;
}

// Time period types
export type TimeFrame = 'daily' | 'weekly' | 'monthly';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

// Error types
export class MarketDataError extends Error {
  constructor(
    public code: string,
    message: string,
    public ticker?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

export class ValidationError$ extends Error {
  constructor(
    public validationErrors: ValidationError[],
    message = 'Data validation failed'
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CacheError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = 'CacheError';
  }
}
