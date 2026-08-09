/**
 * Board chat panel 集成组件测试 — issue 07 / ADR-0029 D8 + D9 + D10 + D14 + D15
 *
 * 验收(Seam 3 · web 组件):
 * - CardTranscriptPanel 顶层结构(UsageBar + MessageStream + Input)
 * - UsageBar 渲染 model / tokens / cost / turns / duration + sub-agent tokens
 * - UsageBar 内 plan mode toggle + model switch dropdown
 * - MessageStream 渲染 user / assistant bubbles + 嵌入 SubAgentBlock
 * - MessageStream 渲染 ToolCallBubble(进行中 spinner + 完成 result)
 * - chat_permission_request → PermissionPrompt modal + 3 选项
 * - chat_permission_resolved → modal 关闭
 * - CostCapModal 4 选项
 * - 单 tab lock display(第二 tab 看到 "⚠️ 已在另一 tab 打开")
 * - 旧 transcript.yaml 折叠 banner
 * - 输入框发消息 → useChatQuery 被调
 *
 * mock 策略:
 * - mock `board-chat-hooks`(全部 hooks) → 不接真实 fetch
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

// ---- helpers(先于 mocks 定义,避免 hoisting 报 "before initialization") ----
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
  useChatCostCap: () => ({
    mutateAsync: mockResolveCostCap,
    isPending: false,
  }),
}))

import { CardTranscriptPanel } from '@/components/board/detail/CardTranscriptPanel'

/** 默认 hook 桩:空 snapshot、无 lock、无 stream。 */
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

// ---------------------------------------------------------------------------
// 顶层结构
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · 顶层结构', () => {
  it('head 渲染 + 模型 / token / cost 信息', () => {
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
    expect(screen.getByTestId('board-chat-panel')).toBeInTheDocument()
    expect(screen.getByTestId('board-chat-usage-bar')).toBeInTheDocument()
    expect(screen.getByTestId('board-chat-message-stream')).toBeInTheDocument()
    expect(screen.getByTestId('board-chat')).toBeInTheDocument()
    const usage = screen.getByTestId('board-chat-usage-bar')
    expect(usage).toHaveTextContent('claude-sonnet-5')
    expect(usage).toHaveTextContent('$0.42')
  })

  it('无 snapshot → 顶部 banner "新的 SDK session" + 空消息流', () => {
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-banner')).toHaveTextContent(
      'SDK session',
    )
    expect(screen.getByTestId('board-chat-message-stream')).toHaveTextContent(
      '还没有对话',
    )
  })

  it('hasLegacyTranscript → 折叠 banner 显示', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'chat_message_user',
          ts: Date.now(),
          content: [{ kind: 'text', text: '旧的描述型对话' }],
        },
      ]),
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
        hasLegacyTranscript
      />,
    )
    expect(screen.getByTestId('board-chat-legacy-fold')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// UsageBar · model + plan mode toggle
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · UsageBar', () => {
  it('plan mode toggle 默认 off,点击 → 调 useChatPlanMode', async () => {
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
    const toggle = screen.getByTestId('board-chat-plan-toggle')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(mockTogglePlanMode).toHaveBeenCalledWith({ enabled: true })
  })

  it('切昂贵 model → 弹 confirm modal', async () => {
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
    const select = screen.getByTestId('board-chat-model-select')
    await act(async () => {
      fireEvent.change(select, { target: { value: 'claude-opus-5' } })
    })
    expect(
      screen.getByTestId('board-chat-model-switch-confirm'),
    ).toBeInTheDocument()
  })

  it('确认切 model → useChatModelSwitch 被调', async () => {
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
    const select = screen.getByTestId('board-chat-model-select')
    await act(async () => {
      fireEvent.change(select, { target: { value: 'claude-opus-5' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-chat-model-switch-confirm-ok'))
    })
    expect(mockSwitchModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-5' }),
    )
  })
})

// ---------------------------------------------------------------------------
// MessageStream · user / assistant + tool + sub-agent
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · MessageStream', () => {
  it('snapshot 含 user / assistant 消息 → 渲染气泡', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'chat_message_user',
          ts: 1700000000000,
          content: [{ kind: 'text', text: '帮我看下' }],
        },
        {
          kind: 'chat_message_assistant',
          ts: 1700000001000,
          content: [{ kind: 'text', text: '好的,我看下' }],
        },
      ]),
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
    expect(screen.getAllByTestId('board-chat-msg-user')).toHaveLength(1)
    expect(screen.getAllByTestId('board-chat-msg-assistant')).toHaveLength(1)
    expect(screen.getByTestId('board-chat-msg-user')).toHaveTextContent(
      '帮我看下',
    )
    expect(screen.getByTestId('board-chat-msg-assistant')).toHaveTextContent(
      '好的,我看下',
    )
  })

  it('tool_call + tool_result → 渲染 ToolCallBubble + result', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'chat_tool_call',
          ts: 1700000000000,
          id: 'tool-1',
          name: 'Bash',
          args: { cmd: 'ls' },
          partial: false,
        },
        {
          kind: 'chat_tool_result',
          ts: 1700000001000,
          id: 'tool-1',
          name: 'Bash',
          content: 'file1\nfile2',
          isError: false,
        },
      ]),
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
    const bubbles = screen.getAllByTestId('board-chat-tool-bubble')
    expect(bubbles.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('board-chat-tool-result')).toHaveTextContent(
      'file1',
    )
  })

  it('sub-agent task_started + task_completed → 渲染 SubAgentBlock', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'task_started',
          ts: 1700000000000,
          taskId: 'task-1',
          description: 'sub agent 跑分析',
          agentType: 'general-purpose',
        },
        {
          kind: 'task_progress',
          ts: 1700000000500,
          taskId: 'task-1',
          summary: '一半了',
        },
        {
          kind: 'task_completed',
          ts: 1700000002000,
          taskId: 'task-1',
          result: 'ok',
          durationMs: 2000,
        },
      ]),
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
    expect(screen.getByTestId('board-chat-sub-agent')).toBeInTheDocument()
    expect(screen.getByTestId('board-chat-sub-agent')).toHaveTextContent(
      'sub agent 跑分析',
    )
  })
})

