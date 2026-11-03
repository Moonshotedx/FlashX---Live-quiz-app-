import { handler } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

/** Server clock for client side offset sync. */
export const GET = handler(async () => ({ now: Date.now() }));

