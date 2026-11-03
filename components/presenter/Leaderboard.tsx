'use client';
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { revealPlan } from '@/lib/reveal';
import { formatDuration } from '@/lib/client-api';
import type { LeaderboardSummary, RankedRow, TeamRankRow } from '@/lib/types';

const MEDAL = {
  1: { label: 'GOLD', bg: 'linear-gradient(180deg,#FDE68A,#F59E0B 55%,#B45309)', glow: '#FBBF24', crown: '👑' },
  2: { label: 'SILVER', bg: 'linear-gradient(180deg,#F1F5F9,#94A3B8 55%,#475569)', glow: '#CBD5E1', crown: '🥈' },
  3: { label: 'BRONZE', bg: 'linear-gradient(180deg,#FDBA74,#C2410C 55%,#7C2D12)', glow: '#FB923C', crown: '🥉' },
} as const;
const PILLAR_H = { 1: 470, 2: 360, 3: 270 } as const;

function fireConfetti() {
  import('canvas-confetti').then(({ default: confetti }) => {
    const end = Date.now() + 2500;
    const colors = ['#FBBF24', '#F472B6', '#22D3EE', '#A78BFA', '#34D399'];
    confetti({ particleCount: 160, spread: 100, origin: { x: 0.7, y: 0.55 }, colors, zIndex: 100 });
    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.8 }, colors, zIndex: 100 });
      confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.8 }, colors, zIndex: 100 });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  });
}

