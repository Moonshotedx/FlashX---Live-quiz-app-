import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { broadcast, loadOwnedSession, syncSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Reopen a closed quiz link (`ended -> live`). Clears a past `closes_at` so it does not immediately auto-close. */
export const POST = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  if (s.status === 'live') return { ok: true, status: 'live' };
  if (s.status !== 'ended') throw new HttpError(409, 'not_closed', 'Only a closed link can be reopened');

  const pastClosesAt = s.closes_at && new Date(s.closes_at).getTime() <= Date.now();
  unwrap(
    await db()
      .from('sessions')
      .update({
        status: 'live',
        ended_at: null,
        ...(pastClosesAt ? { closes_at: null } : {}),
      })
      .eq('id', id)
      .eq('status', 'ended'),
    'reopen link',
  );
  await broadcast(id, 'status', { status: 'live' });
  return { ok: true, status: 'live' };
});

