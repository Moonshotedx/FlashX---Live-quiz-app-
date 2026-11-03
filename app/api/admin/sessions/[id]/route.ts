import { z } from 'zod';
import { handler, HttpError, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { broadcast, loadOwnedSession, syncSession } from '@/lib/server/session';
import { db, unwrap } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

const body = z.object({
  closesAt: z.string().datetime().nullable(),
});

/** Update or clear the optional automatic close timestamp (`closes_at`) for a quiz link. */
export const PATCH = handler<{ id: string }>(async (req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  const { closesAt } = await parseBody(req, body);

  let closesIso: string | null = null;
  if (closesAt !== null) {
    const ts = new Date(closesAt).getTime();
    if (Number.isNaN(ts) || ts <= Date.now()) {
      throw new HttpError(400, 'invalid_closes_at', 'Close time must be in the future');
    }
    closesIso = new Date(ts).toISOString();
  }

  unwrap(await db().from('sessions').update({ closes_at: closesIso }).eq('id', id), 'update closes_at');
  await broadcast(id, 'status', { status: s.status, closesAt: closesIso });
  return { ok: true, closesAt: closesIso };
});
