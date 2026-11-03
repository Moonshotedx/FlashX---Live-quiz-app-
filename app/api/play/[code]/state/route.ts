import { handler } from '@/lib/server/api';
import { db, unwrap } from '@/lib/server/db';
import { deviceToken, playContext } from '@/lib/server/play';
import { finalizeExpiredAttempts, GRACE_MS } from '@/lib/server/session';
import { attemptOpen } from '@/lib/scoring';
import { toPublicQuestions } from '@/lib/sanitize';
import { normalizeJoinCode } from '@/lib/join-code';
import type { ParticipantRow, StudentPhase } from '@/lib/types';

export const dynamic = 'force-dynamic';

type P = { code: string };

/**
 * Participant state driven by `phase`.
 * `?full=1` also returns saved answers and, only in phase `answering`, the questions WITHOUT correctness data.
 */
export const GET = handler<P>(async (req, { code }) => {
  const full = req.nextUrl.searchParams.get('full') === '1';
  const ctx = await playContext(normalizeJoinCode(code), deviceToken(req), { snapshot: true });
  let participant = ctx.participant;
  const { session, quiz } = ctx;

  // Cheap single-participant auto-submit if their personal timer + grace has expired.
  if (
    participant.started_at &&
    !participant.submitted_at &&
    participant.ends_at &&
    Date.now() > new Date(participant.ends_at).getTime() + GRACE_MS
  ) {
    await finalizeExpiredAttempts(session.id, { participantId: participant.id, snapshot: session.quiz_snapshot });
    participant = unwrap<ParticipantRow>(
      await db().from('participants').select('*').eq('id', participant.id).single(),
      'reload participant',
    );
  }

  const now = Date.now();
  const phase: StudentPhase = participant.is_removed
    ? 'removed'
    : !participant.started_at
      ? session.status === 'live'
        ? 'ready'
        : 'closed'
      : attemptOpen(participant, now)
        ? 'answering'
        : session.status === 'revealed'
          ? 'results'
          : 'submitted';

  const snapshot = session.quiz_snapshot;
  const totalQuestions = snapshot?.questions.length ?? 0;
  const maxScore = snapshot ? snapshot.questions.reduce((acc, q) => acc + q.points, 0) : 0;

  const immediateScore =
    phase === 'submitted' && quiz.score_visibility === 'immediate'
      ? { score: participant.score, correctCount: participant.correct_count, maxScore }
      : {};

  const base = {
    serverNow: now,
    sessionId: session.id,
    status: session.status,
    phase,
    theme: quiz.theme,
    durationSeconds: session.duration_seconds,
    totalQuestions,
    scoreVisibility: quiz.score_visibility,
    startedAt: participant.started_at ? new Date(participant.started_at).getTime() : null,
    endsAt: participant.ends_at ? new Date(participant.ends_at).getTime() : null,
    me: {
      id: participant.id,
      name: participant.display_name,
      email: participant.email,
      team: participant.team,
      submitted: !!participant.submitted_at,
      autoSubmitted: participant.auto_submitted,
      removed: participant.is_removed,
      ...immediateScore,
    },
  };

  if (phase === 'removed' || !full) return base;

  const answerRows = unwrap<{ question_id: string; option_id: string }[]>(
    await db().from('answers').select('question_id,option_id').eq('participant_id', participant.id),
    'answers',
  );
  const answers = Object.fromEntries(answerRows.map((a) => [a.question_id, a.option_id]));

  const showQuestions = phase === 'answering' && snapshot;
  return {
    ...base,
    answers,
    questions: showQuestions
      ? toPublicQuestions(snapshot, {
          shuffleQuestions: quiz.shuffle_questions,
          shuffleOptions: quiz.shuffle_options,
          participantId: participant.id,
        })
      : undefined,
  };
});
