/**
 * AnalyzingZone · 历史抽屉 + 焦点规则(issue 05 · ADR-0021)
 *
 * 覆盖 spec acceptance:
 * - 5:用户手动切换历史 Run → 焦点切到该 Run
 * - 7:用户手动切换后,后续 SSE 终态事件(succeeded / failed)不会抢回焦点
 * - 9:删除 Run 弹二次确认 + 确认后 DELETE 端点被调
 * - 11:删除当前 Run 后 → 切到最新剩余 Run
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

    const drawer = screen.getByTestId('analysis-history-drawer')
    expect(drawer.getAttribute('data-active-run-id')).toBe('run-new')
  })

  it('点历史行 → 焦点切到该 Run(验收 5)', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)

    // 找到 run-old 的 select 按钮
    const oldRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-old')!
    const oldSelectBtn = oldRow.querySelector(
      '[data-testid="analysis-history-row-select"]',
    ) as HTMLElement
    await userEvent.click(oldSelectBtn)

    await waitFor(() => {
      const drawer = screen.getByTestId('analysis-history-drawer')
      expect(drawer.getAttribute('data-active-run-id')).toBe('run-old')
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
        screen.getByTestId('analysis-history-drawer').getAttribute('data-active-run-id'),
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
      screen.getByTestId('analysis-history-drawer').getAttribute('data-active-run-id'),
    ).toBe('run-old')

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

    const oldRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-old')!
    await userEvent.click(
      oldRow.querySelector('[data-testid="analysis-history-row-select"]') as HTMLElement,
    )

    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-drawer').getAttribute('data-active-run-id'),
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
      screen.getByTestId('analysis-history-drawer').getAttribute('data-active-run-id'),
    ).toBe('run-old')
  })
})

// ===========================================================================
// 删除确认对话框 + 二次确认(issue 05 验收 8 / 9 / 11)
// ===========================================================================

describe('AnalyzingZone · 删除 Run(issue 05 验收 8 / 9 / 11)', () => {
  it('running Run 行不显示删除按钮', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-r', status: 'running' }),
    ]
    render(<AnalyzingZone data={buildData(runs)} />)
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
      screen.getByTestId('analysis-history-drawer').getAttribute('data-active-run-id'),
    ).toBe('run-remaining')

    // 先切到 run-current(触发 userManuallySwitchedRef)
    const curRow = screen
      .getAllByTestId('analysis-history-row')
      .find((r) => r.getAttribute('data-run-id') === 'run-current')!
    await userEvent.click(
      curRow.querySelector('[data-testid="analysis-history-row-select"]') as HTMLElement,
    )
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-history-drawer').getAttribute('data-active-run-id'),
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
        screen.getByTestId('analysis-history-drawer').getAttribute('data-active-run-id'),
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