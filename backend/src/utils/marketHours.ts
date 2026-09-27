const CST_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

interface CstTime {
  weekday: string; // 'Mon'..'Sun'
  minutesSinceMidnight: number;
}

/**
 * Resolves `now` to its weekday and minutes-since-midnight in
 * America/Chicago (CST/CDT — DST-correct via Intl, no extra dependency).
 * NYSE market holidays are NOT accounted for — this is a weekday+time-window
 * guard only. That's an accepted gap: outside real trading hours IBKR
 * simply won't fill orders, so a holiday slipping through here doesn't
 * place an erroneous trade, it just wastes a scan cycle.
 */
function toCstTime(now: Date): CstTime {
  const parts = CST_TIME_FORMATTER.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const hour = get('hour') === '24' ? '00' : get('hour'); // some ICU builds render midnight as "24"
  const minute = get('minute');
  return { weekday, minutesSinceMidnight: parseInt(hour, 10) * 60 + parseInt(minute, 10) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function isWeekend(weekday: string): boolean {
  return weekday === 'Sat' || weekday === 'Sun';
}

/** True on a weekday between startHHmm (inclusive) and endHHmm (exclusive) in CST/CDT. */
export function isWithinDayTradingWindow(now: Date, startHHmm: string, endHHmm: string): boolean {
  const { weekday, minutesSinceMidnight } = toCstTime(now);
  if (isWeekend(weekday)) return false;
  return minutesSinceMidnight >= toMinutes(startHHmm) && minutesSinceMidnight < toMinutes(endHHmm);
}

/** True on a weekday at/after endHHmm in CST/CDT — used to trigger the end-of-day flatten step. */
export function isPastDayTradingWindow(now: Date, endHHmm: string): boolean {
  const { weekday, minutesSinceMidnight } = toCstTime(now);
  if (isWeekend(weekday)) return false;
  return minutesSinceMidnight >= toMinutes(endHHmm);
}
