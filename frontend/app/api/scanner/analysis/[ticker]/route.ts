import { scannerClient } from '@/lib/api-clients/scannerClient';
import { errorResponse, limitOr429, parseSymbol } from '@/lib/server/respond';

export const maxDuration = 90;

/** GET /api/scanner/analysis/AAPL?ai=1 — full scanner analysis (+ AI explanation) for one ticker. */
export async function GET(request: Request, ctx: RouteContext<'/api/scanner/analysis/[ticker]'>) {
  const limited = limitOr429(request, 'scanner-analysis', 15);
  if (limited) return limited;
  const ticker = parseSymbol((await ctx.params).ticker);
  if (!ticker) return Response.json({ error: 'invalid_ticker' }, { status: 400 });
  const ai = new URL(request.url).searchParams.get('ai') !== '0';
  try {
    return Response.json(await scannerClient.analysis(ticker, ai));
  } catch (error) {
    return errorResponse(error);
  }
}
