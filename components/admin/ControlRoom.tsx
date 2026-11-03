'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client-api';
import { formatDuration, mmss } from '@/lib/client-api';
import { subscribeToSession } from '@/lib/realtime';
import { revealPlan } from '@/lib/reveal';
import type { LeaderboardSummary, RankedRow, RevealMode, SessionStatus, Theme } from '@/lib/types';
import { ThemeScope } from '@/components/ThemeScope';

interface Stats {
  serverNow: number;
  status: SessionStatus;
  theme: Theme;
  durationSeconds: number;
  startedAt: number | null;
  endsAt: number | null;
  joined: number;
  submitted: number;
  totalQuestions: number;
  reveal: { mode: RevealMode; step: number; at: number | null };
  leaderboard: RankedRow[];
  summary: LeaderboardSummary | null;
}
interface Person {
  id: string;
  name: string;
  rollNumber: string | null;
  status: 'waiting' | 'answering' | 'submitted' | 'removed';
  answered: number;
  score: number | null;
  correctCount: number | null;
  timeTakenMs: number | null;
  submittedAt: string | null;
  autoSubmitted: boolean;
  removed: boolean;
}
interface QuestionStat {
  questionId: string;
  text: string;
  correctText: string;
  answered: number;
  correct: number;
  percentCorrect: number;
  options: { id: string; text: string; count: number; isCorrect: boolean }[];
}
interface Results {
  rows: RankedRow[];
  questionStats: QuestionStat[];
  summary: LeaderboardSummary;
}

