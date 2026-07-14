import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock EventSource —— 测试期间不接真实 SSE
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  close(): void { /* noop */ }
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

// @ts-expect-error - vitest 注入
globalThis.EventSource = MockEventSource

import { useExecutingSse } from '../useExecutingSse'

describe('useExecutingSse', () => {
  beforeEach(() => {
    MockEventSource.instances = []
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts in idle and does not connect when sessionId is null', () => {
    const { result } = renderHook(() =>
      useExecutingSse({ reqId: 'r1', sessionId: null, enabled: true }),
    )
    expect(result.current.status).toEqual({ kind: 'idle' })
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('connects to EventSource when sessionId provided', () => {
    renderHook(() => useExecutingSse({ reqId: 'r1', sessionId: 's1', enabled: true }))
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toContain('/events?reqId=r1')
  })

  it('transitions idle → retrying on retrying event', () => {
    const { result } = renderHook(() =>
      useExecutingSse({ reqId: 'r1', sessionId: 's1', enabled: true }),
    )
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying',
        reqId: 'r1',
        sessionId: 's1',
        runId: 'run-1',
        ts: Date.now(),
        category: 'A',
        retry: 1,
        maxRetries: 3,
        delayMs: 1000,
        message: 'rate limit',
      })
    })
    expect(result.current.status.kind).toBe('retrying')
    if (result.current.status.kind === 'retrying') {
      expect(result.current.status.retry).toBe(1)
      expect(result.current.status.maxRetries).toBe(3)
    }
  })

  it('transitions retrying → failed on query_failed', () => {
    const { result } = renderHook(() =>
      useExecutingSse({ reqId: 'r1', sessionId: 's1', enabled: true }),
    )
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying',
        reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: '',
      })
      MockEventSource.instances[0].emit({
        type: 'query_failed',
        reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        category: 'B', code: '401', message: 'auth failed', retryable: false,
      })
    })
    expect(result.current.status.kind).toBe('failed')
    if (result.current.status.kind === 'failed') {
      expect(result.current.status.category).toBe('B')
      expect(result.current.status.code).toBe('401')
    }
  })

  it('drops stale runId events after query_succeeded resets to a new run', () => {
    const { result } = renderHook(() =>
      useExecutingSse({ reqId: 'r1', sessionId: 's1', enabled: true }),
    )
    // 1) run-1 retrying → 建立 currentRunId=run-1
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying', reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: '',
      })
    })
    expect(result.current.status.kind).toBe('retrying')
    // 2) query_succeeded → reducer 进入 idle,currentRunId=null
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'query_succeeded', reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        durationMs: 100, attempts: 1,
      })
    })
    expect(result.current.status.kind).toBe('idle')
    // 3) 新一轮 run-2 retrying(用户点 retry) → reducer 接收,建立 currentRunId=run-2
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying', reqId: 'r1', sessionId: 's1', runId: 'run-2', ts: 0,
        category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: '',
      })
    })
    // 4) 旧 run-1 的迟到 retrying → reducer 应丢弃(不破坏 run-2 状态)
    act(() => {
      MockEventSource.instances[0].emit({
        type: 'retrying', reqId: 'r1', sessionId: 's1', runId: 'run-1', ts: 0,
        category: 'A', retry: 2, maxRetries: 3, delayMs: 3000, message: 'late',
      })
    })
    expect(result.current.status.kind).toBe('retrying')
    if (result.current.status.kind === 'retrying') {
      // 仍属 run-2 的 retry=1(retry=2 的 stale 事件被 drop)
      expect(result.current.status.retry).toBe(1)
    } else {
      throw new Error('expected retrying status')
    }
  })
})
