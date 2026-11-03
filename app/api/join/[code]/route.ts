import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { clientIp, handler, HttpError, parseBody, rateLimit } from '@/lib/server/api';
import { db, unwrap } from '@/lib/server/db';
import { loadSessionByCode } from '@/lib/server/play';
import { syncSession } from '@/lib/server/session';
import { normalizeJoinCode } from '@/lib/join-code';
import { isProfane } from '@/lib/profanity';

export const dynamic = 'force-dynamic';

type P = { code: string };

/** Public info about a session: status, theme and join settings. Never any questions. */
export const GET = handler<P>(async (req, { code }) => {
  rateLimit(`joininfo:${clientIp(req)}`, 120, 20);
  const session = await syncSession(await loadSessionByCode(normalizeJoinCode(code)));
  const q = session.quizzes;
  return {
    sessionId: session.id,
    status: session.status,
    quizTitle: q.title,
    theme: q.theme,
    rollNumberMode: q.roll_number_mode,
    rollNumberLabel: q.roll_number_label,
    allowLateJoin: q.allow_late_join,
  };
});

const joinBody = z.object({
  name: z.string().max(100),
  rollNumber: z.string().max(60).optional(),
});

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

export const POST = handler<P>(async (req, { code }) => {
  // Campus Wi-Fi often shares one public IP, so the default is generous. Tune with JOIN_RATE_LIMIT_PER_MIN.
  const perMin = Number(process.env.JOIN_RATE_LIMIT_PER_MIN) || 600;
  rateLimit(`join:${clientIp(req)}`, Math.max(10, perMin / 4), perMin / 60);

  const body = await parseBody(req, joinBody);
  const session = await syncSession(await loadSessionByCode(normalizeJoinCode(code)));
  const quiz = session.quizzes;

  if (session.status === 'ended' || session.status === 'revealed') throw new HttpError(403, 'ended', 'This quiz has ended.');
  if (session.status === 'live' && !quiz.allow_late_join) throw new HttpError(403, 'already_started', 'This quiz has already started.');

  const name = clean(body.name);
  if (name.length < 2 || name.length > 30) throw new HttpError(400, 'invalid_name', 'Name must be 2 to 30 characters.');
  if (isProfane(name)) throw new HttpError(400, 'name_not_allowed', 'Please choose a different name.');

  let roll: string | null = null;
  if (quiz.roll_number_mode !== 'off') {
    roll = clean(body.rollNumber ?? '').toUpperCase().slice(0, 30) || null;
    if (quiz.roll_number_mode === 'required' && !roll) throw new HttpError(400, 'roll_required', `${quiz.roll_number_label} is required.`);
    if (roll && quiz.roll_number_mode === 'required') {
      const taken = unwrap<{ id: string }[]>(
        await db().from('participants').select('id').eq('session_id', session.id).eq('is_removed', false).eq('roll_number', roll).limit(1),
        'roll check',
      );
      if (taken.length) throw new HttpError(409, 'roll_taken', 'That roll number has already joined.');
    }
  }

  const deviceToken = randomBytes(24).toString('base64url');
  const row = unwrap<{ id: string }>(
    await db()
      .from('participants')
      .insert({ session_id: session.id, display_name: name, roll_number: roll, device_token: deviceToken })
      .select('id')
      .single(),
    'join',
  );
  return { participantId: row.id, deviceToken, sessionId: session.id };
});
