# Change Spec - Convert Live Session Quiz to Self-Paced Form Quiz

Read this whole file and the existing code before changing anything. This is a change to an existing, working app. Reuse what is there. Do not rewrite from scratch.

Deadline: usable on **Thursday, 5 November 2026**. Do the P0 items first, end to end. Then P1.

---

## 1. What exists today (current behaviour)

The app is a live, host-driven quiz:

- Admin creates a **session** from a quiz. Session gets a join code. Status flow: `lobby -> live -> ended -> revealed`.
- Students join on `/j/[joinCode]` with name (and optional roll number) and wait in a lobby.
- Admin clicks **Start**. ONE shared timer starts for everybody (`sessions.started_at`, `sessions.ends_at`).
- When the shared timer ends, the server auto-submits everyone (`finalizeSession` in `lib/server/session.ts`).
- Admin reveals the leaderboard on the presenter screen (`/present/[sessionId]`).

Key files:
- Schema: `supabase/migrations/0001_init.sql`
- Types: `lib/types.ts`
- Session lifecycle and auto-submit: `lib/server/session.ts`
- Participant auth and context: `lib/server/play.ts`
- Scoring and ranking: `lib/scoring.ts`
- Student APIs: `app/api/join/[code]/route.ts`, `app/api/play/[code]/{state,answer,submit,result}/route.ts`
- Admin session APIs: `app/api/admin/sessions/**`
- Student UI: `components/student/StudentApp.tsx`, `components/student/QuestionScreen.tsx`
- Admin UI: `components/admin/QuizEditor.tsx`, `components/admin/ControlRoom.tsx`, `components/admin/QuizList.tsx`
- Presenter UI: `components/presenter/*`
- Exports: `lib/server/exports.ts`, `lib/server/results.ts`

## 2. What we want instead (new behaviour)

A **Google Form style** quiz that runs on a shareable link. There is no host pressing Start.

1. Admin builds the quiz (questions, correct answers, time limit, theme) exactly as today.
2. Admin clicks **Publish link**. The quiz is now open. Admin gets a link and a QR code to share (LED screen, WhatsApp, email).
3. A student opens the link at any time while it is open.
4. **Section 1 - Details:** Student enters **Name**, **Email**, and **Team**. Clicks Next.
5. **Section 2 - Instructions:** Shows the number of questions and the time limit, for example "10 questions, 5 minutes. The timer starts when you press Start." Student clicks **Start**.
6. **Section 3 - Questions:** The student's OWN timer starts now. They answer all questions within their time limit. Each student has their own timer, independent of everyone else.
7. Student submits, or is auto-submitted when their own timer runs out.
8. **Thank you screen.** Shows score immediately or later, depending on a quiz setting (see 4.1).
9. Admin sees results and a leaderboard that update as submissions come in. Admin can export results and show the leaderboard on the LED screen at any time.
10. Admin clicks **Close link** to stop new attempts.

The core change: **the timer moves from the session (one for everyone) to the participant (one per person, starting when they press Start).**

---

## 3. Design decision: reuse the `sessions` table as the "quiz link"

To keep changes small and safe, keep the `sessions` table and its status values, but change what they mean. Do NOT rename tables or columns.

| Status value in DB | New meaning | Label in admin UI |
|---|---|---|
| `lobby` | Not used for new links. Leave in the check constraint. | - |
| `live` | Link is **open**. New students can start. | Open |
| `ended` | Link is **closed**. No new students. Students already mid-attempt can still finish within their own timer. | Closed |
| `revealed` | Closed and results are **published**. Students can see their score and rank. Leaderboard can be shown. | Results published |

- `sessions.started_at` = when the link was opened.
- `sessions.ends_at` = no longer used as a global timer. Set it to null for new links. Remove every check that compares the current time to `sessions.ends_at` for answering or submitting.
- `sessions.quiz_snapshot` = taken when the link is published, exactly as `start` does today. Scoring keeps using the snapshot.
- `sessions.duration_seconds` = the per-student time limit (copied from the quiz at publish).

Add a short comment at the top of `lib/server/session.ts` and in `lib/types.ts` explaining this mapping.

---

## 4. Data model changes (P0)

Create a new migration `supabase/migrations/0002_self_paced.sql`. It must be safe to run on the existing database.

