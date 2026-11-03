import { handler } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { loadOwnedSession, syncSession } from '@/lib/server/session';
import { buildResults, downloadHeaders } from '@/lib/server/results';
import { buildCsv } from '@/lib/server/exports';

export const dynamic = 'force-dynamic';

export const GET = handler<{ id: string }>(async (_req, { id }) => {
  const user = await requireAdmin();
  const s = await syncSession(await loadOwnedSession(id, user.id));
  const { filename, body } = buildCsv(s, await buildResults(s));
  return new Response(body, { headers: downloadHeaders(filename, 'text/csv; charset=utf-8') });
});
