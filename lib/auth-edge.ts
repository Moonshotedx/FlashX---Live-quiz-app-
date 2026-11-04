export const ADMIN_COOKIE_NAME = 'flashx_admin';

export interface AdminUser {
  id: string;
  email: string;
}

export function resolveAuthSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    ''
  );
}

function fromBase64Url(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Edge-runtime compatible HMAC-SHA256 session cookie verifier (used by `middleware.ts`). */
export async function verifyAdminTokenEdge(
  token: string | undefined | null,
  secretOverride?: string,
): Promise<AdminUser | null> {
  if (!token) return null;
  const secret = (secretOverride ?? resolveAuthSecret()).trim();
  if (!secret) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const sigBytes = fromBase64Url(sigB64);
  const payloadBytes = fromBase64Url(payloadB64);
  if (!sigBytes || !payloadBytes) return null;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes as BufferSource,
      enc.encode(payloadB64),
    );
    if (!valid) return null;

    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
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

