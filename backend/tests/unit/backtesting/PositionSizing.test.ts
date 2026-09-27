import { calculatePositionSize } from '@/backtesting/PositionSizing';

describe('calculatePositionSize', () => {
  it('should compute shares from risk dollars / risk per share (whole shares)', () => {
    // equity=10000, risk 1% = $100. entry=50, stop=48 -> risk/share=2 -> 50 shares
    expect(calculatePositionSize(10000, 50, 48, 0.01, false)).toBe(50);
  });

  it('should floor to whole shares when fractionalShares is false', () => {
    // $100 / $3 = 33.33... -> floor to 33
    expect(calculatePositionSize(10000, 50, 47, 0.01, false)).toBe(33);
  });

  it('should return the raw fractional value when fractionalShares is true', () => {
    expect(calculatePositionSize(10000, 50, 47, 0.01, true)).toBeCloseTo(33.333333, 4);
  });

  it('should return 0 when the stop is not below entry (invalid risk)', () => {
    expect(calculatePositionSize(10000, 50, 50, 0.01, false)).toBe(0);
    expect(calculatePositionSize(10000, 50, 52, 0.01, false)).toBe(0);
  });

  it('should return 0 for zero or negative equity', () => {
    expect(calculatePositionSize(0, 50, 48, 0.01, false)).toBe(0);
    expect(calculatePositionSize(-100, 50, 48, 0.01, false)).toBe(0);
  });

  it('should scale linearly with the risk percentage', () => {
    const at1pct = calculatePositionSize(10000, 50, 48, 0.01, true);
    const at2pct = calculatePositionSize(10000, 50, 48, 0.02, true);
    expect(at2pct).toBeCloseTo(at1pct * 2, 8);
  });
});
