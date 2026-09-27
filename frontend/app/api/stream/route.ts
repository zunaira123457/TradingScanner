import {
  getQuote,
  isQuoteFresh,
  peekQuote,
  providerStatus,
} from '@/lib/api-clients/stockDataClient';
import { UpstreamBudgetError } from '@/lib/server/rateLimit';
import { limitOr429, parseSymbol, parseSymbols } from '@/lib/server/respond';
import type { Quote } from '@/lib/types';

/**
 * GET /api/stream?symbols=AAPL,MSFT,SPY&focus=AAPL — Server-Sent Events feed of quotes.
 *
 * Why SSE instead of a browser WebSocket to the data vendor: a direct socket
 * would put the vendor API key in the browser. Here the key stays on the
 * server, all viewers share one per-instance upstream budget via the quote
 * cache, and EventSource gives automatic reconnection for free.
 *
 * Scheduling: each tick refreshes the focused symbol (the one on the chart)
 * first, then round-robins the rest, skipping anything another stream already
 * refreshed. Only changed quotes are pushed.
 */

export const maxDuration = 300;

const SCHEDULE = {
  finnhub: { tickMs: 3_000, perTick: 2 }, // ≈40 req/min, under Finnhub's free 60/min
  twelvedata: { tickMs: 30_000, perTick: 1 }, // ≈2 credits/min — Twelve Data free is 8/min, 800/day
} as const;

/** Close before common serverless limits; EventSource reconnects on its own. */
const STREAM_LIFETIME_MS = 270_000;
const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  const limited = limitOr429(request, 'stream', 60);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const symbols = parseSymbols(params.get('symbols'), 30);
  if (!symbols) return Response.json({ error: 'invalid_symbols' }, { status: 400 });
  const focus = parseSymbol(params.get('focus'));

  const provider = providerStatus().quotes;
  if (!provider) {
    return Response.json(
      { error: 'not_configured', message: 'Set FINNHUB_API_KEY or TWELVE_DATA_API_KEY for live quotes' },
      { status: 503 }
    );
  }
  const { tickMs, perTick } = SCHEDULE[provider];
  const others = symbols.filter((s) => s !== focus);
  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    // The client can cancel the body without the request's abort signal firing.
    cancel() {
      stop();
    },
    start(controller) {
      let closed = false;
      let cursor = 0;
      const lastSent = new Map<string, string>();
      const timers: ReturnType<typeof setTimeout>[] = [];

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close(); // consumer went away between checks
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const close = () => {
        if (closed) return;
        closed = true;
        timers.forEach(clearTimeout);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      /** Push every cached quote for our symbols that changed since we last sent it. */
      const flush = () => {
        const changed: Quote[] = [];
        for (const s of symbols) {
          const q = peekQuote(s);
          if (!q) continue;
          const sig = `${q.price}|${q.timestamp}|${q.fetchedAt}`;
          if (lastSent.get(s) !== sig) {
            lastSent.set(s, sig);
            changed.push(q);
          }
        }
        if (changed.length) send('quotes', changed);
      };

      const pickDue = (): string[] => {
        const due: string[] = [];
        if (focus && !isQuoteFresh(focus)) due.push(focus);
        const start = cursor;
        for (let i = 0; i < others.length && due.length < perTick; i++) {
          const idx = (start + i) % others.length;
          if (!isQuoteFresh(others[idx])) {
            due.push(others[idx]);
            cursor = (idx + 1) % others.length;
          }
        }
        return due;
      };

      const tick = async () => {
        if (closed) return;
        const due = pickDue();
        const results = await Promise.allSettled(due.map((s) => getQuote(s)));
        const budget = results.find(
          (r): r is PromiseRejectedResult => r.status === 'rejected' && r.reason instanceof UpstreamBudgetError
        );
        if (budget) send('status', { state: 'throttled', retryAfterMs: (budget.reason as UpstreamBudgetError).retryAfterMs });
        results.forEach((r, i) => {
          if (r.status === 'rejected' && !(r.reason instanceof UpstreamBudgetError)) {
            send('quote_error', { symbol: due[i], message: r.reason instanceof Error ? r.reason.message : 'error' });
          }
        });
        flush();
        if (!closed) timers.push(setTimeout(tick, tickMs));
      };

      const heartbeat = setInterval(() => {
        write(`: ping ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      stop = close;
      write('retry: 2000\n\n');
      send('ready', { provider, tickMs, symbols, focus });
      flush();
      void tick();

      timers.push(setTimeout(close, STREAM_LIFETIME_MS));
      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
