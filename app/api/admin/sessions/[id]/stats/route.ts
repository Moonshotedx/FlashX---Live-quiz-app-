import { handler, HttpError } from '@/lib/server/api';
import { getAdmin, tokenFromRequest, validPresenterToken } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { fetchParticipants, finalizeExpiredAttempts, liveScoreboard, loadSession, ranked, syncSession } from '@/lib/server/session';
import { rankTeams, summarize } from '@/lib/scoring';
import { resolveTheme } from '@/lib/theme';
import type { LeaderboardSummary, RankedRow, TeamRankRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const finalCache = new Map<
  string,
  { at: number; rows: RankedRow[]; teamRows: TeamRankRow[]; summary: LeaderboardSummary }
>();

/**
 * Light status payload polled every ~2s by the Responses page and the presenter view.
 * Allowed for any verified admin, or anyone holding the session's presenter token (?t=).
 */
export const GET = handler<{ id: string }>(async (req, { id }) => {
  const hasToken = validPresenterToken(id, tokenFromRequest(req));
  const admin = hasToken ? null : await getAdmin();
  const isAdmin = !!admin;
  if (!isAdmin && !hasToken) throw new HttpError(401, 'unauthorized', 'Not allowed');

  let s = await loadSession(id);
  s = await syncSession(s);
  await finalizeExpiredAttempts(id, { snapshot: s.quiz_snapshot });
  const quiz = s.quizzes;
  const full = req.nextUrl.searchParams.get('full') === '1';

  const [notStartedRes, inProgressRes, submittedRes] = await Promise.all([
    db()
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', id)
      .eq('is_removed', false)
      .is('started_at', null)
      .is('submitted_at', null),
    db()
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', id)
      .eq('is_removed', false)
      .not('started_at', 'is', null)
      .is('submitted_at', null),
    db()
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', id)
      .eq('is_removed', false)
      .not('submitted_at', 'is', null),
  ]);
  if (notStartedRes.error) throw new Error(notStartedRes.error.message);
  if (inProgressRes.error) throw new Error(inProgressRes.error.message);
  if (submittedRes.error) throw new Error(submittedRes.error.message);

  const notStarted = notStartedRes.count ?? 0;
  const inProgress = inProgressRes.count ?? 0;
  const submitted = submittedRes.count ?? 0;
  const started = inProgress + submitted;
  const joined = notStarted + started;

  let leaderboard: RankedRow[] = [];
  let teamLeaderboard: TeamRankRow[] = [];
  let summary: LeaderboardSummary | null = null;
  const totalQuestions = s.quiz_snapshot?.questions.length ?? 0;

  if (s.status === 'revealed' || isAdmin) {
    const cacheKey = `${id}:${s.status}`;
    let hit = finalCache.get(cacheKey);
    if (!hit || Date.now() - hit.at > 1500) {
      const rows = ranked(await fetchParticipants(id));
      const teamRows = rankTeams(rows);
      hit = { at: Date.now(), rows, teamRows, summary: summarize(rows, totalQuestions) };
      if (finalCache.size > 50) finalCache.clear();
      finalCache.set(cacheKey, hit);
    }
    leaderboard = full || s.reveal_mode === 'full' ? hit.rows : hit.rows.slice(0, 10);
    teamLeaderboard = hit.teamRows;
    summary = hit.summary;
  } else if ((s.status === 'live' || s.status === 'ended') && quiz.show_live_leaderboard) {
    leaderboard = await liveScoreboard(s, 10);
    teamLeaderboard = rankTeams(leaderboard);
  }

  return {
    serverNow: Date.now(),
    sessionId: s.id,
    status: s.status,
    quizTitle: quiz.title,
    theme: resolveTheme(quiz.theme),
    joinCode: s.join_code,
    durationSeconds: s.duration_seconds,
    startedAt: s.started_at ? new Date(s.started_at).getTime() : null,
    endsAt: null,
    endedAt: s.ended_at ? new Date(s.ended_at).getTime() : null,
    closesAt: s.closes_at,
    showLiveLeaderboard: quiz.show_live_leaderboard,
    teamMode: quiz.team_mode,
    teams: quiz.teams ?? [],
    notStarted,
    inProgress,
    submitted,
    started,
    joined,
    totalQuestions,
    reveal: { mode: s.reveal_mode, step: s.reveal_step, at: s.revealed_at ? new Date(s.revealed_at).getTime() : null },
    leaderboard,
    teamLeaderboard,
    summary,
  };
});
