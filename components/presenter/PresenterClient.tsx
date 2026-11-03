'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeScope } from '@/components/ThemeScope';
import { ScaledStage } from './ScaledStage';
import { PresenterScreen, useTick, type PresenterData } from './PresenterScreen';
import { subscribeToSession } from '@/lib/realtime';
import { revealPlan } from '@/lib/reveal';

type Fetched = PresenterData & { serverNow: number; sessionId: string };

/** Live presenter view for the LED screen. Polls /stats every 2s, with realtime as a faster hint. */
export function PresenterClient({ sessionId, token, appUrl }: { sessionId: string; token: string | null; appUrl: string }) {
  const [data, setData] = useState<Fetched | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idle, setIdle] = useState(false);
  const [optStep, setOptStep] = useState(0);
  const [page, setPage] = useState(0);
  const offset = useRef(0);
  const first = useRef(true);
  const anim = useRef<{ key: string; start: number; offset: number }>({ key: '', start: 0, offset: 0 });
  const wantFull = useRef(false);
  useTick(100);

  const poll = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const qs = new URLSearchParams();
      if (token) qs.set('t', token);
      if (wantFull.current) qs.set('full', '1');
      const res = await fetch(`/api/admin/sessions/${sessionId}/stats?${qs}`, { cache: 'no-store' });
      const recvAt = Date.now();
      if (res.status === 401 || res.status === 404) return setError('This presenter link is not valid. Open it from the control room.');
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Fetched;
      if (recvAt - sentAt < 2000) offset.current = d.serverNow - (sentAt + recvAt) / 2;

      // Start the reveal timeline: from zero when we witness the reveal, or mid-way after a refresh.
      const key = `${d.reveal.at}:${d.reveal.mode}`;
      if (d.status === 'revealed' && anim.current.key !== key) {
        const sinceReveal = d.reveal.at ? Math.max(0, d.serverNow - d.reveal.at) : 0;
        anim.current = { key, start: Date.now(), offset: first.current ? sinceReveal : 0 };
      }
      if (d.status !== 'revealed') anim.current.key = '';
      first.current = false;
      wantFull.current = d.status === 'revealed' && d.reveal.mode === 'full';
      setError(null);
      setData(d);
    } catch {
      /* keep showing the last good state; the next poll retries */
    }
  }, [sessionId, token]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2000);
    const off = subscribeToSession(sessionId, () => poll());
    return () => {
      clearInterval(id);
      off();
    };
  }, [poll, sessionId]);

  // Hide the cursor after 3s without movement
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('mousedown', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('mousedown', wake);
    };
  }, []);

  const serverStep = data?.reveal.step ?? 0;
  const manualStep = Math.max(serverStep, optStep);
  useEffect(() => {
    if (data?.status !== 'revealed' || data.reveal.mode !== 'manual') setOptStep(0);
  }, [data?.status, data?.reveal.mode, data?.reveal.at]);

  // Space / Right Arrow advances a step by step reveal
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'ArrowRight') return;
      if (data?.status !== 'revealed' || data.reveal.mode !== 'manual') return;
      e.preventDefault();
      const max = revealPlan(Math.min(10, data.leaderboard.length)).seq.length;
      if (manualStep >= max) return;
      setOptStep(manualStep + 1);
      const qs = token ? `?t=${encodeURIComponent(token)}` : '';
      await fetch(`/api/admin/sessions/${sessionId}/reveal${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'next' }),
      }).catch(() => {});
      poll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, manualStep, sessionId, token, poll]);

  // Full leaderboard pages (15 per page) auto scroll
  const fullRows = data?.leaderboard.length ?? 0;
  const pages = Math.max(1, Math.ceil(fullRows / 15));
  useEffect(() => {
    if (data?.reveal.mode !== 'full' || data.status !== 'revealed') return setPage(0);
    const id = setInterval(() => setPage((p) => (p + 1) % pages), 7000);
    return () => clearInterval(id);
  }, [data?.reveal.mode, data?.status, pages]);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const joinUrl = useMemo(() => {
    const base = appUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    return `${base.replace(/\/$/, '')}/j/${data?.joinCode ?? ''}`;
  }, [appUrl, data?.joinCode]);

  if (error) {
    return (
      <div className="presenter-root flex items-center justify-center bg-slate-950 p-10 text-center text-3xl text-white">
        <div>
          <div className="mb-4 text-6xl">🔒</div>
          {error}
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="presenter-root flex items-center justify-center bg-slate-950 text-3xl text-white">Loading…</div>;
  }

  const now = Date.now() + offset.current;
  const revealElapsed = Date.now() - anim.current.start + anim.current.offset;
  const rollCollected = data.leaderboard.some((r) => r.rollNumber);

  return (
    <ThemeScope theme={data.theme} className={`presenter-root ${idle ? 'cursor-idle' : ''}`}>
      <ScaledStage>
        <PresenterScreen
          data={data}
          now={now}
          joinUrl={joinUrl}
          revealElapsed={revealElapsed}
          manualStep={manualStep}
          rollCollected={rollCollected}
          fullPage={page}
          fullPages={pages}
        />
      </ScaledStage>
      <button
        onClick={fullscreen}
        className={`fixed right-4 top-4 z-50 rounded-lg bg-black/60 px-4 py-2 text-sm font-semibold text-white transition-opacity ${idle ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        ⛶ Fullscreen
      </button>
    </ThemeScope>
  );
}
