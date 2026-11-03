import { handler, HttpError } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

/** Host-driven start has been replaced: publishing a link opens it immediately, and each student starts their own timer. */
export const POST = handler<{ id: string }>(async () => {
  throw new HttpError(410, 'gone', 'Links open immediately when published; students start their own timers.');
});
