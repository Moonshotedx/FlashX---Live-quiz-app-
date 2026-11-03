import { eventDate, exportName, type Results } from './results';
import { toCsv } from '../csv';
import type { SessionWithQuiz } from './session';

function hasAnyRollNumber(r: Results): boolean {
  return r.rows.some((x) => !!(x.rollNumber && x.rollNumber.trim()));
}

export function leaderboardHeader(includeRoll: boolean): string[] {
  return [
    'Rank',
    'Name',
    'Email',
    'Team',
    ...(includeRoll ? ['Roll number'] : []),
    'Score',
    'Correct count',
    'Total questions',
    'Time taken (seconds)',
    'Started at',
    'Submitted at',
    'Auto submitted',
  ];
}

export function leaderboardRows(r: Results, includeRoll = hasAnyRollNumber(r)) {
  return r.rows.map((x) => [
    x.rank,
    x.name,
    x.email ?? '',
    x.team ?? '',
    ...(includeRoll ? [x.rollNumber ?? ''] : []),
    x.score,
    x.correctCount,
    r.totalQuestions,
    x.timeTakenMs === null ? '' : Math.round(x.timeTakenMs / 100) / 10,
    x.startedAt ?? '',
    x.submittedAt ?? '',
    x.autoSubmitted ? 'Yes' : 'No',
  ]);
}

export function buildCsv(session: SessionWithQuiz, r: Results) {
  const date = eventDate(session.started_at ?? session.created_at);
  const includeRoll = hasAnyRollNumber(r);
  return {
    filename: exportName(session.quizzes.title, date, 'leaderboard', 'csv'),
    // BOM so Excel opens UTF-8 names correctly
    body: '\uFEFF' + toCsv([leaderboardHeader(includeRoll), ...leaderboardRows(r, includeRoll)]),
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

  const includeRoll = hasAnyRollNumber(r);

  // 1. Leaderboard
  const lb = wb.addWorksheet('Leaderboard', { views: [{ state: 'frozen', ySplit: 1 }] });
  lb.addRow(leaderboardHeader(includeRoll));
  headerStyle(lb.getRow(1));
  for (const row of leaderboardRows(r, includeRoll)) lb.addRow(row);
  lb.columns = [
    8, // Rank
    28, // Name
    28, // Email
    22, // Team
    ...(includeRoll ? [18] : []), // Roll number (when present)
    8, // Score
    14, // Correct count
    15, // Total questions
    20, // Time taken (seconds)
    26, // Started at
    26, // Submitted at
    14, // Auto submitted
  ].map((width) => ({ width }));

  // 2. Responses: one row per participant, one column per question (chosen option text)
  const metaHeader = ['Rank', 'Name', 'Email', 'Team', ...(includeRoll ? ['Roll number'] : [])];
  const metaCols = metaHeader.length;
  const rs = wb.addWorksheet('Responses', { views: [{ state: 'frozen', xSplit: metaCols, ySplit: 1 }] });
  rs.addRow([...metaHeader, ...r.snapshot.questions.map((q, i) => `Q${i + 1}. ${q.text}`)]);
  headerStyle(rs.getRow(1));
  rs.getRow(1).height = 60;
  for (const p of r.rows) {
    const chosen = r.answers.get(p.participantId);
    const cells = r.snapshot.questions.map((q) => {
      const optId = chosen?.get(q.id);
      const opt = q.options.find((o) => o.id === optId);
      return opt ? opt.text : '';
    });
    const row = rs.addRow([
      p.rank,
      p.name,
      p.email ?? '',
      p.team ?? '',
      ...(includeRoll ? [p.rollNumber ?? ''] : []),
      ...cells,
    ]);
    r.snapshot.questions.forEach((q, i) => {
      const opt = q.options.find((o) => o.id === chosen?.get(q.id));
      if (!opt) return;
      row.getCell(metaCols + 1 + i).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: opt.is_correct ? GREEN : RED },
      };
    });
  }
  rs.columns = [
    { width: 8 },
    { width: 28 },
    { width: 28 },
    { width: 22 },
    ...(includeRoll ? [{ width: 18 }] : []),
    ...r.snapshot.questions.map(() => ({ width: 28 })),
  ];

  // 3. Question stats
  const qs = wb.addWorksheet('Question stats', { views: [{ state: 'frozen', ySplit: 1 }] });
  const maxOpts = Math.max(2, ...r.questionStats.map((q) => q.options.length));
  qs.addRow([
    '#',
    'Question',
    'Correct answer',
    'Answered',
    'Correct',
    '% correct (of answered)',
    ...Array.from({ length: maxOpts }, (_, i) => `Option ${'ABCDEF'[i]} count`),
  ]);
  headerStyle(qs.getRow(1));
  r.questionStats.forEach((q, i) => {
    const row = qs.addRow([
      i + 1,
      q.text,
      q.correctText,
      q.answered,
      q.correct,
      q.percentCorrect / 100,
      ...Array.from({ length: maxOpts }, (_, k) => (q.options[k] ? q.options[k].count : '')),
    ]);
    row.getCell(6).numFmt = '0.0%';
    row.alignment = { wrapText: true, vertical: 'top' };
  });
  qs.columns = [
    { width: 5 },
    { width: 50 },
    { width: 30 },
    { width: 10 },
    { width: 10 },
    { width: 22 },
    ...Array.from({ length: maxOpts }, () => ({ width: 16 })),
  ];

  // 4. Teams (ranked by average score desc, tie-broken by total score desc)
  const tm = wb.addWorksheet('Teams', { views: [{ state: 'frozen', ySplit: 1 }] });
  tm.addRow(['Rank', 'Team', 'Members submitted', 'Total score', 'Average score', 'Best individual']);
  headerStyle(tm.getRow(1));
  for (const t of r.teamRows) {
    tm.addRow([
      t.rank,
      t.team,
      t.membersSubmitted,
      t.totalScore,
      t.averageScore,
      t.bestIndividual ? `${t.bestIndividual.name} (${t.bestIndividual.score})` : '',
    ]);
  }
  tm.columns = [{ width: 8 }, { width: 28 }, { width: 18 }, { width: 14 }, { width: 16 }, { width: 32 }];

  const date = eventDate(session.started_at ?? session.created_at);
  const buffer = await wb.xlsx.writeBuffer();
  return { filename: exportName(session.quizzes.title, date, 'results', 'xlsx'), buffer: buffer as ArrayBuffer };
}
