import { handler, HttpError } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

/** Shared timer extension has been removed in self-paced mode. */
export const POST = handler<{ id: string }>(async () => {
  throw new HttpError(410, 'gone', 'Shared session timer extension is not used in self-paced mode.');
});
