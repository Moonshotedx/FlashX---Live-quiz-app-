import { cache } from 'react';
import { cookies } from 'next/headers';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { HttpError } from './api';
import { ADMIN_COOKIE_NAME, resolveAuthSecret, type AdminUser } from '../auth-edge';

export { ADMIN_COOKIE_NAME, type AdminUser };

export const ADMIN_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

function requireAuthSecret(): string {
  const secret = resolveAuthSecret();
  if (!secret) {
    throw new Error('Missing AUTH_SECRET (or DATABASE_URL) environment variable');
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Password hashing (Node built-in scrypt + 128-bit random salt, timing-safe check)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexHash] = parts;
  if (!salt || !hexHash || hexHash.length !== 128) return false;
  try {
    const expected = Buffer.from(hexHash, 'hex');
    const actual = scryptSync(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Signed HttpOnly session token (`<payloadBase64Url>.<hmacSha256Base64Url>`)
// ---------------------------------------------------------------------------

export function signAdminToken(
  user: AdminUser,
  maxAgeMs = ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
  secretOverride?: string,
): string {
  const secret = (secretOverride ?? requireAuthSecret()).trim();
  const payload = Buffer.from(
    JSON.stringify({
      id: user.id,
      email: user.email,
      exp: Date.now() + maxAgeMs,
    }),
    'utf8',
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAdminToken(token: string | undefined | null, secretOverride?: string): AdminUser | null {
  if (!token) return null;
  const secret = (secretOverride ?? resolveAuthSecret()).trim();
  if (!secret) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const a = Buffer.from(expectedSig, 'utf8');
  const b = Buffer.from(sigB64, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      id?: unknown;
      email?: unknown;
      exp?: unknown;
    };
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.exp !== 'number' ||
      parsed.exp <= Date.now()
    ) {
      return null;
    }
    return { id: parsed.id, email: parsed.email };
  } catch {
    return null;
  }
}

export function isAdminUser(user: AdminUser | null): boolean {
  return !!user;
}

/** Request-scoped auth lookup so AdminLayout and child pages share one cookie verification. */
export const getAuthUser = cache(async (): Promise<AdminUser | null> => {
  const store = await cookies();
  return verifyAdminToken(store.get(ADMIN_COOKIE_NAME)?.value);
});

export async function getAdmin(): Promise<AdminUser | null> {
  return getAuthUser();
}

export async function requireAdmin(): Promise<AdminUser> {
  const user = await getAdmin();
  if (!user) throw new HttpError(401, 'unauthorized', 'Admin login required');
  return user;
}

// ---------------------------------------------------------------------------
// Presenter token: unguessable per session, derived with HMAC so no extra storage is needed.
// ---------------------------------------------------------------------------
export function presenterToken(sessionId: string): string {
  return createHmac('sha256', requireAuthSecret()).update(`presenter:${sessionId}`).digest('base64url').slice(0, 32);
}

export function validPresenterToken(sessionId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(presenterToken(sessionId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function tokenFromRequest(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get('t') ?? req.headers.get('x-presenter-token');
}
