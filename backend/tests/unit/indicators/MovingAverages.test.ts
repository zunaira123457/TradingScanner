import { sma, ema, smaNullable } from '@/indicators/MovingAverages';

describe('MovingAverages', () => {
  describe('sma', () => {
    it('should compute simple moving average correctly', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = sma(values, 3);

      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeCloseTo(2, 10); // (1+2+3)/3
      expect(result[3]).toBeCloseTo(3, 10); // (2+3+4)/3
      expect(result[9]).toBeCloseTo(9, 10); // (8+9+10)/3
    });

    it('should return all nulls when insufficient data', () => {
      const result = sma([1, 2], 5);
      expect(result).toEqual([null, null]);
    });
  });

  describe('smaNullable', () => {
    it('should skip windows containing null values', () => {
      const values: (number | null)[] = [1, null, 3, 4, 5];
      const result = smaNullable(values, 2);

      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull(); // window [1, null] invalid
      expect(result[2]).toBeNull(); // window [null, 3] invalid
      expect(result[3]).toBeCloseTo(3.5, 10); // (3+4)/2
      expect(result[4]).toBeCloseTo(4.5, 10); // (4+5)/2
    });
  });

  describe('ema', () => {
    it('should compute exponential moving average with SMA-seeded start', () => {
      // period=3, k=0.5: values [1,2,3,4,5]
      // seed = SMA(1,2,3) = 2 at index 2
      // i=3: 4*0.5 + 2*0.5 = 3
      // i=4: 5*0.5 + 3*0.5 = 4
      const values = [1, 2, 3, 4, 5];
      const result = ema(values, 3);

      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeCloseTo(2, 10);
      expect(result[3]).toBeCloseTo(3, 10);
      expect(result[4]).toBeCloseTo(4, 10);
    });

    it('should return all nulls when insufficient data', () => {
      const result = ema([1, 2], 5);
      expect(result).toEqual([null, null]);
    });
  });
});
