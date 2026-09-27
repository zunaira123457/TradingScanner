import { AIAnalysisContext } from '@/types/ai';

const createMock = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { AnthropicAnalysisProvider } from '@/ai/AnthropicAnalysisProvider';
import { MalformedAIOutputError } from '@/ai/validateAIAnalysisResult';

function makeContext(): AIAnalysisContext {
  return {
    ticker: 'AAPL',
    strategy: 'momentum_continuation',
    asOfDate: new Date('2024-05-01'),
    setupDetected: true,
    entry: 100,
    stop: 95,
    target: 112.5,
    riskRewardRatio: 2.5,
    classification: 'BUY',
    quantitativeScore: {
      trend: 15,
      momentum: 10,
      volume: 10,
      relativeStrength: 10,
      chartSetup: 15,
      marketRegime: 4,
      riskReward: 8,
      total: 84,
    },
    strategyEvidence: [],
    strategyWarnings: [],
    deterministicReasons: [],
    deterministicRisks: [],
    invalidation: 'Price closes below $95.00',
    indicators: {
      close: 100,
      rsi14: 68,
      adx14: 31,
      plusDI14: 28,
      minusDI14: 15,
      macdHistogram: 0.5,
      atr14: 2.1,
      relativeVolume: 1.3,
      historicalVolatility20: 0.3,
      sma50: 95,
      sma200: 88,
    },
    trendStructure: 'uptrend',
    dailyTrend: 'bullish',
    weeklyTrend: 'bullish',
    mtfAligned: true,
    marketRegime: { label: 'bullish', compositeScore: 0.6, isHighVolatility: false },
    relativeStrength: null,
    historicalContext: { baseline: null, regimeStats: null, tickerStats: null },
  };
}

const validJson = JSON.stringify({
  summary: 'ok',
  signalStatus: 'BUY',
  whyItQualified: [],
  supportingEvidence: [],
  conflictingEvidence: [],
  regimeContext: { regime: 'bullish', note: 'note' },
  historicalContext: { note: 'exploratory', baselineSummary: null, regimeSummary: null, tickerSummary: null },
  riskFlags: [],
  limitations: [],
  quantitativeScore: { total: 1, classification: 'AVOID', note: 'discarded' },
  aiConfidence: 0.99,
});

describe('AnthropicAnalysisProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('parses a plain-JSON text response and applies the safety validator', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: validJson }] });

    const provider = new AnthropicAnalysisProvider('fake-key', 'claude-sonnet-5');
    const result = await provider.analyze(makeContext());

    expect(result.summary).toBe('ok');
    // Safety validator must still apply even though this went through the real provider path.
    expect(result.aiConfidence).toBeNull();
    expect(result.quantitativeScore.total).toBe(84);
  });

  it('parses JSON wrapped in a markdown code fence', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '```json\n' + validJson + '\n```' }] });

    const provider = new AnthropicAnalysisProvider('fake-key', 'claude-sonnet-5');
    const result = await provider.analyze(makeContext());

    expect(result.summary).toBe('ok');
  });

  it('rejects with MalformedAIOutputError when the response is not valid JSON', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'Sure, here is my analysis: it looks good.' }] });

    const provider = new AnthropicAnalysisProvider('fake-key', 'claude-sonnet-5');

    await expect(provider.analyze(makeContext())).rejects.toThrow(MalformedAIOutputError);
  });

  it('rejects with MalformedAIOutputError when the response has no text block', async () => {
    createMock.mockResolvedValue({ content: [] });

    const provider = new AnthropicAnalysisProvider('fake-key', 'claude-sonnet-5');

    await expect(provider.analyze(makeContext())).rejects.toThrow(MalformedAIOutputError);
  });

  it('propagates a raw provider/network failure so the caller can fall back', async () => {
    createMock.mockRejectedValue(new Error('rate limited'));

    const provider = new AnthropicAnalysisProvider('fake-key', 'claude-sonnet-5');

    await expect(provider.analyze(makeContext())).rejects.toThrow('rate limited');
  });
});
