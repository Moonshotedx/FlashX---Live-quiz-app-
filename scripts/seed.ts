import { PRESETS } from '../lib/theme';
import { hashPassword } from '../lib/server/auth';
import { db, pool, query, resolveDatabaseUrl, unwrap } from '../lib/server/db';
import { applyMigrations } from './migrate';

const DEMO_QUESTIONS: { text: string; options: string[]; correct: number }[] = [
  {
    text: 'What does HTTP status code 404 indicate?',
    options: ['Internal Server Error', 'Resource Not Found', 'Unauthorized Access', 'Bad Gateway'],
    correct: 1,
  },
  {
    text: 'Which data structure operates on a Last-In, First-Out (LIFO) principle?',
    options: ['Queue', 'Stack', 'Breadth-First Graph', 'Min-Heap'],
    correct: 1,
  },
  {
    text: 'In Git, which command creates a new branch and switches to it immediately?',
    options: ['git switch -c <branch>', 'git branch -m <branch>', 'git init <branch>', 'git merge <branch>'],
    correct: 0,
  },
  {
    text: 'What is the worst-case time complexity of binary search on a sorted array of n elements?',
    options: ['O(n)', 'O(n log n)', 'O(log n)', 'O(1)'],
    correct: 2,
  },
  {
    text: 'Which protocol translates human-readable domain names into IP addresses?',
    options: ['DHCP', 'TLS', 'DNS', 'SMTP'],
    correct: 2,
  },
  {
    text: 'In relational databases, what does the "A" in ACID stand for?',
    options: ['Availability', 'Atomicity', 'Authentication', 'Aggregation'],
    correct: 1,
  },
  {
    text: 'Which web API enables full-duplex, persistent communication over a single TCP connection?',
    options: ['WebSockets', 'Server-Sent Events', 'XMLHttpRequest', 'LocalStorage'],
    correct: 0,
  },
  {
    text: 'Which layer of the OSI model is TCP primarily associated with?',
    options: ['Network Layer', 'Transport Layer', 'Application Layer', 'Data Link Layer'],
    correct: 1,
  },
  {
    text: 'In TypeScript, what does the "readonly" modifier do on an object property?',
    options: [
      'Hides the property during JSON serialization',
      'Prevents reassignment after initialization at compile time',
      'Encrypts the property in memory',
      'Converts the property into a getter at runtime',
    ],
    correct: 1,
  },
  {
    text: 'Which of the following is a symmetric-key encryption algorithm?',
    options: ['RSA', 'Diffie-Hellman', 'AES', 'Ed25519'],
    correct: 2,
  },
];

async function main() {
  resolveDatabaseUrl();

  // 1. Collect admin accounts to create/update (passwords come strictly from env vars)
  const admins = new Map<string, string>();
  const primaryEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const primaryPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (primaryEmail) {
    if (!primaryPassword) {
      throw new Error('Missing SEED_ADMIN_PASSWORD environment variable for SEED_ADMIN_EMAIL');
    }
    admins.set(primaryEmail, primaryPassword);
  }

  const extraEmails = (process.env.SEED_EXTRA_ADMINS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (extraEmails.length > 0) {
    const extraPassword = process.env.SEED_EXTRA_PASSWORD?.trim();
    if (!extraPassword) {
      throw new Error('Missing SEED_EXTRA_PASSWORD environment variable for SEED_EXTRA_ADMINS');
    }
    for (const email of extraEmails) {
      if (!admins.has(email)) admins.set(email, extraPassword);
    }
  }

  if (admins.size === 0) {
    throw new Error('Provide SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in your environment before running seed');
  }

  // 2. Ensure schema migrations are applied on Neon Postgres
  await applyMigrations();

  try {
    let ownerId: string | null = null;
    for (const [email, password] of admins) {
      const { rows } = await query<{ id: string }>(
        `INSERT INTO admins (email, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [email, hashPassword(password)],
      );
      console.log(`✓ Configured admin user: ${email}`);
      if (!ownerId && rows[0]) ownerId = rows[0].id;
    }

    // 3. Seed "Demo Tech Quiz" if not already present
    const existingQuiz = unwrap<{ id: string; title: string; team_mode: string; teams: string[] } | null>(
      await db().from('quizzes').select('id,title,team_mode,teams').eq('title', 'Demo Tech Quiz').limit(1).maybeSingle(),
      'check Demo Tech Quiz',
    );

    if (existingQuiz) {
      if (existingQuiz.team_mode === 'list' && (!existingQuiz.teams || existingQuiz.teams.length === 0)) {
        unwrap(
          await db()
            .from('quizzes')
            .update({ teams: ['Team Alpha', 'Team Beta', 'Team Gamma', 'Team Delta'] })
            .eq('id', existingQuiz.id),
          'update Demo Tech Quiz teams',
        );
      }
      console.log(`✓ Sample quiz already exists: "${existingQuiz.title}" (${existingQuiz.id})`);
      return;
    }

    const theme = {
      ...PRESETS['neon-dark'],
      eventTitle: 'Demo Tech Quiz',
    };

    const quiz = unwrap<{ id: string }>(
      await db()
        .from('quizzes')
        .insert({
          owner_id: ownerId!,
          title: 'Demo Tech Quiz',
          description: '10 general tech questions — 5 minutes per student!',
          duration_seconds: 300,
          shuffle_questions: false,
          shuffle_options: false,
          allow_late_join: true,
          show_live_leaderboard: false,
          show_answers_after_reveal: true,
          roll_number_mode: 'off',
          roll_number_label: 'Roll number / USN',
          team_mode: 'list',
          teams: ['Team Alpha', 'Team Beta', 'Team Gamma', 'Team Delta'],
          email_required: true,
          score_visibility: 'after_publish',
          theme,
        })
        .select('id')
        .single(),
      'create Demo Tech Quiz',
    );

    for (let i = 0; i < DEMO_QUESTIONS.length; i++) {
      const q = DEMO_QUESTIONS[i];
      const qRow = unwrap<{ id: string }>(
        await db()
          .from('questions')
          .insert({
            quiz_id: quiz.id,
            position: i + 1,
            text: q.text,
            points: 1,
          })
          .select('id')
          .single(),
        `insert question ${i + 1}`,
      );

      const optRows = q.options.map((text, idx) => ({
        question_id: qRow.id,
        position: idx + 1,
        text,
        is_correct: idx === q.correct,
      }));
      unwrap(await db().from('options').insert(optRows), `insert options ${i + 1}`);
    }

    console.log(`✓ Seeded "Demo Tech Quiz" with ${DEMO_QUESTIONS.length} questions (${quiz.id})`);
  } finally {
    await pool().end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
