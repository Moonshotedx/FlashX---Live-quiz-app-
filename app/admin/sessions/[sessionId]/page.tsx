import { notFound, redirect } from 'next/navigation';
import { getAdmin, presenterToken } from '@/lib/server/auth';
import { loadOwnedSession } from '@/lib/server/session';
import { ControlRoom } from '@/components/admin/ControlRoom';

export const dynamic = 'force-dynamic';

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const admin = await getAdmin();
  if (!admin) redirect('/admin/login');
  const s = await loadOwnedSession(sessionId, admin.id).catch(() => null);
  if (!s) notFound();
  return (
    <ControlRoom
      sessionId={s.id}
      joinCode={s.join_code}
      quizId={s.quiz_id}
      quizTitle={s.quizzes.title}
      presenterToken={presenterToken(s.id)}
      appUrl={process.env.NEXT_PUBLIC_APP_URL || ''}
      rollMode={s.quizzes.roll_number_mode}
    />
  );
}

