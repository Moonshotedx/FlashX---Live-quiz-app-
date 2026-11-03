import { z } from 'zod';
import { handler, HttpError, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { broadcast, loadOwnedSession, syncSession } from '@/lib/server/session';
import { db, unwrap } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

const body = z.object({ durationSeconds: z.number().int().min(30).max(3600) });

/** Edit the session duration while still in the lobby. */
export const PATCH = handler<{ id: string }>(async (req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  if (s.status !== 'lobby') throw new HttpError(409, 'not_lobby', 'Duration can only be changed before the quiz starts');
  const { durationSeconds } = await parseBody(req, body);
  unwrap(await db().from('sessions').update({ duration_seconds: durationSeconds }).eq('id', id).eq('status', 'lobby'), 'update duration');
  await broadcast(id, 'status', { status: 'lobby' });
  return { ok: true, durationSeconds };
});

