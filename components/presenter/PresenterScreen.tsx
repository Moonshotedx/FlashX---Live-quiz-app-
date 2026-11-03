'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'framer-motion';
import { LeaderboardReveal, FullLeaderboard } from './Leaderboard';
import { mmss } from '@/lib/client-api';
import { visibleCount } from '@/lib/reveal';
import type { LeaderboardSummary, RankedRow, RevealMode, SessionStatus, Theme } from '@/lib/types';

export interface PresenterData {
  status: SessionStatus;
  quizTitle: string;
  theme: Theme;
  joinCode: string;
  durationSeconds: number;
  startedAt: number | null;
  endsAt: number | null;
  allowLateJoin: boolean;
  showLiveLeaderboard: boolean;
  joined: number;
  submitted: number;
  recent: { id: string; name: string }[];
  leaderboard: RankedRow[];
  summary: LeaderboardSummary | null;
  reveal: { mode: RevealMode; step: number; at: number | null };
}

interface Props {
  data: PresenterData;
  /** server corrected "now" in ms */
  now: number;
  joinUrl: string;
  /** ms since the reveal animation started (auto mode) */
  revealElapsed: number;
  /** effective manual step */
  manualStep: number;
  rollCollected: boolean;
  /** static preview: no confetti, no entrance animation */
  preview?: boolean;
  fullPage?: number;
  fullPages?: number;
}

const shortUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

function Title({ data, small }: { data: PresenterData; small?: boolean }) {
  const title = data.theme.eventTitle || data.quizTitle;
  return (
    <div className={`flex items-center justify-center gap-8 ${small ? '' : 'px-16'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data.theme.logoUrl && <img src={data.theme.logoUrl} alt="" className="max-h-[120px] max-w-[300px] object-contain" />}
      <h1 className="text-center text-[84px] font-extrabold leading-tight">{title}</h1>
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

function Lobby({ data, joinUrl, preview }: { data: PresenterData; joinUrl: string; preview?: boolean }) {
  return (
    <div className="relative h-full w-full">
      <div className="absolute left-0 right-0 top-[44px]">
        <Title data={data} />
      </div>
      <div className="absolute left-[110px] top-[250px]">
        <QR url={joinUrl} size={520} />
      </div>
      <div className="absolute left-[800px] right-[70px] top-[250px] flex flex-col gap-[26px]">
        <div className="text-[48px] font-semibold uppercase tracking-[0.25em] opacity-80">Scan to join</div>
        <div className="text-[60px] font-bold text-accent">{shortUrl(joinUrl)}</div>
        <div>
          <div className="text-[34px] opacity-70">Or enter code</div>
          <div className="text-[210px] font-extrabold leading-[1] tracking-[0.12em]">{data.joinCode}</div>
        </div>
        <div className="flex items-baseline gap-5">
          <span key={data.joined} className={`text-[120px] font-extrabold leading-none text-accent ${preview ? '' : 'animate-bump'}`}>
            {data.joined}
          </span>
          <span className="text-[56px] font-semibold">{data.joined === 1 ? 'student joined' : 'students joined'}</span>
        </div>
      </div>
      <FloatingNames names={data.recent} />
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Last 20 joined names drifting along the bottom for energy. */
function FloatingNames({ names }: { names: { id: string; name: string }[] }) {
  return (
    <div className="pointer-events-none absolute bottom-[24px] left-0 right-0 h-[170px] overflow-hidden">
      <AnimatePresence>
        {names.slice(0, 20).map((n, i) => {
          const h = hash(n.id);
          const left = 40 + ((h % 1000) / 1000) * 1560;
          const top = 10 + (((h >> 8) % 100) / 100) * 100;
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, scale: 0.4, y: 50 }}
              animate={{ opacity: 0.95, scale: 1, y: [0, -14, 0] }}
              exit={{ opacity: 0 }}
              transition={{ opacity: { duration: 0.4 }, scale: { type: 'spring' }, y: { duration: 3 + (i % 4), repeat: Infinity, ease: 'easeInOut' } }}
              className="absolute whitespace-nowrap rounded-full bg-ink/15 px-8 py-3 text-[38px] font-semibold backdrop-blur"
              style={{ left, top }}
            >
              {n.name}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function Live({ data, now, joinUrl }: { data: PresenterData; now: number; joinUrl: string }) {
  const remaining = data.endsAt ? data.endsAt - now : 0;
  const total = Math.max(1, (data.endsAt ?? 0) - (data.startedAt ?? 0));
  const frac = Math.max(0, Math.min(1, remaining / total));
  const last10 = remaining <= 10_000;
  const warn = remaining <= 60_000;
  const color = last10 ? 'rgb(var(--wrong-rgb))' : warn ? '#F59E0B' : 'rgb(var(--accent-rgb))';
  const R = 300;
  const C = 2 * Math.PI * R;
  const subPct = data.joined ? Math.round((data.submitted / data.joined) * 100) : 0;
  const board = data.showLiveLeaderboard && data.leaderboard.length > 0;

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-0 right-0 top-[34px]">
        <Title data={data} small />
      </div>
      <div className={`absolute top-[200px] ${board ? 'left-[60px]' : 'left-[180px]'}`}>
        <div className={`relative h-[720px] w-[720px] ${last10 ? 'animate-[bump_1s_ease-in-out_infinite]' : ''}`}>
          <svg viewBox="0 0 720 720" className="absolute inset-0 -rotate-90">
            <circle cx="360" cy="360" r={R} fill="none" stroke="rgb(var(--text-rgb) / .15)" strokeWidth="38" />
            <circle cx="360" cy="360" r={R} fill="none" stroke={color} strokeWidth="38" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset .25s linear, stroke .3s' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[240px] font-extrabold leading-none tabular-nums" style={{ color }}>
              {mmss(Math.max(0, remaining))}
            </div>
            <div className="mt-2 text-[40px] font-semibold uppercase tracking-[0.3em] opacity-70">{last10 ? 'Hurry!' : 'Time left'}</div>
          </div>
        </div>
      </div>

      {board ? (
        <div className="absolute left-[860px] right-[60px] top-[190px]">
          <div className="mb-4 text-[44px] font-bold">Live top 10</div>
          <div className="space-y-[8px]">
            {data.leaderboard.slice(0, 10).map((r) => (
              <motion.div layout key={r.participantId} className="flex h-[62px] items-center gap-5 rounded-2xl bg-ink/10 px-5 text-[34px] font-semibold">
                <span className="w-[56px] text-accent">#{r.rank}</span>
                <span className="flex-1 truncate">{r.name}</span>
                <span className="font-extrabold">{r.score}</span>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="absolute left-[960px] right-[100px] top-[300px]">
          <div className="text-[64px] font-semibold opacity-80">Submitted</div>
          <div className="mt-2 text-[150px] font-extrabold leading-none text-accent">
            {data.submitted} <span className="text-[70px] opacity-70">of {data.joined}</span>
          </div>
        </div>
      )}

      <div className={`absolute bottom-[70px] ${board ? 'left-[860px]' : 'left-[960px]'} ${data.allowLateJoin ? 'right-[330px]' : 'right-[100px]'}`}>
        {board && (
          <div className="mb-2 text-[40px] font-semibold">
            {data.submitted} of {data.joined} submitted
          </div>
        )}
        <div className="h-[40px] w-full overflow-hidden rounded-full bg-ink/15">
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${subPct}%` }} />
        </div>
      </div>

      {data.allowLateJoin && (
        <div className="absolute bottom-[34px] right-[44px] text-center">
          <QR url={joinUrl} size={170} />
          <div className="mt-2 text-[34px] font-bold tracking-widest">{data.joinCode}</div>
        </div>
      )}
    </div>
  );
}

