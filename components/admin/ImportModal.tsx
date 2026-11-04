'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CSV_TEMPLATE, parseQuestionCsv, type ImportRow } from '@/lib/csv';
import type { EditableQuestion } from '@/lib/validate-quiz';

/** Bulk import questions from CSV with a preview that shows errors per row before anything is added. */
export function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (qs: EditableQuestion[]) => void }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [text, setText] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = origOverflow;
    };
  }, []);

  const parse = (t: string) => {
    setText(t);
    setRows(t.trim() ? parseQuestionCsv(t) : null);
  };
  const valid = rows?.filter((r) => r.question) ?? [];

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = () => {
    onImport(
      valid.map((r) => ({
        id: crypto.randomUUID(),
        text: r.question!.text,
        image_url: null,
        points: r.question!.points,
        options: r.question!.options.map((t, i) => ({ id: crypto.randomUUID(), text: t, is_correct: i === r.question!.correctIndex })),
      })),
    );
    onClose();
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-modalBackdrop items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="panel flex max-h-[90vh] w-full max-w-4xl animate-modalPop flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between">
          <h2 id="import-title" className="text-lg font-bold text-white">Import questions from CSV</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="text-sm text-slate-400">
          Columns: <code className="text-slate-200">question,option_a,option_b,option_c,option_d,option_e,option_f,correct,points</code>. <b>correct</b> is a letter A to F. Empty option columns are ignored.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={downloadTemplate}>⬇ Download template</button>
          <label className="btn-secondary cursor-pointer">
            Choose CSV file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => e.target.files?.[0] && parse(await e.target.files[0].text())} />
          </label>
        </div>
        <textarea value={text} onChange={(e) => parse(e.target.value)} rows={4} placeholder="…or paste CSV here" className="field font-mono text-xs" />

        {rows && (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 text-slate-400">
                <tr><th className="p-2">Line</th><th className="p-2">Question</th><th className="p-2">Options</th><th className="p-2">Correct</th><th className="p-2">Pts</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'bg-red-500/10' : ''}>
                    <td className="p-2">{r.line}</td>
                    <td className="p-2">{r.question?.text ?? '–'}</td>
                    <td className="p-2">{r.question?.options.join(' | ') ?? '–'}</td>
                    <td className="p-2">{r.question ? 'ABCDEF'[r.question.correctIndex] : '–'}</td>
                    <td className="p-2">{r.question?.points ?? '–'}</td>
                    <td className="p-2">{r.errors.length ? <span className="text-red-300">{r.errors.join('; ')}</span> : <span className="text-emerald-300">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">{rows ? `${valid.length} valid, ${rows.length - valid.length} with errors (skipped)` : 'Nothing parsed yet'}</span>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!valid.length} onClick={doImport}>Import {valid.length || ''} question{valid.length === 1 ? '' : 's'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

