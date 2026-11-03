import { z } from 'zod';
import { handler, HttpError, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { broadcast, loadOwnedSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

type P = { id: string; pid: string };
const body = z.object({ name: z.string().trim().min(2).max(30).optional(), removed: z.boolean().optional() });

async function guard(id: string, pid: string) {
  const user = await requireAdmin();
  await loadOwnedSession(id, user.id);
  const { data } = await db().from('participants').select('id').eq('id', pid).eq('session_id', id).maybeSingle();
  if (!data) throw new HttpError(404, 'not_found', 'Participant not found');
}

/** Rename, or restore a removed participant. */
export const PATCH = handler<P>(async (req, { id, pid }) => {
  await guard(id, pid);
  const b = await parseBody(req, body);
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.display_name = b.name;
  if (b.removed !== undefined) patch.is_removed = b.removed;
  if (!Object.keys(patch).length) throw new HttpError(400, 'empty_patch', 'Nothing to update');
  unwrap(await db().from('participants').update(patch).eq('id', pid), 'update participant');
  await broadcast(id, 'participant', { id: pid });
  return { ok: true };
});

/** Remove from the leaderboard. Their phone shows "You have been removed". */
export const DELETE = handler<P>(async (_req, { id, pid }) => {
  await guard(id, pid);
  unwrap(await db().from('participants').update({ is_removed: true }).eq('id', pid), 'remove participant');
  await broadcast(id, 'participant', { id: pid });
  return { ok: true };
});