function Row({ row }: { row: RankedRow }) {
  const subtitle = row.team || null;
  return (
    <div className="flex h-[88px] items-center gap-6 rounded-3xl border-2 border-ink/20 bg-ink/10 px-7 shadow-xl backdrop-blur">
      <div className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full bg-primary text-[36px] font-extrabold text-white">
        {row.rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate font-bold leading-tight ${subtitle ? 'text-[36px]' : 'text-[42px]'}`}>{row.name}</div>
        {subtitle && <div className="truncate text-[22px] leading-tight opacity-75">{subtitle}</div>}
      </div>
      <div className="text-right">
        <div className="text-[48px] font-extrabold leading-none text-accent">{row.score}</div>
        <div className="text-[24px] leading-tight opacity-70">{formatDuration(row.timeTakenMs, true)}</div>
      </div>
    </div>
  );
}

function PodiumPlace({
  rank,
  row,
  shown,
  drumroll,
  animate,
}: {
  rank: 1 | 2 | 3;
  row?: RankedRow;
  shown: boolean;
  drumroll: boolean;
  animate: boolean;
}) {
  const m = MEDAL[rank];
  const h = PILLAR_H[rank];
  if (!row) return <div style={{ width: 300 }} />;
  return (
    <div className="relative flex flex-col items-center justify-end" style={{ width: 300, height: 760 }}>
      <AnimatePresence>
        {shown && (
          <motion.div
            key="card"
            initial={animate ? { opacity: 0, y: 60, scale: 0.8 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: animate ? 0.45 : 0, type: 'spring', stiffness: 160, damping: 14 }}
            className="mb-5 w-[330px] text-center"
          >
            <div className="text-[64px] leading-none">{m.crown}</div>
            <div className="mt-1 truncate text-[44px] font-extrabold leading-tight">{row.name}</div>
            {row.team && <div className="truncate text-[24px] opacity-75">{row.team}</div>}
            <div className="mt-1 text-[52px] font-extrabold leading-none" style={{ color: m.glow }}>
              {row.score} <span className="text-[26px] opacity-80">pts</span>
            </div>
            <div className="text-[26px] opacity-70">{formatDuration(row.timeTakenMs, true)}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative w-full" style={{ height: h }}>
        {drumroll && !shown && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center rounded-t-3xl border-4 border-dashed border-ink/40 bg-ink/10 text-[120px] font-extrabold"
            animate={{ x: [-6, 6, -5, 5, -3, 3, 0], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          >
            ?
          </motion.div>
        )}
        {shown && (
          <motion.div
            initial={animate ? { scaleY: 0 } : false}
            animate={{ scaleY: 1 }}
            transition={{ type: 'spring', stiffness: 110, damping: 15 }}
            style={{ originY: 1, background: m.bg, boxShadow: `0 0 90px ${m.glow}88` }}
            className="absolute inset-0 flex items-start justify-center rounded-t-3xl pt-6"
          >
            <span className="text-[150px] font-extrabold leading-none text-black/70">{rank}</span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** Top-10 reveal: ranks 10..4 slide in, then the podium rises 3rd, 2nd, 1st, then confetti. */
export function LeaderboardReveal({
  rows,
  count,
  summary,
  title,
  animate = true,
  confetti = true,
}: {
  rows: RankedRow[];
  count: number; // visible items of the plan
  summary: LeaderboardSummary | null;
  title: string;
  animate?: boolean;
  confetti?: boolean;
}) {
  const n = rows.length;
  const { listRanks, podiumRanks, seq } = revealPlan(n);
  const visible = new Set(seq.slice(0, count));
  const listDone = listRanks.every((r) => visible.has(r));
  const nextRank = seq[count];
  const fired = useRef(false);
  const winnerShown = visible.has(1);

  useEffect(() => {
    if (winnerShown && !fired.current && confetti) {
      fired.current = true;
      fireConfetti();
    }
    if (!winnerShown) fired.current = false;
  }, [winnerShown, confetti]);

  const byRank = (r: number) => rows.find((x) => x.rank === r);
  const allDone = count >= seq.length;
  const ranksAsc = [...listRanks].sort((a, b) => a - b);

  if (!n) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-[110px] font-extrabold">No submissions yet</div>
        <div className="mt-4 text-[44px] opacity-70">{title}</div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-0 right-0 top-[36px] text-center">
        <div className="text-[34px] font-semibold uppercase tracking-[0.4em] opacity-70">{title}</div>
        <div className="text-[96px] font-extrabold leading-none">🏆 Leaderboard</div>
      </div>

      {ranksAsc.length > 0 && (
        <div className="absolute left-[70px] top-[195px] flex w-[930px] flex-col gap-[12px]">
          {ranksAsc.map((rank) => {
            const row = byRank(rank);
            const shown = visible.has(rank) && row;
            return (
              <div key={rank} className="h-[88px]">
                <AnimatePresence>
                  {shown && row && (
                    <motion.div
                      key={row.participantId}
                      initial={animate ? { y: 180, opacity: 0 } : false}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 130, damping: 16 }}
                    >
                      <Row row={row} />
                    </motion.div>
                  )}
                </AnimatePresence>
                {!shown && <div className="h-[88px] rounded-3xl border-2 border-dashed border-ink/15" />}
              </div>
            );
          })}
        </div>
      )}

      <div
        className="absolute top-[150px] flex items-end justify-center gap-6"
        style={ranksAsc.length ? { left: 1030, width: 880 } : { left: 0, right: 0 }}
      >
        {([2, 1, 3] as const).map((rank) => {
          if (!podiumRanks.includes(rank)) return null;
          return (
            <PodiumPlace
              key={rank}
              rank={rank}
              row={byRank(rank)}
              shown={visible.has(rank)}
              drumroll={(listDone || !listRanks.length) && nextRank === rank}
              animate={animate}
            />
          );
        })}
      </div>

      <AnimatePresence>
        {allDone && summary && (
          <motion.div
            initial={animate ? { y: 80, opacity: 0 } : false}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: animate ? 1.2 : 0 }}
            className="absolute bottom-[26px] left-[70px] right-[70px] flex items-center justify-around rounded-3xl bg-ink/10 py-4 backdrop-blur"
          >
            <Stat label="Submitted" value={String(summary.total)} />
            <Stat label="Average score" value={String(summary.averageScore)} />
            <Stat label="Highest score" value={String(summary.highestScore)} />
            <Stat
              label="Fastest perfect"
              value={summary.fastestPerfect ? `${formatDuration(summary.fastestPerfect.timeTakenMs, true)}` : '–'}
              sub={summary.fastestPerfect?.name}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-[24px] font-semibold uppercase tracking-widest opacity-70">{label}</div>
      <div className="text-[52px] font-extrabold leading-tight text-accent">{value}</div>
      {sub && <div className="max-w-[300px] truncate text-[22px] opacity-70">{sub}</div>}
    </div>
  );
}

/** Auto scrolling full leaderboard, 15 per page (two columns). */
export function FullLeaderboard({
  rows,
  page,
  pages,
  title,
}: {
  rows: RankedRow[];
  page: number;
  pages: number;
  title: string;
}) {
  const slice = rows.slice(page * 15, page * 15 + 15);
  const left = slice.slice(0, 8);
  const right = slice.slice(8);
  return (
    <div className="relative h-full w-full">
      <div className="absolute left-0 right-0 top-[30px] text-center">
        <div className="text-[30px] font-semibold uppercase tracking-[0.4em] opacity-70">{title}</div>
        <div className="text-[84px] font-extrabold leading-none">Full leaderboard</div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={page}
          initial={{ opacity: 0, x: 120 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -120 }}
          transition={{ duration: 0.5 }}
          className="absolute left-[60px] right-[60px] top-[190px] grid grid-cols-2 gap-x-8"
        >
          {[left, right].map((col, i) => (
            <div key={i} className="flex flex-col gap-[12px]">
              {col.map((r) => (
                <Row key={r.participantId} row={r} />
              ))}
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
      <div className="absolute bottom-[24px] left-0 right-0 text-center text-[32px] opacity-70">
        Page {page + 1} of {pages} · {rows.length} submitted
      </div>
    </div>
  );
}

/** Team leaderboard screen on the presenter stage (ranked by average score, tie-broken by total score). */
export function TeamLeaderboard({ rows, title }: { rows: TeamRankRow[]; title: string }) {
  const top = rows.slice(0, 10);
  const left = top.slice(0, 5);
  const right = top.slice(5, 10);

  if (!top.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-[96px] font-extrabold">No team submissions yet</div>
        <div className="mt-4 text-[44px] opacity-70">{title}</div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-0 right-0 top-[36px] text-center">
        <div className="text-[34px] font-semibold uppercase tracking-[0.4em] opacity-70">{title}</div>
        <div className="text-[92px] font-extrabold leading-none">🏅 Team Standings</div>
      </div>

      <div
        className={`absolute left-[80px] right-[80px] top-[210px] grid gap-x-10 ${
          right.length > 0 ? 'grid-cols-2' : 'mx-auto max-w-[1100px] grid-cols-1'
        }`}
      >
        {[left, ...(right.length > 0 ? [right] : [])].map((col, idx) => (
          <div key={idx} className="flex flex-col gap-[18px]">
            {col.map((t) => {
              const medal = t.rank === 1 ? '👑' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : null;
              return (
                <motion.div
                  layout
                  key={t.team}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex h-[132px] items-center gap-6 rounded-3xl border-2 border-ink/20 bg-ink/10 px-8 shadow-xl backdrop-blur"
                >
                  <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-primary text-[40px] font-extrabold text-white">
                    {medal ?? t.rank}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[42px] font-extrabold leading-tight">{t.team}</div>
                    <div className="truncate text-[24px] opacity-75">
                      {t.membersSubmitted} {t.membersSubmitted === 1 ? 'member' : 'members'} · Total {t.totalScore} pts
                      {t.bestIndividual ? ` · Top: ${t.bestIndividual.name}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[56px] font-extrabold leading-none text-accent">{t.averageScore}</div>
                    <div className="text-[22px] uppercase tracking-wider opacity-70">avg pts</div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
