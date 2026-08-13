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
const mockTogglePermissionMode = vi.fn().mockResolvedValue({ meta: metaForMock })
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
    mutateAsync: mockTogglePermissionMode,
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
    sessionExpired: false,
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
      sessionExpired: false,
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
      sessionExpired: false,
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
      sessionExpired: false,
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
      sessionExpired: false,
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
      sessionExpired: false,
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
      sessionExpired: false,
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

  // issue 12 —— /start schema 解耦:无 meta 时发送,startMutation 调用 args 不带 content
  it('无 meta 发送 → startMutation.mutateAsync({}) 不带 content', async () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(null),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mockStartMutate.mockClear()
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const ta = screen.getByTestId('board-chat-textarea')
    fireEvent.change(ta, { target: { value: '你好 AI' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-chat-send'))
    })
    // startMutation 必须被调用 1 次,且 args 是 {} —— 不带 content
    expect(mockStartMutate).toHaveBeenCalledTimes(1)
    expect(mockStartMutate).toHaveBeenCalledWith(expect.not.objectContaining({ content: undefined }))
    // 进一步断言:args 实际值不包含 content 字段
    const callArgs = mockStartMutate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callArgs).not.toHaveProperty('content')
  })
})

// ---------------------------------------------------------------------------
// UsageBar · auto-allow toggle + pill + sub-agent cost(issue 08)
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · UsageBar issue 08 扩展', () => {
  function setupMetaSnapshot(meta: ChatSessionMeta): void {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(meta),
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
      sessionExpired: false,
    })
  }

  it('model pill 渲染 + brand 圆点(Sonnet 非 expensive)', () => {
    setupMetaSnapshot(makeMeta({ model: 'claude-sonnet-5' }))
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const pill = screen.getByTestId('board-chat-model-pill')
    expect(pill).toHaveTextContent('Sonnet 5')
    expect(pill).toHaveTextContent('claude-sonnet-5')
    const dot = pill.querySelector('span > span')
    expect(dot?.className).toContain('bg-brand')
  })

  it('切到 opus → pill 圆点 warning 色(昂贵)', () => {
    setupMetaSnapshot(makeMeta({ model: 'claude-opus-5' }))
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const pill = screen.getByTestId('board-chat-model-pill')
    const dot = pill.querySelector('span > span')
    expect(dot?.className).toContain('bg-warning')
  })

  it('auto-allow toggle 默认 off(aria-checked=false)', () => {
    setupMetaSnapshot(makeMeta())
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const toggle = screen.getByTestId('board-chat-auto-allow-toggle')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('auto-allow on(permissionMode=bypassPermissions)→ aria-checked=true', () => {
    setupMetaSnapshot(
      makeMeta({ permissionMode: 'bypassPermissions' as never }),
    )
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const toggle = screen.getByTestId('board-chat-auto-allow-toggle')
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('点击 auto-allow → useChatPermissionMode 调 {enabled:true}', async () => {
    setupMetaSnapshot(makeMeta())
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const toggle = screen.getByTestId('board-chat-auto-allow-toggle')
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(mockTogglePermissionMode).toHaveBeenCalledWith({ enabled: true })
  })

  it('plan mode on → auto-allow toggle disabled', () => {
    setupMetaSnapshot(makeMeta({ permissionMode: 'plan' as never }))
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const toggle = screen.getByTestId('board-chat-auto-allow-toggle')
    expect(toggle).toBeDisabled()
    // plan toggle 此时 enabled(bypassPermissions 才禁 plan)
    expect(screen.getByTestId('board-chat-plan-toggle')).not.toBeDisabled()
  })

  it('sub-line 含 sub-agent cost', () => {
    setupMetaSnapshot(makeMeta())
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-usage-sub-agent')).toHaveTextContent(
      '含 sub-agent',
    )
  })
})

// ---------------------------------------------------------------------------
// PermissionPrompt · forced(敏感模式 · issue 08)
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · PermissionPrompt forced', () => {
  it('forced=true → forced banner 渲染', () => {
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
      sessionExpired: false,
      pendingPermission: {
        kind: 'chat_permission_request',
        ts: Date.now(),
        requestId: 'req-forced-1',
        toolName: 'Bash',
        input: { command: 'rm -rf /' },
        forced: true,
      },
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(
      screen.getByTestId('board-chat-permission-modal'),
    ).toHaveAttribute('data-forced', 'true')
    expect(
      screen.getByTestId('board-chat-permission-forced-banner'),
    ).toBeInTheDocument()
  })

  it('forced 缺省 → data-forced=false,无 banner', () => {
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
      sessionExpired: false,
      pendingPermission: {
        kind: 'chat_permission_request',
        ts: Date.now(),
        requestId: 'req-nf-1',
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
    expect(
      screen.getByTestId('board-chat-permission-modal'),
    ).toHaveAttribute('data-forced', 'false')
    expect(
      screen.queryByTestId('board-chat-permission-forced-banner'),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// SubAgentBlock · running 枚举 + toolCalls + nestedChildren(issue 08)
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · SubAgentBlock issue 08 扩展', () => {
  it('task_progress → data-status=running(非 progress)', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'task_started',
          ts: 1700000000000,
          taskId: 'task-run-1',
          description: '分析性能',
          agentType: 'general-purpose',
        },
        {
          kind: 'task_progress',
          ts: 1700000000500,
          taskId: 'task-run-1',
          summary: '一半了',
        },
      ]),
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
      sessionExpired: false,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const block = screen.getByTestId('board-chat-sub-agent')
    expect(block).toHaveAttribute('data-status', 'running')
  })

  it('task_completed → data-status=completed', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'task_started',
          ts: 1700000000000,
          taskId: 'task-done-1',
          description: '完成的分析',
          agentType: 'general-purpose',
        },
        {
          kind: 'task_completed',
          ts: 1700000002000,
          taskId: 'task-done-1',
          result: 'ok',
          durationMs: 2000,
        },
      ]),
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
      sessionExpired: false,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-sub-agent')).toHaveAttribute(
      'data-status',
      'completed',
    )
  })

  it('running 状态 icon 有 animate-spin class', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'task_started',
          ts: 1700000000000,
          taskId: 'task-spin-1',
          description: 'spin test',
          agentType: 'general-purpose',
        },
        {
          kind: 'task_progress',
          ts: 1700000000500,
          taskId: 'task-spin-1',
          summary: '跑',
        },
      ]),
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
      sessionExpired: false,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const block = screen.getByTestId('board-chat-sub-agent')
    // summary 行(running → brand-50 bg)存在
    const summary = block.querySelector('summary')
    expect(summary?.className).toContain('bg-brand-50')
  })

  it('sub-agent 运行期间的 tool_call → toolCalls 摘要列表渲染', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'task_started',
          ts: 1700000000000,
          taskId: 'task-tool-1',
          description: 'sub-agent 用工具',
          agentType: 'general-purpose',
        },
        {
          kind: 'chat_tool_call',
          ts: 1700000000100,
          id: 'tool-sa-1',
          name: 'Bash',
          args: { cmd: 'ls -la' },
          partial: false,
        },
        {
          kind: 'task_progress',
          ts: 1700000000500,
          taskId: 'task-tool-1',
          summary: '跑了',
        },
      ]),
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
      sessionExpired: false,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const toolList = screen.getByTestId('board-chat-sub-agent-tools')
    expect(toolList).toHaveTextContent('Bash')
    expect(toolList).toHaveTextContent('ls -la')
  })
})

