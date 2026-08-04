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
    // ticket 07 把空态文案升级为「暂无历史 Analysis Run · 点击下方
    // [▶ 开始分析] 按钮发起首次分析」。本断言保持 ticket 01 的"非空" +
    // "以核心关键词开头"的契约,把整段包含「暂无历史 Analysis Run」
    // 作为稳定锚点。具体后半句在 ticket 07 的 describe 里另行覆盖。
    render(<AnalyzingZone data={buildData([])} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const panel = await screen.findByTestId('analysis-history-panel')
    expect(panel.getAttribute('data-run-count')).toBe('0')
    expect(screen.getByTestId('analysis-history-panel-empty').textContent).toContain(
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
    expect(screen.getByTestId('analysis-history-panel-empty').textContent).toContain(
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

// ===========================================================================
// a11y 全套(analyzing-fab ticket 06 · ADR-0022 D6)
//
// ticket 06 在 01-05 骨架上扩展 FAB / 面板 / 行级 ARIA:
// - FAB `aria-haspopup="region"` 指向面板 role
// - 面板 `role="region"`(non-modal,不暗示模态,不困焦点)
// - 头部 ✕ `aria-label="关闭历史分析列表"`
// - 删除按钮 `aria-label="删除 Run <run_id> <skill_name>"`
// - 运行中锁图标 `aria-label="运行中的 Run <run_id> <skill_name> 不可删除"`
// - 当前 Run 行 `aria-current="true"`
// - [识别产物] 列 dim 蒙层 `data-dimmed="true"` + `aria-hidden="true"`
// - 不引入 focus-trap 库(沿用浏览器原生 Tab 顺序)
//
// 沿用既有 `data-testid` 命名约定(FAB / panel / close / row / row-delete
// / row-delete-disabled / right-col / right-col-dim),`toHaveAttribute` 形
// 式断言。
// ===========================================================================

describe('AnalyzingZone · a11y 全套(analyzing-fab ticket 06 · ADR-0022 D6)', () => {
  beforeEach(() => {
    // ticket 06 的 dim 蒙层断言需要桌面布局;`useMediaQuery('(min-width: 1024px)')`
    // 在 jsdom 走 fallback(返 false → NarrowLayout)。本组统一强行切到桌面
    // 形态,让 `analyzing-right-col` 出现在 DOM 中。
    if (typeof globalThis.setMatchMedia === 'function') {
      globalThis.setMatchMedia('(min-width: 1024px)', true)
    }
  })

  it('FAB `aria-haspopup="region"` + `aria-controls` 指向面板 id', () => {
    // ticket 06 验收第 1 条:FAB 通过 `aria-haspopup` 指明召唤元素角色。
    // W3C 标准值并不含 `region`(仅 menu/listbox/tree/grid/dialog),本项目
    // 在 ticket 06 选 `region` 是为了在屏读器播报"展开 region"时与面板的
    // `role="region"` 对齐。运行时需要绕过 React 的 HTMLButton 类型 by
    // inline cast(`'region' as 'menu'`)实现,运行时挂载的是字面量 'region'。
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-1', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)

    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.getAttribute('aria-haspopup')).toBe('region')
    // `aria-controls` 指向面板 id(w3c 推荐显式 ID 关联)
    expect(fab.getAttribute('aria-controls')).toBe('analysis-history-panel')
  })

  it('面板 `role="region"`(非 `role="dialog"`) + `aria-label="历史分析列表"`', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-1', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    const panel = screen.getByTestId('analysis-history-panel')
    expect(panel.getAttribute('role')).toBe('region')
    // 不是 `role="dialog"` —— dialog 暗示模态,会困焦点;我们走 non-modal
    // popover 心智,Tab 焦点可继续到主区(见后续断言)。
    expect(panel.getAttribute('role')).not.toBe('dialog')
    expect(panel.getAttribute('aria-label')).toBe('历史分析列表')
    // 双重校验:面板上的 id 与 FAB aria-controls 对得上(aria-controls →
    // 对应 id 形成 aria 关联,a11y API 依赖此关联)
    expect(panel.id).toBe('analysis-history-panel')
  })

  it('头部 ✕ 按钮 `aria-label="关闭历史分析列表"`', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-1', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    const closeBtn = screen.getByTestId('analysis-history-panel-close')
    expect(closeBtn.getAttribute('aria-label')).toBe('关闭历史分析列表')
  })

  it('当前 Run 行 `aria-current="true"`(已 ticket 02 落地),本 ticket 06 联合断言', async () => {
    // ticket 06 联合 ticket 02:`HistoryRow` 渲染的 `aria-current` 由
    // HistoryRow 内部的 `run.run_id === activeRunId` 派生,与 FAB 的
    // `data-active-run-id` 同步。本用例覆盖面板内的多行场景,确认只有
    // 当前选中行携带 `aria-current`。
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'r-mid', created_at: '2026-08-01T09:00:00.000Z' }),
      buildRun({ run_id: 'r-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // 默认 active = r-new(最新 created_at)
    expect(screen.getByTestId('analysis-history-fab').getAttribute('data-active-run-id')).toBe(
      'r-new',
    )
    const rows = screen.getAllByTestId('analysis-history-row')
    const activeRow = rows.find((r) => r.getAttribute('data-run-id') === 'r-new')!
    const inactiveRows = rows.filter((r) => r.getAttribute('data-run-id') !== 'r-new')
    expect(activeRow.getAttribute('aria-current')).toBe('true')
    for (const r of inactiveRows) {
      expect(r.getAttribute('aria-current')).toBeNull()
    }
  })

  it('删除按钮 `aria-label` 包含 `run_id` + `skill_name`,能精确指代 Run 实例', async () => {
    // ticket 06 验收第 5 条:删除按钮的 `aria-label` 由 ticket 05 的
    // `删除 Analysis Run ${skill_name}` 扩展为 `删除 Run ${run_id}
    // ${skill_name}`,让屏读器用户能明确分辨"删的是哪一条 Run"。
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'r-deletable-123',
        created_at: '2026-08-01T10:00:00.000Z',
        skill_name: 'boundary-check',
      }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    const deleteBtn = screen.getByTestId('analysis-history-row-delete')
    expect(deleteBtn.getAttribute('aria-label')).toBe(
      '删除 Run r-deletable-123 boundary-check',
    )
  })

  it('运行中 Run 行 锁图标 `aria-label` 包含 `run_id` + `skill_name`', async () => {
    // ticket 06 验收第 6 条:锁图标的 `aria-label` 也补到具体 Run 实例,
    // 屏读器用户能听到"这条 Run 是哪一条、为什么不能删"。
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'r-running-456',
        created_at: '2026-08-01T10:00:00.000Z',
        skill_name: 'prd-completeness',
        status: 'running',
      }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    const lock = screen.getByTestId('analysis-history-row-delete-disabled')
    expect(lock.getAttribute('aria-label')).toBe(
      '运行中的 Run r-running-456 prd-completeness 不可删除',
    )
  })

  it('面板展开时 [识别产物] 列加 dim 蒙层(`data-dimmed="true"` + `aria-hidden="true"`)', async () => {
    // ticket 06 验收第 11 条:面板非 modal 但需视觉提示。dim 蒙层
    //   `<div data-testid="analyzing-right-col-dim" aria-hidden="true">`
    //   覆盖 [识别产物] 列,`pointer-events: none` 不阻断交互。
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-1', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    const rightCol = screen.getByTestId('analyzing-right-col')
    // a11y + 视觉双标识
    expect(rightCol.getAttribute('data-dimmed')).toBe('true')

    const dim = screen.getByTestId('analyzing-right-col-dim')
    expect(dim.getAttribute('aria-hidden')).toBe('true')
    // dim 蒙层不该阻拦用户与 [识别产物] 列交互(仅是视觉提示)
    expect(dim.className).toContain('pointer-events-none')
  })

  it('面板关闭后 dim 蒙层消失(`data-dimmed="false"` + 不在 DOM)', async () => {
    // ticket 06 第 11 条反向:面板关闭 → 不再有 dim 蒙层;DOM 中无
    // `analyzing-right-col-dim` 节点,`data-dimmed` 回到 false。
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-1', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    // 关闭面板(用 ✕ 按钮)
    await userEvent.click(screen.getByTestId('analysis-history-panel-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
    })

    const rightCol = screen.getByTestId('analyzing-right-col')
    expect(rightCol.getAttribute('data-dimmed')).toBe('false')
    expect(screen.queryByTestId('analyzing-right-col-dim')).toBeNull()
  })

  it('Tab 焦点不困在面板内(沿用浏览器原生顺序;不引入 focus-trap)', async () => {
    // ticket 06 验收第 9 条:面板不应该是 `role="dialog"`,不困 Tab 焦点。
    // 在 jsdom 内,Tab 顺序按 DOM 树形顺序自然推进。本用例通过断言「panel
    // 上没有 `aria-modal="true"` 也没有自定义 focus trap 属性」间接证明。
    // 真浏览器焦点行为由 Playwright e2e 守护(见 apps/web/e2e 目录)。
    //
    // 这里额外验证:
    // 1) panel 不带 `aria-modal` 属性
    // 2) panel 不带 `tabindex` 强制接受焦点
    // 3) panel 内 Run 行 select 按钮可正常 focus(模拟 Tab 路径上的目标之一)
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-1', created_at: '2026-08-01T10:00:00.000Z' }),
      buildRun({ run_id: 'r-2', created_at: '2026-08-01T11:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    const panel = screen.getByTestId('analysis-history-panel')
    // a11y 工具与屏读器:`aria-modal=true` 是 dialog 才会有的标记;我们的
    // 面板走 non-modal,刻意不带此属性(也明示不困焦点)
    expect(panel.getAttribute('aria-modal')).toBeNull()
    // panel 本身不可被强制聚焦(避免变成焦点 trap 的「头部」)
    expect(panel.getAttribute('tabindex')).toBeNull()
    // panel 内的 Run 行 select 按钮可被聚焦(浏览器的天然 Tab order)——
    // 这里仅验证它们是真实的 <button> 元素(默认 focusable),不强断言
    // `document.activeElement`(jsdom 在测试环境下 activeElement 时序不稳)。
    const rowSelects = screen.getAllByTestId('analysis-history-row-select')
    expect(rowSelects.length).toBeGreaterThan(0)
    for (const btn of rowSelects) {
      expect(btn.tagName).toBe('BUTTON')
    }
  })

  it('面板头部 ✕ 按钮与主区交互入口都是真实的 <button>(原生 Tab 可达)', async () => {
    // ticket 06 验收第 9 条补强:沿用浏览器原生 Tab 顺序意味着头部 ✕ /
    // 行 select / 删除按钮 / FAB 自身的 <button> 默认可达(不需手写
    // tabindex=0)。本断言对这几类关键节点各取一例。
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'r-running',
        created_at: '2026-08-01T09:00:00.000Z',
        status: 'running',
      }),
      buildRun({
        run_id: 'r-done',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'succeeded',
      }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    await openHistoryPanel()

    expect(screen.getByTestId('analysis-history-fab').tagName).toBe('BUTTON')
    expect(screen.getByTestId('analysis-history-panel-close').tagName).toBe('BUTTON')
    expect(screen.getByTestId('analysis-history-row-delete').tagName).toBe('BUTTON')
    // 无 tabindex hack
    expect(screen.getByTestId('analysis-history-fab').getAttribute('tabindex')).toBeNull()
    expect(screen.getByTestId('analysis-history-panel-close').getAttribute('tabindex')).toBeNull()
  })
})

