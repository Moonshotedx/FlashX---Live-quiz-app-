import { HttpError } from './api';
import { db, query, unwrap } from './db';
import { loadSession, syncSession } from './session';
import type { ParticipantRow, QuizRow, SessionRow, Snapshot } from '../types';

export interface PlayContext {
  participant: ParticipantRow;
  session: SessionRow;
  quiz: QuizRow;
}

/**
 * quiz_snapshot is immutable for a given (session.id, started_at) once the link is published.
 * Caching it avoids transferring the full snapshot JSONB from Postgres on every single answer save.
 */
const snapshotCache = new Map<string, Snapshot>();

async function ensureSnapshot(session: SessionRow): Promise<Snapshot | null> {
  const key = `${session.id}:${session.started_at ?? ''}`;
  const cached = snapshotCache.get(key);
  if (cached) return cached;
  const row = unwrap<{ quiz_snapshot: Snapshot | null } | null>(
    await db().from('sessions').select('quiz_snapshot').eq('id', session.id).maybeSingle(),
    'snapshot',
  );
  if (row?.quiz_snapshot) {
    if (snapshotCache.size > 100) snapshotCache.clear();
    snapshotCache.set(key, row.quiz_snapshot);
    return row.quiz_snapshot;
  }
  return null;
}

interface PlayJoinRow extends ParticipantRow {
  s_quiz_id: string;
  s_join_code: string;
  s_status: SessionRow['status'];
  s_duration_seconds: number;
  s_started_at: string | null;
  s_ends_at: string | null;
  s_ended_at: string | null;
  s_closes_at: string | null;
  s_revealed_at: string | null;
  s_reveal_mode: SessionRow['reveal_mode'];
  s_reveal_step: number;
  s_created_at: string;
  quiz: QuizRow;
}

/**
 * Authenticates a participant from the join code in the URL and the x-device-token header.
 * One round trip (participant joined to session and quiz). A token can only ever resolve to its own participant.
 */
export async function playContext(
  code: string,
  token: string | null,
  opts: { snapshot?: boolean } = {},
  retried = false,
): Promise<PlayContext> {
  if (!token || token.length < 16 || token.length > 128) throw new HttpError(401, 'unknown_participant', 'Missing device token');

  const { rows } = await query<PlayJoinRow>(
    `SELECT
       p.id,
       p.session_id,
       p.display_name,
       p.email,
       p.team,
       p.roll_number,
       p.device_token,
       p.joined_at,
       p.started_at,
       p.ends_at,
       p.submitted_at,
       p.auto_submitted,
       p.score,
       p.correct_count,
       p.time_taken_ms,
       p.is_removed,
       s.quiz_id AS s_quiz_id,
       s.join_code AS s_join_code,
       s.status AS s_status,
       s.duration_seconds AS s_duration_seconds,
       s.started_at AS s_started_at,
       s.ends_at AS s_ends_at,
       s.ended_at AS s_ended_at,
       s.closes_at AS s_closes_at,
       s.revealed_at AS s_revealed_at,
       s.reveal_mode AS s_reveal_mode,
       s.reveal_step AS s_reveal_step,
       s.created_at AS s_created_at,
       to_jsonb(q) AS quiz
     FROM participants p
     JOIN sessions s ON s.id = p.session_id
     JOIN quizzes q ON q.id = s.quiz_id
     WHERE p.device_token = $1 AND s.join_code = $2
     LIMIT 1`,
    [token, code],
  );

  const row = rows[0];
  if (!row) throw new HttpError(404, 'unknown_participant', 'Participant not found');

  const participant: ParticipantRow = {
    id: row.id,
    session_id: row.session_id,
    display_name: row.display_name,
    email: row.email,
    team: row.team,
    roll_number: row.roll_number,
    device_token: row.device_token,
    joined_at: row.joined_at,
    started_at: row.started_at,
    ends_at: row.ends_at,
    submitted_at: row.submitted_at,
    auto_submitted: row.auto_submitted,
    score: row.score,
    correct_count: row.correct_count,
    time_taken_ms: row.time_taken_ms,
    is_removed: row.is_removed,
  };

  const sessionBase: SessionRow = {
    id: row.session_id,
    quiz_id: row.s_quiz_id,
    join_code: row.s_join_code,
    status: row.s_status,
    duration_seconds: row.s_duration_seconds,
    started_at: row.s_started_at,
    ends_at: row.s_ends_at,
    ended_at: row.s_ended_at,
    closes_at: row.s_closes_at,
    quiz_snapshot: null,
    revealed_at: row.s_revealed_at,
    reveal_mode: row.s_reveal_mode,
    reveal_step: row.s_reveal_step,
    created_at: row.s_created_at,
  };

  // Lazy auto-close check when closes_at has passed.
  if (!retried && sessionBase.status === 'live' && sessionBase.closes_at && Date.now() >= new Date(sessionBase.closes_at).getTime()) {
    await syncSession(await loadSession(sessionBase.id));
    return playContext(code, token, opts, true);
  }

  const quizSnapshot = opts.snapshot ? await ensureSnapshot(sessionBase) : null;
  return {
    participant,
    session: { ...sessionBase, quiz_snapshot: quizSnapshot },
    quiz: row.quiz,
  };
}

export function deviceToken(req: Request) {
  return req.headers.get('x-device-token');
}

export async function loadSessionByCode(code: string) {
  const { rows } = await query<SessionRow & { quizzes: QuizRow }>(
    `SELECT s.*, to_jsonb(q) AS quizzes
     FROM sessions s
     JOIN quizzes q ON q.id = s.quiz_id
     WHERE s.join_code = $1
     LIMIT 1`,
    [code],
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Quiz not found');
  return rows[0];
}
