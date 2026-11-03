import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

let cached: SupabaseClient | null = null;

/** Service role client. Bypasses RLS. Server only. Never import from client components. */
export function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    });
  }
  return cached;
}

/** Throw on a Supabase error, return data otherwise. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what = 'query'): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return res.data as T;
}

