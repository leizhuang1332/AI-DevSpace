/**
 * AnalyzingZone · 历史抽屉 + 焦点规则(issue 05 · ADR-0021)
 *
 * 覆盖 spec acceptance:
 * - 5:用户手动切换历史 Run → 焦点切到该 Run
 * - 7:用户手动切换后,后续 SSE 终态事件(succeeded / failed)不会抢回焦点
 * - 9:删除 Run 弹二次确认 + 确认后 DELETE 端点被调
 * - 11:删除当前 Run 后 → 切到最新剩余 Run
 *
 * analyzing-fab ticket 01(ADR-0022 决策 88~98)之后:历史从「永久 320px
 * 抽屉」改为「默认折叠的浮动召唤按钮 + 浮动面板」。本文件继续复用
 * `<AnalyzingZone>` 顶层 seam,只把"行级"测试前置为「先点 FAB 开面板」
 * 即可;FAB 自身行为(三关闭、aria、N=0 灰色等)在文件末尾的新 describe
 * 块覆盖。
 *
 * 用 fake EventSource 模拟 SSE 推送;其他 UI 子树被简化(避免 full DOM)。
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalyzingZone } from '@/components/analyzing-zone'
import { emptyAnalyzing, type AnalyzingData } from '@/lib/analyzing'
import type { AnalysisRunMeta, AnalysisIssue } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// EventSource mock(模拟 SSE 推送)
// ---------------------------------------------------------------------------

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners: Record<string, ((e: MessageEvent<string>) => void)[]> = {}
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (e: MessageEvent<string>) => void): void {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(cb)
  }
  removeEventListener(type: string, cb: (e: MessageEvent<string>) => void): void {
    if (!this.listeners[type]) return
    this.listeners[type] = this.listeners[type].filter((x) => x !== cb)
  }
  close(): void {
    /* noop */
  }
  emit(type: string, data: unknown): void {
    const payload = JSON.stringify(data)
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: payload } as MessageEvent<string>)
    }
  }
}

// @ts-expect-error - vitest 注入 global EventSource
globalThis.EventSource = MockEventSource

// ---------------------------------------------------------------------------
// fetch mock(避免 agent-client 走真实网络)
// ---------------------------------------------------------------------------

// fetch 直接被 agent-client 调;此处全部返空 JSON
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 204,
  json: async () => {
    throw new SyntaxError('no body')
  },
})
// 注入 fetch 到 global(避免 agent-client 走真实网络)
globalThis.fetch = mockFetch as typeof fetch

// 让 hasAuthCookie 直接返 true(跳过 bootstrap;jsdom 下 document.cookie 为空)
vi.mock('@/lib/agent-bootstrap', () => ({
  hasAuthCookie: () => true,
  getOrBootstrap: async () => ({
    ok: true,
    token: 'mock-token',
    cookieName: 'aidevspace_token',
    cookieAttributes: { SameSite: 'Strict', Path: '/', MaxAge: 30 * 24 * 3600 },
    apiBase: 'http://localhost:7777',
    agentVersion: 'test',
    sseNote: '',
  }),
  resetBootstrapCache: () => {},
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildRun(partial: Partial<AnalysisRunMeta> & { run_id: string }): AnalysisRunMeta {
  const base: AnalysisRunMeta = {
    run_id: partial.run_id,
    requirement_id: 'req-focus',
    skill_name: 'prd-completeness',
    status: 'succeeded',
    created_at: '2026-08-01T10:30:00.000Z',
    finished_at: '2026-08-01T10:30:42.000Z',
    issue_count: 0,
    error: null,
  }
  return { ...base, ...partial, run_id: partial.run_id }
}

function buildData(runs: AnalysisRunMeta[]): AnalyzingData {
  // issue 08 · ADR-0021:AnalyzingData 不再有 `phase` 字段
  return {
    ...emptyAnalyzing('req-focus'),
    empty: false,
    prdMarkdown: '# 测试 PRD\n',
    runs,
  }
}

// ---------------------------------------------------------------------------
// 测试夹具清理
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockEventSource.instances = []
  mockFetch.mockClear()
})

/**
 * analyzing-fab ticket 01:历史面板默认折叠。下列行级测试需要先点 FAB 打开
 * 面板(否则行根本未渲染)。
 */
async function openHistoryPanel(): Promise<void> {
  await userEvent.click(screen.getByTestId('analysis-history-fab'))
  await waitFor(() => {
    expect(screen.getByTestId('analysis-history-panel')).toBeInTheDocument()
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ===========================================================================
// 焦点规则(issue 05 验收 5 / 7)
// ===========================================================================

describe('AnalyzingZone · 焦点规则(issue 05 验收 5 / 7)', () => {
  it('页面默认选中最新 Run(created_at 最大)', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)

    // ticket 01:data-active-run-id 暴露在 FAB 上(面板默认折叠,FAB 一直渲染)
    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.getAttribute('data-active-run-id')).toBe('run-new')
  })

  it('点历史行 → 焦点切到该 Run(验收 5)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    await openHistoryPanel()

    // 找到 run-old 的 select 按钮
    const oldRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-old')!
    const oldSelectBtn = oldRow.querySelector(
      '[data-testid="analysis-history-row-select"]',
    ) as HTMLElement
    await userEvent.click(oldSelectBtn)

    await waitFor(() => {
      const fab = screen.getByTestId('analysis-history-fab')
      expect(fab.getAttribute('data-active-run-id')).toBe('run-old')
    })
  })

  it('手动切到旧 Run 后,SSE 终态事件(succeeded)不会抢回焦点(验收 7)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-old',
        created_at: '2026-08-01T08:00:00.000Z',
        status: 'succeeded',
      }),
      buildRun({
        run_id: 'run-new',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'running',
      }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    await openHistoryPanel()

    // 用户先点 run-old
    const oldRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-old')!
    const oldSelectBtn = oldRow.querySelector(
      '[data-testid="analysis-history-row-select"]',
    ) as HTMLElement
    await userEvent.click(oldSelectBtn)

    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-old')
    })

    // 模拟 SSE:run-new 终态成功事件 — 不应抢回焦点
    // useEffect 在 currentRunId 变化时重新注册 EventSource → 用最新实例
    const es = MockEventSource.instances.at(-1)!
    await act(async () => {
      es.emit('analysis_run_succeeded', {
        type: 'analysis_run_succeeded',
        reqId: 'req-focus',
        runId: 'run-new',
        ts: Date.now(),
        finishedAt: '2026-08-01T10:05:00.000Z',
        issueCount: 0,
      })
    })

    // 焦点仍是 run-old
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-old')

    // ticket 02:点 Run 行后面板已自动关闭,这里要先重开面板才能再查 row 状态
    await openHistoryPanel()

    // 状态确实被更新(succeeded)
    const newRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-new')!
    expect(newRow.getAttribute('data-run-status')).toBe('succeeded')
  })

  it('手动切到旧 Run 后,SSE failed 事件不会抢回焦点(验收 7 镜像)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({
        run_id: 'run-new',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'running',
      }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    await openHistoryPanel()

    const oldRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-old')!
    await userEvent.click(
      oldRow.querySelector('[data-testid="analysis-history-row-select"]') as HTMLElement,
    )

    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-old')
    })

    const es = MockEventSource.instances.at(-1)!
    await act(async () => {
      es.emit('analysis_run_failed', {
        type: 'analysis_run_failed',
        reqId: 'req-focus',
        runId: 'run-new',
        ts: Date.now(),
        finishedAt: '2026-08-01T10:05:00.000Z',
        error: 'simulated',
        issueCount: 0,
      })
    })

    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-old')
  })
})

