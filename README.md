# Self-Paced Live Quiz App

Self-paced, shareable-link quiz web app for in-person and campus events, built with Next.js (App Router), TypeScript (strict), Tailwind CSS, Framer Motion, and Supabase.

## Features
- **Shareable Mobile Quiz (`/j/[joinCode]`)**: Zero-install mobile-first flow — students scan a QR code or open the link, enter **Name**, **Email**, and **Team**, review the instructions, and press **Start** to begin their own personal server-synced countdown timer (`/api/time`). Answers save immediately with offline retry, refreshing resumes mid-attempt, and one-attempt-per-email enforcement resumes active attempts on a second device while blocking repeat submissions.
- **Admin Quiz Editor & Responses (`/admin`)**: Email/password Supabase Auth, drag-and-drop question editor (`@dnd-kit`), CSV bulk question import, per-student time limit, team mode (`Dropdown` / `Free text` / `Off`), score visibility (`After results are published` / `Immediately` / `Never`), 4 WCAG-checked theme presets + custom branding, one-click **Publish link**, **Responses** dashboard (live `Started` / `In progress` / `Submitted` counters, optional auto-close timestamp, Close / Reopen / Publish results with running-attempt warning, Download QR PNG, sortable/searchable/team-filterable responses table, Team leaderboard tab), CSV export, 4-sheet Excel (`.xlsx`) export (`Leaderboard`, `Responses`, `Question stats`, `Teams`), and A4 print view (`/admin/sessions/[sessionId]/print`).
- **Presenter LED Screen (`/present/[sessionId]`)**: 1920×1080 scaled stage showing the event title, distance-scannable QR code, short link, join code, live submitted counter, optional Live Top 10, dramatic 10→4 slide-in + 3rd/2nd/1st podium rise + confetti burst, auto-scrolling full leaderboard, and **Team Standings** toggle.
- **Security & Fairness**: Correct answers (`is_correct`) never leave the server before results are published (`status === 'revealed'`). All participant traffic runs through server route handlers using `zod` validation, rate limiting, and frozen `quiz_snapshot` scoring.

## Quick Start

1. **Database schema**: Run [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql) followed by [`supabase/migrations/0002_self_paced.sql`](./supabase/migrations/0002_self_paced.sql) in your Supabase SQL Editor (or run `npm run db:migrate` with `DATABASE_URL` set), and disable public email sign-ups under **Authentication → Providers → Email** (admins are created via `npm run seed`).
2. **Environment variables**: Copy `.env.example` to `.env.local` and fill in:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   NEXT_PUBLIC_APP_URL=
   SEED_ADMIN_EMAIL=admin@example.com
   SEED_ADMIN_PASSWORD=<choose-a-strong-password>
   ```
3. **Install & seed**:
   ```bash
   npm install
   npm run seed
   npm run dev
   ```

## Verification & Load Testing

```bash
npm run typecheck   # Strict TypeScript check
npm test            # Unit, security (zero answer leak), personal timer, team rank, CSV & 4-sheet XLSX tests
npm run build       # Production Next.js build & bundle size check
npm run e2e         # Full self-paced E2E acceptance test against BASE_URL
npm run loadtest    # Simulates 300 students joining over a staggered window, answering & submitting
```