```sql
-- Quiz settings for the form flow
alter table quizzes add column if not exists team_mode text not null default 'list'
  check (team_mode in ('off','list','free'));          -- list = dropdown from teams[], free = text box
alter table quizzes add column if not exists teams text[] not null default '{}';
alter table quizzes add column if not exists email_required boolean not null default true;
alter table quizzes add column if not exists score_visibility text not null default 'after_publish'
  check (score_visibility in ('immediate','after_publish','never'));

-- Optional automatic close time for a link
alter table sessions add column if not exists closes_at timestamptz;

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
```

Update `lib/types.ts` (`QuizRow`, `SessionRow`, `ParticipantRow`, `RankedRow`) and `lib/server/schemas.ts` (`quizSettingsSchema`) to match.

### 4.1 Setting meanings
- `team_mode`: `list` shows a dropdown of `teams` (admin types them in the editor). `free` shows a text box. `off` hides the field.
- `email_required`: default true. Email is also the "one attempt per person" key.
- `score_visibility`:
  - `immediate` - student sees score and correct count right after submitting. Rank is shown only after results are published.
  - `after_publish` (default) - student sees "Submitted. Results will be announced." Score and rank appear when admin publishes results.
  - `never` - student only sees a thank you message.

---

## 5. Server changes (P0)

### 5.1 Personal timer helpers
Add to `lib/scoring.ts` or a new `lib/server/attempt.ts`:
- `attemptOpen(p)`: true when `p.started_at` is set, `p.submitted_at` is null, and `now <= p.ends_at + GRACE_MS`.
- `timeTakenMs` for this mode = `submitted_at - participant.started_at`. Update the call sites. Ranking order stays the same: score desc, time taken asc, submitted_at asc.

### 5.2 Auto-submit expired attempts (replaces the shared-timer finalize)
Add `finalizeExpiredAttempts(sessionId)` in `lib/server/session.ts`:
- Find participants in the session where `started_at is not null`, `submitted_at is null`, and `ends_at + GRACE_MS < now`.
- Score them from the snapshot (reuse `scoreAnswers`) and set `submitted_at = ends_at`, `auto_submitted = true`, `time_taken_ms = ends_at - started_at`.
- Coalesce concurrent calls per session (reuse the `finalizing` Map pattern).
- Call it lazily from: participant `state`, admin `stats`, admin `results`, both exports, and the presenter leaderboard endpoint. No cron needed.

Change `syncSession`:
- Remove the "shared timer expired -> finalizeSession" logic for live sessions.
- Add: if `status = 'live'` and `closes_at` is set and in the past, set status to `ended`.
- Keep `finalizeSession` only if still needed elsewhere. Otherwise delete it and its callers.

### 5.3 Student APIs
`POST /api/join/[code]` (Section 1 submit):
- Allowed only when status is `live` (open). Otherwise return 403 with "This quiz is closed."
- Body: `{ name, email, team }`. Validate with zod:
  - name 2 to 60 characters, profanity check as today
  - email valid format, lowercased and trimmed, required if `email_required`
  - team required if `team_mode != 'off'`; when `list`, must be one of `quizzes.teams`
- If a non-removed participant with this email already exists in this session:
  - already submitted -> 409 `already_submitted` "This email has already completed the quiz."
  - not submitted -> return that participant's existing `deviceToken` so they can resume on another device. Their timer is NOT reset.
- Otherwise create the participant (no `started_at` yet) and return `{ participantId, deviceToken }`.
- Remove the roll number field from the student UI. Keep the DB column; do not delete it.

New `POST /api/play/[code]/begin` (Start button):
- Authenticated by device token (reuse `playContext`).
- Allowed if the session status is `live`, the participant is not removed, and `started_at` is null.
- Atomically set `started_at = now()` and `ends_at = now() + duration_seconds` with `.is('started_at', null)` so a double tap cannot reset the timer.
- If already started, return the existing `endsAt` (idempotent).
- Return `{ startedAt, endsAt, serverNow }`.

