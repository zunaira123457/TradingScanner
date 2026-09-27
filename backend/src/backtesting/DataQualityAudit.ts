import { Candle } from '@/types';
import { DataValidator } from '@/data/DataValidator';

export interface TickerDataQualityResult {
  ticker: string;
  isValid: boolean;
  errorCodes: string[];
  warningCounts: Record<string, number>;
  dataQualityScore: number;
}

export interface DataQualityAuditReport {
  totalTickers: number;
  validTickers: string[];
  excludedTickers: Array<{ ticker: string; reasons: string[] }>;
  perTickerResults: TickerDataQualityResult[];
}

/**
 * Runs the existing Phase 1 DataValidator over an entire universe and
 * decides which tickers are usable. A ticker is excluded (not silently
 * included) when its candle data fails validation OR its data-quality
 * score falls below 0.5 — both reasons are recorded per ticker so a bad
 * result is always logged, never quietly dropped without a trace.
 */
export function auditUniverse(candlesByTicker: Map<string, Candle[]>): DataQualityAuditReport {
  const perTickerResults: TickerDataQualityResult[] = [];
  const validTickers: string[] = [];
  const excludedTickers: Array<{ ticker: string; reasons: string[] }> = [];

  const MIN_QUALITY_SCORE = 0.5;

  for (const [ticker, candles] of candlesByTicker) {
    const validation = DataValidator.validateCandles(ticker, candles);
    const qualityScore = DataValidator.calculateDataQuality(candles);

    const warningCounts: Record<string, number> = {};
    for (const w of validation.warnings) {
      warningCounts[w.code] = (warningCounts[w.code] ?? 0) + 1;
    }

    perTickerResults.push({
      ticker,
      isValid: validation.isValid,
      errorCodes: validation.errors.map((e) => e.code),
      warningCounts,
      dataQualityScore: qualityScore,
    });

    if (validation.isValid && qualityScore >= MIN_QUALITY_SCORE) {
      validTickers.push(ticker);
    } else {
      const reasons = [...new Set(validation.errors.map((e) => e.code))];
      if (qualityScore < MIN_QUALITY_SCORE) {
        reasons.push(`LOW_DATA_QUALITY_SCORE(${qualityScore.toFixed(2)})`);
      }
      excludedTickers.push({ ticker, reasons });
    }
  }

  return { totalTickers: candlesByTicker.size, validTickers, excludedTickers, perTickerResults };
}
