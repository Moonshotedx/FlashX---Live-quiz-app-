import { performance } from 'node:perf_hooks';
import { db, pool, resolveDatabaseUrl, unwrap } from '../lib/server/db';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const COUNT = Number(process.env.PARTICIPANTS ?? 300);
/** Staggered arrival window in ms — defaults to 10 minutes (600,000ms) per spec; override via WINDOW_MS for quick burst tests. */
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 600_000);

function requireEnv(name: string, fallback?: string): string {
  const val = (process.env[name] ?? (fallback ? process.env[fallback] : undefined))?.trim();
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}${fallback ? ` (or ${fallback})` : ''}`);
  }
  return val;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

function report(name: string, samples: number[], errors: number) {
  const s = [...samples].sort((a, b) => a - b);
  console.log(
    `${name.padEnd(18)} count=${String(s.length).padStart(4)}  err=${String(errors).padStart(2)}  P50=${String(percentile(s, 50)).padStart(4)}ms  P95=${String(percentile(s, 95)).padStart(4)}ms  P99=${String(percentile(s, 99)).padStart(4)}ms`,
  );
}

async function createAdminCookie(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Admin login failed: ${await res.text()}`);
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
  return setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  resolveDatabaseUrl();
  const adminEmail = requireEnv('LOADTEST_ADMIN_EMAIL', 'SEED_ADMIN_EMAIL');
  const adminPassword = requireEnv('LOADTEST_ADMIN_PASSWORD', 'SEED_ADMIN_PASSWORD');

  console.log(
    `Simulating ${COUNT} self-paced students arriving randomly over ${Math.round(WINDOW_MS / 1000)}s against ${BASE} ...`,
  );
  const cookie = await createAdminCookie(adminEmail, adminPassword);

  const quiz = unwrap<{ id: string; team_mode: string; teams: string[] } | null>(
    await db().from('quizzes').select('id,team_mode,teams').eq('title', 'Demo Tech Quiz').limit(1).maybeSingle(),
    'find Demo Tech Quiz',
  );
  if (!quiz) throw new Error('Demo Tech Quiz not found — run `npm run seed` first');

  const defaultTeams = ['Team Alpha', 'Team Beta', 'Team Gamma', 'Team Delta'];
  const teams: string[] =
    quiz.team_mode === 'list'
      ? quiz.teams?.length
        ? quiz.teams
        : defaultTeams
      : defaultTeams;

  if (quiz.team_mode === 'list' && (!quiz.teams || quiz.teams.length === 0)) {
    unwrap(await db().from('quizzes').update({ teams: defaultTeams }).eq('id', quiz.id), 'update Demo Tech Quiz teams');
  }

  // Publish self-paced link (status = 'live')
  const sesRes = await fetch(`${BASE}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ quizId: quiz.id }),
  });
  if (!sesRes.ok) throw new Error(`Failed publishing link: ${await sesRes.text()}`);
  const { id: sessionId, joinCode } = (await sesRes.json()) as { id: string; joinCode: string };

  const joinTimes: number[] = [];
  const beginTimes: number[] = [];
  const stateTimes: number[] = [];
  const answerTimes: number[] = [];
  const submitTimes: number[] = [];
  let joinErr = 0,
    beginErr = 0,
    stateErr = 0,
    answerErr = 0,
    submitErr = 0;

  try {
    await Promise.all(
      Array.from({ length: COUNT }, async (_, i) => {
        const arrivalDelay = Math.floor(Math.random() * WINDOW_MS);
        if (arrivalDelay > 0) await sleep(arrivalDelay);

        const ip = `10.${Math.floor(i / 250)}.${i % 250}.1`;
        const team = quiz.team_mode === 'off' ? '' : teams[i % teams.length];

        // 1. Enter details (/join)
        const tJoin = performance.now();
        const jRes = await fetch(`${BASE}/api/join/${joinCode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({
            name: `Student ${i + 1}`,
            email: `student${i + 1}@loadtest.example.com`,
            team,
          }),
        });
        joinTimes.push(performance.now() - tJoin);
        if (!jRes.ok) {
          joinErr++;
          return;
        }
        const { deviceToken } = (await jRes.json()) as { deviceToken: string };

        // 2. Press Start (/begin) -> starts personal countdown
        const tBegin = performance.now();
        const bRes = await fetch(`${BASE}/api/play/${joinCode}/begin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-device-token': deviceToken },
          body: '{}',
        });
        beginTimes.push(performance.now() - tBegin);
        if (!bRes.ok) {
          beginErr++;
          return;
        }

        // 3. Load sanitized questions (/state?full=1)
        const tState = performance.now();
        const sRes = await fetch(`${BASE}/api/play/${joinCode}/state?full=1`, {
          headers: { 'x-device-token': deviceToken },
        });
        stateTimes.push(performance.now() - tState);
        if (!sRes.ok) {
          stateErr++;
          return;
        }
        const state = (await sRes.json()) as { questions: { id: string; options: { id: string }[] }[] };

        // 4. Answer all 10 questions
        for (const q of state.questions) {
          await sleep(10 + Math.random() * 40);
          const pick = q.options[Math.floor(Math.random() * q.options.length)];
          const tAns = performance.now();
          const aRes = await fetch(`${BASE}/api/play/${joinCode}/answer`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-device-token': deviceToken },
            body: JSON.stringify({ questionId: q.id, optionId: pick.id }),
          });
          answerTimes.push(performance.now() - tAns);
          if (!aRes.ok) answerErr++;
        }

        // 5. Submit attempt
        const tSub = performance.now();
        const subRes = await fetch(`${BASE}/api/play/${joinCode}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-device-token': deviceToken },
          body: '{}',
        });
        submitTimes.push(performance.now() - tSub);
        if (!subRes.ok) submitErr++;
      }),
    );

    // Close link & publish results
    const closeRes = await fetch(`${BASE}/api/admin/sessions/${sessionId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
    });
    if (!closeRes.ok) throw new Error(`Close failed: ${await closeRes.text()}`);

    const revRes = await fetch(`${BASE}/api/admin/sessions/${sessionId}/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'start', mode: 'auto' }),
    });
    if (!revRes.ok) throw new Error(`Publish results failed: ${await revRes.text()}`);

    console.log('\n--- Self-Paced Load Test Results ---');
    report('POST /join', joinTimes, joinErr);
    report('POST /begin', beginTimes, beginErr);
    report('GET  /state?full=1', stateTimes, stateErr);
    report('PUT  /answer', answerTimes, answerErr);
    report('POST /submit', submitTimes, submitErr);

    const totalErrors = joinErr + beginErr + stateErr + answerErr + submitErr;
    if (totalErrors > 0) {
      throw new Error(`Load test had ${totalErrors} failed requests`);
    }
    console.log(`\n✅ ${COUNT} self-paced students completed ${answerTimes.length} answer saves & submitted with ZERO errors!`);
  } finally {
    await db().from('sessions').delete().eq('id', sessionId);
    await pool().end();
  }
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
