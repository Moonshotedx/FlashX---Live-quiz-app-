import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/server/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await ctx.params;
  if (!UUID_RE.test(assetId)) {
    return NextResponse.json({ error: 'not_found', message: 'Asset not found' }, { status: 404 });
  }

  try {
    const { rows } = await query<{ content_type: string; data: Buffer }>(
      `SELECT content_type, data FROM uploaded_assets WHERE id = $1 LIMIT 1`,
      [assetId],
    );
    const asset = rows[0];
    if (!asset) {
      return NextResponse.json({ error: 'not_found', message: 'Asset not found' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(asset.data), {
      status: 200,
      headers: {
        'Content-Type': asset.content_type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found', message: 'Asset not found' }, { status: 404 });
  }
}

