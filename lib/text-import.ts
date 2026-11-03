/**
 * Rule-based parser that turns pasted plain text (Word, Google Docs, WhatsApp, PDF, .txt, .md)
 * into quiz questions. Pure TypeScript: no DOM, no dependencies, no network, no AI.
 *
 * Hard rules:
 * - It NEVER guesses a correct answer. No clear answer means a blocking issue and `correctIndex = null`.
 * - It NEVER silently drops text. Every non-empty line is either used or reported in `unparsed`.
 */

export interface ParsedQuestion {
  sourceNumber: number | null; // the number written in the text, if any
  line: number; // 1-based line where the question starts
  text: string;
  options: string[];
  correctIndex: number | null;
  points: number;
  issues: string[]; // blocking
  notes: string[]; // informational
}

export interface ParseResult {
  questions: ParsedQuestion[];
  unparsed: { line: number; text: string }[];
}

export const MAX_OPTIONS = 6;
export const MAX_QUESTION_CHARS = 1000; // matches the server schema
export const MAX_OPTION_CHARS = 300; // matches the server schema

const LETTERS = 'abcdefgh';
const ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
const SHORT_OPTION_CHARS = 120;

// ---------------------------------------------------------------------------
// Clean-up
// ---------------------------------------------------------------------------

interface Line {
  n: number; // 1-based line number in the original input
  raw: string; // normalised but otherwise untouched (used for the "could not read" list)
  text: string; // cleaned: bullets, headings and emphasis removed
  emph: boolean; // the line contained **bold** or __bold__
  blank: boolean;
}

// Emphasis must start and end on a non-space, non-marker character so "______" blanks are not mangled.
const EMPH_RE = /(\*\*|__)(?=[^\s_*])(.*?[^\s_*])\1/g;

function normalise(input: string): string {
  return input
    .replace(/\r\n?|[\u2028\u2029\u000B\u000C]/g, '\n')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\u00A0\u2007\u202F\u2009\u2002\u2003\u2005]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"');
}

function prepare(input: string): Line[] {
  return normalise(input)
    .split('\n')
    .map((rawLine, i): Line => {
      const raw = rawLine.replace(/ {2,}/g, ' ').trim();
      let text = raw
        .replace(/^#{1,6}\s+/, '') // markdown headings
        .replace(/^(?:[•◦▪●‣·▫■□○]\s*|-\s+)/, '') // bullets
        .trim();
      let emph = false;
      text = text.replace(EMPH_RE, (_m, _d, inner: string) => {
        emph = true;
        return inner;
      });
      // WhatsApp bold is a single asterisk: "*1. Capital of France?*". Unwrap it when it wraps a question line.
      const wrapped = /^\*(\S.*\S|\S)\*$/.exec(text.trim());
      if (wrapped && questionStart(wrapped[1])) text = wrapped[1];
      return { n: i + 1, raw, text: text.trim(), emph, blank: text.trim() === '' };
    });
}

/** Lowercase, drop punctuation and collapse spaces, for comparing answer text with option text. */
function squash(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Line patterns
// ---------------------------------------------------------------------------

const Q_PREFIX = /^(?:question|q)\s*\.?\s*(\d{1,4})(?:\s*[.:)\]\-–—]\s*|\s+|$)(.*)$/i;
const NUM_PAREN = /^\(\s*(\d{1,4})\s*\)\s*(.*)$/;
const NUM_DOT = /^(\d{1,4})\s*(?:\)|:(?!\d)|\.(?!\d))\s*(.*)$/;
const NUM_DASH = /^(\d{1,4})\s*[-–—]\s+(.*)$/;
const STARTS_WORDLIKE = /^[\p{L}"'(\[¿¡]/u;

function questionStart(text: string): { num: number; rest: string } | null {
  let m = Q_PREFIX.exec(text);
  if (m) return { num: Number(m[1]), rest: m[2].trim() };
  m = NUM_PAREN.exec(text) ?? NUM_DOT.exec(text);
  if (m) return { num: Number(m[1]), rest: m[2].trim() };
  m = NUM_DASH.exec(text);
  // "10 - 5 = ?" is arithmetic, not question 10
  if (m && STARTS_WORDLIKE.test(m[2])) return { num: Number(m[1]), rest: m[2].trim() };
  return null;
}

const ANSWER_LINE = /^(?:right\s+answer|correct\s+answer|correct\s+option|correct|answer|ans|key|solution)\s*[:\-–—.=)]+\s*(.+)$/i;
const POINTS_LINE = /^(?:points?|marks?|pts)\s*[:=\-–—]\s*(\d{1,3})\s*$/i;
const KEY_HEADING = /^(?:answers?\s*key|answer\s*sheet|answers?|key|solutions?)\s*[:\-–—]?\s*(.*)$/i;

