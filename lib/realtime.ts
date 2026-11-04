'use client';

/**
 * Optional live-event subscription hook.
 * Every consumer (StudentApp, ControlRoom, PresenterClient) polls on a 2–2.5s interval,
 * so no third-party websocket service or client-side database key is required.
 */
export function subscribeToSession(
  _sessionId: string,
  _onEvent: (event: string, payload: Record<string, unknown>) => void,
) {
  return () => {};
}
