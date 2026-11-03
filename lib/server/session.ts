import { HttpError } from './api';
import { db, requireEnv, unwrap } from './db';
import { rankParticipants, scoreAnswers, timeTakenMs } from '../scoring';
import type { ParticipantRow, QuizRow, RankedRow, SessionRow } from '../types';

export const GRACE_MS = 3000;

export type SessionWithQuiz = SessionRow & { quizzes: QuizRow };

/** Page through a PostgREST query (Supabase caps every response at 1000 rows by default). */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const rows = unwrap(await page(from, from + size - 1), 'fetchAll');
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

export async function loadSession(id: string): Promise<SessionWithQuiz> {
  const { data, error } = await db().from('sessions').select('*, quizzes!inner(*)').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'not_found', 'Session not found');
  return data as SessionWithQuiz;
}

/** Load a session for a verified admin (all event admins in the workspace share access). */
export async function loadOwnedSession(id: string, _adminId?: string): Promise<SessionWithQuiz> {
  return loadSession(id);
}

/** Coalesce concurrent finalizations per session so 500 polling phones never stampede Postgres. */
const finalizing = new Map<string, Promise<void>>();

/** Marks a live session ended once ends_at + grace has passed. Cheap check on every status/stats request. */
export async function syncSession(s: SessionWithQuiz): Promise<SessionWithQuiz> {
  if (s.status === 'live' && s.ends_at && Date.now() > new Date(s.ends_at).getTime() + GRACE_MS) {
    await finalizeSession(s, new Date(s.ends_at));
    return loadSession(s.id);
  }
  return s;
}

export async function fetchSessionAnswers(sessionId: string) {
  return fetchAll<{ participant_id: string; question_id: string; option_id: string }>((from, to) =>
    db()
      .from('answers')
      .select('participant_id,question_id,option_id,participants!inner(session_id)')
      .eq('participants.session_id', sessionId)
      .order('id')
      .range(from, to),
  );
}

export async function fetchParticipants(sessionId: string, opts: { includeRemoved?: boolean } = {}) {
  return fetchAll<ParticipantRow>((from, to) => {
    let q = db().from('participants').select('*').eq('session_id', sessionId);
    if (!opts.includeRemoved) q = q.eq('is_removed', false);
    return q.order('joined_at').order('id').range(from, to);
  });
}

/**
 * Ends the session: every participant who has not submitted is auto-submitted at `endedAt`
 * (the timer end, or "now" when the admin ends early), scores are computed from the frozen snapshot,
 * and the status moves to `ended`. Safe to call repeatedly and concurrently.
 */
export async function finalizeSession(s: SessionRow, endedAt: Date): Promise<void> {
  if (s.status !== 'live' || !s.started_at) return;
  const active = finalizing.get(s.id);
  if (active) return active;

  const task = (async () => {
    let full = s;
    if (!full.quiz_snapshot) {
      const reloaded = await loadSession(s.id);
      if (reloaded.status !== 'live' || !reloaded.quiz_snapshot || !reloaded.started_at) return;
      full = reloaded;
    }
    const stamp = endedAt.toISOString();
    const pending = (await fetchParticipants(full.id, { includeRemoved: true })).filter((p) => !p.submitted_at);
    if (pending.length) {
      const ids = new Set(pending.map((p) => p.id));
      const byParticipant = new Map<string, { question_id: string; option_id: string }[]>();
      for (const a of await fetchSessionAnswers(full.id)) {
        if (!ids.has(a.participant_id)) continue;
        const list = byParticipant.get(a.participant_id) ?? [];
        list.push(a);
        byParticipant.set(a.participant_id, list);
      }
      const rows = pending.map((p) => {
        const { score, correct } = scoreAnswers(full.quiz_snapshot!, byParticipant.get(p.id) ?? []);
        return {
          ...p,
          submitted_at: stamp,
          auto_submitted: true,
          score,
          correct_count: correct,
          time_taken_ms: timeTakenMs(stamp, full.started_at!, p.joined_at),
        };
      });
      for (let i = 0; i < rows.length; i += 200) {
        const res = await db().from('participants').upsert(rows.slice(i, i + 200), { onConflict: 'id' });
        if (res.error) throw new Error(`auto-submit failed: ${res.error.message}`);
      }
    }
    const { data, error } = await db()
      .from('sessions')
      .update({ status: 'ended', ended_at: stamp, ends_at: full.ends_at && new Date(full.ends_at) < endedAt ? full.ends_at : stamp })
      .eq('id', full.id)
      .eq('status', 'live')
      .select('id');
    if (error) throw new Error(error.message);
    if (data?.length) await broadcast(full.id, 'status', { status: 'ended' });
  })();

  finalizing.set(s.id, task);
  try {
    await task;
  } finally {
    finalizing.delete(s.id);
  }
}

export async function broadcast(sessionId: string, event: string, payload: Record<string, unknown> = {}) {
  try {
    const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    await fetch(`${requireEnv('NEXT_PUBLIC_SUPABASE_URL')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `session:${sessionId}`, event, payload }] }),
      signal: AbortSignal.timeout(2500),
    });
  } catch (e) {
    // Realtime is an optimisation; phones also poll, so never fail a request because of it.
    console.warn('[broadcast] failed', e instanceof Error ? e.message : e);
  }
}

export function ranked(participants: ParticipantRow[]): RankedRow[] {
  return rankParticipants(participants.filter((p) => !p.is_removed));
}

// Live scoreboard (only used when the quiz enables it). Cached briefly so polling stays cheap.
const liveCache = new Map<string, { at: number; rows: RankedRow[] }>();
export async function liveScoreboard(s: SessionRow, limit = 10): Promise<RankedRow[]> {
  const hit = liveCache.get(s.id);
  if (hit && Date.now() - hit.at < 1500) return hit.rows.slice(0, limit);
  if (!s.quiz_snapshot) return [];
  const [people, answers] = await Promise.all([fetchParticipants(s.id), fetchSessionAnswers(s.id)]);
  const grouped = new Map<string, { question_id: string; option_id: string }[]>();
  for (const a of answers) grouped.set(a.participant_id, [...(grouped.get(a.participant_id) ?? []), a]);
  const scored = people.map((p) => {
    if (p.submitted_at) return p;
    const { score, correct } = scoreAnswers(s.quiz_snapshot!, grouped.get(p.id) ?? []);
    return { ...p, score, correct_count: correct };
  });
  const rows = ranked(scored);
  liveCache.set(s.id, { at: Date.now(), rows });
  return rows.slice(0, limit);
}
