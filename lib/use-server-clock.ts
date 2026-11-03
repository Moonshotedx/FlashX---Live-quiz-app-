'use client';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Client side server clock. remaining = endsAt - (Date.now() + offset).
 * A wrong phone clock cannot give extra time because the offset corrects it.
 */
export function useServerClock() {
  const offset = useRef(0);
  const synced = useRef(false);

  const sync = useCallback(async () => {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/time', { cache: 'no-store' });
      const t1 = Date.now();
      const { now } = (await res.json()) as { now: number };
      offset.current = now - (t0 + t1) / 2; // assume symmetric latency
      synced.current = true;
    } catch {
      /* keep the previous offset */
    }
  }, []);

  /** Cheaper correction from any response that carries serverNow (used only before the first /api/time sync). */
  const adopt = useCallback((serverNow: number, sentAt: number) => {
    if (!synced.current) offset.current = serverNow - (sentAt + Date.now()) / 2;
  }, []);

  useEffect(() => {
    sync();
    const id = setInterval(sync, 30_000);
    return () => clearInterval(id);
  }, [sync]);

  const now = useCallback(() => Date.now() + offset.current, []);
  return { now, sync, adopt };
}

