'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeScope } from '@/components/ThemeScope';
import { FlashXBadge, markVariantForText } from '@/components/brand/FlashXLogo';
import { Spinner } from '@/components/ui/Spinner';
import { QuestionScreen, type SaveState } from './QuestionScreen';
import { useServerClock } from '@/lib/use-server-clock';
import { subscribeToSession } from '@/lib/realtime';
import { resolveTheme } from '@/lib/theme';
import type { PublicQuestion, ScoreVisibility, SessionStatus, StudentPhase, TeamMode, Theme } from '@/lib/types';

interface Info {
  sessionId: string;
  status: SessionStatus;
  isOpen: boolean;
  quizTitle: string;
  description: string | null;
  theme: Partial<Theme>;
  durationSeconds: number;
  questionCount: number;
  teamMode: TeamMode;
  teams: string[];
  emailRequired: boolean;
  scoreVisibility: ScoreVisibility;
}

interface State {
  serverNow: number;
  sessionId: string;
  status: SessionStatus;
  phase: StudentPhase;
  theme?: Partial<Theme>;
  durationSeconds: number;
  totalQuestions: number;
  scoreVisibility: ScoreVisibility;
  endsAt: number | null;
  startedAt: number | null;
  me: {
    id: string;
    name: string;
    email: string | null;
    team: string | null;
    submitted: boolean;
    autoSubmitted: boolean;
    removed: boolean;
    score?: number;
    correctCount?: number;
    maxScore?: number;
  };
  answers?: Record<string, string>;
  questions?: PublicQuestion[];
}

interface Result {
  rank: number | null;
  total: number;
  score: number;
  correctCount: number;
  totalQuestions: number;
  maxScore: number;
  timeTakenMs: number | null;
  review?: {
    questionId: string;
    text: string;
    myOptionId: string | null;
    correctOptionId: string | null;
    options: { id: string; text: string }[];
  }[];
}

