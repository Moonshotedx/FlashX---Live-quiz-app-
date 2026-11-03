# Live Quiz App

Real-time Mentimeter / Kahoot-style live quiz web app for in-person events, built with Next.js (App Router), TypeScript (strict), Tailwind CSS, Framer Motion, and Supabase.

## Features
- **Presenter LED Screen (`/present/[sessionId]`)**: 1920×1080 scaled stage, huge distance-scannable QR code, floating recent joiners, live circular countdown timer, optional live top-10, dramatic 10→4 slide-in + 3rd/2nd/1st podium rise + confetti burst, auto-scrolling full leaderboard, idle cursor hiding, and fullscreen mode.
- **Mobile Student Experience (`/j/[joinCode]`)**: Zero-install mobile-first join, `localStorage` device-token state recovery across refreshes, server-synced countdown clock (`/api/time`), immediate answer saving with offline backoff retry, question navigator, confirmation dialog, auto-submit on timer expiry, and post-reveal rank + answer review.
- **Admin Dashboard & Control Room (`/admin`)**: Email/password Supabase Auth, drag-and-drop question editor (`@dnd-kit`), autosave, CSV bulk question import with error preview, image & logo uploads, 4 built-in theme presets + custom colors/gradients/Google Fonts + WCAG contrast checks + live phone & 16:9 previews, live session control room (+1 min, remove/rename participant, step-by-step or automatic reveal, session reset), CSV export, 3-sheet Excel (`.xlsx`) export with green/red response shading, Top-10 PNG download, and A4 PDF print view (`/admin/sessions/[sessionId]/print`).
- **Security & Fairness**: Correct answers (`is_correct`) never leave the server until `status === 'revealed'`. All participant traffic runs through server route handlers using `zod` validation, rate limiting, and frozen `quiz_snapshot` scoring.

## Quick Start

1. **Database schema**: Run [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql) in your Supabase SQL Editor, and disable public email sign-ups under **Authentication → Providers → Email** (admins are created via `npm run seed`).
2. **Environment variables**: Copy `.env.example` to `.env.local` and fill in:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   NEXT_PUBLIC_APP_URL=
   SEED_ADMIN_EMAIL=anirban@xcelerator.in
   SEED_ADMIN_PASSWORD=12345678
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
npm test            # Unit, security (zero answer leak), CSV & 3-sheet XLSX tests
npm run build       # Production Next.js build & bundle size check
npm run e2e         # Full live E2E acceptance test against BASE_URL
npm run loadtest    # Simulates 350–500 concurrent students joining, answering & submitting
```
