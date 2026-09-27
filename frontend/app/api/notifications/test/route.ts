import { requireDevice } from '@/lib/server/device';
import { limitOr429 } from '@/lib/server/respond';
import { notifyDevice } from '@/lib/server/notify';

/** POST /api/notifications/test — send a test message through every channel this browser gets. */
export async function POST(request: Request) {
  const limited = limitOr429(request, 'notif-test', 3);
  if (limited) return limited;
  const device = requireDevice(request);
  if (device instanceof Response) return device;
  const results = await notifyDevice(device, {
    title: '✅ Trading Desk test',
    body: 'Notifications are working. You will get alerts here when they trigger.',
    path: '/',
    tag: 'test',
  });
  return Response.json({ results });
}
