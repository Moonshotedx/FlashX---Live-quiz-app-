import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { QuizList, type QuizItem, type SessionItem } from '@/components/admin/QuizList';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const admin = await getAdmin();
  if (!admin) redirect('/admin/login');

  const quizzes = unwrap<unknown[]>(
    await db().from('quizzes').select('id,title,updated_at,duration_seconds,questions(count)').order('updated_at', { ascending: false }),
    'quizzes',
  ) as (Omit<QuizItem, 'questionCount'> & { questions: { count: number }[] })[];

  const sessions = unwrap<unknown[]>(
    await db()
      .from('sessions')
      .select('id,join_code,status,created_at,quizzes!inner(title)')
      .order('created_at', { ascending: false })
      .limit(8),
    'sessions',
  ) as { id: string; join_code: string; status: string; created_at: string; quizzes: { title: string } }[];

  const items: QuizItem[] = quizzes.map((q) => ({
    id: q.id,
    title: q.title,
    updated_at: q.updated_at,
    duration_seconds: q.duration_seconds,
    questionCount: q.questions?.[0]?.count ?? 0,
  }));
  const recent: SessionItem[] = sessions.map((s) => ({
    id: s.id,
    joinCode: s.join_code,
    status: s.status,
    createdAt: s.created_at,
    title: s.quizzes.title,
  }));
  return <QuizList quizzes={items} sessions={recent} />;
}