const STATUS_STYLE: Record<SessionStatus, string> = {
  lobby: 'bg-sky-500/20 text-sky-300',
  live: 'bg-emerald-500/20 text-emerald-300',
  ended: 'bg-amber-500/20 text-amber-300',
  revealed: 'bg-violet-500/20 text-violet-300',
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="panel">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-extrabold text-white tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function ControlRoom({ sessionId, joinCode, quizId, quizTitle, presenterToken, appUrl, rollMode }: { sessionId: string; joinCode: string; quizId: string; quizTitle: string; presenterToken: string; appUrl: string; rollMode: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [, force] = useState(0);
  const [origin, setOrigin] = useState(appUrl);
  const [copied, setCopied] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [mins, setMins] = useState(0);
  const [secs, setSecs] = useState(0);
  const offset = useRef(0);
  const statusRef = useRef<SessionStatus | null>(null);

  useEffect(() => {
    if (!appUrl) setOrigin(window.location.origin);
  }, [appUrl]);
  const joinUrl = `${origin.replace(/\/$/, '')}/j/${joinCode}`;
  const presenterUrl = `${origin.replace(/\/$/, '')}/present/${sessionId}?t=${presenterToken}`;

  const pollStats = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const s = await api<Stats>(`/api/admin/sessions/${sessionId}/stats`);
      const recv = Date.now();
      if (recv - sentAt < 2000) offset.current = s.serverNow - (sentAt + recv) / 2;
      statusRef.current = s.status;
      setStats(s);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection problem');
    }
  }, [sessionId]);

  const pollPeople = useCallback(async () => {
    try {
      const r = await api<{ participants: Person[] }>(`/api/admin/sessions/${sessionId}/participants`);
      setPeople(r.participants);
    } catch {
      /* next poll retries */
    }
  }, [sessionId]);

  const loadResults = useCallback(async () => {
    try {
      setResults(await api<Results>(`/api/admin/sessions/${sessionId}/results`));
    } catch {
      /* not ended yet */
    }
  }, [sessionId]);

  useEffect(() => {
    pollStats();
    pollPeople();
    const a = setInterval(pollStats, 2000);
    const b = setInterval(() => {
      if (statusRef.current === 'lobby' || statusRef.current === 'live') pollPeople();
    }, 3000);
    const c = setInterval(() => force((n) => n + 1), 250);
    const off = subscribeToSession(sessionId, () => {
      pollStats();
      pollPeople();
    });
    return () => {
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
      off();
    };
  }, [pollStats, pollPeople, sessionId]);

  // Fetch final results once the quiz ends, and clear them on reset.
  const status = stats?.status;
  useEffect(() => {
    if (status === 'ended' || status === 'revealed') {
      pollPeople();
      loadResults();
    } else if (status === 'lobby') setResults(null);
  }, [status, loadResults, pollPeople]);

  useEffect(() => {
    if (stats && status === 'lobby') {
      setMins(Math.floor(stats.durationSeconds / 60));
      setSecs(stats.durationSeconds % 60);
    }
  }, [status, stats?.durationSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      await Promise.all([pollStats(), pollPeople()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy('');
    }
  };
  const post = (path: string, json?: unknown) => api(`/api/admin/sessions/${sessionId}/${path}`, { method: 'POST', json: json ?? {} });

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  const now = Date.now() + offset.current;
  const remaining = stats?.endsAt ? Math.max(0, stats.endsAt - now) : null;
  const everyoneDone = stats?.status === 'live' && stats.joined > 0 && stats.submitted >= stats.joined;
  const planLen = revealPlan(Math.min(10, results?.rows.length ?? stats?.leaderboard.length ?? 0)).seq.length;

  if (!stats) {
    return <div className="py-20 text-center text-slate-400">{error || 'Loading control room…'}</div>;
  }
  const st = stats.status;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="panel space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/admin" className="text-sm text-slate-400 hover:text-white">← Quizzes</Link>
            <h1 className="mt-1 text-2xl font-bold text-white">{quizTitle}</h1>
            <Link href={`/admin/quizzes/${quizId}`} className="text-sm text-violet-300 hover:underline">Edit quiz</Link>
          </div>
          <span className={`badge px-4 py-1.5 text-sm ${STATUS_STYLE[st]}`}>{st.toUpperCase()}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div>
            <div className="label">Join code</div>
            <div className="font-mono text-5xl font-extrabold tracking-[0.2em] text-white">{joinCode}</div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-slate-950 px-3 py-2 text-sm text-cyan-300">{joinUrl}</code>
              <button className="btn-secondary" onClick={() => copy('join', joinUrl)}>{copied === 'join' ? '✓ Copied' : 'Copy join link'}</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={presenterUrl} target="_blank" rel="noopener" className="btn-primary">📺 Open presenter view</a>
              <button className="btn-secondary" onClick={() => copy('present', presenterUrl)}>{copied === 'present' ? '✓ Copied' : 'Copy presenter link'}</button>
            </div>
            <p className="text-xs text-slate-500">The presenter link works without login, so only share it with whoever runs the LED laptop.</p>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-500/15 p-3 text-sm text-red-300">{error}</p>}

      {everyoneDone && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <p className="font-semibold text-emerald-200">✅ Everyone has submitted. End now?</p>
          <button className="btn-primary" disabled={!!busy} onClick={() => act('end', () => post('end'))}>End now</button>
        </div>
      )}

      {/* Live stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Joined" value={stats.joined} />
        <Stat label="Submitted" value={`${stats.submitted}`} sub={`of ${stats.joined}`} />
        <Stat label={st === 'live' ? 'Time remaining' : 'Duration'} value={st === 'live' && remaining !== null ? mmss(remaining) : mmss(stats.durationSeconds * 1000)} />
        <Stat label="Status" value={<span className="capitalize">{st}</span>} />
      </div>

      {/* Controls */}
      <section className="panel space-y-4">
        <h2 className="text-lg font-bold text-white">Controls</h2>
        <div className="flex flex-wrap items-end gap-3">
          {st === 'lobby' && (
            <>
              <div>
                <span className="label">Duration</span>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={60} aria-label="Minutes" className="field w-20" value={mins} onChange={(e) => setMins(Number(e.target.value) || 0)} />m
                  <input type="number" min={0} max={59} aria-label="Seconds" className="field w-20" value={secs} onChange={(e) => setSecs(Math.min(59, Number(e.target.value) || 0))} />s
                  <button className="btn-secondary" disabled={!!busy} onClick={() => act('dur', () => api(`/api/admin/sessions/${sessionId}`, { method: 'PATCH', json: { durationSeconds: Math.max(30, Math.min(3600, mins * 60 + secs)) } }))}>Save time</button>
                </div>
              </div>
              <button className="btn-primary px-8 py-3 text-base" disabled={!!busy} onClick={() => act('start', () => post('start'))}>▶ Start quiz</button>
            </>
          )}
          {st === 'live' && (
            <>
              <button className="btn-danger" disabled={!!busy} onClick={() => confirm('End the quiz now? Everyone who has not submitted will be auto-submitted.') && act('end', () => post('end'))}>■ End now</button>
              <button className="btn-secondary" disabled={!!busy} onClick={() => act('extend', () => post('extend', { seconds: 60 }))}>+ 1 minute</button>
            </>
          )}
          {st === 'ended' && (
            <>
              <button className="btn-primary px-6 py-3 text-base" disabled={!!busy} onClick={() => act('reveal', () => post('reveal', { action: 'start', mode: 'auto' }))}>🏆 Reveal leaderboard</button>
              <button className="btn-secondary" disabled={!!busy} onClick={() => act('reveal', () => post('reveal', { action: 'start', mode: 'manual' }))}>Reveal step by step</button>
            </>
          )}
          {st === 'revealed' && (
            <>
              {stats.reveal.mode === 'manual' && (
                <button className="btn-primary" disabled={!!busy || stats.reveal.step >= planLen} onClick={() => act('next', () => post('reveal', { action: 'next' }))}>
                  Next reveal step ({Math.min(stats.reveal.step, planLen)}/{planLen})
                </button>
              )}
              <button className="btn-secondary" disabled={!!busy} onClick={() => act('replay', () => post('reveal', { action: 'replay', mode: 'auto' }))}>↻ Replay reveal</button>
              <button className="btn-secondary" disabled={!!busy} onClick={() => act('replay', () => post('reveal', { action: 'replay', mode: 'manual' }))}>Replay step by step</button>
              <button className="btn-secondary" disabled={!!busy || stats.reveal.mode === 'full'} onClick={() => act('full', () => post('reveal', { action: 'full' }))}>Show full leaderboard</button>
            </>
          )}
          <button className="btn-ghost ml-auto text-red-300" onClick={() => setResetOpen(true)}>Reset session…</button>
        </div>
        {st === 'revealed' && stats.reveal.mode === 'manual' && <p className="text-xs text-slate-400">Tip: on the presenter laptop press <kbd className="rounded bg-slate-800 px-1">Space</kbd> or <kbd className="rounded bg-slate-800 px-1">→</kbd> for the next step.</p>}
      </section>

      {(st === 'ended' || st === 'revealed') && results && <ResultsPanel sessionId={sessionId} quizTitle={quizTitle} theme={stats.theme} results={results} />}

      <PeopleTable
        sessionId={sessionId}
        people={people}
        results={results}
        status={st}
        showRoll={rollMode !== 'off' || people.some((p) => p.rollNumber)}
        onChanged={() => Promise.all([pollPeople(), pollStats(), st === 'ended' || st === 'revealed' ? loadResults() : null])}
      />

      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="panel w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold text-white">Reset this session?</h2>
            <p className="text-sm text-slate-300">This deletes all participants and answers and returns to the lobby. Every phone goes back to the join screen. Type <b>RESET</b> to confirm.</p>
            <input className="field" value={resetText} onChange={(e) => setResetText(e.target.value)} autoFocus aria-label="Type RESET" />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setResetOpen(false); setResetText(''); }}>Cancel</button>
              <button className="btn-danger" disabled={resetText !== 'RESET' || !!busy} onClick={() => act('reset', async () => { await post('reset', { confirm: 'RESET' }); setResetOpen(false); setResetText(''); setResults(null); })}>Reset session</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- results
