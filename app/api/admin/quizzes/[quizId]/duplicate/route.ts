import { randomUUID } from 'node:crypto';
import { handler } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { loadOwnedQuiz, loadQuestions } from '@/lib/server/quizzes';
import type { QuizRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Copy a quiz with all questions and options (new ids). */
export const POST = handler<{ quizId: string }>(async (_req, { quizId }) => {
  const user = await requireAdmin();
  const quiz = await loadOwnedQuiz(quizId, user.id);
  const questions = await loadQuestions(quizId);

  const { id: _id, created_at: _c, updated_at: _u, ...rest } = quiz;
  const copy = unwrap(
    await db().from('quizzes').insert({ ...rest, title: `${quiz.title} (copy)`.slice(0, 120) }).select('*').single(),
    'duplicate quiz',
  ) as QuizRow;

  const qRows = questions.map((q) => ({ id: randomUUID(), quiz_id: copy.id, position: q.position, text: q.text, image_url: q.image_url, points: q.points }));
  if (qRows.length) {
    unwrap(await db().from('questions').insert(qRows), 'duplicate questions');
    const oRows = questions.flatMap((q, i) =>
      q.options.map((o) => ({ question_id: qRows[i].id, position: o.position, text: o.text, is_correct: o.is_correct })),
    );
    if (oRows.length) unwrap(await db().from('options').insert(oRows), 'duplicate options');
  }
  return { id: copy.id };
});

