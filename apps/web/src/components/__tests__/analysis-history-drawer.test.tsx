/**
 * AnalysisHistoryDrawer 组件测试(issue 05 · ADR-0021)
 *
 * 覆盖验收点:
 * - 3:历史行显示时间 + Skill 名 + 状态 + Issue 数量
 * - 4:点击行 → onSelect 回调
 * - 8:running Run 不显示删除入口(替换为锁图标)
 * - 9:终态 Run 显示删除入口 + 二次确认对话框
 * - 11:删除当前 Run → onSelect / 焦点由父组件接管(本组件只暴露回调)
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnalysisRunMeta } from '@ai-devspace/shared'
import {
  AnalysisHistoryDrawer,
  AnalysisDeleteRunDialog,
} from '../analysis-history-drawer'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildRun(partial: Partial<AnalysisRunMeta> & { run_id: string }): AnalysisRunMeta {
  const base: AnalysisRunMeta = {
    run_id: partial.run_id,
    requirement_id: 'req-test',
    skill_name: 'prd-completeness',
    status: 'succeeded',
    created_at: '2026-08-01T10:30:00.000Z',
    finished_at: '2026-08-01T10:30:42.000Z',
    issue_count: 3,
    error: null,
  }
  return { ...base, ...partial, run_id: partial.run_id }
}

// ===========================================================================
// AnalysisHistoryDrawer
// ===========================================================================

describe('AnalysisHistoryDrawer · 行展示(issue 05 验收 3)', () => {
  it('空列表 → 显示空态文案', () => {
    render(
      <AnalysisHistoryDrawer
        runs={[]}
        activeRunId=""
        onSelect={() => {}}
        onRequestDelete={() => {}}
      />,
    )
    const root = screen.getByTestId('analysis-history-drawer')
    expect(root.getAttribute('data-run-count')).toBe('0')
    expect(screen.getByTestId('analysis-history-empty')).toBeTruthy()
  })

  it('多条 Run → 按 created_at 倒序展示 + 显示时间 / Skill / Issue 数', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-a',
        created_at: '2026-08-01T08:00:00.000Z',
        skill_name: 'prd-completeness',
        issue_count: 5,
      }),
      buildRun({
        run_id: 'run-b',
        created_at: '2026-08-01T10:00:00.000Z',
        skill_name: 'implementation-readiness',
        issue_count: 2,
      }),
    ]
    render(
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId="run-b"
        onSelect={() => {}}
        onRequestDelete={() => {}}
      />,
    )
    const root = screen.getByTestId('analysis-history-drawer')
    expect(root.getAttribute('data-run-count')).toBe('2')
    // B 比 A 更新 → 倒序 → B 在前
    const rows = screen.getAllByTestId('analysis-history-row')
    expect(rows[0]?.getAttribute('data-run-id')).toBe('run-b')
    expect(rows[1]?.getAttribute('data-run-id')).toBe('run-a')
    // 时间格式 MM/DD HH:mm(用本地时区计算期望值,避免 TZ 漂移导致 flaky)
    const expectedDate = new Date('2026-08-01T10:00:00.000Z')
    const pad = (n: number): string => n.toString().padStart(2, '0')
    const expectedTime = `${pad(expectedDate.getMonth() + 1)}/${pad(expectedDate.getDate())} ${pad(expectedDate.getHours())}:${pad(expectedDate.getMinutes())}`
    expect(rows[0]?.querySelector('[data-testid="analysis-history-row-time"]')?.textContent).toBe(expectedTime)
    // Skill 名
    expect(rows[0]?.querySelector('[data-testid="analysis-history-row-skill"]')?.textContent).toBe('implementation-readiness')
    // Issue 数
    expect(rows[0]?.querySelector('[data-testid="analysis-history-row-issue-count"]')?.textContent).toContain('2')
  })

  it('当前 active Run → 行标 data-active=true', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-a', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-b', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId="run-a"
        onSelect={() => {}}
        onRequestDelete={() => {}}
      />,
    )
    const activeRow = screen.getAllByTestId('analysis-history-row').find(
      (r) => r.getAttribute('data-run-id') === 'run-a',
    )
    expect(activeRow?.getAttribute('data-active')).toBe('true')
  })

  it('提供 skillDescriptions → 行显示简介', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-a', skill_name: 'prd-completeness' }),
    ]
    render(
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId=""
        onSelect={() => {}}
        onRequestDelete={() => {}}
        skillDescriptions={new Map([['prd-completeness', '检查 PRD 完整性']])}
      />,
    )
    const row = screen.getByTestId('analysis-history-row')
    expect(row.textContent).toContain('检查 PRD 完整性')
  })
})

describe('AnalysisHistoryDrawer · 行交互(issue 05 验收 4 / 8)', () => {
  it('点行 → 触发 onSelect', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-a' }),
      buildRun({ run_id: 'run-b' }),
    ]
    const onSelect = vi.fn()
    render(
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId="run-a"
        onSelect={onSelect}
        onRequestDelete={() => {}}
      />,
    )
    const selectButtons = screen.getAllByTestId('analysis-history-row-select')
    expect(selectButtons).toHaveLength(2)
    // 点 run-b 的 select 按钮
    const bSelect = selectButtons.find(
      (b) => b.closest('[data-run-id]')?.getAttribute('data-run-id') === 'run-b',
    )
    expect(bSelect).toBeTruthy()
    await userEvent.click(bSelect as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith('run-b')
  })

  it('终态 Run → 显示删除按钮 + click → onRequestDelete', async () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-s', status: 'succeeded' }),
      buildRun({ run_id: 'run-f', status: 'failed' }),
    ]
    const onRequestDelete = vi.fn()
    render(
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId=""
        onSelect={() => {}}
        onRequestDelete={onRequestDelete}
      />,
    )
    const deleteBtns = screen.getAllByTestId('analysis-history-row-delete')
    expect(deleteBtns).toHaveLength(2)
    await userEvent.click(deleteBtns[0] as HTMLElement)
    expect(onRequestDelete).toHaveBeenCalledWith('run-s')
  })

  it('running Run → 不显示删除按钮(替换为 🔒 不可点图标)', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-r', status: 'running' }),
    ]
    const onRequestDelete = vi.fn()
    render(
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId=""
        onSelect={() => {}}
        onRequestDelete={onRequestDelete}
      />,
    )
    expect(screen.queryByTestId('analysis-history-row-delete')).toBeNull()
    const lock = screen.getByTestId('analysis-history-row-delete-disabled')
    expect(lock.getAttribute('aria-label')).toContain('不可删除')
    // 点击 lock 也不触发删除(因为没有 onClick)
    fireEvent.click(lock)
    expect(onRequestDelete).not.toHaveBeenCalled()
  })

  it('failed Run → 显示错误截断', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-f',
        status: 'failed',
        error: 'SDK returned success but complete_analysis was not called',
      }),
    ]
    render(
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId=""
        onSelect={() => {}}
        onRequestDelete={() => {}}
      />,
    )
    const row = screen.getByTestId('analysis-history-row')
    const errorEl = row.querySelector('[data-testid="analysis-history-row-error"]')
    expect(errorEl).toBeTruthy()
    expect(errorEl?.textContent).toContain('SDK returned success')
  })
})

describe('AnalysisHistoryDrawer · 列表排序', () => {
  it('输入顺序乱序 → 仍然按 created_at 倒序展示', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'r3', created_at: '2026-08-01T12:00:00.000Z' }),
      buildRun({ run_id: 'r1', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'r2', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    render(
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId=""
        onSelect={() => {}}
        onRequestDelete={() => {}}
      />,
    )
    const rows = screen.getAllByTestId('analysis-history-row')
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(['r3', 'r2', 'r1'])
  })
})

// ===========================================================================
// AnalysisDeleteRunDialog
// ===========================================================================

describe('AnalysisDeleteRunDialog · 二次确认(issue 05 验收 9)', () => {
  it('run=null → 不渲染', () => {
    const { container } = render(
      <AnalysisDeleteRunDialog
        requirementId="req-test"
        run={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(container.querySelector('[data-testid="analysis-delete-dialog"]')).toBeNull()
  })

  it('显示 Skill 名 + Issue 数 + 取消 / 确认按钮', () => {
    const run = buildRun({ run_id: 'r1', skill_name: 'prd-completeness', issue_count: 5 })
    render(
      <AnalysisDeleteRunDialog
        requirementId="req-test"
        run={run}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    const dialog = screen.getByTestId('analysis-delete-dialog')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(screen.getByTestId('analysis-delete-dialog-skill').textContent).toBe('prd-completeness')
    expect(dialog.textContent).toContain('5')
    expect(dialog.textContent).toContain('条 Analysis Issue')
    expect(screen.getByTestId('analysis-delete-dialog-cancel')).toBeTruthy()
    expect(screen.getByTestId('analysis-delete-dialog-confirm')).toBeTruthy()
  })

  it('显示后续上下文警告(中性文案,无条件)', () => {
    const run = buildRun({ run_id: 'r1', skill_name: 'prd-completeness', issue_count: 2 })
    render(
      <AnalysisDeleteRunDialog
        requirementId="req-test"
        run={run}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    const warning = screen.getByTestId('analysis-delete-dialog-context-warning')
    expect(warning).toBeTruthy()
    // issue 05 acceptance #10:明确后续上下文影响
    expect(warning.textContent).toContain('下一次 Run')
    expect(warning.textContent).toContain('分析上下文')
  })

  it('点取消 → onCancel', async () => {
    const run = buildRun({ run_id: 'r1', skill_name: 'prd-completeness' })
    const onCancel = vi.fn()
    render(
      <AnalysisDeleteRunDialog
        requirementId="req-test"
        run={run}
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    )
    await userEvent.click(screen.getByTestId('analysis-delete-dialog-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('点确认 → 调 onConfirm(runId)', async () => {
    const run = buildRun({ run_id: 'r1', skill_name: 'prd-completeness' })
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <AnalysisDeleteRunDialog
        requirementId="req-test"
        run={run}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )
    await userEvent.click(screen.getByTestId('analysis-delete-dialog-confirm'))
    expect(onConfirm).toHaveBeenCalledWith('r1')
  })

  it('onConfirm 抛错 → 显示错误且按钮可重试', async () => {
    const run = buildRun({ run_id: 'r1', skill_name: 'prd-completeness' })
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('disk write failed'))
    render(
      <AnalysisDeleteRunDialog
        requirementId="req-test"
        run={run}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )
    await userEvent.click(screen.getByTestId('analysis-delete-dialog-confirm'))
    // 等 microtask 让 error state 提交
    await new Promise((r) => setImmediate(r))
    const errorEl = await screen.findByTestId('analysis-delete-dialog-error')
    expect(errorEl.textContent).toContain('disk write failed')
  })
})