class HttpFail extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatLimit(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0 && s > 0) return `${m} min ${s} sec`;
  if (m > 0) return `${m} minute${m === 1 ? '' : 's'}`;
  return `${s} seconds`;
}

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
  const [starting, setStarting] = useState(false);
  const [booted, setBooted] = useState(false);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const pending = useRef(new Map<string, string>());
  const inflight = useRef(new Set<string>());
  const submittingRef = useRef(false);
  const loadingFull = useRef(false);

  const theme = useMemo(() => resolveTheme(state?.theme ?? info?.theme), [state?.theme, info?.theme]);
  const title = theme.eventTitle || info?.quizTitle || 'Quiz';

  // ---- 250ms tick for smooth personal countdown ----
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
    try {
      localStorage.removeItem(storeKey(code));
      localStorage.removeItem(pendingKey(code));
    } catch {
      /* ignore */
    }
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

  // ---- fetch participant state (light by default; full loads saved answers + questions when answering) ----
  const refresh = useCallback(
    async (full = false) => {
      const tk = tokenRef.current;
      if (!tk) return;
      const sentAt = Date.now();
      try {
        const s = await call<State>(`/api/play/${code}/state${full ? '?full=1' : ''}`, tk);
        clock.adopt(s.serverNow, sentAt);
        setOffline(false);
        setState((prev) => ({
          ...(prev ?? ({} as State)),
          ...s,
          answers: s.answers ?? prev?.answers,
          questions: s.phase === 'answering' ? (s.questions ?? prev?.questions) : undefined,
        }));
        if (s.answers) {
          // Preserve optimistic local picks that have not been acknowledged yet
          setAnswers((cur) => ({ ...s.answers, ...cur, ...Object.fromEntries([...pending.current]) }));
        }
        if (s.questions) setQuestions(s.questions);
        else if (s.phase !== 'answering') setQuestions(null);
        return s;
      } catch (e) {
        if (e instanceof HttpFail && (e.status === 404 || e.status === 401)) {
          // Session reset or invalid token: return cleanly to Details screen
          forget();
          await loadInfo();
        } else {
          setOffline(true);
        }
      }
    },
    [clock, code, forget, loadInfo],
  );

  // ---- boot (restore localStorage token + unsaved answers on refresh) ----
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

  // ---- realtime hint ----
  useEffect(() => {
    if (!info?.sessionId) return;
    const off = subscribeToSession(info.sessionId, () => {
      if (tokenRef.current) refresh();
      else loadInfo();
    });
    return off;
  }, [info?.sessionId, refresh, loadInfo]);

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
            await call(`/api/play/${code}/answer`, tokenRef.current, {
              method: 'PUT',
              body: JSON.stringify({ questionId: qid, optionId: oid }),
            });
            if (pending.current.get(qid) === oid) pending.current.delete(qid);
            attempt = 0;
            setOffline(false);
            persistPending();
          } catch (e) {
            if (!isNetwork(e)) {
              // Server refused permanently (locked, time up, removed): stop retrying and resync
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

  // ---- phase-aware polling (10s in `submitted` per spec so published results appear without refresh) ----
  const currentPhase: StudentPhase = !token || !state ? 'details' : state.phase;
  useEffect(() => {
    const intervalMs =
      currentPhase === 'answering'
        ? 5_000
        : currentPhase === 'ready'
          ? 8_000
          : currentPhase === 'submitted'
            ? 10_000
            : 10_000;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (tokenRef.current) refresh();
      else loadInfo();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden) {
        if (tokenRef.current) refresh();
        else loadInfo();
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
  }, [currentPhase, refresh, loadInfo, flushAll]);

  // Load questions when entering `answering`; load final result when entering `results` (unless score_visibility === 'never').
  useEffect(() => {
    if (!state || !token) return;
    if (state.phase === 'answering' && !questions && !loadingFull.current) {
      loadingFull.current = true;
      refresh(true).finally(() => (loadingFull.current = false));
    }
    if (state.phase === 'results' && state.scoreVisibility !== 'never' && !result && !state.me.removed) {
      let cancelled = false;
      let retryId: ReturnType<typeof setTimeout> | undefined;
      const loadResult = () => {
        call<Result>(`/api/play/${code}/result`, token)
          .then((r) => !cancelled && setResult(r))
          .catch((err) => {
            if (!cancelled && isNetwork(err)) retryId = setTimeout(loadResult, 2000);
          });
      };
      loadResult();
      return () => {
        cancelled = true;
        clearTimeout(retryId);
      };
    }
  }, [state?.phase, state?.scoreVisibility, state?.me.removed, questions, result, token, code, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Auto-submit when the participant's personal server-corrected countdown hits zero.
  const endsAt = state?.endsAt ?? null;
  const answering = state?.phase === 'answering';
  useEffect(() => {
    if (!answering || !endsAt) return;
    const wait = Math.max(0, endsAt - clock.now());
    const id = setTimeout(() => submit(true), wait + 50);
    return () => clearTimeout(id);
  }, [answering, endsAt, clock, submit]);

  // ---- Section 1: Details submit -> POST /api/join/[code] ----
  const join = async (payload: { name: string; email?: string; team?: string }) => {
    const data = await call<{ deviceToken: string; participantId: string; resumed?: boolean }>(`/api/join/${code}`, null, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    try {
      localStorage.setItem(storeKey(code), JSON.stringify({ deviceToken: data.deviceToken, participantId: data.participantId }));
    } catch {
      /* ignore private-mode quota errors */
    }
    tokenRef.current = data.deviceToken;
    setToken(data.deviceToken);
    await refresh(true);
  };

  // ---- Section 2: Instructions Start button -> POST /api/play/[code]/begin ----
  const beginQuiz = async () => {
    if (starting) return;
    setStarting(true);
    const sentAt = Date.now();
    try {
      const res = await call<{ startedAt: number; endsAt: number; serverNow: number }>(`/api/play/${code}/begin`, tokenRef.current, {
        method: 'POST',
        body: '{}',
      });
      clock.adopt(res.serverNow, sentAt);
      await refresh(true);
    } catch (e) {
      await refresh(true);
      throw e;
    } finally {
      setStarting(false);
    }
  };

  // ------------------------------------------------------------------ render
  void tick;
  const remainingMs = endsAt ? endsAt - clock.now() : 0;
  const totalMs =
    state?.endsAt && state?.startedAt
      ? state.endsAt - state.startedAt
      : (state?.durationSeconds ?? info?.durationSeconds ?? 0) * 1000;
  const saveState: SaveState = offline ? 'offline' : pendingCount > 0 || submitting ? 'saving' : 'saved';

  let body: React.ReactNode;
  if (fatal === 'notfound') {
    body = <Message icon="🔍" title="Quiz not found" text="Check the link or join code and try again." />;
  } else if (fatal === 'error') {
    body = (
      <Message
        icon="📡"
        title="Can't reach the quiz"
        text="Check your internet connection and try again."
        action={{ label: 'Try again', onClick: () => location.reload() }}
      />
    );
  } else if (!booted || !info) {
    body = <Loading />;
  } else if (!token || !state) {
    if (!info.isOpen) {
      body = <Message icon="🔒" title="This quiz is closed." />;
    } else {
      body = <DetailsForm info={info} title={title} logo={theme.logoUrl} onJoin={join} onClosed={loadInfo} />;
    }
  } else if (state.phase === 'removed') {
    body = <Message icon="🚫" title="You have been removed" text="Please speak to the organiser if this is a mistake." />;
  } else if (state.phase === 'closed') {
    body = <Message icon="🔒" title="This quiz is closed." />;
  } else if (state.phase === 'ready') {
    body = (
      <InstructionsScreen
        title={title}
        logo={theme.logoUrl}
        description={info.description}
        name={state.me.name}
        team={state.me.team}
        questionCount={state.totalQuestions || info.questionCount}
        durationSeconds={state.durationSeconds || info.durationSeconds}
        starting={starting}
        onStart={beginQuiz}
      />
    );
  } else if (state.phase === 'answering') {
    if (submitting) {
      body = <Message icon="📤" title="Submitting…" text="Hold on, saving your answers." spinner />;
    } else if (!questions) {
      body = <Loading label="Loading questions…" />;
    } else if (remainingMs <= 0) {
      body = <Message icon="⏰" title="Time is up." text="Submitting your answers…" spinner />;
    } else {
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
    }
  } else if (state.phase === 'submitted') {
    body = <SubmittedScreen title={title} logo={theme.logoUrl} state={state} />;
  } else {
    // state.phase === 'results'
    if (state.scoreVisibility === 'never') {
      body = <Message icon="🎉" title="Thank you!" text="Your response has been recorded." />;
    } else {
      body = <ResultScreen title={title} result={result} name={state.me.name} team={state.me.team} />;
    }
  }

  // Subtle brand footer on every screen except the questions, which stay uncluttered. The quiz's own branding stays primary.
  const showPoweredBy = booted && !!info && state?.phase !== 'answering';

  return (
    <ThemeScope theme={theme} className={`relative min-h-[100dvh] ${showPoweredBy ? 'pb-8' : ''}`}>
      {body}
      {showPoweredBy && (
        <footer className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center text-[11px] opacity-60">
          <FlashXBadge variant={markVariantForText(theme.textColor)} prefix="Powered by" />
        </footer>
      )}
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
          <button
            onClick={p.action.onClick}
            className="mt-6 min-h-[52px] select-none rounded-xl bg-primary px-6 text-base font-bold text-white shadow-lg transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] active:duration-75"
          >
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

function DetailsForm({
  info,
  title,
  logo,
  onJoin,
  onClosed,
}: {
  info: Info;
  title: string;
  logo: string;
  onJoin: (payload: { name: string; email?: string; team?: string }) => Promise<void>;
  onClosed: () => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [team, setTeam] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; team?: string }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { name?: string; email?: string; team?: string } = {};
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanTeam = team.trim();

    if (cleanName.length < 2 || cleanName.length > 60) {
      errs.name = 'Name must be 2 to 60 characters.';
    }
    if (info.emailRequired && !cleanEmail) {
      errs.email = 'Email is required.';
    } else if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
      errs.email = 'Enter a valid email address.';
    }
    if (info.teamMode === 'list' && !cleanTeam) {
      errs.team = 'Please select your team.';
    } else if (info.teamMode === 'free' && !cleanTeam) {
      errs.team = 'Team name is required.';
    }

    setFieldErrors(errs);
    setError('');
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      await onJoin({
        name: cleanName,
        email: cleanEmail || undefined,
        team: info.teamMode === 'off' ? undefined : cleanTeam,
      });
    } catch (err) {
      if (err instanceof HttpFail) {
        if (err.code === 'closed') {
          setError('This quiz is closed.');
          await onClosed();
        } else if (err.code === 'already_submitted') {
          setFieldErrors({ email: 'This email has already completed the quiz.' });
        } else if (err.code === 'invalid_email' || err.code === 'email_required') {
          setFieldErrors({ email: err.message });
        } else if (err.code === 'invalid_name' || err.code === 'name_not_allowed') {
          setFieldErrors({ name: err.message });
        } else if (err.code === 'team_required' || err.code === 'invalid_team' || err.code === 'team_not_allowed') {
          setFieldErrors({ team: err.message });
        } else {
          setError(err.message);
        }
      } else {
        setError('Could not continue. Check your connection and try again.');
      }
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-5">
      <form onSubmit={submit} noValidate className="w-full max-w-sm animate-fadeUp space-y-4">
        <Brand title={title} logo={logo} />
        {info.description && <p className="text-center text-sm opacity-80">{info.description}</p>}

        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-semibold">
            Full name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
            }}
            maxLength={60}
            autoComplete="name"
            autoFocus
            placeholder="e.g. Rahul Sharma"
            aria-invalid={!!fieldErrors.name}
            className="h-14 w-full rounded-xl border-2 border-ink/20 bg-ink/10 px-4 text-lg text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
          />
          {fieldErrors.name && (
            <p role="alert" className="mt-1 text-xs font-semibold text-bad">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">
            Email {!info.emailRequired && <span className="opacity-60">(optional)</span>}
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
            }}
            maxLength={254}
            autoComplete="email"
            autoCapitalize="none"
            placeholder="you@college.edu"
            aria-invalid={!!fieldErrors.email}
            className="h-14 w-full rounded-xl border-2 border-ink/20 bg-ink/10 px-4 text-lg text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
          />
          {fieldErrors.email && (
            <p role="alert" className="mt-1 text-xs font-semibold text-bad">
              {fieldErrors.email}
            </p>
          )}
        </div>

        {info.teamMode === 'list' && (
          <div>
            <label htmlFor="team" className="mb-1.5 block text-sm font-semibold">
              Team
            </label>
            <select
              id="team"
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                if (fieldErrors.team) setFieldErrors((p) => ({ ...p, team: undefined }));
              }}
              aria-invalid={!!fieldErrors.team}
              className="h-14 w-full rounded-xl border-2 border-ink/20 bg-ink/10 px-4 text-lg text-ink focus:border-accent focus:outline-none"
            >
              <option value="" className="bg-slate-900 text-slate-300">
                Select your team…
              </option>
              {info.teams.map((t) => (
                <option key={t} value={t} className="bg-slate-900 text-white">
                  {t}
                </option>
              ))}
            </select>
            {fieldErrors.team && (
              <p role="alert" className="mt-1 text-xs font-semibold text-bad">
                {fieldErrors.team}
              </p>
            )}
          </div>
        )}

        {info.teamMode === 'free' && (
          <div>
            <label htmlFor="team" className="mb-1.5 block text-sm font-semibold">
              Team
            </label>
            <input
              id="team"
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                if (fieldErrors.team) setFieldErrors((p) => ({ ...p, team: undefined }));
              }}
              maxLength={80}
              placeholder="e.g. Team Alpha"
              aria-invalid={!!fieldErrors.team}
              className="h-14 w-full rounded-xl border-2 border-ink/20 bg-ink/10 px-4 text-lg text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
            />
            {fieldErrors.team && (
              <p role="alert" className="mt-1 text-xs font-semibold text-bad">
                {fieldErrors.team}
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-bad/20 p-3 text-sm font-semibold">
            ⚠ {error}
          </p>
        )}

        <button
          disabled={busy}
          aria-busy={busy}
          className="inline-flex h-16 w-full select-none items-center justify-center gap-2.5 rounded-2xl bg-primary text-xl font-extrabold text-white shadow-lg transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] enabled:hover:-translate-y-0.5 enabled:hover:shadow-xl enabled:active:translate-y-0 enabled:active:scale-[0.97] enabled:active:duration-75 disabled:opacity-60 aria-[busy=true]:opacity-90"
        >
          {busy ? (
            <>
              <Spinner className="h-5 w-5" />
              Checking…
            </>
          ) : (
            'Next →'
          )}
        </button>
      </form>
    </div>
  );
}

