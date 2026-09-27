import { z } from 'zod';
import { persist } from '@/lib/server/store';
import { readJson, requireDevice } from '@/lib/server/device';
import { limitOr429 } from '@/lib/server/respond';
import { notifyDevice } from '@/lib/server/notify';
import { alertMessage } from '@/lib/server/watcher';

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rearm') }),
  // The open dashboard saw the alert cross first; record it (idempotent).
  z.object({ action: z.literal('trigger'), price: z.number().finite().positive() }),
]);

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/alerts/:id — re-arm, or mark triggered from the browser. */
export async function PATCH(request: Request, { params }: Ctx) {
  const limited = limitOr429(request, 'alerts-write', 60);
  if (limited) return limited;
  const { id } = await params;
  const body = patchSchema.safeParse(await readJson(request));
  if (!body.success) return Response.json({ error: 'invalid_params' }, { status: 400 });
  const device = requireDevice(request);
  if (device instanceof Response) return device;
  const alert = device.alerts.find((a) => a.id === id);
  if (!alert) return Response.json({ error: 'not_found' }, { status: 404 });

  if (body.data.action === 'rearm') {
    alert.status = 'active';
    delete alert.triggeredAt;
    delete alert.triggeredPrice;
  } else if (alert.status === 'active') {
    alert.status = 'triggered';
    alert.triggeredAt = Date.now();
    alert.triggeredPrice = body.data.price;
    // The browser already showed it; the owner still gets an email/Telegram copy.
    void notifyDevice(device, alertMessage(alert), { push: false });
  }
  persist();
  return Response.json({ alert });
}

/** DELETE /api/alerts/:id */
export async function DELETE(request: Request, { params }: Ctx) {
  const limited = limitOr429(request, 'alerts-write', 60);
  if (limited) return limited;
  const { id } = await params;
  const device = requireDevice(request);
  if (device instanceof Response) return device;
  device.alerts = device.alerts.filter((a) => a.id !== id);
  persist();
  return Response.json({ ok: true });
}
