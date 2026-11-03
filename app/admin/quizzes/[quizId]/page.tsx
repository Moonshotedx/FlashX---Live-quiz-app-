import { notFound, redirect } from 'next/navigation';
import { getAdmin } from '@/lib/server/auth';
import { loadOwnedQuiz, loadQuestions, toEditable } from '@/lib/server/quizzes';
import { QuizEditor } from '@/components/admin/QuizEditor';

export const dynamic = 'force-dynamic';

export default async function QuizEditorPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const admin = await getAdmin();
  if (!admin) redirect('/admin/login');
  const quiz = await loadOwnedQuiz(quizId, admin.id).catch(() => null);
  if (!quiz) notFound();
  const questions = toEditable(await loadQuestions(quizId));
  return (
    <QuizEditor
      quizId={quiz.id}
      initialTheme={quiz.theme}
      initialQuestions={questions}
      initialSettings={{
        title: quiz.title,
        description: quiz.description,
        duration_seconds: quiz.duration_seconds,
        shuffle_questions: quiz.shuffle_questions,
        shuffle_options: quiz.shuffle_options,
        allow_late_join: quiz.allow_late_join,
        show_live_leaderboard: quiz.show_live_leaderboard,
        show_answers_after_reveal: quiz.show_answers_after_reveal,
        roll_number_mode: quiz.roll_number_mode,
        roll_number_label: quiz.roll_number_label,
      }}
    />
  );
}