`GET /api/play/[code]/state`:
- Call `finalizeExpiredAttempts` for this participant only (cheap) before answering.
- Return a `phase` field the client uses instead of the old session status:
  - `details` - no participant yet (handled by the join GET)
  - `ready` - joined, not started
  - `answering` - started, attempt open
  - `submitted` - submitted (manually or auto), results not published
  - `results` - session status `revealed`
  - `closed` - link closed and the participant never started
  - `removed`
- `endsAt` must be the participant's `ends_at`, not the session's.
- Questions are returned only in phase `answering`, without correctness data (unchanged rule).
- In phase `submitted`, include score and correct count only when `score_visibility = 'immediate'`.

`PUT /api/play/[code]/answer` and `POST /api/play/[code]/submit`:
- Replace the `session.status !== 'live'` and `session.ends_at` checks with `attemptOpen(participant)`.
- A student who started before the link was closed can still finish. Do not block on session status here.
- Submission inside the grace window counts as submitted at `participant.ends_at` (same logic as today, using the participant's time).

`GET /api/play/[code]/result`:
- Available when status is `revealed` (score, rank, review as today), or when `score_visibility = 'immediate'` (score and correct count only, no rank, no answer review until published).
- Never return correct answers before `revealed`. Keep the existing leak test passing.

### 5.4 Admin APIs
- `POST /api/admin/sessions` (Publish link): create the session, validate the quiz, take the snapshot, and set `status = 'live'`, `started_at = now()`, `ends_at = null` in one step. Accept an optional `closesAt`. Return the session id and join code.
- Replace `start` with nothing (delete the route or make it return 410).
- `POST /api/admin/sessions/[id]/close`: status `live -> ended`. Do not touch in-progress attempts.
- `POST /api/admin/sessions/[id]/reopen` (P1): status `ended -> live`.
- `reveal` (publish results): allow from `ended` only. Call `finalizeExpiredAttempts` first. In-progress attempts that are still running stay out of the published leaderboard until they submit or expire. Show the admin a warning with the count of attempts still in progress before publishing.
- `extend`: remove from the UI. Optional P2: extend one participant's `ends_at`.
- `reset`: keep. Deletes participants and answers, status back to `live`.
- `stats`: return counts for `not started`, `in progress`, `submitted`, plus the top 10.

---

## 6. Student UI changes (P0) - `components/student/StudentApp.tsx`

Drive the screens from the `phase` field, not from session status. Keep the existing components where possible (`QuestionScreen`, `Confirm`, `ResultScreen`, `Message`, `Brand`).

1. **Details screen** (replaces `JoinForm`): event title and logo, then Name, Email, Team (dropdown or text box per `team_mode`), and a Next button. Show inline validation errors. If the link is closed, show "This quiz is closed." If the email has already submitted, show "This email has already completed the quiz."
2. **Instructions screen** (replaces `Waiting`): greeting with the student's name, team, number of questions, time limit, the rules ("Your timer starts when you press Start. It keeps running if you close the page. Answers save automatically. You will be submitted when the time runs out."), and a large **Start** button. Pressing Start calls `/begin`, then loads questions.
3. **Questions screen**: unchanged layout. The timer uses the participant's `endsAt` with the existing server clock sync (`lib/use-server-clock.ts`). Auto-submit at zero (existing logic).
4. **Submitted screen**: per `score_visibility`.
5. **Results screen**: existing `ResultScreen` once results are published. Poll every 10 seconds while in phase `submitted` so the result appears without a refresh.
6. Remove all "waiting for the host" and "quiz already started" messages.
7. Keep localStorage resume behaviour. Refreshing during the questions phase must return to the questions with saved answers and the correct remaining time.

---

## 7. Admin UI changes (P0)

### 7.1 Quiz editor (`QuizEditor.tsx`)
- Rename "Duration" to **"Time limit per student"**.
- Add **Team field**: Off / Dropdown / Free text. When Dropdown, show a simple list editor (add, rename, delete team names).
- Add **Require email** toggle (default on).
- Add **When students see their score**: Immediately / After results are published / Never.
- Remove: "Allow late join", roll number settings.
- Keep "Live top 10 on the LED screen" and rename it to **"Show live leaderboard on the screen"**. Since students submit at different times, the LED leaderboard should update as submissions arrive.

### 7.2 Quiz list (`QuizList.tsx`)
- Replace "Create session" with **"Publish link"**. After publishing, go to the control room.
- Show each quiz's open links with status and submitted count.

### 7.3 Control room (`ControlRoom.tsx`), rename in UI to **"Responses"**
- Top: status badge (Open / Closed / Results published), the link with a Copy button, a **Show QR** button (opens the presenter page), a **Download QR** button (PNG), and an optional "Closes at" date-time picker.
- Buttons: **Close link**, **Reopen** (P1), **Publish results**, **Show leaderboard on screen**, **Reset** (typed confirm, as today).
- Counters: Started, In progress, Submitted.
- Responses table: rank, name, email, team, score, correct, time taken, status (not started / in progress with time left / submitted / auto-submitted), submitted at. Sortable. Filter by team. Search by name or email.
- Remove the "Start quiz" and "+1 minute" controls.

### 7.4 Presenter view (`/present/[sessionId]`)
- **Open** state: event title, a large QR code, the short link, and "X submitted". No countdown. If live leaderboard is on, show the live top 10 next to the QR.
- **Leaderboard** state: reuse the existing reveal animation (10 to 4, then podium, confetti) when the admin clicks Publish results or Show leaderboard.
- Remove the lobby, the "starting" countdown, and the shared timer screens.

---

## 8. Exports and leaderboard (P0)

- CSV and Excel: add **Email**, **Team**, and **Started at** columns. Remove Roll number when empty for every row.
- Excel: add a 4th sheet **Teams**: team, members submitted, total score, average score, best individual, ranked by average score.
- Print view: add Team column.
- Leaderboard rows on the LED show name and team (team in smaller text under the name).
- P1: a **Team leaderboard** tab in Responses and a team view on the presenter screen (ranked by average score, tie broken by total score).

---

## 9. Edge cases

| Case | Expected behaviour |
|---|---|
| Student opens link, fills details, never presses Start | Counts as "Not started". No timer. Not in leaderboard. |
| Student presses Start, closes the browser, comes back later | Timer kept running. If time is left, they resume with saved answers. If time is up, they see the submitted screen with their auto-submitted answers. |
| Same email on a second device mid-attempt | Resumes the same attempt with the same timer. |
| Same email after submitting | Blocked: "This email has already completed the quiz." |
| Admin closes link while students are mid-attempt | They can finish within their own timer. New students are blocked. |
| Admin publishes results while some attempts are running | Warn the admin with a count first. Those students appear once they submit or expire. |
| `closes_at` passes | Link becomes closed automatically on the next request. |
| Double tap on Start | Timer starts once (atomic update). |
| Student device clock is wrong | Existing server clock sync handles it. |

---

## 10. Tests and verification (P0)

Update `tests/quiz.test.ts`, `scripts/e2e.ts`, and `scripts/loadtest.ts` for the new flow:
- Two students start at different times and get independent timers.
- An expired attempt is auto-submitted with `submitted_at = participant.ends_at`.
- Same email cannot submit twice. Same email mid-attempt resumes with the original timer.
- Closing the link blocks new joins but not in-progress attempts.
- Correct answers never appear in any participant response before `revealed` (keep the existing leak test).
- Load test: 300 students joining over a 10 minute window at random times, each answering 10 questions and submitting.
- Run `npm run typecheck`, `npm test`, and `npm run build` with zero errors.

## 11. Security clean-up (P0, do before deploying)

- The seed admin password `12345678` appears in `README.md`, `scripts/seed.ts`, `scripts/e2e.ts`, and `scripts/loadtest.ts`. Remove every hard-coded default. Read it only from environment variables and fail if it is missing.
- Change the real admin password in Supabase, since this value is in git history.

## 12. Out of scope

- Live host-driven mode (we are replacing it, not keeping both).
- Per-question timers.
- Email verification or OTP.
- Sending results by email.
- Multiple attempts per person.

## 13. Build order

1. Migration `0002_self_paced.sql` and type updates.
2. Server: `begin` route, personal timer checks in answer and submit, `finalizeExpiredAttempts`, join changes, publish and close routes.
3. Student UI: details, instructions, questions with personal timer, submitted and results screens.
4. Admin: editor settings, Publish link, Responses page, exports with email and team.
5. Presenter: open state with QR, leaderboard reuse.
6. Tests, load test, security clean-up, deploy, and a real phone test end to end.
