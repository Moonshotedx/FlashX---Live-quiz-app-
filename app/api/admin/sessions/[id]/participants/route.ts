import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { fetchParticipants, finalizeExpiredAttempts, loadOwnedSession, ranked, syncSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Responses table for the admin control room. Updates live as students join, start, and submit. */
export const GET = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  await finalizeExpiredAttempts(id, { snapshot: s.quiz_snapshot });

  const [people, counts] = await Promise.all([
    fetchParticipants(id, { includeRemoved: true }),
    db().rpc('session_answer_counts', { sid: id }),
  ]);
  if (counts.error) throw new HttpError(500, 'server_error', counts.error.message);
  const answered = new Map(
    (counts.data as { participant_id: string; answered: number }[]).map((r) => [r.participant_id, Number(r.answered)]),
  );
  const rankMap = new Map(ranked(people).map((r) => [r.participantId, r]));

  return {
    serverNow: Date.now(),
    status: s.status,
    participants: people.map((p) => {
      const n = answered.get(p.id) ?? 0;
      const rankRow = rankMap.get(p.id);
      const pStatus = p.is_removed
        ? 'removed'
        : p.submitted_at
          ? p.auto_submitted
            ? 'auto_submitted'
            : 'submitted'
          : p.started_at
            ? 'in_progress'
            : 'not_started';

      return {
        id: p.id,
        rank: rankRow?.rank ?? null,
        name: p.display_name,
        displayLabel: rankRow?.name ?? p.display_name,
        email: p.email,
        team: p.team,
        rollNumber: p.roll_number,
        status: pStatus,
        answered: n,
        score: p.submitted_at ? p.score : null,
        correctCount: p.submitted_at ? p.correct_count : null,
        timeTakenMs: p.submitted_at ? p.time_taken_ms : null,
        joinedAt: p.joined_at,
        startedAt: p.started_at,
        endsAt: p.ends_at,
        submittedAt: p.submitted_at,
        autoSubmitted: p.auto_submitted,
        removed: p.is_removed,
      };
    }),
  };
});
