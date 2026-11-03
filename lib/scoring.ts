import type { LeaderboardSummary, ParticipantRow, RankedRow, Snapshot, TeamRankRow } from './types';

export const GRACE_MS = 3000;

/** Score a participant's answers against the frozen snapshot. Server side only. */
export function scoreAnswers(snapshot: Snapshot, answers: { question_id: string; option_id: string }[]) {
  const byQuestion = new Map(snapshot.questions.map((q) => [q.id, q]));
  let score = 0;
  let correct = 0;
  const seen = new Set<string>();
  for (const a of answers) {
    if (seen.has(a.question_id)) continue; // one answer per question
    seen.add(a.question_id);
    const q = byQuestion.get(a.question_id);
    const opt = q?.options.find((o) => o.id === a.option_id);
    if (q && opt?.is_correct) {
      score += q.points;
      correct += 1;
    }
  }
  return { score, correct };
}

/** True when a participant has pressed Start, has not submitted yet, and is within their personal timer + grace. */
export function attemptOpen(
  p: Pick<ParticipantRow, 'started_at' | 'ends_at' | 'submitted_at'> & { is_removed?: boolean },
  now = Date.now(),
): boolean {
  if (p.is_removed || !p.started_at || !p.ends_at || p.submitted_at) return false;
  return now <= new Date(p.ends_at).getTime() + GRACE_MS;
}

/** Personal attempt duration: submitted_at - participant.started_at. */
export function timeTakenMs(submittedAt: string | Date, participantStartedAt: string | Date) {
  return Math.max(0, new Date(submittedAt).getTime() - new Date(participantStartedAt).getTime());
}

type Rankable = Pick<
  ParticipantRow,
  'id' | 'display_name' | 'roll_number' | 'score' | 'correct_count' | 'time_taken_ms' | 'submitted_at' | 'auto_submitted' | 'joined_at'
> &
  Partial<Pick<ParticipantRow, 'email' | 'team' | 'started_at'>>;

/**
 * Order: score desc, time asc, submitted_at asc. Ranks are unique (1, 2, 3...).
 * Duplicate display names get a short suffix, "Rahul", "Rahul (2)", in join order.
 */
export function rankParticipants(list: Rankable[]): RankedRow[] {
  const nameOrder = [...list].sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  const label = new Map<string, string>();
  for (const p of nameOrder) {
    const key = p.display_name.trim().toLowerCase();
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    label.set(p.id, n === 1 ? p.display_name : `${p.display_name} (${n})`);
  }
  const t = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);
  const s = (v: string | null) => (v === null ? Number.POSITIVE_INFINITY : new Date(v).getTime());
  const sorted = [...list].sort(
    (a, b) =>
      b.score - a.score ||
      t(a.time_taken_ms) - t(b.time_taken_ms) ||
      s(a.submitted_at) - s(b.submitted_at) ||
      a.id.localeCompare(b.id),
  );
  return sorted.map((p, i) => ({
    rank: i + 1,
    participantId: p.id,
    name: label.get(p.id) ?? p.display_name,
    email: p.email ?? null,
    team: p.team ?? null,
    rollNumber: p.roll_number,
    score: p.score,
    correctCount: p.correct_count,
    timeTakenMs: p.time_taken_ms,
    startedAt: p.started_at ?? null,
    submittedAt: p.submitted_at,
    autoSubmitted: p.auto_submitted,
  }));
}

export function summarize(rows: RankedRow[], totalQuestions: number): LeaderboardSummary {
  const total = rows.length;
  const sum = rows.reduce((a, r) => a + r.score, 0);
  const perfect = rows
    .filter((r) => totalQuestions > 0 && r.correctCount === totalQuestions && r.timeTakenMs !== null)
    .sort((a, b) => (a.timeTakenMs ?? 0) - (b.timeTakenMs ?? 0))[0];
  return {
    total,
    averageScore: total ? Math.round((sum / total) * 10) / 10 : 0,
    highestScore: rows.reduce((m, r) => Math.max(m, r.score), 0),
    fastestPerfect: perfect ? { name: perfect.name, timeTakenMs: perfect.timeTakenMs ?? 0 } : null,
  };
}

/**
 * Aggregate submitted individual rankings by team.
 * Ranked by average score desc, tie-broken by total score desc, then team name asc.
 */
export function rankTeams(rows: RankedRow[]): TeamRankRow[] {
  const groups = new Map<
    string,
    { label: string; membersSubmitted: number; totalScore: number; bestIndividual: { name: string; score: number } | null }
  >();
  for (const r of rows) {
    const raw = r.team?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const g = groups.get(key) ?? { label: raw, membersSubmitted: 0, totalScore: 0, bestIndividual: null };
    g.membersSubmitted += 1;
    g.totalScore += r.score;
    // `rows` is already ordered best-first by rankParticipants, so the first member seen is best on score + tie-breakers.
    if (!g.bestIndividual || r.score > g.bestIndividual.score) {
      g.bestIndividual = { name: r.name, score: r.score };
    }
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => {
    const avgA = a.totalScore / a.membersSubmitted;
    const avgB = b.totalScore / b.membersSubmitted;
    return avgB - avgA || b.totalScore - a.totalScore || a.label.localeCompare(b.label);
  });
  return sorted.map((g, i) => ({
    rank: i + 1,
    team: g.label,
    membersSubmitted: g.membersSubmitted,
    totalScore: g.totalScore,
    averageScore: Math.round((g.totalScore / g.membersSubmitted) * 100) / 100,
    bestIndividual: g.bestIndividual,
  }));
}

