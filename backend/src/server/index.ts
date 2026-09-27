/**
 * Scanner HTTP API — exposes the existing signal pipeline to the Next.js
 * dashboard (frontend/). Read-only: nothing here places orders or writes to
 * the paper-trading state.
 *
 * Usage:
 *   npm run serve
 *
 * Endpoints (all under /v1 require `x-api-key` when SCANNER_API_KEY is set):
 *   GET /health                    liveness + whether the AI layer is enabled
 *   GET /v1/scan                   latest ranked signals for the scan universe
 *   POST /v1/scan/refresh          trigger a background re-scan
 *   GET /v1/analysis/:ticker?ai=1  full analysis for one ticker (+ AI explanation)
 *   GET /v1/performance            paper-trading record + historical baselines
 */
import * as path from 'path';
import express from 'express';
import { config, validateConfig } from '@/config/environment';
import { TwelveDataProvider } from '@/providers/TwelveDataProvider';
import { HybridCacheProvider } from '@/providers/CacheProvider';
import { DataDownloader } from '@/data/DataDownloader';
import { SignalAnalysisService } from '@/ai/SignalAnalysisService';
import { AnthropicAnalysisProvider } from '@/ai/AnthropicAnalysisProvider';
import { JsonHistoricalStrategyStats } from '@/research/HistoricalStrategyStats';
import { ScannerService, errorMessage } from '@/server/ScannerService';
import { apiKeyAuth, isValidTicker, parseTickers, rateLimit } from '@/server/http';
import { UNIVERSE_BY_SECTOR } from '@/scripts/downloadUniverse';
import logger from '@/utils/logger';

const DEFAULT_UNIVERSE = 'AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AMD,NFLX,JPM,AVGO,COST';
const RESCAN_INTERVAL_MS = 30 * 60 * 1000;

function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    errors.forEach((err) => logger.error(`Config: ${err}`));
    process.exit(1);
  }

  // `research81` = the 81-stock universe used for the Phase 4.5 backtests.
  const universeSpec = process.env.SCANNER_UNIVERSE ?? DEFAULT_UNIVERSE;
  const universe = parseTickers(
    universeSpec === 'research81' ? Object.values(UNIVERSE_BY_SECTOR).flat().join(',') : universeSpec,
    100
  );
  if (!universe || universe.length === 0) {
    logger.error('SCANNER_UNIVERSE must be a comma-separated list of 1-100 valid tickers');
    process.exit(1);
  }

  const provider = new TwelveDataProvider(config.twelveDataApiKey!, config.twelveDataRequestsPerMinute);
  const cache = new HybridCacheProvider(config.cacheDir, config.cacheMaxAgeHours);
  const downloader = new DataDownloader(provider, cache);
  const historicalStats = new JsonHistoricalStrategyStats();
  const aiProvider = config.anthropicApiKey
    ? new AnthropicAnalysisProvider(config.anthropicApiKey, config.anthropicModel)
    : null;
  const analysisService = new SignalAnalysisService(aiProvider, historicalStats, {
    timeoutMs: config.aiAnalysisTimeoutMs,
  });

  const scanner = new ScannerService(downloader, analysisService, historicalStats, universe, {
    analysisCacheMs: 30 * 60 * 1000,
    paperTradingDir: path.resolve(__dirname, '../../data/paper_trading'),
  });

  const apiKey = process.env.SCANNER_API_KEY;
  if (!apiKey) logger.warn('SCANNER_API_KEY is not set — the scanner API is unauthenticated (dev only).');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => {
    const snap = scanner.getSnapshot();
    res.json({ status: 'ok', aiEnabled: aiProvider !== null, scanStatus: snap.status, generatedAt: snap.generatedAt });
  });

  const v1 = express.Router();
  v1.use(apiKeyAuth(apiKey));
  v1.use(rateLimit(120, 60_000));

  v1.get('/scan', (req, res) => {
    const snap = scanner.getSnapshot();
    const filter = parseTickers(req.query.tickers as string | undefined, 100);
    if (filter === null) return res.status(400).json({ error: 'invalid tickers' });
    const signals = filter.length ? snap.signals.filter((s) => filter.includes(s.ticker)) : snap.signals;
    res.json({ ...snap, signals });
  });

  v1.post('/scan/refresh', rateLimit(2, 60_000), (_req, res) => {
    void scanner.refresh();
    res.status(202).json({ status: 'started' });
  });

  // AI analysis is the expensive call (Anthropic tokens + possible download),
  // so it gets its own tighter limit on top of the router-wide one.
  v1.get('/analysis/:ticker', rateLimit(20, 60_000), async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    if (!isValidTicker(ticker)) return res.status(400).json({ error: 'invalid ticker' });
    try {
      res.json(await scanner.analyzeTicker(ticker, req.query.ai !== '0'));
    } catch (error) {
      logger.warn(`analysis ${ticker} failed: ${errorMessage(error)}`);
      res.status(502).json({ error: 'analysis_failed', message: errorMessage(error) });
    }
  });

  v1.get('/performance', (_req, res) => {
    try {
      res.json(scanner.getPaperTradingPerformance());
    } catch (error) {
      res.status(500).json({ error: 'performance_unavailable', message: errorMessage(error) });
    }
  });

  app.use('/v1', v1);

  const port = Number(process.env.SCANNER_PORT ?? 4000);
  app.listen(port, () => {
    logger.info(`Scanner API listening on :${port} — universe: ${universe.join(', ')}`);
    void scanner.refresh();
    setInterval(() => void scanner.refresh(), RESCAN_INTERVAL_MS).unref();
  });
}

main();
