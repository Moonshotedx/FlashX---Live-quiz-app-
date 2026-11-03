import { handler, HttpError, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { loadOwnedQuiz } from '@/lib/server/quizzes';
import { quizSettingsSchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

type P = { quizId: string };

/** Update quiz settings and/or theme. */
export const PATCH = handler<P>(async (req, { quizId }) => {
  const user = await requireAdmin();
  await loadOwnedQuiz(quizId, user.id);
  const patch = await parseBody(req, quizSettingsSchema);
  if (!Object.keys(patch).length) throw new HttpError(400, 'empty_patch', 'Nothing to update');
  const row = unwrap<{ updated_at: string }>(
    await db().from('quizzes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', quizId).select('updated_at').single(),
    'update quiz',
  );
  return { ok: true, updatedAt: row.updated_at };
});

export const DELETE = handler<P>(async (_req, { quizId }) => {
  const user = await requireAdmin();
  await loadOwnedQuiz(quizId, user.id);
  unwrap(await db().from('quizzes').delete().eq('id', quizId), 'delete quiz');
  return { ok: true };
});
