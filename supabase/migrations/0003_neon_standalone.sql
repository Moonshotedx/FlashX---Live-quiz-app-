-- Standalone Neon Postgres tables for admin authentication and uploaded branding/question images.
-- Idempotent and safe to run on new or existing databases.

alter table quizzes drop constraint if exists quizzes_owner_id_fkey;

create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists admins_email_lower_uq on admins (lower(email));

create table if not exists uploaded_assets (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

