import { scannerClient } from '@/lib/api-clients/scannerClient';
import { errorResponse, limitOr429 } from '@/lib/server/respond';

/** GET /api/scanner/performance — paper-trading record + historical backtest baselines. */
export async function GET(request: Request) {
  const limited = limitOr429(request, 'scanner-perf', 20);
  if (limited) return limited;
  try {
    return Response.json(await scannerClient.performance());
  } catch (error) {
    return errorResponse(error);
  }
}
