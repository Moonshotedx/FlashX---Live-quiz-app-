import { fetchParticipants, fetchSessionAnswers, finalizeExpiredAttempts, ranked, type SessionWithQuiz } from './session';
import { rankTeams, summarize } from '../scoring';
import type { LeaderboardSummary, ParticipantRow, RankedRow, Snapshot, TeamRankRow } from '../types';

export interface QuestionStat {
  questionId: string;
  position: number;
  text: string;
  correctText: string;
  answered: number;
  correct: number;
  percentCorrect: number; // of those who answered
  options: { id: string; text: string; count: number; isCorrect: boolean }[];
}

export interface Results {
  snapshot: Snapshot;
  rows: RankedRow[];
  teamRows: TeamRankRow[];
  participants: ParticipantRow[];
  /** participantId -> questionId -> optionId */
  answers: Map<string, Map<string, string>>;
  questionStats: QuestionStat[];
  summary: LeaderboardSummary;
  totalQuestions: number;
}

/** Everything the results table, exports and print view need. Updates live as submissions arrive. */
export async function buildResults(session: SessionWithQuiz): Promise<Results> {
  const snapshot = session.quiz_snapshot ?? { questions: [] };
  await finalizeExpiredAttempts(session.id, { snapshot });
  const [participants, rawAnswers] = await Promise.all([fetchParticipants(session.id), fetchSessionAnswers(session.id)]);
  const submittedIds = new Set(participants.filter((p) => !p.is_removed && !!p.submitted_at).map((p) => p.id));
  const answers = new Map<string, Map<string, string>>();
  for (const a of rawAnswers) {
    if (!submittedIds.has(a.participant_id)) continue;
    const m = answers.get(a.participant_id) ?? new Map<string, string>();
    m.set(a.question_id, a.option_id);
    answers.set(a.participant_id, m);
  }
  const questions = [...snapshot.questions].sort((a, b) => a.position - b.position);
  const questionStats: QuestionStat[] = questions.map((q) => {
    const counts = new Map<string, number>(q.options.map((o) => [o.id, 0]));
    let answered = 0;
    for (const m of answers.values()) {
      const opt = m.get(q.id);
      if (opt && counts.has(opt)) {
        counts.set(opt, (counts.get(opt) ?? 0) + 1);
        answered++;
      }
    }
    const correctOpt = q.options.find((o) => o.is_correct);
    const correct = correctOpt ? counts.get(correctOpt.id) ?? 0 : 0;
    return {
      questionId: q.id,
      position: q.position,
      text: q.text,
      correctText: correctOpt?.text ?? '',
      answered,
      correct,
      percentCorrect: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
      options: [...q.options]
        .sort((a, b) => a.position - b.position)
        .map((o) => ({ id: o.id, text: o.text, count: counts.get(o.id) ?? 0, isCorrect: o.is_correct })),
    };
  });
  const rows = ranked(participants);
  const teamRows = rankTeams(rows);
  return {
    snapshot: { questions },
    rows,
    teamRows,
    participants,
    answers,
    questionStats,
    summary: summarize(rows, questions.length),
    totalQuestions: questions.length,
  };
}

/** Date used in export filenames, in the event time zone. */
export function eventDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.EVENT_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function exportName(title: string, date: string, suffix: string, ext: string) {
  const slug = title.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'quiz';
  return `${slug}_${date}_${suffix}.${ext}`;
}

export function downloadHeaders(filename: string, type: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return {
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  };
}

