import { HttpError } from './api';
import { db, query } from './db';
import type { EditableQuestion } from '../validate-quiz';
import type { QuizRow, Snapshot } from '../types';

/** Load a quiz for a verified admin (all event admins in the workspace share access). */
export async function loadOwnedQuiz(quizId: string, _adminId?: string): Promise<QuizRow> {
  const { data, error } = await db().from('quizzes').select('*').eq('id', quizId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'not_found', 'Quiz not found');
  return data as QuizRow;
}

interface QuestionRowWithOptions {
  id: string;
  position: number;
  text: string;
  image_url: string | null;
  points: number;
  options: { id: string; position: number; text: string; is_correct: boolean }[];
}

/** Questions with their options, ordered. Includes correctness: admin / server only. */
export async function loadQuestions(quizId: string): Promise<QuestionRowWithOptions[]> {
  const { rows } = await query<QuestionRowWithOptions>(
    `SELECT
       q.id,
       q.position,
       q.text,
       q.image_url,
       q.points,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', o.id,
               'position', o.position,
               'text', o.text,
               'is_correct', o.is_correct
             )
             ORDER BY o.position ASC
           )
           FROM options o
           WHERE o.question_id = q.id
         ),
         '[]'::json
       ) AS options
     FROM questions q
     WHERE q.quiz_id = $1
     ORDER BY q.position ASC`,
    [quizId],
  );
  return rows.map((q) => ({ ...q, options: [...q.options].sort((a, b) => a.position - b.position) }));
}

export function toEditable(rows: QuestionRowWithOptions[]): EditableQuestion[] {
  return rows.map((q) => ({
    id: q.id,
    text: q.text,
    image_url: q.image_url,
    points: q.points,
    options: q.options.map((o) => ({ id: o.id, text: o.text, is_correct: o.is_correct })),
  }));
}

export function toSnapshot(rows: QuestionRowWithOptions[]): Snapshot {
  return {
    questions: rows.map((q, i) => ({
      id: q.id,
      position: i + 1,
      text: q.text,
      image_url: q.image_url,
      points: q.points,
      options: q.options.map((o, k) => ({ id: o.id, position: k + 1, text: o.text, is_correct: o.is_correct })),
    })),
  };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