// ---------------------------------------------------------------------------
// ToolCallBubble · durationMs + result 折叠(issue 08)
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · ToolCallBubble issue 08 扩展', () => {
  it('tool_call + tool_result → duration 显示', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'chat_tool_call',
          ts: 1700000000000,
          id: 'tool-dur-1',
          name: 'Bash',
          args: { cmd: 'sleep 1' },
          partial: false,
        },
        {
          kind: 'chat_tool_result',
          ts: 1700000001200,
          id: 'tool-dur-1',
          name: 'Bash',
          content: 'done',
          isError: false,
        },
      ]),
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
      sessionExpired: false,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-chat-tool-duration')).toHaveTextContent(
      '1s',
    )
  })

  it('result 渲染为可折叠 <details>', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'chat_tool_call',
          ts: 1700000000000,
          id: 'tool-fold-1',
          name: 'Read',
          args: { file_path: '/a.txt' },
          partial: false,
        },
        {
          kind: 'chat_tool_result',
          ts: 1700000000100,
          id: 'tool-fold-1',
          name: 'Read',
          content: 'line1\nline2',
          isError: false,
        },
      ]),
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
      sessionExpired: false,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const bubble = screen.getByTestId('board-chat-tool-bubble')
    const details = bubble.querySelector('details')
    expect(details).not.toBeNull()
    // result 仍可查(非 unmount)
    expect(screen.getByTestId('board-chat-tool-result')).toHaveTextContent(
      'line1',
    )
  })
})

