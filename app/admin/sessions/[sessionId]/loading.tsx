export default function SessionLoading() {
  return (
    <div className="animate-pageIn space-y-6" role="status" aria-label="Loading responses">
      <div className="panel space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-8 w-64" />
          </div>
          <div className="skeleton h-7 w-24 rounded-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="skeleton h-10 w-72 max-w-full rounded-lg" />
          <div className="skeleton h-10 w-28 rounded-lg" />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <div className="skeleton h-10 w-32 rounded-lg" />
          <div className="skeleton h-10 w-44 rounded-lg" />
          <div className="skeleton h-10 w-36 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="panel space-y-2">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-9 w-16" />
        </div>
        <div className="panel space-y-2">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-9 w-16" />
        </div>
        <div className="panel space-y-2">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-9 w-16" />
        </div>
        <div className="panel space-y-2">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton h-9 w-20" />
        </div>
      </div>

      <div className="panel space-y-3">
        <div className="skeleton h-7 w-44" />
        <div className="skeleton h-12 w-full" />
        <div className="skeleton h-12 w-full" />
      </div>
    </div>
  );
}

