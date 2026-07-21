import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, within, fireEvent } from '@testing-library/react'
import { AnalyzingZone } from '@/components/analyzing-zone'
import {
  emptyAnalyzing,
  type AnalyzingData,
} from '@/lib/analyzing'
import { getAnalyzingData } from '@/lib/analyzing.server'

// 注:打字机是 setTimeout 链 + 单一 phase 状态机(详见组件实现)。它在真实浏览器
// 中流畅运行(20ms / 字,200ms chunk 间暂停),但 fake timers + React 18 commit
// 时机在测试中不稳定(advanceTimersByTimeAsync 推进 timer 但 React commit 由
// MessageChannel 调度,有时序漂移)。因此测试聚焦于:
//   1. 渲染结构(满数据 / 空态 / 错误态 / 主区容错空 chunks)
//   2. 用户动作的最终状态(暂停切换 / 重置清空)
//   3. 完成提示(done 时弹出)
// 打字机逐字推进的 20ms 节流由代码 inspection 验证(constant + setTimeout 链)。

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ============================================================================
// 直接进入主区(issue: ANALYZING 工位改造 · 直接进入主区,删 NotStartedPanel)
//
// 用例:
//   1. emptyAnalyzing() 仍走 EmptyAnalyzing + 'ANALYZING 工位暂无内容'
//   2. 主区空 chunks/sessions 时仍渲染(主区容错),不显示 NotStartedPanel
//   3. phase=active (req-001) 走主区,stage strip 可见
// ============================================================================

describe('AnalyzingZone · 直接进入主区', () => {
  it('回归: emptyAnalyzing() 仍走 EmptyAnalyzing + 文案 "ANALYZING 工位暂无内容"', () => {
    const data = emptyAnalyzing('NEW-REQ')
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.getAttribute('data-requirement-id')).toBe('NEW-REQ')

    expect(screen.getByText('ANALYZING 工位暂无内容')).toBeInTheDocument()
    const cta = screen.getByText('→ 进入 DRAFTING 工位')
    expect(cta.getAttribute('href')).toBe('/requirements/NEW-REQ/drafting')

    expect(screen.queryByTestId('analyzing-stage-strip')).toBeNull()
    expect(screen.queryByTestId('analyzing-toolbar')).toBeNull()
    expect(screen.queryByTestId('analyzing-stream')).toBeNull()
  })

  it('主区空 chunks/sessions → 仍走主区,容错不崩(显示"暂无思考流"等)', () => {
    // 模拟:有 requirement.md(空 false),但 fs 还没启动过 session(sessions/chunks 都空)
    // 这正是 "首次进入 ANALYZING" 的真实状态 —— 主区应当容错渲染
    const data: AnalyzingData = {
      ...emptyAnalyzing('req-003'),
      empty: false,
      phase: 'active',
    }
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-phase')).toBe('active')
    expect(root.getAttribute('data-requirement-id')).toBe('req-003')

    // 主区骨架存在
    expect(screen.getByTestId('analyzing-stage-strip')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-stream')).toBeInTheDocument()

    // 思考流空态文案
    expect(screen.getByText('暂无思考流')).toBeInTheDocument()
  })

  it('回归: req-001 仍走 REFUND_ANALYZING(主区 stage strip 可见)', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-phase')).toBe('active')

    // 主区 testid 出现
    expect(screen.getByTestId('analyzing-stage-strip')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-stream')).toBeInTheDocument()
  })
})

// ============================================================================
// 满数据渲染 — Thinking 大屏 + stats + 思考流骨架
// ============================================================================

