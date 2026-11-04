import type { PublicQuestion } from '@/lib/types';

export type SaveState = 'saved' | 'saving' | 'offline';

const LETTERS = 'ABCDEF';

export function timerTone(remainingMs: number) {
  if (remainingMs <= 10_000) return { color: 'rgb(var(--wrong-rgb))', icon: '⏰', label: 'Hurry!', pulse: true };
  if (remainingMs <= 60_000) return { color: '#F59E0B', icon: '⚠️', label: 'Under 1 min', pulse: false };
  return { color: 'rgb(var(--accent-rgb))', icon: '⏱', label: '', pulse: false };
}

export function fmtClock(ms: number) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * The student question screen. Purely presentational so the editor can reuse it for the phone preview.
 * Must be rendered inside a ThemeScope.
 */
export function QuestionScreen(props: {
  questions: PublicQuestion[];
  index: number;
  answers: Record<string, string>;
  remainingMs: number;
  totalMs: number;
  saveState: SaveState;
  onSelect: (questionId: string, optionId: string) => void;
  onJump: (index: number) => void;
  onSubmit: () => void;
  compact?: boolean; // preview inside a phone frame
}) {
  const { questions, index, answers, remainingMs, totalMs, saveState, onSelect, onJump, onSubmit } = props;
  const q = questions[index];
  if (!q) return null;
  const tone = timerTone(remainingMs);
  const answeredCount = questions.filter((x) => answers[x.id]).length;
  const pct = totalMs > 0 ? Math.max(0, Math.min(100, (remainingMs / totalMs) * 100)) : 0;

  return (
    <div className={`flex flex-col ${props.compact ? 'h-full' : 'min-h-[100dvh]'}`}>
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-ink/10 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="text-base font-semibold">
            Question {index + 1} of {questions.length}
          </div>
          <div
            className={`flex items-center gap-1.5 rounded-full bg-ink/10 px-3 py-1 text-lg font-bold tabular-nums ${tone.pulse ? 'animate-bump' : ''}`}
            style={{ color: tone.color }}
            aria-live="off"
            role="timer"
          >
            <span aria-hidden>{tone.icon}</span>
            {fmtClock(remainingMs)}
            {tone.label && <span className="ml-1 text-xs font-semibold uppercase">{tone.label}</span>}
          </div>
        </div>
        <div className="h-1 w-full bg-ink/10">
          <div className="h-full transition-[width] duration-300" style={{ width: `${pct}%`, background: tone.color }} />
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-6 pt-4">
        <div key={q.id} className={props.compact ? 'space-y-4' : 'animate-pageIn space-y-4'}>
          {q.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={q.imageUrl} alt="" className="max-h-56 w-full rounded-xl object-contain" />
          )}
          <h1 className="whitespace-pre-wrap text-xl font-semibold leading-snug">{q.text}</h1>

          <div className="space-y-3" role="radiogroup" aria-label="Answer options">
            {q.options.map((o, i) => {
              const selected = answers[q.id] === o.id;
              return (
                <button
                  key={o.id}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelect(q.id, o.id)}
                  className={`flex min-h-[56px] w-full select-none items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-base font-medium transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.98] active:duration-75 ${
                    selected ? 'border-accent bg-primary text-white shadow-lg' : 'border-ink/15 bg-ink/5 hover:bg-ink/10'
                  }`}
                  style={selected ? { color: '#fff' } : undefined}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-transform duration-150 ${
                      selected ? 'scale-105 bg-white text-black' : 'bg-ink/10'
                    }`}
                  >
                    {selected ? '✓' : LETTERS[i]}
                  </span>
                  <span className="flex-1">{o.text}</span>
                  {selected && <span className="sr-only">Selected</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between text-sm opacity-80">
          <span>
            {answeredCount} of {questions.length} answered
          </span>
          <span aria-live="polite">
            {saveState === 'saved' && '✓ Saved'}
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'offline' && '⚠ Offline, retrying'}
          </span>
        </div>

        <nav aria-label="Question navigator" className="-mx-4 overflow-x-auto px-4">
          <div className="flex gap-2 pb-1">
            {questions.map((x, i) => {
              const done = !!answers[x.id];
              const current = i === index;
              return (
                <button
                  key={x.id}
                  onClick={() => onJump(i)}
                  aria-label={`Question ${i + 1}${done ? ', answered' : ', not answered'}`}
                  aria-current={current ? 'true' : undefined}
                  className={`relative flex h-12 w-12 shrink-0 select-none items-center justify-center rounded-full border-2 text-base font-bold transition-all duration-150 active:scale-[0.93] ${
                    current ? 'scale-105 border-accent shadow-md' : 'border-ink/20 hover:border-ink/40'
                  } ${done ? 'bg-primary text-white' : 'bg-ink/5'}`}
                >
                  {i + 1}
                  {done && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] text-black">✓</span>}
                </button>
              );
            })}
          </div>
        </nav>
      </main>

      <footer className="sticky bottom-0 z-10 grid grid-cols-3 gap-2 border-t border-ink/10 bg-ink/10 p-3 backdrop-blur">
        <button
          onClick={() => onJump(Math.max(0, index - 1))}
          disabled={index === 0}
          className="min-h-[52px] select-none rounded-xl bg-ink/10 text-base font-semibold transition-all duration-150 enabled:hover:bg-ink/15 enabled:active:scale-[0.96] disabled:opacity-30"
        >
          ← Prev
        </button>
        <button
          onClick={() => onJump(Math.min(questions.length - 1, index + 1))}
          disabled={index === questions.length - 1}
          className="min-h-[52px] select-none rounded-xl bg-ink/10 text-base font-semibold transition-all duration-150 enabled:hover:bg-ink/15 enabled:active:scale-[0.96] disabled:opacity-30"
        >
          Next →
        </button>
        <button
          onClick={onSubmit}
          className="min-h-[52px] select-none rounded-xl bg-accent text-base font-bold text-black shadow-md transition-all duration-150 hover:brightness-105 active:scale-[0.96]"
        >
          Submit
        </button>
      </footer>
    </div>
  );
}