const START_MARK = /^[*✓✔✅☑]+\s*/;
const END_MARK = /\s*(?:\((?:correct|ans(?:wer)?|right)\)|\[(?:correct|ans(?:wer)?|right)\]|<-+|←|[*✓✔✅☑])\s*$/i;

function stripMarkers(input: string): { text: string; marked: boolean } {
  let s = input.trim();
  let marked = false;
  for (;;) {
    const before = s;
    if (START_MARK.test(s)) {
      s = s.replace(START_MARK, '');
      marked = true;
    }
    if (END_MARK.test(s)) {
      s = s.replace(END_MARK, '');
      marked = true;
    }
    s = s.trim();
    if (s === before) break;
  }
  return { text: s, marked };
}

const OPT_PAREN = /^\(\s*([A-Ha-h])\s*\)\s*(.*)$/;
const OPT_BRACKET = /^\[\s*([A-Ha-h])\s*\]\s*(.*)$/;
const OPT_PUNCT = /^([A-Ha-h])\s*[.:)]\s*(.*)$/;
const OPT_DASH = /^([A-Ha-h])\s+[-–—]\s+(.*)$/;
const ROMAN_PAREN = /^\(\s*(i{1,3}|iv|v|vi{1,3})\s*\)\s*(.*)$/i;
const ROMAN_CLOSE = /^(i{1,3}|iv|v|vi{1,3})\s*\)\s*(.*)$/i;

interface OptionLine {
  family: 'letter' | 'roman';
  first: number; // label index of the first option on the line (A = 0)
  rest: string; // text after the first label
}

function optionLabel(text: string): OptionLine | null {
  if (/^(?:e\.g|i\.e)\b/i.test(text)) return null; // "e.g. apple" is a sentence, not option E
  for (const re of [OPT_PAREN, OPT_BRACKET, OPT_PUNCT, OPT_DASH]) {
    const m = re.exec(text);
    if (m) return { family: 'letter', first: LETTERS.indexOf(m[1].toLowerCase()), rest: m[2] };
  }
  for (const re of [ROMAN_PAREN, ROMAN_CLOSE]) {
    const m = re.exec(text);
    if (m) return { family: 'roman', first: ROMANS.indexOf(m[1].toLowerCase()), rest: m[2] };
  }
  return null;
}

/**
 * Split `a. Java  b. C  c. Python` into chunks, but only when the line started with the FIRST label
 * and the following labels appear in sequence. Anything else is left as a single option.
 */
function splitInline(o: OptionLine): string[] {
  if (o.first !== 0) return [o.rest];
  const labels = o.family === 'letter' ? LETTERS.split('') : ROMANS;
  const chunks: string[] = [];
  let from = 0;
  let k = 1;
  const rest = o.rest;
  while (k < labels.length) {
    const L = labels[k];
    const re =
      o.family === 'letter'
        ? new RegExp(`(?:^|\\s)(?:\\(${L}\\)|\\[${L}\\]|${L}[.:)])(?=\\s|$)`, 'i')
        : new RegExp(`(?:^|\\s)(?:\\(${L}\\)|${L}\\))(?=\\s|$)`, 'i');
    const m = re.exec(rest.slice(from));
    if (!m) break;
    chunks.push(rest.slice(from, from + m.index).trim());
    from += m.index + m[0].length;
    k++;
  }
  if (!chunks.length) return [rest];
  chunks.push(rest.slice(from).trim());
  return chunks;
}

const POINTS_BRACKET = /\s*[(\[]\s*(\d{1,3})\s*(?:marks?|points?|pts?|m)\s*[)\]]\s*$/i;
const POINTS_SHORT = /\s+(\d{1,3})\s*M\s*$/;

function takePoints(text: string): { text: string; points: number | null } {
  const m = POINTS_BRACKET.exec(text) ?? POINTS_SHORT.exec(text);
  if (!m) return { text, points: null };
  return { text: text.slice(0, m.index).trim(), points: Number(m[1]) };
}

// ---------------------------------------------------------------------------
// Answer key section
// ---------------------------------------------------------------------------

interface KeyEntry {
  num: number;
  value: string;
  line: number;
  text: string; // for the "could not read" list if the entry matches no question
  used: boolean;
}

