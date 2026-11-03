import { handler, HttpError } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { loadOwnedSession, syncSession } from '@/lib/server/session';
import { buildResults, downloadHeaders } from '@/lib/server/results';
import { buildXlsx } from '@/lib/server/exports';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  if (s.status !== 'ended' && s.status !== 'revealed') throw new HttpError(409, 'not_ended', 'Export is available after the quiz ends');
  const { filename, buffer } = await buildXlsx(s, await buildResults(s));
  return new Response(buffer, {
    headers: downloadHeaders(filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  });
});