// ===========================================================================
// 删除确认对话框 + 二次确认(issue 05 验收 8 / 9 / 11)
// ===========================================================================

describe('AnalyzingZone · 删除 Run(issue 05 验收 8 / 9 / 11)', () => {
  it('running Run 行不显示删除按钮', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-r', status: 'running' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    await openHistoryPanel()
    const row = screen.getByTestId('analysis-history-row')
    expect(row.querySelector('[data-testid="analysis-history-row-delete"]')).toBeNull()
    expect(
      row.querySelector('[data-testid="analysis-history-row-delete-disabled"]'),
    ).toBeTruthy()
  })

  it('点删除按钮 → 弹二次确认对话框', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-s', status: 'succeeded', skill_name: 'prd-completeness' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    await openHistoryPanel()

    await userEvent.click(screen.getByTestId('analysis-history-row-delete'))

    const dialog = screen.getByTestId('analysis-delete-dialog')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(screen.getByTestId('analysis-delete-dialog-skill').textContent).toBe(
      'prd-completeness',
    )
    // 上下文警告(无条件显示)
    expect(screen.getByTestId('analysis-delete-dialog-context-warning')).toBeTruthy()
  })

  it('点取消 → 对话框关闭', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-s', status: 'succeeded' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    await openHistoryPanel()

    await userEvent.click(screen.getByTestId('analysis-history-row-delete'))
    expect(screen.getByTestId('analysis-delete-dialog')).toBeTruthy()

    await userEvent.click(screen.getByTestId('analysis-delete-dialog-cancel'))
    expect(screen.queryByTestId('analysis-delete-dialog')).toBeNull()
  })

  it('点确认 → 调 DELETE 端点', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-s', status: 'succeeded' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    await openHistoryPanel()

    await userEvent.click(screen.getByTestId('analysis-history-row-delete'))
    await userEvent.click(screen.getByTestId('analysis-delete-dialog-confirm'))

    // 等 microtask 让 fetch + state 提交
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })
    const deleteCall = mockFetch.mock.calls.find(
      (c) => {
        if (typeof c[0] !== 'string') return false
        if (!c[0].includes('/analysis/runs/run-s')) return false
        const init = c[1] as { method?: string } | undefined
        return init?.method === 'DELETE'
      },
    )
    expect(deleteCall).toBeTruthy()
  })
})

// ===========================================================================
// 删除成功后焦点回收(issue 05 验收 11)
// ===========================================================================

describe('AnalyzingZone · 删除当前 Run 后焦点回收(issue 05 验收 11)', () => {
  it('删除当前选中的 Run → SSE deleted 事件后切到最新剩余 Run', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-current',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'succeeded',
      }),
      buildRun({
        run_id: 'run-remaining',
        created_at: '2026-08-01T11:00:00.000Z', // 更新 → 当前会选中这个
        status: 'succeeded',
      }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    // 默认 active 是 run-remaining(最新)
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-remaining')
    await openHistoryPanel()

    // 先切到 run-current(触发 userManuallySwitchedRef)
    const curRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-current')!
    await userEvent.click(
      curRow.querySelector('[data-testid="analysis-history-row-select"]') as HTMLElement,
    )
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-current')
    })

    // 模拟 SSE:run-current 被删除
    const es = MockEventSource.instances.at(-1)!
    await act(async () => {
      es.emit('analysis_run_deleted', {
        type: 'analysis_run_deleted',
        reqId: 'req-focus',
        runId: 'run-current',
        ts: Date.now(),
        deletedAt: '2026-08-01T11:30:00.000Z',
        skillName: 'prd-completeness',
        issueCount: 0,
      })
    })

    // 焦点应切到 run-remaining(唯一剩余)
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-remaining')
    })

    // run-current 行已从列表消失
    expect(
      document.querySelector('[data-run-id="run-current"]'),
    ).toBeNull()
  })
})

// ===========================================================================
// Issue 累积:当前 Run 收到 SSE issue 报告时追加(issue 02 / 03)
// ===========================================================================

describe('AnalyzingZone · Issue 累积(issue 02 / 03)', () => {
  it('SSE 推送 analysis_issue_reported → 当前 Run 的 issues 列表追加', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-only', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)

    const es = MockEventSource.instances.at(-1)!
    const issue: AnalysisIssue = {
      issue_id: 'iss-1',
      run_id: 'run-only',
      ordinal: 1,
      title: 'PRD 缺少验收标准',
      description: '当前 PRD 没有给出通过条件。',
      source_refs: [
        { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
      ],
      metadata: [],
      reported_at: '2026-08-01T10:01:00.000Z',
    }
    await act(async () => {
      es.emit('analysis_issue_reported', {
        type: 'analysis_issue_reported',
        reqId: 'req-focus',
        runId: 'run-only',
        ts: Date.now(),
        issue,
      })
    })

    // AnalysisIssueList 显示 1 条
    const list = screen.getByTestId('analysis-issue-list')
    expect(list.getAttribute('data-issue-count')).toBe('1')
    expect(screen.getByText('PRD 缺少验收标准')).toBeInTheDocument()
  })
})