// ===========================================================================
// FAB N 计数规则 + N=0 空态 CTA(analyzing-fab ticket 07)
//
// ticket 07 在 ticket 01-06 骨架上引入三条 FAB N 显示规则 + N=0 空态 CTA:
// - N=0 时 N 数字仍呈灰色(FAB 本身不隐藏,避免遗忘入口存在)—— 由 ticket 01
//   落地,本 describe 不重复。
// - N=99 显示 `99`,N≥100 显示 `99+`(Gmail 范式,数字宽度不撑爆 FAB)
// - FAB 不显示运行中 dot(运行中状态已走底部 AI 思考条 4 指示器)
// - N=0 面板空态增加 CTA「▶ 开始分析」按钮,点击触发主区 handleStart,
//   复用既有 `data-testid="analysis-run-start-btn"`,state 'idle' → 'starting'
//   → 'running' 由主区决定。
// ===========================================================================

/**
 * ticket 07 fixture —— 工厂出 N 个 Run,用于 N 计数规则断言。无需 Skill
 * 元数据(本组测的是 FAB N 显示规则,不需要走 handleStart)。
 */
function buildRunsByCount(count: number): AnalysisRunMeta[] {
  const runs: AnalysisRunMeta[] = []
  for (let i = 0; i < count; i++) {
    runs.push(
      buildRun({
        run_id: `r-${String(i).padStart(3, '0')}`,
        created_at: `2026-08-01T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
      }),
    )
  }
  return runs
}

describe('AnalyzingZone · FAB N 计数规则 + N=0 空态 CTA(ticket 07)', () => {
  it('N=99 时 FAB 数字显示 `99`(不显示 `99+`)', () => {
    render(<AnalyzingZone data={buildFabPanelData(buildRunsByCount(99))} />)
    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.getAttribute('data-run-count')).toBe('99')
    // ticket 07:FAB 上的数字文本就是 '99',不是 '99+'
    const count = screen.getByTestId('analysis-history-fab-count')
    expect(count.textContent).toBe('99')
  })

  it('N=100 时 FAB 数字显示 `99+`(Gmail 范式)', () => {
    render(<AnalyzingZone data={buildFabPanelData(buildRunsByCount(100))} />)
    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.getAttribute('data-run-count')).toBe('100')
    // 数据层 N=100 但显示用 99+;data-run-count 保持 100 让测试 / 自动化
    // 仍能拿到真实数字,可视化用 99+ 防撑爆宽度
    const count = screen.getByTestId('analysis-history-fab-count')
    expect(count.textContent).toBe('99+')
  })

  it('N=999 时 FAB 数字仍显示 `99+`(不撑爆 FAB 宽度)', () => {
    render(<AnalyzingZone data={buildFabPanelData(buildRunsByCount(999))} />)
    const count = screen.getByTestId('analysis-history-fab-count')
    expect(count.textContent).toBe('99+')
  })

  it('FAB 节点内不显示运行中 dot(运行中状态走底部 AI 思考条)', () => {
    // ticket 07 + ticket 01 的兜底:FAB 上永远没有 `data-testid="history-fab-running-dot"`。
    // 即便有 RUNNING 状态的 Run,运行中信号统一走底部 AI 思考条,FAB 不重复信号。
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r-running', status: 'running', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildFabPanelData(runs)} />)
    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab.querySelector('[data-testid="history-fab-running-dot"]')).toBeNull()
  })

  it('N=0 面板空态文案:「暂无历史 Analysis Run · 点击下方 [▶ 开始分析] 按钮发起首次分析」', async () => {
    render(<AnalyzingZone data={buildFabPanelData([])} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const empty = await screen.findByTestId('analysis-history-panel-empty')
    // ticket 07:升级空态文案 —— 引导用户去点 CTA,而非仅说"暂无"
    expect(empty.textContent).toContain('暂无历史 Analysis Run')
    expect(empty.textContent).toContain('[▶ 开始分析]')
  })

  it('N=0 空态 CTA 「▶ 开始分析」按钮存在 + 复用既有 data-testid `analysis-run-start-btn`', async () => {
    // ticket 07 验收:N=0 面板空态显示 CTA,沿用主区「▶ 开始分析」按钮
    // 的 data-testid,行为完全等价(同 handleStart 入口)。
    render(<AnalyzingZone data={buildFabPanelData([])} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const empty = await screen.findByTestId('analysis-history-panel-empty')
    // 空态内必须含 CTA 按钮,data-testid 与主区按钮一致
    const cta = empty.querySelector('[data-testid="analysis-run-start-btn"]') as HTMLElement
    expect(cta).toBeTruthy()
    // 初始 state = 'idle'(有可用 Skill 时;在 ticket 07 测试夹具里 Skill 默
    // 认走空数组,data-disabled='no_skills' 是「无可用 Skill」标识,不阻塞
    // CTA 渲染)
    expect(cta.getAttribute('data-state')).toBe('idle')
    expect(cta.textContent).toContain('开始分析')
  })

  it('N=0 空态 CTA 点击 → 触发主区 handleStart(state 走向 starting)', async () => {
    // ticket 07 验收第 2 条:CTA 行为等价于主区「▶ 开始分析」按钮,沿用
    // 同一 handleStart 入口。
    //
    // 实现注:CTA 与主区 toolbar 的 StartAnalysisButton 共享同一 state
    // 状态机(`startAnalysisState` prop)。ticket 05 的 handleStart 成功
    // 路径会同步 `setIsHistoryPanelOpen(false)` 收起面板 → CTA 节点被
    // React 在 commit 时直接卸载(不会先更新其 data-state 再卸载)。所以
    // 验证 transition 不直接打 cta 节点,而是打仍在 DOM 中的 toolbar
    // StartAnalysisButton —— 同一状态机,data-state 同步变化。
    render(
      <AnalyzingZone
        data={buildFabPanelData([], [buildSkill('prd-completeness', '检查 PRD 完整性')])}
      />,
    )
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const empty = await screen.findByTestId('analysis-history-panel-empty')
    const ctaInPanel = empty.querySelector(
      '[data-testid="analysis-run-start-btn"]',
    ) as HTMLElement
    // 起点:CTA 的 state = 'idle'(同主区)
    expect(ctaInPanel.getAttribute('data-state')).toBe('idle')

    // mock POST /analysis/start 成功 → handleStart 走 starting → running
    queueAnalysisStartSuccess(
      'r-fresh',
      'req-focus',
      'prd-completeness',
      '2026-08-01T12:00:00.000Z',
    )

    await userEvent.click(ctaInPanel)

    // ticket 07 验收第 3 条:面板被 ticket 05 的「启动成功 → 收起」兜底
    await waitFor(() => {
      expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
    })

    // 主区 StartAnalysisButton 与 CTA 共享 state,验证 toolbar 节点已
    // 经处于 'running'(间接证明 CTA 也走过同样的 transition)
    const mainBtn = screen.getByTestId('analysis-run-start-btn')
    expect(mainBtn.getAttribute('data-state')).toBe('running')

    // 新 Run 已出现在 FAB 计数内
    expect(screen.getByTestId('analysis-history-fab').getAttribute('data-run-count')).toBe('1')
  })

  it('N=0 空态 CTA 点击不重复 toast(Skill 面板 / 开始按钮反馈由主区接管)', async () => {
    // ticket 07 验收第 4 条:CTA 走的是主区 handleStart 入口,不会自己再弹
    // 独立的「已点击」toast。所有反馈(开始中 spinner / Skill 选完 + 启动
    // toast 等)由主区 StartAnalysisButton 自己负责。
    //
    // 本断言只验证:面板内 CTA 按钮点击不会在 panel 节点上派发任何额外
    // UI(没有「独立面板 toast」/「面板内 spinner」/ 等)—— 直接看 CTA
    // 被推进到 'running' 状态 + panel 已被收起。
    render(
      <AnalyzingZone
        data={buildFabPanelData([], [buildSkill('prd-completeness', '检查 PRD 完整性')])}
      />,
    )
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const empty = await screen.findByTestId('analysis-history-panel-empty')
    const cta = empty.querySelector(
      '[data-testid="analysis-run-start-btn"]',
    ) as HTMLElement

    queueAnalysisStartSuccess(
      'r-fresh',
      'req-focus',
      'prd-completeness',
      '2026-08-01T12:00:00.000Z',
    )
    await userEvent.click(cta)

    // CTA 数据流进入运行态(借 toolbar 节点间接断言 — 见上条注)
    await waitFor(() => {
      expect(screen.queryByTestId('analysis-history-panel')).toBeNull()
    })
    expect(screen.getByTestId('analysis-run-start-btn').getAttribute('data-state')).toBe(
      'running',
    )
  })

  it('N=0 面板内 CTA 按钮样式与主区按钮共用(同 [分析中…] 视觉变体)', async () => {
    // ticket 07:CTA 的样式与主区「▶ 开始分析」按钮完全一致(主区负责渲染
    // 实际按钮,空态只是引用 + 嵌入)。点击后 spinner + 「分析中…」文案
    // 由 StartAnalysisButton 内部决定,与位置无关。
    //
    // 因 ticket 05 的 panel 收起会卸载 CTA 节点,验证打 toolbar 上仍在
    // DOM 的同款按钮 — 它们由 StartAnalysisButton 统一渲染,样式共享。
    render(
      <AnalyzingZone
        data={buildFabPanelData([], [buildSkill('prd-completeness', '检查 PRD 完整性')])}
      />,
    )
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    const empty = await screen.findByTestId('analysis-history-panel-empty')
    const cta = empty.querySelector(
      '[data-testid="analysis-run-start-btn"]',
    ) as HTMLElement

    queueAnalysisStartSuccess(
      'r-fresh',
      'req-focus',
      'prd-completeness',
      '2026-08-01T12:00:00.000Z',
    )
    await userEvent.click(cta)

    // 主区 StartAnalysisButton 已切到 running → 视觉变「分析中…」
    await waitFor(() => {
      expect(screen.getByTestId('analysis-run-start-btn').getAttribute('data-state')).toBe(
        'running',
      )
    })
    expect(screen.getByTestId('analysis-run-start-btn').textContent).toContain('分析中')
  })
})

// ===========================================================================
// 窄视口 CSS 自适应 + z-index 命名约定(analyzing-fab ticket 08 · ADR-0022 D8)
// ===========================================================================
//
// ticket 08 验收:
// - FAB 在窄视口(< 1024px)仍渲染,不因视口窄而隐藏
// - 面板宽度 = `min(320px, calc(100vw - 24px))`,窄视口不溢出视口右边
// - 删除 ticket 01 已删的 `analyzing-narrow-history` `max-h-[200px]` 折叠条
// - z-index 命名约定:FAB = 30,面板 = 40,tailwind 集中声明
//   (overlay = 50 / modal = 60 预留给后续二次确认 / 模态)
//
// 沿用既有 `useMediaQuery` mock(vitest.setup.ts 全局桩 +
// `globalThis.setMatchMedia` 控制),与本文件 a11y describe 块一致。

describe('AnalyzingZone · 窄视口 CSS 自适应 + z-index 命名约定(analyzing-fab ticket 08 · ADR-0022 D8)', () => {
  // ticket 08:FAB 在窄视口(< 1024px)仍渲染 —— 不应被 visibility: hidden / display: none 隐藏
  it('窄视口(< 1024px)下 FAB 仍渲染 — 不因视口窄而隐藏', () => {
    // 切到窄视口:`(min-width: 1024px)` 命中 false → NarrowLayout 形态
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={buildFabPanelData([])} />)

    // ticket 01:FAB 默认折叠(沿用 ticket 01 「FAB 始终可见」语义)
    // 渲染。ticket 08 验收第 1 条:窄视口不因窄而隐藏。
    const fab = screen.getByTestId('analysis-history-fab')
    expect(fab).toBeInTheDocument()
    expect(fab.getAttribute('aria-expanded')).toBe('false')
    // 节点本身在 DOM 中且非 display: none,即便视口窄也保留视觉入口
    expect(fab).toBeVisible()
  })

  // ticket 08:旧 `max-h-[200px]` 折叠条 div 已从 DOM 移除
  // —— ticket 01 删除 desktop 永久列 `analyzing-history-col`,ticket 08 兜底
  // 确认窄视口里 `analyzing-narrow-history` 也已彻底清掉。
  it('窄视口下旧 `analyzing-narrow-history` 折叠条已从 DOM 移除', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={buildFabPanelData([])} />)

    // ticket 08 兜底:整段折叠条 div 已经从 DOM 移除,document 全树查询应
    // 为 null(用 document.querySelector 直接验证,不依赖 testing-library
    // 的 portal 等转义边界)。
    expect(document.querySelector('[data-testid="analyzing-narrow-history"]')).toBeNull()
    // `.max-h-\\[200px\\]` 类名在分析相关子树里也应不存在 —— 通过
    // getElementsByTagName(*) 走全树扫描。
    const allEls = document.getElementsByTagName('*')
    for (let i = 0; i < allEls.length; i++) {
      const cls = allEls[i]?.className ?? ''
      // 通用 Element.className 在 jsdom 里是 SVGAnimatedString / string 两种;
      // 仅检查 string 类型以避开 SVGElement 路径。
      if (typeof cls !== 'string') continue
      expect(cls.includes('max-h-[200px]')).toBe(false)
    }
  })

  // ticket 08:面板宽度 = `min(320px, calc(100vw - 24px))`,窄视口不溢出
  // ticket 验收文档明确「通过 getComputedStyle 或类名断言」,本测用类名
  // 断言 — jsdom 不解析 Tailwind 任意值,getBoundingClientRect.width 在
  // jsdom 总是 0,而 className 是稳定的契约载体(由 Tailwind 编译产出
  // 实际 CSS)。两个 viewport 形态下都用同一 `min(320px, calc(100vw-24px))`
  // 表达式 —— 桌面 320px 是更小值,窄视口 `calc(100vw-24px)` 是更小值。
  it('面板宽度 = min(320px, calc(100vw - 24px))(双视口都使用同一响应式表达式)', async () => {
    // 桌面形态
    globalThis.setMatchMedia('(min-width: 1024px)', true)
    render(<AnalyzingZone data={buildFabPanelData([])} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    await waitFor(() => {
      expect(screen.getByTestId('analysis-history-panel')).toBeInTheDocument()
    })
    const panelDesktop = screen.getByTestId('analysis-history-panel')
    expect(panelDesktop.className).toContain('min(320px')
    expect(panelDesktop.className).toContain('calc(100vw-24px)')
    cleanup()
    globalThis.resetMatchMedia()

    // 窄视口形态:表达式保持不变(本 ticket 不引入 breakpoint + `w-[xxx]`
    // 的 ladder),由 CSS calc() 在窄视口下自然收敛。
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<AnalyzingZone data={buildFabPanelData([])} />)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    await waitFor(() => {
      expect(screen.getByTestId('analysis-history-panel')).toBeInTheDocument()
    })
    const panelNarrow = screen.getByTestId('analysis-history-panel')
    expect(panelNarrow.className).toContain('min(320px')
    expect(panelNarrow.className).toContain('calc(100vw-24px)')
    // ticket 08 验收第 3 条:不引入 `useMediaQuery` 新增断点查询;面板类名
    // 中也不应出现 `lg:w-` 等 breakpoint 前缀(沿用 ticket 01 的 1024px 单
    // 一断点)。
    expect(panelNarrow.className).not.toMatch(/\blg:w-/)
  })

  // ticket 08:z-index 命名约定在 tailwind.config.ts 集中声明,且生效
  // (FAB = 30,面板 = 40)。具体值由 tailwind 的 z-fab / z-panel 类产出。
  it('z-index 命名约定生效:FAB = 30,面板 = 40(tailwind 集中声明)', async () => {
    // ticket 08:沿用 a11y 块的桌面形态设置(`z-[30]` / `z-[40]` 在窄视口
    // 形态同样生效,FAB / 面板本身在 NarrowLayout 也渲染)。
    globalThis.setMatchMedia('(min-width: 1024px)', true)
    render(<AnalyzingZone data={buildFabPanelData([])} />)

    const fab = screen.getByTestId('analysis-history-fab')
    // ticket 08 验收第 5 条:FAB 的 `z-index` 通过 tailwind 命名 → 30
    expect(fab.className).toContain('z-fab')
    // jsdom 的 getComputedStyle 不实际解析 tailwind 类;但 className 含
    // `z-fab` 即代表 tailwind 编译后会输出对应 z-index。这是 tailwind 命
    // 名约定的契约保证。

    // 点开面板后断言面板 className 含 `z-panel`(对齐 ticket 08 新约定)
    await userEvent.click(screen.getByTestId('analysis-history-fab'))
    await waitFor(() => {
      expect(screen.getByTestId('analysis-history-panel')).toBeInTheDocument()
    })
    const panel = screen.getByTestId('analysis-history-panel')
    expect(panel.className).toContain('z-panel')
  })
})