const KEY_SINGLE = /^(?:q(?:uestion)?\.?\s*)?(\d{1,4})\s*[-–—.:)=]\s*(\S.*)$/i;
const KEY_COMPACT = /(\d{1,4})\s*[-–—.:)=]\s*\(?([A-Ha-h])\)?(?=[\s,;]|$)/g;

function keyValueOk(v: string): boolean {
  return v.length > 0 && v.length <= 80 && !v.trim().endsWith('?');
}

function parseKeyLine(text: string): { num: number; value: string; text: string }[] | null {
  // "1-B 2-C 3-A" or "1-B, 2-C, 3-A"
  const compact = [...text.matchAll(KEY_COMPACT)];
  if (compact.length > 1 && text.replace(KEY_COMPACT, '').replace(/[\s,;]+/g, '') === '') {
    return compact.map((m) => ({ num: Number(m[1]), value: m[2], text: m[0] }));
  }
  // "1-B, 2-C" where values can be words: every comma separated part must be an entry
  const parts = text.split(/\s*[,;]\s*/).filter(Boolean);
  if (parts.length > 1) {
    const out: { num: number; value: string; text: string }[] = [];
    for (const p of parts) {
      const m = KEY_SINGLE.exec(p);
      if (!m || !keyValueOk(m[2].trim())) return parseSingleKey(text);
      out.push({ num: Number(m[1]), value: m[2].trim().replace(/[.;]+$/, ''), text: p });
    }
    return out;
  }
  return parseSingleKey(text);
}

function parseSingleKey(text: string) {
  const m = KEY_SINGLE.exec(text);
  if (!m || !keyValueOk(m[2].trim())) return null;
  return [{ num: Number(m[1]), value: m[2].trim().replace(/[.;]+$/, ''), text }];
}

/** Find "Answers" / "Answer key" sections. Returns the entries and marks the lines they used. */
function extractAnswerKey(lines: Line[], consumed: Set<number>): KeyEntry[] {
  const entries: KeyEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = !lines[i].blank && !consumed.has(i) ? KEY_HEADING.exec(lines[i].text) : null;
    if (!h) continue;
    const used: number[] = [];
    const found: KeyEntry[] = [];
    const push = (ln: Line, list: { num: number; value: string; text: string }[]) => {
      for (const e of list) found.push({ ...e, line: ln.n, used: false });
    };
    // Entries on the heading line itself ("Answers: 1-B, 2-C")
    if (h[1].trim()) {
      const list = parseKeyLine(h[1].trim());
      if (!list) continue; // "Key: B" and similar are answer lines, not headings
      push(lines[i], list);
    }
    used.push(i);
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].blank) continue;
      if (consumed.has(j)) break;
      const list = parseKeyLine(lines[j].text);
      if (!list) break;
      // A text value that is really the next question ("3. Photosynthesis occurs in" + options) ends the key.
      const textValue = list.some((e) => !/^\(?[A-Ha-h]\)?$|^\(?(?:i{1,3}|iv|v|vi{1,3})\)?$|^\d{1,2}$/i.test(e.value));
      if (textValue) {
        let k = j + 1;
        while (k < lines.length && lines[k].blank) k++;
        if (k < lines.length && optionLabel(lines[k].text)) break;
      }
      used.push(j);
      push(lines[j], list);
    }
    if (!found.length) continue;
    for (const u of used) consumed.add(u);
    entries.push(...found);
    i = j - 1;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Draft questions
// ---------------------------------------------------------------------------

interface Opt {
  text: string;
  label: number | null; // label index (A = 0) when the option was labelled
  marked: boolean;
  emph: boolean;
}

type Source = { kind: 'line' | 'key'; value: string } | { kind: 'marker' | 'emph'; index: number };

interface Draft {
  sourceNumber: number | null;
  line: number;
  textParts: string[];
  options: Opt[];
  unlabelled: boolean;
  sources: Source[];
  points: number | null;
  notes: string[];
  issues: string[];
}

interface Segment {
  sourceNumber: number | null;
  startLine: number;
  lines: Line[]; // lines[0] already has its question prefix removed in numbered mode
}

