import { createClient } from '@supabase/supabase-js';
import { PRESETS } from '../lib/theme';

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

  // List existing auth users to stay idempotent
  const existingUsers = new Map<string, string>();
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) {
      if (u.email) existingUsers.set(u.email.toLowerCase(), u.id);
    }
    if (data.users.length < 200) break;
    page++;
  }

  let ownerId: string | null = null;
  for (const [email, password] of admins) {
    const existingId = existingUsers.get(email);
    if (existingId) {
      const { error } = await supabase.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
        app_metadata: { role: 'admin' },
      });
      if (error) throw new Error(`Failed updating admin ${email}: ${error.message}`);
      console.log(`✓ Updated admin user: ${email}`);
      if (!ownerId) ownerId = existingId;
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: 'admin' },
      });
      if (error || !data.user) throw new Error(`Failed creating admin ${email}: ${error?.message}`);
      console.log(`✓ Created admin user: ${email}`);
      if (!ownerId) ownerId = data.user.id;
    }
  }

  // 2. Ensure storage bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.id === 'quiz-assets')) {
    const { error } = await supabase.storage.createBucket('quiz-assets', { public: true });
    if (error && !error.message.toLowerCase().includes('already exists')) {
      console.warn('Bucket creation warning:', error.message);
    } else {
      console.log('✓ Created public storage bucket: quiz-assets');
    }
  } else {
    console.log('✓ Storage bucket ready: quiz-assets');
  }

  // 3. Seed "Demo Tech Quiz" if not already present
  const { data: existingQuiz, error: findErr } = await supabase
    .from('quizzes')
    .select('id, title, team_mode, teams')
    .eq('title', 'Demo Tech Quiz')
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(`Failed checking quizzes (did you run 0001_init.sql and 0002_self_paced.sql?): ${findErr.message}`);

  if (existingQuiz) {
    if (existingQuiz.team_mode === 'list' && (!existingQuiz.teams || existingQuiz.teams.length === 0)) {
      await supabase
        .from('quizzes')
        .update({ teams: ['Team Alpha', 'Team Beta', 'Team Gamma', 'Team Delta'] })
        .eq('id', existingQuiz.id);
    }
    console.log(`✓ Sample quiz already exists: "${existingQuiz.title}" (${existingQuiz.id})`);
    return;
  }

  const theme = {
    ...PRESETS['neon-dark'],
    eventTitle: 'Demo Tech Quiz',
  };

  const { data: quiz, error: quizErr } = await supabase
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
    .single();
  if (quizErr || !quiz) throw new Error(`Failed creating Demo Tech Quiz: ${quizErr?.message}`);

  for (let i = 0; i < DEMO_QUESTIONS.length; i++) {
    const q = DEMO_QUESTIONS[i];
    const { data: qRow, error: qErr } = await supabase
      .from('questions')
      .insert({
        quiz_id: quiz.id,
        position: i + 1,
        text: q.text,
        points: 1,
      })
      .select('id')
      .single();
    if (qErr || !qRow) throw new Error(`Failed inserting question ${i + 1}: ${qErr?.message}`);

    const optRows = q.options.map((text, idx) => ({
      question_id: qRow.id,
      position: idx + 1,
      text,
      is_correct: idx === q.correct,
    }));
    const { error: oErr } = await supabase.from('options').insert(optRows);
    if (oErr) throw new Error(`Failed inserting options for question ${i + 1}: ${oErr.message}`);
  }

  console.log(`✓ Seeded "Demo Tech Quiz" with ${DEMO_QUESTIONS.length} questions (${quiz.id})`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

