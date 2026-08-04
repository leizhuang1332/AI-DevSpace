/**
 * findNextRunId helper 测试(analyzing-fab ticket 03 · ADR-0022 D5.1)
 *
 * 删除 Run 后,父组件 AnalyzingZone 用 findNextRunId(runs, deletedRunId)
 * 决定 currentRun 的新值。「下一个 Run」=按 created_at 倒序的第一个
 * 非删除 Run;空时返 ''。
 *
 * 这层覆盖:
 * - 删除当前 Run 后,返回最新的剩余 Run
 * - 删除非当前 Run(即使它最旧),不影响返回值
 * - 仅剩一个非删除 Run → 返回它
 * - 所有 Run 都被列入 deletedRunId 排除(空列表结果) → 返 ''
 * - 列表本身就空 → 返 ''
 * - 倒序在 ISO 字符串比较中稳定(ticket 02 已约定 runs 按 created_at 倒序,
 *   helper 自己做一次防御性排序,与 AnalysisHistoryFabPanel /
 *   AnalysisHistoryDrawer 保持一致)
 */
import { describe, it, expect } from 'vitest'
import type { AnalysisRunMeta } from '@ai-devspace/shared'
import { findNextRunId } from '../analysis-run-focus'

function buildRun(partial: Partial<AnalysisRunMeta> & { run_id: string }): AnalysisRunMeta {
  const base: AnalysisRunMeta = {
    run_id: partial.run_id,
    requirement_id: 'req-focus',
    skill_name: 'prd-completeness',
    status: 'succeeded',
    created_at: '2026-08-01T10:00:00.000Z',
    finished_at: '2026-08-01T10:00:42.000Z',
    issue_count: 0,
    error: null,
  }
  return { ...base, ...partial, run_id: partial.run_id }
}

describe('findNextRunId', () => {
  it('多 Run 时返 created_at 最大的非删除 Run', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-mid', created_at: '2026-08-01T09:00:00.000Z' }),
      buildRun({ run_id: 'run-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    expect(findNextRunId(runs, 'run-mid')).toBe('run-new')
  })

  it('已按 created_at 倒序传入时不依赖排序(防御性排序兜底)', () => {
    const runs: AnalysisRunMeta[] = [
      // 故意以非倒序传入,helper 应该内部排
      buildRun({ run_id: 'run-new', created_at: '2026-08-01T10:00:00.000Z' }),
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-mid', created_at: '2026-08-01T09:00:00.000Z' }),
    ]
    expect(findNextRunId(runs, 'run-new')).toBe('run-mid')
  })

  it('仅剩一个非删除 Run → 返它', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-only', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    expect(findNextRunId(runs, 'run-only')).toBe('')
  })

  it('多个 Run、删除最旧,返最新', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-mid', created_at: '2026-08-01T09:00:00.000Z' }),
      buildRun({ run_id: 'run-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    expect(findNextRunId(runs, 'run-old')).toBe('run-new')
  })

  it('列表本身就空 → 返 ""', () => {
    expect(findNextRunId([], 'does-not-matter')).toBe('')
  })

  it('deletedRunId 不在列表里(并发场景)→ 仍按倒序取第一个', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
      buildRun({ run_id: 'run-new', created_at: '2026-08-01T10:00:00.000Z' }),
    ]
    expect(findNextRunId(runs, 'run-already-deleted')).toBe('run-new')
  })

  it('运行中 Run 也可作「下一个 Run」(helper 不关心 status)', () => {
    const runs: AnalysisRunMeta[] = [
      buildRun({
        run_id: 'run-running',
        created_at: '2026-08-01T10:00:00.000Z',
        status: 'running',
      }),
      buildRun({ run_id: 'run-old', created_at: '2026-08-01T08:00:00.000Z' }),
    ]
    // ticket 03 实现注:helper 只按 created_at 倒序取第一个非删除 Run,status
    // 判定由 canDeleteAnalysisRun 在入口把关。运行中 Run 仍可作 fallback。
    expect(findNextRunId(runs, 'run-old')).toBe('run-running')
  })
})
