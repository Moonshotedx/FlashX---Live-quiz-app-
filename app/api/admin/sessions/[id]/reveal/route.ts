import { z } from 'zod';
import { handler, HttpError, parseBody } from '@/lib/server/api';
import { getAdmin, tokenFromRequest, validPresenterToken } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { broadcast, finalizeExpiredAttempts, loadSession, syncSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const body = z.object({
  action: z.enum(['start', 'next', 'full', 'teams', 'replay']).default('start'),
  mode: z.enum(['auto', 'manual']).optional(),
});

/**
 * Publish results & control the presenter leaderboard:
 *  start  - ended -> revealed, plays the reveal sequence (auto) or waits for steps (manual)
 *  next   - manual mode: advance one step (also allowed with the presenter token for Space / Right Arrow)
 *  full   - show the full paged leaderboard
 *  teams  - show the team leaderboard on the presenter screen
 *  replay - play the reveal sequence again
 *
 * Still-running attempts are NOT forced to submit; they appear once they submit or expire.
 */
export const POST = handler<{ id: string }>(async (req, { id }) => {
  const { action, mode } = await parseBody(req, body).catch(() => ({ action: 'start' as const, mode: undefined }));
  const presenterOk = (action === 'next' || action === 'teams' || action === 'full') && validPresenterToken(id, tokenFromRequest(req));
  const admin = presenterOk ? null : await getAdmin();
  if (!admin && !presenterOk) throw new HttpError(401, 'unauthorized', 'Admin login required');
  let s = await loadSession(id);
  s = await syncSession(s);
  await finalizeExpiredAttempts(id, { snapshot: s.quiz_snapshot });

  const update = async (patch: Record<string, unknown>, from: string) => {
    unwrap(await db().from('sessions').update(patch).eq('id', id).eq('status', from), 'reveal');
    await broadcast(id, 'reveal', { ...patch });
  };
  const now = new Date().toISOString();

  if (action === 'start') {
    if (s.status !== 'ended') throw new HttpError(409, 'not_ended', 'Close the link before publishing results');
    await update({ status: 'revealed', reveal_mode: mode ?? 'auto', reveal_step: 0, revealed_at: now }, 'ended');
    return { ok: true };
  }
  if (s.status !== 'revealed') throw new HttpError(409, 'not_revealed', 'Publish results first');
  if (action === 'next') {
    if (s.reveal_mode !== 'manual') throw new HttpError(409, 'not_manual', 'Step by step mode is not active');
    await update({ reveal_step: Math.min(s.reveal_step + 1, 200) }, 'revealed');
  } else if (action === 'full') {
    await update({ reveal_mode: 'full' }, 'revealed');
  } else if (action === 'teams') {
    await update({ reveal_mode: 'teams' }, 'revealed');
  } else {
    await update({ reveal_mode: mode ?? 'auto', reveal_step: 0, revealed_at: now }, 'revealed');
  }
  return { ok: true };
});