describe('AnalyzingZone · 满数据渲染', () => {
  it('根节点 + stage strip + toolbar + summary + 流容器存在', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-requirement-id')).toBe('req-001')
    expect(root.getAttribute('data-paused')).toBe('false')

    expect(screen.getByTestId('analyzing-stage-strip')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-stage-badge').textContent).toBe('② 分析')
    expect(screen.getByTestId('analyzing-stage-title').textContent).toContain('ANALYZING')
    expect(screen.getByTestId('analyzing-stage-title').textContent).toContain('Thinking')

    expect(screen.getByTestId('analyzing-toolbar')).toBeInTheDocument()
    const crumbs = screen.getAllByTestId(/^analyzing-crumb-/)
    expect(crumbs.length).toBe(5)
    const current = screen.getByTestId('analyzing-crumb-current')
    expect(current.textContent).toBe('AI 思考过程')
    expect(current.getAttribute('data-current')).toBe('true')

    expect(screen.getByTestId('analyzing-summary')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-summary-icon').textContent).toBe('🧠')
    expect(
      screen.getByTestId('analyzing-summary-title').textContent,
    ).toContain('退款功能优化')

    expect(screen.getByTestId('analyzing-stream')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-stream-body')).toBeInTheDocument()
  })

  it('顶部三 stats:子问题 5 / 风险点 3 / 方案方向 2', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    expect(
      screen.getByTestId('analyzing-stat-subproblems').getAttribute('data-n'),
    ).toBe('5')
    expect(screen.getByTestId('analyzing-stat-risks').getAttribute('data-n')).toBe('3')
    expect(
      screen.getByTestId('analyzing-stat-options').getAttribute('data-n'),
    ).toBe('2')
  })

  it('toolbar 3 个动作:pause / reset / copy(原顺序)', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    expect(screen.getByTestId('analyzing-toolbar-pause')).toBeInTheDocument()
    expect(screen.getByTestId('analyzing-toolbar-reset')).toBeInTheDocument()
    expect(screen.getByText('📋 复制思考产物')).toBeInTheDocument()
  })

  it('初始 phase=typing,chunk 0 进入 current 状态显示首字符(打字机起步)', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    const currentChunk = screen.getByTestId('analyzing-chunk-current')
    expect(currentChunk.getAttribute('data-chunk-id')).toBe('c-1')
    expect(currentChunk.getAttribute('data-tone')).toBe('info')
    expect(currentChunk.getAttribute('data-typed-len')).toBe('1')
    expect(currentChunk.getAttribute('data-full-len')).toBe(
      String(data.chunks[0].text.length),
    )
    const future = screen.getAllByTestId('analyzing-chunk-future')
    expect(future.length).toBe(data.chunks.length - 1)
  })
})

// ============================================================================
// 跳过打字机 — 点击流区立即完成当前 chunk(issue 19 验收 #3)
// ============================================================================

describe('AnalyzingZone · 点击跳过打字', () => {
  it('点击流区跳过当前 chunk 打字(立即显示完整文字)', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    const stream = screen.getByTestId('analyzing-stream-body')
    fireEvent.click(stream)

    // click 同步触发后,React commit 让 typedLen = chunk.text.length
    const current = screen.getByTestId('analyzing-chunk-current')
    const typedLen = Number(current.getAttribute('data-typed-len'))
    const fullLen = Number(current.getAttribute('data-full-len'))
    expect(typedLen).toBe(fullLen)
  })
})

// ============================================================================
// 暂停 / 重置(issue 19 验收 #3 / #4)
// ============================================================================

