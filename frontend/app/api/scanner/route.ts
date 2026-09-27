import { scannerClient } from '@/lib/api-clients/scannerClient';
import { errorResponse, limitOr429, parseSymbols } from '@/lib/server/respond';

/** GET /api/scanner?tickers=AAPL,MSFT — latest ranked signals from the AI scanner. */
export async function GET(request: Request) {
  const limited = limitOr429(request, 'scanner', 60);
  if (limited) return limited;
  const raw = new URL(request.url).searchParams.get('tickers');
  const tickers = raw ? parseSymbols(raw, 100) : undefined;
  if (tickers === null) return Response.json({ error: 'invalid_tickers' }, { status: 400 });
  try {
    return Response.json(await scannerClient.scan(tickers));
  } catch (error) {
    return errorResponse(error);
  }
}