function buildDraft(seg: Segment, numbered: boolean, unparsed: { line: number; text: string }[]): Draft | null {
  const d: Draft = {
    sourceNumber: seg.sourceNumber,
    line: seg.startLine,
    textParts: [],
    options: [],
    unlabelled: false,
    sources: [],
    points: null,
    notes: [],
    issues: [],
  };

  const pre: { text: string; n: number; raw: string; gapBefore: boolean }[] = [];
  const after: { n: number; raw: string }[] = []; // stray text after labelled options
  const pointsLines: { n: number; raw: string }[] = [];
  let sawLabelled = false;
  let answerLines = 0;
  let lastLabel = -1;
  let outOfOrder = false;
  let gap = false;

  seg.lines.forEach((ln, idx) => {
    if (ln.blank) {
      if (!(numbered && idx === 0)) gap = true;
      return;
    }
    // In numbered mode the first line is the question itself, whatever it looks like.
    if (!(numbered && idx === 0)) {
      const ans = ANSWER_LINE.exec(ln.text);
      if (ans) {
        answerLines++;
        d.sources.push({ kind: 'line', value: ans[1].trim() });
        return;
      }
      const pts = POINTS_LINE.exec(ln.text);
      if (pts) {
        d.points = Number(pts[1]);
        pointsLines.push({ n: ln.n, raw: ln.raw });
        return;
      }
      // A marker can sit in front of the label: "✓ A) Paris" or "*B. Paris"
      const startMarked = START_MARK.test(ln.text);
      const o = optionLabel(startMarked ? ln.text.replace(START_MARK, '') : ln.text);
      if (o) {
        sawLabelled = true;
        const chunks = splitInline(o);
        chunks.forEach((chunk, ci) => {
          const label = o.first + ci;
          if (label <= lastLabel) outOfOrder = true;
          lastLabel = label;
          const m = stripMarkers(chunk);
          d.options.push({
            text: m.text,
            label,
            marked: m.marked || (ci === 0 && startMarked),
            emph: ln.emph && chunks.length === 1,
          });
        });
        gap = false;
        return;
      }
    }
    if (!sawLabelled) pre.push({ text: ln.text, n: ln.n, raw: ln.raw, gapBefore: gap && pre.length > 0 });
    else after.push({ n: ln.n, raw: ln.raw });
    gap = false;
  });

  // Text after labelled options is not an option and not an answer: it is reported, never dropped.
  const stray: { n: number; raw: string }[] = [...after];

  if (sawLabelled) {
    d.textParts = pre.map((p) => p.text);
  } else {
    // No labels: the first text line is the question, and 2+ short lines that follow are the options.
    const rest = pre.slice(1);
    let runEnd = 0;
    while (runEnd < rest.length && !(runEnd > 0 && rest[runEnd].gapBefore)) runEnd++;
    const run = rest.slice(0, runEnd);
    const asOptions = run.length >= 2 && run.every((r) => r.text.length <= SHORT_OPTION_CHARS);
    if (asOptions) {
      d.textParts = pre.slice(0, 1).map((p) => p.text);
      d.unlabelled = true;
      for (const r of run) {
        const m = stripMarkers(r.text);
        d.options.push({ text: m.text, label: null, marked: m.marked, emph: false });
      }
      d.notes.push('Options had no labels, check the order');
    } else {
      d.textParts = pre.slice(0, runEnd + 1).map((p) => p.text);
    }
    for (const s of rest.slice(runEnd)) stray.push({ n: s.n, raw: s.raw });
  }

  // In free-form text a block only counts as a question if it has some sign of an answer or options.
  if (!numbered && !sawLabelled && answerLines === 0 && !d.options.some((o) => o.marked)) {
    for (const p of pre) unparsed.push({ line: p.n, text: p.raw });
    for (const p of pointsLines) unparsed.push({ line: p.n, text: p.raw });
    return null;
  }
  for (const s of stray) unparsed.push({ line: s.n, text: s.raw });

  // Points can sit at the end of any question text line.
  d.textParts = d.textParts.map((t) => {
    const p = takePoints(t);
    if (p.points !== null) d.points = p.points;
    return p.text;
  });

  if (outOfOrder) d.issues.push('Option labels are out of order or repeated, check this question');
  d.options.forEach((o, i) => {
    if (o.marked) d.sources.push({ kind: 'marker', index: i });
  });
  const emphasised = d.options.map((o, i) => (o.emph ? i : -1)).filter((i) => i >= 0);
  if (emphasised.length === 1 && d.options.length > 1) d.sources.push({ kind: 'emph', index: emphasised[0] });
  return d;
}

// ---------------------------------------------------------------------------
// Answer resolution
// ---------------------------------------------------------------------------

type Resolved = { index: number; byText?: boolean } | { tf: boolean } | { issue: string };

