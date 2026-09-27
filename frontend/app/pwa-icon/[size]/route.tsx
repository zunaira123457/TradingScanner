import { ImageResponse } from 'next/og';

const SIZES = new Set([96, 192, 512]);

/** PNG app icons for the web manifest and notifications (rendered once, then cached). */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response('Not found', { status: 404 });
  const s = size / 512;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#3b6ff5' }}>
        <svg width={300 * s} height={300 * s} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { 'Cache-Control': 'public, max-age=604800, immutable' } }
  );
}
