import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, handler, HttpError, parseBody, rateLimit } from '@/lib/server/api';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  hashPassword,
  signAdminToken,
  verifyPassword,
} from '@/lib/server/auth';
import { query } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

const loginBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

let adminsTableReady = false;

async function ensureAdminsTable() {
  if (adminsTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS admins_email_lower_uq ON admins (lower(email));
  `);
  adminsTableReady = true;
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export const POST = handler(async (req) => {
  rateLimit(`admin_login:${clientIp(req)}`, 10, 0.2);
  const { email: rawEmail, password } = await parseBody(req, loginBody);
  const email = rawEmail.trim().toLowerCase();

  await ensureAdminsTable();

  const existing = await query<{ id: string; email: string; password_hash: string }>(
    `SELECT id, email, password_hash FROM admins WHERE lower(email) = $1 LIMIT 1`,
    [email],
  );

  let adminUser: { id: string; email: string } | null = null;

  if (existing.rows[0]) {
    if (verifyPassword(password, existing.rows[0].password_hash)) {
      adminUser = { id: existing.rows[0].id, email: existing.rows[0].email };
    }
  } else {
    // Allow first-login bootstrap if SEED_ADMIN_EMAIL & SEED_ADMIN_PASSWORD match
    const seedEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const seedPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
    if (seedEmail && seedPassword && email === seedEmail && safeEquals(password, seedPassword)) {
      const inserted = await query<{ id: string; email: string }>(
        `INSERT INTO admins (email, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id, email`,
        [email, hashPassword(password)],
      );
      adminUser = inserted.rows[0] ?? null;
    }
  }

  if (!adminUser) {
    throw new HttpError(401, 'invalid_credentials', 'Wrong email or password.');
  }

  const token = signAdminToken(adminUser);
  const res = NextResponse.json({ ok: true, user: adminUser });
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
  return res;
});

