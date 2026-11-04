export default function QuizEditorLoading() {
  return (
    <div className="animate-pageIn space-y-6" role="status" aria-label="Opening quiz editor">
      <div className="flex flex-wrap items-center gap-3">
        <div className="skeleton h-10 w-24 rounded-lg" />
        <div className="skeleton h-10 min-w-[200px] flex-1 rounded-lg" />
        <div className="skeleton h-6 w-20 rounded-full" />
        <div className="skeleton h-10 w-36 rounded-lg" />
      </div>

      <div className="flex gap-2 border-b border-slate-800 pb-2">
        <div className="skeleton h-8 w-28" />
        <div className="skeleton h-8 w-24" />
        <div className="skeleton h-8 w-20" />
      </div>

      <div className="panel space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="skeleton h-6 w-32" />
          <div className="skeleton h-9 w-28" />
        </div>
        <div className="skeleton h-16 w-full" />
        <div className="space-y-2">
          <div className="skeleton h-11 w-full" />
          <div className="skeleton h-11 w-full" />
          <div className="skeleton h-11 w-full" />
          <div className="skeleton h-11 w-full" />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="skeleton h-10 w-36 rounded-lg" />
        <div className="skeleton h-10 w-36 rounded-lg" />
        <div className="skeleton h-10 w-40 rounded-lg" />
      </div>
    </div>
  );
}

