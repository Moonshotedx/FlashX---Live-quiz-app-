import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler: JSON responses, no-store caching, and uniform error handling. */
export function handler<P = Record<string, never>>(fn: (req: NextRequest, params: P) => Promise<Response | object>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const params = (await ctx.params) ?? ({} as P);
      const result = await fn(req, params);
      return result instanceof Response ? result : json(result);
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ error: e.code, message: e.message, ...e.extra }, e.status, e.status === 429 ? { 'Retry-After': '1' } : {});
      }
      if (e instanceof ZodError) {
        return json({ error: 'invalid_input', message: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
      }
      console.error('[api] unhandled', req.method, req.nextUrl.pathname, e);
      return json({ error: 'server_error', message: 'Something went wrong' }, 500);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Body must be JSON');
  }
  return schema.parse(raw);
}

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

// ---------------------------------------------------------------------------
// Best effort in-memory token bucket rate limiter (per server instance).
// Enough to stop a naive script flooding one instance; not a global limit.
// ---------------------------------------------------------------------------
const buckets = new Map<string, { tokens: number; at: number }>();
let lastSweep = Date.now();

export function rateLimit(key: string, capacity: number, refillPerSec: number) {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (now - b.at > 120_000) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    throw new HttpError(429, 'rate_limited', 'Too many requests, slow down');
  }
  b.tokens -= 1;
  buckets.set(key, b);
}

