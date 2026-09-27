import {
  validatePaperTradingConfig,
  buildNewPaperTradingConfig,
  assertConfigMatches,
  PaperTradingConfigError,
  PaperTradingConfig,
} from '@/paperTrading/PaperTradingConfig';

function validRaw(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    lockedStartDate: '2026-08-20',
    strategyName: 'momentum_continuation',
    initialCapital: 10000,
    createdAt: '2026-08-20T00:00:00.000Z',
    universeVersion: 'phase4.5-81-stock-v1',
    ...overrides,
  };
}

describe('buildNewPaperTradingConfig', () => {
  it('builds a valid config with a fresh createdAt timestamp', () => {
    const config = buildNewPaperTradingConfig({
      lockedStartDate: '2026-08-20',
      strategyName: 'momentum_continuation',
      initialCapital: 10000,
      universeVersion: 'phase4.5-81-stock-v1',
    });
    expect(config.lockedStartDate).toBe('2026-08-20');
    expect(config.strategyName).toBe('momentum_continuation');
    expect(config.initialCapital).toBe(10000);
    expect(() => new Date(config.createdAt)).not.toThrow();
    expect(new Date(config.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('refuses to lock a malformed start date', () => {
    expect(() =>
      buildNewPaperTradingConfig({
        lockedStartDate: '08/20/2026',
        strategyName: 'momentum_continuation',
        initialCapital: 10000,
        universeVersion: 'v1',
      })
    ).toThrow(PaperTradingConfigError);
  });

  it('refuses to lock a non-positive initial capital', () => {
    expect(() =>
      buildNewPaperTradingConfig({
        lockedStartDate: '2026-08-20',
        strategyName: 'momentum_continuation',
        initialCapital: 0,
        universeVersion: 'v1',
      })
    ).toThrow(PaperTradingConfigError);
  });
});

describe('validatePaperTradingConfig', () => {
  it('accepts a well-formed config object', () => {
    const config: PaperTradingConfig = validatePaperTradingConfig(validRaw());
    expect(config.lockedStartDate).toBe('2026-08-20');
    expect(config.strategyName).toBe('momentum_continuation');
  });

  it.each([
    ['non-object input', 'not an object'],
    ['null input', null],
    ['missing lockedStartDate', validRaw({ lockedStartDate: undefined })],
    ['malformed lockedStartDate', validRaw({ lockedStartDate: '08/20/2026' })],
    ['missing strategyName', validRaw({ strategyName: undefined })],
    ['empty strategyName', validRaw({ strategyName: '' })],
    ['non-numeric initialCapital', validRaw({ initialCapital: '10000' })],
    ['non-positive initialCapital', validRaw({ initialCapital: -5 })],
    ['missing createdAt', validRaw({ createdAt: undefined })],
    ['missing universeVersion', validRaw({ universeVersion: undefined })],
  ])('throws PaperTradingConfigError on %s', (_label, raw) => {
    expect(() => validatePaperTradingConfig(raw)).toThrow(PaperTradingConfigError);
  });
});

describe('assertConfigMatches', () => {
  const config = validatePaperTradingConfig(validRaw());

  it('does not throw when the strategy name matches', () => {
    expect(() => assertConfigMatches(config, 'momentum_continuation')).not.toThrow();
  });

  it('throws (hard error, never silently overrides) when the strategy name does not match', () => {
    expect(() => assertConfigMatches(config, 'trend_pullback')).toThrow(PaperTradingConfigError);
  });
});
