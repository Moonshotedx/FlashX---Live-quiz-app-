'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { api, ApiError } from '@/lib/client-api';
import { validateQuiz, type EditableQuestion } from '@/lib/validate-quiz';
import { resolveTheme, sanitizeTheme } from '@/lib/theme';
import type { QuizRow, Theme } from '@/lib/types';
import { QuestionCard, newQuestion } from './QuestionCard';
import { ThemeEditor } from './ThemeEditor';
import { ImportModal } from './ImportModal';

export type QuizSettings = Pick<
  QuizRow,
  | 'title'
  | 'description'
  | 'duration_seconds'
  | 'shuffle_questions'
  | 'shuffle_options'
  | 'allow_late_join'
  | 'show_live_leaderboard'
  | 'show_answers_after_reveal'
  | 'roll_number_mode'
  | 'roll_number_label'
>;

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';
type Tab = 'questions' | 'settings' | 'theme';

export function QuizEditor({ quizId, initialSettings, initialTheme, initialQuestions }: { quizId: string; initialSettings: QuizSettings; initialTheme: Partial<Theme>; initialQuestions: EditableQuestion[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('questions');
  const [settings, setSettings] = useState(initialSettings);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(initialTheme));
  const [questions, setQuestions] = useState(initialQuestions);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [saveError, setSaveError] = useState('');
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createIssues, setCreateIssues] = useState<string[]>([]);

  // ---- autosave: debounce, one request at a time, retry on failure ----
  const latest = useRef({ settings, theme, questions });
  latest.current = { settings, theme, questions };
  const dirty = useRef({ meta: false, questions: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef(false);

  const flush = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setStatus('saving');
    try {
      while (dirty.current.meta || dirty.current.questions) {
        const d = { ...dirty.current };
        dirty.current = { meta: false, questions: false };
        const { settings: s, theme: t, questions: qs } = latest.current;
        try {
          if (d.meta) {
            await api(`/api/admin/quizzes/${quizId}`, {
              method: 'PATCH',
              json: { ...s, title: s.title.trim() || 'Untitled quiz', roll_number_label: s.roll_number_label.trim() || 'Roll number / USN', theme: sanitizeTheme(t) },
            });
          }
          if (d.questions) await api(`/api/admin/quizzes/${quizId}/questions`, { method: 'PUT', json: { questions: qs } });
        } catch (e) {
          dirty.current = { meta: dirty.current.meta || d.meta, questions: dirty.current.questions || d.questions };
          throw e;
        }
      }
      setSaveError('');
      setStatus(dirty.current.meta || dirty.current.questions ? 'dirty' : 'saved');
    } catch (e) {
      setStatus('error');
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      timer.current = setTimeout(flush, 4000); // keep retrying
    } finally {
      running.current = false;
    }
  }, [quizId]);

  const touch = useCallback(
    (kind: 'meta' | 'questions') => {
      dirty.current[kind] = true;
      setStatus((s) => (s === 'saving' ? s : 'dirty'));
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 800);
    },
    [flush],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current.meta || dirty.current.questions || running.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const updateSettings = (patch: Partial<QuizSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    touch('meta');
  };
  const updateTheme = (t: Theme) => {
    setTheme(t);
    touch('meta');
  };
  const updateQuestions = (next: EditableQuestion[]) => {
    setQuestions(next);
    touch('questions');
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = questions.findIndex((q) => q.id === e.active.id);
    const to = questions.findIndex((q) => q.id === e.over!.id);
    updateQuestions(arrayMove(questions, from, to));
  };

  const issues = useMemo(() => validateQuiz(questions), [questions]);
  const issuesFor = (id: string) => issues.filter((i) => i.questionId === id);

  const duplicate = (q: EditableQuestion, at: number) => {
    const copy: EditableQuestion = { ...q, id: crypto.randomUUID(), options: q.options.map((o) => ({ ...o, id: crypto.randomUUID() })) };
    updateQuestions([...questions.slice(0, at + 1), copy, ...questions.slice(at + 1)]);
  };
  const remove = (q: EditableQuestion) => {
    if ((q.text.trim() || q.options.some((o) => o.text.trim())) && !confirm('Delete this question?')) return;
    updateQuestions(questions.filter((x) => x.id !== q.id));
  };

  const createSession = async () => {
    setCreating(true);
    setCreateIssues([]);
    try {
      clearTimeout(timer.current);
      await flush(); // make sure the server has the latest version
      const s = await api<{ id: string }>('/api/admin/sessions', { method: 'POST', json: { quizId } });
      router.push(`/admin/sessions/${s.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'quiz_invalid') setCreateIssues(((e.data?.issues ?? []) as { message: string }[]).map((i) => i.message));
      else setCreateIssues([e instanceof Error ? e.message : 'Could not create session']);
      setCreating(false);
    }
  };

  const mins = Math.floor(settings.duration_seconds / 60);
  const secs = settings.duration_seconds % 60;
  const setDuration = (m: number, s: number) => updateSettings({ duration_seconds: Math.max(30, Math.min(3600, m * 60 + s)) });

  const sample = questions[0] ?? { ...newQuestion(), text: 'What does CPU stand for?', options: ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processing Unit'].map((t) => ({ id: crypto.randomUUID(), text: t, is_correct: false })) };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className="btn-ghost">← Quizzes</Link>
        <input
          value={settings.title}
          onChange={(e) => updateSettings({ title: e.target.value })}
          maxLength={120}
          aria-label="Quiz title"
          className="field min-w-[200px] flex-1 border-transparent bg-transparent text-xl font-bold hover:border-slate-700"
        />
        <span className={`badge ${status === 'saved' ? 'bg-emerald-500/20 text-emerald-300' : status === 'error' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`} role="status" aria-live="polite">
          {status === 'saved' && '✓ Saved'}
          {status === 'saving' && 'Saving…'}
          {status === 'dirty' && 'Unsaved changes…'}
          {status === 'error' && `Error: ${saveError}. Retrying…`}
        </span>
        <button className="btn-primary" onClick={createSession} disabled={creating}>▶ Create session</button>
      </div>

      {createIssues.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">Fix these before creating a session:</p>
          <ul className="mt-1 list-disc pl-5">{createIssues.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-800" role="tablist">
        {(['questions', 'settings', 'theme'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold capitalize ${tab === t ? 'border-violet-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t === 'questions' ? `Questions (${questions.length})` : t}
          </button>
        ))}
      </div>

      {tab === 'questions' && (
        <div className="space-y-4">
          {issues.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">
              <p className="font-semibold">{issues.length} thing{issues.length > 1 ? 's' : ''} to fix before this quiz can run</p>
              <ul className="mt-1 list-disc pl-5">
                {issues.slice(0, 6).map((i, k) => (
                  <li key={k}>
                    {i.questionId ? <a className="underline" href={`#q-${i.questionId}`}>{i.message}</a> : i.message}
                  </li>
                ))}
                {issues.length > 6 && <li>…and {issues.length - 6} more</li>}
              </ul>
            </div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {questions.map((q, i) => (
                  <QuestionCard
                    key={q.id}
                    q={q}
                    index={i}
                    theme={theme}
                    issues={issuesFor(q.id)}
                    onChange={(nq) => updateQuestions(questions.map((x) => (x.id === q.id ? nq : x)))}
                    onDuplicate={() => duplicate(q, i)}
                    onDelete={() => remove(q)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {questions.length === 0 && <p className="panel text-center text-slate-400">No questions yet. Add your first one.</p>}
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => updateQuestions([...questions, newQuestion()])}>+ Add question</button>
            <button className="btn-secondary" onClick={() => setImporting(true)}>⬆ Import from CSV</button>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="panel space-y-4">
            <h3 className="font-bold text-white">General</h3>
            <div>
              <label className="label" htmlFor="desc">Description</label>
              <textarea id="desc" rows={3} maxLength={1000} className="field" value={settings.description ?? ''} onChange={(e) => updateSettings({ description: e.target.value || null })} />
            </div>
            <div>
              <span className="label">Total time for the whole quiz (30 s to 60 min)</span>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={60} aria-label="Minutes" className="field w-24" value={mins} onChange={(e) => setDuration(Number(e.target.value) || 0, secs)} /> <span className="text-slate-400">min</span>
                <input type="number" min={0} max={59} aria-label="Seconds" className="field w-24" value={secs} onChange={(e) => setDuration(mins, Math.min(59, Number(e.target.value) || 0))} /> <span className="text-slate-400">sec</span>
              </div>
            </div>
          </section>
          <section className="panel space-y-4">
            <h3 className="font-bold text-white">Participants</h3>
            <div>
              <label className="label" htmlFor="roll">Roll number</label>
              <select id="roll" className="field" value={settings.roll_number_mode} onChange={(e) => updateSettings({ roll_number_mode: e.target.value as QuizSettings['roll_number_mode'] })}>
                <option value="off">Off, name only</option>
                <option value="optional">Optional</option>
                <option value="required">Required (must be unique)</option>
              </select>
            </div>
            {settings.roll_number_mode !== 'off' && (
              <div>
                <label className="label" htmlFor="rolllabel">Roll number label</label>
                <input id="rolllabel" className="field" maxLength={60} value={settings.roll_number_label} onChange={(e) => updateSettings({ roll_number_label: e.target.value })} />
              </div>
            )}
            <Toggle label="Allow late join" hint="Students can join after the quiz started and get the remaining time." checked={settings.allow_late_join} onChange={(v) => updateSettings({ allow_late_join: v })} />
          </section>
          <section className="panel space-y-4 lg:col-span-2">
            <h3 className="font-bold text-white">Behaviour</h3>
            <Toggle label="Shuffle questions" hint="Different order per student, stable if they rejoin." checked={settings.shuffle_questions} onChange={(v) => updateSettings({ shuffle_questions: v })} />
            <Toggle label="Shuffle options" hint="Answer options appear in a different order per student." checked={settings.shuffle_options} onChange={(v) => updateSettings({ shuffle_options: v })} />
            <Toggle label="Live top 10 on the LED screen" hint="Show a live top 10 on the presenter view while the quiz runs." checked={settings.show_live_leaderboard} onChange={(v) => updateSettings({ show_live_leaderboard: v })} />
            <Toggle label="Show answers after reveal" hint="Students see a review with the correct answers once the leaderboard is revealed." checked={settings.show_answers_after_reveal} onChange={(v) => updateSettings({ show_answers_after_reveal: v })} />
          </section>
        </div>
      )}

      {tab === 'theme' && <ThemeEditor theme={theme} onChange={updateTheme} sampleQuestion={sample} />}

      {importing && <ImportModal onClose={() => setImporting(false)} onImport={(qs) => updateQuestions([...questions, ...qs])} />}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 accent-violet-500" />
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
    </label>
  );
}
