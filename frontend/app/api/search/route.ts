import { searchSymbols } from '@/lib/api-clients/stockDataClient';
import { errorResponse, limitOr429 } from '@/lib/server/respond';

/** GET /api/search?q=appl — US stock/ETF symbol lookup. */
export async function GET(request: Request) {
  const limited = limitOr429(request, 'search', 30);
  if (limited) return limited;
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!/^[A-Za-z0-9 .&-]{1,30}$/.test(q)) return Response.json({ error: 'invalid_query' }, { status: 400 });
  try {
    return Response.json({ results: await searchSymbols(q) });
  } catch (error) {
    return errorResponse(error);
  }
}
