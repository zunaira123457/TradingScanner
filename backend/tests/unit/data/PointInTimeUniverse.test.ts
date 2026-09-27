import { UnimplementedPointInTimeUniverseProvider, SURVIVORSHIP_BIAS_DISCLOSURE } from '@/data/PointInTimeUniverse';

describe('PointInTimeUniverse', () => {
  describe('UnimplementedPointInTimeUniverseProvider', () => {
    it('should throw a descriptive error rather than silently returning a fake universe', async () => {
      const provider = new UnimplementedPointInTimeUniverseProvider();
      await expect(provider.getUniverseAsOf(new Date('2020-01-01'))).rejects.toThrow(/point-in-time/i);
    });

    it('should report its own name', () => {
      const provider = new UnimplementedPointInTimeUniverseProvider();
      expect(provider.getName()).toBe('unimplemented-point-in-time-universe');
    });
  });

  describe('SURVIVORSHIP_BIAS_DISCLOSURE', () => {
    it('should be a non-trivial, explicit disclosure mentioning the actual bias direction', () => {
      expect(SURVIVORSHIP_BIAS_DISCLOSURE.length).toBeGreaterThan(200);
      expect(SURVIVORSHIP_BIAS_DISCLOSURE.toLowerCase()).toContain('survivorship');
      expect(SURVIVORSHIP_BIAS_DISCLOSURE.toLowerCase()).toContain('inflate');
      expect(SURVIVORSHIP_BIAS_DISCLOSURE.toLowerCase()).toContain('delisted');
    });
  });
});
