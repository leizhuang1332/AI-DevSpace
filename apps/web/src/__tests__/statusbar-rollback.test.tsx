/**
 * StatusBar 回滚菜单 —— snapshot 列表刷新行为(audit-2026-07-26 #4)
 *
 * 审计结论:snapshot 是**分析过程中**才生成的,而 StatusBar 只在 `reqId`
 * 变化时拉一次列表。真实链路里首次加载(分析还没跑)列表为空 →
 * `snapshots.length > 0` 为 false → 回滚入口整块不渲染;分析跑完 reqId 没变,
 * effect 不重跑 → 用户在手动刷新页面之前永远看不到回滚按钮。
 *
 * 本测试锁定修复后的契约:SSE 推 `analysis_chunk` → 防抖后重新拉列表 →
 * 回滚入口出现。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import { StatusBar } from '@/components/statusbar'

// --- next/navigation stub:固定在某个需求的 ANALYZING 路由上 ---------------
const refreshSpy = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/requirements/req-1/analyzing',
  useRouter: () => ({ refresh: refreshSpy }),
}))

// --- agentFetch stub:按调用次数返回不同的 snapshot 列表 -------------------
const agentFetchMock = vi.fn()
vi.mock('@/lib/agent-client', () => ({
  agentFetch: (...args: unknown[]) => agentFetchMock(...args),
}))

/** 极简 EventSource 替身:记录监听器,允许测试手动派发命名事件 */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, Set<(e: unknown) => void>>()
  closed = false
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn)
  }
  close(): void {
    this.closed = true
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) })
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  agentFetchMock.mockReset()
  refreshSpy.mockReset()
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const SNAPSHOT = { id: 'before_admission', sessionId: 'sess-1', takenAt: '2026-07-26T10:00:00.000Z' }

describe('StatusBar · snapshot 列表刷新', () => {
  it('首次列表为空 → 回滚入口不渲染', async () => {
    agentFetchMock.mockResolvedValue({ snapshots: [] })
    render(<StatusBar tabs={[]} currentId="req-1" />)
    await waitFor(() => expect(agentFetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('statusbar-rollback')).toBeNull()
  })

  it('分析 SSE 推流后重新拉列表 → 回滚入口出现', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // 第 1 次(挂载时)空;之后返回 1 条 snapshot
    agentFetchMock
      .mockResolvedValueOnce({ snapshots: [] })
      .mockResolvedValue({ snapshots: [SNAPSHOT] })

    render(<StatusBar tabs={[]} currentId="req-1" />)
    await waitFor(() => expect(agentFetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('statusbar-rollback')).toBeNull()

    // SSE 订阅已建立,且订阅的是该需求的事件流
    const es = FakeEventSource.instances[0]
    expect(es.url).toContain('/api/requirement/req-1/events')

    // 推一串 chunk —— 防抖窗口内只应触发一次重新拉取
    await act(async () => {
      es.emit('analysis_chunk', { type: 'analysis_chunk', chunk: { id: 'c1' } })
      es.emit('analysis_chunk', { type: 'analysis_chunk', chunk: { id: 'c2' } })
      es.emit('analysis_chunk', { type: 'analysis_chunk', chunk: { id: 'c3' } })
      await vi.advanceTimersByTimeAsync(2000)
    })

    await waitFor(() => expect(screen.getByTestId('statusbar-rollback')).toBeInTheDocument())
    // 挂载 1 次 + 防抖收敛后 1 次 = 2 次(不是每条 chunk 一次)
    expect(agentFetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('statusbar-rollback-btn')).toBeInTheDocument()
  })

  it('卸载时关闭 EventSource(不泄漏订阅)', async () => {
    agentFetchMock.mockResolvedValue({ snapshots: [] })
    const { unmount } = render(<StatusBar tabs={[]} currentId="req-1" />)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    unmount()
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it('拉取失败 → 静默降级为空列表(回滚入口不渲染,不抛错)', async () => {
    agentFetchMock.mockRejectedValue(new Error('agent down'))
    render(<StatusBar tabs={[]} currentId="req-1" />)
    await waitFor(() => expect(agentFetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('statusbar-rollback')).toBeNull()
  })
})