// ---------------------------------------------------------------------------
// Permission modal
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · PermissionPrompt', () => {
  it('live event chat_permission_request → modal 渲染 + 3 选项', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    const sendFn = vi.fn()
    mockUseChatSessionStream.mockReturnValue({
      events: [],
      status: 'idle',
      send: sendFn,
      abort: vi.fn(),
      pendingPermission: {
        kind: 'chat_permission_request',
        ts: Date.now(),
        requestId: 'req-1',
        toolName: 'Write',
        input: { file_path: '/tmp/a.txt', content: 'x' },
        title: '写入 a.txt',
      },
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-permission-modal')).toBeInTheDocument()
    expect(
      screen.getByTestId('board-chat-permission-allow-once'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('board-chat-permission-allow-session'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('board-chat-permission-deny'),
    ).toBeInTheDocument()
  })

  it('点 [Allow once] → useChatPermission resolve', async () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
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
      pendingPermission: {
        kind: 'chat_permission_request',
        ts: Date.now(),
        requestId: 'req-1',
        toolName: 'Bash',
        input: { cmd: 'echo hi' },
      },
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-chat-permission-allow-once'))
    })
    expect(mockResolvePermission).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Cost cap modal
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · CostCapModal', () => {
  it('cost cap trigger → modal 4 选项', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
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
      pendingCostCap: true,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-cost-cap-modal')).toBeInTheDocument()
    expect(
      screen.getByTestId('board-chat-cost-cap-continue-once'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('board-chat-cost-cap-continue-session'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('board-chat-cost-cap-pause')).toBeInTheDocument()
    expect(
      screen.getByTestId('board-chat-cost-cap-new-session'),
    ).toBeInTheDocument()
  })

  it('点 [暂停] → useChatCostCap resolve pause', async () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta()),
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
      pendingCostCap: true,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-chat-cost-cap-pause'))
    })
    expect(mockResolveCostCap).toHaveBeenCalledWith({ resolve: 'pause' })
  })
})

// ---------------------------------------------------------------------------
// 单 tab lock
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · 单 tab lock', () => {
  it('第二 tab → 顶部 "⚠️ 已在另一 tab 打开" + input disabled', () => {
    mockUseChatSessionLock.mockReturnValue({ lockedByOtherTab: true })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-lock-banner')).toBeInTheDocument()
    expect(screen.getByTestId('board-chat-textarea')).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// 输入框 → useChatQuery
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · 发送消息', () => {
  it('输入 + 点击发送 → send(content)', async () => {
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
    const ta = screen.getByTestId('board-chat-textarea')
    fireEvent.change(ta, { target: { value: 'hi ai' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-chat-send'))
    })
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'hi ai' }),
    )
  })

  it('⌘+Enter → 发送', async () => {
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
    const ta = screen.getByTestId('board-chat-textarea')
    fireEvent.change(ta, { target: { value: '快捷键' } })
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter', metaKey: true })
    })
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({ content: '快捷键' }),
    )
  })
})