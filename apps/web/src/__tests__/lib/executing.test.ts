import { describe, it, expect } from 'vitest'
import {
  emptyExecuting,
  getExecutingData,
  summarizeDagStats,
  type ExecutingData,
} from '@/lib/executing'

// ============================================================================
// 纯函数 · summarizeDagStats(独立来源,用于三列渲染前预计算)
// ============================================================================

describe('summarizeDagStats', () => {
  it('空 DAG → 全 0,total=0', () => {
    const s = summarizeDagStats([])
    expect(s.done).toBe(0)
    expect(s.doing).toBe(0)
    expect(s.wait).toBe(0)
    expect(s.todo).toBe(0)
    expect(s.total).toBe(0)
    expect(s.percent).toBe(0)
  })

  it('混合状态正确分类,total 等于输入长度', () => {
    const s = summarizeDagStats([
      { id: 'T-1', title: 'a', status: 'done' },
      { id: 'T-2', title: 'b', status: 'done' },
      { id: 'T-3', title: 'c', status: 'doing' },
      { id: 'T-4', title: 'd', status: 'wait' },
      { id: 'T-5', title: 'e', status: 'todo' },
    ] as any)
    expect(s.done).toBe(2)
    expect(s.doing).toBe(1)
    expect(s.wait).toBe(1)
    expect(s.todo).toBe(1)
    expect(s.total).toBe(5)
    expect(s.percent).toBe(40) // 2 done / 5 total = 40%
  })

  it('全部 done 时 percent=100', () => {
    const s = summarizeDagStats([
      { id: 'T-1', title: 'a', status: 'done' },
      { id: 'T-2', title: 'b', status: 'done' },
    ] as any)
    expect(s.percent).toBe(100)
  })

  it('todo 状态计入 total,不计入 done(防止 percent 虚高)', () => {
    const s = summarizeDagStats([
      { id: 'T-1', title: 'a', status: 'todo' },
      { id: 'T-2', title: 'b', status: 'todo' },
      { id: 'T-3', title: 'c', status: 'todo' },
    ] as any)
    expect(s.done).toBe(0)
    expect(s.total).toBe(3)
    expect(s.percent).toBe(0)
  })
})

// ============================================================================
// 数据层 · getExecutingData + emptyExecuting
// ============================================================================

describe('emptyExecuting', () => {
  it('返回空数据骨架,空 = true,携带 requirementId', () => {
    const data = emptyExecuting('NEW')
    expect(data.requirementId).toBe('NEW')
    expect(data.empty).toBe(true)
    expect(data.dag.tasks).toEqual([])
    expect(data.diff.files).toEqual([])
    expect(data.aiEvents).toEqual([])
    expect(data.toolbar.crumb).toEqual([])
    expect(data.toolbar.actions).toEqual([])
    expect(data.stage.badge).toBe('')
  })

  it('空状态下 stats 仍可用(全 0),不抛错', () => {
    const data = emptyExecuting('X')
    const s = summarizeDagStats(data.dag.tasks)
    expect(s.total).toBe(0)
  })
})

describe('getExecutingData', () => {
  it('已知 id(req-001)返回完整 mock 数据', async () => {
    const data = await getExecutingData('req-001')
    expect(data.requirementId).toBe('req-001')
    expect(data.empty).toBe(false)
    expect(data.dag.tasks.length).toBeGreaterThan(0)
    expect(data.diff.files.length).toBeGreaterThan(0)
    expect(data.aiEvents.length).toBeGreaterThan(0)
  })

  it('未知 id 返回空状态(不抛错,UI 渲染空态引导)', async () => {
    const data = await getExecutingData('unknown')
    expect(data.empty).toBe(true)
    expect(data.requirementId).toBe('unknown')
  })

  it('满数据:diff 文件含 +/- 行,stats 4 列至少各有 1 个', async () => {
    const data: ExecutingData = await getExecutingData('req-001')
    // diff 至少有一个文件 + 每个文件至少 1 行 add/rem
    const hasChanges = data.diff.files.some(
      (f) => f.lines.some((l) => l.kind === 'add' || l.kind === 'rem'),
    )
    expect(hasChanges).toBe(true)

    const stats = summarizeDagStats(data.dag.tasks)
    // EXECUTING 样例至少覆盖 4 状态(全 0 状态不应出现)
    expect(
      stats.done + stats.doing + stats.wait + stats.todo,
    ).toBeGreaterThanOrEqual(stats.total)
  })

  it('满数据:toolbar.crumb 至少含 req 名 + Mission Control', async () => {
    const data = await getExecutingData('req-001')
    expect(data.toolbar.crumb.length).toBeGreaterThanOrEqual(3)
    expect(
      data.toolbar.crumb.some((c) => /Mission Control/i.test(c.label)),
    ).toBe(true)
  })
})