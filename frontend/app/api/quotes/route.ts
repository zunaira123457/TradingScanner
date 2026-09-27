import { getQuotes } from '@/lib/api-clients/stockDataClient';
import { errorResponse, limitOr429, parseSymbols } from '@/lib/server/respond';

/** GET /api/quotes?symbols=AAPL,MSFT — latest quote per symbol (best effort within upstream budget). */
export async function GET(request: Request) {
  const limited = limitOr429(request, 'quotes', 60);
  if (limited) return limited;
  const symbols = parseSymbols(new URL(request.url).searchParams.get('symbols'), 30);
  if (!symbols) return Response.json({ error: 'invalid_symbols' }, { status: 400 });
  try {
    return Response.json(await getQuotes(symbols));
  } catch (error) {
    return errorResponse(error);
  }
}
