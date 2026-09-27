/**
 * US equity regular-session status (9:30–16:00 America/New_York, Mon–Fri).
 * Exchange holidays are not modelled, so a holiday reads as "open" during
 * session hours — the UI labels this as schedule-based, not exchange-confirmed.
 */
export type SessionState = 'pre' | 'open' | 'post' | 'closed';

export function sessionState(now = new Date()): SessionState {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed';
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'open';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'post';
  return 'closed';
}

export const SESSION_LABEL: Record<SessionState, string> = {
  pre: 'Pre-market',
  open: 'Market open',
  post: 'After hours',
  closed: 'Market closed',
};
