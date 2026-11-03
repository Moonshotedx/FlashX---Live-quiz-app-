import { z } from 'zod';
import { handler, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { loadQuestions, toSnapshot } from '@/lib/server/quizzes';
import { broadcast, loadOwnedSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const body = z.object({ confirm: z.literal('RESET') });

/** Delete all participants and answers, refresh the snapshot, and reopen the link (`status = 'live'`). */
export const POST = handler<{ id: string }>(async (req, { id }) => {
  const user = await requireAdmin();
  const s = await loadOwnedSession(id, user.id);
  await parseBody(req, body);

  const questions = await loadQuestions(s.quiz_id);
  const snapshot = toSnapshot(questions);
  const nowIso = new Date().toISOString();

  unwrap(await db().from('participants').delete().eq('session_id', id), 'delete participants'); // answers cascade
  unwrap(
    await db()
      .from('sessions')
      .update({
        status: 'live',
        duration_seconds: s.quizzes.duration_seconds,
        started_at: nowIso,
        ends_at: null,
        ended_at: null,
        quiz_snapshot: snapshot,
        revealed_at: null,
        reveal_mode: 'auto',
        reveal_step: 0,
      })
      .eq('id', id),
    'reset session',
  );
  await broadcast(id, 'reset', { status: 'live' });
  return { ok: true };
});
