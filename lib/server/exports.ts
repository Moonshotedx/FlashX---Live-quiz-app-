import { eventDate, exportName, type Results } from './results';
import { toCsv } from '../csv';
import type { SessionWithQuiz } from './session';

const LEADERBOARD_HEADER = [
  'Rank', 'Name', 'Roll number', 'Score', 'Correct count', 'Total questions', 'Time taken (seconds)', 'Submitted at', 'Auto submitted',
];

export function leaderboardRows(r: Results) {
  return r.rows.map((x) => [
    x.rank,
    x.name,
    x.rollNumber ?? '',
    x.score,
    x.correctCount,
    r.totalQuestions,
    x.timeTakenMs === null ? '' : Math.round(x.timeTakenMs / 100) / 10,
    x.submittedAt ?? '',
    x.autoSubmitted ? 'Yes' : 'No',
  ]);
}

export function buildCsv(session: SessionWithQuiz, r: Results) {
  const date = eventDate(session.started_at ?? session.created_at);
  return {
    filename: exportName(session.quizzes.title, date, 'leaderboard', 'csv'),
    // BOM so Excel opens UTF-8 names correctly
    body: '\uFEFF' + toCsv([LEADERBOARD_HEADER, ...leaderboardRows(r)]),
  };
}

export async function buildXlsx(session: SessionWithQuiz, r: Results) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Live Quiz';
  const GREEN = 'FFBBF7D0';
  const RED = 'FFFECACA';
  const headerStyle = (row: import('exceljs').Row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }));
  };

  // 1. Leaderboard
  const lb = wb.addWorksheet('Leaderboard', { views: [{ state: 'frozen', ySplit: 1 }] });
  lb.addRow(LEADERBOARD_HEADER);
  headerStyle(lb.getRow(1));
  for (const row of leaderboardRows(r)) lb.addRow(row);
  lb.columns = [8, 28, 18, 8, 14, 15, 20, 26, 14].map((width) => ({ width }));

  // 2. Responses: one row per participant, one column per question (chosen option text)
  const rs = wb.addWorksheet('Responses', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  rs.addRow(['Rank', 'Name', 'Roll number', ...r.snapshot.questions.map((q, i) => `Q${i + 1}. ${q.text}`)]);
  headerStyle(rs.getRow(1));
  rs.getRow(1).height = 60;
  for (const p of r.rows) {
    const chosen = r.answers.get(p.participantId);
    const cells = r.snapshot.questions.map((q) => {
      const optId = chosen?.get(q.id);
      const opt = q.options.find((o) => o.id === optId);
      return opt ? opt.text : '';
    });
    const row = rs.addRow([p.rank, p.name, p.rollNumber ?? '', ...cells]);
    r.snapshot.questions.forEach((q, i) => {
      const opt = q.options.find((o) => o.id === chosen?.get(q.id));
      if (!opt) return;
      row.getCell(4 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.is_correct ? GREEN : RED } };
    });
  }
  rs.columns = [{ width: 8 }, { width: 28 }, { width: 18 }, ...r.snapshot.questions.map(() => ({ width: 28 }))];

  // 3. Question stats
  const qs = wb.addWorksheet('Question stats', { views: [{ state: 'frozen', ySplit: 1 }] });
  const maxOpts = Math.max(2, ...r.questionStats.map((q) => q.options.length));
  qs.addRow([
    '#', 'Question', 'Correct answer', 'Answered', 'Correct', '% correct (of answered)',
    ...Array.from({ length: maxOpts }, (_, i) => `Option ${'ABCDEF'[i]} count`),
  ]);
  headerStyle(qs.getRow(1));
  r.questionStats.forEach((q, i) => {
    const row = qs.addRow([
      i + 1, q.text, q.correctText, q.answered, q.correct, q.percentCorrect / 100,
      ...Array.from({ length: maxOpts }, (_, k) => (q.options[k] ? q.options[k].count : '')),
    ]);
    row.getCell(6).numFmt = '0.0%';
    row.alignment = { wrapText: true, vertical: 'top' };
  });
  qs.columns = [{ width: 5 }, { width: 50 }, { width: 30 }, { width: 10 }, { width: 10 }, { width: 22 }, ...Array.from({ length: maxOpts }, () => ({ width: 16 }))];

  const date = eventDate(session.started_at ?? session.created_at);
  const buffer = await wb.xlsx.writeBuffer();
  return { filename: exportName(session.quizzes.title, date, 'results', 'xlsx'), buffer: buffer as ArrayBuffer };
}

