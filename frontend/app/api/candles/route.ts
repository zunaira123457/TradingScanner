import { getCandles } from '@/lib/api-clients/stockDataClient';
import { errorResponse, limitOr429, parseSymbol } from '@/lib/server/respond';
import { INTERVALS, type Interval } from '@/lib/types';

/** GET /api/candles?symbol=AAPL&interval=5m — OHLCV bars (oldest first). */
export async function GET(request: Request) {
  const limited = limitOr429(request, 'candles', 30);
  if (limited) return limited;
  const params = new URL(request.url).searchParams;
  const symbol = parseSymbol(params.get('symbol'));
  const interval = params.get('interval') as Interval | null;
  if (!symbol || !interval || !INTERVALS.includes(interval)) {
    return Response.json({ error: 'invalid_params' }, { status: 400 });
  }
  try {
    return Response.json(await getCandles(symbol, interval));
  } catch (error) {
    return errorResponse(error);
  }
}
