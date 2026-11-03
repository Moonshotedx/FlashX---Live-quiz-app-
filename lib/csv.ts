/** Minimal RFC 4180 style CSV parser and writer. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

/** Prevent spreadsheet formula injection from user supplied text (names etc). */
function safe(v: string) {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v) : safe(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export interface ImportedQuestion {
  text: string;
  options: string[];
  correctIndex: number;
  points: number;
}
export interface ImportRow {
  line: number;
  question?: ImportedQuestion;
  errors: string[];
}

export const CSV_TEMPLATE =
  'question,option_a,option_b,option_c,option_d,option_e,option_f,correct,points\r\n' +
  '"What does CPU stand for?","Central Processing Unit","Computer Personal Unit","Central Program Utility","Core Processing Unit",,,A,1\r\n' +
  '"Which language runs in the browser?","Python","JavaScript","C","Rust",,,B,2\r\n';

/** Parse the question import format with per row errors for the preview. */
export function parseQuestionCsv(text: string): ImportRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header[0] === 'question';
  const body = hasHeader ? rows.slice(1) : rows;
  return body.map((r, idx): ImportRow => {
    const line = idx + (hasHeader ? 2 : 1);
    const errors: string[] = [];
    const [q = '', a = '', b = '', c = '', d = '', e = '', f = '', corr = '', pts = ''] = r.map((v) => v.trim());
    const all = [a, b, c, d, e, f];
    // Keep the letter of each option so "correct" still maps after empty columns are dropped.
    const kept = all.map((text, i) => ({ text, letter: 'ABCDEF'[i] })).filter((o) => o.text !== '');
    if (!q) errors.push('Question text is empty');
    if (kept.length < 2) errors.push('Needs at least 2 options');
    const letter = corr.toUpperCase();
    const correctIndex = kept.findIndex((o) => o.letter === letter);
    if (!/^[A-F]$/.test(letter)) errors.push('"correct" must be a letter A to F');
    else if (correctIndex < 0) errors.push(`Correct option ${letter} is empty`);
    let points = 1;
    if (pts !== '') {
      const n = Number(pts);
      if (!Number.isInteger(n) || n < 0 || n > 100) errors.push('Points must be a whole number 0-100');
      else points = n;
    }
    return {
      line,
      errors,
      question: errors.length ? undefined : { text: q, options: kept.map((o) => o.text), correctIndex, points },
    };
  });
}

