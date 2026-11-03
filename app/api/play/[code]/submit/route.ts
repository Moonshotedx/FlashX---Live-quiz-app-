import { z } from 'zod';
import { handler, HttpError, parseBody, rateLimit } from '@/lib/server/api';
import { db, unwrap } from '@/lib/server/db';
import { deviceToken, playContext } from '@/lib/server/play';
import { GRACE_MS } from '@/lib/server/session';
import { scoreAnswers, timeTakenMs } from '@/lib/scoring';
import { normalizeJoinCode } from '@/lib/join-code';
import type { Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

const body = z.object({ auto: z.boolean().optional() });

/** Lock answers and score on the server. Submitting twice is a no-op. */
export const POST = handler<{ code: string }>(async (req, { code }) => {
  const token = deviceToken(req);
  if (token) rateLimit(`submit:${token}`, 5, 1);
  const { auto } = await parseBody(req, body).catch(() => ({ auto: false }));
  const { participant, session } = await playContext(normalizeJoinCode(code), token, { snapshot: true });

  if (participant.is_removed) throw new HttpError(403, 'removed', 'You have been removed');
  if (participant.submitted_at) return { ok: true, alreadySubmitted: true };
  if (session.status !== 'live' || !session.ends_at || !session.started_at) throw new HttpError(409, 'not_live', 'The quiz is not live');
  const endsAt = new Date(session.ends_at).getTime();
  if (Date.now() > endsAt + GRACE_MS) throw new HttpError(409, 'too_late', 'Time is up');

  const answers = unwrap(
    await db().from('answers').select('question_id,option_id').eq('participant_id', participant.id),
    'answers',
  ) as { question_id: string; option_id: string }[];
  const snapshot = (session as { quiz_snapshot?: Snapshot | null }).quiz_snapshot ?? { questions: [] };
  const { score, correct } = scoreAnswers(snapshot, answers);
  // A submission that arrives in the grace window counts as submitted exactly at ends_at.
  const submittedAt = new Date(Math.min(Date.now(), endsAt)).toISOString();

  unwrap(
    await db()
      .from('participants')
      .update({
        submitted_at: submittedAt,
        auto_submitted: !!auto,
        score,
        correct_count: correct,
        time_taken_ms: timeTakenMs(submittedAt, session.started_at, participant.joined_at),
      })
      .eq('id', participant.id)
      .is('submitted_at', null),
    'submit',
  );
  return { ok: true };
});

