import type { TeamMode } from './types';

export interface EditableOption {
  id: string;
  text: string;
  is_correct: boolean;
}
export interface EditableQuestion {
  id: string;
  text: string;
  image_url: string | null;
  points: number;
  options: EditableOption[];
}
export interface QuizIssue {
  questionIndex: number | null; // null = quiz level
  questionId?: string;
  message: string;
}

/** Rules a quiz must satisfy before a link can be published. */
export function validateQuiz(
  questions: EditableQuestion[],
  opts?: { teamMode?: TeamMode; teams?: string[] },
): QuizIssue[] {
  const issues: QuizIssue[] = [];
  if (questions.length < 1) issues.push({ questionIndex: null, message: 'Add at least 1 question.' });
  if (opts?.teamMode === 'list' && !(opts.teams ?? []).some((t) => t.trim().length > 0)) {
    issues.push({
      questionIndex: null,
      message: 'Add at least 1 team name in Settings (or switch Team field to Off / Free text).',
    });
  }
  questions.forEach((q, i) => {
    const n = i + 1;
    const add = (message: string) => issues.push({ questionIndex: i, questionId: q.id, message: `Question ${n}: ${message}` });
    if (!q.text.trim()) add('the question text is empty.');
    const filled = q.options.filter((o) => o.text.trim());
    if (q.options.length < 2 || filled.length < 2) add('needs at least 2 options with text.');
    if (q.options.length > 6) add('can have at most 6 options.');
    if (q.options.some((o) => !o.text.trim()) && filled.length >= 2) add('has an empty option. Fill it in or remove it.');
    const correct = q.options.filter((o) => o.is_correct).length;
    if (correct !== 1) add(correct === 0 ? 'mark one option as correct.' : 'exactly one option must be correct.');
    if (!Number.isInteger(q.points) || q.points < 0 || q.points > 100) add('points must be a whole number from 0 to 100.');
  });
  return issues;
}

