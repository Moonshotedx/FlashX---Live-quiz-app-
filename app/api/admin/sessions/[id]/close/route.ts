import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { broadcast, loadOwnedSession, syncSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * Close the quiz link (`live -> ended`).
 * Blocks new joins/starts, while students already mid-attempt can still finish within their personal timer.
 */
export const POST = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  if (s.status === 'ended') return { ok: true, status: 'ended' };
  if (s.status !== 'live') throw new HttpError(409, 'not_open', 'Only an open link can be closed');

  const stamp = new Date().toISOString();
  unwrap(
    await db().from('sessions').update({ status: 'ended', ended_at: stamp }).eq('id', id).eq('status', 'live'),
    'close link',
  );
  await broadcast(id, 'status', { status: 'ended' });
  return { ok: true, status: 'ended' };
});
