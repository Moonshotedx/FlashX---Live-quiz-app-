'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { QRCodeCanvas } from 'qrcode.react';
import { api, formatDuration, mmss } from '@/lib/client-api';
import { subscribeToSession } from '@/lib/realtime';
import { revealPlan } from '@/lib/reveal';
import type { LeaderboardSummary, RankedRow, RevealMode, SessionStatus, TeamMode, TeamRankRow, Theme } from '@/lib/types';
import { ThemeScope } from '@/components/ThemeScope';
import { Spinner } from '@/components/ui/Spinner';

interface Stats {
  serverNow: number;
  status: SessionStatus;
  theme: Theme;
  durationSeconds: number;
  startedAt: number | null;
  endsAt: number | null;
  closesAt: string | null;
  teamMode: TeamMode;
  teams: string[];
  notStarted: number;
  inProgress: number;
  submitted: number;
  started: number;
  joined: number;
  totalQuestions: number;
  reveal: { mode: RevealMode; step: number; at: number | null };
  leaderboard: RankedRow[];
  teamLeaderboard: TeamRankRow[];
  summary: LeaderboardSummary | null;
}

type ParticipantStatus = 'not_started' | 'in_progress' | 'submitted' | 'auto_submitted' | 'removed';

interface Person {
  id: string;
  rank: number | null;
  name: string;
  displayLabel: string;
  email: string | null;
  team: string | null;
  rollNumber: string | null;
  status: ParticipantStatus;
  answered: number;
  score: number | null;
  correctCount: number | null;
  timeTakenMs: number | null;
  joinedAt: string;
  startedAt: string | null;
  endsAt: string | null;
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
  teamRows: TeamRankRow[];
  questionStats: QuestionStat[];
  summary: LeaderboardSummary;
  totalQuestions: number;
}

const STATUS_STYLE: Record<SessionStatus, string> = {
  lobby: 'bg-sky-500/20 text-sky-300',
  live: 'bg-emerald-500/20 text-emerald-300',
  ended: 'bg-amber-500/20 text-amber-300',
  revealed: 'bg-violet-500/20 text-violet-300',
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  lobby: 'Draft',
  live: 'Open',
  ended: 'Closed',
  revealed: 'Results published',
};

function toLocalDatetimeValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="panel">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-extrabold tabular-nums text-white">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function ControlRoom({
  sessionId,
  joinCode,
  quizId,
  quizTitle,
  presenterToken,
  appUrl,
  initialClosesAt,
}: {
  sessionId: string;
  joinCode: string;
  quizId: string;
  quizTitle: string;
  presenterToken: string;
  appUrl: string;
  initialClosesAt: string | null;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [, force] = useState(0);
  const [origin, setOrigin] = useState(appUrl);
  const [copied, setCopied] = useState('');
  const [closesInput, setClosesInput] = useState(() => toLocalDatetimeValue(initialClosesAt));
  const [closesDirty, setClosesDirty] = useState(false);
  const [publishConfirmMode, setPublishConfirmMode] = useState<'auto' | 'manual' | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [viewTab, setViewTab] = useState<'responses' | 'teams'>('responses');

  const offset = useRef(0);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

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
      setStats(s);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection problem');
    }
  }, [sessionId]);

  const pollPeople = useCallback(async () => {
    try {
      const r = await api<{ serverNow: number; participants: Person[] }>(`/api/admin/sessions/${sessionId}/participants`);
      setPeople(r.participants);
    } catch {
      /* next poll retries */
    }
  }, [sessionId]);

  const loadResults = useCallback(async () => {
    try {
      setResults(await api<Results>(`/api/admin/sessions/${sessionId}/results`));
    } catch {
      /* next poll retries */
    }
  }, [sessionId]);

  useEffect(() => {
    pollStats();
    pollPeople();
    loadResults();
    const a = setInterval(pollStats, 2500);
    const b = setInterval(() => {
      pollPeople();
      loadResults();
    }, 4000);
    const c = setInterval(() => force((n) => n + 1), 500);
    const off = subscribeToSession(sessionId, () => {
      pollStats();
      pollPeople();
      loadResults();
    });
    return () => {
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
      off();
    };
  }, [pollStats, pollPeople, loadResults, sessionId]);

  // Keep closesInput synced with server when not actively editing
  useEffect(() => {
    if (!closesDirty && stats) {
      setClosesInput(toLocalDatetimeValue(stats.closesAt));
    }
  }, [stats?.closesAt, closesDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      await Promise.all([pollStats(), pollPeople(), loadResults()]);
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

  const downloadQr = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quizTitle.replace(/[^\w]+/g, '-') || 'quiz'}_${joinCode}_qr.png`;
    a.click();
  };

  const saveClosesAt = (clear = false) =>
    act('closes', async () => {
      const iso = clear || !closesInput ? null : new Date(closesInput).toISOString();
      await api(`/api/admin/sessions/${sessionId}`, { method: 'PATCH', json: { closesAt: iso } });
      setClosesDirty(false);
      if (clear) setClosesInput('');
    });

  const requestPublish = (mode: 'auto' | 'manual') => {
    if ((stats?.inProgress ?? 0) > 0) {
      setPublishConfirmMode(mode);
      return;
    }
    act('reveal', () => post('reveal', { action: 'start', mode }));
  };

  const openPresenter = () => {
    window.open(presenterUrl, '_blank', 'noopener,noreferrer');
  };

  const showLeaderboardOnScreen = async () => {
    if (!stats) return;
    if (stats.status === 'ended') {
      // If link is closed and admin clicks Show leaderboard on screen, publish results (warming if inProgress > 0) and open presenter.
      if (stats.inProgress > 0) {
        setPublishConfirmMode('auto');
        return;
      }
      await act('reveal', () => post('reveal', { action: 'start', mode: 'auto' }));
    }
    openPresenter();
  };

  const now = Date.now() + offset.current;
  const planLen = revealPlan(Math.min(10, results?.rows.length ?? stats?.leaderboard.length ?? 0)).seq.length;

  if (!stats) {
    if (error) {
      return (
        <div className="panel py-14 text-center text-red-300" role="alert">
          {error}
        </div>
      );
    }
    return (
      <div className="animate-pageIn space-y-6" role="status" aria-label="Loading responses">
        <div className="panel space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="skeleton h-4 w-20" />
              <div className="skeleton h-8 w-64" />
            </div>
            <div className="skeleton h-7 w-24 rounded-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="skeleton h-10 w-72 max-w-full rounded-lg" />
            <div className="skeleton h-10 w-28 rounded-lg" />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <div className="skeleton h-10 w-32 rounded-lg" />
            <div className="skeleton h-10 w-44 rounded-lg" />
            <div className="skeleton h-10 w-36 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="panel space-y-2">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-9 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  const st = stats.status;
  const teamRows = results?.teamRows ?? stats.teamLeaderboard ?? [];

  return (
    <div className="animate-pageIn space-y-6">
      {/* Hidden high-res QR canvas for crisp PNG download */}
      <div className="pointer-events-none fixed -left-[9999px] top-0" aria-hidden>
        <QRCodeCanvas ref={qrCanvasRef} value={joinUrl} size={1024} level="M" marginSize={2} bgColor="#FFFFFF" fgColor="#000000" />
      </div>

      {/* Top link & QR panel */}
      <div className="panel space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/admin" className="text-sm text-slate-400 hover:text-white">
              ← Quizzes
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-violet-300">Responses</span>
              <span className="text-slate-600">·</span>
              <Link href={`/admin/quizzes/${quizId}`} className="text-xs text-slate-400 hover:text-white hover:underline">
                Edit quiz
              </Link>
            </div>
            <h1 className="mt-0.5 text-2xl font-bold text-white">{quizTitle}</h1>
          </div>
          <span className={`badge px-4 py-1.5 text-sm ${STATUS_STYLE[st]}`}>{STATUS_LABEL[st]}</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-slate-950 px-3 py-2 text-sm text-cyan-300">{joinUrl}</code>
              <span className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-300">
                Code: <b className="text-white">{joinCode}</b>
              </span>
              <button className="btn-secondary" onClick={() => copy('join', joinUrl)}>
                {copied === 'join' ? '✓ Copied' : 'Copy link'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a href={presenterUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                📺 Show QR
              </a>
              <button className="btn-secondary" onClick={downloadQr}>
                ⬇ Download QR (PNG)
              </button>
              <button className="btn-secondary" onClick={() => copy('present', presenterUrl)}>
                {copied === 'present' ? '✓ Copied' : 'Copy screen link'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <label htmlFor="closesAt" className="label">
              Closes at (optional)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="closesAt"
                type="datetime-local"
                className="field w-auto py-1.5 text-sm"
                value={closesInput}
                onChange={(e) => {
                  setClosesInput(e.target.value);
                  setClosesDirty(true);
                }}
              />
              <button
                className="btn-secondary px-3 py-1.5 text-xs"
                disabled={!!busy || !closesInput}
                aria-busy={busy === 'closes'}
                onClick={() => saveClosesAt(false)}
              >
                {busy === 'closes' ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </button>
              {stats.closesAt && (
                <button
                  className="btn-ghost px-2.5 py-1.5 text-xs text-slate-400"
                  disabled={!!busy}
                  onClick={() => saveClosesAt(true)}
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {stats.closesAt ? `Auto-closes ${new Date(stats.closesAt).toLocaleString()}` : 'Link stays open until you click Close link.'}
            </p>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
          {st === 'live' && (
            <button className="btn-danger" disabled={!!busy} aria-busy={busy === 'close'} onClick={() => act('close', () => post('close'))}>
              {busy === 'close' ? (
                <>
                  <Spinner />
                  Closing…
                </>
              ) : (
                '■ Close link'
              )}
            </button>
          )}

          {st === 'ended' && (
            <>
              <button className="btn-primary" disabled={!!busy} aria-busy={busy === 'reveal'} onClick={() => requestPublish('auto')}>
                {busy === 'reveal' ? (
                  <>
                    <Spinner />
                    Publishing…
                  </>
                ) : (
                  '🏆 Publish results'
                )}
              </button>
              <button className="btn-secondary" disabled={!!busy} onClick={() => requestPublish('manual')}>
                Publish (step-by-step)
              </button>
              <button className="btn-secondary" disabled={!!busy} aria-busy={busy === 'reopen'} onClick={() => act('reopen', () => post('reopen'))}>
                {busy === 'reopen' ? (
                  <>
                    <Spinner />
                    Reopening…
                  </>
                ) : (
                  '↺ Reopen link'
                )}
              </button>
            </>
          )}

          {st === 'revealed' && (
            <>
              {stats.reveal.mode === 'manual' && (
                <button
                  className="btn-primary"
                  disabled={!!busy || stats.reveal.step >= planLen}
                  onClick={() => act('next', () => post('reveal', { action: 'next' }))}
                >
                  Next reveal step ({Math.min(stats.reveal.step, planLen)}/{planLen})
                </button>
              )}
              <button className="btn-secondary" disabled={!!busy} onClick={() => act('replay', () => post('reveal', { action: 'replay', mode: 'auto' }))}>
                ↻ Replay reveal
              </button>
              <button className="btn-secondary" disabled={!!busy} onClick={() => act('replay', () => post('reveal', { action: 'replay', mode: 'manual' }))}>
                Step-by-step reveal
              </button>
              <button
                className="btn-secondary"
                disabled={!!busy || stats.reveal.mode === 'full'}
                onClick={() => act('full', () => post('reveal', { action: 'full' }))}
              >
                Full leaderboard on screen
              </button>
              {teamRows.length > 0 && (
                <button
                  className="btn-secondary"
                  disabled={!!busy || stats.reveal.mode === 'teams'}
                  onClick={() => act('teams', () => post('reveal', { action: 'teams' }))}
                >
                  Team leaderboard on screen
                </button>
              )}
            </>
          )}

          <button className="btn-secondary" disabled={!!busy} onClick={showLeaderboardOnScreen}>
            🏆 Show leaderboard on screen
          </button>

          <button className="btn-ghost ml-auto text-red-300" onClick={() => setResetOpen(true)}>
            Reset…
          </button>
        </div>

        {st === 'live' && (
          <p className="text-xs text-slate-400">
            Closing the link stops new attempts while letting anyone already mid-attempt finish within their personal timer. Close the link first to publish final results.
          </p>
        )}
        {st === 'revealed' && stats.reveal.mode === 'manual' && (
          <p className="text-xs text-slate-400">
            Tip: on the presenter laptop press <kbd className="rounded bg-slate-800 px-1">Space</kbd> or{' '}
            <kbd className="rounded bg-slate-800 px-1">→</kbd> for the next step.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Live counters */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Started"
          value={stats.started}
          sub={stats.notStarted > 0 ? `${stats.notStarted} not started` : undefined}
        />
        <Stat label="In progress" value={stats.inProgress} />
        <Stat label="Submitted" value={stats.submitted} sub={`of ${stats.started} started`} />
        <Stat label="Time limit / student" value={mmss(stats.durationSeconds * 1000)} />
      </div>

      {/* Responses & Team Leaderboard tabs */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800">
          <button
            type="button"
            onClick={() => setViewTab('responses')}
            className={`-mb-px select-none border-b-2 px-4 py-2 text-sm font-semibold transition-all duration-150 active:scale-[0.97] ${
              viewTab === 'responses' ? 'border-violet-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Responses ({people.filter((p) => !p.removed).length})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('teams')}
            className={`-mb-px select-none border-b-2 px-4 py-2 text-sm font-semibold transition-all duration-150 active:scale-[0.97] ${
              viewTab === 'teams' ? 'border-violet-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Team leaderboard ({teamRows.length})
          </button>
        </div>

        {viewTab === 'responses' ? (
          <div className="animate-pageIn">
            <ResponsesTable
              sessionId={sessionId}
              people={people}
              quizTeams={stats.teams}
              totalQuestions={stats.totalQuestions}
              now={now}
              onChanged={() => Promise.all([pollPeople(), pollStats(), loadResults()])}
            />
          </div>
        ) : (
          <div className="animate-pageIn">
            <TeamLeaderboardPanel teamRows={teamRows} />
          </div>
        )}
      </div>

      {/* Live exports & per-question breakdown */}
      {results && <ResultsPanel sessionId={sessionId} quizTitle={quizTitle} theme={stats.theme} results={results} />}

      {/* Publish warning modal when attempts are still in progress */}
      {publishConfirmMode && (
        <div className="fixed inset-0 z-50 flex animate-modalBackdrop items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="panel w-full max-w-md animate-modalPop space-y-4">
            <h2 className="text-lg font-bold text-white">Attempts still in progress</h2>
            <p className="text-sm text-slate-300">
              <b>{stats.inProgress}</b> {stats.inProgress === 1 ? 'student is' : 'students are'} still answering within their personal time limit.
              If you publish results now, their running attempts will not be interrupted and will appear on the leaderboard once they submit or expire.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPublishConfirmMode(null)}>
                Wait
              </button>
              <button
                className="btn-primary"
                disabled={!!busy}
                onClick={() => {
                  const m = publishConfirmMode;
                  setPublishConfirmMode(null);
                  act('reveal', () => post('reveal', { action: 'start', mode: m }));
                }}
              >
                Publish results anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation modal */}
      {resetOpen && (
        <div className="fixed inset-0 z-50 flex animate-modalBackdrop items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="panel w-full max-w-md animate-modalPop space-y-4">
            <h2 className="text-lg font-bold text-white">Reset this link?</h2>
            <p className="text-sm text-slate-300">
              This deletes all participants and responses and reopens the link for fresh attempts. Type <b>RESET</b> to confirm.
            </p>
            <input className="field" value={resetText} onChange={(e) => setResetText(e.target.value)} autoFocus aria-label="Type RESET" />
            <div className="flex justify-end gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  setResetOpen(false);
                  setResetText('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={resetText !== 'RESET' || !!busy}
                aria-busy={busy === 'reset'}
                onClick={() =>
                  act('reset', async () => {
                    await post('reset', { confirm: 'RESET' });
                    setResetOpen(false);
                    setResetText('');
                  })
                }
              >
                {busy === 'reset' ? (
                  <>
                    <Spinner />
                    Resetting…
                  </>
                ) : (
                  'Reset responses'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- team leaderboard (P1)
function TeamLeaderboardPanel({ teamRows }: { teamRows: TeamRankRow[] }) {
  return (
    <section className="panel overflow-x-auto p-0">
      <div className="p-4 pb-2">
        <h2 className="text-lg font-bold text-white">Team leaderboard</h2>
        <p className="text-xs text-slate-400">Ranked by average score (tie-broken by total score across submitted members).</p>
      </div>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="p-3">Rank</th>
            <th className="p-3">Team</th>
            <th className="p-3">Members submitted</th>
            <th className="p-3">Average score</th>
            <th className="p-3">Total score</th>
            <th className="p-3">Best individual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {teamRows.length === 0 && (
            <tr>
              <td colSpan={6} className="p-8 text-center text-slate-400">
                Team rankings will appear here once students with a team submit.
              </td>
            </tr>
          )}
          {teamRows.map((t) => (
            <tr key={t.team} className="hover:bg-slate-900/50">
              <td className="p-3 font-bold text-white">#{t.rank}</td>
              <td className="p-3 font-semibold text-white">{t.team}</td>
              <td className="p-3 tabular-nums">{t.membersSubmitted}</td>
              <td className="p-3 font-bold tabular-nums text-violet-300">{t.averageScore}</td>
              <td className="p-3 tabular-nums">{t.totalScore}</td>
              <td className="p-3 text-slate-300">
                {t.bestIndividual ? `${t.bestIndividual.name} (${t.bestIndividual.score})` : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------- responses table
type SortKey = 'rank' | 'name' | 'email' | 'team' | 'score' | 'correct' | 'time' | 'status' | 'submittedAt';

const STATUS_ORDER: Record<ParticipantStatus, number> = {
  in_progress: 1,
  submitted: 2,
  auto_submitted: 3,
  not_started: 4,
  removed: 5,
};

function ResponsesTable({
  sessionId,
  people,
  quizTeams,
  totalQuestions,
  now,
  onChanged,
}: {
  sessionId: string;
  people: Person[];
  quizTeams: string[];
  totalQuestions: number;
  now: number;
  onChanged: () => unknown;
}) {
  const [q, setQ] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const teamOptions = useMemo(() => {
    const set = new Set<string>(quizTeams.filter(Boolean));
    for (const p of people) {
      if (p.team) set.add(p.team);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [quizTeams, people]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = people.filter((p) => {
      if (teamFilter && (p.team ?? '') !== teamFilter) return false;
      if (!needle) return true;
      return (
        p.displayLabel.toLowerCase().includes(needle) ||
        p.name.toLowerCase().includes(needle) ||
        (p.email ?? '').toLowerCase().includes(needle)
      );
    });

    const val = (p: Person): number | string => {
      switch (sort.key) {
        case 'name':
          return p.displayLabel.toLowerCase();
        case 'email':
          return (p.email ?? '\uffff').toLowerCase();
        case 'team':
          return (p.team ?? '\uffff').toLowerCase();
        case 'score':
          return p.score ?? -1;
        case 'correct':
          return p.correctCount ?? -1;
        case 'time':
          return p.timeTakenMs ?? Number.MAX_SAFE_INTEGER;
        case 'status':
          return STATUS_ORDER[p.status] ?? 99;
        case 'submittedAt':
          return p.submittedAt ? new Date(p.submittedAt).getTime() : Number.MAX_SAFE_INTEGER;
        default:
          return p.rank ?? Number.MAX_SAFE_INTEGER;
      }
    };

    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === vb) return a.joinedAt.localeCompare(b.joinedAt);
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }, [people, q, teamFilter, sort]);

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
    if (name && name.trim().length >= 2) {
      run(p.id, () => api(`/api/admin/sessions/${sessionId}/participants/${p.id}`, { method: 'PATCH', json: { name: name.trim() } }));
    }
  };
  const remove = (p: Person) => {
    if (confirm(`Remove "${p.name}"? They disappear from the leaderboard and see "You have been removed".`)) {
      run(p.id, () => api(`/api/admin/sessions/${sessionId}/participants/${p.id}`, { method: 'DELETE' }));
    }
  };
  const restore = (p: Person) =>
    run(p.id, () => api(`/api/admin/sessions/${sessionId}/participants/${p.id}`, { method: 'PATCH', json: { removed: false } }));

  const th = (key: SortKey, label: string) => (
    <th className="p-3">
      <button
        type="button"
        className="whitespace-nowrap font-semibold uppercase tracking-wide hover:text-white"
        onClick={() =>
          setSort((s) => ({
            key,
            dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'score' || key === 'correct' ? -1 : 1,
          }))
        }
      >
        {label} {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </button>
    </th>
  );

  const renderStatus = (p: Person) => {
    if (p.status === 'removed') {
      return <span className="badge bg-red-500/20 text-red-300">removed</span>;
    }
    if (p.status === 'submitted') {
      return <span className="badge bg-emerald-500/20 text-emerald-300">submitted</span>;
    }
    if (p.status === 'auto_submitted') {
      return <span className="badge bg-cyan-500/20 text-cyan-300">auto-submitted</span>;
    }
    if (p.status === 'in_progress') {
      const leftMs = p.endsAt ? Math.max(0, new Date(p.endsAt).getTime() - now) : 0;
      return (
        <span className="badge bg-amber-500/20 tabular-nums text-amber-300">
          in progress · {mmss(leftMs)} left
        </span>
      );
    }
    return <span className="badge bg-slate-700 text-slate-300">not started</span>;
  };

  return (
    <section className="panel space-y-3 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 pb-0">
        <h2 className="text-lg font-bold text-white">Responses ({people.filter((p) => !p.removed).length})</h2>
        <div className="flex flex-wrap items-center gap-2">
          {teamOptions.length > 0 && (
            <select
              className="field w-auto py-1.5 text-sm"
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              aria-label="Filter by team"
            >
              <option value="">All teams</option>
              {teamOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <input
            className="field max-w-xs py-1.5 text-sm"
            placeholder="Search name or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search by name or email"
          />
        </div>
      </div>

      {err && <p className="px-4 text-sm text-red-300">{err}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs text-slate-400">
            <tr>
              {th('rank', 'Rank')}
              {th('name', 'Name')}
              {th('email', 'Email')}
              {th('team', 'Team')}
              {th('score', 'Score')}
              {th('correct', 'Correct')}
              {th('time', 'Time taken')}
              {th('status', 'Status')}
              {th('submittedAt', 'Submitted at')}
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-400">
                  {people.length ? 'No matching responses.' : 'No responses yet. Share the link or QR code to get started.'}
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.id} className={p.removed ? 'opacity-50' : 'hover:bg-slate-900/40'}>
                <td className="p-3 font-bold tabular-nums text-white">{p.rank ? `#${p.rank}` : '–'}</td>
                <td className="p-3 font-semibold text-white">{p.displayLabel}</td>
                <td className="p-3 text-slate-300">{p.email ?? '–'}</td>
                <td className="p-3 text-slate-300">{p.team ?? '–'}</td>
                <td className="p-3 font-bold tabular-nums text-white">{p.score ?? '–'}</td>
                <td className="p-3 tabular-nums text-slate-300">
                  {p.correctCount !== null ? `${p.correctCount}/${totalQuestions}` : p.status === 'in_progress' ? `${p.answered} ans.` : '–'}
                </td>
                <td className="p-3 tabular-nums text-slate-300">{formatDuration(p.timeTakenMs, true)}</td>
                <td className="p-3">{renderStatus(p)}</td>
                <td className="p-3 whitespace-nowrap text-xs text-slate-400">
                  {p.submittedAt ? new Date(p.submittedAt).toLocaleTimeString() : '–'}
                </td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost px-2 py-1 text-xs" disabled={busy === p.id} onClick={() => rename(p)}>
                      Rename
                    </button>
                    {p.removed ? (
                      <button className="btn-ghost px-2 py-1 text-xs" disabled={busy === p.id} onClick={() => restore(p)}>
                        Restore
                      </button>
                    ) : (
                      <button className="btn-ghost px-2 py-1 text-xs text-red-300" disabled={busy === p.id} onClick={() => remove(p)}>
                        Remove
                      </button>
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

// ---------------------------------------------------------------- exports & question stats
function ResultsPanel({
  sessionId,
  quizTitle,
  theme,
  results,
}: {
  sessionId: string;
  quizTitle: string;
  theme: Theme;
  results: Results;
}) {
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
        url = await toPng(cardRef.current, { pixelRatio: 1, skipFonts: true });
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
        <h2 className="text-lg font-bold text-white">Summary &amp; exports</h2>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/admin/sessions/${sessionId}/export.csv`}>
            ⬇ CSV
          </a>
          <a className="btn-secondary" href={`/api/admin/sessions/${sessionId}/export.xlsx`}>
            ⬇ Excel (.xlsx)
          </a>
          <Link className="btn-secondary" href={`/admin/sessions/${sessionId}/print`} target="_blank">
            🖨 Print view
          </Link>
          <button className="btn-secondary" onClick={downloadImage} disabled={imgBusy || !top.length}>
            {imgBusy ? 'Rendering…' : '🖼 Top 10 image'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Submitted" value={results.summary.total} />
        <Stat label="Average score" value={results.summary.averageScore} />
        <Stat label="Highest score" value={results.summary.highestScore} />
        <Stat
          label="Fastest perfect"
          value={results.summary.fastestPerfect ? formatDuration(results.summary.fastestPerfect.timeTakenMs, true) : '–'}
          sub={results.summary.fastestPerfect?.name}
        />
      </div>

      <div>
        <h3 className="mb-3 font-semibold text-white">Answers per question (submitted attempts)</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {results.questionStats.map((q, i) => (
            <div key={q.questionId} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-sm font-semibold text-white">
                {i + 1}. {q.text}
              </p>
              <p className="mb-3 text-xs text-slate-400">
                {q.correct}/{q.answered} correct ({q.percentCorrect}%)
              </p>
              <div className="space-y-2">
                {q.options.map((o) => (
                  <div key={o.id}>
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>
                        {o.isCorrect ? '✓ ' : ''}
                        {o.text}
                      </span>
                      <span>{o.count}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${o.isCorrect ? 'bg-emerald-500' : 'bg-violet-500'}`}
                        style={{ width: `${(o.count / max(q)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Off-screen Top 10 card rendered to PNG */}
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
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl font-extrabold text-white">
                    {r.rank}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-4xl font-bold leading-tight">{r.name}</div>
                    {r.team && <div className="truncate text-xl opacity-75">{r.team}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-4xl font-extrabold text-accent">{r.score}</div>
                    <div className="text-xl opacity-70">{formatDuration(r.timeTakenMs, true)}</div>
                  </div>
                </div>
              ))}
            </div>
          </ThemeScope>
        </div>
      </div>
    </section>
  );
}
