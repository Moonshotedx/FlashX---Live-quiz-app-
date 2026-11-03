import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { fetchParticipants, loadOwnedSession, syncSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Participants table for the control room. Scores are only included once the session has ended. */
export const GET = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  const [people, counts] = await Promise.all([
    fetchParticipants(id, { includeRemoved: true }),
    db().rpc('session_answer_counts', { sid: id }),
  ]);
  if (counts.error) throw new HttpError(500, 'server_error', counts.error.message);
  const answered = new Map((counts.data as { participant_id: string; answered: number }[]).map((r) => [r.participant_id, Number(r.answered)]));
  const showScores = s.status === 'ended' || s.status === 'revealed';
  return {
    status: s.status,
    participants: people.map((p) => {
      const n = answered.get(p.id) ?? 0;
      return {
        id: p.id,
        name: p.display_name,
        rollNumber: p.roll_number,
        status: p.is_removed ? 'removed' : p.submitted_at ? 'submitted' : s.status === 'live' && n > 0 ? 'answering' : 'waiting',
        answered: n,
        score: showScores ? p.score : null,
        correctCount: showScores ? p.correct_count : null,
        timeTakenMs: showScores ? p.time_taken_ms : null,
        joinedAt: p.joined_at,
        submittedAt: p.submitted_at,
        autoSubmitted: p.auto_submitted,
        removed: p.is_removed,
      };
    }),
  };
});