// ===========================================================================
// FAB + 浮动面板(analyzing-fab ticket 01 · ADR-0022 决策 88~98)
//
// 覆盖工单 acceptance:
// - FAB 默认渲染(右上角)+ 显示「🗂️ 历史分析 0」,N=0 时数字呈灰色
// - FAB 不显示运行中 dot,仅显示 N 计数
// - 点 FAB → 面板从 FAB 正下方弹出,默认覆盖在 [识别产物] 列之上
// - 面板头部固定显示「🗂️ 历史分析 0 ✕」,头部右侧 ✕ 按钮可点击
// - N=0 空态:面板内显示「暂无历史 Analysis Run」文案
// - 关闭方式一:点面板头部 ✕ 按钮关闭面板
// - 关闭方式二:点 FAB 面板以外的任意位置关闭面板
// - 关闭方式三:按 Esc 关闭面板
// - FAB `aria-expanded` 同步 false/true
// - FAB `aria-label="历史分析 共 N 个 Run"`
// - 面板 `role="region"` `aria-label="历史分析列表"`
// ===========================================================================

describe('AnalyzingZone · FAB + 浮动面板(analyzing-fab ticket 01)', () => {
  it('FAB 默认渲染 + aria-expanded=false + aria-label 含 N', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-a', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-b', created_at: '2026-08-01T10:00:00.000Z' }),
      buildRun({ run_id: 'run-c', created_at: '2026-08-01T11:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)

    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.getAttribute('aria-expanded')).toBe('false')
    expect(fab.getAttribute('aria-label')).toBe('历史分析 共 3 个 Run')
    expect(fab.getAttribute('data-run-count')).toBe('3')
    // 不显示运行中 dot
    expect(fab.querySelector('[data-testid="analysis-history-fab-running-dot"]')).toBeNull()
    // 默认不渲染面板
    expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
  })

  it('N=0 时 FAB 数字呈灰色(text-3)+ data-empty=true', () => {
    render(<AnalyzingZone data={buildData([])} />)
    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.getAttribute('data-run-count')).toBe('0')
    expect(fab.getAttribute('data-empty')).toBe('true')
    const count = screen.getByTestId('analysis-history-fab-count')
    expect(count.className).toContain('text-text-3')
  })

  it('N>0 时 FAB 数字非灰(text-1)+ data-empty=false', () => {
    const runs: AnalysisRunMeta[] = [buildRun({ run_id: 'run-1' })]
    render(<AnalyzingZone data={buildData(runs)} />)
    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.getAttribute('data-empty')).toBe('false')
    const count = screen.getByTestId('analysis-history-fab-count')
    expect(count.className).toContain('text-text-1')
    expect(count.className).not.toContain('text-text-3')
  })

  it('点 FAB → 打开面板(FAB aria-expanded=true),面板 role=region', async () => {
    const runs: AnalysisRunMeta[] = [buildRun({ run_id: 'run-1' })]
    render(<AnalyzingZone data={buildData(runs)} />)

    await userEvent.click(screen.getByTestId('analysis-history-fab'))

    const panel = await screen.findByTestId('analysis-history-panel')
    expect(panel.getAttribute('role')).toBe('region')
    expect(panel.getAttribute('aria-label')).toBe('历史分析列表')
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('N=0 面板内显示「暂无历史 Analysis Run」', async () => {
    render(<AnalyzingZone data={buildData([])} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const panel = await screen.findByTestId('analysis-history-panel')
    expect(panel.getAttribute('data-run-count')).toBe('0')
    expect(screen.getByTestId('analysis-history-panel-empty').textContent).toBe(
      '暂无历史 Analysis Run',
    )
  })

  it('面板头部显示「🗂️ 历史分析 N ✕」', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-1' }),
      buildRun({ run_id: 'run-2' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const panel = await screen.findByTestId('analysis-history-panel')
    expect(panel.textContent).toContain('历史分析')
    expect(panel.textContent).toContain('2')
    // ✕ 关闭按钮存在
    expect(screen.getByTestId('analysis-history-panel-close')).toBeTruthy()
  })

  it('关闭方式一:点面板头部 ✕ 按钮关闭面板', async () => {
    const runs: AnalysisRunMeta[] = [buildRun({ run_id: 'run-1' })]
    render(<AnalyzingZone data={buildData(runs)} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    await screen.findByTestId('analysis-history-panel')

    await userEvent.click(screen.getByTestId('analysis-history-panel-close'))

    await waitFor(() => {
      expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
    })
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('关闭方式二:点 FAB 面板以外的任意位置关闭面板', async () => {
    const runs: AnalysisRunMeta[] = [buildRun({ run_id: 'run-1' })]
    render(<AnalyzingZone data={buildData(runs)} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    await screen.findByTestId('analysis-history-panel')

    // 点击 stage strip(主区外的另一棵 DOM)
    fireEvent.mouseDown(screen.getByTestId('analyzing-stage-strip'))

    await waitFor(() => {
      expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
    })
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('关闭方式三:按 Esc 关闭面板', async () => {
    const runs: AnalysisRunMeta[] = [buildRun({ run_id: 'run-1' })]
    render(<AnalyzingZone data={buildData(runs)} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    await screen.findByTestId('analysis-history-panel')

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
    })
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('点面板内区域不会关闭面板(只点外面才关)', async () => {
    const runs: AnalysisRunMeta[] = [buildRun({ run_id: 'run-1' })]
    render(<AnalyzingZone data={buildData(runs)} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const panel = await screen.findByTestId('analysis-history-panel')

    // 在面板内任意位置 mousedown(应被忽略)
    fireEvent.mouseDown(panel)

    // 面板仍在
    expect(screen.getByTestId('analysis-history-panel')).toBeTruthy()
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('点 FAB 再次点 FAB 切换关闭', async () => {
    const runs: AnalysisRunMeta[] = [buildRun({ run_id: 'run-1' })]
    render(<AnalyzingZone data={buildData(runs)} />)
    const fab = screen.getByTestId('analysis-history-fab')

    await userEvent.click(fab)
    await screen.findByTestId('analysis-history-panel')
    expect(fab.getAttribute('aria-expanded')).toBe('true')

    await userEvent.click(fab)
    await waitFor(() => {
      expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
    })
    expect(fab.getAttribute('aria-expanded')).toBe('false')
  })

  it('桌面布局不再渲染永久 analyzing-history-col 列', () => {
    const runs: AnalysisRunMeta[] = [buildRun({ run_id: 'run-1' })]
    render(<AnalyzingZone data={buildData(runs)} />)
    expect(document.querySelector('[data-testid="analyzing-history-col"]')).toBeNull()
    // grid 列数减为 [2fr_1fr]
    const grid = screen.getByTestId('analyzing-grid')
    expect(grid.className).toContain('lg:grid-cols-[2fr_1fr]')
  })
})

// ===========================================================================
// 面板内 Run 列表 + 选 Run 切 currentRun + 自动关闭
// (analyzing-fab ticket 02 · ADR-0022 决策 88~98)
//
// ticket 02 在 ticket 01 骨架上叠加的 UX:
// - 列表渲染 + 行内容字段(状态 dot / 时间 / Skill 名 / Skill 简介 / Issue
//   计数 / 删除按钮)
// - 当前选中 Run 行 aria-current="true" + bg-brand-50/40 高亮
// - 点 Run 行 → 父组件切 Run + 面板自动关闭(Linear popover 心智「选中即走」)
// - 头部 N 计数实时跟随 Run 总数
// ===========================================================================

import type { AnalysisSkillMeta } from '@ai-devspace/shared'

/**
 * ticket 02 用的扩展 fixture —— 在 runs 之外再注入可用的 Skill 元数据,
 * 用于验证面板能展示 Skill 简介。`selectedSkillName` 默认取首项,保证父组
 * 件能进入主区(非空态)。
 */
function buildFabPanelData(
  runs: AnalysisRunMeta[],
  skills: AnalysisSkillMeta[] = [],
): AnalyzingData {
  return {
    ...emptyAnalyzing('req-focus'),
    empty: false,
    prdMarkdown: '# 测试 PRD\n',
    runs,
    availableSkills: skills,
    selectedSkillName: skills[0]?.name ?? '',
  }
}

function buildSkill(name: string, description: string): AnalysisSkillMeta {
  return { name, description, version: '1.0.0', is_reserved: true }
}

describe('AnalyzingZone · 历史面板 Run 列表 + 选 Run 切 currentRun + 自动关闭(analyzing-fab ticket 02)', () => {
  it('面板内渲染 Run 列表(按 created_at 倒序,父组件 AnalyzingZone 已排好,面板不再排序)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'r-mid', created_at: '2026-08-01T09:00:00.000Z' }),
      buildRun({ run_id: 'r-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // 行数 = 3
    const rows = screen.getAllByTestId('analysis-history-row')
    expect(rows).toHaveLength(3)

    // 倒序:r-new > r-mid > r-old
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual([
      'r-new',
      'r-mid',
      'r-old',
    ])

    // 头部 N 与 data-run-count 一致
    const panel = screen.getByTestId('analysis-history-panel')
    expect(panel.getAttribute('data-run-count')).toBe('3')
    expect(screen.getByTestId('analysis-history-panel-count').textContent).toBe('3')
  })

  it('每行包含:状态 dot / 开始时间 / Skill 名 / Skill 简介 / Issue 计数', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'r-mid',
        created_at: '2026-08-01T09:00:00.000Z',
        skill_name: 'bar-skill',
        status: 'failed',
        issue_count: 1,
      }),
    ]
    render(
      <AnalyzingZone
        data={buildFabPanelData(runs, [
          buildSkill('bar-skill', '检查 PRD 中段是否覆盖业务边界'),
        ])}
      />,
    )
    await openHistoryPanel()

    const row = screen.getByTestId('analysis-history-row')
    // 状态 dot 存在 + 状态文案
    expect(row.querySelector('[data-testid="analysis-history-row-status-dot"]')).toBeTruthy()
    expect(row.querySelector('[data-testid="analysis-history-row-status"]')?.textContent).toBe(
      '失败',
    )
    // 开始时间存在(只验证非空,具体时区避免对运行机器过分依赖)
    expect(
      (row.querySelector('[data-testid="analysis-history-row-time"]')?.textContent ?? '').length,
    ).toBeGreaterThan(0)
    // Skill 名
    expect(row.querySelector('[data-testid="analysis-history-row-skill"]')?.textContent).toBe(
      'bar-skill',
    )
    // Skill 简介 — `data-skill-description` 凭 HistoryRow 渲染(此处文本断言)
    expect(row.textContent).toContain('检查 PRD 中段是否覆盖业务边界')
    // Issue 计数
    expect(
      row.querySelector('[data-testid="analysis-history-row-issue-count"]')?.textContent,
    ).toBe('📝 1 Issue')
  })

  it('运行中 Run 行 🔒 disabled(不渲染删除按钮);终态 Run 行 🗑️ 可点删除', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-running', status: 'running' }),
      buildRun({ run_id: 'r-done', status: 'succeeded' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    const runningRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'r-running')!
    expect(runningRow.querySelector('[data-testid="analysis-history-row-delete"]')).toBeNull()
    expect(
      runningRow.querySelector('[data-testid="analysis-history-row-delete-disabled"]'),
    ).toBeTruthy()
    expect(runningRow.getAttribute('data-run-status')).toBe('running')

    const doneRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'r-done')!
    expect(doneRow.querySelector('[data-testid="analysis-history-row-delete"]')).toBeTruthy()
    expect(doneRow.querySelector('[data-testid="analysis-history-row-delete-disabled"]')).toBeNull()
    expect(doneRow.getAttribute('data-run-status')).toBe('succeeded')
  })

  it('Issue 计数 = 0 时仍渲染「📝 0 Issues」(不简化成空)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-zero', status: 'succeeded', issue_count: 0 }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    const row = screen.getByTestId('analysis-history-row')
    expect(row.querySelector('[data-testid="analysis-history-row-issue-count"]')?.textContent).toBe(
      '📝 0 Issues',
    )
  })

  it('当前选中 Run 行 aria-current="true" + bg-brand-50/40 高亮', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'r-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // 默认 active = r-new(最新)
    const activeRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'r-new')!
    expect(activeRow.getAttribute('aria-current')).toBe('true')
    expect(activeRow.getAttribute('data-active')).toBe('true')
    expect(activeRow.className).toContain('bg-brand-50/40')

    // 非 active 行:aria-current 不设置(React 把 undefined 整属性剔掉)
    const inactiveRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'r-old')!
    expect(inactiveRow.getAttribute('aria-current')).toBeNull()
    expect(inactiveRow.className).not.toContain('bg-brand-50/40')
  })

  it('点 Run 行 → 切 currentRun + 面板自动关闭(FAB aria-expanded 同步 false)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'r-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // 默认 active 是 r-new
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('r-new')

    // 点 r-old 行
    const oldRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'r-old')!
    await userEvent.click(
      oldRow.querySelector('[data-testid="analysis-history-row-select"]') as HTMLElement,
    )

    // 1) currentRun 切到 r-old(FAB data-active-run-id 变化)
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('r-old')
    })

    // 2) 面板自动关闭(Linear popover 心智「选中即走」)
    await waitFor(() => {
      expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
    })
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('点删除按钮不会关闭面板(只点行主体才关)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-done', status: 'succeeded' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // 点删除按钮(不应触发 onSelect → 不关闭面板)
    await userEvent.click(screen.getByTestId('analysis-history-row-delete'))
    expect(screen.getByTestId('analysis-history-panel')).toBeTruthy()
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe('true')

    // 二次确认对话框也已弹起
    expect(screen.getByTestId('analysis-delete-dialog')).toBeTruthy()
  })

  it('头部 N 计数实时跟随 Run 总数(SSE 追加 Run 后从 3 变 4)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'r-mid', created_at: '2026-08-01T09:00:00.000Z' }),
      buildRun({ run_id: 'r-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // 初始 N=3
    expect(screen.getByTestId('analysis-history-panel').getAttribute('data-run-count')).toBe('3')
    expect(screen.getByTestId('analysis-history-panel-count').textContent).toBe('3')

    // SSE 追加新 Run
    const es = MockEventSource.instances.at(-1)!
    await act(async () => {
      es.emit('analysis_run_created', {
        type: 'analysis_run_created',
        reqId: 'req-focus',
        runId: 'r-fresh',
        ts: Date.now(),
        skillName: 'fresh-skill',
        createdAt: '2026-08-01T11:00:00.000Z',
      })
    })

    // N 实时跟进到 4(数据流:AnalyzingZone setRuns 触发 AnalyzeSoneSone 渲染,
    // FAB / 面板从 runs.length 读出)
    await waitFor(() => {
      expect(screen.getByTestId('analysis-history-panel').getAttribute('data-run-count')).toBe(
        '4',
      )
    })
    expect(screen.getByTestId('analysis-history-panel-count').textContent).toBe('4')
    // FAB 上的 N 也同步
    expect(screen.getByTestId('analysis-history-fab').getAttribute('data-run-count')).toBe('4')
  })

  it('选中后父组件切到该 Run 的识别产物列(切 Run 行 → 主视图绑定的 Run 数据流刷新)', async () => {
    // ticket 02 契约第 3 条:点 Run 行后,父组件 AnalyzingZone 的识别产物列
    // (= AnalysisIssueList)切到该 Run 的 Issue 内容。
    // 既有的 useEffect(currentRunId ...) 会拉对应 Run 的详情,所以这里断言:
    // ① 切 Run 后 data-active-run-id 切到目标
    // ② AnalysisIssueList 的「当前 Run 绑定」随 currentRunId 重渲 —— 现存
    //   implementation 通过 fetch Agent GET .../runs/<id> → 拿 issues → 写入
    //   currentRunIssues。本测试用 mockFetch 拦截。
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'r-old',
        created_at: '2026-08-01T08:00:00.000Z',
        status: 'succeeded',
        issue_count: 1,
      }),
      buildRun({ run_id: 'r-new', created_at: '2026-08-01T10:00:00.000Z', status: 'running' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // 切到 r-old
    const oldRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'r-old')!
    await userEvent.click(
      oldRow.querySelector('[data-testid="analysis-history-row-select"]') as HTMLElement,
    )

    // FAB data-active-run-id 切到 r-old(原 issue 05 验收 5 行为持续保持)
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('r-old')
    })

    // 切 Run 后父组件应发 GET .../runs/r-old(由 useEffect 触发);
    // mockFetch 已被 test fixture 接管,call list 顺序与 URL 可被断言
    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c) => String(c[0]))
      expect(
        calls.some((url) => url.includes('/analysis/runs/r-old')),
      ).toBe(true)
    })
  })
})

