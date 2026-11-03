import { z } from 'zod';
import { handler, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { broadcast, loadOwnedSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const body = z.object({ confirm: z.literal('RESET') });

/** Delete all participants and answers and return to the lobby. Phones fall back to the join screen. */
export const POST = handler<{ id: string }>(async (req, { id }) => {
  const user = await requireAdmin();
  await loadOwnedSession(id, user.id);
  await parseBody(req, body);
  unwrap(await db().from('participants').delete().eq('session_id', id), 'delete participants'); // answers cascade
  unwrap(
    await db()
      .from('sessions')
      .update({
        status: 'lobby',
        started_at: null,
        ends_at: null,
        ended_at: null,
        quiz_snapshot: null,
        revealed_at: null,
        reveal_mode: 'auto',
        reveal_step: 0,
      })
      .eq('id', id),
    'reset session',
  );
  await broadcast(id, 'reset', { status: 'lobby' });
  return { ok: true };
});

