export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={`shrink-0 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V1C5.925 1 1 5.925 1 12h3z"
      />
    </svg>
  );
}

