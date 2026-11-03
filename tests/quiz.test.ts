import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

import { toPublicQuestions } from '../lib/sanitize';
import { attemptOpen, GRACE_MS, rankParticipants, rankTeams, scoreAnswers, summarize, timeTakenMs } from '../lib/scoring';
import { validateQuiz } from '../lib/validate-quiz';
import { parseQuestionCsv, toCsv } from '../lib/csv';
import { isProfane } from '../lib/profanity';
import { generateJoinCode, JOIN_CODE_ALPHABET, normalizeJoinCode } from '../lib/join-code';
import { autoSchedule, revealPlan, visibleCount } from '../lib/reveal';
import { contrastRatio, effectiveBackgroundHex, PRESETS, resolveTheme, sanitizeTheme } from '../lib/theme';
import { buildCsv, buildXlsx } from '../lib/server/exports';
import type { Results } from '../lib/server/results';
import type { SessionWithQuiz } from '../lib/server/session';
import type { Snapshot } from '../lib/types';

const SAMPLE_SNAPSHOT: Snapshot = {
  questions: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      position: 1,
      text: 'What is 2 + 2?',
      image_url: null,
      points: 2,
      options: [
        { id: 'aaaa1111-1111-4111-8111-111111111111', position: 1, text: '3', is_correct: false },
        { id: 'aaaa2222-1111-4111-8111-111111111111', position: 2, text: '4', is_correct: true },
        { id: 'aaaa3333-1111-4111-8111-111111111111', position: 3, text: '5', is_correct: false },
        { id: 'aaaa4444-1111-4111-8111-111111111111', position: 4, text: '22', is_correct: false },
      ],
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      position: 2,
      text: 'Which protocol resolves domain names?',
      image_url: null,
      points: 1,
      options: [
        { id: 'bbbb1111-2222-4222-8222-222222222222', position: 1, text: 'DNS', is_correct: true },
        { id: 'bbbb2222-2222-4222-8222-222222222222', position: 2, text: 'FTP', is_correct: false },
      ],
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      position: 3,
      text: 'Which data structure is LIFO?',
      image_url: null,
      points: 1,
      options: [
        { id: 'cccc1111-3333-4333-8333-333333333333', position: 1, text: 'Queue', is_correct: false },
        { id: 'cccc2222-3333-4333-8333-333333333333', position: 2, text: 'Stack', is_correct: true },
      ],
    },
  ],
};

