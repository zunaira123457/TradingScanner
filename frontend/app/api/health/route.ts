import { providerStatus } from '@/lib/api-clients/stockDataClient';

/** GET /api/health — which data providers this deployment has configured (booleans only). */
export function GET() {
  return Response.json({ status: 'ok', providers: providerStatus() });
}
