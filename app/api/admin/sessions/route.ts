import { z } from 'zod';
import { handler, HttpError, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { loadOwnedQuiz, loadQuestions, toEditable, toSnapshot } from '@/lib/server/quizzes';
import { generateJoinCode } from '@/lib/join-code';
import { validateQuiz } from '@/lib/validate-quiz';

export const dynamic = 'force-dynamic';

const body = z.object({
  quizId: z.string().uuid(),
  closesAt: z.string().datetime().nullable().optional(),
});

/**
 * Publish a shareable quiz link: validates the quiz, snapshots questions,
 * and opens the link immediately (`status = 'live'`, `started_at = now()`, `ends_at = null`).
 */
export const POST = handler(async (req) => {
  const user = await requireAdmin();
  const { quizId, closesAt } = await parseBody(req, body);
  const quiz = await loadOwnedQuiz(quizId, user.id);
  const questions = await loadQuestions(quizId);
  const issues = validateQuiz(toEditable(questions), {
    teamMode: quiz.team_mode,
    teams: quiz.teams,
  });
  if (issues.length) throw new HttpError(422, 'quiz_invalid', 'Fix the quiz before publishing a link', { issues });

  let closesIso: string | null = null;
  if (closesAt) {
    const ts = new Date(closesAt).getTime();
    if (Number.isNaN(ts) || ts <= Date.now()) {
      throw new HttpError(400, 'invalid_closes_at', 'Automatic close time must be in the future');
    }
    closesIso = new Date(ts).toISOString();
  }

  const snapshot = toSnapshot(questions);
  const nowIso = new Date().toISOString();

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await db()
      .from('sessions')
      .insert({
        quiz_id: quizId,
        join_code: generateJoinCode(),
        status: 'live',
        duration_seconds: quiz.duration_seconds,
        started_at: nowIso,
        ends_at: null,
        closes_at: closesIso,
        quiz_snapshot: snapshot,
      })
      .select('id, join_code')
      .single();
    if (!error) return { id: data.id as string, joinCode: data.join_code as string };
    if (error.code !== '23505') throw new Error(error.message); // retry only on join code collision
  }
  throw new HttpError(500, 'code_generation_failed', 'Could not generate a unique join code');
});