describe('Security: correct answers never leak before reveal & no hardcoded passwords', () => {
  it('strips is_correct and position metadata in toPublicQuestions', () => {
    for (const shuffle of [false, true]) {
      const pub = toPublicQuestions(SAMPLE_SNAPSHOT, {
        shuffleQuestions: shuffle,
        shuffleOptions: shuffle,
        participantId: 'participant-abc-123',
      });
      const json = JSON.stringify(pub);
      assert.equal(json.includes('is_correct'), false, 'Serialized public questions must never contain is_correct');
      for (const q of pub) {
        assert.deepEqual(Object.keys(q).sort(), ['id', 'imageUrl', 'options', 'points', 'text']);
        for (const o of q.options) {
          assert.deepEqual(Object.keys(o).sort(), ['id', 'text']);
        }
      }
    }
  });

  it('produces stable per-participant shuffles across rejoins and varies across participants', () => {
    const first = toPublicQuestions(SAMPLE_SNAPSHOT, {
      shuffleQuestions: true,
      shuffleOptions: true,
      participantId: 'student-1',
    });
    const rejoin = toPublicQuestions(SAMPLE_SNAPSHOT, {
      shuffleQuestions: true,
      shuffleOptions: true,
      participantId: 'student-1',
    });
    assert.deepEqual(first, rejoin, 'Rejoining with the same participant id must yield identical question/option order');

    const orders = new Set(
      Array.from({ length: 20 }, (_, i) =>
        toPublicQuestions(SAMPLE_SNAPSHOT, {
          shuffleQuestions: true,
          shuffleOptions: true,
          participantId: `student-${i}`,
        })
          .map((q) => `${q.id}:${q.options.map((o) => o.id).join(',')}`)
          .join('|'),
      ),
    );
    assert.ok(orders.size > 1, 'Different participants should receive varied shuffled orders');
  });

  it('audits participant routes & pages to guarantee correctness is gated behind status === revealed and submitted', () => {
    const root = process.cwd();
    const preRevealFiles = [
      'app/api/join/[code]/route.ts',
      'app/api/play/[code]/begin/route.ts',
      'app/api/play/[code]/state/route.ts',
      'app/api/play/[code]/answer/route.ts',
      'app/api/play/[code]/submit/route.ts',
      'app/j/[joinCode]/page.tsx',
      'components/student/StudentApp.tsx',
      'components/student/QuestionScreen.tsx',
    ];
    for (const rel of preRevealFiles) {
      const src = readFileSync(join(root, rel), 'utf8');
      // Only answer/route.ts reads option.is_correct to write into DB; it must never return it.
      if (rel === 'app/api/play/[code]/answer/route.ts') {
        assert.match(src, /return\s*\{\s*ok:\s*true,\s*savedAt\s*\}/);
      } else {
        assert.equal(src.includes('is_correct'), false, `${rel} must not reference is_correct`);
      }
    }
    const stateSrc = readFileSync(join(root, 'app/api/play/[code]/state/route.ts'), 'utf8');
    assert.ok(stateSrc.includes('toPublicQuestions('), '/state must sanitize questions via toPublicQuestions');
    assert.ok(stateSrc.includes("phase === 'answering'"), '/state must only send questions during phase === answering');

    const resultSrc = readFileSync(join(root, 'app/api/play/[code]/result/route.ts'), 'utf8');
    assert.ok(
      resultSrc.includes('!participant.submitted_at'),
      '/result must reject participants whose attempt has not been submitted yet',
    );
    assert.ok(
      resultSrc.includes("session.status !== 'revealed'"),
      '/result must gate rank and answer review behind session.status === revealed',
    );
    // Ensure correctOptionId is constructed strictly after the session.status !== 'revealed' early return
    assert.ok(
      resultSrc.indexOf('correctOptionId') > resultSrc.indexOf("session.status !== 'revealed'"),
      'correctOptionId must only be constructed after verifying session.status === revealed',
    );
  });

  it('verifies hardcoded seed admin password defaults are removed from docs, env template, and scripts', () => {
    const root = process.cwd();
    for (const rel of ['.env.example', 'README.md', 'scripts/seed.ts', 'scripts/e2e.ts', 'scripts/loadtest.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      assert.equal(src.includes('12345678'), false, `${rel} must not contain hardcoded password 12345678`);
    }
  });
});

describe('Self-paced personal timers, scoring, ranking, and team rankings', () => {
  it('enforces attemptOpen personal timer + 3s grace window independently of session close', () => {
    const t0 = Date.parse('2026-11-05T10:00:00.000Z');
    const tEnd = Date.parse('2026-11-05T10:05:00.000Z');
    const startedIso = new Date(t0).toISOString();
    const endsIso = new Date(tEnd).toISOString();

    // Not started yet -> closed for answers
    assert.equal(
      attemptOpen({ is_removed: false, started_at: null, submitted_at: null, ends_at: null }, t0 + 1000),
      false,
    );
    // Started and within personal ends_at -> open
    assert.equal(
      attemptOpen({ is_removed: false, started_at: startedIso, submitted_at: null, ends_at: endsIso }, t0 + 60_000),
      true,
    );
    // Inside 3s grace window -> still open
    assert.equal(
      attemptOpen({ is_removed: false, started_at: startedIso, submitted_at: null, ends_at: endsIso }, tEnd + GRACE_MS),
      true,
    );
    // Past ends_at + GRACE_MS -> closed
    assert.equal(
      attemptOpen({ is_removed: false, started_at: startedIso, submitted_at: null, ends_at: endsIso }, tEnd + GRACE_MS + 1),
      false,
    );
    // Already submitted -> closed even before ends_at
    assert.equal(
      attemptOpen({ is_removed: false, started_at: startedIso, submitted_at: new Date(t0 + 20_000).toISOString(), ends_at: endsIso }, t0 + 30_000),
      false,
    );
    // Removed -> closed
    assert.equal(
      attemptOpen({ is_removed: true, started_at: startedIso, submitted_at: null, ends_at: endsIso }, t0 + 10_000),
      false,
    );
  });

  it('gives independent personal time_taken_ms to students starting at different wall-clock times', () => {
    // Student A starts at 10:00:00 and submits at 10:01:30 -> 90s
    const studentATime = timeTakenMs('2026-11-05T10:01:30.000Z', '2026-11-05T10:00:00.000Z');
    // Student B starts 15 minutes later at 10:15:00 and submits at 10:15:30 -> 30s (faster personal time!)
    const studentBTime = timeTakenMs('2026-11-05T10:15:30.000Z', '2026-11-05T10:15:00.000Z');
    // Expired Student C has submitted_at = participant.ends_at (5 min quiz) -> 300s
    const expiredStudentTime = timeTakenMs('2026-11-05T10:25:00.000Z', '2026-11-05T10:20:00.000Z');

    assert.equal(studentATime, 90_000);
    assert.equal(studentBTime, 30_000);
    assert.equal(expiredStudentTime, 300_000);
    assert.ok(studentBTime < studentATime);
  });

  it('scores answers accurately with no negative marking and ignores duplicate question entries', () => {
    const res = scoreAnswers(SAMPLE_SNAPSHOT, [
      { question_id: SAMPLE_SNAPSHOT.questions[0].id, option_id: 'aaaa2222-1111-4111-8111-111111111111' }, // +2
      { question_id: SAMPLE_SNAPSHOT.questions[1].id, option_id: 'bbbb2222-2222-4222-8222-222222222222' }, // wrong -> 0
      // Q3 unanswered -> 0
    ]);
    assert.deepEqual(res, { score: 2, correct: 1 });
  });

  it('ranks 5 sample students matching manual check (score desc, time asc, submitted_at asc, duplicate name suffix)', () => {
    const ranked = rankParticipants([
      {
        id: 'p1',
        display_name: 'Rahul',
        email: 'rahul1@example.com',
        team: 'Team Beta',
        roll_number: null,
        score: 4,
        correct_count: 3,
        time_taken_ms: 52_000,
        started_at: '2026-11-05T10:00:00Z',
        submitted_at: '2026-11-05T10:00:52Z',
        auto_submitted: false,
        joined_at: '2026-11-05T09:58:00Z',
      },
      {
        id: 'p2',
        display_name: 'Aarav',
        email: 'aarav@example.com',
        team: 'Team Alpha',
        roll_number: null,
        score: 4,
        correct_count: 3,
        time_taken_ms: 41_000,
        started_at: '2026-11-05T10:05:00Z',
        submitted_at: '2026-11-05T10:05:41Z',
        auto_submitted: false,
        joined_at: '2026-11-05T10:04:55Z',
      },
      {
        id: 'p3',
        display_name: 'rahul',
        email: 'rahul2@example.com',
        team: 'Team Alpha',
        roll_number: null,
        score: 3,
        correct_count: 2,
        time_taken_ms: 35_000,
        started_at: '2026-11-05T10:00:00Z',
        submitted_at: '2026-11-05T10:00:35Z',
        auto_submitted: false,
        joined_at: '2026-11-05T09:58:10Z',
      },
      {
        id: 'p4',
        display_name: 'Diya',
        email: 'diya@example.com',
        team: 'Team Gamma',
        roll_number: null,
        score: 3,
        correct_count: 2,
        time_taken_ms: 35_000,
        started_at: '2026-11-05T09:59:59Z',
        submitted_at: '2026-11-05T10:00:34Z', // submitted 1s earlier on equal score + equal timeTakenMs
        auto_submitted: false,
        joined_at: '2026-11-05T09:59:59Z',
      },
      {
        id: 'p5',
        display_name: 'Meera',
        email: 'meera@example.com',
        team: 'Team Gamma',
        roll_number: null,
        score: 1,
        correct_count: 1,
        time_taken_ms: 300_000,
        started_at: '2026-11-05T10:00:00Z',
        submitted_at: '2026-11-05T10:05:00Z',
        auto_submitted: true,
        joined_at: '2026-11-05T09:58:20Z',
      },
    ]);

    assert.deepEqual(
      ranked.map((r) => ({ rank: r.rank, id: r.participantId, name: r.name, score: r.score })),
      [
        { rank: 1, id: 'p2', name: 'Aarav', score: 4 },
        { rank: 2, id: 'p1', name: 'Rahul', score: 4 },
        { rank: 3, id: 'p4', name: 'Diya', score: 3 },
        { rank: 4, id: 'p3', name: 'rahul (2)', score: 3 },
        { rank: 5, id: 'p5', name: 'Meera', score: 1 },
      ],
    );

    const summary = summarize(ranked, 3);
    assert.equal(summary.total, 5);
    assert.equal(summary.highestScore, 4);
    assert.equal(summary.averageScore, 3);
    assert.deepEqual(summary.fastestPerfect, { name: 'Aarav', timeTakenMs: 41_000 });
    assert.deepEqual(summarize([], 3), { total: 0, averageScore: 0, highestScore: 0, fastestPerfect: null });

    // Team rankings:
    // - Team Beta: Rahul (4) -> avg 4.0, total 4
    // - Team Alpha: Aarav (4) + rahul (2) (3) -> avg 3.5, total 7
    // - Team Gamma: Diya (3) + Meera (1) -> avg 2.0, total 4
    const teams = rankTeams(ranked);
    assert.deepEqual(teams, [
      {
        rank: 1,
        team: 'Team Beta',
        membersSubmitted: 1,
        totalScore: 4,
        averageScore: 4,
        bestIndividual: { name: 'Rahul', score: 4 },
      },
      {
        rank: 2,
        team: 'Team Alpha',
        membersSubmitted: 2,
        totalScore: 7,
        averageScore: 3.5,
        bestIndividual: { name: 'Aarav', score: 4 },
      },
      {
        rank: 3,
        team: 'Team Gamma',
        membersSubmitted: 2,
        totalScore: 4,
        averageScore: 2,
        bestIndividual: { name: 'Diya', score: 3 },
      },
    ]);
  });

  it('breaks team average ties by higher total score', () => {
    const base = {
      email: 'x@example.com',
      rollNumber: null,
      correctCount: 3,
      timeTakenMs: 30_000,
      startedAt: '2026-11-05T10:00:00Z',
      submittedAt: '2026-11-05T10:00:30Z',
      autoSubmitted: false,
    };
    const teams = rankTeams([
      { ...base, rank: 1, participantId: '1', name: 'Solo', team: 'Solo Squad', score: 3 },
      { ...base, rank: 2, participantId: '2', name: 'Duo A', team: 'Big Squad', score: 4 },
      { ...base, rank: 3, participantId: '3', name: 'Duo B', team: 'Big Squad', score: 2 },
      { ...base, rank: 4, participantId: '4', name: 'NoTeam', team: null, score: 10 },
    ]);
    // Both teams have averageScore = 3, but Big Squad has totalScore = 6 vs Solo Squad totalScore = 3
    assert.equal(teams.length, 2);
    assert.equal(teams[0].team, 'Big Squad');
    assert.equal(teams[1].team, 'Solo Squad');
  });
});

describe('Quiz validation, CSV import/export, Excel (.xlsx) workbook, profanity, join codes, reveal & themes', () => {
  it('validates quizzes (including team dropdown list requirement) before publishing link', () => {
    assert.equal(validateQuiz([]).length, 1);
    const bad = validateQuiz([
      {
        id: 'q1',
        text: '   ',
        image_url: null,
        points: 1,
        options: [
          { id: 'o1', text: 'Only one', is_correct: false },
          { id: 'o2', text: '', is_correct: false },
        ],
      },
    ]);
    assert.ok(bad.length >= 3);

    const validQuestions = [
      {
        id: 'q1',
        text: 'Valid question?',
        image_url: null,
        points: 1,
        options: [
          { id: 'o1', text: 'Yes', is_correct: true },
          { id: 'o2', text: 'No', is_correct: false },
        ],
      },
    ];
    assert.deepEqual(validateQuiz(validQuestions), []);
    assert.equal(validateQuiz(validQuestions, { teamMode: 'list', teams: [] }).length, 1);
    assert.deepEqual(validateQuiz(validQuestions, { teamMode: 'list', teams: ['Team Alpha'] }), []);
    assert.deepEqual(validateQuiz(validQuestions, { teamMode: 'free', teams: [] }), []);
  });

  it('parses CSV question imports and guards CSV exports against formula injection', () => {
    const csv =
      'question,option_a,option_b,option_c,option_d,option_e,option_f,correct,points\n' +
      '"What is 1,000 + 24?",1000,1024,,,,,B,2\n' +
      'Sparse columns,First,,Third,,,,C,1\n' +
      'Broken row,OnlyOne,,,,,,Z,1\n';
    const parsed = parseQuestionCsv(csv);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].errors.length, 0);
    assert.equal(parsed[0].question?.correctIndex, 1);
    assert.equal(parsed[1].errors.length, 0);
    assert.equal(parsed[1].question?.options.length, 2);
    assert.equal(parsed[1].question?.correctIndex, 1); // C mapped to index 1 after empty B dropped
    assert.ok(parsed[2].errors.length >= 2);

    const out = toCsv([['=SUM(1,2)', 'Rahul, Jr.']]);
    assert.ok(out.includes("'=SUM(1,2)"), 'Leading = must be neutralized');
  });

  it('builds CSV and 4-sheet Excel (.xlsx) exports with Email/Team/Started at, omitted empty Roll number, and Teams sheet', async () => {
    const fakeSession = {
      id: 'ses-1',
      quiz_id: 'quiz-1',
      join_code: 'ABC234',
      status: 'revealed',
      duration_seconds: 300,
      started_at: '2026-11-05T10:00:00.000Z',
      ends_at: null,
      ended_at: '2026-11-05T10:05:00.000Z',
      closes_at: null,
      quiz_snapshot: SAMPLE_SNAPSHOT,
      revealed_at: '2026-11-05T10:05:10.000Z',
      reveal_mode: 'auto',
      reveal_step: 0,
      created_at: '2026-11-05T09:55:00.000Z',
      quizzes: {
        id: 'quiz-1',
        owner_id: 'u-1',
        title: 'AIT Tech Quiz',
        description: null,
        duration_seconds: 300,
        shuffle_questions: false,
        shuffle_options: false,
        allow_late_join: true,
        show_live_leaderboard: false,
        show_answers_after_reveal: true,
        roll_number_mode: 'off',
        roll_number_label: 'USN',
        team_mode: 'list',
        teams: ['Team Alpha'],
        email_required: true,
        score_visibility: 'after_publish',
        theme: {},
        created_at: '2026-11-05T09:00:00.000Z',
        updated_at: '2026-11-05T09:00:00.000Z',
      },
    } as SessionWithQuiz;

    const results: Results = {
      snapshot: SAMPLE_SNAPSHOT,
      rows: [
        {
          rank: 1,
          participantId: 'p1',
          name: 'Aarav',
          email: 'aarav@example.com',
          team: 'Team Alpha',
          rollNumber: null,
          score: 2,
          correctCount: 1,
          timeTakenMs: 25_400,
          startedAt: '2026-11-05T10:00:00.000Z',
          submittedAt: '2026-11-05T10:00:25.400Z',
          autoSubmitted: false,
        },
      ],
      teamRows: [
        {
          rank: 1,
          team: 'Team Alpha',
          membersSubmitted: 1,
          totalScore: 2,
          averageScore: 2,
          bestIndividual: { name: 'Aarav', score: 2 },
        },
      ],
      participants: [],
      answers: new Map([
        [
          'p1',
          new Map([
            [SAMPLE_SNAPSHOT.questions[0].id, 'aaaa2222-1111-4111-8111-111111111111'], // correct -> green
            [SAMPLE_SNAPSHOT.questions[1].id, 'bbbb2222-2222-4222-8222-222222222222'], // wrong -> red
          ]),
        ],
      ]),
      questionStats: SAMPLE_SNAPSHOT.questions.map((q) => ({
        questionId: q.id,
        position: q.position,
        text: q.text,
        correctText: q.options.find((o) => o.is_correct)!.text,
        answered: 1,
        correct: q.position === 1 ? 1 : 0,
        percentCorrect: q.position === 1 ? 100 : 0,
        options: q.options.map((o) => ({ id: o.id, text: o.text, count: 0, isCorrect: o.is_correct })),
      })),
      summary: { total: 1, averageScore: 2, highestScore: 2, fastestPerfect: null },
      totalQuestions: 3,
    };

    const csv = buildCsv(fakeSession, results);
    assert.equal(csv.filename, 'AIT-Tech-Quiz_2026-11-05_leaderboard.csv');
    assert.equal(csv.body.includes('Roll number'), false, 'Roll number must be omitted when empty for every row');
    assert.ok(csv.body.includes('Rank,Name,Email,Team,Score,Correct count,Total questions,Time taken (seconds),Started at,Submitted at,Auto submitted'));
    assert.ok(csv.body.includes('1,Aarav,aarav@example.com,Team Alpha,2,1,3,25.4,2026-11-05T10:00:00.000Z'));

    // Also verify Roll number IS included when non-empty on legacy rows
    const csvWithRoll = buildCsv(fakeSession, {
      ...results,
      rows: [{ ...results.rows[0], rollNumber: '1AY23CS001' }],
    });
    assert.ok(csvWithRoll.body.includes('Rank,Name,Email,Team,Roll number,Score'));

    const xlsx = await buildXlsx(fakeSession, results);
    assert.equal(xlsx.filename, 'AIT-Tech-Quiz_2026-11-05_results.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.buffer);
    assert.deepEqual(
      wb.worksheets.map((w) => w.name),
      ['Leaderboard', 'Responses', 'Question stats', 'Teams'],
    );
    // Responses has 4 meta columns (Rank, Name, Email, Team) when Roll number is empty -> Q1 is cell 5, Q2 is cell 6
    const respRow = wb.getWorksheet('Responses')!.getRow(2);
    assert.equal((respRow.getCell(5).fill as ExcelJS.FillPattern).fgColor?.argb, 'FFBBF7D0'); // green
    assert.equal((respRow.getCell(6).fill as ExcelJS.FillPattern).fgColor?.argb, 'FFFECACA'); // red
    const teamRow = wb.getWorksheet('Teams')!.getRow(2);
    assert.equal(teamRow.getCell(2).value, 'Team Alpha');
    assert.equal(teamRow.getCell(6).value, 'Aarav (2)');
  });

  it('generates unambiguous 6-char join codes without 0/O/1/I/L', () => {
    for (const forbidden of ['0', 'O', '1', 'I', 'L']) {
      assert.equal(JOIN_CODE_ALPHABET.includes(forbidden), false);
    }
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    }
    assert.equal(normalizeJoinCode(' ab-c234 '), 'ABC234');
  });

  it('filters profanity (EN/HI/KN + leetspeak) without false positives on normal names', () => {
    for (const bad of ['fuck', 'f.u.c.k_you', 'madarchod', 'chut1ya', 'sulemaga', 'mc bc', 'sh1t']) {
      assert.equal(isProfane(bad), true, `Expected "${bad}" to be flagged`);
    }
    for (const ok of ['Anirban', 'Debadrita', 'Rahul', 'Class Representative', 'Blunder Master', 'Peacock', 'Siddharth']) {
      assert.equal(isProfane(ok), false, `Expected "${ok}" to be allowed`);
    }
  });

  it('adapts leaderboard reveal sequence gracefully for 0, 2, 5, and 10+ participants', () => {
    assert.deepEqual(revealPlan(0).seq, []);
    assert.deepEqual(revealPlan(2).seq, [2, 1]);
    assert.deepEqual(revealPlan(5).seq, [5, 4, 3, 2, 1]);
    assert.deepEqual(revealPlan(10).seq, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    assert.equal(autoSchedule(10).length, 10);
    assert.equal(visibleCount('manual', 3, 0, 10), 3);
    assert.equal(visibleCount('full', 0, 0, 10), 10);
  });

  it('verifies all 4 built-in theme presets pass WCAG AA text contrast', () => {
    for (const [id, preset] of Object.entries(PRESETS)) {
      const ratio = contrastRatio(preset.textColor, effectiveBackgroundHex(preset));
      assert.ok(ratio >= 4.5, `Preset ${id} failed WCAG AA contrast: ${ratio}`);
    }
    const fixed = sanitizeTheme({ ...resolveTheme({}), primaryColor: '#12' });
    assert.equal(fixed.primaryColor, PRESETS['neon-dark'].primaryColor);
  });
});
