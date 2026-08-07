/**
 * CardDetail 组件测试 — issue 08 / ADR-0027 D5
 *
 * 验收:
 * - task-title row 渲染 shortCardId + title + archive/more
 * - 6 chip 行(status/priority/source/assignee/created/updated)
 * - 父进度条(done/total)
 * - Content Markdown 渲染
 * - 子任务列表(filterSubtasks)
 * - 依赖卡列表(filterDependencies)
 * - 详细信息折叠块(8 冷字段)
 * - status select 改 → onStatusChange 回调
 * - archive btn → onArchive 回调
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CardDetail } from '@/components/board/detail/CardDetail'
import type { TaskCard } from '@ai-devspace/shared'

// card id 用 26 字符 ULID 形态(满足 shortCardId 取末 4)
const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKX9'
const SUB_ID_1 = '01J7X3K2P5EVR0Z3YQJD8HFAB'
const SUB_ID_2 = '01J7X3K2P5EVR0Z3YQJD8HFCD'
const DEP_ID = '01J7X3K2P5EVR0Z3YQJD8HFEFG'

function makeCard(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: CARD_ID,
    parent_id: 'req-1',
    status: 'in_progress',
    title: '主卡标题',
    content: '## 验收\n1. 第一条\n2. 第二条',
    priority: 'high',
    assignee: 'zh',
    labels: ['security', 'backend'],
    depends_on: [DEP_ID],
    order_index: null,
    source: 'prd_split',
    is_archived: false,
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
    completed_at: null,
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('CardDetail · 渲染', () => {
  it('task-title row 渲染 shortCardId + title + archive/more', () => {
    render(
      <CardDetail
        card={makeCard()}
        cards={[]}
        parentSummary={null}
        onArchive={vi.fn()}
      />,
    )
    // shortCardId 取 ULID 末 4 位(FKX9)
    expect(screen.getByTestId('board-detail-id')).toHaveTextContent('FKX9')
    expect(screen.getByTestId('board-detail-title')).toHaveTextContent('主卡标题')
    expect(screen.getByTestId('board-detail-archive')).toBeInTheDocument()
  })

  it('6 chip 行全部渲染', () => {
    render(
      <CardDetail
        card={makeCard()}
        cards={[]}
        parentSummary={null}
        onStatusChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-priority-chip')).toHaveTextContent('High')
    expect(screen.getByTestId('board-detail-source-chip')).toHaveTextContent('PRD 拆')
    expect(screen.getByTestId('board-detail-assignee-chip')).toHaveTextContent('zh')
    expect(screen.getByTestId('board-detail-created-chip')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-updated-chip')).toBeInTheDocument()
    // status chip(有 onStatusChange → 渲染 select)
    expect(screen.getByTestId('board-detail-status-select')).toBeInTheDocument()
  })

  it('父进度条显示 done/total', () => {
    const cards = [
      makeCard({ id: 'a', status: 'done' }),
      makeCard({ id: 'b', status: 'done' }),
      makeCard({ id: 'c', status: 'in_progress' }),
    ]
    render(<CardDetail card={cards[2]!} cards={cards} parentSummary={null} />)
    expect(screen.getByTestId('board-detail-progress')).toHaveTextContent(
      '2 / 3 卡',
    )
  })

  it('Content Markdown 渲染', () => {
    render(<CardDetail card={makeCard()} cards={[]} parentSummary={null} />)
    expect(screen.getByTestId('board-detail-markdown')).toBeInTheDocument()
    expect(screen.getByText('验收')).toBeInTheDocument()
  })

  it('子任务列表渲染(filterSubtasks)', () => {
    const card = makeCard({ id: CARD_ID })
    const sub1 = makeCard({ id: SUB_ID_1, parent_id: CARD_ID, title: '子任务1' })
    const sub2 = makeCard({ id: SUB_ID_2, parent_id: CARD_ID, title: '子任务2' })
    const other = makeCard({ id: 'OTHER', parent_id: 'req-1' })
    render(<CardDetail card={card} cards={[card, sub1, sub2, other]} parentSummary={null} />)
    expect(screen.getByTestId('board-detail-subtasks')).toHaveTextContent('子任务1')
    expect(screen.getByTestId('board-detail-subtasks')).toHaveTextContent('子任务2')
  })

  it('依赖卡列表渲染(filterDependencies)', () => {
    const dep = makeCard({ id: DEP_ID, title: '依赖卡标题' })
    const card = makeCard({ depends_on: [DEP_ID] })
    render(<CardDetail card={card} cards={[card, dep]} parentSummary={null} />)
    expect(screen.getByTestId('board-detail-deps')).toHaveTextContent('依赖卡标题')
  })

  it('详细信息折叠块渲染 8 冷字段', () => {
    render(<CardDetail card={makeCard()} cards={[]} parentSummary={null} />)
    const fold = screen.getByTestId('board-detail-fold')
    expect(fold).toBeInTheDocument()
    expect(fold).toHaveTextContent('labels')
    expect(fold).toHaveTextContent('depends_on')
    expect(fold).toHaveTextContent('order_index')
    expect(fold).toHaveTextContent('created_at')
    expect(fold).toHaveTextContent('updated_at')
    expect(fold).toHaveTextContent('completed_at')
    expect(fold).toHaveTextContent('is_archived')
    expect(fold).toHaveTextContent('parent_id')
  })
})

describe('CardDetail · 交互', () => {
  it('status select 改 → onStatusChange', () => {
    const onStatusChange = vi.fn()
    render(
      <CardDetail
        card={makeCard({ status: 'backlog' })}
        cards={[]}
        parentSummary={null}
        onStatusChange={onStatusChange}
      />,
    )
    fireEvent.change(screen.getByTestId('board-detail-status-select'), {
      target: { value: 'in_progress' },
    })
    expect(onStatusChange).toHaveBeenCalledWith('in_progress')
  })

  it('archive btn → onArchive', () => {
    const onArchive = vi.fn()
    render(
      <CardDetail
        card={makeCard()}
        cards={[]}
        parentSummary={null}
        onArchive={onArchive}
      />,
    )
    fireEvent.click(screen.getByTestId('board-detail-archive'))
    expect(onArchive).toHaveBeenCalledTimes(1)
  })

  it('无 onArchive 时不渲染 archive btn', () => {
    render(<CardDetail card={makeCard()} cards={[]} parentSummary={null} />)
    expect(screen.queryByTestId('board-detail-archive')).not.toBeInTheDocument()
  })

  it('空 content 不渲染 Content section', () => {
    render(
      <CardDetail card={makeCard({ content: '' })} cards={[]} parentSummary={null} />,
    )
    expect(screen.queryByTestId('board-detail-content-section')).not.toBeInTheDocument()
  })
})
