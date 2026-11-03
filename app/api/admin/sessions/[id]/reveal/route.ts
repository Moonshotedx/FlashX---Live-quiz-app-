import { z } from 'zod';
import { handler, HttpError, parseBody } from '@/lib/server/api';
import { getAdmin, tokenFromRequest, validPresenterToken } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { broadcast, loadSession, syncSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const body = z.object({
  action: z.enum(['start', 'next', 'full', 'replay']).default('start'),
  mode: z.enum(['auto', 'manual']).optional(),
});

/**
 * Reveal controls.
 *  start  - ended -> revealed, plays the sequence (auto) or waits for steps (manual)
 *  next   - manual mode: advance one step (also allowed with the presenter token for Space / Right Arrow)
 *  full   - show the full paged leaderboard
 *  replay - play the sequence again
 */
export const POST = handler<{ id: string }>(async (req, { id }) => {
  const { action, mode } = await parseBody(req, body).catch(() => ({ action: 'start' as const, mode: undefined }));
  const presenterOk = action === 'next' && validPresenterToken(id, tokenFromRequest(req));
  const admin = presenterOk ? null : await getAdmin();
  if (!admin && !presenterOk) throw new HttpError(401, 'unauthorized', 'Admin login required');
  let s = await loadSession(id);
  s = await syncSession(s);

  const update = async (patch: Record<string, unknown>, from: string) => {
    unwrap(await db().from('sessions').update(patch).eq('id', id).eq('status', from), 'reveal');
    await broadcast(id, 'reveal', { ...patch });
  };
  const now = new Date().toISOString();

  if (action === 'start') {
    if (s.status !== 'ended') throw new HttpError(409, 'not_ended', 'The quiz must be ended before revealing');
    await update({ status: 'revealed', reveal_mode: mode ?? 'auto', reveal_step: 0, revealed_at: now }, 'ended');
    return { ok: true };
  }
  if (s.status !== 'revealed') throw new HttpError(409, 'not_revealed', 'Reveal the leaderboard first');
  if (action === 'next') {
    if (s.reveal_mode !== 'manual') throw new HttpError(409, 'not_manual', 'Step by step mode is not active');
    await update({ reveal_step: Math.min(s.reveal_step + 1, 200) }, 'revealed');
  } else if (action === 'full') {
    await update({ reveal_mode: 'full' }, 'revealed');
  } else {
    await update({ reveal_mode: mode ?? 'auto', reveal_step: 0, revealed_at: now }, 'revealed');
  }
  return { ok: true };
});
