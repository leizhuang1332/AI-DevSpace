/**
 * SSE event types shared between Agent and Web.
 * Extend by UNION adding new variants — never break existing members.
 */
export type SseEvent =
  | { type: 'hello'; sid: string; reqId: string; ts: number }
  | { type: 'heartbeat'; ts: number }
  | { type: 'placeholder'; message: string }

export const SSE_HEARTBEAT_MS = 30_000
