import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { DataValidator } from '@/data/DataValidator';
import { StockUniverse } from '@/data/StockUniverse';
import logger from '@/utils/logger';

/**
 * Initialize and validate the application.
 */
async function initializeApp() {
  logger.info('Initializing AI Trading Bot...');

  // Validate configuration
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }

  logger.info(`Environment: ${config.env}`);
  logger.info(`Market Data Provider: ${config.marketDataProvider}`);

  // Initialize market data provider
  let provider;
  if (config.marketDataProvider === 'twelve-data') {
    if (!config.twelveDataApiKey) {
      throw new Error('TWELVE_DATA_API_KEY not configured');
    }
    provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);
  } else {
    throw new Error(`Unknown market data provider: ${config.marketDataProvider}`);
  }

  // Test provider connection
  logger.info('Testing provider connection...');
  const isConnected = await provider.validateConnection();
  if (!isConnected) {
    throw new Error(`Failed to connect to ${config.marketDataProvider}`);
  }
  logger.info(`✓ Connected to ${provider.getName()}`);

  // Initialize cache
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  logger.info(`Cache directory: ${config.cacheDir}`);

  // Initialize data downloader
  const downloader = new DataDownloader(provider, cache);

  // Initialize stock universe
  const universe = new StockUniverse({
    minPrice: config.minPrice,
    minAvgVolume: config.minAvgVolume,
    minAvgDollarVolume: config.minAvgDollarVolume,
    minHistoryDays: config.minHistoryDays,
  });

  return {
    config,
    provider,
    cache,
    downloader,
    universe,
  };
}

/**
 * Example usage and testing.
 */
async function demonstrateUsage(app: Awaited<ReturnType<typeof initializeApp>>) {
  const { downloader, universe } = app;

  logger.info('='.repeat(60));
  logger.info('PHASE 1 DEMONSTRATION');
  logger.info('='.repeat(60));

  // Example: Download and validate data for a known stock
  const testTicker = 'AAPL';
  try {
    logger.info(`\nDownloading and validating ${testTicker}...`);

    const result = await downloader.downloadStock(testTicker);

    logger.info(`✓ Downloaded ${result.candles.length} candles`);
    logger.info(`  - From cache: ${result.fromCache}`);
    logger.info(`  - Validation: ${result.validation.isValid ? 'PASS' : 'FAIL'}`);
    logger.info(`  - Warnings: ${result.validation.warnings}`);

    // Get latest quote
    const quote = await downloader.getLatestQuote(testTicker);
    logger.info(`  - Latest price: $${quote.price.toFixed(2)}`);

    // Get metadata
    const metadata = await downloader.getStockMetadata(testTicker);
    logger.info(`  - Name: ${metadata.name}`);

    // Evaluate universe membership. Prefer the provider's own 30-day average
    // volume (metadata.avgVolume30d) over quote.volume, which is only a
    // single day's volume and not a valid proxy for a 30-day average.
    const evaluation = universe.evaluateStock(
      testTicker,
      result.candles,
      metadata,
      metadata.avgVolume30d
    );

    logger.info(`\nUniverse Evaluation for ${testTicker}:`);
    logger.info(`  - Qualifies: ${evaluation.includesInUniverse}`);
    logger.info(`  - Avg Volume (30d): ${evaluation.avgVolume30d.toLocaleString()}`);
    logger.info(
      `  - Avg Dollar Volume (30d): $${evaluation.avgDollarVolume30d.toLocaleString()}`
    );
    logger.info(`  - Data Quality Score: ${(evaluation.dataQualityScore * 100).toFixed(0)}%`);
    if (evaluation.reason) {
      logger.info(`  - Reason: ${evaluation.reason}`);
    }
  } catch (error) {
    logger.error(
      `Failed to process ${testTicker}:`,
      error instanceof Error ? error.message : error
    );
  }

  logger.info(`\n${'='.repeat(60)}`);
  logger.info('Configuration Summary:');
  logger.info(`  - Min Price: $${app.config.minPrice}`);
  logger.info(`  - Min Avg Volume: ${app.config.minAvgVolume.toLocaleString()}`);
  logger.info(`  - Min Avg Dollar Volume: $${app.config.minAvgDollarVolume.toLocaleString()}`);
  logger.info(`  - Min History Days: ${app.config.minHistoryDays}`);
  logger.info(`  - Cache Max Age: ${app.config.cacheMaxAgeHours} hours`);
  logger.info(`${'='.repeat(60)}`);

  logger.info('\n✓ PHASE 1: Foundation layer is ready for PHASE 2');
  logger.info('Next steps:');
  logger.info('  1. Implement technical indicators');
  logger.info('  2. Build price structure detection');
  logger.info('  3. Create chart pattern detection');
  logger.info('  4. Multi-timeframe analysis');
}

// Main execution
if (require.main === module) {
  initializeApp()
    .then((app) => demonstrateUsage(app))
    .catch((error) => {
      logger.error('Application initialization failed:', error);
      process.exit(1);
    });
}

export { initializeApp };