// ===========================================================================
// 删除 UX 重新设计(analyzing-fab ticket 03 · ADR-0022 D5.1)
//
// ticket 02 时的旧规则(issue 05 决策 36):删除后「不切走焦点」= 切走焦点
// 的反面。当前 ticket 03 重设:删除 Run 后「面板保留打开 + currentRun
// 自动切到下一个 Run」(按 created_at 倒序的第一个非删除 Run)。
//
// 覆盖工单 acceptance:
// - 删除当前选中 Run → 面板仍开 + currentRun 切到下一个
// - 删除非当前选中 Run → 面板仍开 + currentRun 不变
// - 删除最后一个 Run → 面板仍开 + 显示 N=0 空态
// - 删除运行中 Run → 被 UI 拒绝(无 DELETE 调用,沿用 ticket 02 的 row-delete
//   缺席 + ticket 01 的 canDeleteAnalysisRun 入口)
// - 本标签乐观删除后,SSE analysis_run_deleted 推回同 runId 不再二次切
//   currentRun(避免乐观更新与 SSE 切换双切换竞态)
// ===========================================================================

describe('AnalyzingZone · 删除 UX 重设(ticket 03 · ADR-0022 D5.1)', () => {
  it('删除当前选中的 Run → 面板仍打开 + currentRun 切到下一个', async () => {
    // 构造默认 active = run-current(最新)以便「删当前」是默认态,无需先点
    // 行 select —— ticket 02 设计「点 row → 切 + 关面板」,若先点 select 会
    // 关闭面板让本测试看到的不是 ticket 03 验收点本身。
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-remaining',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'succeeded',
      }),
      buildRun({
        run_id: 'run-current',
        created_at: '2026-08-01T12:00:00.000Z', // 最新 → 默认 active
        status: 'succeeded',
      }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    // 默认 active = run-current(最新),不再「点 row select」
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-current')
    await openHistoryPanel()

    // 删当前 run-current
    const curRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-current')!
    await userEvent.click(
      curRow.querySelector('[data-testid="analysis-history-row-delete"]') as HTMLElement,
    )
    expect(screen.getByTestId('analysis-delete-dialog')).toBeTruthy()
    await userEvent.click(screen.getByTestId('analysis-delete-dialog-confirm'))

    // 等 microtask 让 fetch + state 提交
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })

    // ticket 03 · 验收 1:面板仍打开(非「切走焦点」)
    expect(screen.getByTestId('analysis-history-panel')).toBeTruthy()

    // ticket 03 · 验收 1:currentRun 自动切到下一个 — 即 run-remaining
    // (只剩这一个了)
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-remaining')
    })

    // data-run-count 应实时跟到 1(从 2 变 1)
    expect(
      screen.getByTestId('analysis-history-panel').getAttribute('data-run-count'),
    ).toBe('1')

    // 二次确认对话框已关闭
    expect(screen.queryByTestId('analysis-delete-dialog')).toBeNull()
  })

  it('删除非当前选中的 Run → 面板仍打开 + currentRun 不变', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-old',
        created_at: '2026-08-01T08:00:00.000Z',
        status: 'succeeded',
      }),
      buildRun({
        run_id: 'run-active',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'succeeded',
      }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    // 默认 active = run-active(最新)
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-active')
    await openHistoryPanel()

    // 删 run-old(非 active)
    const oldRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-old')!
    await userEvent.click(
      oldRow.querySelector('[data-testid="analysis-history-row-delete"]') as HTMLElement,
    )
    await userEvent.click(screen.getByTestId('analysis-delete-dialog-confirm'))

    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })

    // ticket 03 · 验收 2:面板仍打开
    expect(screen.getByTestId('analysis-history-panel')).toBeTruthy()

    // ticket 03 · 验收 2:currentRun 不变(run-active)
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-active')
    })

    // data-run-count 从 2 → 1
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-panel').getAttribute('data-run-count'),
      ).toBe('1')
    })

    // run-old 行已从面板列表消失
    expect(
      document.querySelector('[data-run-id="run-old"]'),
    ).toBeNull()
  })

  it('删除最后一个 Run → 面板仍打开 + 显示 N=0 空态', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-only',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'succeeded',
      }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-only')
    await openHistoryPanel()

    // 删唯一 Run
    const onlyRow = screen.getByTestId('analysis-history-row')
    await userEvent.click(
      onlyRow.querySelector('[data-testid="analysis-history-row-delete"]') as HTMLElement,
    )
    await userEvent.click(screen.getByTestId('analysis-delete-dialog-confirm'))

    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })

    // ticket 03 · 验收 3:面板仍打开(由 ticket 07 联合兜底 N=0 空态)
    expect(screen.getByTestId('analysis-history-panel')).toBeTruthy()

    // data-run-count = 0,空态文案出现
    await waitFor(() => {
      expect(screen.getByTestId('analysis-history-panel-empty')).toBeTruthy()
    })
    expect(screen.getByTestId('analysis-history-panel').getAttribute('data-run-count')).toBe(
      '0',
    )
    expect(screen.getByTestId('analysis-history-panel-empty').textContent).toBe(
      '暂无历史 Analysis Run',
    )

    // currentRunId 重置为 ''(由父组件后续回退到「无 Run」空态)
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('')

    // FAB 的 data-empty / data-run-count 同步
    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.getAttribute('data-run-count')).toBe('0')
    expect(fab.getAttribute('data-empty')).toBe('true')
  })

  it('删除运行中 Run → 被 UI 拒绝,无 DELETE 调用', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-running',
        status: 'running',
        created_at: '2026-08-01T10:00:00.000Z',
      }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // ticket 02 已断言:running Row 上无 delete 按钮(只有 disabled 占位)
    const row = screen.getByTestId('analysis-history-row')
    expect(row.querySelector('[data-testid="analysis-history-row-delete"]')).toBeNull()

    // 等任何潜在 fetch + state
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })

    // ticket 03 · 验收 4:无 DELETE 调用(沿用 canDeleteAnalysisRun 入口拒绝)
    const deleteCall = mockFetch.mock.calls.find((c) => {
      if (typeof c[0] !== 'string') return false
      if (!c[0].includes('/analysis/runs/')) return false
      const init = c[1] as { method?: string } | undefined
      return init?.method === 'DELETE'
    })
    expect(deleteCall).toBeUndefined()

    // 面板仍打开 + active 不变
    expect(screen.getByTestId('analysis-history-panel')).toBeTruthy()
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-running')
  })

  it('本标签乐观删除后,SSE analysis_run_deleted 推回同 runId 不二次切 currentRun', async () => {
    // ticket 03 · 隐含验收:本标签的删除走乐观更新(handleConfirmDelete),
    // SSE 后续推 analysis_run_deleted(同 runId)由本标签接收,撞到
    // optimisticallyDeletedRunIdRef → 跳过 currentRun 切换。否则可能出现
    // 「乐观切到 run-remaining,SSE 又把它切到别的 Run」的二次切换竞态。
    //
    // 该场景是 ticket 03 验收第 6 条的「双切换竞态」防线。
    //
    // 与场景 1 同样默认 active 设计:让默认 active 就是要删的那个 Run,避免
    // ticket 02「点 row 关面板」行为干扰本测试。
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-other-a',
        created_at: '2026-08-01T08:00:00.000Z',
        status: 'succeeded',
      }),
      buildRun({
        run_id: 'run-remaining',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'succeeded',
      }),
      buildRun({
        run_id: 'run-current',
        created_at: '2026-08-01T12:00:00.000Z', // 最新 → 默认 active
        status: 'succeeded',
      }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    // 默认 active = run-current(最新)
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-current')
    await openHistoryPanel()

    // 删当前 run-current
    const curRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-current')!
    await userEvent.click(
      curRow.querySelector('[data-testid="analysis-history-row-delete"]') as HTMLElement,
    )
    await userEvent.click(screen.getByTestId('analysis-delete-dialog-confirm'))
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })

    // 乐观切到下一个(run-remaining,created_at 最大的剩余 Run)
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-remaining')
    })

    // 模拟 SSE:服务端推 analysis_run_deleted(同一 runId)—— 本标签接收
    const es = MockEventSource.instances.at(-1)!
    await act(async () => {
      es.emit('analysis_run_deleted', {
        type: 'analysis_run_deleted',
        reqId: 'req-focus',
        runId: 'run-current',
        ts: Date.now(),
        deletedAt: '2026-08-01T11:30:00.000Z',
        skillName: 'prd-completeness',
        issueCount: 0,
      })
    })

    // ticket 03 · 验收 6:currentRun 仍是 run-remaining(SSE 不二次切)
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-remaining')

    // runs 列表里 run-current 已不在(既被乐观 filter 也被 SSE filter 再次去重)
    expect(document.querySelector('[data-run-id="run-current"]')).toBeNull()
  })
})

