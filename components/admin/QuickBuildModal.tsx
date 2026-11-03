'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_OPTIONS,
  MAX_OPTION_CHARS,
  MAX_QUESTION_CHARS,
  parseQuestionText,
  type ParsedQuestion,
} from '@/lib/text-import';
import type { EditableQuestion } from '@/lib/validate-quiz';

export type QuickBuildMode = 'add' | 'replace';

export const SAMPLE_QUIZ_TEXT = `1. What does CPU stand for?
A) Central Processing Unit
B) Computer Personal Unit
C) Central Program Utility
D) Control Processing Unit
Answer: A

Q2. Which language runs natively in a web browser? (2 marks)
a. Java  b. C  c. Python  d. JavaScript
Ans - d

3. Which company makes the Android operating system?
Apple
Google *
Microsoft
Samsung

4. HTML is a programming language.
Answer: False

5. Which planet is known as the Red Planet?
(a) Venus
(b) Mars
(c) Jupiter
(d) Saturn

Answer key
5 - b`;

const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_QUIZ_QUESTIONS = 100;
const LABEL_ORDER_ISSUE = 'Option labels are out of order or repeated, check this question';
const MISSING_ANSWER_ISSUE = 'No correct answer found - click the right option';

interface DraftOption {
  id: string;
  text: string;
}

interface DraftCard {
  id: string;
  sourceNumber: number | null;
  line: number;
  text: string;
  options: DraftOption[];
  correctOptionId: string | null;
  points: number;
  notes: string[];
  /** Specific parser answer conflict/mismatch message until the admin clicks an option. */
  parserAnswerIssue: string | null;
  /** Out-of-order label warning from the parser until options are edited or confirmed. */
  labelOrderIssue: boolean;
}

function squashText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isStructuralIssue(msg: string): boolean {
  return (
    msg === LABEL_ORDER_ISSUE ||
    msg === MISSING_ANSWER_ISSUE ||
    msg === 'The question text is empty' ||
    msg.startsWith('The question text is longer than') ||
    msg.startsWith('Needs at least 2 options') ||
    msg.startsWith('Has ') ||
    msg === 'An option is empty' ||
    msg.startsWith('An option is longer than') ||
    msg === 'Two options have the same text'
  );
}

function toDraftCard(q: ParsedQuestion): DraftCard {
  const options: DraftOption[] = q.options.map((text) => ({
    id: crypto.randomUUID(),
    text,
  }));
  const correctOptionId =
    q.correctIndex !== null && q.correctIndex >= 0 && q.correctIndex < options.length
      ? options[q.correctIndex].id
      : null;

  const answerProblems = q.issues.filter((m) => !isStructuralIssue(m));
  return {
    id: crypto.randomUUID(),
    sourceNumber: q.sourceNumber,
    line: q.line,
    text: q.text,
    options,
    correctOptionId,
    points: q.points,
    notes: [...q.notes],
    parserAnswerIssue: answerProblems[0] ?? null,
    labelOrderIssue: q.issues.includes(LABEL_ORDER_ISSUE),
  };
}

function computeIssues(card: DraftCard): string[] {
  const issues: string[] = [];
  if (card.labelOrderIssue) issues.push(LABEL_ORDER_ISSUE);

  const trimmedText = card.text.trim();
  if (!trimmedText) {
    issues.push('The question text is empty');
  } else if (trimmedText.length > MAX_QUESTION_CHARS) {
    issues.push(`The question text is longer than ${MAX_QUESTION_CHARS} characters`);
  }

  if (card.options.length < 2) {
    issues.push(`Needs at least 2 options (found ${card.options.length})`);
  }
  if (card.options.length > MAX_OPTIONS) {
    issues.push(`Has ${card.options.length} options, the maximum is ${MAX_OPTIONS}`);
  }

  const optionTexts = card.options.map((o) => o.text.trim());
  if (optionTexts.some((t) => !t)) {
    issues.push('An option is empty');
  }
  if (optionTexts.some((t) => t.length > MAX_OPTION_CHARS)) {
    issues.push(`An option is longer than ${MAX_OPTION_CHARS} characters`);
  }

  const squashed = optionTexts.filter(Boolean).map(squashText);
  if (new Set(squashed).size < squashed.length) {
    issues.push('Two options have the same text');
  }

  const hasValidCorrect =
    card.correctOptionId !== null && card.options.some((o) => o.id === card.correctOptionId);
  if (card.parserAnswerIssue) {
    issues.push(card.parserAnswerIssue);
  } else if (!hasValidCorrect) {
    issues.push(MISSING_ANSWER_ISSUE);
  }

  if (!Number.isInteger(card.points) || card.points < 0 || card.points > 100) {
    issues.push('Points must be a whole number from 0 to 100');
  }

  return issues;
}