function ResultsPanel({ sessionId, quizTitle, theme, results }: { sessionId: string; quizTitle: string; theme: Theme; results: Results }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [imgBusy, setImgBusy] = useState(false);

  const downloadImage = async () => {
    if (!cardRef.current) return;
    setImgBusy(true);
    try {
      const { toPng } = await import('html-to-image');
      let url: string;
      try {
        url = await toPng(cardRef.current, { pixelRatio: 1, cacheBust: true });
      } catch {
        url = await toPng(cardRef.current, { pixelRatio: 1, skipFonts: true }); // external font CSS can block embedding
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = `${quizTitle.replace(/[^\w]+/g, '-')}_top10.png`;
      a.click();
    } finally {
      setImgBusy(false);
    }
  };

  const top = results.rows.slice(0, 10);
  const max = (q: QuestionStat) => Math.max(1, ...q.options.map((o) => o.count));
  return (
    <section className="panel space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Results &amp; export</h2>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/admin/sessions/${sessionId}/export.csv`}>⬇ CSV</a>
          <a className="btn-secondary" href={`/api/admin/sessions/${sessionId}/export.xlsx`}>⬇ Excel</a>
          <Link className="btn-secondary" href={`/admin/sessions/${sessionId}/print`} target="_blank">🖨 Print view</Link>
          <button className="btn-secondary" onClick={downloadImage} disabled={imgBusy || !top.length}>{imgBusy ? 'Rendering…' : '🖼 Top 10 image'}</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Participants" value={results.summary.total} />
        <Stat label="Average score" value={results.summary.averageScore} />
        <Stat label="Highest score" value={results.summary.highestScore} />
        <Stat label="Fastest perfect" value={results.summary.fastestPerfect ? formatDuration(results.summary.fastestPerfect.timeTakenMs, true) : '–'} sub={results.summary.fastestPerfect?.name} />
      </div>

      <div>
        <h3 className="mb-3 font-semibold text-white">Answers per question</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {results.questionStats.map((q, i) => (
            <div key={q.questionId} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-sm font-semibold text-white">{i + 1}. {q.text}</p>
              <p className="mb-3 text-xs text-slate-400">{q.correct}/{q.answered} correct ({q.percentCorrect}%)</p>
              <div className="space-y-2">
                {q.options.map((o) => (
                  <div key={o.id}>
                    <div className="flex justify-between text-xs text-slate-300"><span>{o.isCorrect ? '✓ ' : ''}{o.text}</span><span>{o.count}</span></div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${o.isCorrect ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{ width: `${(o.count / max(q)) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Off-screen card rendered to PNG */}
      <div className="pointer-events-none fixed -left-[10000px] top-0" aria-hidden>
        <div ref={cardRef}>
          <ThemeScope theme={theme} className="flex h-[1350px] w-[1080px] flex-col p-14">
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {theme.logoUrl && <img src={theme.logoUrl} alt="" className="mx-auto mb-4 max-h-24 object-contain" crossOrigin="anonymous" />}
              <div className="text-3xl font-semibold uppercase tracking-[0.3em] opacity-70">{theme.eventTitle || quizTitle}</div>
              <div className="mt-2 text-7xl font-extrabold">🏆 Top 10</div>
            </div>
            <div className="mt-10 flex flex-1 flex-col gap-3">
              {top.map((r) => (
                <div key={r.participantId} className="flex items-center gap-5 rounded-2xl bg-ink/10 px-6 py-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl font-extrabold text-white">{r.rank}</div>
                  <div className="min-w-0 flex-1 truncate text-4xl font-bold">{r.name}</div>
                  <div className="text-right"><div className="text-4xl font-extrabold text-accent">{r.score}</div><div className="text-xl opacity-70">{formatDuration(r.timeTakenMs, true)}</div></div>
                </div>
              ))}
            </div>
          </ThemeScope>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- participants / results table
type SortKey = 'rank' | 'name' | 'score' | 'time' | 'answered';
function PeopleTable({ sessionId, people, results, status, showRoll, onChanged }: { sessionId: string; people: Person[]; results: Results | null; status: SessionStatus; showRoll: boolean; onChanged: () => unknown }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const ended = status === 'ended' || status === 'revealed';
  const rankOf = useMemo(() => new Map(results?.rows.map((r) => [r.participantId, r] as const)), [results]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = people
      .map((p) => ({ ...p, rank: rankOf.get(p.id)?.rank ?? null, label: rankOf.get(p.id)?.name ?? p.name }))
      .filter((p) => !needle || p.label.toLowerCase().includes(needle) || (p.rollNumber ?? '').toLowerCase().includes(needle));
    const val = (p: (typeof list)[number]): number | string => {
      switch (sort.key) {
        case 'name': return p.label.toLowerCase();
        case 'score': return p.score ?? -1;
        case 'time': return p.timeTakenMs ?? Number.MAX_SAFE_INTEGER;
        case 'answered': return p.answered;
        default: return p.rank ?? Number.MAX_SAFE_INTEGER;
      }
    };
    return list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [people, q, sort, rankOf]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr('');
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy('');
    }
  };
  const rename = (p: Person) => {
    const name = prompt('New display name', p.name);
    if (name && name.trim().length >= 2) run(p.id, () => api(`/api/admin/sessions/${sessionId}/participants/${p.id}`, { method: 'PATCH', json: { name: name.trim() } }));
  };
  const remove = (p: Person) => {
    if (confirm(`Remove "${p.name}"? They disappear from the leaderboard and see "You have been removed".`)) run(p.id, () => api(`/api/admin/sessions/${sessionId}/participants/${p.id}`, { method: 'DELETE' }));
  };
  const restore = (p: Person) => run(p.id, () => api(`/api/admin/sessions/${sessionId}/participants/${p.id}`, { method: 'PATCH', json: { removed: false } }));

  const th = (key: SortKey, label: string) => (
    <th className="p-3">
      <button className="font-semibold uppercase tracking-wide hover:text-white" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'score' ? -1 : 1 }))}>
        {label} {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </button>
    </th>
  );

  return (
    <section className="panel space-y-3 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 pb-0">
        <h2 className="text-lg font-bold text-white">{ended ? 'Results' : 'Participants'} ({people.filter((p) => !p.removed).length})</h2>
        <input className="field max-w-xs" placeholder="Search name or roll number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search participants" />
      </div>
      {err && <p className="px-4 text-sm text-red-300">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs text-slate-400">
            <tr>
              {ended && th('rank', 'Rank')}
              {th('name', 'Name')}
              {showRoll && <th className="p-3 font-semibold uppercase tracking-wide">Roll no.</th>}
              <th className="p-3 font-semibold uppercase tracking-wide">Status</th>
              {th('answered', 'Answered')}
              {ended && th('score', 'Score')}
              {ended && th('time', 'Time')}
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-400">{people.length ? 'No matches.' : 'Nobody has joined yet.'}</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className={p.removed ? 'opacity-50' : ''}>
                {ended && <td className="p-3 font-bold text-white">{p.rank ?? '–'}</td>}
                <td className="p-3 font-semibold text-white">{p.label}</td>
                {showRoll && <td className="p-3 text-slate-300">{p.rollNumber ?? '–'}</td>}
                <td className="p-3">
                  <span className={`badge ${p.status === 'submitted' ? 'bg-emerald-500/20 text-emerald-300' : p.status === 'answering' ? 'bg-amber-500/20 text-amber-300' : p.status === 'removed' ? 'bg-red-500/20 text-red-300' : 'bg-slate-700 text-slate-300'}`}>
                    {p.status}{p.autoSubmitted && p.status === 'submitted' ? ' (auto)' : ''}
                  </span>
                </td>
                <td className="p-3 tabular-nums">{p.answered}</td>
                {ended && <td className="p-3 font-bold tabular-nums text-white">{p.score ?? '–'}{p.correctCount !== null && <span className="ml-1 text-xs font-normal text-slate-400">({p.correctCount} correct)</span>}</td>}
                {ended && <td className="p-3 tabular-nums">{formatDuration(p.timeTakenMs, true)}</td>}
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost px-2 py-1 text-xs" disabled={busy === p.id} onClick={() => rename(p)}>Rename</button>
                    {p.removed ? (
                      <button className="btn-ghost px-2 py-1 text-xs" disabled={busy === p.id} onClick={() => restore(p)}>Restore</button>
                    ) : (
                      <button className="btn-ghost px-2 py-1 text-xs text-red-300" disabled={busy === p.id} onClick={() => remove(p)}>Remove</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

