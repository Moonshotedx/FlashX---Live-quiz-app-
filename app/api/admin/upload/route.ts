import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { query } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

const KINDS = {
  logo: { max: 1 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/svg+xml'] },
  image: { max: 2 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] },
  background: { max: 2 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] },
} as const;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

function sniff(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 512).toString('utf8').toLowerCase().includes('<svg')) return 'image/svg+xml';
  return null;
}

let assetsTableReady = false;

async function ensureAssetsTable() {
  if (assetsTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS uploaded_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      content_type text NOT NULL,
      data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  assetsTableReady = true;
}

/** Admin-only image upload stored directly in Neon Postgres (`uploaded_assets`, logo 1 MB, images 2 MB). */
export const POST = handler(async (req) => {
  await requireAdmin();
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const kind = String(form?.get('kind') ?? 'image') as keyof typeof KINDS;
  if (!(file instanceof File) || !(kind in KINDS)) throw new HttpError(400, 'invalid_upload', 'Send a file and a kind (logo, image, background)');
  const rule = KINDS[kind];
  if (file.size > rule.max) throw new HttpError(413, 'too_large', `Max size is ${rule.max / 1024 / 1024} MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type || !(rule.types as readonly string[]).includes(type)) {
    throw new HttpError(415, 'bad_type', `Allowed: ${rule.types.map((t) => EXT[t].toUpperCase()).join(', ')}`);
  }

  await ensureAssetsTable();
  const { rows } = await query<{ id: string }>(
    `INSERT INTO uploaded_assets (content_type, data) VALUES ($1, $2) RETURNING id`,
    [type, buf],
  );
  if (!rows[0]) throw new HttpError(500, 'upload_failed', 'Failed saving uploaded image');
  return { url: `/api/assets/${rows[0].id}` };
});
