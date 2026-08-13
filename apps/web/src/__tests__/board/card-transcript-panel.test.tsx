/**
 * CardTranscriptPanel 组件测试 — issue 07 / ADR-0029
 *
 * 验收(Seam 3):
 * - head 渲染(标题 + SDK session badge + ✕)
 * - snapshot 加载 + meta 渲染
 * - ✕ → onClose
 * - 输入框 textarea + 发送按钮 + ↵ 发送(Shift+↵ 换行)
 * - 空内容 → 发送 disabled
 *
 * mock 策略:mock `board-chat-hooks` 全部 hooks
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type {
  ChatSessionEvent,
  ChatSessionMeta,
  ChatSessionSnapshotResponse,
  TaskCard,
} from '@ai-devspace/shared'

// ---- helpers ----
const REQ_ID = 'req-001-board-chat-test'
const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKX9'
const SESSION_ID_LOCAL = 'sess-abc-123'

function makeCard(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: CARD_ID,
    parent_id: REQ_ID,
    status: 'in_progress',
    title: '主卡',
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

function makeMeta(overrides: Partial<ChatSessionMeta> = {}): ChatSessionMeta {
  return {
    sessionId: SESSION_ID_LOCAL,
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
    queryCount: 3,
    ownerUserId: 'user-1',
    cumulativeUsage: {
      cumulativeCostUsd: 0.42,
      cumulativeInputTokens: 1234,
      cumulativeOutputTokens: 567,
      cumulativeCacheReadTokens: 89,
    },
    ...overrides,
  }
}

function makeSnapshot(
  meta: ChatSessionMeta | null,
  events: ChatSessionEvent[] = [],
): ChatSessionSnapshotResponse {
  return { meta, events }
}

// ---- mock board-chat-hooks ----
const metaForMock = makeMeta()
const mockStartMutate = vi.fn().mockResolvedValue({ meta: metaForMock })
const mockQueryMutate = vi.fn().mockResolvedValue(undefined)
const mockResolvePermission = vi.fn().mockResolvedValue(undefined)
const mockSwitchModel = vi.fn().mockResolvedValue({ meta: metaForMock })
const mockTogglePlanMode = vi.fn().mockResolvedValue({ meta: metaForMock })
const mockResolveCostCap = vi.fn().mockResolvedValue(undefined)

const mockUseChatSessionSnapshot = vi.fn()
const mockUseChatSessionStream = vi.fn()
const mockUseChatSessionLock = vi.fn()

vi.mock('@/lib/board-chat-hooks', () => ({
  useChatSessionSnapshot: (...args: unknown[]) =>
    mockUseChatSessionSnapshot(...args),
  useChatSessionStream: (...args: unknown[]) =>
    mockUseChatSessionStream(...args),
  useChatSessionLock: (...args: unknown[]) => mockUseChatSessionLock(...args),
  useChatSessionStart: () => ({
    mutateAsync: mockStartMutate,
    isPending: false,
  }),
  useChatQuery: () => ({
    mutateAsync: mockQueryMutate,
    isPending: false,
  }),
  useChatPermission: () => ({
    mutateAsync: mockResolvePermission,
    isPending: false,
  }),
  useChatModelSwitch: () => ({
    mutateAsync: mockSwitchModel,
    isPending: false,
  }),
  useChatPlanMode: () => ({
    mutateAsync: mockTogglePlanMode,
    isPending: false,
  }),
  useChatPermissionMode: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useChatCostCap: () => ({
    mutateAsync: mockResolveCostCap,
    isPending: false,
  }),
}))

import { CardTranscriptPanel } from '@/components/board/detail/CardTranscriptPanel'

function setupDefaultMocks(): void {
  mockUseChatSessionSnapshot.mockReturnValue({
    snapshot: makeSnapshot(null),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
  mockUseChatSessionStream.mockReturnValue({
    events: [],
    status: 'idle',
    send: vi.fn(),
    abort: vi.fn(),
  })
  mockUseChatSessionLock.mockReturnValue({ lockedByOtherTab: false })
}

function wrap(node: ReactNode): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setupDefaultMocks()
})

afterEach(() => {
  cleanup()
})

describe('CardTranscriptPanel · 渲染', () => {
  it('head 渲染 标题 + SDK session badge + ✕', () => {
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-head')).toHaveTextContent('AI 协作')
    expect(screen.getByTestId('board-chat-badge')).toHaveTextContent('SDK session')
    expect(screen.getByTestId('board-chat-close')).toBeInTheDocument()
  })

  it('snapshot 含 meta → UsageBar 渲染 model + cost', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-usage-bar')).toHaveTextContent(
      'claude-sonnet-5',
    )
    expect(screen.getByTestId('board-chat-usage-bar')).toHaveTextContent('$0.42')
  })

  it('✕ → onClose', () => {
    const onClose = vi.fn()
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByTestId('board-chat-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('CardTranscriptPanel · 输入框', () => {
  it('textarea + 发送按钮渲染', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-textarea')).toBeInTheDocument()
    expect(screen.getByTestId('board-chat-send')).toBeInTheDocument()
  })

  it('空内容 → 发送 disabled', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-send')).toBeDisabled()
  })

  it('输入内容 + 点击发送 → send(content)', async () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    const sendFn = vi.fn().mockResolvedValue(undefined)
    mockUseChatSessionStream.mockReturnValue({
      events: [],
      status: 'idle',
      send: sendFn,
      abort: vi.fn(),
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const ta = screen.getByTestId('board-chat-textarea') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '新消息' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-chat-send'))
    })
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({ content: '新消息' }),
    )
  })

  it('Enter → 发送', async () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    const sendFn = vi.fn().mockResolvedValue(undefined)
    mockUseChatSessionStream.mockReturnValue({
      events: [],
      status: 'idle',
      send: sendFn,
      abort: vi.fn(),
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const ta = screen.getByTestId('board-chat-textarea') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '快捷键消息' } })
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({ content: '快捷键消息' }),
    )
  })

  it('Shift+Enter 不发送(走默认换行行为)', async () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    const sendFn = vi.fn().mockResolvedValue(undefined)
    mockUseChatSessionStream.mockReturnValue({
      events: [],
      status: 'idle',
      send: sendFn,
      abort: vi.fn(),
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const ta = screen.getByTestId('board-chat-textarea') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '换行回车' } })
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    })
    expect(sendFn).not.toHaveBeenCalled()
  })
})