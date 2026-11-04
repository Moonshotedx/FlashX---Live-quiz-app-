import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { clientIp, handler, HttpError, parseBody, rateLimit } from '@/lib/server/api';
import { db, query, unwrap } from '@/lib/server/db';
import { loadSessionByCode } from '@/lib/server/play';
import { finalizeExpiredAttempts, syncSession } from '@/lib/server/session';
import { normalizeJoinCode } from '@/lib/join-code';
import { isProfane } from '@/lib/profanity';
import type { ParticipantRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

type P = { code: string };

/** Public info about a quiz link: open status, theme, and form field settings. Never any questions. */
export const GET = handler<P>(async (req, { code }) => {
  rateLimit(`joininfo:${clientIp(req)}`, 120, 20);
  const session = await syncSession(await loadSessionByCode(normalizeJoinCode(code)));
  const q = session.quizzes;
  return {
    sessionId: session.id,
    status: session.status,
    isOpen: session.status === 'live',
    quizTitle: q.title,
    description: q.description,
    theme: q.theme,
    durationSeconds: session.duration_seconds,
    questionCount: session.quiz_snapshot?.questions.length ?? 0,
    teamMode: q.team_mode,
    teams: q.teams ?? [],
    emailRequired: q.email_required,
    scoreVisibility: q.score_visibility,
  };
});

const emailSchema = z.string().email();

const joinBody = z.object({
  name: z.string().max(100),
  email: z.string().max(254).optional(),
  team: z.string().max(120).optional(),
});

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

async function findExistingByEmail(sessionId: string, email: string): Promise<ParticipantRow | null> {
  const { rows } = await query<ParticipantRow>(
    `SELECT *
     FROM participants
     WHERE session_id = $1 AND is_removed = FALSE AND lower(email) = lower($2)
     LIMIT 1`,
    [sessionId, email],
  );
  return rows[0] ?? null;
}

export const POST = handler<P>(async (req, { code }) => {
  // Campus Wi-Fi often shares one public IP, so the default is generous. Tune with JOIN_RATE_LIMIT_PER_MIN.
  const perMin = Number(process.env.JOIN_RATE_LIMIT_PER_MIN) || 600;
  rateLimit(`join:${clientIp(req)}`, Math.max(10, perMin / 4), perMin / 60);

  const body = await parseBody(req, joinBody);
  const session = await syncSession(await loadSessionByCode(normalizeJoinCode(code)));
  const quiz = session.quizzes;

  if (session.status !== 'live') {
    throw new HttpError(403, 'closed', 'This quiz is closed.');
  }

  const name = clean(body.name);
  if (name.length < 2 || name.length > 60) {
    throw new HttpError(400, 'invalid_name', 'Name must be 2 to 60 characters.');
  }
  if (isProfane(name)) {
    throw new HttpError(400, 'name_not_allowed', 'Please choose a different name.');
  }

  const rawEmail = (body.email ?? '').trim().toLowerCase();
  let email: string | null = null;
  if (rawEmail) {
    if (!emailSchema.safeParse(rawEmail).success) {
      throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
    }
    email = rawEmail;
  } else if (quiz.email_required) {
    throw new HttpError(400, 'email_required', 'Email is required.');
  }

  let team: string | null = null;
  if (quiz.team_mode === 'list') {
    const picked = (body.team ?? '').trim();
    if (!picked) throw new HttpError(400, 'team_required', 'Please select your team.');
    const allowed = (quiz.teams ?? []).find((t) => t === picked);
    if (!allowed) throw new HttpError(400, 'invalid_team', 'Please choose a valid team from the list.');
    team = allowed;
  } else if (quiz.team_mode === 'free') {
    const typed = clean(body.team ?? '').slice(0, 80);
    if (!typed) throw new HttpError(400, 'team_required', 'Team name is required.');
    if (isProfane(typed)) throw new HttpError(400, 'team_not_allowed', 'Please choose a different team name.');
    team = typed;
  }

  const resolveExisting = async (existing: ParticipantRow) => {
    await finalizeExpiredAttempts(session.id, { participantId: existing.id, snapshot: session.quiz_snapshot });
    const fresh = unwrap<ParticipantRow>(
      await db().from('participants').select('*').eq('id', existing.id).single(),
      'reload participant',
    );
    if (fresh.submitted_at) {
      throw new HttpError(409, 'already_submitted', 'This email has already completed the quiz.');
    }
    // Resume the existing attempt on another device without resetting their timer.
    return {
      participantId: fresh.id,
      deviceToken: fresh.device_token,
      sessionId: session.id,
      resumed: true,
    };
  };

  if (email) {
    const existing = await findExistingByEmail(session.id, email);
    if (existing) return resolveExisting(existing);
  }

  const deviceToken = randomBytes(24).toString('base64url');
  const { data, error } = await db()
    .from('participants')
    .insert({
      session_id: session.id,
      display_name: name,
      email,
      team,
      device_token: deviceToken,
    })
    .select('id')
    .single();

  if (error) {
    // Handle concurrent submit of the same email cleanly via the partial unique index
    if (error.code === '23505' && email) {
      const existing = await findExistingByEmail(session.id, email);
      if (existing) return resolveExisting(existing);
    }
    throw new Error(`join: ${error.message}`);
  }

  return { participantId: data.id as string, deviceToken, sessionId: session.id, resumed: false };
});
