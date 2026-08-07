/**
 * BoardSection 集成测试 — issue 07 / ADR-0027 D3
 *
 * 验收:
 * - SSR 注水 initialCards → 5 列分组正确(backlog/todo/in_progress/in_review/done)
 * - filter 切换 → onFilterChange 重渲染(filter chip active 切)
 * - toolbar [+ 新任务] → 打开 NewTaskModal
 * - 列头 + → 打开 NewTaskModal + 预填该列 status
 * - 卡片菜单 archive → useArchiveBoardCard mutate
 * - 空态(无卡 + filter=all)→ 渲染 EmptyState
 * - isError → 渲染错误态
 *
 * mock:vi.mock board-hooks 的 useBoardCards + useArchiveBoardCard。
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
  usePrdSplitRunDetail: () => ({ detail: null, isError: false, isLoading: false }),
  usePrdSplitRuns: () => ({ runs: [], isLoading: false, isError: false }),
  useLandPrdSplitCard: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}))

afterEach(() => {
  cleanup()
  mockCards = []
  mockIsError = false
  mockArchiveMutate.mockClear()
  mockCreateMutate.mockClear()
  mockPush.mockClear()
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function makeCard(id: string, status: TaskCard['status']): TaskCard {
  return {
    id,
    parent_id: 'req-test',
    status,
    title: `卡片 ${id}`,
    content: '内容',
    priority: 'medium',
    assignee: 'user-a',
    labels: ['security'],
    depends_on: [],
    order_index: null,
    source: 'manual',
    is_archived: false,
    created_at: '2026-08-07T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
    completed_at: null,
  }
}

function renderSection(props: Partial<React.ComponentProps<typeof BoardSection>> = {}) {
  return render(
    <BoardSection
      requirementId="req-007"
      initialCards={[]}
      initialTotal={0}
      {...props}
    />,
    { wrapper: makeWrapper() },
  )
}

describe('BoardSection · 5 列分组', () => {
  it('5 列全渲染(backlog/todo/in_progress/in_review/done)', () => {
    // 给 1 张卡避免命中空态(空态走 EmptyState 不渲染列)
    mockCards = [makeCard('c1', 'backlog')]
    renderSection()
    const cols = screen.getAllByTestId('board-column')
    expect(cols).toHaveLength(5)
    expect(cols[0].getAttribute('data-status')).toBe('backlog')
    expect(cols[1].getAttribute('data-status')).toBe('todo')
    expect(cols[2].getAttribute('data-status')).toBe('in_progress')
    expect(cols[3].getAttribute('data-status')).toBe('in_review')
    expect(cols[4].getAttribute('data-status')).toBe('done')
  })

  it('卡片按 status 分到对应列', () => {
    mockCards = [
      makeCard('c1', 'backlog'),
      makeCard('c2', 'in_progress'),
      makeCard('c3', 'done'),
    ]
    renderSection()
    const cols = screen.getAllByTestId('board-column')
    expect(cols[0].getAttribute('data-count')).toBe('1') // backlog
    expect(cols[1].getAttribute('data-count')).toBe('0') // todo
    expect(cols[2].getAttribute('data-count')).toBe('1') // in_progress
    expect(cols[3].getAttribute('data-count')).toBe('0') // in_review
    expect(cols[4].getAttribute('data-count')).toBe('1') // done
  })

  it('data-requirement-id + data-filter 属性', () => {
    mockCards = []
    renderSection()
    const root = screen.getByTestId('board-section')
    expect(root.getAttribute('data-requirement-id')).toBe('req-007')
    expect(root.getAttribute('data-filter')).toBe('all')
  })
})

describe('BoardSection · filter 切换', () => {
  it('点 mine chip → data-filter=mine + useBoardCards 收到 mine', () => {
    mockCards = []
    renderSection()
    fireEvent.click(screen.getByTestId('board-filter-chip-mine'))
    expect(mockFilter).toBe('mine')
    expect(screen.getByTestId('board-section').getAttribute('data-filter')).toBe('mine')
  })

  it('点 prd-split chip → useBoardCards 收到 prd-split', () => {
    mockCards = []
    renderSection()
    fireEvent.click(screen.getByTestId('board-filter-chip-prd-split'))
    expect(mockFilter).toBe('prd-split')
  })
})

describe('BoardSection · NewTaskModal', () => {
  it('[+ 新任务] → 打开 modal', () => {
    mockCards = [makeCard('c1', 'backlog')]
    renderSection()
    expect(screen.queryByTestId('board-new-task-modal')).toBeNull()
    fireEvent.click(screen.getByTestId('board-new-task'))
    expect(screen.getByTestId('board-new-task-modal')).toBeInTheDocument()
  })

  it('列头 + → 打开 modal(预填该列 status)', () => {
    mockCards = [makeCard('c1', 'backlog')]
    renderSection()
    const addButtons = screen.getAllByTestId('board-column-add')
    // 点 in_progress 列的 +(index 2)
    fireEvent.click(addButtons[2])
    expect(screen.getByTestId('board-new-task-modal')).toBeInTheDocument()
    const status = screen.getByTestId('board-new-task-status') as HTMLSelectElement
    expect(status.value).toBe('in_progress')
  })
})

describe('BoardSection · archive', () => {
  it('卡片菜单 archive → useArchiveBoardCard.mutate(cardId)', () => {
    mockCards = [makeCard('c1', 'backlog')]
    renderSection()
    fireEvent.click(screen.getByTestId('board-card-menu'))
    fireEvent.click(screen.getByTestId('board-card-menu-archive'))
    expect(mockArchiveMutate).toHaveBeenCalledWith('c1')
  })
})

describe('BoardSection · 空态 / 错误态', () => {
  it('无卡 + filter=all → 渲染 EmptyState', () => {
    mockCards = []
    renderSection()
    expect(screen.getByTestId('board-section-empty')).toBeInTheDocument()
  })

  it('无卡 + filter 非 all → 不渲染 EmptyState(走 5 列空列)', () => {
    mockCards = []
    renderSection()
    fireEvent.click(screen.getByTestId('board-filter-chip-mine'))
    expect(screen.queryByTestId('board-section-empty')).toBeNull()
    expect(screen.getAllByTestId('board-column')).toHaveLength(5)
  })

  it('isError → 渲染错误态', () => {
    mockIsError = true
    mockCards = []
    renderSection()
    expect(screen.getByTestId('board-section-error')).toBeInTheDocument()
    expect(screen.queryByTestId('board-column')).toBeNull()
  })
})
