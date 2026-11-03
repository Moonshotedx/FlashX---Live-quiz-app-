import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { loadOwnedSession, syncSession } from '@/lib/server/session';
import { buildResults } from '@/lib/server/results';

export const dynamic = 'force-dynamic';

/** Full ranked results and per question stats. Available once ended or revealed. */
export const GET = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  if (s.status !== 'ended' && s.status !== 'revealed') throw new HttpError(409, 'not_ended', 'Results are available after the quiz ends');
  const r = await buildResults(s);
  return { rows: r.rows, questionStats: r.questionStats, summary: r.summary, totalQuestions: r.totalQuestions };
});

