/**
 * Session (`sessions` table) acts as a shareable self-paced quiz link:
 * - `lobby`:    Unused for new links (kept for DB check-constraint compatibility).
 * - `live`:     Link is Open. New students can join and start their personal timer.
 * - `ended`:    Link is Closed. New students cannot join/start; in-progress attempts can finish within their timer.
 * - `revealed`: Closed and Results published. Students see score/rank; presenter can show the leaderboard.
 */
export type SessionStatus = 'lobby' | 'live' | 'ended' | 'revealed';
export type RollMode = 'off' | 'optional' | 'required';
export type TeamMode = 'off' | 'list' | 'free';
export type ScoreVisibility = 'immediate' | 'after_publish' | 'never';
export type RevealMode = 'auto' | 'manual' | 'full' | 'teams';
export type StudentPhase = 'details' | 'ready' | 'answering' | 'submitted' | 'results' | 'closed' | 'removed';

export interface Theme {
  preset: string;
  eventTitle: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  backgroundType: 'solid' | 'gradient' | 'image';
  /** solid: a colour. gradient: a css gradient (built from gradientFrom/To). image: image url. */
  backgroundValue: string;
  gradientFrom: string;
  gradientTo: string;
  /** 0-100, dark overlay on uploaded background images */
  overlay: number;
  textColor: string;
  fontFamily: FontName;
  correctColor: string;
  wrongColor: string;
}

export type FontName = 'Poppins' | 'Inter' | 'Montserrat' | 'Space Grotesk' | 'Outfit';

export interface QuizRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  duration_seconds: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  allow_late_join: boolean;
  show_live_leaderboard: boolean;
  show_answers_after_reveal: boolean;
  roll_number_mode: RollMode;
  roll_number_label: string;
  team_mode: TeamMode;
  teams: string[];
  email_required: boolean;
  score_visibility: ScoreVisibility;
  theme: Partial<Theme>;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  quiz_id: string;
  join_code: string;
  status: SessionStatus;
  duration_seconds: number;
  started_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  closes_at: string | null;
  quiz_snapshot: Snapshot | null;
  revealed_at: string | null;
  reveal_mode: RevealMode;
  reveal_step: number;
  created_at: string;
}

export interface ParticipantRow {
  id: string;
  session_id: string;
  display_name: string;
  email: string | null;
  team: string | null;
  roll_number: string | null;
  device_token: string;
  joined_at: string;
  started_at: string | null;
  ends_at: string | null;
  submitted_at: string | null;
  auto_submitted: boolean;
  score: number;
  correct_count: number;
  time_taken_ms: number | null;
  is_removed: boolean;
}

export interface AnswerRow {
  id: string;
  participant_id: string;
  question_id: string;
  option_id: string;
  is_correct: boolean;
  answered_at: string;
}

/** Frozen copy of the quiz taken when the link is published. Contains correct answers: server only. */
export interface SnapshotQuestion {
  id: string;
  position: number;
  text: string;
  image_url: string | null;
  points: number;
  options: { id: string; position: number; text: string; is_correct: boolean }[];
}
export interface Snapshot {
  questions: SnapshotQuestion[];
}

/** What a participant is allowed to see while answering (no correctness info). */
export interface PublicQuestion {
  id: string;
  text: string;
  imageUrl: string | null;
  points: number;
  options: { id: string; text: string }[];
}

export interface RankedRow {
  rank: number;
  participantId: string;
  name: string; // with " (2)" style suffix for duplicate names
  email: string | null;
  team: string | null;
  rollNumber: string | null;
  score: number;
  correctCount: number;
  timeTakenMs: number | null;
  startedAt: string | null;
  submittedAt: string | null;
  autoSubmitted: boolean;
}

export interface TeamRankRow {
  rank: number;
  team: string;
  membersSubmitted: number;
  totalScore: number;
  averageScore: number;
  bestIndividual: { name: string; score: number } | null;
}

export interface LeaderboardSummary {
  total: number;
  averageScore: number;
  highestScore: number;
  /** fastest participant who answered every question correctly, if any */
  fastestPerfect: { name: string; timeTakenMs: number } | null;
}

