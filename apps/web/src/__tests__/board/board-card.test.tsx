/**
 * BoardCard 组件测试 — issue 07 / ADR-0027 D3
 *
 * 验收(对照 `board-color-options.html` .card):
 * - 短 ID(ULID 末 4)+ title 2 行 + summary 2 行 + 底部 meta 行
 * - priority badge 4 档 + 无(灰态)+ 对应配色
 * - source 中文小标(PRD 拆 / 子拆 / 手动)
 * - assignee 头像(有值 = 渐变;无 = placeholder '+')
 * - labels chip
 * - 卡片菜单(⋯)→ archive 选项
 * - data-testid / data-* 属性完整
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { BoardCard } from '@/components/board/Card'
import type { TaskCard } from '@ai-devspace/shared'

afterEach(() => cleanup())

function makeCard(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: '01J7X3K2P5EVR0Z3YQJD8HFKX9',
    parent_id: 'req-test',
    status: 'backlog',
    title: '梳理 Stripe API 端点能力',
    content: 'Benchmark Stripe vs in-memory 缓存,选型接入方案。',
    priority: 'low',
    assignee: 'zhanglei',
    labels: ['security'],
    depends_on: [],
    order_index: null,
    source: 'prd_split',
    is_archived: false,
    created_at: '2026-08-07T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
    completed_at: null,
    ...overrides,
  }
}

describe('BoardCard · 满数据渲染', () => {
  it('短 ID = ULID 末 4 位(FKX9)', () => {
    render(<BoardCard card={makeCard()} />)
    expect(screen.getByTestId('board-card-id').textContent).toBe('FKX9')
  })

  it('title + summary 正确渲染', () => {
    render(<BoardCard card={makeCard()} />)
    expect(screen.getByTestId('board-card-title').textContent).toBe(
      '梳理 Stripe API 端点能力',
    )
    expect(screen.getByTestId('board-card-summary').textContent).toContain(
      'Benchmark Stripe',
    )
  })

  it('meta 行存在 + priority badge + source + assignee + labels', () => {
    render(<BoardCard card={makeCard()} />)
    expect(screen.getByTestId('board-card-meta')).toBeInTheDocument()
    expect(screen.getByTestId('board-card-priority').textContent).toBe('Low')
    expect(screen.getByTestId('board-card-source').textContent).toBe('PRD 拆')
    expect(screen.getByTestId('board-card-assignee').textContent).toBe('ZH')
    const label = screen.getByTestId('board-card-label')
    expect(label.textContent).toBe('security')
  })

  it('data-card-id / data-status / data-priority / data-source 属性', () => {
    render(<BoardCard card={makeCard()} />)
    const card = screen.getByTestId('board-card')
    expect(card.getAttribute('data-card-id')).toBe('01J7X3K2P5EVR0Z3YQJD8HFKX9')
    expect(card.getAttribute('data-status')).toBe('backlog')
    expect(card.getAttribute('data-priority')).toBe('low')
    expect(card.getAttribute('data-source')).toBe('prd_split')
  })
})

describe('BoardCard · priority badge 配色', () => {
  it('urgent = #fee2e2/#991b1b', () => {
    render(<BoardCard card={makeCard({ priority: 'urgent' })} />)
    const badge = screen.getByTestId('board-card-priority')
    expect(badge.getAttribute('data-priority')).toBe('urgent')
    expect((badge as HTMLElement).style.background).toBe('rgb(254, 226, 226)')
  })

  it('high = #ffedd5', () => {
    render(<BoardCard card={makeCard({ priority: 'high' })} />)
    const badge = screen.getByTestId('board-card-priority')
    expect((badge as HTMLElement).style.background).toBe('rgb(255, 237, 213)')
  })

  it('medium = #fef3c7', () => {
    render(<BoardCard card={makeCard({ priority: 'medium' })} />)
    const badge = screen.getByTestId('board-card-priority')
    expect((badge as HTMLElement).style.background).toBe('rgb(254, 243, 199)')
  })

  it('low = #dbeafe', () => {
    render(<BoardCard card={makeCard({ priority: 'low' })} />)
    const badge = screen.getByTestId('board-card-priority')
    expect((badge as HTMLElement).style.background).toBe('rgb(219, 234, 254)')
  })

  it('无 priority(null)= 灰态 - + data-priority=none', () => {
    render(<BoardCard card={makeCard({ priority: null })} />)
    const badge = screen.getByTestId('board-card-priority')
    expect(badge.getAttribute('data-priority')).toBe('none')
    expect(badge.textContent).toBe('-')
  })
})

describe('BoardCard · source 小标', () => {
  it('prd_split → PRD 拆', () => {
    render(<BoardCard card={makeCard({ source: 'prd_split' })} />)
    expect(screen.getByTestId('board-card-source').textContent).toBe('PRD 拆')
  })

  it('sub_split → 子拆', () => {
    render(<BoardCard card={makeCard({ source: 'sub_split' })} />)
    expect(screen.getByTestId('board-card-source').textContent).toBe('子拆')
  })

  it('manual → 手动', () => {
    render(<BoardCard card={makeCard({ source: 'manual' })} />)
    expect(screen.getByTestId('board-card-source').textContent).toBe('手动')
  })
})

describe('BoardCard · assignee 头像', () => {
  it('有 assignee → 首字母大写 + 渐变背景', () => {
    render(<BoardCard card={makeCard({ assignee: 'zhanglei' })} />)
    const av = screen.getByTestId('board-card-assignee')
    expect(av.textContent).toBe('ZH')
    expect(av.getAttribute('data-has-assignee')).toBe('true')
    expect((av as HTMLElement).style.background).toContain('linear-gradient')
  })

  it('无 assignee → placeholder +', () => {
    render(<BoardCard card={makeCard({ assignee: null })} />)
    const av = screen.getByTestId('board-card-assignee')
    expect(av.textContent).toBe('+')
    expect(av.getAttribute('data-has-assignee')).toBe('false')
  })
})

describe('BoardCard · 空内容', () => {
  it('content 为空 → 不渲染 summary', () => {
    render(<BoardCard card={makeCard({ content: '' })} />)
    expect(screen.queryByTestId('board-card-summary')).toBeNull()
  })
})

describe('BoardCard · 卡片菜单 delete', () => {
  it('onDelete 传入 → 渲染菜单按钮', () => {
    const onDelete = vi.fn()
    render(<BoardCard card={makeCard()} onDelete={onDelete} />)
    expect(screen.getByTestId('board-card-menu')).toBeInTheDocument()
  })

  it('点菜单 → 展开 dropdown → 点删除任务 → 调 onDelete(cardId)', () => {
    const onDelete = vi.fn()
    render(<BoardCard card={makeCard()} onDelete={onDelete} />)
    fireEvent.click(screen.getByTestId('board-card-menu'))
    expect(screen.getByTestId('board-card-menu-dropdown')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('board-card-menu-delete'))
    expect(onDelete).toHaveBeenCalledWith('01J7X3K2P5EVR0Z3YQJD8HFKX9')
  })

  it('无 onDelete → 不渲染菜单按钮', () => {
    render(<BoardCard card={makeCard()} />)
    expect(screen.queryByTestId('board-card-menu')).toBeNull()
  })
})

describe('BoardCard · 点击', () => {
  it('onClick 传入 → 卡片可点击(role=button)+ 触发回调', () => {
    const onClick = vi.fn()
    render(<BoardCard card={makeCard()} onClick={onClick} />)
    const card = screen.getByTestId('board-card')
    expect(card.getAttribute('role')).toBe('button')
    fireEvent.click(card)
    expect(onClick).toHaveBeenCalledWith('01J7X3K2P5EVR0Z3YQJD8HFKX9')
  })

  it('无 onClick → 不可点击(无 role=button)', () => {
    render(<BoardCard card={makeCard()} />)
    const card = screen.getByTestId('board-card')
    expect(card.getAttribute('role')).toBeNull()
  })
})
