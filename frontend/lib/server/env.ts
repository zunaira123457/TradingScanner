import 'server-only';
import { z } from 'zod';

/**
 * Server-side configuration. Nothing here is NEXT_PUBLIC_ — API keys never
 * reach the browser; every upstream call goes through a route handler.
 */
const schema = z.object({
  FINNHUB_API_KEY: z.string().min(1).optional(),
  TWELVE_DATA_API_KEY: z.string().min(1).optional(),
  // Upstream base URLs — overridable so tests can point at a local mock market.
  FINNHUB_BASE_URL: z.url().default('https://finnhub.io/api/v1'),
  TWELVE_DATA_BASE_URL: z.url().default('https://api.twelvedata.com'),
  AI_SCANNER_BASE_URL: z.url().optional(),
  AI_SCANNER_API_KEY: z.string().min(1).optional(),
  // Upstream request budgets per server instance. Keep a little under the
  // provider's published limit so other consumers of the same key survive.
  FINNHUB_RPM: z.coerce.number().int().positive().default(50),
  TWELVE_DATA_RPM: z.coerce.number().int().positive().default(6),

  // Where alerts and push subscriptions are persisted (a JSON file).
  DATA_DIR: z.string().default('.data'),
  // Public URL of the site, used for links in emails / Telegram messages.
  PUBLIC_BASE_URL: z.url().optional(),
  // Passphrase that marks a browser as the site owner (gets email/Telegram copies + scanner digests).
  OWNER_KEY: z.string().min(12, 'OWNER_KEY must be at least 12 characters').optional(),

  // Web Push (phone/desktop notifications). Generate with `npm run vapid`.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),

  // Owner email (any SMTP server — e.g. Gmail with an App Password).
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  NOTIFY_EMAIL_TO: z.email().optional(),
  NOTIFY_EMAIL_FROM: z.string().min(1).optional(),

  // Owner Telegram (bot token from @BotFather, chat id from @userinfobot).
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),

  // Background watcher that evaluates alerts and scanner signals server-side.
  WATCHER_ENABLED: z.enum(['true', 'false']).default('true'),
});

const blankToUndefined = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

export const env = schema.parse(
  Object.fromEntries(Object.keys(schema.shape).map((k) => [k, blankToUndefined(process.env[k])]))
);