function InstructionsScreen({
  title,
  logo,
  description,
  name,
  team,
  questionCount,
  durationSeconds,
  starting,
  onStart,
}: {
  title: string;
  logo: string;
  description: string | null;
  name: string;
  team: string | null;
  questionCount: number;
  durationSeconds: number;
  starting: boolean;
  onStart: () => Promise<void>;
}) {
  const [error, setError] = useState('');

  const handleStart = async () => {
    setError('');
    try {
      await onStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start. Please try again.');
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-5">
      <div className="w-full max-w-md animate-fadeUp space-y-6">
        <Brand title={title} logo={logo} />

        <div className="rounded-2xl border border-ink/15 bg-ink/10 p-5 text-center">
          <p className="text-lg font-bold">Hi, {name}!</p>
          {team && <p className="mt-0.5 text-sm font-semibold text-accent">Team: {team}</p>}
          {description && <p className="mt-2 text-sm opacity-80">{description}</p>}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-ink/10 p-3">
              <div className="text-2xl font-extrabold">{questionCount}</div>
              <div className="text-xs font-semibold uppercase tracking-wider opacity-70">
                Question{questionCount === 1 ? '' : 's'}
              </div>
            </div>
            <div className="rounded-xl bg-ink/10 p-3">
              <div className="text-2xl font-extrabold">{formatLimit(durationSeconds)}</div>
              <div className="text-xs font-semibold uppercase tracking-wider opacity-70">Time limit</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-ink/15 bg-ink/5 p-5 text-sm leading-relaxed opacity-90">
          <h2 className="mb-2 text-base font-bold">Before you start</h2>
          <p>
            Your timer starts when you press <b>Start</b>. It keeps running if you close the page. Answers save automatically. You will be submitted when the time runs out.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-bad/20 p-3 text-sm font-semibold">
            ⚠ {error}
          </p>
        )}

        <button
          onClick={handleStart}
          disabled={starting}
          aria-busy={starting}
          className="inline-flex h-16 w-full select-none items-center justify-center gap-2.5 rounded-2xl bg-primary text-xl font-extrabold text-white shadow-lg transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] enabled:hover:-translate-y-0.5 enabled:hover:shadow-xl enabled:active:translate-y-0 enabled:active:scale-[0.97] enabled:active:duration-75 disabled:opacity-60 aria-[busy=true]:opacity-90"
        >
          {starting ? (
            <>
              <Spinner className="h-5 w-5" />
              Starting…
            </>
          ) : (
            'Start'
          )}
        </button>
      </div>
    </div>
  );
}

