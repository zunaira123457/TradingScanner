import { generateUSMarketHolidays, isWeekend, isUSMarketHoliday, isLikelyTradingDay } from '@/backtesting/USMarketCalendar';

describe('USMarketCalendar', () => {
  describe('isWeekend', () => {
    it('should correctly identify Saturdays and Sundays using the Date object itself (not memorized dates)', () => {
      // Find the next Saturday/Sunday from a fixed anchor programmatically.
      const anchor = new Date(2024, 5, 1);
      let d = new Date(anchor);
      while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
      expect(isWeekend(d)).toBe(true);

      const sunday = new Date(d);
      sunday.setDate(sunday.getDate() + 1);
      expect(sunday.getDay()).toBe(0);
      expect(isWeekend(sunday)).toBe(true);
    });

    it('should not flag an ordinary weekday as a weekend', () => {
      const d = new Date(2024, 5, 1);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      expect(isWeekend(d)).toBe(false);
    });
  });

  describe('generateUSMarketHolidays — structural correctness (not hardcoded calendar trivia)', () => {
    const holidays2024 = generateUSMarketHolidays(2024);

    it('should produce exactly 10 holidays for a year including Juneteenth (2022+)', () => {
      expect(holidays2024.length).toBe(10);
    });

    it('should produce exactly 9 holidays for a year before Juneteenth was added', () => {
      expect(generateUSMarketHolidays(2020).length).toBe(9);
    });

    it('MLK Day should always land on a Monday, in the 3rd week of January', () => {
      for (const year of [2022, 2023, 2024, 2025, 2026]) {
        const mlk = generateUSMarketHolidays(year).find((d) => d.getMonth() === 0 && d.getDate() >= 15 && d.getDate() <= 21);
        expect(mlk).toBeDefined();
        expect(mlk!.getDay()).toBe(1); // Monday
      }
    });

    it('Good Friday should always land on a Friday', () => {
      for (const year of [2022, 2023, 2024, 2025, 2026]) {
        const holidays = generateUSMarketHolidays(year);
        // Good Friday is the one in March or April that is a Friday and not July 4/Christmas-adjacent
        const goodFriday = holidays.find((d) => (d.getMonth() === 2 || d.getMonth() === 3) && d.getDay() === 5);
        expect(goodFriday).toBeDefined();
      }
    });

    it('Memorial Day should always land on the last Monday of May', () => {
      for (const year of [2022, 2023, 2024, 2025, 2026]) {
        const memorialDay = generateUSMarketHolidays(year).find((d) => d.getMonth() === 4);
        expect(memorialDay).toBeDefined();
        expect(memorialDay!.getDay()).toBe(1);
        // Confirm it's genuinely the LAST Monday: the following Monday must be in June
        const nextMonday = new Date(memorialDay as Date);
        nextMonday.setDate(nextMonday.getDate() + 7);
        expect(nextMonday.getMonth()).toBe(5);
      }
    });

    it('Thanksgiving should always land on the 4th Thursday of November', () => {
      for (const year of [2022, 2023, 2024, 2025, 2026]) {
        const thanksgiving = generateUSMarketHolidays(year).find((d) => d.getMonth() === 10);
        expect(thanksgiving).toBeDefined();
        expect(thanksgiving!.getDay()).toBe(4); // Thursday
        expect(thanksgiving!.getDate()).toBeGreaterThanOrEqual(22);
        expect(thanksgiving!.getDate()).toBeLessThanOrEqual(28);
      }
    });

    it('should shift a Saturday-falling fixed holiday to the preceding Friday', () => {
      // Find a year where July 4 falls on a Saturday, verified via Date itself.
      let year = 2024;
      while (new Date(year, 6, 4).getDay() !== 6) year++;
      const july4 = new Date(year, 6, 4);
      const holidays = generateUSMarketHolidays(year);
      const observed = holidays.find((d) => d.getMonth() === 6);
      expect(observed).toBeDefined();
      expect(observed!.getDate()).toBe(july4.getDate() - 1); // preceding Friday
      expect(observed!.getDay()).toBe(5);
    });

    it('should shift a Sunday-falling fixed holiday to the following Monday', () => {
      let year = 2024;
      while (new Date(year, 11, 25).getDay() !== 0) year++;
      const christmas = new Date(year, 11, 25);
      const holidays = generateUSMarketHolidays(year);
      // Filter specifically for the Christmas entry (date 24-26): December
      // can also contain a Dec 31 entry when the FOLLOWING year's New
      // Year's Day (a Saturday) is observed the preceding Friday.
      const observed = holidays.find((d) => d.getMonth() === 11 && d.getDate() <= 26);
      expect(observed).toBeDefined();
      expect(observed!.getDate()).toBe(christmas.getDate() + 1); // following Monday
      expect(observed!.getDay()).toBe(1);
    });
  });

  describe('isUSMarketHoliday / isLikelyTradingDay', () => {
    it('should flag every generated holiday as a holiday', () => {
      for (const holiday of generateUSMarketHolidays(2025)) {
        expect(isUSMarketHoliday(holiday)).toBe(true);
        expect(isLikelyTradingDay(holiday)).toBe(false);
      }
    });

    it('should treat an ordinary midweek, non-holiday date as a trading day', () => {
      // March 12 is never a US market holiday in any year.
      const ordinaryDay = new Date(2024, 2, 12); // a Tuesday
      expect(isUSMarketHoliday(ordinaryDay)).toBe(false);
      expect(isLikelyTradingDay(ordinaryDay)).toBe(true);
    });

    it('should treat weekends as non-trading days even when not a holiday', () => {
      const d = new Date(2024, 5, 1);
      while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
      expect(isLikelyTradingDay(d)).toBe(false);
    });
  });
});
