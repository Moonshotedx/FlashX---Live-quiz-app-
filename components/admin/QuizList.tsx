'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { api, ApiError } from '@/lib/client-api';
import { Spinner } from '@/components/ui/Spinner';

export interface QuizLinkSummary {
  id: string;
  joinCode: string;
  status: string;
  submittedCount: number;
  createdAt: string;
}

export interface QuizItem {
  id: string;
  title: string;
  updated_at: string;
  duration_seconds: number;
  questionCount: number;
  openLinks: QuizLinkSummary[];
}

export interface SessionItem {
  id: string;
  quizId: string;
  joinCode: string;
  status: string;
  submittedCount: number;
  createdAt: string;
  title: string;
}

const STATUS_STYLE: Record<string, string> = {
  lobby: 'bg-sky-500/20 text-sky-300',
  live: 'bg-emerald-500/20 text-emerald-300',
  ended: 'bg-amber-500/20 text-amber-300',
  revealed: 'bg-violet-500/20 text-violet-300',
};

const STATUS_LABEL: Record<string, string> = {
  lobby: 'Draft',
  live: 'Open',
  ended: 'Closed',
  revealed: 'Results published',
};

export function QuizList({ quizzes, sessions }: { quizzes: QuizItem[]; sessions: SessionItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ quizId: string; messages: string[] } | null>(null);
  const [error, setError] = useState('');

  const activeKey = busy ?? (isPending ? pendingKey : null);
  const isAnyBusy = activeKey !== null;

  const run = async (key: string, fn: (navigate: (cb: () => void) => void) => Promise<void>) => {
    setBusy(key);
    setPendingKey(null);
    setError('');
    let handedToTransition = false;
    try {
      await fn((cb) => {
        handedToTransition = true;
        setPendingKey(key);
        startTransition(cb);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setPendingKey(null);
    } finally {
      setBusy(null);
      if (!handedToTransition) setPendingKey(null);
    }
  };

  const create = () =>
    run('new', async (navigate) => {
      const q = await api<{ id: string }>('/api/admin/quizzes', { method: 'POST', json: {} });
      const target = `/admin/quizzes/${q.id}`;
      router.prefetch(target);
      navigate(() => router.push(target));
    });

  const duplicate = (id: string) =>
    run(`dup${id}`, async (navigate) => {
      await api(`/api/admin/quizzes/${id}/duplicate`, { method: 'POST' });
      navigate(() => router.refresh());
    });

  const remove = (q: QuizItem) => {
    if (!confirm(`Delete "${q.title}" and all of its published links? This cannot be undone.`)) return;
    return run(`del${q.id}`, async (navigate) => {
      await api(`/api/admin/quizzes/${q.id}`, { method: 'DELETE' });
      navigate(() => router.refresh());
    });
  };

  const publishLink = (q: QuizItem) =>
    run(`pub${q.id}`, async (navigate) => {
      setProblem(null);
      try {
        const s = await api<{ id: string }>('/api/admin/sessions', { method: 'POST', json: { quizId: q.id } });
        const target = `/admin/sessions/${s.id}`;
        router.prefetch(target);
        navigate(() => router.push(target));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'quiz_invalid') {
          const issues = (e.data?.issues ?? []) as { message: string }[];
          setProblem({ quizId: q.id, messages: issues.map((i) => i.message) });
          return;
        }
        throw e;
      }
    });

  return (
    <div className="animate-pageIn space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Your quizzes</h1>
          <p className="text-sm text-slate-400">Build a quiz, then publish a shareable link for students to take at their own pace.</p>
        </div>
        <button
          className="btn-primary min-w-[132px]"
          onClick={create}
          disabled={isAnyBusy}
          aria-busy={activeKey === 'new'}
        >
          {activeKey === 'new' ? (
            <>
              <Spinner />
              Creating quiz…
            </>
          ) : (
            '+ New quiz'
          )}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {problem && (
        <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">Fix these before publishing a link:</p>
          <ul className="mt-1 list-disc pl-5">
            {problem.messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
          <Link href={`/admin/quizzes/${problem.quizId}`} className="btn-secondary mt-3">
            Fix in editor
          </Link>
        </div>
      )}

      <div className="panel overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="p-3">Title</th>
              <th className="p-3">Questions</th>
              <th className="p-3">Time limit</th>
              <th className="p-3">Open links</th>
              <th className="p-3">Last updated</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {quizzes.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  No quizzes yet. Click <b>New quiz</b> to get started.
                </td>
              </tr>
            )}
            {quizzes.map((q) => (
              <tr key={q.id} className="transition-colors duration-150 hover:bg-slate-900/80">
                <td className="p-3 font-semibold text-white">
                  <Link href={`/admin/quizzes/${q.id}`} className="transition-colors hover:text-violet-300 hover:underline">
                    {q.title}
                  </Link>
                </td>
                <td className="p-3">{q.questionCount}</td>
                <td className="p-3">
                  {Math.floor(q.duration_seconds / 60)}m {q.duration_seconds % 60}s
                </td>
                <td className="p-3">
                  {q.openLinks.length === 0 ? (
                    <span className="text-xs text-slate-500">None open</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {q.openLinks.map((lnk) => (
                        <Link
                          key={lnk.id}
                          href={`/admin/sessions/${lnk.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-200 transition-all duration-150 hover:-translate-y-[1px] hover:border-emerald-400 active:scale-[0.97]"
                        >
                          <span className="font-mono">{lnk.joinCode}</span>
                          <span className="text-emerald-300/80">· {STATUS_LABEL[lnk.status] ?? lnk.status}</span>
                          <span className="text-slate-300">· {lnk.submittedCount} submitted</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </td>
                <td className="p-3 text-slate-400">{new Date(q.updated_at).toLocaleString()}</td>
                <td className="p-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Link href={`/admin/quizzes/${q.id}`} className="btn-secondary">
                      Edit
                    </Link>
                    <button
                      className="btn-secondary"
                      onClick={() => duplicate(q.id)}
                      disabled={isAnyBusy}
                      aria-busy={activeKey === `dup${q.id}`}
                    >
                      {activeKey === `dup${q.id}` ? (
                        <>
                          <Spinner />
                          Duplicating…
                        </>
                      ) : (
                        'Duplicate'
                      )}
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => publishLink(q)}
                      disabled={isAnyBusy}
                      aria-busy={activeKey === `pub${q.id}`}
                    >
                      {activeKey === `pub${q.id}` ? (
                        <>
                          <Spinner />
                          Publishing…
                        </>
                      ) : (
                        'Publish link'
                      )}
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => remove(q)}
                      disabled={isAnyBusy}
                      aria-busy={activeKey === `del${q.id}`}
                    >
                      {activeKey === `del${q.id}` ? (
                        <>
                          <Spinner />
                          Deleting…
                        </>
                      ) : (
                        'Delete'
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sessions.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Published links</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/admin/sessions/${s.id}`}
                className="panel flex items-center justify-between gap-3 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-violet-500 active:scale-[0.99]"
              >
                <div>
                  <div className="font-semibold text-white">{s.title}</div>
                  <div className="text-xs text-slate-400">
                    Code <span className="font-mono text-slate-200">{s.joinCode}</span> · {s.submittedCount} submitted ·{' '}
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
                <span className={`badge shrink-0 ${STATUS_STYLE[s.status] ?? ''}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
