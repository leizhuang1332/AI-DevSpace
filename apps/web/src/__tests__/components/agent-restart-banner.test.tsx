/**
 * AgentRestartBanner (ADR-0037 D4)
 *
 * 5 case:
 *  1. 默认 idle → 不渲染 DOM
 *  2. 收到 agent-restarting → 切 restarting + 显示「🔄 Agent 正在重启…」banner
 *  3. restarting 后收到 open (EventSource 重连成功) → 切 recovered + 显示「✓ Agent 已恢复」
 *  4. recovered 3s 后淡出回 idle → 不渲染 DOM
 *  5. 连续两次 restarting → 第二次仍正常显示(状态机幂等)
 *
 * 测试 seam: fake EventSource 实现 addEventListener('agent-restarting'/'open'),
 * 测试用例手动 dispatch 事件,验证 banner 状态变化。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AgentRestartBanner } from '@/components/agent-restart-banner'

type Listener = (e: Event) => void

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  private listeners = new Map<string, Set<Listener>>()
  closed = false

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn)
  }

  close(): void {
    this.closed = true
  }

  // 测试 hook:模拟服务端推送
  emit(type: string, data?: unknown): void {
    const set = this.listeners.get(type)
    if (!set) return
    const ev =
      data !== undefined
        ? ({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent)
        : ({} as Event)
    for (const fn of set) fn(ev as Event)
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function getLatest(): FakeEventSource {
  const arr = FakeEventSource.instances
  const last = arr[arr.length - 1]
  if (!last) throw new Error('no EventSource constructed')
  return last
}

describe('AgentRestartBanner (ADR-0037 D4)', () => {
  it('case 1: 默认 idle → 不渲染 DOM', () => {
    render(<AgentRestartBanner />)
    expect(screen.queryByTestId('agent-restart-banner')).toBeNull()
  })

  it('case 2: 收到 agent-restarting → 显示「🔄 Agent 正在重启…」banner + reason', () => {
    render(<AgentRestartBanner />)
    act(() => {
      getLatest().emit('agent-restarting', { reason: 'workspaceRoot-changed', ts: 1 })
    })
    const banner = screen.getByTestId('agent-restart-banner')
    expect(banner).toBeInTheDocument()
    expect(banner.getAttribute('data-state')).toBe('restarting')
    expect(banner.textContent).toMatch(/Agent 正在重启/)
    expect(banner.textContent).toMatch(/workspaceRoot-changed/)
  })

  it('case 3: restarting 后 EventSource 重新 open → 切 recovered + 显示「✓ Agent 已恢复」', () => {
    render(<AgentRestartBanner />)
    act(() => {
      getLatest().emit('agent-restarting', { reason: 'manual-restart', ts: 1 })
    })
    expect(screen.getByTestId('agent-restart-banner').getAttribute('data-state')).toBe(
      'restarting',
    )
    act(() => {
      getLatest().emit('open')
    })
    const banner = screen.getByTestId('agent-restart-banner')
    expect(banner.getAttribute('data-state')).toBe('recovered')
    expect(banner.textContent).toMatch(/Agent 已恢复/)
  })

  it('case 4: recovered 3s 后淡出回 idle → 不渲染 DOM', () => {
    render(<AgentRestartBanner />)
    act(() => {
      getLatest().emit('agent-restarting', { reason: 'manual-restart', ts: 1 })
    })
    act(() => {
      getLatest().emit('open')
    })
    expect(screen.getByTestId('agent-restart-banner')).toBeInTheDocument()

    // 3s 未到 → 仍在
    act(() => {
      vi.advanceTimersByTime(2900)
    })
    expect(screen.queryByTestId('agent-restart-banner')).not.toBeNull()

    // 满 3s → 切 idle
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByTestId('agent-restart-banner')).toBeNull()
  })

  it('case 5: 连续两次 restarting → 第二次仍正常显示(状态机幂等)', () => {
    render(<AgentRestartBanner />)
    act(() => {
      getLatest().emit('agent-restarting', { reason: 'manual-restart', ts: 1 })
    })
    act(() => {
      getLatest().emit('open')
    })
    // 第 1 次恢复后,再触发一次重启
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByTestId('agent-restart-banner')).toBeNull()

    act(() => {
      getLatest().emit('agent-restarting', { reason: 'config-changed', ts: 2 })
    })
    const banner = screen.getByTestId('agent-restart-banner')
    expect(banner.getAttribute('data-state')).toBe('restarting')
    expect(banner.textContent).toMatch(/config-changed/)
  })
})