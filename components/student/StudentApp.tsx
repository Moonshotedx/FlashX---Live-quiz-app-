'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeScope } from '@/components/ThemeScope';
import { QuestionScreen, type SaveState } from './QuestionScreen';
import { useServerClock } from '@/lib/use-server-clock';
import { subscribeToSession } from '@/lib/realtime';
import { resolveTheme } from '@/lib/theme';
import type { PublicQuestion, RollMode, SessionStatus, Theme } from '@/lib/types';

interface Info {
  sessionId: string;
  status: SessionStatus;
  quizTitle: string;
  theme: Partial<Theme>;
  rollNumberMode: RollMode;
  rollNumberLabel: string;
  allowLateJoin: boolean;
}
interface State {
  serverNow: number;
  status: SessionStatus;
  theme?: Partial<Theme>;
  endsAt: number | null;
  startedAt: number | null;
  me: { id: string; name: string; rollNumber: string | null; submitted: boolean; autoSubmitted: boolean; removed: boolean };
  answers?: Record<string, string>;
  questions?: PublicQuestion[];
  totalQuestions?: number;
}
interface Result {
  rank: number | null;
  total: number;
  score: number;
  correctCount: number;
  totalQuestions: number;
  maxScore: number;
  timeTakenMs: number | null;
  review?: { questionId: string; text: string; myOptionId: string | null; correctOptionId: string | null; options: { id: string; text: string }[] }[];
}

