'use client';
import { useState } from 'react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import type { EditableQuestion, QuizIssue } from '@/lib/validate-quiz';
import { uploadFile } from './upload';
import { PhonePreview } from './Previews';
import { Spinner } from '@/components/ui/Spinner';
import type { Theme } from '@/lib/types';

const LETTERS = 'ABCDEF';

export function newOption() {
  return { id: crypto.randomUUID(), text: '', is_correct: false };
}
export function newQuestion(): EditableQuestion {
  return { id: crypto.randomUUID(), text: '', image_url: null, points: 1, options: [newOption(), newOption(), newOption(), newOption()] };
}

export function QuestionCard({
  q,
  index,
  issues,
  theme,
  onChange,
  onDuplicate,
  onDelete,
}: {
  q: EditableQuestion;
  index: number;
  issues: QuizIssue[];
  theme: Theme;
  onChange: (q: EditableQuestion) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const setOpt = (id: string, patch: Partial<EditableQuestion['options'][number]>) =>
    onChange({ ...q, options: q.options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const markCorrect = (id: string) => onChange({ ...q, options: q.options.map((o) => ({ ...o, is_correct: o.id === id })) });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      onChange({ ...q, image_url: await uploadFile(file, 'image') });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      id={`q-${q.id}`}
      className={`panel space-y-4 transition-colors duration-200 ${isDragging ? 'z-20 opacity-80 ring-2 ring-violet-500' : 'animate-cardIn'} ${issues.length ? 'border-amber-500/50' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder question ${index + 1}`}
          className="cursor-grab touch-none rounded-lg bg-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-700 active:cursor-grabbing"
        >
          ⠿
        </button>
        <h3 className="text-base font-bold text-white">Question {index + 1}</h3>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-300">
          Points
          <input
            type="number"
            min={0}
            max={100}
            value={q.points}
            onChange={(e) => onChange({ ...q, points: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
            className="field w-20"
          />
        </label>
        <button className="btn-ghost" onClick={() => setPreview(true)}>📱 Preview</button>
        <button className="btn-ghost" onClick={onDuplicate}>Duplicate</button>
        <button className="btn-ghost text-red-300" onClick={onDelete}>Delete</button>
      </div>

      <textarea
        value={q.text}
        onChange={(e) => onChange({ ...q, text: e.target.value })}
        rows={2}
        maxLength={1000}
        placeholder="Type the question…"
        aria-label={`Question ${index + 1} text`}
        className="field resize-y text-base"
      />

      <div className="flex flex-wrap items-center gap-3">
        {q.image_url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.image_url} alt="" className="h-20 rounded-lg object-contain ring-1 ring-slate-700" />
            <button className="btn-ghost" onClick={() => onChange({ ...q, image_url: null })}>Remove image</button>
          </>
        ) : (
          <label className="btn-secondary cursor-pointer">
            {uploading ? (
              <>
                <Spinner />
                Uploading…
              </>
            ) : (
              '🖼 Add image (max 2 MB)'
            )}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        )}
        {uploadError && <span className="text-sm text-red-300">{uploadError}</span>}
      </div>

      <div className="space-y-2" role="radiogroup" aria-label={`Options for question ${index + 1}`}>
        {q.options.map((o, i) => (
          <div
            key={o.id}
            className={`flex items-center gap-2 rounded-lg border p-2 transition-colors duration-150 ${o.is_correct ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-950/40 hover:border-slate-600'}`}
          >
            <input
              type="radio"
              name={`correct-${q.id}`}
              checked={o.is_correct}
              onChange={() => markCorrect(o.id)}
              aria-label={`Mark option ${LETTERS[i]} as correct`}
              className="h-5 w-5 accent-emerald-500"
            />
            <span className="w-5 text-sm font-bold text-slate-400">{LETTERS[i]}</span>
            <input
              value={o.text}
              onChange={(e) => setOpt(o.id, { text: e.target.value })}
              maxLength={300}
              placeholder={`Option ${LETTERS[i]}`}
              aria-label={`Option ${LETTERS[i]} text`}
              className="field border-0 bg-transparent"
            />
            {o.is_correct && <span className="badge bg-emerald-500/20 text-emerald-300">✓ Correct</span>}
            <button
              className="btn-ghost px-2"
              disabled={q.options.length <= 2}
              onClick={() => onChange({ ...q, options: q.options.filter((x) => x.id !== o.id) })}
              aria-label={`Remove option ${LETTERS[i]}`}
            >
              ✕
            </button>
          </div>
        ))}
        {q.options.length < 6 && (
          <button className="btn-ghost" onClick={() => onChange({ ...q, options: [...q.options, newOption()] })}>
            + Add option
          </button>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200" role="alert">
          {issues.map((i, k) => (
            <li key={k}>⚠ {i.message.replace(/^Question \d+: /, '')}</li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex animate-modalBackdrop items-center justify-center bg-black/70 p-4" onClick={() => setPreview(false)} role="dialog" aria-modal="true">
          <div onClick={(e) => e.stopPropagation()} className="animate-modalPop space-y-3">
            <PhonePreview theme={theme} question={q} />
            <div className="text-center">
              <button className="btn-secondary" onClick={() => setPreview(false)}>Close preview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

