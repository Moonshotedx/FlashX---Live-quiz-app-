import { handler, HttpError } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

/** Replaced by POST /api/admin/sessions/[id]/close. */
export const POST = handler<{ id: string }>(async () => {
  throw new HttpError(410, 'gone', 'Use POST /api/admin/sessions/[id]/close to close a quiz link.');
});
