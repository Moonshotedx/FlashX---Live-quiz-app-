import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/server/auth';
import { db, unwrap } from '@/lib/server/db';
import { QuizList, type QuizItem, type QuizLinkSummary, type SessionItem } from '@/components/admin/QuizList';

export const dynamic = 'force-dynamic';

interface RawSession {
  id: string;
  quiz_id: string;
  join_code: string;
  status: string;
  closes_at: string | null;
  created_at: string;
  quizzes: { title: string };
}

export default async function AdminHome() {
  const admin = await getAdmin();
  if (!admin) redirect('/admin/login');

  const quizzes = unwrap<unknown[]>(
    await db().from('quizzes').select('id,title,updated_at,duration_seconds,questions(count)').order('updated_at', { ascending: false }),
    'quizzes',
  ) as (Omit<QuizItem, 'questionCount' | 'openLinks'> & { questions: { count: number }[] })[];

  const [openRows, recentRows] = (await Promise.all([
    unwrap<unknown[]>(
      await db()
        .from('sessions')
        .select('id,quiz_id,join_code,status,closes_at,created_at,quizzes!inner(title)')
        .eq('status', 'live')
        .order('created_at', { ascending: false }),
      'open sessions',
    ),
    unwrap<unknown[]>(
      await db()
        .from('sessions')
        .select('id,quiz_id,join_code,status,closes_at,created_at,quizzes!inner(title)')
        .order('created_at', { ascending: false })
        .limit(12),
      'recent sessions',
    ),
  ])) as [RawSession[], RawSession[]];

  // Lazy auto-close display normalization if closes_at has passed
  const now = Date.now();
  const effectiveStatus = (s: RawSession) =>
    s.status === 'live' && s.closes_at && now >= new Date(s.closes_at).getTime() ? 'ended' : s.status;

  const allSessionIds = [...new Set([...openRows.map((s) => s.id), ...recentRows.map((s) => s.id)])];
  const submittedCounts = new Map<string, number>();
  if (allSessionIds.length > 0) {
    const submittedRows = unwrap<{ session_id: string }[]>(
      await db()
        .from('participants')
        .select('session_id')
        .in('session_id', allSessionIds)
        .eq('is_removed', false)
        .not('submitted_at', 'is', null),
      'submitted counts',
    );
    for (const r of submittedRows) {
      submittedCounts.set(r.session_id, (submittedCounts.get(r.session_id) ?? 0) + 1);
    }
  }

  const openByQuiz = new Map<string, QuizLinkSummary[]>();
  for (const s of openRows) {
    const st = effectiveStatus(s);
    if (st !== 'live') continue;
    const list = openByQuiz.get(s.quiz_id) ?? [];
    list.push({
      id: s.id,
      joinCode: s.join_code,
      status: st,
      submittedCount: submittedCounts.get(s.id) ?? 0,
      createdAt: s.created_at,
    });
    openByQuiz.set(s.quiz_id, list);
  }

  const items: QuizItem[] = quizzes.map((q) => ({
    id: q.id,
    title: q.title,
    updated_at: q.updated_at,
    duration_seconds: q.duration_seconds,
    questionCount: q.questions?.[0]?.count ?? 0,
    openLinks: openByQuiz.get(q.id) ?? [],
  }));

  const recent: SessionItem[] = recentRows.map((s) => ({
    id: s.id,
    quizId: s.quiz_id,
    joinCode: s.join_code,
    status: effectiveStatus(s),
    submittedCount: submittedCounts.get(s.id) ?? 0,
    createdAt: s.created_at,
    title: s.quizzes.title,
  }));

  return <QuizList quizzes={items} sessions={recent} />;
}
