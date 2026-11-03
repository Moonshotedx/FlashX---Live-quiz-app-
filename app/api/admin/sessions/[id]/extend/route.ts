import { z } from 'zod';
import { handler, HttpError, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { broadcast, loadOwnedSession, syncSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const body = z.object({ seconds: z.number().int().min(10).max(600).default(60) });

/** Add time while live. Every phone and the LED screen pick up the new ends_at. */
export const POST = handler<{ id: string }>(async (req, { id }) => {
  const user = await requireAdmin();
  const { seconds } = await parseBody(req, body).catch(() => ({ seconds: 60 }));
  const s = await syncSession(await loadOwnedSession(id, user.id));
  if (s.status !== 'live' || !s.ends_at) throw new HttpError(409, 'not_live', 'Time can only be added while the quiz is live');
  const base = Math.max(new Date(s.ends_at).getTime(), Date.now());
  const endsAt = new Date(base + seconds * 1000);
  unwrap(await db().from('sessions').update({ ends_at: endsAt.toISOString() }).eq('id', id).eq('status', 'live'), 'extend');
  await broadcast(id, 'extended', { endsAt: endsAt.getTime() });
  return { ok: true, endsAt: endsAt.getTime() };
});