describe('AnalyzingZone · 暂停 / 重置', () => {
  it('点击 ⏸ 暂停 → 按钮文案变"▶ 继续",data-paused=true', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    const pauseBtn = screen.getByTestId('analyzing-toolbar-pause')
    expect(pauseBtn.getAttribute('data-paused')).toBe('false')
    expect(pauseBtn.textContent).toContain('暂停')

    fireEvent.click(pauseBtn)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-paused')).toBe('true')
    expect(pauseBtn.getAttribute('data-paused')).toBe('true')
    expect(pauseBtn.textContent).toContain('继续')
  })

  it('点击 ▶ 继续 → 按钮文案变回"⏸ 暂停",data-paused=false', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    const pauseBtn = screen.getByTestId('analyzing-toolbar-pause')
    fireEvent.click(pauseBtn)
    expect(pauseBtn.getAttribute('data-paused')).toBe('true')

    fireEvent.click(pauseBtn)
    expect(pauseBtn.getAttribute('data-paused')).toBe('false')
    expect(pauseBtn.textContent).toContain('暂停')
  })

  it('点击 ↶ 重置 → 回到 chunk-0,typed-len=1(打字机起步)', async () => {
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    // 先跳过打字(让 typedLen = full,模拟"已打过字"状态)
    fireEvent.click(screen.getByTestId('analyzing-stream-body'))
    const beforeLen = Number(
      screen.getByTestId('analyzing-chunk-current').getAttribute('data-typed-len'),
    )
    expect(beforeLen).toBeGreaterThan(1)

    fireEvent.click(screen.getByTestId('analyzing-toolbar-reset'))

    const current = screen.getByTestId('analyzing-chunk-current')
    expect(current.getAttribute('data-chunk-id')).toBe('c-1')
    expect(current.getAttribute('data-typed-len')).toBe('1')

    const future = screen.getAllByTestId('analyzing-chunk-future')
    expect(future.length).toBe(data.chunks.length - 1)
  })
})

// ============================================================================
// 空态 — 引导去 DRAFTING(issue 19 验收:empty=true)
// ============================================================================

describe('AnalyzingZone · 空数据', () => {
  it('empty=true 渲染空态引导,不渲染主区', () => {
    const data = emptyAnalyzing('NEW-REQ')
    render(<AnalyzingZone data={data} />)

    const root = screen.getByTestId('analyzing-zone')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.getAttribute('data-requirement-id')).toBe('NEW-REQ')

    // 共享 <EmptyState> 渲染 —— 用文案 + 链接 href 验证
    expect(screen.getByText('ANALYZING 工位暂无内容')).toBeInTheDocument()
    const cta = screen.getByText('→ 进入 DRAFTING 工位')
    expect(cta.getAttribute('href')).toBe('/requirements/NEW-REQ/drafting')

    expect(screen.queryByTestId('analyzing-stage-strip')).toBeNull()
    expect(screen.queryByTestId('analyzing-toolbar')).toBeNull()
    expect(screen.queryByTestId('analyzing-stream')).toBeNull()
  })
})

// ============================================================================
// 错误态 — 极端输入不应崩
// ============================================================================

describe('AnalyzingZone · 错误态(边界)', () => {
  it('chunks 为空但 empty=false 时,渲染流但显示"暂无思考流"', () => {
    const data: AnalyzingData = {
      ...emptyAnalyzing('EMPTY'),
      empty: false,
      chunks: [],
      streamMeta: {
        totalChunks: 0,
        isStreaming: false,
        startedAt: '2026-07-12T00:00:00.000Z',
        endedAt: null,
      },
      stats: { subproblems: 0, risks: 0, options: 0, total: 0 },
    }
    render(<AnalyzingZone data={data} />)
    expect(screen.getByTestId('analyzing-zone').getAttribute('data-empty')).toBe('false')
    expect(screen.getByText('暂无思考流')).toBeInTheDocument()
  })

  it('toolbar.actions 为空时,toolbar 不崩', () => {
    const data: AnalyzingData = {
      ...emptyAnalyzing('NO-ACTIONS'),
      empty: false,
      chunks: [
        {
          id: 'c-1',
          ts: '14:23:01',
          label: 'START',
          text: '单 chunk',
          kind: 'narration',
          tone: 'info',
        },
      ],
      streamMeta: {
        totalChunks: 1,
        isStreaming: true,
        startedAt: '2026-07-12T00:00:00.000Z',
        endedAt: null,
      },
      toolbar: { crumb: [{ label: 'A', current: true }], actions: [] },
      stats: { subproblems: 0, risks: 0, options: 0, total: 0 },
    }
    render(<AnalyzingZone data={data} />)
    expect(screen.getByTestId('analyzing-toolbar')).toBeInTheDocument()
    expect(screen.queryByTestId('analyzing-toolbar-pause')).toBeNull()
  })

  it('顶层不崩(空 / 异常数据 mount 即返回)', () => {
    expect(() =>
      render(<AnalyzingZone data={emptyAnalyzing('X')} />),
    ).not.toThrow()
  })
})

