/** Small fetch helper for admin UI calls. Throws an Error with the server message on failure. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    cache: 'no-store',
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? 'error'), String(data.message ?? res.statusText), data);
  return data as T;
}

export function formatDuration(ms: number | null | undefined, withTenths = false) {
  if (ms === null || ms === undefined) return '–';
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const sec = withTenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return m > 0 ? `${m}:${sec}` : `${withTenths ? s.toFixed(1) : Math.floor(s)}s`;
}

export function mmss(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

