/**
 * Downloads and caches 5-min historical candles for the intraday backtester
 * (src/backtesting/IntradayBacktester.ts). One-time bulk pull — the live
 * day-trading daemon gets its data from IBKR instead (see
 * src/brokers/IBKRClient.ts's getIntradayCandles), this is only for
 * backtesting against Twelve Data's historical intraday endpoint.
 *
 * Usage:
 *   npm run download-intraday-data -- AAPL MSFT NVDA
 *   npm run download-intraday-data -- AAPL MSFT NVDA --months=6
 *   npm run download-intraday-data -- AAPL MSFT NVDA --refresh   (ignore cache)
 *   npm run download-intraday-data                                (default watchlist + SPY)
 */
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { getCachedIntradayCandles, saveIntradayCandles } from '@/data/IntradayDataCache';
import logger from '@/utils/logger';

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA'];
const INTERVAL = '5min';

function parseArgs(argv: string[]): { tickers: string[]; months: number; refresh: boolean } {
  const flags = argv.filter((a) => a.startsWith('--'));
  const tickers = argv.filter((a) => !a.startsWith('--')).map((t) => t.toUpperCase());
  const monthsFlag = flags.find((f) => f.startsWith('--months='));
  const months = monthsFlag ? parseInt(monthsFlag.split('=')[1], 10) : 3;
  const refresh = flags.includes('--refresh');
  return { tickers: tickers.length > 0 ? tickers : DEFAULT_TICKERS, months, refresh };
}

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration validation failed:');
    errors.forEach((err) => logger.error(`  - ${err}`));
    process.exit(1);
  }
  if (!config.twelveDataApiKey) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }

  const { tickers, months, refresh } = parseArgs(process.argv.slice(2));
  // SPY is always included — the backtester uses it for the intraday
  // relativeStrength/marketRegime scoring components.
  const allTickers = Array.from(new Set([...tickers, 'SPY']));

  const provider = new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataRequestsPerMinute);

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - months);

  logger.info('='.repeat(70));
  logger.info(`DOWNLOAD INTRADAY DATA (${INTERVAL}, ${months} month(s), ${allTickers.length} ticker(s))`);
  logger.info('='.repeat(70));

  for (const ticker of allTickers) {
    if (!refresh) {
      const cached = getCachedIntradayCandles(ticker, INTERVAL);
      if (cached) {
        logger.info(`✓ ${ticker}: using cached data (${cached.length} candles)`);
        continue;
      }
    }

    try {
      const candles = await provider.getIntradayHistoricalData(ticker, INTERVAL, startDate, endDate);
      if (candles.length === 0) {
        logger.warn(`✗ ${ticker}: no candles returned`);
        continue;
      }
      saveIntradayCandles(ticker, INTERVAL, candles);
      logger.info(`✓ ${ticker}: downloaded and cached ${candles.length} candles (${candles[0].timestamp.toISOString()} → ${candles[candles.length - 1].timestamp.toISOString()})`);
    } catch (error) {
      logger.error(`✗ ${ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }

  logger.info('='.repeat(70));
  logger.info('Done.');
}

main().catch((error) => {
  logger.error('Intraday data download failed:', error);
  process.exit(1);
});
