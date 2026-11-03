import { HttpError } from './api';
import { db, unwrap } from './db';
import { loadSession, syncSession } from './session';
import type { ParticipantRow, QuizRow, SessionRow, Snapshot } from '../types';

export interface PlayContext {
  participant: ParticipantRow;
  session: SessionRow;
  quiz: QuizRow;
}

const SESSION_COLS =
  'id,quiz_id,join_code,status,duration_seconds,started_at,ends_at,ended_at,closes_at,revealed_at,reveal_mode,reveal_step,created_at';

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
  const { data, error } = await db()
    .from('participants')
    .select(`*, sessions!inner(${SESSION_COLS}, quizzes(*))`)
    .eq('device_token', token)
    .eq('sessions.join_code', code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'unknown_participant', 'Participant not found');

  const { sessions, ...participant } = data as unknown as ParticipantRow & { sessions: SessionRow & { quizzes: QuizRow } };
  const { quizzes, ...session } = sessions;

  // Lazy auto-close check when closes_at has passed.
  if (!retried && session.status === 'live' && session.closes_at && Date.now() >= new Date(session.closes_at).getTime()) {
    await syncSession(await loadSession(session.id));
    return playContext(code, token, opts, true);
  }

  const quizSnapshot = opts.snapshot ? await ensureSnapshot(session as SessionRow) : null;
  return {
    participant,
    session: { ...(session as SessionRow), quiz_snapshot: quizSnapshot },
    quiz: quizzes,
  };
}

export function deviceToken(req: Request) {
  return req.headers.get('x-device-token');
}

export async function loadSessionByCode(code: string) {
  const row = unwrap<(SessionRow & { quizzes: QuizRow }) | null>(
    await db().from('sessions').select('*, quizzes!inner(*)').eq('join_code', code).maybeSingle(),
    'session lookup',
  );
  if (!row) throw new HttpError(404, 'not_found', 'Quiz not found');
  return row;
}