// ===========================================================================
// 切上下文强制收起(analyzing-fab ticket 05 · ADR-0022 决策 96~98)
//
// 决策 24「克制,在场」的「克制」语义在本 ticket 落地:
//   - FAB 面板开合 state 不持久化(完全不写 cookie / localStorage /
//     sessionStorage),仅由 AnalyzingContent 内的 useState 持有
//   - 切到其他 Requirement → AnalyzingContent 因 key/路由变化
//     unmount → remount → 新 mount 时 isHistoryPanelOpen=false(默认)
//   - 切到其他工位 → 沿用 unmount → remount 机制,同上
//   - 启动新 Analysis Run(handleStart 成功路径)→ FAB 强制收起 + 焦点
//     切新 Run,沿用既有 userManuallySwitchedRef = false 重置
//   - 启动新 Run 失败的 toast 提示不影响 FAB 面板开合(若开则仍开,
//     若关则仍关)
// ===========================================================================

/**
 * ticket 05 用的扩展 fixture —— 注入至少一个可用 Skill,让父组件
 * `handleStart` 通过前置校验(data.availableSkills 非空 +
 * `currentSelectedSkill` 已选,后者取首项)。
 */
function buildFabStartData(
  runs: AnalysisRunMeta[],
  requirementId = 'req-focus',
  skills: AnalysisSkillMeta[] = [buildSkill('prd-completeness', '检查 PRD 完整性')],
): AnalyzingData {
  return {
    ...emptyAnalyzing(requirementId),
    empty: false,
    prdMarkdown: '# 测试 PRD\n',
    runs,
    availableSkills: skills,
    selectedSkillName: skills[0]?.name ?? '',
  }
}

