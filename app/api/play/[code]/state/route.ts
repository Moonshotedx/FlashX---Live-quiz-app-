import { handler } from '@/lib/server/api';
import { db, unwrap } from '@/lib/server/db';
import { deviceToken, playContext } from '@/lib/server/play';
import { toPublicQuestions } from '@/lib/sanitize';
import { normalizeJoinCode } from '@/lib/join-code';

export const dynamic = 'force-dynamic';

type P = { code: string };

/**
 * Participant state. Light by default (status, timing, own flags) because phones poll it.
 * `?full=1` also returns saved answers and, only while live, the questions WITHOUT correctness data.
 */
export const GET = handler<P>(async (req, { code }) => {
  const full = req.nextUrl.searchParams.get('full') === '1';
  const { participant, session, quiz } = await playContext(normalizeJoinCode(code), deviceToken(req), { snapshot: full });

  const base = {
    serverNow: Date.now(),
    sessionId: session.id,
    status: session.status,
    theme: quiz.theme,
    startedAt: session.started_at ? new Date(session.started_at).getTime() : null,
    endsAt: session.ends_at ? new Date(session.ends_at).getTime() : null,
    me: {
      id: participant.id,
      name: participant.display_name,
      rollNumber: participant.roll_number,
      submitted: !!participant.submitted_at,
      autoSubmitted: participant.auto_submitted,
      removed: participant.is_removed,
    },
  };
  if (participant.is_removed || !full) return base;

  const answerRows = unwrap<{ question_id: string; option_id: string }[]>(
    await db().from('answers').select('question_id,option_id').eq('participant_id', participant.id),
    'answers',
  );
  const answers = Object.fromEntries(answerRows.map((a) => [a.question_id, a.option_id]));

  const snapshot = session.quiz_snapshot;
  const showQuestions = session.status === 'live' && !participant.submitted_at && snapshot;
  return {
    ...base,
    answers,
    totalQuestions: snapshot?.questions.length ?? 0,
    questions: showQuestions
      ? toPublicQuestions(snapshot, {
          shuffleQuestions: quiz.shuffle_questions,
          shuffleOptions: quiz.shuffle_options,
          participantId: participant.id,
        })
      : undefined,
  };
});
