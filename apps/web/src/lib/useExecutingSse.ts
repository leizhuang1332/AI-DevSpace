'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { SseEvent } from '@ai-devspace/shared'

export type ExecutingAiStatus =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: string }
  | {
      kind: 'retrying'
      category: 'A' | 'C' | 'D'
      retry: number
      maxRetries: number
      delayMs: number
      startedAt: string
    }
  | {
      kind: 'failed'
      category: 'A' | 'B' | 'C' | 'D' | 'E'
      code: string
      message: string
      failedAt: string
    }
  | { kind: 'cancelled'; reason: string; cancelledAt: string }

export interface UseExecutingSseOptions {
  reqId: string
  sessionId: string | null
  enabled: boolean
}

interface InternalState {
  status: ExecutingAiStatus
  currentRunId: string | null
}

type Action =
  | { type: 'reset'; runId: string | null }
  | { type: 'running'; runId: string; startedAt: string }
  | {
      type: 'retrying'
      runId: string
      payload: { category: 'A' | 'C' | 'D'; retry: number; maxRetries: number; delayMs: number }
    }
  | {
      type: 'failed'
      runId: string
      payload: { category: 'A' | 'B' | 'C' | 'D' | 'E'; code: string; message: string }
      failedAt: string
    }
  | { type: 'cancelled'; runId: string; reason: string; cancelledAt: string }

function reducer(state: InternalState, action: Action): InternalState {
  // stale runId 事件一律丢弃(running/reset 总是接受并切换 currentRunId)
  if (
    action.type === 'retrying' ||
    action.type === 'failed' ||
    action.type === 'cancelled'
  ) {
    if (state.currentRunId !== null && action.runId !== state.currentRunId) {
      return state
    }
  }
  switch (action.type) {
    case 'reset':
      return { status: { kind: 'idle' }, currentRunId: action.runId }
    case 'running':
      return {
        status: { kind: 'running', startedAt: action.startedAt },
        currentRunId: action.runId,
      }
    case 'retrying':
      return {
        status: {
          kind: 'retrying',
          category: action.payload.category,
          retry: action.payload.retry,
          maxRetries: action.payload.maxRetries,
          delayMs: action.payload.delayMs,
          startedAt:
            state.status.kind === 'running' ? state.status.startedAt : new Date().toISOString(),
        },
        currentRunId: action.runId,
      }
    case 'failed':
      return {
        status: {
          kind: 'failed',
          category: action.payload.category,
          code: action.payload.code,
          message: action.payload.message,
          failedAt: action.failedAt,
        },
        currentRunId: action.runId,
      }
    case 'cancelled':
      return {
        status: { kind: 'cancelled', reason: action.reason, cancelledAt: action.cancelledAt },
        currentRunId: action.runId,
      }
  }
}

export function useExecutingSse(opts: UseExecutingSseOptions): {
  status: ExecutingAiStatus
  retry: () => Promise<void>
  cancel: () => Promise<void>
} {
  const { reqId, sessionId, enabled } = opts
  const [state, dispatch] = useReducer(reducer, {
    status: { kind: 'idle' },
    currentRunId: null,
  })
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled || !sessionId) {
      esRef.current?.close()
      esRef.current = null
      return
    }
    const es = new EventSource(`/api/agent/events?reqId=${encodeURIComponent(reqId)}`)
    esRef.current = es
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent
        switch (event.type) {
          case 'retrying':
            dispatch({
              type: 'retrying',
              runId: event.runId,
              payload: {
                category: event.category,
                retry: event.retry ?? 1,
                maxRetries: event.maxRetries ?? 1,
                delayMs: event.delayMs ?? 0,
              },
            })
            break
          case 'query_failed':
            dispatch({
              type: 'failed',
              runId: event.runId,
              payload: {
                category: event.category,
                code: event.code,
                message: event.message,
              },
              failedAt: new Date().toISOString(),
            })
            break
          case 'query_succeeded':
            dispatch({ type: 'reset', runId: null })
            break
          case 'query_cancelled':
            dispatch({
              type: 'cancelled',
              runId: event.runId,
              reason: 'user',
              cancelledAt: new Date().toISOString(),
            })
            break
        }
      } catch {
        /* malformed event */
      }
    }
    return () => {
      es.close()
      esRef.current = null
    }
  }, [enabled, sessionId, reqId])

  const retry = useCallback(async () => {
    if (!sessionId) throw new Error('No sessionId')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(
        `/api/agent/sessions/${encodeURIComponent(sessionId)}/retry`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reqId }),
          signal: controller.signal,
        },
      )
      if (!res.ok) throw new Error(`retry failed: ${res.status}`)
      const data = await res.json()
      dispatch({
        type: 'running',
        runId: data.runId ?? `run-${Date.now()}`,
        startedAt: new Date().toISOString(),
      })
    } finally {
      clearTimeout(timeout)
    }
  }, [sessionId, reqId])

  const cancel = useCallback(async () => {
    // 本期 no-op —— 后续 S6 / Task 9/10 接入 cancel
  }, [])

  return { status: state.status, retry, cancel }
}
