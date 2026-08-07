/**
 * BoardToolbar 组件测试 — issue 07 + 08 / ADR-0027 D3
 *
 * 验收(对照 `board-color-options.html` .toolbar):
 * - 左:视图切换 chip(显示 requirementId)+ 4 filter chips
 * - filter chip active 切换(onFilterChange 调用)
 * - 右:[+ 新任务] 触发 onNewTask
 * - 右:[+ 从 PRD 拆] 按钮:无 onSplitFromPrd → disabled(默认);有 → enabled + 触发(issue 08 接通)
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { BoardToolbar } from '@/components/board/BoardToolbar'
import type { BoardFilter } from '@/lib/board'

afterEach(() => cleanup())

function renderToolbar(overrides: { filter?: BoardFilter; onFilterChange?: (f: BoardFilter) => void; onNewTask?: () => void; onSplitFromPrd?: () => void } = {}) {
  const props = {
    requirementId: 'req-007',
    filter: (overrides.filter ?? 'all') as BoardFilter,
    onFilterChange: overrides.onFilterChange ?? vi.fn(),
    onNewTask: overrides.onNewTask ?? vi.fn(),
    ...(overrides.onSplitFromPrd ? { onSplitFromPrd: overrides.onSplitFromPrd } : {}),
  }
  return { ...props, ...render(<BoardToolbar {...props} />) }
}

describe('BoardToolbar · 左侧视图 chip + filter chips', () => {
  it('视图 chip 显示 requirementId', () => {
    renderToolbar()
    expect(screen.getByTestId('board-view-chip').textContent).toContain('req-007')
  })

  it('4 个 filter chip 全部渲染(全部/我的/高优先级/PRD 拆)', () => {
    renderToolbar()
    expect(screen.getByTestId('board-filter-chip-all').textContent).toBe('全部')
    expect(screen.getByTestId('board-filter-chip-mine').textContent).toBe('我的')
    expect(screen.getByTestId('board-filter-chip-high-priority').textContent).toBe('高优先级')
    expect(screen.getByTestId('board-filter-chip-prd-split').textContent).toBe('PRD 拆')
  })

  it('默认 filter=all → all chip active', () => {
    renderToolbar({ filter: 'all' })
    expect(screen.getByTestId('board-filter-chip-all').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('board-filter-chip-mine').getAttribute('data-active')).toBe('false')
  })

  it('点 filter chip → onFilterChange(chip)', () => {
    const onFilterChange = vi.fn()
    renderToolbar({ onFilterChange })
    fireEvent.click(screen.getByTestId('board-filter-chip-mine'))
    expect(onFilterChange).toHaveBeenCalledWith('mine')
  })

  it('点高优先级 chip', () => {
    const onFilterChange = vi.fn()
    renderToolbar({ onFilterChange })
    fireEvent.click(screen.getByTestId('board-filter-chip-high-priority'))
    expect(onFilterChange).toHaveBeenCalledWith('high-priority')
  })
})

describe('BoardToolbar · 右侧操作按钮', () => {
  it('[+ 新任务] 按钮 → 点击触发 onNewTask', () => {
    const onNewTask = vi.fn()
    renderToolbar({ onNewTask })
    fireEvent.click(screen.getByTestId('board-new-task'))
    expect(onNewTask).toHaveBeenCalledOnce()
  })

  it('[+ 从 PRD 拆] 按钮 → 无 onSplitFromPrd 时 disabled(默认灰显)', () => {
    renderToolbar()
    const btn = screen.getByTestId('board-split-from-prd') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.title).toContain('即将上线')
  })

  it('[+ 从 PRD 拆] 按钮 → 有 onSplitFromPrd 时 enabled(issue 08 接通)', () => {
    const onSplitFromPrd = vi.fn()
    renderToolbar({ onSplitFromPrd })
    const btn = screen.getByTestId('board-split-from-prd') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('aria-disabled')).toBe('false')
    expect(btn.title).toContain('从 PRD')
  })

  it('[+ 从 PRD 拆] enabled 按钮 → 点击触发 onSplitFromPrd', () => {
    const onSplitFromPrd = vi.fn()
    renderToolbar({ onSplitFromPrd })
    const btn = screen.getByTestId('board-split-from-prd') as HTMLButtonElement
    fireEvent.click(btn)
    expect(onSplitFromPrd).toHaveBeenCalledOnce()
  })

  it('[+ 从 PRD 拆] disabled 按钮 → 点击无副作用(不触发任何回调)', () => {
    const onNewTask = vi.fn()
    renderToolbar({ onNewTask })
    const btn = screen.getByTestId('board-split-from-prd') as HTMLButtonElement
    fireEvent.click(btn)
    // onNewTask 不该被 PRD 拆按钮触发
    expect(onNewTask).not.toHaveBeenCalled()
  })
})
