/**
 * AIEvent → typed SseEvent 映射 —— ADR-0010 P4 · Task 5 + Q10.3
 *
 * 规则(brief Step 6 + ADR-0010 Q10.3):
 *  - retrying → retrying variant(独立);lifecycle 子类(由 Web 驱动 StatusBar)
 *  - error & category !== 'E' → query_failed(retryable 由 recoverable 决定)
 *  - done{reason:'cancelled'} → query_cancelled(独立)
 *  - 其余(包含 error category=E) → ai_event envelope(由 typed AIEvent 自然承载);
 *    同时附带 streamKind(Q10.3) 帮 Web narrow 到 chat / activity / lifecycle 三个 UI 流
 *
 * 拆出独立文件是为了打破 sessionBroadcaster.ts ↔ spike.ts 的循环依赖
 * (spike.ts 也要用本函数,但 sessionBroadcaster 引用 spike.ts 的
 * `attachRecorder` 等会再回到 broadcaster —— 独立文件后单向)。
 */

import type { SseEvent } from '@ai-devspace/shared'
import type { AIEvent } from '../providers/AIEvent.js'
import { classifyStreamKind } from './classifyActivity.js'

export function mapAiEventToSse(
  runId: string,
  reqId: string,
  sessionId: string,
  event: AIEvent,
  ts: number = Date.now(),
): SseEvent {
  if (event.type === 'retrying') {
    return {
      type: 'retrying',
      runId,
      reqId,
      sessionId,
      ts,
      category: event.category,
      retry: event.retry,
      maxRetries: event.maxRetries,
      delayMs: event.delayMs,
      message: event.message,
    }
  }
  if (event.type === 'error' && event.category !== 'E') {
    return {
      type: 'query_failed',
      runId,
      reqId,
      sessionId,
      ts,
      category: event.category ?? 'B',
      code: event.code,
      message: event.message,
      retryable: event.recoverable,
    }
  }
  if (event.type === 'done' && event.reason === 'cancelled') {
    return { type: 'query_cancelled', runId, reqId, sessionId, ts }
  }
  return {
    type: 'ai_event',
    runId,
    reqId,
    sessionId,
    ts,
    streamKind: classifyStreamKind(event),
    event,
  }
}