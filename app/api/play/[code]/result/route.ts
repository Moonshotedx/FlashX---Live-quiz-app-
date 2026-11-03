import { handler, HttpError } from '@/lib/server/api';
import { db, unwrap } from '@/lib/server/db';
import { deviceToken, playContext } from '@/lib/server/play';
import { fetchParticipants, ranked } from '@/lib/server/session';
import { normalizeJoinCode } from '@/lib/join-code';
import type { RankedRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Short cache so hundreds of phones fetching results right after the reveal do not each rebuild the ranking.
const rankCache = new Map<string, { at: number; rows: RankedRow[] }>();

/** Own score, rank and (optionally) answer review. The only participant route that exposes correct answers, only once revealed. */
export const GET = handler<{ code: string }>(async (req, { code }) => {
  const { participant, session, quiz } = await playContext(normalizeJoinCode(code), deviceToken(req), { snapshot: true });
  if (participant.is_removed) throw new HttpError(403, 'removed', 'You have been removed');
  if (session.status !== 'revealed') throw new HttpError(403, 'not_revealed', 'Results are not available yet');

  const cacheKey = `${session.id}:${session.revealed_at ?? ''}`;
  let hit = rankCache.get(cacheKey);
  if (!hit || Date.now() - hit.at > 2000) {
    hit = { at: Date.now(), rows: ranked(await fetchParticipants(session.id)) };
    if (rankCache.size > 50) rankCache.clear();
    rankCache.set(cacheKey, hit);
  }
  const me = hit.rows.find((r) => r.participantId === participant.id);
  const snapshot = session.quiz_snapshot ?? { questions: [] };
  const maxScore = snapshot.questions.reduce((a, q) => a + q.points, 0);

  let review: unknown;
  if (quiz.show_answers_after_reveal) {
    const mine = unwrap<{ question_id: string; option_id: string }[]>(
      await db().from('answers').select('question_id,option_id').eq('participant_id', participant.id),
      'answers',
    );
    const chosen = new Map(mine.map((a) => [a.question_id, a.option_id]));
    review = [...snapshot.questions]
      .sort((a, b) => a.position - b.position)
      .map((q) => ({
        questionId: q.id,
        text: q.text,
        myOptionId: chosen.get(q.id) ?? null,
        correctOptionId: q.options.find((o) => o.is_correct)?.id ?? null,
        options: [...q.options].sort((a, b) => a.position - b.position).map((o) => ({ id: o.id, text: o.text })),
      }));
  }

  return {
    rank: me?.rank ?? null,
    total: hit.rows.length,
    score: participant.score,
    correctCount: participant.correct_count,
    totalQuestions: snapshot.questions.length,
    maxScore,
    timeTakenMs: participant.time_taken_ms,
    review,
  };
});