function Ended({ title }: { title: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 3200);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center text-center">
      <div className="mb-4 text-[38px] font-semibold uppercase tracking-[0.35em] opacity-70">{title}</div>
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 120 }} className="text-[200px] font-extrabold leading-none">
        ⏰ Time is up
      </motion.div>
      <AnimatePresence mode="wait">
        {!ready ? (
          <motion.div key="calc" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="mt-12 flex items-center gap-6 text-[64px] font-semibold opacity-90">
            Calculating results
            <span className="flex gap-3">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="inline-block h-[24px] w-[24px] rounded-full bg-accent" animate={{ y: [0, -28, 0] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }} />
              ))}
            </span>
          </motion.div>
        ) : (
          <motion.div key="wait" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-12 text-[60px] font-bold text-accent">
            ✨ Scores locked in — get ready for the leaderboard!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Everything drawn on the 1920x1080 stage, purely from props. */
export function PresenterScreen(p: Props) {
  const { data } = p;
  const timeUp = data.status === 'live' && data.endsAt !== null && p.now >= data.endsAt;
  const n = data.leaderboard.length;

  if (data.status === 'lobby') return <Lobby data={data} joinUrl={p.joinUrl} preview={p.preview} />;
  if (data.status === 'live' && !timeUp) return <Live data={data} now={p.now} joinUrl={p.joinUrl} />;
  if (data.status === 'live' || data.status === 'ended') return <Ended title={data.theme.eventTitle || data.quizTitle} />;
  // revealed
  if (data.reveal.mode === 'full') {
    return <FullLeaderboard rows={data.leaderboard} page={p.fullPage ?? 0} pages={p.fullPages ?? 1} title={data.theme.eventTitle || data.quizTitle} collectRoll={p.rollCollected} />;
  }
  const count = p.preview ? 99 : visibleCount(data.reveal.mode, p.manualStep, p.revealElapsed, Math.min(n, 10));
  return (
    <LeaderboardReveal
      rows={data.leaderboard.slice(0, 10)}
      count={count}
      summary={data.summary}
      title={data.theme.eventTitle || data.quizTitle}
      collectRoll={p.rollCollected}
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
