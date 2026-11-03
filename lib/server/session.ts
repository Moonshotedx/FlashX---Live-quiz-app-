/**
 * Self-paced quiz link lifecycle (`sessions` table):
 * - `lobby`:    Unused for new links (kept in DB check constraint).
 * - `live`:     Link is Open. New students can join and start their personal timer (`participants.started_at` / `ends_at`).
 * - `ended`:    Link is Closed. New students cannot join/start; students already mid-attempt can finish within their own timer.
 * - `revealed`: Closed and Results published. Students can see score/rank; leaderboard can be shown on the LED screen.
 *
 * `sessions.started_at` records when the link was opened; `sessions.ends_at` is null and never used as a global timer.
 */
import { HttpError } from './api';
import { db, requireEnv, unwrap } from './db';
import { GRACE_MS, rankParticipants, scoreAnswers, timeTakenMs } from '../scoring';
import type { ParticipantRow, QuizRow, RankedRow, SessionRow, Snapshot } from '../types';

export { GRACE_MS };

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

/** Coalesce concurrent expired-attempt sweeps per session so hundreds of requests never stampede Postgres. */
const finalizing = new Map<string, Promise<void>>();

async function loadSnapshotOnly(sessionId: string): Promise<Snapshot> {
  const row = unwrap<{ quiz_snapshot: Snapshot | null } | null>(
    await db().from('sessions').select('quiz_snapshot').eq('id', sessionId).maybeSingle(),
    'snapshot',
  );
  return row?.quiz_snapshot ?? { questions: [] };
}

async function autoSubmitList(pending: ParticipantRow[], snapshot: Snapshot): Promise<void> {
  if (!pending.length) return;
  const ids = pending.map((p) => p.id);
  const byParticipant = new Map<string, { question_id: string; option_id: string }[]>();

  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const answers = await fetchAll<{ participant_id: string; question_id: string; option_id: string }>((from, to) =>
      db()
        .from('answers')
        .select('participant_id,question_id,option_id')
        .in('participant_id', batch)
        .order('id')
        .range(from, to),
    );
    for (const a of answers) {
      const list = byParticipant.get(a.participant_id) ?? [];
      list.push(a);
      byParticipant.set(a.participant_id, list);
    }
  }

  for (let i = 0; i < pending.length; i += 25) {
    const slice = pending.slice(i, i + 25);
    await Promise.all(
      slice.map(async (p) => {
        if (!p.started_at || !p.ends_at) return;
        const { score, correct } = scoreAnswers(snapshot, byParticipant.get(p.id) ?? []);
        const res = await db()
          .from('participants')
          .update({
            submitted_at: p.ends_at,
            auto_submitted: true,
            score,
            correct_count: correct,
            time_taken_ms: timeTakenMs(p.ends_at, p.started_at),
          })
          .eq('id', p.id)
          .is('submitted_at', null); // never overwrite a manual submit that arrived concurrently
        if (res.error) throw new Error(`auto-submit failed: ${res.error.message}`);
      }),
    );
  }
}

/**
 * Auto-submit participants whose personal timer (`ends_at + GRACE_MS`) has expired.
 * Pass `participantId` on participant requests to check only that student; omit it on admin/presenter
 * requests to sweep all expired attempts in the session (coalesced per session).
 */
export async function finalizeExpiredAttempts(
  sessionId: string,
  opts: { participantId?: string; snapshot?: Snapshot | null } = {},
): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_MS).toISOString();

  if (opts.participantId) {
    const p = unwrap<ParticipantRow | null>(
      await db()
        .from('participants')
        .select('*')
        .eq('id', opts.participantId)
        .eq('session_id', sessionId)
        .is('submitted_at', null)
        .not('started_at', 'is', null)
        .lt('ends_at', cutoff)
        .maybeSingle(),
      'check expired participant',
    );
    if (!p) return;
    const snapshot = opts.snapshot ?? (await loadSnapshotOnly(sessionId));
    await autoSubmitList([p], snapshot);
    return;
  }

  const active = finalizing.get(sessionId);
  if (active) return active;

  const task = (async () => {
    const expired = await fetchAll<ParticipantRow>((from, to) =>
      db()
        .from('participants')
        .select('*')
        .eq('session_id', sessionId)
        .is('submitted_at', null)
        .not('started_at', 'is', null)
        .lt('ends_at', cutoff)
        .order('id')
        .range(from, to),
    );
    if (!expired.length) return;
    const snapshot = opts.snapshot ?? (await loadSnapshotOnly(sessionId));
    await autoSubmitList(expired, snapshot);
  })();

  finalizing.set(sessionId, task);
  try {
    await task;
  } finally {
    finalizing.delete(sessionId);
  }
}

/** Automatically closes an open link once `closes_at` has passed. Does not touch in-progress attempts. */
export async function syncSession(s: SessionWithQuiz): Promise<SessionWithQuiz> {
  if (s.status === 'live' && s.closes_at && Date.now() >= new Date(s.closes_at).getTime()) {
    const stamp = s.closes_at;
    const { data, error } = await db()
      .from('sessions')
      .update({ status: 'ended', ended_at: stamp })
      .eq('id', s.id)
      .eq('status', 'live')
      .select('id');
    if (error) throw new Error(error.message);
    if (data?.length) await broadcast(s.id, 'status', { status: 'ended' });
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
    // Realtime is an optimisation; clients also poll, so never fail a request because of it.
    console.warn('[broadcast] failed', e instanceof Error ? e.message : e);
  }
}

/** Rank submitted, non-removed participants. Unstarted and still-running attempts stay out of the leaderboard. */
export function ranked(participants: ParticipantRow[]): RankedRow[] {
  return rankParticipants(participants.filter((p) => !p.is_removed && !!p.submitted_at));
}

// Live scoreboard (updates as submissions arrive when enabled on the quiz). Cached briefly so polling stays cheap.
const liveCache = new Map<string, { at: number; rows: RankedRow[] }>();
export async function liveScoreboard(s: SessionRow, limit = 10): Promise<RankedRow[]> {
  await finalizeExpiredAttempts(s.id, { snapshot: s.quiz_snapshot });
  const hit = liveCache.get(s.id);
  if (hit && Date.now() - hit.at < 1500) return hit.rows.slice(0, limit);
  const people = await fetchParticipants(s.id);
  const rows = ranked(people);
  liveCache.set(s.id, { at: Date.now(), rows });
  return rows.slice(0, limit);
}
