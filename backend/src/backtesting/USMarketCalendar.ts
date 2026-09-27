/**
 * A real NYSE/NASDAQ trading-day calendar: weekends plus the standard U.S.
 * market holidays, with the usual Saturday->Friday / Sunday->Monday
 * "observed" shift. This does NOT call an external calendar API — it
 * computes holiday dates algorithmically (including Easter, for Good
 * Friday), which is accurate for the standard, long-established NYSE
 * holiday schedule but will not reflect one-off exchange closures (e.g. a
 * weather closure or a national day of mourning) that fall outside the
 * fixed annual schedule.
 */

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return new Date(year, month, day);
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const lastWeekday = lastDayOfMonth.getDay();
  const diff = (lastWeekday - weekday + 7) % 7;
  return new Date(year, month, lastDayOfMonth.getDate() - diff);
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday. */
function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function observedDate(date: Date): Date {
  const day = date.getDay();
  if (day === 6) {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return d;
  }
  if (day === 0) {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    return d;
  }
  return date;
}

/**
 * The standard fixed annual NYSE holiday schedule. Juneteenth is only
 * included from 2022 onward (the year NYSE added it).
 */
export function generateUSMarketHolidays(year: number): Date[] {
  const holidays: Date[] = [
    observedDate(new Date(year, 0, 1)), // New Year's Day
    getNthWeekdayOfMonth(year, 0, 1, 3), // MLK Day
    getNthWeekdayOfMonth(year, 1, 1, 3), // Presidents Day
    (() => {
      const good = computeEasterSunday(year);
      good.setDate(good.getDate() - 2);
      return good;
    })(), // Good Friday
    getLastWeekdayOfMonth(year, 4, 1), // Memorial Day
    observedDate(new Date(year, 6, 4)), // Independence Day
    getNthWeekdayOfMonth(year, 8, 1, 1), // Labor Day
    getNthWeekdayOfMonth(year, 10, 4, 4), // Thanksgiving
    observedDate(new Date(year, 11, 25)), // Christmas
  ];
  if (year >= 2022) holidays.push(observedDate(new Date(year, 5, 19))); // Juneteenth
  return holidays;
}

const holidayKeySetCache = new Map<number, Set<string>>();
function getHolidayKeySetForYear(year: number): Set<string> {
  let set = holidayKeySetCache.get(year);
  if (!set) {
    set = new Set(generateUSMarketHolidays(year).map(dateKey));
    holidayKeySetCache.set(year, set);
  }
  return set;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isUSMarketHoliday(date: Date): boolean {
  return getHolidayKeySetForYear(date.getFullYear()).has(dateKey(date));
}

export function isLikelyTradingDay(date: Date): boolean {
  return !isWeekend(date) && !isUSMarketHoliday(date);
}

export { dateKey };
