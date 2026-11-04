-- FlashX schema (PostgreSQL / Neon Postgres compatible).
-- Apply via `npm run db:migrate`.

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null,
  description text,
  duration_seconds int not null default 300,
  shuffle_questions boolean not null default false,
  shuffle_options boolean not null default false,
  allow_late_join boolean not null default true,
  show_live_leaderboard boolean not null default false,
  show_answers_after_reveal boolean not null default true,
  roll_number_mode text not null default 'off' check (roll_number_mode in ('off','optional','required')),
  roll_number_label text not null default 'Roll number / USN',
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes on delete cascade not null,
  position int not null,
  text text not null,
  image_url text,
  points int not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists questions_quiz_idx on questions (quiz_id, position);

create table if not exists options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references questions on delete cascade not null,
  position int not null,
  text text not null,
  is_correct boolean not null default false
);
create index if not exists options_question_idx on options (question_id, position);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes on delete cascade not null,
  join_code text unique not null,
  status text not null default 'lobby' check (status in ('lobby','live','ended','revealed')),
  duration_seconds int not null,
  started_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  quiz_snapshot jsonb,
  -- Reveal control (used for automatic, step-by-step, and full-leaderboard modes)
  revealed_at timestamptz,
  reveal_mode text not null default 'auto' check (reveal_mode in ('auto','manual','full')),
  reveal_step int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sessions_quiz_idx on sessions (quiz_id, created_at desc);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions on delete cascade not null,
  display_name text not null,
  roll_number text,
  device_token text not null,
  joined_at timestamptz not null default now(),
  submitted_at timestamptz,
  auto_submitted boolean not null default false,
  score int not null default 0,
  correct_count int not null default 0,
  time_taken_ms int,
  is_removed boolean not null default false,
  unique (session_id, device_token)
);
create index if not exists participants_rank_idx on participants (session_id, score desc, time_taken_ms asc);
create index if not exists participants_joined_idx on participants (session_id, joined_at desc);
create index if not exists participants_token_idx on participants (device_token);

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants on delete cascade not null,
  question_id uuid not null,
  option_id uuid not null,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  unique (participant_id, question_id)
);

-- Answered counts per participant for the control room (avoids pulling every answer row every few seconds).
create or replace function session_answer_counts(sid uuid)
returns table (participant_id uuid, answered bigint)
language sql stable as $$
  select a.participant_id, count(*)::bigint
  from answers a join participants p on p.id = a.participant_id
  where p.session_id = sid
  group by a.participant_id
$$;