function clampPoints(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function QuickBuildModal({
  existingCount,
  onClose,
  onApply,
}: {
  existingCount: number;
  onClose: () => void;
  onApply: (questions: EditableQuestion[], mode: QuickBuildMode) => void;
}) {
  const [inputText, setInputText] = useState('');
  const [defaultPoints, setDefaultPoints] = useState(1);
  const [mode, setMode] = useState<QuickBuildMode>('add');
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [unparsed, setUnparsed] = useState<{ line: number; text: string }[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [bulkPoints, setBulkPoints] = useState(1);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const skipDebounceRef = useRef(false);
  const defaultPointsRef = useRef(defaultPoints);
  defaultPointsRef.current = defaultPoints;

  const runParseNow = (rawText: string, pts: number) => {
    setIsParsing(false);
    if (!rawText.trim()) {
      setCards([]);
      setUnparsed([]);
      return;
    }
    const res = parseQuestionText(rawText, { defaultPoints: pts });
    setCards(res.questions.map(toDraftCard));
    setUnparsed(res.unparsed);
  };

  // Debounce parsing (~300 ms) as the admin types or pastes in the textarea.
  useEffect(() => {
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false;
      return;
    }
    if (!inputText.trim()) {
      setIsParsing(false);
      setCards([]);
      setUnparsed([]);
      return;
    }
    setIsParsing(true);
    const id = setTimeout(() => {
      runParseNow(inputText, defaultPointsRef.current);
    }, 300);
    return () => clearTimeout(id);
  }, [inputText]);

  const handleImmediateText = (nextText: string) => {
    skipDebounceRef.current = true;
    setInputText(nextText);
    runParseNow(nextText, defaultPoints);
  };

  const handleDefaultPointsChange = (raw: string) => {
    const next = clampPoints(Number(raw));
    setDefaultPoints(next);
    if (inputText.trim()) {
      runParseNow(inputText, next);
    }
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    try {
      const content = await file.text();
      handleImmediateText(content);
    } catch {
      setUploadError('Could not read that file. Please upload a plain .txt or .md file.');
    }
  };

  const cardEvaluations = useMemo(
    () => cards.map((card) => ({ card, issues: computeIssues(card) })),
    [cards],
  );

  const blockingCount = useMemo(
    () => cardEvaluations.filter((x) => x.issues.length > 0).length,
    [cardEvaluations],
  );
  const readyCount = cards.length - blockingCount;

  const totalAfterApply = mode === 'replace' ? cards.length : existingCount + cards.length;
  const overQuizLimit = totalAfterApply > MAX_QUIZ_QUESTIONS;
  const canSubmit = cards.length > 0 && blockingCount === 0 && !overQuizLimit && !isParsing;

  // ---- Inline card updaters ----
  const updateCard = (cardId: string, updater: (c: DraftCard) => DraftCard) => {
    setCards((prev) => prev.map((c) => (c.id === cardId ? updater(c) : c)));
  };

  const removeCard = (cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const markCorrect = (cardId: string, optionId: string) => {
    updateCard(cardId, (c) => ({
      ...c,
      correctOptionId: optionId,
      parserAnswerIssue: null,
    }));
  };

  const setOptionText = (cardId: string, optionId: string, text: string) => {
    updateCard(cardId, (c) => ({
      ...c,
      labelOrderIssue: false,
      options: c.options.map((o) => (o.id === optionId ? { ...o, text } : o)),
    }));
  };

  const deleteOption = (cardId: string, optionId: string) => {
    updateCard(cardId, (c) => ({
      ...c,
      labelOrderIssue: false,
      correctOptionId: c.correctOptionId === optionId ? null : c.correctOptionId,
      options: c.options.filter((o) => o.id !== optionId),
    }));
  };

  const addOption = (cardId: string) => {
    updateCard(cardId, (c) => ({
      ...c,
      labelOrderIssue: false,
      options: [...c.options, { id: crypto.randomUUID(), text: '' }],
    }));
  };

  const applyAllPoints = () => {
    const pts = clampPoints(bulkPoints);
    setBulkPoints(pts);
    setCards((prev) => prev.map((c) => ({ ...c, points: pts })));
  };

  const buildEditableQuestions = (): EditableQuestion[] =>
    cards.map((c) => ({
      id: crypto.randomUUID(),
      text: c.text.trim(),
      image_url: null,
      points: clampPoints(c.points),
      options: c.options.map((o) => ({
        id: crypto.randomUUID(),
        text: o.text.trim(),
        is_correct: o.id === c.correctOptionId,
      })),
    }));

  const handlePrimaryClick = () => {
    if (!canSubmit) return;
    if (mode === 'replace') {
      setConfirmReplace(true);
      return;
    }
    onApply(buildEditableQuestions(), 'add');
    onClose();
  };

  const confirmAndReplace = () => {
    if (!canSubmit) return;
    setConfirmReplace(false);
    onApply(buildEditableQuestions(), 'replace');
    onClose();
  };

  let primaryLabel: string;
  if (cards.length === 0) {
    primaryLabel = mode === 'replace' ? 'Replace with 0 questions' : 'Add 0 questions';
  } else if (blockingCount > 0) {
    primaryLabel = `Fix ${blockingCount} question${blockingCount === 1 ? '' : 's'} to continue`;
  } else if (overQuizLimit) {
    primaryLabel = `Exceeds ${MAX_QUIZ_QUESTIONS}-question quiz limit (${totalAfterApply})`;
  } else if (mode === 'replace') {
    primaryLabel = `Replace with ${cards.length} question${cards.length === 1 ? '' : 's'}`;
  } else {
    primaryLabel = `Add ${cards.length} question${cards.length === 1 ? '' : 's'}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-build-title"
    >
      <div className="relative flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M13 2L4 14h7l-2 8 11-12h-7l2-8z" />
              </svg>
            </span>
            <div>
              <h2 id="quick-build-title" className="text-lg font-bold text-white">
                Quick Build
              </h2>
              <p className="text-xs text-slate-400">
                Paste questions and answers from Word, Google Docs, WhatsApp, PDFs, or plain text.
              </p>
            </div>
          </div>
          <button type="button" className="btn-ghost px-3" onClick={onClose} aria-label="Close Quick Build">
            ✕
          </button>
        </div>

        {/* Two-column body (stacks on narrow screens) */}
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-slate-800 overflow-y-auto lg:grid-cols-12 lg:divide-x lg:divide-y-0 lg:overflow-hidden">
          {/* Left column - Input */}
          <div className="flex flex-col gap-3.5 p-4 sm:p-5 lg:col-span-5 lg:min-h-0 lg:overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="quick-build-textarea" className="text-sm font-bold text-white">
                Paste your questions and answers
              </label>
              <div className="flex flex-wrap gap-2">
                <label className="btn-secondary cursor-pointer px-3 py-1.5 text-xs">
                  Upload .txt or .md
                  <input
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      void handleFileUpload(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => handleImmediateText(SAMPLE_QUIZ_TEXT)}
                >
                  Insert sample
                </button>
              </div>
            </div>

            {uploadError && (
              <p role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">
                {uploadError}
              </p>
            )}

            <textarea
              id="quick-build-textarea"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={13}
              placeholder={`1. What does CPU stand for?\nA) Central Processing Unit\nB) Computer Personal Unit\nC) Central Program Utility\nD) Control Processing Unit\nAnswer: A`}
              className="field min-h-[240px] flex-1 resize-y font-mono text-xs leading-relaxed"
            />

            {/* Collapsible Supported formats guide */}
            <details className="rounded-xl border border-slate-800 bg-slate-900/60 text-xs text-slate-300">
              <summary className="cursor-pointer select-none px-3.5 py-2.5 font-semibold text-slate-200 hover:text-white">
                Supported formats &amp; examples
              </summary>
              <div className="space-y-2.5 border-t border-slate-800 px-3.5 py-3 text-slate-400">
                <div>
                  <span className="font-semibold text-slate-200">Question starts:</span>{' '}
                  <code className="text-slate-300">1.</code>, <code className="text-slate-300">1)</code>,{' '}
                  <code className="text-slate-300">(1)</code>, <code className="text-slate-300">Q1.</code>,{' '}
                  <code className="text-slate-300">Question 1:</code>, or blank-line separated blocks. Multi-line questions are kept intact.
                </div>
                <div>
                  <span className="font-semibold text-slate-200">Options (2 to 6):</span>{' '}
                  <code className="text-slate-300">A)</code>, <code className="text-slate-300">a.</code>,{' '}
                  <code className="text-slate-300">(a)</code>, <code className="text-slate-300">[A]</code>, Roman{' '}
                  <code className="text-slate-300">(i)</code>–<code className="text-slate-300">(vi)</code>, inline on one line (
                  <code className="text-slate-300">a. Java  b. C  c. Python</code>), 2–6 unlabelled short lines, or True/False with no options.
                </div>
                <div>
                  <span className="font-semibold text-slate-200">Correct answers:</span>{' '}
                  <code className="text-slate-300">Answer: B</code>, <code className="text-slate-300">Ans - d</code>,{' '}
                  <code className="text-slate-300">Correct: Paris</code>; option markers{' '}
                  <code className="text-slate-300">*</code>, <code className="text-slate-300">✓</code>,{' '}
                  <code className="text-slate-300">(correct)</code>, <code className="text-slate-300">&lt;-</code>, or{' '}
                  <code className="text-slate-300">**bold**</code> on one option; or an{' '}
                  <code className="text-slate-300">Answer key</code> section at the bottom (<code className="text-slate-300">1-B, 2-C</code>).
                </div>
                <div>
                  <span className="font-semibold text-slate-200">Points:</span>{' '}
                  <code className="text-slate-300">(2 marks)</code>, <code className="text-slate-300">[2 pts]</code>,{' '}
                  <code className="text-slate-300">2M</code> at the end of the question, or a{' '}
                  <code className="text-slate-300">Points: 2</code> line.
                </div>
              </div>
            </details>

            {/* Settings */}
            <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 sm:grid-cols-2">
              <div>
                <label htmlFor="qb-default-points" className="label">
                  Default points
                </label>
                <input
                  id="qb-default-points"
                  type="number"
                  min={0}
                  max={100}
                  value={defaultPoints}
                  onChange={(e) => handleDefaultPointsChange(e.target.value)}
                  className="field"
                />
              </div>
              <div>
                <label htmlFor="qb-mode" className="label">
                  Mode
                </label>
                <select
                  id="qb-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as QuickBuildMode)}
                  className="field"
                >
                  <option value="add">Add to existing questions</option>
                  <option value="replace">Replace all questions</option>
                </select>
              </div>
            </div>
          </div>

          {/* Right column - Live preview */}
          <div className="flex flex-col bg-slate-950/60 lg:col-span-7 lg:min-h-0">
            {/* Summary & bulk bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/50 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite">
                {!inputText.trim() ? (
                  <span className="text-slate-400">Paste text on the left or click &ldquo;Insert sample&rdquo; to preview.</span>
                ) : isParsing ? (
                  <span className="text-slate-400">Reading questions…</span>
                ) : (
                  <>
                    <span className="font-bold text-white">
                      {cards.length} question{cards.length === 1 ? '' : 's'} found.
                    </span>
                    <span className="text-emerald-300">{readyCount} ready,</span>
                    <span className={blockingCount > 0 ? 'font-semibold text-red-300' : 'text-slate-400'}>
                      {blockingCount} {blockingCount === 1 ? 'needs' : 'need'} fixing.
                    </span>
                    {unparsed.length > 0 && (
                      <a
                        href="#qb-unparsed-lines"
                        className="badge bg-amber-500/20 text-amber-300 underline hover:bg-amber-500/30"
                      >
                        {unparsed.length} unread line{unparsed.length === 1 ? '' : 's'} ↓
                      </a>
                    )}
                  </>
                )}
              </div>

              {cards.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <label htmlFor="qb-bulk-points" className="whitespace-nowrap">
                    Set all points to
                  </label>
                  <input
                    id="qb-bulk-points"
                    type="number"
                    min={0}
                    max={100}
                    value={bulkPoints}
                    onChange={(e) => setBulkPoints(Number(e.target.value) || 0)}
                    className="field h-8 w-16 px-2 py-1 text-xs"
                  />
                  <button type="button" className="btn-secondary min-h-[32px] px-2.5 py-1 text-xs" onClick={applyAllPoints}>
                    Apply
                  </button>
                </div>
              )}
            </div>

            {/* Cards + Unparsed list */}
            <div className="flex-1 space-y-4 p-4 sm:p-5 lg:overflow-y-auto">
              {!inputText.trim() && (
                <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-400">
                  <p className="font-semibold text-slate-300">Live preview appears here as you type</p>
                  <p className="mt-1 max-w-md text-xs text-slate-500">
                    Questions without a clear correct answer are flagged in red — Quick Build never guesses an answer, and unread lines are listed below so nothing is lost.
                  </p>
                </div>
              )}

              {inputText.trim() !== '' && !isParsing && cards.length === 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                  No questions were detected yet. Make sure each question has options or an <code className="font-mono">Answer:</code> line.
                </div>
              )}

              {cardEvaluations.map(({ card, issues }, idx) => {
                const hasBlocking = issues.length > 0;
                return (
                  <div
                    key={card.id}
                    className={`rounded-xl border p-4 transition ${
                      hasBlocking
                        ? 'border-red-500/60 bg-red-950/15'
                        : 'border-slate-800 bg-slate-900/70'
                    }`}
                  >
                    {/* Card header */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">Question {idx + 1}</span>
                      <span className="badge bg-slate-800 text-slate-300">from line {card.line}</span>
                      {hasBlocking ? (
                        <span className="badge bg-red-500/20 text-red-300">Needs fixing</span>
                      ) : (
                        <span className="badge bg-emerald-500/20 text-emerald-300">✓ Ready</span>
                      )}

                      <div className="ml-auto flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs text-slate-300">
                          Pts
                          <input
                            type="number"
                            min={0}
                            max={100}
                            aria-label={`Question ${idx + 1} points`}
                            value={card.points}
                            onChange={(e) =>
                              updateCard(card.id, (c) => ({ ...c, points: clampPoints(Number(e.target.value)) }))
                            }
                            className="field h-8 w-16 px-2 py-1 text-xs"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeCard(card.id)}
                          className="btn-ghost min-h-[32px] px-2.5 py-1 text-xs text-red-300 hover:text-red-200"
                          aria-label={`Remove question ${idx + 1}`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Question text */}
                    <textarea
                      value={card.text}
                      onChange={(e) => updateCard(card.id, (c) => ({ ...c, text: e.target.value }))}
                      rows={2}
                      placeholder="Type the question text…"
                      aria-label={`Question ${idx + 1} text`}
                      className="field mt-3 resize-y text-sm"
                    />

                    {/* Options */}
                    <div className="mt-3 space-y-2" role="radiogroup" aria-label={`Options for question ${idx + 1}`}>
                      {card.options.map((opt, optIdx) => {
                        const letter = OPTION_LETTERS[optIdx] ?? String(optIdx + 1);
                        const isCorrect = opt.id === card.correctOptionId;
                        return (
                          <div
                            key={opt.id}
                            onClick={() => markCorrect(card.id, opt.id)}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 transition ${
                              isCorrect
                                ? 'border-emerald-500 bg-emerald-500/15'
                                : 'border-slate-700/80 bg-slate-950/60 hover:border-slate-600'
                            }`}
                          >
                            <button
                              type="button"
                              role="radio"
                              aria-checked={isCorrect}
                              aria-label={`Mark option ${letter} as correct`}
                              onClick={(e) => {
                                e.stopPropagation();
                                markCorrect(card.id, opt.id);
                              }}
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-extrabold transition ${
                                isCorrect
                                  ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                  : 'border-slate-600 bg-slate-900 text-slate-400 hover:border-emerald-400 hover:text-emerald-300'
                              }`}
                            >
                              {isCorrect ? '✓' : letter}
                            </button>

                            <span className="w-4 shrink-0 text-xs font-bold text-slate-400">{letter}</span>

                            <input
                              value={opt.text}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setOptionText(card.id, opt.id, e.target.value)}
                              placeholder={`Option ${letter}`}
                              aria-label={`Question ${idx + 1} option ${letter}`}
                              className="field border-0 bg-transparent px-1.5 py-1 text-sm focus:ring-0"
                            />

                            {isCorrect ? (
                              <span className="badge shrink-0 bg-emerald-500/25 text-emerald-200">✓ Correct</span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markCorrect(card.id, opt.id);
                                }}
                                className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 hover:bg-emerald-500/15 hover:text-emerald-300"
                              >
                                Mark correct
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteOption(card.id, opt.id);
                              }}
                              aria-label={`Delete option ${letter}`}
                              className="btn-ghost min-h-[28px] shrink-0 px-2 py-0.5 text-xs text-slate-400 hover:text-red-300"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}

                      {card.options.length < MAX_OPTIONS && (
                        <button
                          type="button"
                          onClick={() => addOption(card.id)}
                          className="btn-ghost min-h-[32px] px-2.5 py-1 text-xs"
                        >
                          + Add option
                        </button>
                      )}
                    </div>

                    {/* Blocking issues (red) */}
                    {issues.length > 0 && (
                      <ul
                        role="alert"
                        className="mt-3 space-y-1 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs text-red-200"
                      >
                        {issues.map((issue, k) => (
                          <li key={k} className="flex items-center justify-between gap-2">
                            <span>✕ {issue}</span>
                            {issue === LABEL_ORDER_ISSUE && (
                              <button
                                type="button"
                                onClick={() => updateCard(card.id, (c) => ({ ...c, labelOrderIssue: false }))}
                                className="shrink-0 rounded bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-100 hover:bg-red-500/35"
                              >
                                Confirm order
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Informational notes (amber, non-blocking) */}
                    {card.notes.length > 0 && (
                      <ul className="mt-2.5 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        {card.notes.map((note, k) => (
                          <li key={k}>ℹ {note}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

              {/* Lines we could not read */}
              {unparsed.length > 0 && (
                <section
                  id="qb-unparsed-lines"
                  aria-labelledby="qb-unparsed-heading"
                  className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4"
                >
                  <h3 id="qb-unparsed-heading" className="text-sm font-bold text-amber-200">
                    Lines we could not read ({unparsed.length})
                  </h3>
                  <p className="mt-0.5 text-xs text-amber-200/80">
                    Nothing is dropped silently — these lines were not part of any parsed question, option, or answer key:
                  </p>
                  <ul className="mt-2.5 space-y-1.5 font-mono text-xs">
                    {unparsed.map((u, idx) => (
                      <li
                        key={`${u.line}-${idx}`}
                        className="flex gap-2.5 rounded-lg bg-slate-950/70 px-3 py-1.5 text-amber-100"
                      >
                        <span className="shrink-0 font-bold text-amber-400">Line {u.line}</span>
                        <span className="break-all text-slate-200">{u.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/90 px-5 py-3.5">
          <div className="text-xs text-slate-400">
            {mode === 'replace' ? (
              <span className="text-amber-300">
                Replace mode: will replace {existingCount} existing question{existingCount === 1 ? '' : 's'}.
              </span>
            ) : (
              <span>
                Add mode: appends to your {existingCount} existing question{existingCount === 1 ? '' : 's'}.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canSubmit}
              onClick={handlePrimaryClick}
            >
              {primaryLabel}
            </button>
          </div>
        </div>

        {/* Replace confirmation dialog (keeps panel + pasted text intact if cancelled) */}
        {confirmReplace && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="qb-replace-title"
          >
            <div className="panel w-full max-w-md space-y-4 border-amber-500/40 bg-slate-900 shadow-2xl">
              <h3 id="qb-replace-title" className="text-lg font-bold text-white">
                Replace existing questions?
              </h3>
              <p className="text-sm text-slate-300">
                This will remove{' '}
                <strong className="text-white">
                  {existingCount} existing question{existingCount === 1 ? '' : 's'}
                </strong>{' '}
                from this quiz and replace {existingCount === 1 ? 'it' : 'them'} with{' '}
                <strong className="text-white">
                  {cards.length} new question{cards.length === 1 ? '' : 's'}
                </strong>
                .
              </p>
              <div className="flex justify-end gap-2.5 pt-1">
                <button type="button" className="btn-secondary" onClick={() => setConfirmReplace(false)}>
                  Keep reviewing
                </button>
                <button type="button" className="btn-danger" onClick={confirmAndReplace}>
                  Replace {existingCount} question{existingCount === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

