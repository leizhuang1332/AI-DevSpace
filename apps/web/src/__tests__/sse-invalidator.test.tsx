import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { ReactNode } from 'react'

// mock EventSource —— 不接真实 SSE
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  private listeners = new Map<string, ((e: { data: string }) => void)[]>()
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (e: { data: string }) => void): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(cb)
    this.listeners.set(type, arr)
  }
  removeEventListener(type: string, cb: (e: { data: string }) => void): void {
    const arr = this.listeners.get(type) ?? []
    this.listeners.set(type, arr.filter((f) => f !== cb))
  }
  close = vi.fn()
  emit(type: string, data: unknown): void {
    const arr = this.listeners.get(type) ?? []
    for (const cb of arr) {
      cb({ data: typeof data === 'string' ? data : JSON.stringify(data) })
    }
  }
}

// @ts-expect-error - vitest 注入
globalThis.EventSource = MockEventSource

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

// 必须在 mock 之后 import
import { SSEInvalidator } from '../components/sse-invalidator'

function wrap(node: ReactNode) {
  // 组件本身 return null —— 测试不需要 Provider
  return render(node as unknown as JSX.Element)
}

describe('SSEInvalidator', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    refreshMock.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mount 时连接 /api/agent/events/requirements', () => {
    wrap(<SSEInvalidator />)
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/agent/events/requirements')
  })

  it('收到 requirement_created 事件 → 调 router.refresh()', () => {
    wrap(<SSEInvalidator />)
    act(() => {
      MockEventSource.instances[0].emit('requirement_created', { id: 'req-999' })
    })
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('收到其他事件 → 不调 refresh', () => {
    wrap(<SSEInvalidator />)
    act(() => {
      MockEventSource.instances[0].emit('hello', { sid: 'x' })
      MockEventSource.instances[0].emit('requirement_updated', { id: 'req-001' })
    })
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('unmount → es.close() 调用', () => {
    const { unmount } = wrap(<SSEInvalidator />)
    const es = MockEventSource.instances[0]
    expect(es.close).not.toHaveBeenCalled()
    unmount()
    expect(es.close).toHaveBeenCalledTimes(1)
  })

  it('error 事件 → 不抛错(浏览器自动重连)', () => {
    wrap(<SSEInvalidator />)
    expect(() => {
      act(() => {
        MockEventSource.instances[0].emit('error', {})
      })
    }).not.toThrow()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('SSR 安全(组件不调用任何 window API 直接抛错)', () => {
    // SSEInvalidator useEffect 里 typeof window !== 'undefined' 守卫 —— 无需 mock window
    // 这里只验证它能 mount 在 jsdom 环境
    expect(() => wrap(<SSEInvalidator />)).not.toThrow()
  })
})