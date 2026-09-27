import { scannerClient } from '@/lib/api-clients/scannerClient';
import { errorResponse, limitOr429 } from '@/lib/server/respond';

/** POST /api/scanner/refresh — ask the scanner to start a background re-scan. */
export async function POST(request: Request) {
  const limited = limitOr429(request, 'scanner-refresh', 2);
  if (limited) return limited;
  try {
    return Response.json(await scannerClient.refresh(), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
