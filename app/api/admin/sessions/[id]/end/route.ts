import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { finalizeSession, loadOwnedSession, loadSession, syncSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** End now: auto-submits everyone who has not submitted and scores them. */
export const POST = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  if (s.status === 'live') await finalizeSession(s, new Date());
  else if (s.status === 'lobby') throw new HttpError(409, 'not_started', 'The quiz has not started');
  const after = await loadSession(id);
  return { ok: true, status: after.status };
});

