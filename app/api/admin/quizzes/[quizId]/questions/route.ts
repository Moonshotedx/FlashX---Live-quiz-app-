import { handler, HttpError, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { chunk, loadOwnedQuiz } from '@/lib/server/quizzes';
import { questionsSchema } from '@/lib/server/schemas';
import { fetchAll } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * Replace the quiz's questions with the editor state (autosave). Client generated UUIDs are kept so ids stay stable.
 * Position comes from array order. Drafts (empty text, no correct option) are allowed; validation happens at session create.
 */
export const PUT = handler<{ quizId: string }>(async (req, { quizId }) => {
  const user = await requireAdmin();
  await loadOwnedQuiz(quizId, user.id);
  const { questions } = await parseBody(req, questionsSchema);

  const qIds = questions.map((q) => q.id);
  const oIds = questions.flatMap((q) => q.options.map((o) => o.id));
  if (new Set(qIds).size !== qIds.length || new Set(oIds).size !== oIds.length) throw new HttpError(400, 'duplicate_ids', 'Duplicate ids');

  const existingQ = new Set(
    (unwrap(await db().from('questions').select('id').eq('quiz_id', quizId), 'existing questions') as { id: string }[]).map((r) => r.id),
  );
  const existingO = new Set(
    (
      await fetchAll<{ id: string }>((from, to) =>
        db().from('options').select('id, questions!inner(quiz_id)').eq('questions.quiz_id', quizId).order('id').range(from, to),
      )
    ).map((r) => r.id),
  );

  // New ids must not collide with rows owned by another quiz (an upsert would overwrite them).
  const collides = async (table: 'questions' | 'options', ids: string[]) => {
    for (const part of chunk(ids, 100)) {
      const hit = unwrap(await db().from(table).select('id').in('id', part).limit(1), `${table} id check`) as unknown[];
      if (hit.length) return true;
    }
    return false;
  };
  if ((await collides('questions', qIds.filter((i) => !existingQ.has(i)))) || (await collides('options', oIds.filter((i) => !existingO.has(i))))) {
    throw new HttpError(409, 'id_conflict', 'Question ids conflict with another quiz');
  }

  const qRows = questions.map((q, i) => ({ id: q.id, quiz_id: quizId, position: i + 1, text: q.text, image_url: q.image_url, points: q.points }));
  const oRows = questions.flatMap((q) =>
    q.options.map((o, k) => ({ id: o.id, question_id: q.id, position: k + 1, text: o.text, is_correct: o.is_correct })),
  );

  for (const part of chunk(qRows, 100)) unwrap(await db().from('questions').upsert(part, { onConflict: 'id' }), 'save questions');
  for (const part of chunk(oRows, 200)) unwrap(await db().from('options').upsert(part, { onConflict: 'id' }), 'save options');

  const staleO = [...existingO].filter((id) => !oIds.includes(id));
  const staleQ = [...existingQ].filter((id) => !qIds.includes(id));
  for (const part of chunk(staleO, 100)) unwrap(await db().from('options').delete().in('id', part), 'delete options');
  for (const part of chunk(staleQ, 100)) unwrap(await db().from('questions').delete().in('id', part), 'delete questions');

  const now = new Date().toISOString();
  await db().from('quizzes').update({ updated_at: now }).eq('id', quizId);
  return { ok: true, updatedAt: now };
});

