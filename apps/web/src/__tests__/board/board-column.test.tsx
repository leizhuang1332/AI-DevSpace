/**
 * BoardColumn 组件测试 — issue 07 / ADR-0027 D3
 *
 * 验收(对照 `board-color-options.html` .column):
 * - 列头:status dot(实心/空心)+ name + count(N)+ `+` 按钮
 * - cards 槽:渲染 BoardCard;空态 placeholder
 * - 列背景 tint + 列名色按 STATUS_COLUMNS token
 * - data-testid / data-status / data-count
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { BoardColumn } from '@/components/board/Column'
import type { TaskCard } from '@ai-devspace/shared'

afterEach(() => cleanup())

function makeCard(id: string, overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id,
    parent_id: 'req-test',
    status: 'backlog',
    title: `卡片 ${id}`,
    content: '',
    priority: null,
    assignee: null,
    labels: [],
    depends_on: [],
    order_index: null,
    source: 'manual',
    is_archived: false,
    created_at: '2026-08-07T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
    completed_at: null,
    ...overrides,
  }
}

describe('BoardColumn · 列头', () => {
  it('backlog 列:dot 实心 + name Backlog + count', () => {
    render(<BoardColumn status="backlog" cards={[makeCard('c1')]} />)
    const col = screen.getByTestId('board-column')
    expect(col.getAttribute('data-status')).toBe('backlog')
    expect(col.getAttribute('data-count')).toBe('1')
    expect(screen.getByTestId('board-column-name').textContent).toBe('Backlog')
    const dot = screen.getByTestId('board-column-dot')
    expect(dot.getAttribute('data-hollow')).toBe('false')
  })

  it('todo 列:dot 空心(data-hollow=true)', () => {
    render(<BoardColumn status="todo" cards={[]} />)
    const dot = screen.getByTestId('board-column-dot')
    expect(dot.getAttribute('data-hollow')).toBe('true')
  })

  it('count 反映卡数', () => {
    const { rerender } = render(<BoardColumn status="in_progress" cards={[makeCard('c1'), makeCard('c2'), makeCard('c3')]} />)
    expect(screen.getByTestId('board-column-count').textContent).toBe('3')
    rerender(<BoardColumn status="in_progress" cards={[]} />)
    expect(screen.getByTestId('board-column-count').textContent).toBe('0')
  })
})

describe('BoardColumn · 列色 token(方案 A)', () => {
  it('backlog dot 色 #94a3b8 + name 色 #475569', () => {
    render(<BoardColumn status="backlog" cards={[]} />)
    const dot = screen.getByTestId('board-column-dot') as HTMLElement
    expect(dot.style.background).toBe('rgb(148, 163, 184)') // #94a3b8
    const name = screen.getByTestId('board-column-name') as HTMLElement
    expect(name.style.color).toBe('rgb(71, 85, 105)') // #475569
  })

  it('in_progress dot 色 #f59e0b + name 色 #b45309', () => {
    render(<BoardColumn status="in_progress" cards={[]} />)
    const dot = screen.getByTestId('board-column-dot') as HTMLElement
    expect(dot.style.background).toBe('rgb(245, 158, 11)') // #f59e0b
    const name = screen.getByTestId('board-column-name') as HTMLElement
    expect(name.style.color).toBe('rgb(180, 83, 9)') // #b45309
  })

  it('列背景 tint 应用(bgColor 含 5% alpha)', () => {
    render(<BoardColumn status="done" cards={[]} />)
    const col = screen.getByTestId('board-column') as HTMLElement
    // #3b82f60d → jsdom 解析成 rgba(59, 130, 246, 0.05)
    expect(col.style.background).toBe('rgba(59, 130, 246, 0.05)')
  })
})

describe('BoardColumn · cards 槽', () => {
  it('有卡 → 渲染 BoardCard 列表', () => {
    render(
      <BoardColumn
        status="backlog"
        cards={[makeCard('c1'), makeCard('c2')]}
      />,
    )
    const cards = screen.getAllByTestId('board-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].getAttribute('data-card-id')).toBe('c1')
  })

  it('空列 → 渲染 placeholder', () => {
    render(<BoardColumn status="backlog" cards={[]} />)
    expect(screen.getByTestId('board-column-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('board-card')).toBeNull()
  })
})

describe('BoardColumn · `+` 按钮', () => {
  it('onAddCard 传入 → 渲染 + 按钮 + 点击触发 onAddCard(status)', () => {
    const onAddCard = vi.fn()
    render(
      <BoardColumn
        status="in_review"
        cards={[]}
        onAddCard={onAddCard}
      />,
    )
    const add = screen.getByTestId('board-column-add')
    fireEvent.click(add)
    expect(onAddCard).toHaveBeenCalledWith('in_review')
  })

  it('无 onAddCard → 不渲染 + 按钮', () => {
    render(<BoardColumn status="backlog" cards={[]} />)
    expect(screen.queryByTestId('board-column-add')).toBeNull()
  })
})

describe('BoardColumn · delete 透传', () => {
  it('onCardDelete 传入 → 卡片菜单 delete 触发', () => {
    const onDelete = vi.fn()
    render(
      <BoardColumn
        status="backlog"
        cards={[makeCard('c1')]}
        onCardDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByTestId('board-card-menu'))
    fireEvent.click(screen.getByTestId('board-card-menu-delete'))
    expect(onDelete).toHaveBeenCalledWith('c1')
  })
})
