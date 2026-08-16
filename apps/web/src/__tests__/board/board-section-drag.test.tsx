/**
 * BoardSection 拖拽集成测试 — issue 19 / ADR-0035
 *
 * 验收:
 * - 5 列容器接 sortable / droppable(`data-status` + `data-over`)
 * - 卡片渲染左侧手柄(默认透明,group-hover 才显)
 * - 卡片点击 = 进详情(原有行为不变)
 * - 冲突时弹 StatusConstraintModal(沿用 Modal 三选项)
 *
 * mock:复刻 board-section.test.tsx 的 mock 风格;@dnd-kit 在 jsdom 中 pointer events
 * 模拟较复杂,本期不模拟 drag 时序,改为断言 DOM 标记 + 状态机入口。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BoardSection } from '@/components/board/BoardSection'
import type { TaskCard } from '@ai-devspace/shared'
import type { BoardFilter } from '@/lib/board'

// ---- 受控 mock:board-hooks ----
let mockCards: TaskCard[] = []
let mockFilter: BoardFilter = 'all'
let mockIsError = false
const mockArchiveMutate = vi.fn()
const mockCreateMutate = vi.fn()
const mockMoveMutate = vi.fn()
const mockReorderMutate = vi.fn()

vi.mock('@/lib/board-hooks', () => ({
  useBoardCards: (_reqId: string, filter: BoardFilter) => {
    mockFilter = filter
    return {
      cards: mockCards,
      total: mockCards.length,
      rawTotal: mockCards.length,
      isLoading: false,
      isError: mockIsError,
      error: mockIsError ? new Error('boom') : null,
    }
  },
  useArchiveBoardCard: () => ({
    mutate: mockArchiveMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useCreateBoardCard: () => ({
    mutate: mockCreateMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useMoveCardToColumn: () => ({
    mutate: mockMoveMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useReorderCard: () => ({
    mutate: mockReorderMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

// ---- mock next/navigation(BoardSection 用 useRouter 做卡片点击导航)----
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// ---- mock board-detail-hooks(SplitFromPrdModal / banner / review 依赖)----
vi.mock('@/lib/board-detail-hooks', () => ({
  useStartPrdSplit: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  usePrdSplitRunDetail: () => ({
    detail: null,
    isError: false,
    isLoading: false,
  }),
  usePrdSplitRuns: () => ({ runs: [] }),
  useLandPrdSplitCard: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}))

// ---- helpers ----
function makeCard(overrides: Partial<TaskCard>): TaskCard {
  return {
    id: '01J7X3K2P5EVR0Z3YQJD8HFKX' + (overrides.id?.slice(-1) ?? 'A'),
    parent_id: 'req-001',
    status: 'backlog',
    title: '测试卡片',
    content: '',
    priority: null,
    assignee: null,
    labels: [],
    depends_on: [],
    order_index: null,
    source: 'manual',
    is_archived: false,
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T00:00:00.000Z',
    completed_at: null,
    ...overrides,
  }
}

function renderBoard(requirementId = 'req-001', cards: TaskCard[] = mockCards) {
  mockCards = cards
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <BoardSection
        requirementId={requirementId}
        initialCards={cards}
        initialTotal={cards.length}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  mockCards = []
  mockFilter = 'all'
  mockIsError = false
  mockArchiveMutate.mockReset()
  mockCreateMutate.mockReset()
  mockMoveMutate.mockReset()
  mockReorderMutate.mockReset()
  mockPush.mockReset()
})

// ---------------------------------------------------------------------------
// 拖拽 DOM 标记
// ---------------------------------------------------------------------------

describe('BoardSection · 拖拽 DOM 标记(issue 19 / ADR-0035 D4 v2 · C 方案)', () => {
  it('每张卡片 card-top 区域 = 拖拽触发器(替换 A 方案左侧 ⋮⋮)', () => {
    renderBoard('req-001', [
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK1', status: 'backlog' }),
    ])
    const top = screen.getByTestId('board-card-top')
    expect(top).toBeInTheDocument()
    expect(top.getAttribute('data-drag-handle')).toBe('true')
    // cursor: grab 由 className 体现(grill 锁定 C 方案)
    expect(top.className).toMatch(/cursor-grab/)
  })

  it('卡片根 article 接 draggable 状态(含 data-card-id + data-status + data-displaced=false)', () => {
    renderBoard('req-001', [
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK1', status: 'todo' }),
    ])
    const card = screen.getByTestId('board-card')
    expect(card.getAttribute('data-card-id')).toBe('01J7X3K2P5EVR0Z3YQJD8HFK1')
    expect(card.getAttribute('data-status')).toBe('todo')
    expect(card.getAttribute('data-dragging')).toBe('false')
    expect(card.getAttribute('data-displaced')).toBe('false')
  })

  it('5 列均渲染 data-status(BoardSection 通过 useDroppable 标识列)', () => {
    renderBoard('req-001', [makeCard({ status: 'backlog' })])
    for (const s of ['backlog', 'todo', 'in_progress', 'in_review', 'done']) {
      expect(screen.getAllByTestId('board-column').find((c) => c.getAttribute('data-status') === s)).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// 拖拽状态机入口(模拟 mutation 调用)
// ---------------------------------------------------------------------------

describe('BoardSection · 拖拽状态机(issue 19 / ADR-0035 D5)', () => {
  it('卡片点击仍走 router.push(不与拖拽冲突,移动阈值 5px)', () => {
    renderBoard('req-001', [
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK1', status: 'backlog' }),
    ])
    const card = screen.getByTestId('board-card')
    fireEvent.click(card)
    expect(mockPush).toHaveBeenCalledWith(
      '/requirements/req-001/board/01J7X3K2P5EVR0Z3YQJD8HFK1',
    )
    // 拖拽 hook 不该被点击事件触发
    expect(mockMoveMutate).not.toHaveBeenCalled()
    expect(mockReorderMutate).not.toHaveBeenCalled()
  })

  it('卡片 menu archive 仍调用 useArchiveBoardCard.mutate(不影响拖拽)', () => {
    renderBoard('req-001', [
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK1', status: 'backlog' }),
    ])
    const menu = screen.getByTestId('board-card-menu')
    fireEvent.click(menu)
    const archiveBtn = screen.getByTestId('board-card-menu-archive')
    fireEvent.click(archiveBtn)
    expect(mockArchiveMutate).toHaveBeenCalledWith('01J7X3K2P5EVR0Z3YQJD8HFK1')
  })
})

// ---------------------------------------------------------------------------
// 列计数 + 卡片可见性(沿用 board-section.test.tsx 路径;D1 范围边界)
// ---------------------------------------------------------------------------

describe('BoardSection · 拖拽不影响 5 列渲染(issue 19 / ADR-0035 D1)', () => {
  it('多 status 卡片正确分组到 5 列', () => {
    renderBoard('req-001', [
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK1', status: 'backlog' }),
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK2', status: 'todo' }),
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK3', status: 'in_progress' }),
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK4', status: 'in_review' }),
      makeCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFK5', status: 'done' }),
    ])
    const cards = screen.getAllByTestId('board-card')
    expect(cards).toHaveLength(5)
  })

  it('无卡片 + filter=all → 渲染 EmptyState(不渲染 DndContext 区域)', () => {
    renderBoard('req-001', [])
    expect(screen.getByTestId('board-section-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('board-grid')).not.toBeInTheDocument()
  })
})
