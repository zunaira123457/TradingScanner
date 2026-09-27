import { z } from 'zod';
import { LIMITS, persist } from '@/lib/server/store';
import { readJson, requireDevice } from '@/lib/server/device';
import { limitOr429 } from '@/lib/server/respond';
import { channels, isAllowedPushEndpoint } from '@/lib/server/notify';

const subSchema = z.object({
  endpoint: z.url().max(1024),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(64) }),
});

/** POST /api/notifications/subscribe — register this browser's push subscription. */
export async function POST(request: Request) {
  const limited = limitOr429(request, 'notif-write', 20);
  if (limited) return limited;
  if (!channels.push()) return Response.json({ error: 'not_configured', message: 'Push is not configured on the server' }, { status: 503 });
  const body = subSchema.safeParse(await readJson(request));
  if (!body.success || !isAllowedPushEndpoint(body.data.endpoint)) return Response.json({ error: 'invalid_subscription' }, { status: 400 });
  const device = requireDevice(request, true);
  if (device instanceof Response) return device;
  device.subs = [
    { endpoint: body.data.endpoint, keys: body.data.keys, createdAt: Date.now() },
    ...device.subs.filter((s) => s.endpoint !== body.data.endpoint),
  ].slice(0, LIMITS.subsPerDevice);
  persist();
  return Response.json({ ok: true, subscriptions: device.subs.length });
}

/** DELETE /api/notifications/subscribe — { endpoint } to drop one, or omit to drop all. */
export async function DELETE(request: Request) {
  const limited = limitOr429(request, 'notif-write', 20);
  if (limited) return limited;
  const body = (await readJson(request)) as { endpoint?: unknown } | null;
  const device = requireDevice(request);
  if (device instanceof Response) return device;
  device.subs = typeof body?.endpoint === 'string' ? device.subs.filter((s) => s.endpoint !== body.endpoint) : [];
  persist();
  return Response.json({ ok: true });
}
