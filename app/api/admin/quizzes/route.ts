import { z } from 'zod';
import { handler, parseBody } from '@/lib/server/api';
import { requireAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { PRESETS } from '@/lib/theme';
import type { QuizRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const body = z.object({ title: z.string().trim().min(1).max(120).optional() });

/** Create an empty quiz with the Neon Dark theme. */
export const POST = handler(async (req) => {
  const user = await requireAdmin();
  const { title } = await parseBody(req, body).catch(() => ({ title: undefined }));
  const quiz = unwrap(
    await db()
      .from('quizzes')
      .insert({ owner_id: user.id, title: title ?? 'Untitled quiz', theme: PRESETS['neon-dark'] })
      .select('*')
      .single(),
    'create quiz',
  ) as QuizRow;
  return quiz;
});