function SubmittedScreen({ title, logo, state }: { title: string; logo: string; state: State }) {
  const { scoreVisibility, me, totalQuestions } = state;

  if (scoreVisibility === 'never') {
    return (
      <Message
        icon="🎉"
        title="Thank you!"
        text={me.autoSubmitted ? 'Time ran out and your answers were submitted automatically.' : 'Your response has been recorded.'}
      />
    );
  }

  if (scoreVisibility === 'immediate') {
    const score = me.score ?? 0;
    const maxScore = me.maxScore ?? totalQuestions;
    const correct = me.correctCount ?? 0;
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-6 p-5 text-center">
        <Brand title={title} logo={logo} />
        <div className="w-full animate-fadeUp space-y-4">
          <div className="text-5xl" aria-hidden>
            {me.autoSubmitted ? '⏰' : '✅'}
          </div>
          <h2 className="text-2xl font-bold">{me.autoSubmitted ? 'Time is up — submitted!' : 'Submitted!'}</h2>
          {me.team && <p className="text-sm font-semibold text-accent">Team: {me.team}</p>}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Stat label="Score" value={`${score}/${maxScore}`} />
            <Stat label="Correct" value={`${correct}/${totalQuestions}`} />
          </div>
          <p className="pt-2 text-sm opacity-80">Rank and full results will appear here once published.</p>
        </div>
      </div>
    );
  }

  // Default: 'after_publish'
  return (
    <Message
      icon={me.autoSubmitted ? '⏰' : '✅'}
      title="Submitted. Results will be announced."
      text={
        me.autoSubmitted
          ? 'Your time ran out and your saved answers were submitted automatically. Keep this page open or check back once results are published.'
          : 'Your answers have been saved. Results and rankings will appear here once published.'
      }
    />
  );
}

