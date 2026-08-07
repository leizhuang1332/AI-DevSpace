/**
 * CardSideProperty 组件测试 — issue 08 / ADR-0027 D5.1
 *
 * 验收:
 * - [💬 在对话中打开] toggle 按钮渲染 + 点击触发
 * - 属性表 8 行(status/priority/assignee/labels + workflow/dev-context/due-date/repeat 占位)
 * - 关系区(阻塞于/阻塞/相关议题)
 * - 创建/更新 meta block
 * - status select 改 → onStatusChange
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CardSideProperty } from '@/components/board/detail/CardSideProperty'
import type { TaskCard } from '@ai-devspace/shared'

const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKX9'
const DEP_ID = '01J7X3K2P5EVR0Z3YQJD8HFEFG'
const BLOCKED_ID = '01J7X3K2P5EVR0Z3YQJD8HFEHI'

function makeCard(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: CARD_ID,
    parent_id: 'req-1',
    status: 'in_progress',
    title: '主卡',
    content: '',
    priority: 'high',
    assignee: 'zh',
    labels: ['security'],
    depends_on: [DEP_ID],
    order_index: null,
    source: 'manual',
    is_archived: false,
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
    completed_at: null,
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('CardSideProperty · 渲染', () => {
  it('[💬 在对话中打开] toggle 按钮渲染', () => {
    render(
      <CardSideProperty
        card={makeCard()}
        cards={[]}
        onToggleTranscript={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-toggle-transcript')).toHaveTextContent(
      '在对话中打开',
    )
  })

  it('属性表 8 行渲染', () => {
    render(
      <CardSideProperty
        card={makeCard()}
        cards={[]}
        onToggleTranscript={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-prop-status')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-prop-priority')).toHaveTextContent('High')
    expect(screen.getByTestId('board-detail-prop-assignee')).toHaveTextContent('zh')
    expect(screen.getByTestId('board-detail-prop-labels')).toHaveTextContent('security')
    expect(screen.getByTestId('board-detail-prop-workflow')).toHaveTextContent('未绑定')
    expect(screen.getByTestId('board-detail-prop-dev-context')).toHaveTextContent('未绑定')
    expect(screen.getByTestId('board-detail-prop-due-date')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-prop-repeat')).toHaveTextContent('不重复')
  })

  it('关系区:阻塞于/阻塞/相关议题', () => {
    const dep = makeCard({ id: DEP_ID, title: '依赖卡' })
    const blocked = makeCard({ id: BLOCKED_ID, title: '阻塞卡', depends_on: [CARD_ID] })
    const card = makeCard({ depends_on: [DEP_ID] })
    render(
      <CardSideProperty
        card={card}
        cards={[card, dep, blocked]}
        onToggleTranscript={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-rel-blocked-by')).toHaveTextContent('依赖卡')
    expect(screen.getByTestId('board-detail-rel-blocks')).toHaveTextContent('阻塞卡')
    expect(screen.getByTestId('board-detail-rel-related')).toHaveTextContent('无')
  })

  it('创建/更新 meta block', () => {
    render(
      <CardSideProperty
        card={makeCard()}
        cards={[]}
        onToggleTranscript={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-meta-block')).toHaveTextContent('创建于')
    expect(screen.getByTestId('board-detail-meta-block')).toHaveTextContent('更新于')
  })
})

describe('CardSideProperty · 交互', () => {
  it('toggle 按钮点击 → onToggleTranscript', () => {
    const onToggleTranscript = vi.fn()
    render(
      <CardSideProperty
        card={makeCard()}
        cards={[]}
        onToggleTranscript={onToggleTranscript}
      />,
    )
    fireEvent.click(screen.getByTestId('board-detail-toggle-transcript'))
    expect(onToggleTranscript).toHaveBeenCalledTimes(1)
  })

  it('status select 改 → onStatusChange', () => {
    const onStatusChange = vi.fn()
    render(
      <CardSideProperty
        card={makeCard({ status: 'backlog' })}
        cards={[]}
        onToggleTranscript={vi.fn()}
        onStatusChange={onStatusChange}
      />,
    )
    fireEvent.change(screen.getByTestId('board-detail-prop-status-select'), {
      target: { value: 'in_progress' },
    })
    expect(onStatusChange).toHaveBeenCalledWith('in_progress')
  })
})
