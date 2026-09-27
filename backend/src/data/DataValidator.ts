import {
  Candle,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  StockUniverseStock,
} from '@/types';
import { config } from '@/config/environment';
import logger from '@/utils/logger';

export class DataValidator {
  /**
   * Validate a sequence of candles for data quality issues.
   */
  static validateCandles(ticker: string, candles: Candle[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!candles || candles.length === 0) {
      errors.push({
        code: 'EMPTY_DATA',
        message: 'No candle data provided',
        ticker,
      });
      return { isValid: false, errors, warnings };
    }

    // Check minimum history
    if (candles.length < config.minHistoryDays) {
      errors.push({
        code: 'INSUFFICIENT_HISTORY',
        message: `Insufficient history: ${candles.length} days < required ${config.minHistoryDays}`,
        ticker,
        value: candles.length,
      });
    }

    // Validate each candle
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];

      // OHLC relationships
      if (candle.high < candle.low) {
        errors.push({
          code: 'INVALID_HIGH_LOW',
          message: `High (${candle.high}) < Low (${candle.low})`,
          ticker,
          date: candle.timestamp,
        });
      }

      if (candle.close < 0 || candle.open < 0 || candle.high < 0 || candle.low < 0) {
        errors.push({
          code: 'NEGATIVE_PRICE',
          message: `Negative price detected: O=${candle.open}, H=${candle.high}, L=${candle.low}, C=${candle.close}`,
          ticker,
          date: candle.timestamp,
        });
      }

      if (candle.volume < 0) {
        errors.push({
          code: 'NEGATIVE_VOLUME',
          message: `Negative volume: ${candle.volume}`,
          ticker,
          date: candle.timestamp,
        });
      }

      // Price consistency
      if (candle.high < Math.max(candle.open, candle.close)) {
        warnings.push({
          code: 'HIGH_LOW_INCONSISTENT',
          message: `High (${candle.high}) < open (${candle.open}) or close (${candle.close})`,
          ticker,
          date: candle.timestamp,
          severity: 'medium',
        });
      }

      if (candle.low > Math.min(candle.open, candle.close)) {
        warnings.push({
          code: 'LOW_HIGH_INCONSISTENT',
          message: `Low (${candle.low}) > open (${candle.open}) or close (${candle.close})`,
          ticker,
          date: candle.timestamp,
          severity: 'medium',
        });
      }

      // Zero volume warning
      if (candle.volume === 0) {
        warnings.push({
          code: 'ZERO_VOLUME',
          message: `Zero volume on ${candle.timestamp.toISOString()}`,
          ticker,
          date: candle.timestamp,
          severity: 'low',
        });
      }

