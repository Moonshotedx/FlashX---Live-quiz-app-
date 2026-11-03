import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createServerClient } from '@supabase/ssr';

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

function requireEnv(name: string, fallback?: string): string {
  const val = (process.env[name] ?? (fallback ? process.env[fallback] : undefined))?.trim();
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}${fallback ? ` (or ${fallback})` : ''}`);
  }
  return val;
}

async function createAdminCookieHeader(email: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const sb = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
      },
    },
  );
  const { error } = await sb.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `Admin login failed for ${email}: ${error?.message}`);
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function assertNoAnswerLeak(payload: unknown, label: string, secretAnswerText: string) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  assert.equal(raw.includes('is_correct'), false, `[LEAK] ${label} exposed is_correct`);
  assert.equal(raw.includes('correctOptionId'), false, `[LEAK] ${label} exposed correctOptionId`);
  if (label.includes('before-begin')) {
    assert.equal(raw.includes(secretAnswerText), false, `[LEAK] ${label} exposed question options before student pressed Start`);
  }
}

async function req<T = Record<string, unknown>>(
  path: string,
  opts: RequestInit & { cookie?: string; token?: string; ip?: string } = {},
): Promise<{ status: number; data: T; raw: string }> {
  const { cookie, token, ip, headers, ...rest } = opts;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { 'x-device-token': token } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
      ...headers,
    },
  });
  const raw = await res.text();
  let data: unknown = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { status: res.status, data: data as T, raw };
}

async function main() {
  console.log(`Running self-paced E2E acceptance suite against ${BASE} ...`);

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin1Email = requireEnv('E2E_ADMIN_EMAIL', 'SEED_ADMIN_EMAIL');
  const admin1Pass = requireEnv('E2E_ADMIN_PASSWORD', 'SEED_ADMIN_PASSWORD');

  // 1. Server clock sync
  const timeRes = await req<{ now: number }>('/api/time');
  assert.equal(timeRes.status, 200);
  assert.ok(Math.abs(timeRes.data.now - Date.now()) < 10_000, 'Server clock out of range');
  console.log('✓ /api/time server clock sync');

  // 2. Unauthenticated admin access & direct Supabase anon table access rejected
  const unauth = await req('/api/admin/quizzes', { method: 'POST', body: '{}' });
  assert.equal(unauth.status, 401);
  const unauthPage = await req('/admin');
  assert.ok(unauthPage.status === 307 || unauthPage.status === 302, 'Expected redirect on /admin');

  const { createClient } = await import('@supabase/supabase-js');
  const anonDb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  for (const tbl of ['quizzes', 'questions', 'options', 'sessions', 'participants', 'answers']) {
    const { data: leaked } = await anonDb.from(tbl).select('*').limit(5);
    assert.equal((leaked ?? []).length, 0, `Anon role must have zero read access on ${tbl}`);
  }
  console.log('✓ Admin routes protected & Supabase RLS blocks anon direct table access');

  const serviceDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 3. Authenticate primary admin (and optional co-admin if configured)
  const cookie1 = await createAdminCookieHeader(admin1Email, admin1Pass);
  let cookie2 = cookie1;
  const extraEmail = (process.env.SEED_EXTRA_ADMINS ?? '')
    .split(',')
    .map((e) => e.trim())
    .find((e) => e && e.toLowerCase() !== admin1Email.toLowerCase());
  const extraPass = process.env.SEED_EXTRA_PASSWORD?.trim();
  if (extraEmail && extraPass) {
    cookie2 = await createAdminCookieHeader(extraEmail, extraPass);
    console.log(`✓ Primary admin (${admin1Email}) & co-admin (${extraEmail}) authenticated`);
  } else {
    console.log(`✓ Admin (${admin1Email}) authenticated`);
  }

  // 4. Create quiz, verify validation catches 0 questions and empty team dropdown
  const created = await req<{ id: string }>('/api/admin/quizzes', {
    method: 'POST',
    cookie: cookie1,
    body: JSON.stringify({ title: 'Self-Paced E2E Verification Quiz' }),
  });
  assert.equal(created.status, 200);
  const quizId = created.data.id;

  try {
    // Cannot publish link with 0 questions
    const invalidSes = await req('/api/admin/sessions', {
      method: 'POST',
      cookie: cookie1,
      body: JSON.stringify({ quizId }),
    });
    assert.equal(invalidSes.status, 422);

    const secretOption = 'HyperText Transfer Protocol E2E';
    const q1 = {
      id: randomUUID(),
      text: 'Q1: What does HTTP stand for?',
      image_url: null,
      points: 2,
      options: [
        { id: randomUUID(), text: secretOption, is_correct: true },
        { id: randomUUID(), text: 'High Transfer Text Process', is_correct: false },
      ],
    };
    const q2 = {
      id: randomUUID(),
      text: 'Q2: 2 + 2 = ?',
      image_url: null,
      points: 1,
      options: [
        { id: randomUUID(), text: '3', is_correct: false },
        { id: randomUUID(), text: '4', is_correct: true },
      ],
    };
    const q3 = {
      id: randomUUID(),
      text: 'Q3: Which planet is known as the Red Planet?',
      image_url: null,
      points: 1,
      options: [
        { id: randomUUID(), text: 'Venus', is_correct: false },
        { id: randomUUID(), text: 'Mars', is_correct: true },
      ],
    };

    const putQs = await req(`/api/admin/quizzes/${quizId}/questions`, {
      method: 'PUT',
      cookie: cookie1,
      body: JSON.stringify({ questions: [q1, q2, q3] }),
    });
    assert.equal(putQs.status, 200);

    // Default team_mode = 'list' with empty teams must also block Publish link
    const emptyTeamsSes = await req('/api/admin/sessions', {
      method: 'POST',
      cookie: cookie1,
      body: JSON.stringify({ quizId }),
    });
    assert.equal(emptyTeamsSes.status, 422);
    console.log('✓ Quiz validation blocks Publish link on 0 questions and empty team dropdown');

    // Configure self-paced quiz settings
    const patchRes = await req(`/api/admin/quizzes/${quizId}`, {
      method: 'PATCH',
      cookie: cookie2,
      body: JSON.stringify({
        duration_seconds: 120,
        team_mode: 'list',
        teams: ['Team Alpha', 'Team Beta'],
        email_required: true,
        score_visibility: 'after_publish',
        show_answers_after_reveal: true,
        theme: { eventTitle: 'Xcelerator Self-Paced E2E', preset: 'sunset', primaryColor: '#F97316', accentColor: '#FACC15' },
      }),
    });
    assert.equal(patchRes.status, 200);

    // 5. Publish link -> immediately opens with status = 'live'
    const sesRes = await req<{ id: string; joinCode: string }>('/api/admin/sessions', {
      method: 'POST',
      cookie: cookie2,
      body: JSON.stringify({ quizId }),
    });
    assert.equal(sesRes.status, 200);
    const { id: sessionId, joinCode } = sesRes.data;
    assert.match(joinCode, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

    // Legacy host-started endpoints return 410 Gone
    assert.equal((await req(`/api/admin/sessions/${sessionId}/start`, { method: 'POST', cookie: cookie1, body: '{}' })).status, 410);
    assert.equal((await req(`/api/admin/sessions/${sessionId}/extend`, { method: 'POST', cookie: cookie1, body: '{}' })).status, 410);
    assert.equal((await req(`/api/admin/sessions/${sessionId}/end`, { method: 'POST', cookie: cookie1, body: '{}' })).status, 410);
    console.log(`✓ Link published (${joinCode}) directly into Open state; legacy host endpoints return 410`);

    // Edit quiz after publishing to verify snapshot isolation
    await req(`/api/admin/quizzes/${quizId}/questions`, {
      method: 'PUT',
      cookie: cookie1,
      body: JSON.stringify({ questions: [{ ...q1, points: 99 }] }),
    });

    // 6. Join metadata, HTML check, validation checks
    const joinInfo = await req<{ open: boolean; teamMode: string; teams: string[]; questionCount: number }>(`/api/join/${joinCode}`);
    assert.equal(joinInfo.status, 200);
    assert.equal(joinInfo.data.open, true);
    assert.equal(joinInfo.data.questionCount, 3);
    assert.deepEqual(joinInfo.data.teams, ['Team Alpha', 'Team Beta']);
    assertNoAnswerLeak(joinInfo.raw, 'join-info-before-begin', secretOption);

    const joinHtml = await req(`/j/${joinCode}`);
    assertNoAnswerLeak(joinHtml.raw, 'join-html-before-begin', secretOption);

    // Profanity, missing email, and unlisted team rejected
    assert.equal(
      (await req(`/api/join/${joinCode}`, { method: 'POST', ip: '10.0.0.91', body: JSON.stringify({ name: 'madarchod123', email: 'bad@example.com', team: 'Team Alpha' }) })).status,
      400,
    );
    assert.equal(
      (await req(`/api/join/${joinCode}`, { method: 'POST', ip: '10.0.0.92', body: JSON.stringify({ name: 'Aarav', email: '', team: 'Team Alpha' }) })).status,
      400,
    );
    assert.equal(
      (await req(`/api/join/${joinCode}`, { method: 'POST', ip: '10.0.0.93', body: JSON.stringify({ name: 'Aarav', email: 'aarav@example.com', team: 'Unknown Team' }) })).status,
      400,
    );

    const joinStudent = async (name: string, email: string, team: string, idx: number) => {
      const r = await req<{ participantId: string; deviceToken: string; resumed: boolean }>(`/api/join/${joinCode}`, {
        method: 'POST',
        ip: `10.0.1.${idx}`,
        body: JSON.stringify({ name, email, team }),
      });
      assert.equal(r.status, 200, `Join failed for ${name}: ${r.raw}`);
      assertNoAnswerLeak(r.raw, 'join-post-before-begin', secretOption);
      return r.data;
    };

    const s1 = await joinStudent('Aarav', 'aarav@example.com', 'Team Alpha', 1);
    const s2 = await joinStudent('Rahul', 'rahul@example.com', 'Team Beta', 2);
    const s3 = await joinStudent('Rahul', 'rahul2@example.com', 'Team Alpha', 3); // duplicate display name -> "Rahul (2)"
    const s4 = await joinStudent('Diya', 'diya@example.com', 'Team Alpha', 4);    // personal timer expires -> auto-submit
    const s5 = await joinStudent('Karthik', 'karthik@example.com', 'Team Beta', 5);
    const sIdle = await joinStudent('Idle Student', 'idle@example.com', 'Team Beta', 6); // never presses Start
    const sBad = await joinStudent('Spammer', 'spam@example.com', 'Team Beta', 7);

    // Before pressing Start (/begin): phase is 'ready', zero questions exposed, answer rejected
    const readyState = await req<{ phase: string; questions?: unknown }>(`/api/play/${joinCode}/state?full=1`, {
      token: s1.deviceToken,
    });
    assert.equal(readyState.status, 200);
    assert.equal(readyState.data.phase, 'ready');
    assert.equal(readyState.data.questions, undefined, 'Questions must not be sent before student presses Start');
    assertNoAnswerLeak(readyState.raw, 'state-ready-before-begin', secretOption);

    assert.equal(
      (await req(`/api/play/${joinCode}/answer`, { method: 'PUT', token: s1.deviceToken, body: JSON.stringify({ questionId: q1.id, optionId: q1.options[0].id }) })).status,
      409,
    );

    // 7. Two students start at different times -> independent timers + atomic double-tap idempotency
    const s1Begin = await req<{ startedAt: number; endsAt: number }>(`/api/play/${joinCode}/begin`, {
      method: 'POST',
      token: s1.deviceToken,
      body: '{}',
    });
    assert.equal(s1Begin.status, 200);
    assertNoAnswerLeak(s1Begin.raw, 'begin-response', secretOption);

    // Double tap on Start must not reset timer
    const s1BeginAgain = await req<{ startedAt: number; endsAt: number }>(`/api/play/${joinCode}/begin`, {
      method: 'POST',
      token: s1.deviceToken,
      body: '{}',
    });
    assert.equal(s1BeginAgain.data.startedAt, s1Begin.data.startedAt);
    assert.equal(s1BeginAgain.data.endsAt, s1Begin.data.endsAt);

    await new Promise((r) => setTimeout(r, 120));

    const s2Begin = await req<{ startedAt: number; endsAt: number }>(`/api/play/${joinCode}/begin`, {
      method: 'POST',
      token: s2.deviceToken,
      body: '{}',
    });
    assert.equal(s2Begin.status, 200);
    assert.ok(s2Begin.data.startedAt > s1Begin.data.startedAt, 'Second student must get a later startedAt');
    assert.ok(s2Begin.data.endsAt > s1Begin.data.endsAt, 'Second student must get an independent later endsAt');
    console.log('✓ Independent personal timers & atomic /begin idempotency verified');

    // Verify answering state has sanitized 3-question snapshot & zero correctness leak
    const answeringState = await req<{
      phase: string;
      endsAt: number;
      questions: { id: string; options: { id: string; text: string }[] }[];
    }>(`/api/play/${joinCode}/state?full=1`, { token: s1.deviceToken });
    assert.equal(answeringState.status, 200);
    assert.equal(answeringState.data.phase, 'answering');
    assert.equal(answeringState.data.questions.length, 3, 'Snapshot isolated from post-publish quiz edits');
    assertNoAnswerLeak(answeringState.raw, 'state-answering', secretOption);

    const answer = async (token: string, questionId: string, optionId: string) => {
      const r = await req(`/api/play/${joinCode}/answer`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ questionId, optionId }),
      });
      assert.equal(r.status, 200, `Answer save failed: ${r.raw}`);
      assertNoAnswerLeak(r.raw, 'answer-save', secretOption);
    };

    // 8. Same email mid-attempt on a second device resumes with saved answers and original timer
    await answer(s1.deviceToken, q1.id, q1.options[0].id);
    await new Promise((r) => setTimeout(r, 60));

    const resumedJoin = await req<{ participantId: string; deviceToken: string; resumed: boolean }>(`/api/join/${joinCode}`, {
      method: 'POST',
      ip: '10.0.2.1',
      body: JSON.stringify({ name: 'Aarav Second Phone', email: 'AARAV@example.com', team: 'Team Beta' }),
    });
    assert.equal(resumedJoin.status, 200);
    assert.equal(resumedJoin.data.resumed, true);
    assert.equal(resumedJoin.data.deviceToken, s1.deviceToken, 'Mid-attempt email rejoin must return same deviceToken');

    const resumedState = await req<{ endsAt: number; answers: Record<string, string> }>(`/api/play/${joinCode}/state?full=1`, {
      token: resumedJoin.data.deviceToken,
    });
    assert.equal(resumedState.data.endsAt, s1Begin.data.endsAt, 'Mid-attempt email rejoin must preserve original endsAt');
    assert.equal(resumedState.data.answers[q1.id], q1.options[0].id);

    // Finish s1 (4 pts, fast) and submit
    await answer(s1.deviceToken, q2.id, q2.options[1].id);
    await answer(s1.deviceToken, q3.id, q3.options[1].id);
    const s1Sub = await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s1.deviceToken, body: '{}' });
    assert.equal(s1Sub.status, 200);
    assertNoAnswerLeak(s1Sub.raw, 'submit-response', secretOption);

    // Same email after submitting is blocked (409 already_submitted)
    const repeatJoin = await req<{ error: string; code: string }>(`/api/join/${joinCode}`, {
      method: 'POST',
      ip: '10.0.2.2',
      body: JSON.stringify({ name: 'Aarav Retry', email: 'aarav@example.com', team: 'Team Alpha' }),
    });
    assert.equal(repeatJoin.status, 409);
    assert.equal(repeatJoin.data.code, 'already_submitted');
    assert.equal(repeatJoin.data.error, 'This email has already completed the quiz.');
    console.log('✓ One-attempt-per-email: mid-attempt resume & post-submit block verified');

    // Finish s2 (4 pts, slower elapsed time than s1)
    await new Promise((r) => setTimeout(r, 120));
    await answer(s2.deviceToken, q1.id, q1.options[0].id);
    await answer(s2.deviceToken, q2.id, q2.options[1].id);
    await answer(s2.deviceToken, q3.id, q3.options[1].id);
    assert.equal((await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s2.deviceToken, body: '{}' })).status, 200);

    // 9. Expired personal attempt auto-submits with submitted_at = participant.ends_at
    await req(`/api/play/${joinCode}/begin`, { method: 'POST', token: s4.deviceToken, body: '{}' });
    await answer(s4.deviceToken, q1.id, q1.options[0].id); // 2 pts
    const pastStart = new Date(Date.now() - 130_000).toISOString();
    const pastEnd = new Date(Date.now() - 10_000).toISOString();
    await serviceDb
      .from('participants')
      .update({ started_at: pastStart, ends_at: pastEnd })
      .eq('id', s4.participantId);

    const s4ExpiredState = await req<{ phase: string; me: { autoSubmitted: boolean } }>(`/api/play/${joinCode}/state`, {
      token: s4.deviceToken,
    });
    assert.equal(s4ExpiredState.status, 200);
    assert.equal(s4ExpiredState.data.phase, 'submitted');
    assert.equal(s4ExpiredState.data.me.autoSubmitted, true);

    const { data: s4Row } = await serviceDb
      .from('participants')
      .select('submitted_at, ends_at, auto_submitted, score, time_taken_ms')
      .eq('id', s4.participantId)
      .single();
    assert.ok(s4Row);
    assert.equal(new Date(s4Row.submitted_at!).getTime(), new Date(s4Row.ends_at!).getTime(), 'submitted_at must equal participant.ends_at');
    assert.equal(s4Row.auto_submitted, true);
    assert.equal(s4Row.score, 2);
    assert.equal(s4Row.time_taken_ms, 120_000);
    console.log('✓ Expired personal timer auto-submitted with submitted_at = participant.ends_at');

    // 10. Closing the link blocks new students, but NOT already-started attempts
    await req(`/api/play/${joinCode}/begin`, { method: 'POST', token: s3.deviceToken, body: '{}' });

    const closeRes = await req(`/api/admin/sessions/${sessionId}/close`, {
      method: 'POST',
      cookie: cookie1,
      body: '{}',
    });
    assert.equal(closeRes.status, 200);

    // New student blocked while closed
    const blockedJoin = await req<{ error: string }>(`/api/join/${joinCode}`, {
      method: 'POST',
      ip: '10.0.3.1',
      body: JSON.stringify({ name: 'Late Arrival', email: 'late@example.com', team: 'Team Alpha' }),
    });
    assert.equal(blockedJoin.status, 403);
    assert.equal(blockedJoin.data.error, 'This quiz is closed.');

    // Meanwhile s3 (mid-attempt!) can still answer and submit while the link is closed
    await answer(s3.deviceToken, q1.id, q1.options[0].id);
    await answer(s3.deviceToken, q2.id, q2.options[1].id);
    await answer(s3.deviceToken, q3.id, q3.options[0].id); // 3 pts
    assert.equal((await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s3.deviceToken, body: '{}' })).status, 200);
    console.log('✓ Closing link blocks new students while allowing in-progress attempts to finish');

    // Test Reopen (P1): s5 starts, answers 1 pt, submits; then close again
    assert.equal((await req(`/api/admin/sessions/${sessionId}/reopen`, { method: 'POST', cookie: cookie1, body: '{}' })).status, 200);
    await req(`/api/play/${joinCode}/begin`, { method: 'POST', token: s5.deviceToken, body: '{}' });
    await answer(s5.deviceToken, q2.id, q2.options[1].id); // 1 pt
    assert.equal((await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s5.deviceToken, body: '{}' })).status, 200);
    assert.equal((await req(`/api/admin/sessions/${sessionId}/close`, { method: 'POST', cookie: cookie1, body: '{}' })).status, 200);

    // Remove offensive participant
    assert.equal((await req(`/api/admin/sessions/${sessionId}/participants/${sBad.participantId}`, { method: 'DELETE', cookie: cookie1 })).status, 200);
    const badState = await req<{ phase: string }>(`/api/play/${joinCode}/state`, { token: sBad.deviceToken });
    assert.equal(badState.data.phase, 'removed');

    // Result endpoint blocked before publish when score_visibility = 'after_publish'
    assert.equal((await req(`/api/play/${joinCode}/result`, { token: s1.deviceToken })).status, 403);

    // Idle student who never pressed Start stays out of leaderboard
    const statsRes = await req<{ notStarted: number; inProgress: number; submitted: number }>(`/api/admin/sessions/${sessionId}/stats`, {
      cookie: cookie1,
    });
    assert.equal(statsRes.data.notStarted, 1);
    assert.equal(statsRes.data.inProgress, 0);
    assert.equal(statsRes.data.submitted, 5);
    assert.ok(sIdle.participantId);

    // 11. Verify leaderboard & team rankings before/after publishing results
    const adminResults = await req<{
      rows: { rank: number; name: string; team: string | null; score: number; autoSubmitted: boolean }[];
      teamRows: { rank: number; team: string; membersSubmitted: number; totalScore: number; averageScore: number }[];
    }>(`/api/admin/sessions/${sessionId}/results`, { cookie: cookie2 });
    assert.equal(adminResults.status, 200);
    assert.deepEqual(
      adminResults.data.rows.map((r) => ({ rank: r.rank, name: r.name, score: r.score, auto: r.autoSubmitted })),
      [
        { rank: 1, name: 'Aarav', score: 4, auto: false },
        { rank: 2, name: 'Rahul', score: 4, auto: false },
        { rank: 3, name: 'Rahul (2)', score: 3, auto: false },
        { rank: 4, name: 'Diya', score: 2, auto: true },
        { rank: 5, name: 'Karthik', score: 1, auto: false },
      ],
    );
    // Team Alpha: Aarav (4) + Rahul (2) (3) + Diya (2) = 9 / 3 = 3.0 avg
    // Team Beta: Rahul (4) + Karthik (1) = 5 / 2 = 2.5 avg
    assert.deepEqual(
      adminResults.data.teamRows.map((t) => ({ rank: t.rank, team: t.team, members: t.membersSubmitted, avg: t.averageScore })),
      [
        { rank: 1, team: 'Team Alpha', members: 3, avg: 3 },
        { rank: 2, team: 'Team Beta', members: 2, avg: 2.5 },
      ],
    );
    console.log('✓ Individual & team rankings, duplicate name suffix, removal, and not-started exclusion verified');

    // Publish results (reveal)
    const revRes = await req(`/api/admin/sessions/${sessionId}/reveal`, {
      method: 'POST',
      cookie: cookie1,
      body: JSON.stringify({ action: 'start', mode: 'auto' }),
    });
    assert.equal(revRes.status, 200);

    const s3Result = await req<{ rank: number; total: number; score: number; review: unknown[] }>(
      `/api/play/${joinCode}/result`,
      { token: s3.deviceToken },
    );
    assert.equal(s3Result.status, 200);
    assert.equal(s3Result.data.rank, 3);
    assert.equal(s3Result.data.total, 5);
    assert.equal(s3Result.data.score, 3);
    assert.equal(s3Result.data.review.length, 3);
    console.log('✓ Student rank & answer review verified after publishing results');

    // 12. Verify CSV & 4-sheet Excel (.xlsx) exports
    const csvRes = await fetch(`${BASE}/api/admin/sessions/${sessionId}/export.csv`, {
      headers: { Cookie: cookie1 },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('Email,Team'), 'CSV must include Email and Team columns');
    assert.equal(csvText.includes('Roll number'), false, 'CSV must omit empty Roll number column');
    assert.ok(csvText.includes('aarav@example.com') && csvText.includes('Team Alpha'));

    const xlsxRes = await fetch(`${BASE}/api/admin/sessions/${sessionId}/export.xlsx`, {
      headers: { Cookie: cookie1 },
    });
    assert.equal(xlsxRes.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await xlsxRes.arrayBuffer());
    assert.deepEqual(
      wb.worksheets.map((w) => w.name),
      ['Leaderboard', 'Responses', 'Question stats', 'Teams'],
    );
    assert.equal(wb.getWorksheet('Leaderboard')!.rowCount, 6); // 1 header + 5 submitted students
    assert.equal(wb.getWorksheet('Teams')!.rowCount, 3); // 1 header + 2 teams
    console.log('✓ CSV and 4-sheet Excel (.xlsx) exports verified');

    // 13. Reset session -> status back to 'live'
    const resetRes = await req(`/api/admin/sessions/${sessionId}/reset`, {
      method: 'POST',
      cookie: cookie1,
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.equal(resetRes.status, 200);
    const afterReset = await req(`/api/play/${joinCode}/state`, { token: s1.deviceToken });
    assert.equal(afterReset.status, 404, 'Old participant token must 404 after session reset');
    const reopenCheck = await req<{ open: boolean }>(`/api/join/${joinCode}`);
    assert.equal(reopenCheck.data.open, true, 'Session must be Open again after reset');
    console.log('✓ Session reset verified');
  } finally {
    await req(`/api/admin/quizzes/${quizId}`, { method: 'DELETE', cookie: cookie1 });
  }

  console.log('\n🎉 ALL SELF-PACED E2E ACCEPTANCE CHECKS PASSED!');
}

main().catch((err) => {
  console.error('\n❌ E2E FAILED:', err);
  process.exit(1);
});
