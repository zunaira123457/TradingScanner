import { getNews } from '@/lib/api-clients/stockDataClient';
import { errorResponse, limitOr429, parseSymbol } from '@/lib/server/respond';

/** GET /api/news?symbol=AAPL — company news from the last 7 days. */
export async function GET(request: Request) {
  const limited = limitOr429(request, 'news', 20);
  if (limited) return limited;
  const symbol = parseSymbol(new URL(request.url).searchParams.get('symbol'));
  if (!symbol) return Response.json({ error: 'invalid_symbol' }, { status: 400 });
  try {
    return Response.json({ symbol, items: await getNews(symbol) });
  } catch (error) {
    return errorResponse(error);
  }
}