function findByLabel(options: Opt[], label: number): number {
  const byLabel = options.findIndex((o) => o.label === label);
  if (byLabel >= 0) return byLabel;
  // Unlabelled options are addressed by position.
  return options.every((o) => o.label === null) && label < options.length ? label : -1;
}

function resolveAnswer(rawValue: string, options: Opt[]): Resolved {
  const v = rawValue.trim().replace(/[.;,]+$/, '').trim();
  if (!v) return { issue: 'The answer is empty' };
  const bare = v.replace(/^(?:option|opt|choice)\.?\s+/i, '');

  // True / False
  const tf = /^(true|t)$/i.test(bare) ? true : /^(false|f)$/i.test(bare) ? false : null;
  if (tf !== null) {
    if (options.length === 0) return { tf };
    const i = options.findIndex((o) => squash(o.text) === (tf ? 'true' : 'false'));
    if (i >= 0) return { index: i, byText: true };
  }

  let m = /^\(?([A-Ha-h])\)?$/.exec(bare);
  if (m) {
    const label = LETTERS.indexOf(m[1].toLowerCase());
    const i = findByLabel(options, label);
    return i >= 0 ? { index: i } : { issue: `Answer ${m[1].toUpperCase()} does not match any option` };
  }

  m = /^\(?(i{1,3}|iv|v|vi{1,3})\)?$/i.exec(bare);
  if (m) {
    const label = ROMANS.indexOf(m[1].toLowerCase());
    const i = findByLabel(options, label);
    return i >= 0 ? { index: i } : { issue: `Answer ${m[1]} does not match any option` };
  }

  m = /^(\d{1,2})$/.exec(bare);
  if (m) {
    // "2" can mean the second option or an option whose text is "2". If both readings exist and differ, ask.
    const n = Number(m[1]);
    const byPosition = n >= 1 && n <= options.length ? n - 1 : -1;
    const sqn = squash(bare);
    const byText = options.map((o, i) => (squash(o.text) === sqn ? i : -1)).filter((i) => i >= 0);
    if (byText.length === 1 && byPosition >= 0 && byText[0] !== byPosition) {
      return { issue: `Answer ${n} could mean option number ${n} or the option text "${n}", click the right option` };
    }
    if (byText.length === 1) return { index: byText[0], byText: byPosition !== byText[0] };
    if (byPosition >= 0) return { index: byPosition };
    return { issue: `Answer ${n} does not match any option` };
  }

  // The option text itself
  const sq = squash(v);
  if (sq) {
    const hits = options.map((o, i) => (squash(o.text) === sq ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 1) return { index: hits[0], byText: true };
    if (hits.length > 1) return { issue: `Answer "${v}" matches more than one option` };
  }

  // "B) Paris": the letter must point at an option with that text
  m = /^\(?([A-Ha-h])[.:)\]\-–—]\s*(\S.*)$/.exec(v);
  if (m) {
    const i = findByLabel(options, LETTERS.indexOf(m[1].toLowerCase()));
    if (i < 0) return { issue: `Answer ${m[1].toUpperCase()} does not match any option` };
    return squash(options[i].text) === squash(m[2]) ? { index: i } : { issue: 'Answer letter and text do not match' };
  }

  return { issue: `Answer "${v}" does not match any option` };
}