class HttpFail extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function call<T>(url: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-device-token': token } : {}), ...init.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpFail(res.status, data.error ?? 'error', data.message ?? res.statusText);
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const storeKey = (code: string) => `quiz:${code}:participant`;
const pendingKey = (code: string) => `quiz:${code}:pending`;
const isNetwork = (e: unknown) => !(e instanceof HttpFail) || e.status >= 500 || e.status === 429 || e.status === 408;

export function StudentApp({ code }: { code: string }) {
  const clock = useServerClock();
  const [info, setInfo] = useState<Info | null>(null);
  const [fatal, setFatal] = useState<'notfound' | 'error' | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [tick, setTick] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [booted, setBooted] = useState(false);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const pending = useRef(new Map<string, string>());
  const inflight = useRef(new Set<string>());
  const submittingRef = useRef(false);
  const questionsRef = useRef<PublicQuestion[] | null>(null);
  questionsRef.current = questions;
  const loadingFull = useRef(false);

  const theme = useMemo(() => resolveTheme(state?.theme ?? info?.theme), [state?.theme, info?.theme]);
  const title = theme.eventTitle || info?.quizTitle || 'Live Quiz';

  // ---- 250ms tick for the countdown ----
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const data = await call<Info>(`/api/join/${code}`, null);
      setInfo(data);
      return data;
    } catch (e) {
      setFatal(e instanceof HttpFail && e.status === 404 ? 'notfound' : 'error');
      return null;
    }
  }, [code]);

  const forget = useCallback(() => {
    localStorage.removeItem(storeKey(code));
    localStorage.removeItem(pendingKey(code));
    pending.current.clear();
    setPendingCount(0);
    setToken(null);
    setState(null);
    setQuestions(null);
    setAnswers({});
    setResult(null);
    setIndex(0);
    setConfirming(false);
    setSubmitting(false);
    submittingRef.current = false;
  }, [code]);

  const persistPending = () => {
    try {
      localStorage.setItem(pendingKey(code), JSON.stringify([...pending.current]));
    } catch {
      /* storage may be unavailable (private mode) */
    }
    setPendingCount(pending.current.size);
  };

  // ---- fetch state (light by default; full loads answers + questions) ----
  const refresh = useCallback(
    async (full = false) => {
      const tk = tokenRef.current;
      if (!tk) return;
      const sentAt = Date.now();
      try {
        const s = await call<State>(`/api/play/${code}/state${full ? '?full=1' : ''}`, tk);
        clock.adopt(s.serverNow, sentAt);
        setOffline(false);
        setState((prev) => ({ ...(prev ?? ({} as State)), ...s, answers: s.answers ?? prev?.answers, questions: s.questions ?? prev?.questions }));
        if (s.answers) {
          // keep optimistic local picks that have not been saved yet
          setAnswers((cur) => ({ ...s.answers, ...cur, ...Object.fromEntries([...pending.current]) }));
        }
        if (s.questions) setQuestions(s.questions);
        return s;
      } catch (e) {
        if (e instanceof HttpFail && e.status === 404) {
          // Session reset or code gone: back to the join screen
          forget();
          await loadInfo();
        } else setOffline(true);
      }
    },
    [clock, code, forget, loadInfo],
  );

  // ---- boot ----
  useEffect(() => {
    (async () => {
      const data = await loadInfo();
      if (!data) return setBooted(true);
      const saved = (() => {
        try {
          return JSON.parse(localStorage.getItem(storeKey(code)) ?? 'null') as { deviceToken: string } | null;
        } catch {
          return null;
        }
      })();
      if (saved?.deviceToken) {
        tokenRef.current = saved.deviceToken;
        setToken(saved.deviceToken);
        try {
          const raw = JSON.parse(localStorage.getItem(pendingKey(code)) ?? '[]') as [string, string][];
          raw.forEach(([q, o]) => pending.current.set(q, o));
          setPendingCount(pending.current.size);
        } catch {
          /* ignore */
        }
        await refresh(true);
      }
      setBooted(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---- realtime hint + 4s polling fallback ----
  useEffect(() => {
    if (!info?.sessionId) return;
    const off = subscribeToSession(info.sessionId, () => {
      if (tokenRef.current) refresh();
      else loadInfo();
    });
    return off;
  }, [info?.sessionId, refresh, loadInfo]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      if (tokenRef.current) refresh();
      else loadInfo();
    }, 4000);
    const onVisible = () => {
      if (!document.hidden) {
        if (tokenRef.current) refresh();
        flushAll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, loadInfo]);

  // Load the questions once the quiz goes live; the result once revealed (retrying on flaky Wi-Fi).
  useEffect(() => {
    if (!state || !token) return;
    if (state.status === 'live' && !state.me.submitted && !questions && !loadingFull.current) {
      loadingFull.current = true;
      refresh(true).finally(() => (loadingFull.current = false));
    }
    if (state.status === 'revealed' && !result && !state.me.removed) {
      let cancelled = false;
      let retryId: ReturnType<typeof setTimeout> | undefined;
      const loadResult = () => {
        call<Result>(`/api/play/${code}/result`, token)
          .then((r) => !cancelled && setResult(r))
          .catch(() => {
            if (!cancelled) retryId = setTimeout(loadResult, 2000);
          });
      };
      loadResult();
      return () => {
        cancelled = true;
        clearTimeout(retryId);
      };
    }
  }, [state?.status, state?.me.submitted, state?.me.removed, questions, result, token, code]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- answer saving: optimistic, queued per question, retried with backoff ----
  const flush = useCallback(
    async (qid: string) => {
      if (inflight.current.has(qid)) return;
      inflight.current.add(qid);
      let attempt = 0;
      try {
        while (pending.current.has(qid)) {
          const oid = pending.current.get(qid)!;
          try {
            await call(`/api/play/${code}/answer`, tokenRef.current, { method: 'PUT', body: JSON.stringify({ questionId: qid, optionId: oid }) });
            if (pending.current.get(qid) === oid) pending.current.delete(qid);
            attempt = 0;
            setOffline(false);
            persistPending();
          } catch (e) {
            if (!isNetwork(e)) {
              // The server refused for good (locked, time up, removed): stop retrying and resync.
              pending.current.delete(qid);
              persistPending();
              refresh();
              break;
            }
            setOffline(true);
            attempt++;
            await sleep(Math.min(8000, 500 * 2 ** Math.min(attempt, 5)) * (0.7 + Math.random() * 0.6));
          }
        }
      } finally {
        inflight.current.delete(qid);
      }
    },
    [code, refresh], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const flushAll = useCallback(() => {
    for (const qid of pending.current.keys()) flush(qid);
  }, [flush]);

  useEffect(() => {
    if (token && pending.current.size) flushAll();
  }, [token, flushAll]);

  const select = (qid: string, oid: string) => {
    setAnswers((a) => ({ ...a, [qid]: oid }));
    pending.current.set(qid, oid);
    persistPending();
    flush(qid);
  };

  // ---- submit ----
  const submit = useCallback(
    async (auto: boolean) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setConfirming(false);
      // Give unsaved picks a moment to reach the server first.
      const until = Date.now() + (auto ? 1500 : 4000);
      while (pending.current.size && Date.now() < until) await sleep(100);
      for (let attempt = 0; attempt < 25; attempt++) {
        try {
          await call(`/api/play/${code}/submit`, tokenRef.current, { method: 'POST', body: JSON.stringify({ auto }) });
          break;
        } catch (e) {
          if (!isNetwork(e)) break;
          await sleep(Math.min(4000, 400 * 2 ** Math.min(attempt, 4)));
        }
      }
      await refresh(true);
      setSubmitting(false);
      submittingRef.current = false;
    },
    [code, refresh],
  );

  // Auto-submit exactly when the server-corrected countdown reaches zero.
  const endsAt = state?.endsAt ?? null;
  const live = state?.status === 'live' && !state.me.submitted && !state.me.removed;
  useEffect(() => {
    if (!live || !endsAt) return;
    const wait = Math.max(0, endsAt - clock.now());
    const id = setTimeout(() => submit(true), wait + 50);
    return () => clearTimeout(id);
  }, [live, endsAt, clock, submit]);

  // ---- join ----
  const join = async (name: string, rollNumber: string) => {
    const data = await call<{ deviceToken: string; participantId: string }>(`/api/join/${code}`, null, {
      method: 'POST',
      body: JSON.stringify({ name, rollNumber: rollNumber || undefined }),
    });
    localStorage.setItem(storeKey(code), JSON.stringify({ deviceToken: data.deviceToken, participantId: data.participantId, name }));
    tokenRef.current = data.deviceToken;
    setToken(data.deviceToken);
    await refresh(true);
  };

  // ------------------------------------------------------------------ render
  void tick;
  const remainingMs = endsAt ? endsAt - clock.now() : 0;
  const totalMs = state?.endsAt && state?.startedAt ? state.endsAt - state.startedAt : (info ? 0 : 0);
  const saveState: SaveState = offline ? 'offline' : pendingCount > 0 || submitting ? 'saving' : 'saved';

  let body: React.ReactNode;
  if (fatal === 'notfound') body = <Message icon="🔍" title="Quiz not found" text="Check the join code and try again, or ask the host for a new QR code." />;
  else if (fatal === 'error') body = <Message icon="📡" title="Can't reach the quiz" text="Check your connection. We will keep trying." action={{ label: 'Try again', onClick: () => location.reload() }} />;
  else if (!booted || !info) body = <Loading />;
  else if (!token || !state) {
    if (info.status === 'ended' || info.status === 'revealed') body = <Message icon="🏁" title="This quiz has ended." />;
    else if (info.status === 'live' && !info.allowLateJoin) body = <Message icon="⏳" title="This quiz has already started." />;
    else body = <JoinForm info={info} title={title} logo={theme.logoUrl} onJoin={join} late={info.status === 'live'} />;
  } else if (state.me.removed) body = <Message icon="🚫" title="You have been removed" text="Please speak to the host if this is a mistake." />;
  else if (state.status === 'lobby') body = <Waiting title={title} logo={theme.logoUrl} name={state.me.name} />;
  else if (state.status === 'live' && !state.me.submitted && !submitting) {
    if (!questions) body = <Loading label="Loading questions…" />;
    else if (remainingMs <= 0) body = <Message icon="⏰" title="Time is up." text="Submitting your answers…" spinner />;
    else
      body = (
        <>
          <QuestionScreen
            questions={questions}
            index={Math.min(index, questions.length - 1)}
            answers={answers}
            remainingMs={remainingMs}
            totalMs={totalMs}
            saveState={saveState}
            onSelect={select}
            onJump={setIndex}
            onSubmit={() => setConfirming(true)}
          />
          {confirming && (
            <Confirm
              answered={questions.filter((q) => answers[q.id]).length}
              total={questions.length}
              onCancel={() => setConfirming(false)}
              onConfirm={() => submit(false)}
            />
          )}
        </>
      );
  } else if (state.status === 'revealed') body = <ResultScreen title={title} result={result} name={state.me.name} />;
  else if (submitting && !state.me.submitted) body = <Message icon="📤" title="Submitting…" text="Hold on, saving your answers." spinner />;
  else if (state.me.autoSubmitted) body = <Message icon="⏰" title="Time is up." text="Your answers have been submitted. Watch the screen for results." />;
  else body = <Message icon="✅" title="Submitted." text="Watch the screen for results." />;

  return (
    <ThemeScope theme={theme} className="min-h-[100dvh]">
      {body}
    </ThemeScope>
  );
}

// ---------------------------------------------------------------- screens
function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-ink/20 border-t-accent" />
        <p className="text-base opacity-80">{label}</p>
      </div>
    </div>
  );
}

function Message(p: { icon: string; title: string; text?: string; spinner?: boolean; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6 text-center">
      <div className="max-w-sm animate-fadeUp">
        <div className="mb-4 text-6xl" aria-hidden>
          {p.icon}
        </div>
        <h1 className="text-2xl font-bold">{p.title}</h1>
        {p.text && <p className="mt-3 text-base opacity-80">{p.text}</p>}
        {p.spinner && <div className="mx-auto mt-5 h-8 w-8 animate-spin rounded-full border-4 border-ink/20 border-t-accent" />}
        {p.action && (
          <button onClick={p.action.onClick} className="mt-6 min-h-[52px] rounded-xl bg-primary px-6 text-base font-bold text-white">
            {p.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function Brand({ title, logo }: { title: string; logo: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo && <img src={logo} alt="" className="max-h-20 max-w-[60%] object-contain" />}
      <h1 className="text-2xl font-extrabold leading-tight">{title}</h1>
    </div>
  );
}

function JoinForm({ info, title, logo, onJoin, late }: { info: Info; title: string; logo: string; onJoin: (n: string, r: string) => Promise<void>; late: boolean }) {
  const [name, setName] = useState('');
  const [roll, setRoll] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rollOn = info.rollNumberMode !== 'off';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2 || n.length > 30) return setError('Name must be 2 to 30 characters.');
    if (info.rollNumberMode === 'required' && !roll.trim()) return setError(`${info.rollNumberLabel} is required.`);
    setBusy(true);
    setError('');
    try {
      await onJoin(n, roll.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm animate-fadeUp space-y-5">
        <Brand title={title} logo={logo} />
        {late && <p className="rounded-xl bg-ink/10 p-3 text-center text-sm">The quiz is already running. You will get the remaining time.</p>}
        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-semibold">
            Your name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            autoComplete="name"
            autoFocus
            placeholder="e.g. Rahul"
            className="h-14 w-full rounded-xl border-2 border-ink/20 bg-ink/10 px-4 text-lg text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
          />
        </div>
        {rollOn && (
          <div>
            <label htmlFor="roll" className="mb-1.5 block text-sm font-semibold">
              {info.rollNumberLabel} {info.rollNumberMode === 'optional' && <span className="opacity-60">(optional)</span>}
            </label>
            <input
              id="roll"
              value={roll}
              onChange={(e) => setRoll(e.target.value)}
              maxLength={30}
              autoCapitalize="characters"
              className="h-14 w-full rounded-xl border-2 border-ink/20 bg-ink/10 px-4 text-lg text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-bad/20 p-3 text-sm font-semibold">
            ⚠ {error}
          </p>
        )}
        <button
          disabled={busy}
          className="h-16 w-full rounded-2xl bg-primary text-xl font-extrabold text-white shadow-lg transition active:scale-[.98] disabled:opacity-60"
        >
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>
    </div>
  );
}

function Waiting({ title, logo, name }: { title: string; logo: string; name: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 p-6 text-center">
      <Brand title={title} logo={logo} />
      <div className="relative flex h-28 w-28 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-accent/40 animate-pulseRing" />
        <span className="absolute inset-0 rounded-full bg-accent/40 animate-pulseRing [animation-delay:.9s]" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary text-3xl animate-floaty">🙌</span>
      </div>
      <div>
        <p className="text-xl font-bold">You are in, {name}.</p>
        <p className="mt-1 text-base opacity-80">Waiting for the host to start.</p>
      </div>
    </div>
  );
}

function Confirm({ answered, total, onCancel, onConfirm }: { answered: number; total: number; onCancel: () => void; onConfirm: () => void }) {
  const unanswered = total - answered;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-sm animate-fadeUp rounded-2xl bg-slate-900 p-5 text-white shadow-2xl">
        <h2 id="confirm-title" className="text-xl font-bold">
          You have answered {answered} of {total}. Submit now?
        </h2>
        {unanswered > 0 && (
          <p className="mt-2 text-sm text-amber-300">⚠ {unanswered} question{unanswered > 1 ? 's are' : ' is'} unanswered. You cannot change answers after submitting.</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onCancel} className="min-h-[52px] rounded-xl bg-white/10 text-base font-semibold">
            Keep going
          </button>
          <button onClick={onConfirm} className="min-h-[52px] rounded-xl bg-cyan-400 text-base font-bold text-black">
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultScreen({ title, result, name }: { title: string; result: Result | null; name: string }) {
  if (!result) return <Loading label="Loading your result…" />;
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-6 p-5">
      <div className="animate-fadeUp pt-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest opacity-70">{title}</p>
        <h1 className="mt-1 text-2xl font-bold">Well played, {name}!</h1>
        <div className="mt-6 rounded-3xl bg-primary p-6 text-white shadow-xl">
          <p className="text-sm font-semibold uppercase tracking-wider opacity-80">Your rank</p>
          <p className="text-6xl font-extrabold">{result.rank ? `#${result.rank}` : '–'}</p>
          <p className="mt-1 text-lg font-semibold">{result.rank ? `Rank ${result.rank} of ${result.total}` : 'Not ranked'}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Score" value={`${result.score}/${result.maxScore}`} />
          <Stat label="Correct" value={`${result.correctCount}/${result.totalQuestions}`} />
        </div>
      </div>
      {result.review && (
        <section aria-label="Answer review" className="space-y-3 pb-8">
          <h2 className="text-lg font-bold">Review</h2>
          {result.review.map((r, i) => {
            const right = r.myOptionId && r.myOptionId === r.correctOptionId;
            const mine = r.options.find((o) => o.id === r.myOptionId)?.text;
            const correct = r.options.find((o) => o.id === r.correctOptionId)?.text;
            return (
              <div key={r.questionId} className="rounded-xl border border-ink/15 bg-ink/5 p-4">
                <p className="text-sm font-semibold opacity-70">
                  Question {i + 1} {right ? '✓ Correct' : r.myOptionId ? '✗ Wrong' : '– Not answered'}
                </p>
                <p className="mt-1 font-semibold">{r.text}</p>
                <p className="mt-2 text-sm">
                  Your answer: <span className={right ? 'font-bold text-ok' : 'font-bold text-bad'}>{mine ?? 'None'}</span>
                </p>
                {!right && (
                  <p className="text-sm">
                    Correct answer: <span className="font-bold text-ok">{correct}</span>
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-ink/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-extrabold">{value}</p>
    </div>
  );
}

