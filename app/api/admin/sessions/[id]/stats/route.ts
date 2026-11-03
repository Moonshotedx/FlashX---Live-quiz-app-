import { handler, HttpError } from '@/lib/server/api';
import { getAdmin, tokenFromRequest, validPresenterToken } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { fetchParticipants, liveScoreboard, loadSession, ranked, syncSession } from '@/lib/server/session';
import { summarize } from '@/lib/scoring';
import { resolveTheme } from '@/lib/theme';
import type { LeaderboardSummary, RankedRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const finalCache = new Map<string, { at: number; rows: RankedRow[]; summary: LeaderboardSummary }>();

/**
 * Light status payload polled every ~2s by the control room and the presenter view.
 * Allowed for any verified admin, or anyone holding the session's presenter token (?t=).
 */
export const GET = handler<{ id: string }>(async (req, { id }) => {
  const hasToken = validPresenterToken(id, tokenFromRequest(req));
  const admin = hasToken ? null : await getAdmin();
  const isAdmin = !!admin;
  if (!isAdmin && !hasToken) throw new HttpError(401, 'unauthorized', 'Not allowed');

  let s = await loadSession(id);
  s = await syncSession(s);
  const quiz = s.quizzes;
  const full = req.nextUrl.searchParams.get('full') === '1';

  const [joined, submitted, recent] = await Promise.all([
    db().from('participants').select('id', { count: 'exact', head: true }).eq('session_id', id).eq('is_removed', false),
    db().from('participants').select('id', { count: 'exact', head: true }).eq('session_id', id).eq('is_removed', false).not('submitted_at', 'is', null),
    s.status === 'lobby' || s.status === 'live'
      ? db().from('participants').select('id,display_name').eq('session_id', id).eq('is_removed', false).order('joined_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (joined.error) throw new Error(joined.error.message);
  if (submitted.error) throw new Error(submitted.error.message);
  unwrap(recent as { data: unknown[] | null; error: { message: string } | null }, 'recent');

  let leaderboard: RankedRow[] = [];
  let summary: LeaderboardSummary | null = null;
  const totalQuestions = s.quiz_snapshot?.questions.length ?? 0;
  if (s.status === 'revealed' || (s.status === 'ended' && isAdmin)) {
    const cacheKey = `${id}:${s.ended_at ?? ''}`;
    let hit = finalCache.get(cacheKey);
    if (!hit || Date.now() - hit.at > 1500) {
      const rows = ranked(await fetchParticipants(id));
      hit = { at: Date.now(), rows, summary: summarize(rows, totalQuestions) };
      if (finalCache.size > 50) finalCache.clear();
      finalCache.set(cacheKey, hit);
    }
    leaderboard = full || s.reveal_mode === 'full' ? hit.rows : hit.rows.slice(0, 10);
    summary = hit.summary;
  } else if (s.status === 'live' && quiz.show_live_leaderboard) {
    leaderboard = await liveScoreboard(s, 10);
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
    endsAt: s.ends_at ? new Date(s.ends_at).getTime() : null,
    endedAt: s.ended_at ? new Date(s.ended_at).getTime() : null,
    allowLateJoin: quiz.allow_late_join,
    showLiveLeaderboard: quiz.show_live_leaderboard,
    joined: joined.count ?? 0,
    submitted: submitted.count ?? 0,
    recent: ((recent.data ?? []) as { id: string; display_name: string }[]).map((r) => ({ id: r.id, name: r.display_name })),
    totalQuestions,
    reveal: { mode: s.reveal_mode, step: s.reveal_step, at: s.revealed_at ? new Date(s.revealed_at).getTime() : null },
    leaderboard,
    summary,
  };
});
