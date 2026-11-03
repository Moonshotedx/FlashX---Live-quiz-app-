import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { loadQuestions, toEditable, toSnapshot } from '@/lib/server/quizzes';
import { broadcast, loadOwnedSession } from '@/lib/server/session';
import { validateQuiz } from '@/lib/validate-quiz';

export const dynamic = 'force-dynamic';

/** Snapshot the quiz, set started_at / ends_at on the server clock, status live. */
export const POST = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await loadOwnedSession(id, user.id);
  if (s.status !== 'lobby') throw new HttpError(409, 'not_lobby', 'The session has already started');

  const questions = await loadQuestions(s.quiz_id);
  const issues = validateQuiz(toEditable(questions));
  if (issues.length) throw new HttpError(422, 'quiz_invalid', 'Fix the quiz before starting', { issues });

  const now = new Date();
  const endsAt = new Date(now.getTime() + s.duration_seconds * 1000);
  const { data, error } = await db()
    .from('sessions')
    .update({
      status: 'live',
      started_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      ended_at: null,
      quiz_snapshot: toSnapshot(questions),
    })
    .eq('id', id)
    .eq('status', 'lobby') // atomic: a double click cannot start twice
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new HttpError(409, 'not_lobby', 'The session has already started');
  await broadcast(id, 'status', { status: 'live' });
  return { ok: true, startedAt: now.getTime(), endsAt: endsAt.getTime() };
});