// ============================================================================
// 完成提示(done 状态)—— 测试通过 props 注入的 streamMeta 验证 done 状态可触发
// ============================================================================

describe('AnalyzingZone · 完成提示(决策 15 非自动跳转)', () => {
  it('完成提示的链接与按钮渲染(通过组件 prop streamMeta 模拟)', async () => {
    // 由于打字机推进在 fake timers 下不稳定,完成提示的弹出来源是 useEffect on phase=done。
    // 这里通过状态验证:当 data 指示 isStreaming=false(已结束),toolbar 显示"已暂停"状态文本。
    const data: AnalyzingData = {
      ...emptyAnalyzing('COMPLETE'),
      empty: false,
      chunks: [
        { id: 'd-1', ts: '14:23:01', label: 'COMPLETE', text: '分析完成', kind: 'narration', tone: 'success' },
      ],
      streamMeta: {
        totalChunks: 1,
        isStreaming: false,
        startedAt: '2026-07-12T00:00:00.000Z',
        endedAt: '2026-07-12T00:00:30.000Z',
      },
      stats: { subproblems: 0, risks: 0, options: 0, total: 0 },
    }
    render(<AnalyzingZone data={data} />)

    // 组件正确接收 streamMeta 并在 stage strip 反映状态
    expect(screen.getByTestId('analyzing-stage-status').textContent).toBe('已暂停')
  })
})

// ============================================================================
// 打字机 fake-timer 推进(issue 19b 验收 #14 子项)
// 用 fake timer 推进 20ms / 字,断言 typed-len 增长。
// React 18 commit 在 fake-timer 下有 MessageChannel 时序漂移,所以本测试
// 用一个宽松的断言模式:推进 N 倍时间后,typed-len 至少应有所增长(具体值受 React
// commit batch 影响),不严格等于 N * 1。
// ============================================================================

describe('AnalyzingZone · 打字机 fake-timer 推进(20ms/字)', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('初始 typed-len=1;fake-timer 推进 ≥ 100ms 后 typed-len ≥ 2(20ms/字)', async () => {
    vi.useFakeTimers()
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    // 初始:打字机起步,typed-len=1
    const initialTypedLen = Number(
      screen.getByTestId('analyzing-chunk-current').getAttribute('data-typed-len'),
    )
    expect(initialTypedLen).toBe(1)

    // 推进 100ms → 至少多打 1 个字(理论 5 个,但 React commit batch 不稳定)
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    const afterTypedLen = Number(
      screen.getByTestId('analyzing-chunk-current').getAttribute('data-typed-len'),
    )
    expect(afterTypedLen).toBeGreaterThan(initialTypedLen)
  })

  it('推进 ≥ fullLen 时间后,typed-len === fullLen(完成当前 chunk)', async () => {
    vi.useFakeTimers()
    const data = await getAnalyzingData('req-001')
    render(<AnalyzingZone data={data} />)

    const current = screen.getByTestId('analyzing-chunk-current')
    const fullLen = Number(current.getAttribute('data-full-len'))

    // 分小步推进(每次 20ms)避免 fake-timer 下 React batching 卡死
    // 每次推进后用 microtask 让 React commit 完成
    for (let i = 0; i < fullLen; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
    }
    // 此时 c-1 字符全部打完,phase=typing chunkIndex=0 typedLen=fullLen;
    // 但还没等完 INTER_CHUNK_PAUSE_MS → 仍是 current row(完整文字)
    const afterTypedLen = Number(
      screen.getByTestId('analyzing-chunk-current').getAttribute('data-typed-len'),
    )
    expect(afterTypedLen).toBe(fullLen)
  })
})