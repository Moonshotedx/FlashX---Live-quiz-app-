import { handler } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { loadOwnedSession, syncSession } from '@/lib/server/session';
import { buildResults } from '@/lib/server/results';

export const dynamic = 'force-dynamic';

/** Full ranked results, team leaderboard, and per-question stats. Updates continuously as submissions arrive. */
export const GET = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  const r = await buildResults(s);
  return {
    rows: r.rows,
    teamRows: r.teamRows,
    questionStats: r.questionStats,
    summary: r.summary,
    totalQuestions: r.totalQuestions,
  };
});