      // Gap detection (large single-day moves)
      if (i > 0) {
        const prevClose = candles[i - 1].close;
        const gapPct = Math.abs(candle.open - prevClose) / prevClose;

        if (gapPct > 0.1) {
          warnings.push({
            code: 'LARGE_GAP',
            message: `Large gap detected: ${(gapPct * 100).toFixed(2)}% from ${prevClose} to ${candle.open}`,
            ticker,
            date: candle.timestamp,
            severity: 'low',
          });
        }
      }
    }

    // Check for gaps in dates (missing trading days)
    const gaps = this.checkDateGaps(candles);
    if (gaps.length > 0) {
      warnings.push({
        code: 'DATE_GAPS',
        message: `Missing ${gaps.length} trading days in the sequence`,
        ticker,
        severity: 'low',
      });
    }

    // Check for duplicates
    const dupeCount = this.countDuplicates(candles);
    if (dupeCount > 0) {
      warnings.push({
        code: 'DUPLICATE_DATES',
        message: `Found ${dupeCount} duplicate dates`,
        ticker,
        severity: 'high',
      });
    }

    // Check chronological order
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].timestamp <= candles[i - 1].timestamp) {
        errors.push({
          code: 'NOT_CHRONOLOGICAL',
          message: `Candles not in chronological order at index ${i}`,
          ticker,
          date: candles[i].timestamp,
        });
        break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate stock universe membership.
   */
  static validateStockUniverseMembership(
    candles: Candle[],
    metadata: { avgVolume30d?: number; price?: number }
  ): {
    qualifies: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check minimum history
    if (candles.length < config.minHistoryDays) {
      errors.push({
        code: 'INSUFFICIENT_HISTORY',
        message: `${candles.length} days < ${config.minHistoryDays} required`,
        value: candles.length,
      });
    }

    // Check minimum price
    if (metadata.price && metadata.price < config.minPrice) {
      errors.push({
        code: 'PRICE_TOO_LOW',
        message: `Current price ${metadata.price} < minimum ${config.minPrice}`,
        value: metadata.price,
      });
    }

    // Check minimum average volume
    if (metadata.avgVolume30d && metadata.avgVolume30d < config.minAvgVolume) {
      errors.push({
        code: 'VOLUME_TOO_LOW',
        message: `Avg volume ${metadata.avgVolume30d} < minimum ${config.minAvgVolume}`,
        value: metadata.avgVolume30d,
      });
    }

    // Check minimum average dollar volume
    if (metadata.price && metadata.avgVolume30d) {
      const avgDollarVolume = metadata.price * metadata.avgVolume30d;
      if (avgDollarVolume < config.minAvgDollarVolume) {
        errors.push({
          code: 'DOLLAR_VOLUME_TOO_LOW',
          message: `Avg dollar volume ${avgDollarVolume} < minimum ${config.minAvgDollarVolume}`,
          value: avgDollarVolume,
        });
      }
    }

    return {
      qualifies: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check for gaps in the date sequence (missing trading days).
   * Returns array of missing dates.
   */
  private static checkDateGaps(candles: Candle[]): Date[] {
    const gaps: Date[] = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i].timestamp;
      const previous = candles[i - 1].timestamp;

      // Business day calculation: skip weekends
      let dayDiff = (current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24);

      // If more than 3 days (3-day weekend exists), flag as gap
      if (dayDiff > 3) {
        for (let d = 1; d < dayDiff; d++) {
          const missingDate = new Date(previous);
          missingDate.setDate(missingDate.getDate() + d);

          // Skip weekends
          if (missingDate.getDay() !== 0 && missingDate.getDay() !== 6) {
            gaps.push(missingDate);
          }
        }
      }
    }

    return gaps;
  }

  /**
   * Count duplicate dates in candle sequence.
   */
  private static countDuplicates(candles: Candle[]): number {
    const seen = new Set<number>();
    let dupes = 0;

    for (const candle of candles) {
      const key = candle.timestamp.getTime();
      if (seen.has(key)) {
        dupes++;
      }
      seen.add(key);
    }

    return dupes;
  }

  /**
   * Calculate data quality score (0-1).
   */
  static calculateDataQuality(candles: Candle[]): number {
    let score = 1.0;

    if (candles.length < 60) score -= 0.3;
    if (candles.length < 252) score -= 0.2;

    const zeroVolCount = candles.filter((c) => c.volume === 0).length;
    if (zeroVolCount > candles.length * 0.05) score -= 0.1;

    const gaps = this.checkDateGaps(candles);
    if (gaps.length > candles.length * 0.02) score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Log validation results.
   */
  static logResults(ticker: string, result: ValidationResult): void {
    if (result.isValid) {
      logger.info(`✓ ${ticker}: Data validation passed`);
    } else {
      logger.error(`✗ ${ticker}: Data validation failed`);
      result.errors.forEach((err) => logger.error(`  - ${err.code}: ${err.message}`));
    }

    if (result.warnings.length > 0) {
      result.warnings.forEach((warn) => {
        if (warn.severity === 'high') {
          logger.warn(`  ⚠ ${warn.code}: ${warn.message}`);
        } else {
          logger.debug(`  ℹ ${warn.code}: ${warn.message}`);
        }
      });
    }
  }
}
