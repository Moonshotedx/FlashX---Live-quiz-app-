import { z } from 'zod';
import { handler, HttpError, parseBody, rateLimit } from '@/lib/server/api';
import { db, unwrap } from '@/lib/server/db';
import { deviceToken, playContext } from '@/lib/server/play';
import { attemptOpen } from '@/lib/scoring';
import { normalizeJoinCode } from '@/lib/join-code';
import type { Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

const body = z.object({ questionId: z.string().uuid(), optionId: z.string().uuid() });

/**
 * Upsert one answer within the participant's personal attempt window.
 * Closing the link does not block students whose personal attempt is already open.
 * Correctness is decided on the server and never returned.
 */
export const PUT = handler<{ code: string }>(async (req, { code }) => {
  const token = deviceToken(req);
  if (token) rateLimit(`ans:${token}`, 8, 5); // ~5 saves per second per device
  const { questionId, optionId } = await parseBody(req, body);
  const { participant, session } = await playContext(normalizeJoinCode(code), token, { snapshot: true });

  if (participant.is_removed) throw new HttpError(403, 'removed', 'You have been removed');
  if (participant.submitted_at) throw new HttpError(409, 'already_submitted', 'Answers are locked');
  if (!participant.started_at || !participant.ends_at) throw new HttpError(409, 'not_started', 'Press Start before answering');
  if (!attemptOpen(participant)) throw new HttpError(409, 'too_late', 'Time is up');

  const snapshot = (session as { quiz_snapshot?: Snapshot | null }).quiz_snapshot;
  const question = snapshot?.questions.find((q) => q.id === questionId);
  const option = question?.options.find((o) => o.id === optionId);
  if (!question || !option) throw new HttpError(400, 'invalid_answer', 'Unknown question or option');

  const savedAt = new Date().toISOString();
  unwrap(
    await db()
      .from('answers')
      .upsert(
        { participant_id: participant.id, question_id: questionId, option_id: optionId, is_correct: option.is_correct, answered_at: savedAt },
        { onConflict: 'participant_id,question_id' },
      ),
    'save answer',
  );
  return { ok: true, savedAt };
});
