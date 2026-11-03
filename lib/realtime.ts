'use client';
import { RealtimeClient } from '@supabase/realtime-js';

/**
 * Subscribe to the `session:<id>` broadcast channel. Events are only a hint to refetch;
 * every consumer also polls, so a dropped socket never breaks the experience.
 * Uses realtime-js directly (instead of the full supabase-js) to keep the student bundle small.
 */
export function subscribeToSession(sessionId: string, onEvent: (event: string, payload: Record<string, unknown>) => void) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || typeof window === 'undefined') return () => {};
  try {
    const client = new RealtimeClient(`${url.replace(/^http/, 'ws')}/realtime/v1`, { params: { apikey: key, eventsPerSecond: 5 } });
    const channel = client.channel(`session:${sessionId}`, { config: { broadcast: { self: false } } });
    for (const event of ['status', 'extended', 'reveal', 'reset', 'participant']) {
      channel.on('broadcast', { event }, (msg: { payload?: Record<string, unknown> }) => onEvent(event, msg.payload ?? {}));
    }
    channel.subscribe();
    return () => {
      try {
        client.removeChannel(channel);
        client.disconnect();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return () => {};
  }
}

