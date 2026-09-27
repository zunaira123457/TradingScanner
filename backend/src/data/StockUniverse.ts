import { StockUniverseFilter, StockUniverseStock, Candle, StockInfo } from '@/types';
import { config } from '@/config/environment';
import { DataValidator } from './DataValidator';
import logger from '@/utils/logger';

/**
 * Manages the stock universe: which stocks are analyzed.
 */
export class StockUniverse {
  private filter: StockUniverseFilter;

  constructor(filter?: Partial<StockUniverseFilter>) {
    this.filter = {
      minPrice: filter?.minPrice ?? config.minPrice,
      minAvgVolume: filter?.minAvgVolume ?? config.minAvgVolume,
      minAvgDollarVolume: filter?.minAvgDollarVolume ?? config.minAvgDollarVolume,
      minHistoryDays: filter?.minHistoryDays ?? config.minHistoryDays,
      excludeETFs: filter?.excludeETFs ?? true,
      excludeInverseLeveraged: filter?.excludeInverseLeveraged ?? true,
      requireUSListed: filter?.requireUSListed ?? true,
    };
  }

  /**
   * Evaluate if a stock qualifies for the universe.
   */
  evaluateStock(
    ticker: string,
    candles: Candle[],
    stockInfo: StockInfo,
    avgVolume30d?: number
  ): StockUniverseStock {
    const reasons: string[] = [];

    // History check
    if (candles.length < this.filter.minHistoryDays) {
      reasons.push(`Insufficient history: ${candles.length}/${this.filter.minHistoryDays} days`);
    }

    // Price check
    if (stockInfo.price && stockInfo.price < this.filter.minPrice) {
      reasons.push(`Price too low: $${stockInfo.price} < $${this.filter.minPrice}`);
    }

    // Average volume check
    const volume30d = avgVolume30d ?? this.calculateAvgVolume(candles, 30);
    if (volume30d < this.filter.minAvgVolume) {
      reasons.push(`Volume too low: ${volume30d.toLocaleString()} < ${this.filter.minAvgVolume.toLocaleString()}`);
    }

    // Dollar volume check
    if (stockInfo.price && volume30d) {
      const dollarVolume = stockInfo.price * volume30d;
      if (dollarVolume < this.filter.minAvgDollarVolume) {
        reasons.push(
          `Dollar volume too low: $${dollarVolume.toLocaleString()} < $${this.filter.minAvgDollarVolume.toLocaleString()}`
        );
      }
    }

    // Data quality check
    const qualityScore = DataValidator.calculateDataQuality(candles);
    if (qualityScore < 0.5) {
      reasons.push(`Poor data quality: ${(qualityScore * 100).toFixed(0)}%`);
    }

    // Validation
    const validation = DataValidator.validateStockUniverseMembership(candles, {
      price: stockInfo.price,
      avgVolume30d: volume30d,
    });

    if (!validation.qualifies) {
      reasons.push(...validation.errors.map((e) => e.message));
    }

    const qualifies = reasons.length === 0;

    return {
      ticker,
      name: stockInfo.name || ticker,
      sector: stockInfo.sector,
      industry: stockInfo.industry,
      avgVolume30d: volume30d,
      avgDollarVolume30d: (stockInfo.price || 0) * volume30d,
      currentPrice: stockInfo.price || 0,
      dataQualityScore: qualityScore,
      includesInUniverse: qualifies,
      reason: reasons.length > 0 ? reasons.join('; ') : undefined,
    };
  }

  /**
   * Filter a batch of stocks and return universe members.
   */
  filterStocks(stocks: StockUniverseStock[]): {
    included: StockUniverseStock[];
    excluded: StockUniverseStock[];
  } {
    const included = stocks.filter((s) => s.includesInUniverse);
    const excluded = stocks.filter((s) => !s.includesInUniverse);

    return { included, excluded };
  }

  /**
   * Calculate average volume over N days.
   */
  private calculateAvgVolume(candles: Candle[], days: number): number {
    if (candles.length === 0) return 0;

    const subset = candles.slice(-days);
    const totalVolume = subset.reduce((sum, c) => sum + c.volume, 0);

    return totalVolume / subset.length;
  }

  /**
   * Log universe evaluation results.
   */
  static logResults(included: StockUniverseStock[], excluded: StockUniverseStock[]): void {
    logger.info(
      `Stock Universe: ${included.length} included, ${excluded.length} excluded`
    );

    if (included.length > 0 && included.length <= 10) {
      logger.info(`Included stocks: ${included.map((s) => s.ticker).join(', ')}`);
    }

    if (excluded.length > 0 && excluded.length <= 10) {
      excluded.slice(0, 5).forEach((stock) => {
        logger.debug(`Excluded ${stock.ticker}: ${stock.reason}`);
      });
      if (excluded.length > 5) {
        logger.debug(`... and ${excluded.length - 5} more excluded`);
      }
    }
  }
}
