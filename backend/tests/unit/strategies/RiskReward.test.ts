import { calculateRiskReward, targetFromRewardMultiple, atrStop } from '@/strategies/RiskReward';

describe('RiskReward', () => {
  describe('calculateRiskReward', () => {
    it('should compute risk, reward, and ratio for a valid long setup', () => {
      const result = calculateRiskReward(50, 48, 56);
      expect(result.riskPerShare).toBeCloseTo(2, 8);
      expect(result.rewardPerShare).toBeCloseTo(6, 8);
      expect(result.riskRewardRatio).toBeCloseTo(3, 8);
    });

    it('should return null ratio when risk is zero or negative (invalid stop)', () => {
      expect(calculateRiskReward(50, 50, 56).riskRewardRatio).toBeNull();
      expect(calculateRiskReward(50, 52, 56).riskRewardRatio).toBeNull();
    });

    it('should allow a negative reward (target below entry) without crashing', () => {
      const result = calculateRiskReward(50, 48, 49);
      expect(result.rewardPerShare).toBeCloseTo(-1, 8);
      expect(result.riskRewardRatio).toBeCloseTo(-0.5, 8);
    });
  });

  describe('targetFromRewardMultiple', () => {
    it('should compute target as entry + multiple * risk', () => {
      // entry=50, stop=48, risk=2, multiple=2.5 -> target = 50 + 5 = 55
      expect(targetFromRewardMultiple(50, 48, 2.5)).toBeCloseTo(55, 8);
    });
  });

  describe('atrStop', () => {
    it('should compute stop as entry minus multiple*ATR', () => {
      expect(atrStop(100, 2, 2)).toBeCloseTo(96, 8);
    });
  });
});
