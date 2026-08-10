/**
 * BoardCardDetailPage 组件测试 — issue 07 / ADR-0027 D5 + ADR-0028 D5 + ADR-0029
 *
 * 验收:
 * - 渲染 card + crumb + 左主区 + 右栏默认态(property)
 * - toggle:点 [在对话中打开] → data-right-panel='transcript'
 * - toggle:点 ✕ → data-right-panel='property'
 * - toggle 不持久化(不写 localStorage)
 * - status 变更 → statusMutation mutate;res.ok=false → 弹 StatusConstraintModal
 * - StatusConstraintModal 选项 A/B/C
 * - 切到 chat panel 后 SDK session 输入 + 发送走 stream hook
 *
 * mock:vi.mock board-detail-hooks + board-chat-hooks + next/navigation useRouter
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type {
  TaskCard,
  TaskCardTranscript,
  ChatSessionMeta,
  ChatSessionSnapshotResponse,
  ChatSessionEvent,
} from '@ai-devspace/shared'
import { BoardCardDetailPage } from '@/components/board/detail/BoardCardDetailPage'

const REQ_ID = 'req-1'
const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKX9'
const SESSION_ID = 'sess-1'

function makeCard(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: CARD_ID,
    parent_id: REQ_ID,
    status: 'in_progress',
    title: '测试卡',
    content: '内容',
    priority: 'high',
    assignee: 'zh',
    labels: ['sec'],
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

function makeMeta(): ChatSessionMeta {
  return {
    sessionId: SESSION_ID,
    requirementId: REQ_ID,
    cardId: CARD_ID,
    cwd: `/tmp/board/tasks/${CARD_ID}`,
    additionalDirectories: [],
    model: 'claude-sonnet-5',
    permissionMode: 'default',
    permissionPromptToolName: 'mcp__boardchat__user_confirm',
    mcpServers: [],
    createdAt: '2026-08-07T00:00:00Z',
    lastQueryAt: '2026-08-07T00:00:00Z',
    queryCount: 0,
    ownerUserId: 'user-1',
    cumulativeUsage: {
      cumulativeCostUsd: 0,
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
      cumulativeCacheReadTokens: 0,
    },
  }
}

// ---- 受控 mock:board-detail-hooks ----
let mockCard: TaskCard | null = null
let mockCards: TaskCard[] = []
let mockTranscript: TaskCardTranscript | null = null
const mockStatusMutate = vi.fn()
const mockStatusMutation = {
  mutate: mockStatusMutate,
  mutateAsync: mockStatusMutate,
  isPending: false,
  isError: false,
  error: null,
}
const mockArchiveMutate = vi.fn()
const mockArchiveMutation = {
  mutate: mockArchiveMutate,
  isPending: false,
  isError: false,
  error: null,
}

vi.mock('@/lib/board-detail-hooks', () => ({
  useBoardCardDetail: () => ({ card: mockCard, isLoading: false, isError: false, error: null }),
  useBoardCardsForDetail: () => ({ cards: mockCards, isLoading: false, isError: false }),
  useParentRequirement: () => ({
    summary: { id: 'req-1', title: '父需求', status: 'implementing', progress: 40, repos: [], createdAt: '', updatedAt: '' },
    isLoading: false,
    isError: false,
  }),
  useCardTranscript: () => ({ transcript: mockTranscript, isLoading: false, isError: false }),
  useUpdateCardStatus: () => mockStatusMutation,
  useArchiveBoardCard: () => mockArchiveMutation,
}))

// ---- 受控 mock:board-chat-hooks(简化版)----
const mockSnapshot: ChatSessionSnapshotResponse = { meta: makeMeta(), events: [] as ChatSessionEvent[] }
const mockStreamSend = vi.fn().mockResolvedValue(undefined)
const mockStart = vi.fn().mockResolvedValue({ meta: makeMeta() })

vi.mock('@/lib/board-chat-hooks', () => ({
  useChatSessionSnapshot: () => ({
    snapshot: mockSnapshot,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useChatSessionStream: () => ({
    events: [],
    status: 'idle',
    send: mockStreamSend,
    abort: vi.fn(),
  }),
  useChatSessionLock: () => ({ lockedByOtherTab: false }),
  useChatSessionStart: () => ({ mutateAsync: mockStart, isPending: false }),
  useChatQuery: () => ({ mutateAsync: mockStreamSend, isPending: false }),
  useChatPermission: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatModelSwitch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatPlanMode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatPermissionMode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatCostCap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

afterEach(() => {
  cleanup()
  mockCard = null
  mockCards = []
  mockTranscript = null
  mockStatusMutate.mockClear()
  mockArchiveMutate.mockClear()
  mockStreamSend.mockClear()
  mockPush.mockClear()
  mockStatusMutation.isPending = false
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function renderPage(props: Partial<React.ComponentProps<typeof BoardCardDetailPage>> = {}) {
  return render(
    <BoardCardDetailPage
      requirementId={REQ_ID}
      cardId={CARD_ID}
      initialCard={mockCard ?? undefined}
      {...props}
    />,
    { wrapper: makeWrapper() },
  )
}

describe('BoardCardDetailPage · 渲染', () => {
  it('渲染 card + crumb + 左主区 + 右栏默认态', () => {
    mockCard = makeCard()
    renderPage()
    expect(screen.getByTestId('board-card-detail-page')).toHaveAttribute(
      'data-right-panel',
      'property',
    )
    expect(screen.getByTestId('board-card-detail-crumb')).toHaveTextContent('父需求')
    expect(screen.getByTestId('board-card-detail')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-side-property')).toBeInTheDocument()
  })

  it('card 未就绪 → loading', () => {
    mockCard = null
    renderPage()
    expect(screen.getByTestId('board-card-detail-loading')).toBeInTheDocument()
  })
})

describe('BoardCardDetailPage · toggle', () => {
  it('点 [在对话中打开] → data-right-panel=transcript + board-chat-panel', () => {
    mockCard = makeCard()
    renderPage()
    fireEvent.click(screen.getByTestId('board-detail-toggle-transcript'))
    expect(screen.getByTestId('board-card-detail-page')).toHaveAttribute(
      'data-right-panel',
      'transcript',
    )
    expect(screen.getByTestId('board-chat-panel')).toBeInTheDocument()
  })

  it('点 ✕ → data-right-panel=property', () => {
    mockCard = makeCard()
    renderPage()
    fireEvent.click(screen.getByTestId('board-detail-toggle-transcript'))
    expect(screen.getByTestId('board-card-detail-page')).toHaveAttribute(
      'data-right-panel',
      'transcript',
    )
    fireEvent.click(screen.getByTestId('board-chat-close'))
    expect(screen.getByTestId('board-card-detail-page')).toHaveAttribute(
      'data-right-panel',
      'property',
    )
  })

  it('toggle 不持久化(不写 localStorage)', () => {
    mockCard = makeCard()
    renderPage()
    fireEvent.click(screen.getByTestId('board-detail-toggle-transcript'))
    fireEvent.click(screen.getByTestId('board-chat-close'))
    expect(window.localStorage.getItem('board-card-side-state')).toBeNull()
  })

  it('crumb 点击回 board → router.push', () => {
    mockCard = makeCard()
    renderPage()
    fireEvent.click(screen.getByText('父需求'))
    expect(mockPush).toHaveBeenCalledWith('/requirements/req-1/board/')
  })
})

describe('BoardCardDetailPage · status 冲突流', () => {
  it('status 变更 → mutate {override:false}', () => {
    mockCard = makeCard({ status: 'backlog' })
    renderPage()
    fireEvent.change(screen.getByTestId('board-detail-status-select'), {
      target: { value: 'in_progress' },
    })
    expect(mockStatusMutate).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: CARD_ID, status: 'in_progress', override: false }),
      expect.any(Object),
    )
  })

  it('res.ok=false → 弹 StatusConstraintModal', async () => {
    mockCard = makeCard({ status: 'backlog' })
    mockStatusMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.({
        ok: false,
        conflicts: [{ card_id: CARD_ID, card_status: 'backlog', rule: 'no_backlog_for_implementing' }],
        parent_status: 'implementing',
      })
    })
    renderPage()
    fireEvent.change(screen.getByTestId('board-detail-status-select'), {
      target: { value: 'in_progress' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('board-status-constraint-modal')).toBeInTheDocument()
    })
    expect(screen.getByTestId('board-status-constraint-modal')).toHaveTextContent(
      'implementing',
    )
  })

  it('选项 A 强制切换 → mutate {override:true}', async () => {
    mockCard = makeCard({ status: 'backlog' })
    mockStatusMutate.mockImplementation((_input, opts) => {
      if (_input.override === false) {
        opts?.onSuccess?.({
          ok: false,
          conflicts: [{ card_id: CARD_ID, card_status: 'backlog', rule: 'no_backlog_for_implementing' }],
          parent_status: 'implementing',
        })
      } else {
        opts?.onSuccess?.()
      }
    })
    renderPage()
    fireEvent.change(screen.getByTestId('board-detail-status-select'), {
      target: { value: 'in_progress' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('board-status-constraint-modal')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('board-status-modal-force'))
    await waitFor(() => {
      expect(mockStatusMutate).toHaveBeenCalledWith(
        expect.objectContaining({ override: true }),
        expect.any(Object),
      )
    })
  })

  it('选项 B 调整子卡 → router.push 回 board', async () => {
    mockCard = makeCard({ status: 'backlog' })
    mockStatusMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.({
        ok: false,
        conflicts: [{ card_id: CARD_ID, card_status: 'backlog', rule: 'no_backlog_for_implementing' }],
        parent_status: 'implementing',
      })
    })
    renderPage()
    fireEvent.change(screen.getByTestId('board-detail-status-select'), {
      target: { value: 'in_progress' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('board-status-constraint-modal')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('board-status-modal-adjust'))
    expect(mockPush).toHaveBeenCalledWith('/requirements/req-1/board/')
  })

  it('选项 C 取消 → 关闭 modal', async () => {
    mockCard = makeCard({ status: 'backlog' })
    mockStatusMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.({
        ok: false,
        conflicts: [{ card_id: CARD_ID, card_status: 'backlog', rule: 'no_backlog_for_implementing' }],
        parent_status: 'implementing',
      })
    })
    renderPage()
    fireEvent.change(screen.getByTestId('board-detail-status-select'), {
      target: { value: 'in_progress' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('board-status-constraint-modal')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('board-status-modal-cancel'))
    expect(screen.queryByTestId('board-status-constraint-modal')).not.toBeInTheDocument()
  })
})

describe('BoardCardDetailPage · chat 发送', () => {
  it('切到 chat + 输入 + 发送 → stream.send(content)', async () => {
    mockCard = makeCard()
    renderPage()
    fireEvent.click(screen.getByTestId('board-detail-toggle-transcript'))
    const ta = screen.getByTestId('board-chat-textarea') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '测试消息' } })
    fireEvent.click(screen.getByTestId('board-chat-send'))
    await waitFor(() => {
      expect(mockStreamSend).toHaveBeenCalledWith(
        expect.objectContaining({ content: '测试消息' }),
      )
    })
  })
})