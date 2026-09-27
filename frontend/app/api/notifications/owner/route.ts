import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/server/env';
import { persist } from '@/lib/server/store';
import { readJson, requireDevice } from '@/lib/server/device';
import { limitOr429 } from '@/lib/server/respond';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** POST /api/notifications/owner { key } — mark this browser as the site owner. */
export async function POST(request: Request) {
  // Tight limit: this is the one guessable secret on the site.
  const limited = limitOr429(request, 'owner-unlock', 5);
  if (limited) return limited;
  if (!env.OWNER_KEY) return Response.json({ error: 'not_configured', message: 'OWNER_KEY is not set on the server' }, { status: 503 });
  const body = (await readJson(request)) as { key?: unknown } | null;
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!timingSafeEqual(digest(key), digest(env.OWNER_KEY))) {
    return Response.json({ error: 'invalid_key', message: 'Wrong owner key' }, { status: 403 });
  }
  const device = requireDevice(request, true);
  if (device instanceof Response) return device;
  device.owner = true;
  device.signals = true;
  persist();
  return Response.json({ ok: true });
}

/** DELETE /api/notifications/owner — stop treating this browser as the owner. */
export async function DELETE(request: Request) {
  const limited = limitOr429(request, 'notif-write', 20);
  if (limited) return limited;
  const device = requireDevice(request);
  if (device instanceof Response) return device;
  device.owner = false;
  persist();
  return Response.json({ ok: true });
}
