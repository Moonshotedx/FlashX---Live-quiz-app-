import { handler, HttpError, rateLimit } from '@/lib/server/api';
import { db, unwrap } from '@/lib/server/db';
import { deviceToken, playContext } from '@/lib/server/play';
import { normalizeJoinCode } from '@/lib/join-code';

export const dynamic = 'force-dynamic';

/**
 * Start the participant's personal timer (`started_at = now()`, `ends_at = now() + duration_seconds`).
 * Atomic with `.is('started_at', null)` so a double tap or second device can never reset the timer.
 */
export const POST = handler<{ code: string }>(async (req, { code }) => {
  const token = deviceToken(req);
  if (token) rateLimit(`begin:${token}`, 6, 1);

  const { participant, session } = await playContext(normalizeJoinCode(code), token);
  if (participant.is_removed) throw new HttpError(403, 'removed', 'You have been removed');

  // Idempotent if already started
  if (participant.started_at && participant.ends_at) {
    return {
      startedAt: new Date(participant.started_at).getTime(),
      endsAt: new Date(participant.ends_at).getTime(),
      serverNow: Date.now(),
    };
  }

  if (session.status !== 'live') {
    throw new HttpError(403, 'closed', 'This quiz is closed.');
  }

  const now = new Date();
  const ends = new Date(now.getTime() + session.duration_seconds * 1000);
  const { data, error } = await db()
    .from('participants')
    .update({ started_at: now.toISOString(), ends_at: ends.toISOString() })
    .eq('id', participant.id)
    .is('started_at', null)
    .select('started_at, ends_at')
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (data) {
    return {
      startedAt: new Date(data.started_at as string).getTime(),
      endsAt: new Date(data.ends_at as string).getTime(),
      serverNow: Date.now(),
    };
  }

  // Concurrent double tap: return the winner's timestamps without resetting.
  const existing = unwrap<{ started_at: string; ends_at: string }>(
    await db().from('participants').select('started_at, ends_at').eq('id', participant.id).single(),
    'begin reload',
  );
  return {
    startedAt: new Date(existing.started_at).getTime(),
    endsAt: new Date(existing.ends_at).getTime(),
    serverNow: Date.now(),
  };
});
