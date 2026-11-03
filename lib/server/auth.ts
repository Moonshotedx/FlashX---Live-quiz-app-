import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { HttpError } from './api';
import { requireEnv } from './db';

/** Cookie based Supabase client for server components and route handlers (admin login session). */
export async function authClient() {
  const store = await cookies();
  return createServerClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a server component: middleware refreshes the session instead
        }
      },
    },
  });
}

export function isAdminUser(user: User | null): boolean {
  if (!user) return false;
  if (user.app_metadata?.role === 'admin') return true;
  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!user.email && allow.includes(user.email.toLowerCase());
}

/** Current logged in admin or null. Public sign ups are not admins unless seeded / allow listed. */
export async function getAdmin(): Promise<User | null> {
  const sb = await authClient();
  const { data } = await sb.auth.getUser();
  return data.user && isAdminUser(data.user) ? data.user : null;
}

export async function requireAdmin(): Promise<User> {
  const user = await getAdmin();
  if (!user) throw new HttpError(401, 'unauthorized', 'Admin login required');
  return user;
}

// ---------------------------------------------------------------------------
// Presenter token: unguessable per session, derived with HMAC so no extra storage is needed.
// ---------------------------------------------------------------------------
export function presenterToken(sessionId: string): string {
  return createHmac('sha256', requireEnv('SUPABASE_SERVICE_ROLE_KEY')).update(`presenter:${sessionId}`).digest('base64url').slice(0, 32);
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
