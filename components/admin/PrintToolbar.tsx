'use client';
import Link from 'next/link';

export function PrintToolbar({ sessionId }: { sessionId: string }) {
  return (
    <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-slate-100">
      <div className="flex items-center gap-3">
        <Link href={`/admin/sessions/${sessionId}`} className="btn-secondary">
          ← Back to control room
        </Link>
        <span className="text-sm text-slate-400">Choose &ldquo;Save as PDF&rdquo; in the print dialog for a clean A4 document.</span>
      </div>
      <button onClick={() => window.print()} className="btn-primary">
        🖨 Print / Save as PDF
      </button>
    </div>
  );
}