function finalize(d: Draft, defaultPoints: number): ParsedQuestion {
  // True / False questions have no options: create them from the answer.
  if (d.options.length === 0) {
    const tfs = d.sources
      .filter((s): s is { kind: 'line' | 'key'; value: string } => s.kind === 'line' || s.kind === 'key')
      .map((s) => resolveAnswer(s.value, []))
      .filter((r): r is { tf: boolean } => 'tf' in r);
    if (tfs.length) {
      d.options = [
        { text: 'True', label: null, marked: false, emph: false },
        { text: 'False', label: null, marked: false, emph: false },
      ];
      d.notes.push('True/False options added automatically');
    }
  }

  const found = new Set<number>();
  const answerIssues: string[] = [];
  let byText = false;
  let fromKey = false;
  for (const s of d.sources) {
    if ('index' in s) {
      found.add(s.index);
      continue;
    }
    const r = resolveAnswer(s.value, d.options);
    if ('issue' in r) {
      if (!answerIssues.includes(r.issue)) answerIssues.push(r.issue);
    } else if ('tf' in r) {
      const i = d.options.findIndex((o) => squash(o.text) === (r.tf ? 'true' : 'false'));
      if (i >= 0) found.add(i);
      else answerIssues.push(`Answer ${r.tf ? 'True' : 'False'} does not match any option`);
      if (s.kind === 'key') fromKey = true;
    } else {
      found.add(r.index);
      byText ||= !!r.byText;
      if (s.kind === 'key') fromKey = true;
    }
  }
  if (byText) d.notes.push('Answer matched by text');
  if (fromKey) d.notes.push('Answer taken from answer key');

  const issues = [...d.issues];
  const text = d.textParts.join('\n').trim();
  const optionTexts = d.options.map((o) => o.text);

  if (!text) issues.push('The question text is empty');
  else if (text.length > MAX_QUESTION_CHARS) issues.push(`The question text is longer than ${MAX_QUESTION_CHARS} characters`);
  if (optionTexts.length < 2) issues.push(`Needs at least 2 options (found ${optionTexts.length})`);
  if (optionTexts.length > MAX_OPTIONS) issues.push(`Has ${optionTexts.length} options, the maximum is ${MAX_OPTIONS}`);
  if (optionTexts.some((t) => !t)) issues.push('An option is empty');
  if (optionTexts.some((t) => t.length > MAX_OPTION_CHARS)) issues.push(`An option is longer than ${MAX_OPTION_CHARS} characters`);
  const squashed = optionTexts.filter(Boolean).map(squash);
  if (new Set(squashed).size < squashed.length) issues.push('Two options have the same text');

  let correctIndex: number | null = null;
  if (answerIssues.length) issues.push(...answerIssues);
  else if (found.size > 1) issues.push('Two different answers found');
  else if (found.size === 0) issues.push('No correct answer found - click the right option');
  else correctIndex = [...found][0];

  const pts = d.points ?? defaultPoints;
  return {
    sourceNumber: d.sourceNumber,
    line: d.line,
    text,
    options: optionTexts,
    correctIndex,
    points: Math.max(0, Math.min(100, Math.round(pts))),
    issues,
    notes: d.notes,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseQuestionText(input: string, opts?: { defaultPoints?: number }): ParseResult {
  const defaultPoints = Math.max(0, Math.min(100, Math.round(opts?.defaultPoints ?? 1)));
  const lines = prepare(input);
  const unparsed: { line: number; text: string }[] = [];

  const consumed = new Set<number>();
  const keyEntries = extractAnswerKey(lines, consumed);

  // ---- split into segments ----
  const live = lines.map((l, i) => ({ l, i })).filter((x) => !consumed.has(x.i));
  const starts = live.map((x) => (x.l.blank ? null : questionStart(x.l.text)));
  const numbered = starts.some(Boolean);
  const segments: Segment[] = [];

  if (numbered) {
    let cur: Segment | null = null;
    live.forEach(({ l }, k) => {
      const s = starts[k];
      if (s) {
        cur = { sourceNumber: s.num, startLine: l.n, lines: [{ ...l, text: s.rest, blank: s.rest === '' }] };
        segments.push(cur);
      } else if (cur) {
        cur.lines.push(l);
      } else if (!l.blank) {
        unparsed.push({ line: l.n, text: l.raw }); // text before the first question
      }
    });
  } else {
    let cur: Segment | null = null;
    for (const { l } of live) {
      if (l.blank) {
        cur = null;
      } else if (cur) {
        cur.lines.push(l);
      } else {
        cur = { sourceNumber: null, startLine: l.n, lines: [l] };
        segments.push(cur);
      }
    }
  }

  const drafts: Draft[] = [];
  for (const seg of segments) {
    const d = buildDraft(seg, numbered, unparsed);
    if (d) drafts.push(d);
  }

  // ---- answer key: match by the number written in the text, else by order ----
  if (keyEntries.length) {
    const byNumber = new Map<number, Draft[]>();
    drafts.forEach((d, i) => {
      const n = d.sourceNumber ?? i + 1;
      byNumber.set(n, [...(byNumber.get(n) ?? []), d]);
    });
    const seen = new Map<number, number>();
    for (const e of keyEntries) {
      const k = seen.get(e.num) ?? 0;
      seen.set(e.num, k + 1);
      const target = byNumber.get(e.num)?.[k];
      if (target) {
        target.sources.push({ kind: 'key', value: e.value });
        e.used = true;
      } else {
        unparsed.push({ line: e.line, text: e.text });
      }
    }
  }

  const questions = drafts.map((d) => finalize(d, defaultPoints));
  unparsed.sort((a, b) => a.line - b.line);
  return { questions, unparsed };
}
