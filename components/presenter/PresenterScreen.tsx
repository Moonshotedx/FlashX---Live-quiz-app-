'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'framer-motion';
import { LeaderboardReveal, FullLeaderboard, TeamLeaderboard } from './Leaderboard';
import { visibleCount } from '@/lib/reveal';
import type { LeaderboardSummary, RankedRow, RevealMode, SessionStatus, TeamRankRow, Theme } from '@/lib/types';

export interface PresenterData {
  status: SessionStatus;
  quizTitle: string;
  theme: Theme;
  joinCode: string;
  durationSeconds: number;
  showLiveLeaderboard: boolean;
  submitted: number;
  started?: number;
  inProgress?: number;
  leaderboard: RankedRow[];
  teamLeaderboard?: TeamRankRow[];
  summary: LeaderboardSummary | null;
  reveal: { mode: RevealMode; step: number; at: number | null };
}

interface Props {
  data: PresenterData;
  joinUrl: string;
  /** ms since the reveal animation started (auto mode) */
  revealElapsed: number;
  /** effective manual step */
  manualStep: number;
  /** static preview: no confetti, no entrance animation */
  preview?: boolean;
  fullPage?: number;
  fullPages?: number;
}

const shortUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

function Title({ data, small }: { data: PresenterData; small?: boolean }) {
  const title = data.theme.eventTitle || data.quizTitle;
  return (
    <div className={`flex items-center justify-center gap-8 ${small ? 'px-12' : 'px-16'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data.theme.logoUrl && <img src={data.theme.logoUrl} alt="" className="max-h-[110px] max-w-[280px] object-contain" />}
      <h1 className={`text-center font-extrabold leading-tight ${small ? 'text-[72px]' : 'text-[84px]'}`}>{title}</h1>
    </div>
  );
}

function QR({ url, size, label }: { url: string; size: number; label?: string }) {
  // White background + quiet zone so it scans reliably from a distance.
  return (
    <div className="inline-block rounded-[28px] bg-white p-[28px] shadow-2xl">
      <QRCodeSVG value={url} size={size} level="M" marginSize={1} bgColor="#FFFFFF" fgColor="#000000" aria-label={label ?? 'QR code to join'} />
    </div>
  );
}

/**
 * Self-paced Open screen (shown while the link is open, or closed awaiting leaderboard publish).
 * Displays the event title, large QR code, short link, and submitted count — with optional live Top 10 next to the QR.
 */
function OpenScreen({ data, joinUrl, preview }: { data: PresenterData; joinUrl: string; preview?: boolean }) {
  const isClosed = data.status === 'ended';
  const showBoard = data.showLiveLeaderboard && data.leaderboard.length > 0;

  if (showBoard) {
    return (
      <div className="relative h-full w-full">
        <div className="absolute left-0 right-0 top-[34px]">
          <Title data={data} small />
        </div>

        {/* Left: QR + short link + submitted count */}
        <div className="absolute left-[80px] top-[190px] flex w-[680px] flex-col items-center text-center">
          {!isClosed ? (
            <QR url={joinUrl} size={420} />
          ) : (
            <div className="flex h-[476px] w-[476px] flex-col items-center justify-center rounded-[32px] border-4 border-ink/20 bg-ink/10 p-10">
              <div className="text-[110px]">🔒</div>
              <div className="mt-4 text-[52px] font-extrabold leading-tight">Link closed</div>
              <div className="mt-2 text-[28px] opacity-75">In-progress attempts finishing</div>
            </div>
          )}
          <div className="mt-6 text-[42px] font-bold text-accent">{shortUrl(joinUrl)}</div>
          <div className="mt-1 font-mono text-[44px] font-extrabold tracking-[0.18em] opacity-90">{data.joinCode}</div>
          <div className="mt-4 flex items-baseline gap-4 rounded-full bg-ink/10 px-8 py-3">
            <span key={data.submitted} className={`text-[64px] font-extrabold leading-none text-accent ${preview ? '' : 'animate-bump'}`}>
              {data.submitted}
            </span>
            <span className="text-[36px] font-semibold">submitted</span>
          </div>
        </div>

        {/* Right: Live Top 10 updating as submissions arrive */}
        <div className="absolute left-[830px] right-[70px] top-[185px]">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="text-[46px] font-extrabold">Live Top 10</div>
            <div className="text-[26px] font-semibold uppercase tracking-widest opacity-70">Updates on submit</div>
          </div>
          <div className="space-y-[10px]">
            {data.leaderboard.slice(0, 10).map((r) => (
              <motion.div
                layout
                key={r.participantId}
                className="flex h-[72px] items-center gap-5 rounded-2xl border border-ink/15 bg-ink/10 px-6 backdrop-blur"
              >
                <span className="w-[64px] text-[34px] font-extrabold text-accent">#{r.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[30px] font-bold leading-tight">{r.name}</div>
                  {r.team && <div className="truncate text-[19px] leading-tight opacity-75">{r.team}</div>}
                </div>
                <span className="text-[38px] font-extrabold tabular-nums">{r.score}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-0 right-0 top-[44px]">
        <Title data={data} />
      </div>

      <div className="absolute left-[110px] top-[240px]">
        {!isClosed ? (
          <QR url={joinUrl} size={540} />
        ) : (
          <div className="flex h-[596px] w-[596px] flex-col items-center justify-center rounded-[32px] border-4 border-ink/20 bg-ink/10 p-12 text-center">
            <div className="text-[140px]">🔒</div>
            <div className="mt-4 text-[64px] font-extrabold leading-tight">Quiz link closed</div>
            <div className="mt-3 text-[32px] opacity-75">Stand by for the leaderboard!</div>
          </div>
        )}
      </div>

      <div className="absolute left-[820px] right-[80px] top-[250px] flex flex-col gap-[28px]">
        <div className="text-[46px] font-semibold uppercase tracking-[0.22em] opacity-80">
          {isClosed ? 'Submissions closed' : 'Scan to start'}
        </div>
        <div className="break-all text-[58px] font-bold leading-tight text-accent">{shortUrl(joinUrl)}</div>
        <div>
          <div className="text-[34px] opacity-70">Code</div>
          <div className="text-[190px] font-extrabold leading-[1] tracking-[0.12em]">{data.joinCode}</div>
        </div>
        <div className="mt-2 flex items-baseline gap-5">
          <span key={data.submitted} className={`text-[130px] font-extrabold leading-none text-accent ${preview ? '' : 'animate-bump'}`}>
            {data.submitted}
          </span>
          <span className="text-[60px] font-semibold">submitted</span>
        </div>
      </div>
    </div>
  );
}

/** Everything drawn on the 1920x1080 stage, purely from props. */
export function PresenterScreen(p: Props) {
  const { data } = p;
  const title = data.theme.eventTitle || data.quizTitle;

  if (data.status !== 'revealed') {
    return <OpenScreen data={data} joinUrl={p.joinUrl} preview={p.preview} />;
  }

  if (data.reveal.mode === 'teams') {
    return <TeamLeaderboard rows={data.teamLeaderboard ?? []} title={title} />;
  }

  if (data.reveal.mode === 'full') {
    return <FullLeaderboard rows={data.leaderboard} page={p.fullPage ?? 0} pages={p.fullPages ?? 1} title={title} />;
  }

  const n = data.leaderboard.length;
  const count = p.preview ? 99 : visibleCount(data.reveal.mode, p.manualStep, p.revealElapsed, Math.min(n, 10));
  return (
    <LeaderboardReveal
      rows={data.leaderboard.slice(0, 10)}
      count={count}
      summary={data.summary}
      title={title}
      animate={!p.preview}
      confetti={!p.preview}
    />
  );
}

export function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
