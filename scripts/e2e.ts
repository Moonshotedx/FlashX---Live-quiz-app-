import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createServerClient } from '@supabase/ssr';

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

async function createAdminCookieHeader(email: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
  // Secret answer text should not appear before live, and during live must have no correctness flag
  if (label.includes('before-live')) {
    assert.equal(raw.includes(secretAnswerText), false, `[LEAK] ${label} exposed question options before live`);
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
  console.log(`Running E2E acceptance suite against ${BASE} ...`);

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
  const anonDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  for (const tbl of ['quizzes', 'questions', 'options', 'sessions', 'participants', 'answers']) {
    const { data: leaked } = await anonDb.from(tbl).select('*').limit(5);
    assert.equal((leaked ?? []).length, 0, `Anon role must have zero read access on ${tbl}`);
  }
  console.log('✓ Admin routes protected & Supabase RLS blocks anon direct table access');

  // 3. Both requested admins can sign in
  const admin1Email = 'anirban@xcelerator.in';
  const admin2Email = 'debadrita@xcelerator.in';
  const adminPass = process.env.SEED_EXTRA_PASSWORD ?? '12345678';
  const cookie1 = await createAdminCookieHeader(admin1Email, adminPass);
  const cookie2 = await createAdminCookieHeader(admin2Email, adminPass);
  console.log('✓ Both admin accounts (Anirban & Debadrita) authenticated');

  // 4. Create quiz as Admin 1, verify validation catches empty quiz, then populate 3 questions
  const created = await req<{ id: string }>('/api/admin/quizzes', {
    method: 'POST',
    cookie: cookie1,
    body: JSON.stringify({ title: 'E2E Verification Quiz' }),
  });
  assert.equal(created.status, 200);
  const quizId = created.data.id;

  try {
    // Cannot create session with 0 questions
    const invalidSes = await req('/api/admin/sessions', {
      method: 'POST',
      cookie: cookie1,
      body: JSON.stringify({ quizId }),
    });
    assert.equal(invalidSes.status, 422);
    console.log('✓ Quiz validation blocks session creation on incomplete quiz');

    // Configure quiz settings + custom theme via Admin 2 (verifies shared co-admin customization!)
    const patchRes = await req(`/api/admin/quizzes/${quizId}`, {
      method: 'PATCH',
      cookie: cookie2,
      body: JSON.stringify({
        duration_seconds: 120,
        allow_late_join: true,
        show_answers_after_reveal: true,
        roll_number_mode: 'optional',
        theme: { eventTitle: 'Xcelerator Live E2E', preset: 'sunset', primaryColor: '#F97316', accentColor: '#FACC15' },
      }),
    });
    assert.equal(patchRes.status, 200);

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

    // 5. Create session
    const sesRes = await req<{ id: string; joinCode: string }>('/api/admin/sessions', {
      method: 'POST',
      cookie: cookie2,
      body: JSON.stringify({ quizId }),
    });
    assert.equal(sesRes.status, 200);
    const { id: sessionId, joinCode } = sesRes.data;
    assert.match(joinCode, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    console.log(`✓ Session created (${joinCode}) and accessible across co-admins`);

    // 6. Lobby checks + profanity check + 6 students join (5 active + 1 to remove)
    const joinInfo = await req(`/api/join/${joinCode}`);
    assert.equal(joinInfo.status, 200);
    assertNoAnswerLeak(joinInfo.raw, 'join-info-before-live', secretOption);

    const profane = await req(`/api/join/${joinCode}`, {
      method: 'POST',
      ip: '10.0.0.99',
      body: JSON.stringify({ name: 'madarchod123' }),
    });
    assert.equal(profane.status, 400);

    const joinStudent = async (name: string, roll: string, idx: number) => {
      const r = await req<{ participantId: string; deviceToken: string }>(`/api/join/${joinCode}`, {
        method: 'POST',
        ip: `10.0.1.${idx}`,
        body: JSON.stringify({ name, rollNumber: roll }),
      });
      assert.equal(r.status, 200, `Join failed for ${name}: ${r.raw}`);
      return r.data;
    };

    const s1 = await joinStudent('Aarav', 'USN001', 1);   // will get 4/4 (perfect, fast)
    const s2 = await joinStudent('Rahul', 'USN002', 2);   // will get 4/4 (perfect, slower -> tie-breaker #2)
    const s3 = await joinStudent('Rahul', 'USN003', 3);   // duplicate name -> "Rahul (2)", will get 3/4
    const s4 = await joinStudent('Diya', 'USN004', 4);    // will get 2/4, NEVER manually submits -> auto-submit!
    const sBad = await joinStudent('Spammer', 'USN999', 6); // will be removed by admin

    const lobbyState = await req(`/api/play/${joinCode}/state?full=1`, { token: s1.deviceToken });
    assert.equal(lobbyState.status, 200);
    assertNoAnswerLeak(lobbyState.raw, 'state-before-live', secretOption);
    console.log('✓ Students joined, profanity filtered, zero question/answer leak in lobby');

    // 7. Start quiz & verify zero answer leak in live state and HTML
    const startRes = await req<{ startedAt: number; endsAt: number }>(`/api/admin/sessions/${sessionId}/start`, {
      method: 'POST',
      cookie: cookie1,
      body: '{}',
    });
    assert.equal(startRes.status, 200);

    // Edit quiz after start to verify snapshot isolation!
    await req(`/api/admin/quizzes/${quizId}/questions`, {
      method: 'PUT',
      cookie: cookie1,
      body: JSON.stringify({
        questions: [{ ...q1, points: 99 }],
      }),
    });

    const liveState = await req<{ questions: { id: string; options: { id: string; text: string }[] }[]; endsAt: number }>(
      `/api/play/${joinCode}/state?full=1`,
      { token: s1.deviceToken },
    );
    assert.equal(liveState.status, 200);
    assert.equal(liveState.data.questions.length, 3, 'Snapshot should still have 3 questions despite post-start edit');
    assertNoAnswerLeak(liveState.raw, 'state-live', secretOption);

    const joinHtml = await req(`/j/${joinCode}`);
    assertNoAnswerLeak(joinHtml.raw, 'join-page-html', secretOption);
    console.log('✓ Zero answer leak verified in live API payload and HTML source; snapshot isolated from edits');

    // Late joiner joins after start
    const s5 = await joinStudent('Karthik', 'USN005', 5); // late joiner, gets 1/4

    // Extend time (+60s)
    const extRes = await req<{ endsAt: number }>(`/api/admin/sessions/${sessionId}/extend`, {
      method: 'POST',
      cookie: cookie2,
      body: JSON.stringify({ seconds: 60 }),
    });
    assert.equal(extRes.status, 200);
    assert.ok(extRes.data.endsAt > liveState.data.endsAt, 'endsAt should increase after extend');

    // Remove offensive participant
    const remRes = await req(`/api/admin/sessions/${sessionId}/participants/${sBad.participantId}`, {
      method: 'DELETE',
      cookie: cookie1,
    });
    assert.equal(remRes.status, 200);
    const badState = await req<{ me: { removed: boolean } }>(`/api/play/${joinCode}/state`, { token: sBad.deviceToken });
    assert.equal(badState.data.me.removed, true);

    // 8. Save answers & submit
    const answer = async (token: string, questionId: string, optionId: string) => {
      const r = await req(`/api/play/${joinCode}/answer`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ questionId, optionId }),
      });
      assert.equal(r.status, 200, `Answer save failed: ${r.raw}`);
    };

    // s1: all 3 correct (2 + 1 + 1 = 4 pts), submits first
    await answer(s1.deviceToken, q1.id, q1.options[0].id);
    await answer(s1.deviceToken, q2.id, q2.options[1].id);
    await answer(s1.deviceToken, q3.id, q3.options[1].id);

    // Verify refresh mid-quiz restores saved answers
    const refreshed = await req<{ answers: Record<string, string> }>(`/api/play/${joinCode}/state?full=1`, {
      token: s1.deviceToken,
    });
    assert.equal(Object.keys(refreshed.data.answers).length, 3);
    console.log('✓ Mid-quiz refresh restores saved answers');

    assert.equal((await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s1.deviceToken, body: '{}' })).status, 200);
    // Double submit is a safe no-op; answer change after submit is rejected (409)
    assert.equal((await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s1.deviceToken, body: '{}' })).status, 200);
    assert.equal(
      (await req(`/api/play/${joinCode}/answer`, { method: 'PUT', token: s1.deviceToken, body: JSON.stringify({ questionId: q1.id, optionId: q1.options[1].id }) })).status,
      409,
    );

    await new Promise((r) => setTimeout(r, 80)); // ensure s2 has a strictly larger timeTakenMs than s1

    // s2 (Rahul): all 3 correct (4 pts), slower than s1
    await answer(s2.deviceToken, q1.id, q1.options[0].id);
    await answer(s2.deviceToken, q2.id, q2.options[1].id);
    await answer(s2.deviceToken, q3.id, q3.options[1].id);
    await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s2.deviceToken, body: '{}' });

    // s3 (Rahul #2): Q1 + Q2 correct, Q3 wrong (3 pts)
    await answer(s3.deviceToken, q1.id, q1.options[0].id);
    await answer(s3.deviceToken, q2.id, q2.options[1].id);
    await answer(s3.deviceToken, q3.id, q3.options[0].id);
    await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s3.deviceToken, body: '{}' });

    // s4 (Diya): Q1 correct (2 pts), does NOT submit manually -> tests auto-submit!
    await answer(s4.deviceToken, q1.id, q1.options[0].id);

    // s5 (Karthik, late join): Q2 correct (1 pt)
    await answer(s5.deviceToken, q2.id, q2.options[1].id);
    await req(`/api/play/${joinCode}/submit`, { method: 'POST', token: s5.deviceToken, body: '{}' });

    // Result endpoint blocked while live
    assert.equal((await req(`/api/play/${joinCode}/result`, { token: s1.deviceToken })).status, 403);

    // 9. End session -> auto-submits Diya (s4)
    const endRes = await req(`/api/admin/sessions/${sessionId}/end`, { method: 'POST', cookie: cookie1, body: '{}' });
    assert.equal(endRes.status, 200);

    // Result endpoint STILL blocked while ended (before reveal!)
    assert.equal((await req(`/api/play/${joinCode}/result`, { token: s1.deviceToken })).status, 403);

    // 10. Verify manual score & rank calculation on the 5 active students
    const adminResults = await req<{
      rows: { rank: number; name: string; score: number; autoSubmitted: boolean }[];
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
    console.log('✓ 5-student manual score, tie-breaker, duplicate name suffix, removal, and auto-submit verified');

    // 11. Reveal leaderboard & check student result + review
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
    console.log('✓ Student rank & answer review verified after reveal');

    // 12. Verify CSV & Excel (.xlsx) exports
    const csvRes = await fetch(`${BASE}/api/admin/sessions/${sessionId}/export.csv`, {
      headers: { Cookie: cookie1 },
    });
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get('content-disposition') ?? '', /_leaderboard\.csv/);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('Rahul (2)') && csvText.includes('Aarav'), 'CSV missing expected ranked rows');

    const xlsxRes = await fetch(`${BASE}/api/admin/sessions/${sessionId}/export.xlsx`, {
      headers: { Cookie: cookie1 },
    });
    assert.equal(xlsxRes.status, 200);
    assert.match(xlsxRes.headers.get('content-disposition') ?? '', /_results\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await xlsxRes.arrayBuffer());
    assert.deepEqual(
      wb.worksheets.map((w) => w.name),
      ['Leaderboard', 'Responses', 'Question stats'],
    );
    assert.equal(wb.getWorksheet('Leaderboard')!.rowCount, 6); // 1 header + 5 active students
    console.log('✓ CSV and 3-sheet Excel (.xlsx) exports verified');

    // 13. Reset session
    const resetRes = await req(`/api/admin/sessions/${sessionId}/reset`, {
      method: 'POST',
      cookie: cookie1,
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.equal(resetRes.status, 200);
    const afterReset = await req(`/api/play/${joinCode}/state`, { token: s1.deviceToken });
    assert.equal(afterReset.status, 404, 'Old participant token must 404 after session reset');
    console.log('✓ Session reset verified');
  } finally {
    await req(`/api/admin/quizzes/${quizId}`, { method: 'DELETE', cookie: cookie1 });
  }

  console.log('\n🎉 ALL E2E ACCEPTANCE CHECKS PASSED!');
}

main().catch((err) => {
  console.error('\n❌ E2E FAILED:', err);
  process.exit(1);
});
