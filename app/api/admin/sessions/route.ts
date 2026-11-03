import { z } from 'zod';
import { handler, HttpError, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { loadOwnedQuiz, loadQuestions, toEditable } from '@/lib/server/quizzes';
import { generateJoinCode } from '@/lib/join-code';
import { validateQuiz } from '@/lib/validate-quiz';

export const dynamic = 'force-dynamic';

const body = z.object({ quizId: z.string().uuid() });

/** Create a session (lobby) with a unique 6 character join code. Validates the quiz first. */
export const POST = handler(async (req) => {
  const user = await requireAdmin();
  const { quizId } = await parseBody(req, body);
  const quiz = await loadOwnedQuiz(quizId, user.id);
  const issues = validateQuiz(toEditable(await loadQuestions(quizId)));
  if (issues.length) throw new HttpError(422, 'quiz_invalid', 'Fix the quiz before creating a session', { issues });

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await db()
      .from('sessions')
      .insert({ quiz_id: quizId, join_code: generateJoinCode(), duration_seconds: quiz.duration_seconds })
      .select('id, join_code')
      .single();
    if (!error) return { id: data.id as string, joinCode: data.join_code as string };
    if (error.code !== '23505') throw new Error(error.message); // retry only on join code collision
  }
  throw new HttpError(500, 'code_generation_failed', 'Could not generate a unique join code');
});

