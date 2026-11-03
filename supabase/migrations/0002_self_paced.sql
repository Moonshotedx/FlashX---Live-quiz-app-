-- Self-paced form quiz migration (replaces shared session timer with per-participant timers).
-- Safe and idempotent to run on an existing 0001_init.sql database.

-- Quiz settings for the form flow
alter table quizzes add column if not exists team_mode text not null default 'list'
  check (team_mode in ('off','list','free'));          -- list = dropdown from teams[], free = text box
alter table quizzes add column if not exists teams text[] not null default '{}';
alter table quizzes add column if not exists email_required boolean not null default true;
alter table quizzes add column if not exists score_visibility text not null default 'after_publish'
  check (score_visibility in ('immediate','after_publish','never'));

-- Optional automatic close time for a link, plus team leaderboard reveal mode
alter table sessions add column if not exists closes_at timestamptz;
alter table sessions drop constraint if exists sessions_reveal_mode_check;
alter table sessions add constraint sessions_reveal_mode_check
  check (reveal_mode in ('auto','manual','full','teams'));

-- Per participant details and personal timer
alter table participants add column if not exists email text;
alter table participants add column if not exists team text;
alter table participants add column if not exists started_at timestamptz;  -- when they pressed Start
alter table participants add column if not exists ends_at timestamptz;     -- started_at + duration

-- One attempt per email per link (ignores removed participants)
create unique index if not exists participants_session_email_uq
  on participants (session_id, lower(email))
  where email is not null and is_removed = false;

create index if not exists participants_expiry_idx
  on participants (session_id, ends_at) where submitted_at is null;

