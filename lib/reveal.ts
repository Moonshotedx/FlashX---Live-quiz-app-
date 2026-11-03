import type { RevealMode } from './types';

/** Timings of the automatic reveal (ms). */
export const LIST_GAP = 600; // ranks 10..4 slide in about 0.6s apart
export const LIST_TO_PODIUM_PAUSE = 1800;
export const PODIUM_GAP = 2800; // drumroll style delay between 3rd, 2nd and 1st

/**
 * Reveal order for n participants: ranks min(10,n) down to 4 (list), then 3, 2, 1 (podium).
 * Adapts gracefully to fewer than 10 participants (and fewer than 3).
 */
export function revealPlan(n: number) {
  const listRanks: number[] = [];
  for (let r = Math.min(10, n); r >= 4; r--) listRanks.push(r);
  const podiumRanks = [3, 2, 1].filter((r) => r <= n);
  return { listRanks, podiumRanks, seq: [...listRanks, ...podiumRanks] };
}

/** Time (ms from reveal start) at which each item of `seq` appears in auto mode. */
export function autoSchedule(n: number): number[] {
  const { listRanks, podiumRanks } = revealPlan(n);
  const times = listRanks.map((_, i) => 500 + i * LIST_GAP);
  const podiumStart = (listRanks.length ? 500 + (listRanks.length - 1) * LIST_GAP + LIST_TO_PODIUM_PAUSE : 1200) + 0;
  podiumRanks.forEach((_, k) => times.push(podiumStart + k * PODIUM_GAP));
  return times;
}

export function autoTotalMs(n: number) {
  const t = autoSchedule(n);
  return (t[t.length - 1] ?? 0) + 4000; // confetti and settle
}

/** How many items of the plan are visible right now. */
export function visibleCount(mode: RevealMode, step: number, elapsedMs: number, n: number): number {
  const { seq } = revealPlan(n);
  if (mode === 'full') return seq.length;
  if (mode === 'manual') return Math.min(Math.max(step, 0), seq.length);
  return autoSchedule(n).filter((t) => t <= elapsedMs).length;
}