// ---------------------------------------------------------------------------
// Session expired · issue 13 端到端自愈
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · session expired 自愈', () => {
  it('stream.sessionExpired=true 时 send → 调 startMutation({}) 触发新一轮 /start', async () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(null), // reset 后 meta 已被清成 null
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUseChatSessionStream.mockReturnValue({
      events: [],
      status: 'closed',
      send: vi.fn(),
      abort: vi.fn(),
      sessionExpired: true, // 端到端自愈已被 stream hook 触发
    })
    mockStartMutate.mockClear()
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const ta = screen.getByTestId('board-chat-textarea')
    fireEvent.change(ta, { target: { value: '继续' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('board-chat-send'))
    })
    // stream.send 不应被调(sessionExpired=true → 走 startMutation 重启)
    // startMutation 应被调 1 次({} —— 不带 content,issue 12 同款)
    expect(mockStartMutate).toHaveBeenCalledTimes(1)
    const callArgs = mockStartMutate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callArgs).not.toHaveProperty('content')
  })

  it('末条 SSE 事件 chat_error E_SESSION_EXPIRED → 顶部 banner 提示重新输入', () => {
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(null),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUseChatSessionStream.mockReturnValue({
      events: [
        {
          kind: 'chat_error',
          ts: Date.now(),
          code: 'E_SESSION_EXPIRED',
          message: 'SDK session 失效,已自动清理',
          recoverable: true,
        },
      ],
      status: 'closed',
      send: vi.fn(),
      abort: vi.fn(),
      sessionExpired: true,
    })
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    // 流事件里有 chat_error E_SESSION_EXPIRED —— 顶部 banner 应显示"重新输入"
    expect(screen.getByTestId('board-chat-banner')).toHaveTextContent(/重新|自愈|reset|重新输入|继续/i)
  })
})

// ---------------------------------------------------------------------------
// 滚动布局契约(锁住 transcript 面板的 flex+overflow 结构,防止未来 refactor
// 把 min-h-0 删掉导致长消息把输入框推出视口。改动前 RED,改动后 GREEN。)
// ---------------------------------------------------------------------------

describe('CardTranscriptPanel · 滚动布局契约', () => {
  it('CardTranscriptPanel 是 h-full flex 容器(非 min-h-[600px])', () => {
    wrap(
      <CardTranscriptPanel
        card={makeCard()}
        requirementId={REQ_ID}
        onClose={vi.fn()}
      />,
    )
    const panel = screen.getByTestId('board-chat-panel')
    // 必须撑满父容器,不能只设下限(否则 flex 收缩受 min-h 钳制)
    expect(panel.className).toContain('h-full')
    expect(panel.className).toContain('flex')
    expect(panel.className).toContain('flex-col')
    expect(panel.className).not.toContain('min-h-[600px]')
  })

  it('MessageStream 是 flex-1 + min-h-0 + overflow-auto(flex 子项可独立滚)', () => {
    // 给点消息让 MessageStream 不显示"还没有对话"占位
    mockUseChatSessionSnapshot.mockReturnValue({
      snapshot: makeSnapshot(makeMeta(), [
        {
          kind: 'chat_message_user',
          ts: 1700000000000,
          content: [{ kind: 'text', text: 'hi' }],
        },
        {
          kind: 'chat_message_assistant',
          ts: 1700000001000,
          content: [{ kind: 'text', text: 'hello' }],
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
    const stream = screen.getByTestId('board-chat-message-stream')
    // flex-1:占据中间剩余空间;min-h-0:允许 flex 子项收缩到容器内;
    // overflow-y-scroll + scrollbar-thin:始终显示细滚动条(macOS overlay 默认
    // 隐藏 → 这里强制常驻,给用户「这里有更多内容」视觉提示)
    expect(stream.className).toContain('flex-1')
    expect(stream.className).toContain('min-h-0')
    expect(stream.className).toContain('overflow-y-scroll')
    expect(stream.className).toContain('scrollbar-thin')
  })
})