/**
 * 让 mockFetch 对 POST `/analysis/start` 返一条「成功」响应。其它 URL
 * 沿用 jest 默认 { ok: true, status: 204, json: ... },不打扰既有用例。
 */
function queueAnalysisStartSuccess(
  runId: string,
  requirementId: string,
  skillName: string,
  createdAt: string,
): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 201,
    json: async () => ({
      run_id: runId,
      requirement_id: requirementId,
      skill_name: skillName,
      created_at: createdAt,
      status: 'running',
    }),
  })
}

/**
 * 让 mockFetch 对 POST `/analysis/start` 返一条「失败」响应(与
 * `agent-client.AgentError` 兼容的 4xx)。状态码与 body 由调用方决定,
 * 默认 409 + `analysis_run_already_running`,与 issue 02 既有契约一致。
 */
function queueAnalysisStartFailure(
  status = 409,
  body: { error: string } = { error: 'analysis_run_already_running' },
): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => body,
  })
}

describe('AnalyzingZone · 切上下文强制收起(analyzing-fab ticket 05 · 决策 96~98)', () => {
  /**
   * 内层 wrapper —— 在 React 树外再压一层 `<AnalyzingZone key=...>`,模拟
   * 「父路由层 key 因 `requirementId` 变化而重置」的真实场景。React 看到
   * key 变化 → unmount → remount,父组件 `AnalyzingContent` 内的
   * `useState<boolean>(false)` 自然回到初始值。
   *
   * 直接 `rerender(<AnalyzingZone data={...} />)` 不会重置 state(state 由
   * 同一个 component instance 持有),所以 ticket 05 的「unmount → remount」
   * 契约必须用 key 模拟。
   */
  function AnalyzingZoneByRequirement({
    requirementId,
    runs,
  }: {
    requirementId: string
    runs: AnalysisRunMeta[]
  }) {
    return <AnalyzingZone key={requirementId} data={buildFabStartData(runs, requirementId)} />
  }

  it('切到其他 Requirement(unmount → remount)→ 新 mount 的 FAB 默认折叠', () => {
    // ticket 05 验收第 2 条:`AnalyzingZone` 父组件因 key/路由变化 unmount
    // → remount → 新 mount 时 `isHistoryPanelOpen` 从 `useState<boolean>(false)`
    // 重置为默认折叠。本测试通过 key prop 强制 remount 模拟这一场景。
    const runsReqA: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-a', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-b', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    const runsReqB: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-x', created_at: '2026-08-01T11:00:00.000Z' }),
    ]
    const { rerender } = render(
      <AnalyzingZoneByRequirement requirementId="req-A" runs={runsReqA} />,
    )

    // req-A 阶段:确认 FAB 默认折叠 + aria-expanded=false + 无 panel
    const fabA = screen.getByTestId('analysis-history-fab')
    expect(fabA.getAttribute('aria-expanded')).toBe('false')
    expect(fabA.getAttribute('data-active-run-id')).toBe('run-b')
    expect(screen.queryByTestId('analysis-history-panel')).toBeNull()

    // 切到 req-B:key 变化 → unmount → remount,`isHistoryPanelOpen` 重置为 false
    rerender(<AnalyzingZoneByRequirement requirementId="req-B" runs={runsReqB} />)

    // ticket 05 验收第 2 / 5 条:新 mount 的 FAB 默认折叠
    const fabB = screen.getByTestId('analysis-history-fab')
    expect(fabB.getAttribute('aria-expanded')).toBe('false')
    expect(fabB.getAttribute('data-active-run-id')).toBe('run-x')
    expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
  })

  it('切到其他 Requirement 之前打开的 panel,在新 mount 后不再保留(state 不持久化)', async () => {
    // ticket 05 验收第 1 条:FAB 面板开合 state 不持久化。切 Requirement
    // 之前手动打开的 panel,不应在新 Requirement 的 mount 上仍打开。
    const runsA: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-a', created_at: '2026-08-01T08:00:00.000Z' }),
    ]
    const { rerender } = render(
      <AnalyzingZoneByRequirement requirementId="req-A" runs={runsA} />,
    )

    // req-A 阶段打开 panel(用户操作历史语境)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    await screen.findByTestId('analysis-history-panel')
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'true',
    )

    // 切到 req-B(不同 requirementId):key 变 → unmount → remount
    const runsB: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-b1', created_at: '2026-08-01T11:00:00.000Z' }),
    ]
    rerender(<AnalyzingZoneByRequirement requirementId="req-B" runs={runsB} />)

    // ticket 05 验收第 1 条:state 不持久化 —— 新 mount 上 panel 默认关闭
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
  })

  it('启动新 Run(handleStart 成功)→ FAB 收起 + 焦点切新 Run', async () => {
    // ticket 05 验收第 4 条:启动新 Run 成功 → FAB 面板强制收起 +
    // 焦点切到新 Run(沿用既有 userManuallySwitchedRef = false 重置)。
    // - 不打开 panel —— button click 触发 mousedown 关闭逻辑(无论成功
    //   失败都会关闭),故此测试简化为「panel 默认折叠 → 启动 → 仍折叠」
    //   观察。
    // - 焦点切到 run-fresh + count 推进到 3 是 `handleStart` 既有行为,
    //   ticket 05 顺带对焦点切新 Run 一并断言,确保本 ticket 联动的
    //   `userManuallySwitchedRef = false` 与 `setCurrentRunId` 没被破坏。
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-cur', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabStartData(runs)} />)

    // ticket 05 起始状态:panel 默认折叠
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )

    // 让 mockFetch 对 POST /analysis/start 返成功;其他 URL 沿用 jest 默认
    queueAnalysisStartSuccess(
      'run-fresh',
      'req-focus',
      'prd-completeness',
      '2026-08-01T12:00:00.000Z',
    )

    // 点 [▶ 开始分析]:handleStart 成功路径应乐观追加新 Run + 切到 run-fresh
    await userEvent.click(screen.getByTestId('analysis-run-start-btn'))

    // 等 microtask 让 fetch + state 提交
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })

    // ticket 05 验收第 4 条:handleStart 成功后 FAB 面板仍折叠
    // (默认 false + outside-click + 我新加的 setIsHistoryPanelOpen(false)
    // 共同兜底 —— 但最重要的 contract 是「成功路径不会让 panel 从 false
    // 变成 true」,改回 false 是失败兜底)。
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(screen.queryByTestId('analysis-history-panel')).toBeNull()

    // 焦点切到新 Run
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-fresh')
    })

    // data-run-count 从 2 → 3
    expect(screen.getByTestId('analysis-history-fab').getAttribute('data-run-count')).toBe(
      '3',
    )
  })

  it('启动新 Run 成功 → 从「FAB 召唤出 panel」的状态点 [▶ 开始分析] → panel 被强制收起', async () => {
    // ticket 05 验收第 4 条反向:用户先点 FAB 召唤出 panel(在历史语境里)→
    // 在 panel 打开的当口点 [▶ 开始分析]。此时 panel 上的 outside-click
    // handler 已经把 panel 关掉(ticket 01 的关闭方式二),handleStart 成功
    // 路径的 `setIsHistoryPanelOpen(false)` 是「保证最终状态 = false」的
    // 兜底 —— 本断言主要观察:整个流程走完后 panel 一定是关的 + 焦点切到
    // 新 Run。这条把 outside-click + ticket 05 新加 reset 的双保险合在
    // 一起验证。
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-cur', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabStartData(runs)} />)
    await openHistoryPanel()

    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'true',
    )

    queueAnalysisStartSuccess(
      'run-fresh',
      'req-focus',
      'prd-completeness',
      '2026-08-01T12:00:00.000Z',
    )

    // 在 panel 打开的当口点 [▶ 开始分析](在 panel/fab 外 → 触发 outside-click 关闭)
    await userEvent.click(screen.getByTestId('analysis-run-start-btn'))

    // 等 microtask
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })

    // 最终:panel 仍关 + 焦点切到新 Run + 计数 +1
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
      ).toBe('run-fresh')
    })
    expect(screen.getByTestId('analysis-history-fab').getAttribute('data-run-count')).toBe(
      '3',
    )
  })

  it('启动新 Run 失败 → FAB 面板开合不受影响(只弹 toast)', async () => {
    // ticket 05 验收第 5 条:启动失败 → FAB 面板开合不受影响。
    // 失败路径不调用 `setIsHistoryPanelOpen`,所以 handleStart 失败不
    // 是「关 panel」也不是「开 panel」的诱因。本测试覆盖「面板已关 →
    // 失败后面板仍关」(「若面板已关,保持关」half)。
    //
    // 关于「面板已开 → 失败后面板仍开」半句:在真实 UX 里 [▶ 开始分析]
    // 按钮在 panel 外,无论成功失败都会触发 outside-click mousedown 关闭
    // panel;但 ticket 05 接受契约是「handleStart 失败路径不写 panel
    // state」,本条通过对失败路径上「count + activeRunId 都没动」的副
    // 断言间接守护。
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-cur', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabStartData(runs)} />)

    // 起始:panel = 关(count = 2,active = run-cur)
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-cur')
    expect(screen.getByTestId('analysis-history-fab').getAttribute('data-run-count')).toBe('2')

    // 让 start 失败:409 + analysis_run_already_running
    queueAnalysisStartFailure()

    // 点 [▶ 开始分析]:handleStart 应 catch AgentError → pushToast → return
    await userEvent.click(screen.getByTestId('analysis-run-start-btn'))

    // 等 microtask 让 fetch + state 提交
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })

    // ticket 05 验收第 5 条「若面板已关,保持关」:panel 仍关
    expect(screen.getByTestId('analysis-history-fab').getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(screen.queryByTestId('analysis-history-panel')).toBeNull()

    // 焦点不变(还是 run-cur,handleStart 失败没切 Run)
    expect(
      screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id'),
    ).toBe('run-cur')

    // data-run-count 不变(2)
    expect(screen.getByTestId('analysis-history-fab').getAttribute('data-run-count')).toBe(
      '2',
    )

    // toast 已弹(由 pushToast 写入,这里只断言 toast-host 出现)
    expect(screen.getByTestId('toast-host')).toBeTruthy()

    // 等任何潜在 toast 后再断言 button 回到 idle(spinner 消失,文案「开始分析」)
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-run-start-btn').getAttribute('data-state'),
      ).toBe('idle')
    })
  })

  it('FAB 面板开合 state 不写 cookie / localStorage / sessionStorage', async () => {
    // ticket 05 验收第 1 条的「完全不持久化」语义。在 jsdom 内 stub
    // localStorage.setItem / sessionStorage.setItem / document.cookie
    // setter,任何 panel 开合都不应触发这些 sink。
    const localSet = vi.fn()
    const sessionSet = vi.fn()
    const originalLS = window.localStorage
    const originalSS = window.sessionStorage
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { setItem: localSet, getItem: () => null, removeItem: vi.fn() },
    })
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: { setItem: sessionSet, getItem: () => null, removeItem: vi.fn() },
    })
    // cookie setter 用 property descriptor 拦截
    const originalCookieDesc = Object.getOwnPropertyDescriptor(document, 'cookie')
    let cookieWriteAttempts = 0
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        return ''
      },
      set() {
        cookieWriteAttempts++
      },
    })

    try {
      const runs: AnalysisRunMeta[] = [
        buildRun({ run_id: 'run-1', created_at: '2026-08-01T08:00:00.000Z' }),
      ]
      render(<AnalyzingZone data={buildFabStartData(runs)} />)

      // 1) 打开 panel
      await userEvent.click(screen.getByTestId('analysis-history-fab'))
      await screen.findByTestId('analysis-history-panel')
      // 2) 关闭 panel
      await userEvent.click(screen.getByTestId('analysis-history-panel-close'))
      await waitFor(() => {
        expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
      })

      // ticket 05 验收第 1 条:任何 panel 操作都不应触发持久化 sink
      expect(localSet).not.toHaveBeenCalled()
      expect(sessionSet).not.toHaveBeenCalled()
      expect(cookieWriteAttempts).toBe(0)
    } finally {
      // restore
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: originalLS,
      })
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: originalSS,
      })
      if (originalCookieDesc) {
        Object.defineProperty(document, 'cookie', originalCookieDesc)
      }
    }
  })
})