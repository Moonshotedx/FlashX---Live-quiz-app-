import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/server/auth';
import { query } from '@/lib/server/db';
import { QuizList, type QuizItem, type QuizLinkSummary, type SessionItem } from '@/components/admin/QuizList';

export const dynamic = 'force-dynamic';

interface RawQuiz {
  id: string;
  title: string;
  updated_at: string;
  duration_seconds: number;
  question_count: number;
}

interface RawSession {
  id: string;
  quiz_id: string;
  join_code: string;
  status: string;
  closes_at: string | null;
  created_at: string;
  title: string;
  submitted_count: number;
}

export default async function AdminHome() {
  const admin = await getAdmin();
  if (!admin) redirect('/admin/login');

  const [qRes, openRes, recentRes] = await Promise.all([
    query<RawQuiz>(
      `SELECT
         q.id,
         q.title,
         q.updated_at,
         q.duration_seconds,
         (SELECT count(*)::int FROM questions qu WHERE qu.quiz_id = q.id) AS question_count
       FROM quizzes q
       ORDER BY q.updated_at DESC`,
    ),
    query<RawSession>(
      `SELECT
         s.id,
         s.quiz_id,
         s.join_code,
         s.status,
         s.closes_at,
         s.created_at,
         q.title,
         (SELECT count(*)::int FROM participants p WHERE p.session_id = s.id AND p.is_removed = FALSE AND p.submitted_at IS NOT NULL) AS submitted_count
       FROM sessions s
       JOIN quizzes q ON q.id = s.quiz_id
       WHERE s.status = 'live'
       ORDER BY s.created_at DESC`,
    ),
    query<RawSession>(
      `SELECT
         s.id,
         s.quiz_id,
         s.join_code,
         s.status,
         s.closes_at,
         s.created_at,
         q.title,
         (SELECT count(*)::int FROM participants p WHERE p.session_id = s.id AND p.is_removed = FALSE AND p.submitted_at IS NOT NULL) AS submitted_count
       FROM sessions s
       JOIN quizzes q ON q.id = s.quiz_id
       ORDER BY s.created_at DESC
       LIMIT 12`,
    ),
  ]);

  // Lazy auto-close display normalization if closes_at has passed
  const now = Date.now();
  const effectiveStatus = (s: RawSession) =>
    s.status === 'live' && s.closes_at && now >= new Date(s.closes_at).getTime() ? 'ended' : s.status;

  const openByQuiz = new Map<string, QuizLinkSummary[]>();
  for (const s of openRes.rows) {
    const st = effectiveStatus(s);
    if (st !== 'live') continue;
    const list = openByQuiz.get(s.quiz_id) ?? [];
    list.push({
      id: s.id,
      joinCode: s.join_code,
      status: st,
      submittedCount: s.submitted_count,
      createdAt: s.created_at,
    });
    openByQuiz.set(s.quiz_id, list);
  }

  const items: QuizItem[] = qRes.rows.map((q) => ({
    id: q.id,
    title: q.title,
    updated_at: q.updated_at,
    duration_seconds: q.duration_seconds,
    questionCount: q.question_count,
    openLinks: openByQuiz.get(q.id) ?? [],
  }));

  const recent: SessionItem[] = recentRes.rows.map((s) => ({
    id: s.id,
    quizId: s.quiz_id,
    joinCode: s.join_code,
    status: effectiveStatus(s),
    submittedCount: s.submitted_count,
    createdAt: s.created_at,
    title: s.title,
  }));

  return <QuizList quizzes={items} sessions={recent} />;
}
