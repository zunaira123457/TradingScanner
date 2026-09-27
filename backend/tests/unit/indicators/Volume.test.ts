import { volumeSma, relativeVolume, obv, avgDollarVolume, isVolumeSpike } from '@/indicators/Volume';
import { Candle } from '@/types';

const c = (close: number, volume: number): Candle => ({
  timestamp: new Date(),
  open: close,
  high: close,
  low: close,
  close,
  volume,
});

describe('Volume', () => {
  describe('volumeSma', () => {
    it('should compute simple moving average of volume', () => {
      const result = volumeSma([100, 200, 300, 400], 2);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeCloseTo(150, 8);
      expect(result[2]).toBeCloseTo(250, 8);
      expect(result[3]).toBeCloseTo(350, 8);
    });
  });

  describe('relativeVolume', () => {
    it('should compute relative volume vs preceding baseline (excluding today)', () => {
      // avg of first 4 days (100 each) = 100; day 5 volume = 300 -> relVol = 3
      const volumes = [100, 100, 100, 100, 300];
      const result = relativeVolume(volumes, 4);

      expect(result[0]).toBeNull();
      expect(result[3]).toBeNull();
      expect(result[4]).toBeCloseTo(3, 8);
    });

    it('should return null when baseline average volume is zero', () => {
      const volumes = [0, 0, 0, 100];
      const result = relativeVolume(volumes, 3);
      expect(result[3]).toBeNull();
    });
  });

  describe('obv', () => {
    it('should accumulate volume based on close direction', () => {
      const candles = [c(10, 100), c(11, 200), c(10, 150), c(10, 120), c(12, 300)];
      const result = obv(candles);

      // i0: 0
      // i1: close 11>10 -> 0+200=200
      // i2: close 10<11 -> 200-150=50
      // i3: close 10==10 -> unchanged 50
      // i4: close 12>10 -> 50+300=350
      expect(result).toEqual([0, 200, 50, 50, 350]);
    });
  });

  describe('avgDollarVolume', () => {
    it('should compute average of close*volume over the period', () => {
      const candles = [c(10, 100), c(20, 200), c(30, 300)];
      const result = avgDollarVolume(candles, 2);

      // dollarVolumes = [1000, 4000, 9000]
      expect(result[0]).toBeNull();
      expect(result[1]).toBeCloseTo(2500, 8);
      expect(result[2]).toBeCloseTo(6500, 8);
    });
  });

  describe('isVolumeSpike', () => {
    it('should flag relative volume at or above threshold', () => {
      expect(isVolumeSpike(3, 2)).toBe(true);
      expect(isVolumeSpike(2, 2)).toBe(true);
      expect(isVolumeSpike(1.5, 2)).toBe(false);
      expect(isVolumeSpike(null, 2)).toBe(false);
    });
  });
});
