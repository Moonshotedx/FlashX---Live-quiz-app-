'use client';
import { useState } from 'react';
import { ThemeScope } from '@/components/ThemeScope';
import { QuestionScreen } from '@/components/student/QuestionScreen';
import { ScaledStage } from '@/components/presenter/ScaledStage';
import { PresenterScreen, type PresenterData } from '@/components/presenter/PresenterScreen';
import type { EditableQuestion } from '@/lib/validate-quiz';
import type { PublicQuestion, RankedRow, Theme } from '@/lib/types';

export function toPublic(q: EditableQuestion): PublicQuestion {
  return {
    id: q.id,
    text: q.text || 'Your question text appears here',
    imageUrl: q.image_url,
    points: q.points,
    options: q.options.map((o, i) => ({ id: o.id, text: o.text || `Option ${'ABCDEF'[i]}` })),
  };
}

/** A 360x720 phone frame showing a question exactly as a student would see it. */
export function PhonePreview({ theme, question, title }: { theme: Theme; question: EditableQuestion; title?: string }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const pq = toPublic(question);
  return (
    <div className="mx-auto w-[340px] rounded-[38px] border-[10px] border-slate-700 bg-black shadow-2xl">
      <div className="relative h-[640px] overflow-hidden rounded-[28px]">
        <ThemeScope theme={theme} className="h-full overflow-y-auto">
          <QuestionScreen
            compact
            questions={[pq]}
            index={0}
            answers={picked}
            remainingMs={272_000}
            totalMs={300_000}
            saveState="saved"
            onSelect={(q, o) => setPicked({ [q]: o })}
            onJump={() => {}}
            onSubmit={() => {}}
          />
        </ThemeScope>
      </div>
      {title && <p className="sr-only">{title}</p>}
    </div>
  );
}

const MOCK_NAMES = ['Aarav', 'Diya', 'Rahul', 'Sneha', 'Karthik', 'Meera', 'Ishaan', 'Priya', 'Vikram', 'Ananya'];
const MOCK_TEAMS = ['Team Alpha', 'Team Beta', 'Team Gamma', 'Team Delta'];
export const mockRows: RankedRow[] = MOCK_NAMES.map((name, i) => ({
  rank: i + 1,
  participantId: `m${i}`,
  name,
  email: `${name.toLowerCase()}@example.com`,
  team: MOCK_TEAMS[i % MOCK_TEAMS.length],
  rollNumber: null,
  score: 10 - Math.floor(i / 2),
  correctCount: 10 - Math.floor(i / 2),
  timeTakenMs: 61_000 + i * 4_300,
  startedAt: null,
  submittedAt: null,
  autoSubmitted: false,
}));

export type PreviewScreen = 'lobby' | 'live' | 'leaderboard';

/** 16:9 presenter frame with mock data, rendered with the same components as the real LED screen. */
export function PresenterPreview({ theme, screen, title }: { theme: Theme; screen: PreviewScreen; title: string }) {
  const base: PresenterData = {
    status: screen === 'lobby' ? 'lobby' : screen === 'live' ? 'live' : 'revealed',
    quizTitle: title,
    theme,
    joinCode: 'ABC234',
    durationSeconds: 300,
    startedAt: -28_000,
    endsAt: 272_000,
    allowLateJoin: true,
    showLiveLeaderboard: false,
    joined: 132,
    submitted: 87,
    recent: MOCK_NAMES.slice(0, 8).map((name, i) => ({ id: `r${i}`, name })),
    leaderboard: mockRows,
    summary: { total: 132, averageScore: 6.4, highestScore: 10, fastestPerfect: { name: 'Aarav', timeTakenMs: 61_000 } },
    reveal: { mode: 'manual', step: 99, at: 0 },
  };
  return (
    <ThemeScope theme={theme} className="aspect-video w-full overflow-hidden rounded-lg ring-1 ring-slate-700">
      <ScaledStage>
        <PresenterScreen data={base} now={0} joinUrl="https://quiz.example.com/j/ABC234" revealElapsed={0} manualStep={99} rollCollected={false} preview />
      </ScaledStage>
    </ThemeScope>
  );
}

