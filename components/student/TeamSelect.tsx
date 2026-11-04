'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { HARDCODED_TEAMS, resolveTeamList } from '@/lib/teams';

interface TeamSelectProps {
  id?: string;
  value: string;
  onChange: (team: string) => void;
  teams?: string[];
  hasError?: boolean;
}

export function TeamSelect({ id: customId, value, onChange, teams, hasError }: TeamSelectProps) {
  const autoId = useId();
  const id = customId || autoId;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const allTeams = useMemo(() => resolveTeamList(teams ?? HARDCODED_TEAMS), [teams]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTeams;
    return allTeams.filter((t) => t.toLowerCase().includes(q));
  }, [allTeams, search]);

  // Reset highlight index when filter changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [search]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 30);
    } else {
      setSearch('');
    }
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightIndex, open]);

  const handleSelect = (selected: string) => {
    onChange(selected);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => (prev + 1 < filtered.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIndex]) {
        handleSelect(filtered[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full text-left" onKeyDown={handleKeyDown}>
      {/* Hidden input for standard forms */}
      <input type="hidden" id={id} name="team" value={value} />

      {/* Main Trigger Button */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Select Team"
        onClick={() => setOpen((prev) => !prev)}
        className={`h-14 w-full rounded-xl border-2 px-4 text-left text-lg transition-all flex items-center justify-between gap-2 ${
          hasError ? 'border-bad bg-bad/10 text-bad' : 'border-ink/20 bg-ink/10 text-ink focus:border-accent'
        }`}
      >
        <span className="min-w-0 truncate" title={value || undefined}>
          {value ? (
            <span className="font-semibold text-ink">{value}</span>
          ) : (
            <span className="text-ink/40">Select your team… ({allTeams.length} available)</span>
          )}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 text-ink/60">
          {value && (
            <span
              role="button"
              tabIndex={0}
              title="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onChange('');
                  setOpen(true);
                }
              }}
              className="rounded-full p-1 hover:bg-ink/20 active:scale-95"
            >
              ✕
            </span>
          )}
          <svg
            className={`h-5 w-5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Dropdown Menu with Live Search */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-w-full rounded-2xl border-2 border-slate-700 bg-slate-900 p-3 shadow-2xl animate-fadeUp">
          {/* Live Search Bar */}
          <div className="relative mb-2">
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team (e.g. Transformers, Delta)..."
              className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/80 pl-9 pr-8 text-sm text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          {/* Result Count Badge */}
          <div className="mb-1.5 flex items-center justify-between px-1 text-xs text-slate-400">
            <span>
              {search.trim() ? `Matching: ${filtered.length} of ${allTeams.length}` : `All ${allTeams.length} teams`}
            </span>
            <span className="text-[11px] opacity-75">Tap to choose</span>
          </div>

          {/* Filtered Team List */}
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            className="max-h-[min(15rem,35dvh)] sm:max-h-72 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg p-0.5 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-700"
          >
            {filtered.length === 0 ? (
              <li className="py-6 text-center text-sm text-slate-400">
                No team found matching &ldquo;<span className="text-white font-medium">{search}</span>&rdquo;
              </li>
            ) : (
              filtered.map((t, idx) => {
                const isSelected = value.toLowerCase() === t.toLowerCase();
                const isHighlighted = idx === highlightIndex;
                return (
                  <li
                    key={t}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(t)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150 ${
                      isSelected
                        ? 'bg-violet-600 font-semibold text-white'
                        : isHighlighted
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="min-w-0 break-words">{t}</span>
                    {isSelected && (
                      <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

