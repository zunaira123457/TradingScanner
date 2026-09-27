import 'server-only';
import webpush from 'web-push';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/server/env';
import { persist, type Device, type PushSub } from '@/lib/server/store';

export interface NotifyMessage {
  title: string;
  body: string;
  /** Same-origin path to open on click, e.g. "/?symbol=AAPL". */
  path: string;
  tag: string;
}

export type ChannelResult = { channel: 'push' | 'email' | 'telegram'; ok: boolean; detail?: string };

export const channels = {
  push: () => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
  email: () => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.NOTIFY_EMAIL_TO),
  telegram: () => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
};

/* ---------------------------------- Push ---------------------------------- */

// Push endpoints come from the browser; only allow the real push services so
// the server can never be pointed at an arbitrary (e.g. internal) URL.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && u.port === '' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

let vapidReady = false;
function ensureVapid() {
  if (!vapidReady && channels.push()) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    vapidReady = true;
  }
  return vapidReady;
}

export async function sendPush(device: Device, msg: NotifyMessage): Promise<ChannelResult> {
  if (!ensureVapid()) return { channel: 'push', ok: false, detail: 'not configured on server' };
  if (device.subs.length === 0) return { channel: 'push', ok: false, detail: 'this browser has not enabled push' };
  const payload = JSON.stringify(msg);
  const dead: PushSub[] = [];
  const results = await Promise.allSettled(
    device.subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 6 * 3600, urgency: 'high', timeout: 10_000 }).catch((e) => {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s);
        throw e;
      })
    )
  );
  if (dead.length) {
    device.subs = device.subs.filter((s) => !dead.includes(s));
    persist();
  }
  const ok = results.some((r) => r.status === 'fulfilled');
  return { channel: 'push', ok, detail: ok ? undefined : dead.length ? 'subscription expired — re-enable push' : 'push service rejected the message' };
}

/* ---------------------------------- Email --------------------------------- */

let transporter: Transporter | null = null;
function mailer() {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const link = (p: string) => (env.PUBLIC_BASE_URL ? new URL(p, env.PUBLIC_BASE_URL).toString() : null);

async function sendEmail(msg: NotifyMessage): Promise<ChannelResult> {
  if (!channels.email()) return { channel: 'email', ok: false, detail: 'not configured' };
  const url = link(msg.path);
  try {
    await mailer().sendMail({
      from: env.NOTIFY_EMAIL_FROM ?? `Trading Desk <${env.SMTP_USER!.includes('@') ? env.SMTP_USER : env.NOTIFY_EMAIL_TO}>`,
      to: env.NOTIFY_EMAIL_TO,
      subject: msg.title,
      text: `${msg.body}${url ? `\n\n${url}` : ''}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:520px">
  <h2 style="margin:0 0 8px;font-size:18px">${esc(msg.title)}</h2>
  <p style="margin:0 0 16px;white-space:pre-line;color:#333">${esc(msg.body)}</p>
  ${url ? `<a href="${esc(url)}" style="display:inline-block;background:#3b6ff5;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open Trading Desk</a>` : ''}
  <p style="margin-top:24px;font-size:12px;color:#888">Research and paper-trading output only — not investment advice.</p>
</div>`,
    });
    return { channel: 'email', ok: true };
  } catch (e) {
    console.error('[notify] email failed', e);
    return { channel: 'email', ok: false, detail: (e as Error).message };
  }
}

/* -------------------------------- Telegram -------------------------------- */

async function sendTelegram(msg: NotifyMessage): Promise<ChannelResult> {
  if (!channels.telegram()) return { channel: 'telegram', ok: false, detail: 'not configured' };
  const url = link(msg.path);
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        text: `<b>${esc(msg.title)}</b>\n${esc(msg.body)}${url ? `\n\n<a href="${esc(url)}">Open Trading Desk</a>` : ''}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      return { channel: 'telegram', ok: false, detail: body?.description ?? `HTTP ${res.status}` };
    }
    return { channel: 'telegram', ok: true };
  } catch (e) {
    return { channel: 'telegram', ok: false, detail: (e as Error).message };
  }
}

/* -------------------------------- Dispatch -------------------------------- */

/** Email + Telegram to the site owner (whichever are configured). */
export async function sendOwner(msg: NotifyMessage): Promise<ChannelResult[]> {
  const jobs: Promise<ChannelResult>[] = [];
  if (channels.email()) jobs.push(sendEmail(msg));
  if (channels.telegram()) jobs.push(sendTelegram(msg));
  return Promise.all(jobs);
}

/**
 * Notify one browser: web push to its subscriptions, plus email/Telegram when
 * that browser belongs to the owner.
 */
export async function notifyDevice(device: Device, msg: NotifyMessage, opts: { push?: boolean } = {}): Promise<ChannelResult[]> {
  const jobs: Promise<ChannelResult | ChannelResult[]>[] = [];
  if (opts.push !== false && device.subs.length) jobs.push(sendPush(device, msg));
  if (device.owner) jobs.push(sendOwner(msg));
  return (await Promise.all(jobs)).flat();
}
