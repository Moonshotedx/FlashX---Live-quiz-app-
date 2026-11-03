import { performance } from 'node:perf_hooks';
import { createServerClient } from '@supabase/ssr';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const COUNT = Number(process.env.PARTICIPANTS ?? 350);

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
  if (error) throw new Error(`Admin login failed: ${error.message}`);
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= items.length) break;
        await worker(items[idx], idx);
      }
    }),
  );
}

async function main() {
  console.log(`Simulating ${COUNT} concurrent students against ${BASE} ...`);
  const cookie = await createAdminCookie('anirban@xcelerator.in', process.env.SEED_EXTRA_PASSWORD ?? '12345678');

  // Find Demo Tech Quiz via Supabase service role to create a temporary load-test session
  const { createClient } = await import('@supabase/supabase-js');
  const adminDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: quiz } = await adminDb.from('quizzes').select('id').eq('title', 'Demo Tech Quiz').limit(1).single();
  if (!quiz) throw new Error('Demo Tech Quiz not found — run `npm run seed` first');

  const sesRes = await fetch(`${BASE}/api/admin/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ quizId: quiz.id }),
  });
  if (!sesRes.ok) throw new Error(`Failed creating session: ${await sesRes.text()}`);
  const { id: sessionId, joinCode } = (await sesRes.json()) as { id: string; joinCode: string };

  const joinTimes: number[] = [];
  const stateTimes: number[] = [];
  const answerTimes: number[] = [];
  const submitTimes: number[] = [];
  let joinErr = 0,
    stateErr = 0,
    answerErr = 0,
    submitErr = 0;

  try {
    // 1. Join wave (COUNT students)
    const students: { idx: number; token: string }[] = [];
    await runPool(
      Array.from({ length: COUNT }, (_, i) => i),
      60,
      async (i) => {
        const t0 = performance.now();
        const res = await fetch(`${BASE}/api/join/${joinCode}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `10.${Math.floor(i / 250)}.${i % 250}.1`,
          },
          body: JSON.stringify({ name: `Student ${i + 1}`, rollNumber: `USN${String(i + 1).padStart(4, '0')}` }),
        });
        joinTimes.push(performance.now() - t0);
        if (!res.ok) {
          joinErr++;
          return;
        }
        const data = (await res.json()) as { deviceToken: string };
        students.push({ idx: i, token: data.deviceToken });
      },
    );

    // 2. Start quiz
    const startRes = await fetch(`${BASE}/api/admin/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
    });
    if (!startRes.ok) throw new Error(`Failed starting session: ${await startRes.text()}`);

    // 3. Each student loads /state?full=1, answers all 10 questions with jitter, and 90% submit manually
    await runPool(students, 75, async (st) => {
      const tState = performance.now();
      const sRes = await fetch(`${BASE}/api/play/${joinCode}/state?full=1`, {
        headers: { 'x-device-token': st.token },
      });
      stateTimes.push(performance.now() - tState);
      if (!sRes.ok) {
        stateErr++;
        return;
      }
      const state = (await sRes.json()) as { questions: { id: string; options: { id: string }[] }[] };
      for (const q of state.questions) {
        await sleep(5 + Math.random() * 20);
        const pick = q.options[Math.floor(Math.random() * q.options.length)];
        const tAns = performance.now();
        const aRes = await fetch(`${BASE}/api/play/${joinCode}/answer`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-device-token': st.token },
          body: JSON.stringify({ questionId: q.id, optionId: pick.id }),
        });
        answerTimes.push(performance.now() - tAns);
        if (!aRes.ok) answerErr++;
      }

      if (st.idx % 10 !== 0) {
        const tSub = performance.now();
        const subRes = await fetch(`${BASE}/api/play/${joinCode}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-device-token': st.token },
          body: '{}',
        });
        submitTimes.push(performance.now() - tSub);
        if (!subRes.ok) submitErr++;
      }
    });

    // 4. End & reveal (auto-submits remaining 10%!)
    const tEnd = performance.now();
    const endRes = await fetch(`${BASE}/api/admin/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
    });
    if (!endRes.ok) throw new Error(`End failed: ${await endRes.text()}`);
    console.log(`Finalize (${Math.ceil(COUNT * 0.1)} auto-submitted): ${Math.round(performance.now() - tEnd)}ms`);

    console.log('\n--- Load Test Results ---');
    report('POST /join', joinTimes, joinErr);
    report('GET  /state?full=1', stateTimes, stateErr);
    report('PUT  /answer', answerTimes, answerErr);
    report('POST /submit', submitTimes, submitErr);

    const totalErrors = joinErr + stateErr + answerErr + submitErr;
    if (totalErrors > 0) {
      throw new Error(`Load test had ${totalErrors} failed requests`);
    }
    console.log(`\n✅ ${COUNT} concurrent students completed ${answerTimes.length} answer saves with ZERO errors!`);
  } finally {
    await adminDb.from('sessions').delete().eq('id', sessionId);
  }
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});