function Confirm({
  answered,
  total,
  onCancel,
  onConfirm,
}: {
  answered: number;
  total: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const unanswered = total - answered;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-modalBackdrop items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="w-full max-w-sm animate-modalPop rounded-2xl bg-slate-900 p-5 text-white shadow-2xl">
        <h2 id="confirm-title" className="text-xl font-bold">
          You have answered {answered} of {total}. Submit now?
        </h2>
        {unanswered > 0 && (
          <p className="mt-2 text-sm text-amber-300">
            ⚠ {unanswered} question{unanswered > 1 ? 's are' : ' is'} unanswered. You cannot change answers after submitting.
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="min-h-[52px] select-none rounded-xl bg-white/10 text-base font-semibold transition-all duration-150 hover:bg-white/15 active:scale-[0.97]"
          >
            Keep going
          </button>
          <button
            onClick={onConfirm}
            className="min-h-[52px] select-none rounded-xl bg-cyan-400 text-base font-bold text-black shadow-md transition-all duration-150 hover:bg-cyan-300 active:scale-[0.97]"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultScreen({ title, result, name, team }: { title: string; result: Result | null; name: string; team: string | null }) {
  if (!result) return <Loading label="Loading your result…" />;
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-6 p-5">
      <div className="animate-fadeUp pt-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest opacity-70">{title}</p>
        <h1 className="mt-1 text-2xl font-bold">Well played, {name}!</h1>
        {team && <p className="mt-0.5 text-sm font-semibold text-accent">{team}</p>}
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
