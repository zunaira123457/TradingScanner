import 'server-only';
import { deviceIdFromRequest, getDevice, StoreFullError, type Device } from '@/lib/server/store';

/** Resolves the calling browser's device, or a 400/503 Response. */
export function requireDevice(request: Request, create = false): Device | Response {
  try {
    const d = create ? getDevice(request, true) : getDevice(request);
    if (d) return d;
  } catch (e) {
    if (e instanceof StoreFullError) return Response.json({ error: 'server_full' }, { status: 503 });
    throw e;
  }
  if (!request.headers.get('x-device-key')) return Response.json({ error: 'missing_device_key' }, { status: 400 });
  if (!deviceIdFromRequest(request)) return Response.json({ error: 'invalid_device_key' }, { status: 400 });
  return Response.json({ error: 'not_found' }, { status: 404 });
}

export async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > 8_192) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}
