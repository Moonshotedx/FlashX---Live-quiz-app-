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
import { db, query, unwrap } from './db';
import { GRACE_MS, rankParticipants, scoreAnswers, timeTakenMs } from '../scoring';
import type { ParticipantRow, QuizRow, RankedRow, SessionRow, Snapshot } from '../types';

export { GRACE_MS };

export type SessionWithQuiz = SessionRow & { quizzes: QuizRow };

/** Page through a query in fixed batches. */
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
  const { rows } = await query<SessionWithQuiz>(
    `SELECT s.*, to_jsonb(q) AS quizzes
     FROM sessions s
     JOIN quizzes q ON q.id = s.quiz_id
     WHERE s.id = $1
     LIMIT 1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Session not found');
  return rows[0];
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
    const answers = unwrap<{ participant_id: string; question_id: string; option_id: string }[]>(
      await db().from('answers').select('participant_id,question_id,option_id').in('participant_id', batch).order('id'),
      'answers batch',
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
    const expired = unwrap<ParticipantRow[]>(
      await db()
        .from('participants')
        .select('*')
        .eq('session_id', sessionId)
        .is('submitted_at', null)
        .not('started_at', 'is', null)
        .lt('ends_at', cutoff)
        .order('id'),
      'expired participants',
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
  const { rows } = await query<{ participant_id: string; question_id: string; option_id: string }>(
    `SELECT a.participant_id, a.question_id, a.option_id
     FROM answers a
     JOIN participants p ON p.id = a.participant_id
     WHERE p.session_id = $1
     ORDER BY a.id ASC`,
    [sessionId],
  );
  return rows;
}

export async function fetchParticipants(sessionId: string, opts: { includeRemoved?: boolean } = {}) {
  let q = db().from<ParticipantRow[]>('participants').select('*').eq('session_id', sessionId);
  if (!opts.includeRemoved) q = q.eq('is_removed', false);
  return unwrap(await q.order('joined_at').order('id'), 'fetchParticipants');
}

export async function broadcast(_sessionId: string, _event: string, _payload: Record<string, unknown> = {}) {
  // Clients poll /state and /stats every ~2s on Neon; broadcast hook is kept as a safe no-op.
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
