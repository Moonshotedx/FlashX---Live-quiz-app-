'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/client-api';

export interface QuizItem {
  id: string;
  title: string;
  updated_at: string;
  duration_seconds: number;
  questionCount: number;
}
export interface SessionItem {
  id: string;
  joinCode: string;
  status: string;
  createdAt: string;
  title: string;
}

const STATUS_STYLE: Record<string, string> = {
  lobby: 'bg-sky-500/20 text-sky-300',
  live: 'bg-emerald-500/20 text-emerald-300',
  ended: 'bg-amber-500/20 text-amber-300',
  revealed: 'bg-violet-500/20 text-violet-300',
};

export function QuizList({ quizzes, sessions }: { quizzes: QuizItem[]; sessions: SessionItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ quizId: string; messages: string[] } | null>(null);
  const [error, setError] = useState('');

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run('new', async () => {
      const q = await api<{ id: string }>('/api/admin/quizzes', { method: 'POST', json: {} });
      router.push(`/admin/quizzes/${q.id}`);
    });

  const duplicate = (id: string) =>
    run(`dup${id}`, async () => {
      await api(`/api/admin/quizzes/${id}/duplicate`, { method: 'POST' });
      router.refresh();
    });

  const remove = (q: QuizItem) => {
    if (!confirm(`Delete "${q.title}" and all of its sessions? This cannot be undone.`)) return;
    return run(`del${q.id}`, async () => {
      await api(`/api/admin/quizzes/${q.id}`, { method: 'DELETE' });
      router.refresh();
    });
  };

  const createSession = (q: QuizItem) =>
    run(`ses${q.id}`, async () => {
      setProblem(null);
      try {
        const s = await api<{ id: string }>('/api/admin/sessions', { method: 'POST', json: { quizId: q.id } });
        router.push(`/admin/sessions/${s.id}`);
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Your quizzes</h1>
          <p className="text-sm text-slate-400">Create a quiz, then start a live session when the audience is ready.</p>
        </div>
        <button className="btn-primary" onClick={create} disabled={busy === 'new'}>
          + New quiz
        </button>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-500/15 p-3 text-sm text-red-300">{error}</p>}

      {problem && (
        <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">This quiz can&apos;t run yet:</p>
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
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="p-3">Title</th>
              <th className="p-3">Questions</th>
              <th className="p-3">Duration</th>
              <th className="p-3">Last updated</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {quizzes.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  No quizzes yet. Click <b>New quiz</b> to get started.
                </td>
              </tr>
            )}
            {quizzes.map((q) => (
              <tr key={q.id} className="hover:bg-slate-900">
                <td className="p-3 font-semibold text-white">
                  <Link href={`/admin/quizzes/${q.id}`} className="hover:underline">
                    {q.title}
                  </Link>
                </td>
                <td className="p-3">{q.questionCount}</td>
                <td className="p-3">
                  {Math.floor(q.duration_seconds / 60)}m {q.duration_seconds % 60}s
                </td>
                <td className="p-3 text-slate-400">{new Date(q.updated_at).toLocaleString()}</td>
                <td className="p-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Link href={`/admin/quizzes/${q.id}`} className="btn-secondary">Edit</Link>
                    <button className="btn-secondary" onClick={() => duplicate(q.id)} disabled={busy === `dup${q.id}`}>Duplicate</button>
                    <button className="btn-primary" onClick={() => createSession(q)} disabled={busy === `ses${q.id}`}>Create session</button>
                    <button className="btn-danger" onClick={() => remove(q)} disabled={busy === `del${q.id}`}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sessions.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Recent sessions</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {sessions.map((s) => (
              <Link key={s.id} href={`/admin/sessions/${s.id}`} className="panel flex items-center justify-between hover:border-violet-500">
                <div>
                  <div className="font-semibold text-white">{s.title}</div>
                  <div className="text-xs text-slate-400">
                    Code <span className="font-mono text-slate-200">{s.joinCode}</span> · {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
                <span className={`badge ${STATUS_STYLE[s.status] ?? ''}`}>{s.status}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

