import { z } from 'zod';
import { env } from '@/lib/server/env';
import { getDevice, persist } from '@/lib/server/store';
import { readJson, requireDevice } from '@/lib/server/device';
import { limitOr429 } from '@/lib/server/respond';
import { channels } from '@/lib/server/notify';

/** GET /api/notifications — what this browser receives and what the server supports. */
export async function GET(request: Request) {
  const limited = limitOr429(request, 'notif-read', 60);
  if (limited) return limited;
  const device = getDevice(request);
  const owner = !!device?.owner;
  return Response.json({
    push: { configured: channels.push(), publicKey: channels.push() ? env.VAPID_PUBLIC_KEY : null },
    subscriptions: device?.subs.length ?? 0,
    signals: !!device?.signals,
    owner,
    ownerAvailable: !!env.OWNER_KEY,
    // Only the owner learns which private channels are wired up.
    ownerChannels: owner ? { email: channels.email(), telegram: channels.telegram() } : null,
  });
}

const patchSchema = z.object({ signals: z.boolean() });

/** PATCH /api/notifications — toggle push for new scanner signals. */
export async function PATCH(request: Request) {
  const limited = limitOr429(request, 'notif-write', 20);
  if (limited) return limited;
  const body = patchSchema.safeParse(await readJson(request));
  if (!body.success) return Response.json({ error: 'invalid_params' }, { status: 400 });
  const device = requireDevice(request, true);
  if (device instanceof Response) return device;
  device.signals = body.data.signals;
  persist();
  return Response.json({ ok: true });
}
