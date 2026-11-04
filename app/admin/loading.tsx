export default function AdminLoading() {
  return (
    <div className="animate-pageIn space-y-8" role="status" aria-label="Loading quizzes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="skeleton h-8 w-44" />
          <div className="skeleton h-4 w-80 max-w-full" />
        </div>
        <div className="skeleton h-10 w-32 rounded-lg" />
      </div>

      <div className="panel space-y-3">
        <div className="skeleton h-8 w-full" />
        <div className="skeleton h-12 w-full" />
        <div className="skeleton h-12 w-full" />
        <div className="skeleton h-12 w-full" />
      </div>
    </div>
  );
}

