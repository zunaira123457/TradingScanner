import { z } from 'zod';
import { LIMITS, getDevice, persist } from '@/lib/server/store';
import { readJson, requireDevice } from '@/lib/server/device';
import { limitOr429, parseSymbol } from '@/lib/server/respond';
import { validateAlertInput } from '@/lib/alerts';
import type { PriceAlert } from '@/lib/types';

const createSchema = z.object({
  symbol: z.string(),
  condition: z.enum(['price_above', 'price_below', 'change_pct_above', 'change_pct_below']),
  threshold: z.number().finite(),
  note: z.string().max(140).optional(),
});

/** GET /api/alerts — this browser's alerts (server is the source of truth). */
export async function GET(request: Request) {
  const limited = limitOr429(request, 'alerts-read', 120);
  if (limited) return limited;
  const device = getDevice(request);
  return Response.json({ alerts: device?.alerts ?? [] });
}

/** POST /api/alerts — create an alert. */
export async function POST(request: Request) {
  const limited = limitOr429(request, 'alerts-write', 30);
  if (limited) return limited;
  const parsed = createSchema.safeParse(await readJson(request));
  const symbol = parsed.success ? parseSymbol(parsed.data.symbol) : null;
  if (!parsed.success || !symbol) return Response.json({ error: 'invalid_params' }, { status: 400 });
  const invalid = validateAlertInput(parsed.data.condition, parsed.data.threshold, null);
  if (invalid) return Response.json({ error: 'invalid_params', message: invalid }, { status: 400 });

  const device = requireDevice(request, true);
  if (device instanceof Response) return device;
  if (device.alerts.length >= LIMITS.alertsPerDevice) {
    return Response.json({ error: 'limit_reached', message: `Up to ${LIMITS.alertsPerDevice} alerts` }, { status: 409 });
  }
  const alert: PriceAlert = {
    id: crypto.randomUUID(),
    symbol,
    condition: parsed.data.condition,
    threshold: parsed.data.threshold,
    note: parsed.data.note?.trim() || undefined,
    createdAt: Date.now(),
    status: 'active',
  };
  device.alerts.unshift(alert);
  persist();
  return Response.json({ alert }, { status: 201 });
}

/** DELETE /api/alerts?status=triggered — clear alert history. */
export async function DELETE(request: Request) {
  const limited = limitOr429(request, 'alerts-write', 30);
  if (limited) return limited;
  if (new URL(request.url).searchParams.get('status') !== 'triggered') return Response.json({ error: 'invalid_params' }, { status: 400 });
  const device = requireDevice(request);
  if (device instanceof Response) return device;
  device.alerts = device.alerts.filter((a) => a.status === 'active');
  persist();
  return Response.json({ ok: true });
}
