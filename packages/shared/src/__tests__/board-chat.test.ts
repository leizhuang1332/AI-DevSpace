/**
 * Board chat 共享契约测试 — issue 01 / ADR-0029
 *
 * 覆盖验收项:
 * - ChatSessionMetaSchema 正反例(17 项字段 / 错 ULID / 错 req id /
 *   permissionPromptToolName 字面校验 / 默认值)
 * - ChatDecisionSchema / ChatDecisionWithReasonSchema
 * - ChatPermissionRequestSchema / ChatPermissionResolvedSchema discriminatedUnion
 *   (allow + addRules / addDirectories / deny)
 * - ChatMessageUserContentSchema / ChatMessageAssistantContentSchema discriminatedUnion
 * - ChatSessionEventSchema 13 类事件正反例 + dispatch narrow
 * - ChatSubAgentEventSchema 4 类 sub-agent 事件
 * - ChatToolAuditSchema 8 项字段
 * - 路由契约:snapshot / query / model / permission / cost-cap / plan-mode
 * - REASON_TO_HTTP_STATUS_BOARD_CHAT reason → 状态映射
 */

import { describe, expect, it } from 'vitest'
import {
  ChatCostCapResolve,
  ChatCostCapResolveSchema,
  ChatDecision,
  ChatDecisionSchema,
  ChatDecisionWithReasonSchema,
  ChatMcpServerConfigSchema,
  ChatMessageAssistantContentSchema,
  ChatMessageUserContentSchema,
  ChatPermissionModeToggleSchema,
  ChatPermissionMode,
  ChatPermissionModeSchema,
  ChatPermissionRequestSchema,
  ChatPermissionResolvedSchema,
  ChatPlanModeToggleSchema,
  ChatSessionCostCapResolveSchema,
  ChatSessionEventSchema,
  ChatSessionMetaSchema,
  ChatSessionModelSwitchRequestSchema,
  ChatSessionPermissionResolveRequestSchema,
  ChatSessionQueryRequestSchema,
  ChatSessionSnapshotResponseSchema,
  ChatSubAgentEventSchema,
  ChatToolAuditSchema,
  REASON_TO_HTTP_STATUS_BOARD_CHAT,
} from '../board-chat.js'

// ---------------------------------------------------------------------------
// 共享测试 fixture
// ---------------------------------------------------------------------------

const VALID_ULID = '01J7X3K2P5EVR0Z3YQJD8HFKXA'
const VALID_REQ_ID = 'req-001-payment-flow'

const VALID_SESSION_META = {
  sessionId: 'sess-abc123-def456',
  requirementId: VALID_REQ_ID,
  cardId: VALID_ULID,
  cwd: '/workspace/requirements/req-001-payment-flow/board/tasks/01J7X3K2P5EVR0Z3YQJD8HFKXA',
  additionalDirectories: [
    '/workspace/requirements/req-001-payment-flow',
    '/workspace/requirements/req-001-payment-flow/repos/repo-1',
  ],
  model: 'claude-sonnet-5',
  permissionMode: 'default' as const,
  mcpServers: [
    { name: 'boardchat__user_confirm', config: { type: 'sdk' } },
  ],
  createdAt: '2026-08-09T08:00:00.000Z',
  lastQueryAt: '2026-08-09T08:30:00.000Z',
  queryCount: 3,
  ownerUserId: 'user-alice',
  cumulativeUsage: {
    cumulativeCostUsd: 0.42,
    cumulativeInputTokens: 12000,
    cumulativeOutputTokens: 3000,
    cumulativeCacheReadTokens: 500,
  },
}

function patchMeta(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...VALID_SESSION_META, ...overrides }
}

// ---------------------------------------------------------------------------
// ChatSessionMetaSchema
// ---------------------------------------------------------------------------

describe('ChatSessionMetaSchema — issue 01 / D4', () => {
  it('accepts a complete session.json payload (17 fields)', () => {
    const r = ChatSessionMetaSchema.safeParse(VALID_SESSION_META)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.sessionId).toBe(VALID_SESSION_META.sessionId)
      expect(r.data.permissionPromptToolName).toBe(
        'mcp__boardchat__user_confirm',
      )
      expect(r.data.cumulativeUsage.cumulativeCostUsd).toBe(0.42)
    }
  })

  it('defaults permissionPromptToolName to mcp__boardchat__user_confirm when omitted', () => {
    const payload = { ...VALID_SESSION_META } as Record<string, unknown>
    delete payload.permissionPromptToolName
    const r = ChatSessionMetaSchema.safeParse(payload)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.permissionPromptToolName).toBe('mcp__boardchat__user_confirm')
    }
  })

  it('defaults additionalDirectories / mcpServers to empty arrays', () => {
    const payload = { ...VALID_SESSION_META } as Record<string, unknown>
    delete payload.additionalDirectories
    delete payload.mcpServers
    const r = ChatSessionMetaSchema.safeParse(payload)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.additionalDirectories).toEqual([])
      expect(r.data.mcpServers).toEqual([])
    }
  })

  it('rejects non-ULID cardId', () => {
    const r = ChatSessionMetaSchema.safeParse(
      patchMeta({ cardId: 'not-a-ulid' }),
    )
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.issues.some((i) => i.path.includes('cardId'))).toBe(true)
  })

  it('rejects malformed requirementId', () => {
    const r = ChatSessionMetaSchema.safeParse(
      patchMeta({ requirementId: 'req-001' }),
    )
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.issues.some((i) => i.path.includes('requirementId'))).toBe(true)
  })

  it('rejects unknown permissionMode', () => {
    const r = ChatSessionMetaSchema.safeParse(
      patchMeta({ permissionMode: 'unsafe' }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects empty sessionId', () => {
    const r = ChatSessionMetaSchema.safeParse(patchMeta({ sessionId: '' }))
    expect(r.success).toBe(false)
  })

  it('rejects negative cost / tokens', () => {
    const r1 = ChatSessionMetaSchema.safeParse(
      patchMeta({
        cumulativeUsage: {
          cumulativeCostUsd: -1,
          cumulativeInputTokens: 0,
          cumulativeOutputTokens: 0,
          cumulativeCacheReadTokens: 0,
        },
      }),
    )
    expect(r1.success).toBe(false)
    const r2 = ChatSessionMetaSchema.safeParse(
      patchMeta({
        cumulativeUsage: {
          cumulativeCostUsd: 0,
          cumulativeInputTokens: -1,
          cumulativeOutputTokens: 0,
          cumulativeCacheReadTokens: 0,
        },
      }),
    )
    expect(r2.success).toBe(false)
  })

  it('rejects wrong permissionPromptToolName literal', () => {
    const r = ChatSessionMetaSchema.safeParse(
      patchMeta({ permissionPromptToolName: 'mcp__other__tool' }),
    )
    expect(r.success).toBe(false)
  })

  it('accepts every ChatPermissionMode enum value', () => {
    for (const mode of Object.values(ChatPermissionMode)) {
      const r = ChatSessionMetaSchema.safeParse(patchMeta({ permissionMode: mode }))
      expect(r.success).toBe(true)
    }
    // 同步:zod enum 也接受字面值
    for (const mode of Object.values(ChatPermissionMode)) {
      const r = ChatPermissionModeSchema.safeParse(mode)
      expect(r.success).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// ChatDecision + ChatDecisionWithReason
// ---------------------------------------------------------------------------

describe('ChatDecision / ChatDecisionWithReason', () => {
  it('accepts allow / deny', () => {
    for (const d of Object.values(ChatDecision)) {
      expect(ChatDecisionSchema.safeParse(d).success).toBe(true)
    }
  })

  it('rejects unknown decision', () => {
    expect(ChatDecisionSchema.safeParse('maybe').success).toBe(false)
  })

  it('accepts decision with optional reason (allow)', () => {
    const r = ChatDecisionWithReasonSchema.safeParse({
      decision: 'allow',
      reason: '测试环境允许',
    })
    expect(r.success).toBe(true)
  })

  it('accepts decision with optional reason (deny)', () => {
    const r = ChatDecisionWithReasonSchema.safeParse({
      decision: 'deny',
      reason: '数据敏感',
    })
    expect(r.success).toBe(true)
  })

  it('accepts decision without reason', () => {
    const r = ChatDecisionWithReasonSchema.safeParse({ decision: 'deny' })
    expect(r.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MCP tool 协议 discriminated union
// ---------------------------------------------------------------------------

describe('ChatPermissionRequestSchema', () => {
  it('accepts a complete permission request', () => {
    const r = ChatPermissionRequestSchema.safeParse({
      requestId: 'req-1',
      toolName: 'Write',
      input: { file_path: '/tmp/x', content: 'hi' },
      displayName: 'Write to /tmp/x',
      title: 'AI 想要写入文件',
      description: '将在 /tmp/x 写入新文件',
      cwd: '/workspace',
    })
    expect(r.success).toBe(true)
  })

  it('requires requestId / toolName / input', () => {
    const r = ChatPermissionRequestSchema.safeParse({
      requestId: '',
      toolName: 'Write',
      input: {},
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty toolName', () => {
    const r = ChatPermissionRequestSchema.safeParse({
      requestId: 'req-1',
      toolName: '',
      input: {},
    })
    expect(r.success).toBe(false)
  })
})

describe('ChatPermissionResolvedSchema — discriminatedUnion(behavior)', () => {
  it('accepts allow with empty updatedPermissions', () => {
    const r = ChatPermissionResolvedSchema.safeParse({
      behavior: 'allow',
    })
    expect(r.success).toBe(true)
  })

  it('accepts allow with addRules updatedPermissions', () => {
    const r = ChatPermissionResolvedSchema.safeParse({
      behavior: 'allow',
      updatedPermissions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'pytest:*' }],
          destination: 'session',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts allow with addDirectories updatedPermissions', () => {
    const r = ChatPermissionResolvedSchema.safeParse({
      behavior: 'allow',
      updatedPermissions: [
        {
          type: 'addDirectories',
          directories: ['/workspace/extra'],
          destination: 'session',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts deny with reason', () => {
    const r = ChatPermissionResolvedSchema.safeParse({
      behavior: 'deny',
      reason: '敏感路径',
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown behavior', () => {
    const r = ChatPermissionResolvedSchema.safeParse({
      behavior: 'maybe',
    })
    expect(r.success).toBe(false)
  })

  it('rejects addRules without destination: session (only session is valid)', () => {
    const r = ChatPermissionResolvedSchema.safeParse({
      behavior: 'allow',
      updatedPermissions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'pytest:*' }],
          destination: 'user',
        },
      ],
    })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Message content discriminated union
// ---------------------------------------------------------------------------

describe('ChatMessageUserContentSchema — discriminatedUnion(kind)', () => {
  it('accepts text', () => {
    const r = ChatMessageUserContentSchema.safeParse({
      kind: 'text',
      text: '你好',
    })
    expect(r.success).toBe(true)
  })

  it('accepts attachment with url + name', () => {
    const r = ChatMessageUserContentSchema.safeParse({
      kind: 'attachment',
      url: 'https://example.com/file.pdf',
      name: 'spec.pdf',
    })
    expect(r.success).toBe(true)
  })

  it('rejects text with empty text', () => {
    const r = ChatMessageUserContentSchema.safeParse({
      kind: 'text',
      text: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects attachment with non-url url', () => {
    const r = ChatMessageUserContentSchema.safeParse({
      kind: 'attachment',
      url: 'not-a-url',
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown kind', () => {
    const r = ChatMessageUserContentSchema.safeParse({
      kind: 'image',
      data: '...',
    })
    expect(r.success).toBe(false)
  })
})

describe('ChatMessageAssistantContentSchema — discriminatedUnion(kind)', () => {
  it('accepts text with partial flag', () => {
    const r = ChatMessageAssistantContentSchema.safeParse({
      kind: 'text',
      text: '分析结果...',
      partial: true,
    })
    expect(r.success).toBe(true)
  })

  it('accepts thinking block', () => {
    const r = ChatMessageAssistantContentSchema.safeParse({
      kind: 'thinking',
      text: '让我思考一下...',
    })
    expect(r.success).toBe(true)
  })

  it('accepts tool_use block', () => {
    const r = ChatMessageAssistantContentSchema.safeParse({
      kind: 'tool_use',
      toolUseId: 'tool-1',
      name: 'Read',
      input: { file_path: '/x' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects tool_use with empty name', () => {
    const r = ChatMessageAssistantContentSchema.safeParse({
      kind: 'tool_use',
      toolUseId: 'tool-1',
      name: '',
      input: {},
    })
    expect(r.success).toBe(false)
  })

  it('rejects tool_use with empty toolUseId', () => {
    const r = ChatMessageAssistantContentSchema.safeParse({
      kind: 'tool_use',
      toolUseId: '',
      name: 'Read',
      input: {},
    })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SSE events 13 类 + discriminatedUnion dispatch
// ---------------------------------------------------------------------------

describe('ChatSessionEventSchema — 9 类主事件 + 4 类 sub-agent 事件', () => {
  it('accepts chat_session_init', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_session_init',
      ts: 1000,
      sessionId: 'sess-1',
      cwd: '/workspace',
      model: 'claude-sonnet-5',
      tools: ['Read', 'Write', 'Bash'],
      permissionMode: 'default',
    })
    expect(r.success).toBe(true)
  })

  it('accepts chat_message_user', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_message_user',
      ts: 1000,
      content: [{ kind: 'text', text: '你好' }],
    })
    expect(r.success).toBe(true)
  })

  it('accepts chat_message_assistant with mixed content', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_message_assistant',
      ts: 1000,
      content: [
        { kind: 'thinking', text: '...' },
        { kind: 'text', text: '分析结果', partial: false },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts chat_tool_call', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_tool_call',
      ts: 1000,
      id: 'tool-1',
      name: 'Read',
      args: { file_path: '/x' },
      partial: false,
    })
    expect(r.success).toBe(true)
  })

  it('accepts chat_tool_result with isError', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_tool_result',
      ts: 1000,
      id: 'tool-1',
      name: 'Read',
      content: 'file contents',
      isError: false,
    })
    expect(r.success).toBe(true)
  })

  it('accepts chat_permission_request', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_permission_request',
      ts: 1000,
      requestId: 'req-1',
      toolName: 'Write',
      input: { file_path: '/x' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts chat_permission_resolved', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_permission_resolved',
      ts: 1000,
      requestId: 'req-1',
      decision: { decision: 'allow' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts chat_error with category', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_error',
      ts: 1000,
      code: 'E_API_RATE_LIMIT',
      message: 'rate limited',
      recoverable: true,
      category: 'A',
    })
    expect(r.success).toBe(true)
  })

  it('accepts chat_complete with reason=end_turn', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_complete',
      ts: 1000,
      sessionId: 'sess-1',
      totalTokens: 15000,
      cost: 0.05,
      reason: 'end_turn',
    })
    expect(r.success).toBe(true)
  })

  it('rejects chat_complete with unknown reason', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_complete',
      ts: 1000,
      sessionId: 'sess-1',
      totalTokens: 100,
      cost: 0.01,
      reason: 'something_else',
    })
    expect(r.success).toBe(false)
  })

  // sub-agent 4 类
  it('accepts task_started', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'task_started',
      ts: 1000,
      taskId: 'task-1',
      description: '搜索代码',
      agentType: 'Explore',
    })
    expect(r.success).toBe(true)
  })

  it('accepts task_progress', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'task_progress',
      ts: 1000,
      taskId: 'task-1',
      summary: '已找到 3 个文件',
    })
    expect(r.success).toBe(true)
  })

  it('accepts task_notification with status', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'task_notification',
      ts: 1000,
      taskId: 'task-1',
      message: '进度更新',
      status: 'progress',
    })
    expect(r.success).toBe(true)
  })

  it('accepts task_completed with durationMs', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'task_completed',
      ts: 1000,
      taskId: 'task-1',
      result: { ok: true },
      durationMs: 12345,
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown event kind', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_unknown',
      ts: 1000,
    })
    expect(r.success).toBe(false)
  })

  // dispatch narrow:kind 决定后续字段
  it('dispatches by kind: each kind narrows to a distinct shape', () => {
    const samples = [
      {
        kind: 'chat_session_init' as const,
        ts: 1,
        sessionId: 's',
        cwd: '/x',
        model: 'm',
        tools: [],
        permissionMode: 'default' as const,
      },
      { kind: 'task_started' as const, ts: 1, taskId: 't', description: 'd', agentType: 'a' },
    ]
    for (const s of samples) {
      const r = ChatSessionEventSchema.safeParse(s)
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.kind).toBe(s.kind)
    }
  })

  it('rejects negative ts', () => {
    const r = ChatSessionEventSchema.safeParse({
      kind: 'chat_session_init',
      ts: -1,
      sessionId: 's',
      cwd: '/x',
      model: 'm',
      tools: [],
      permissionMode: 'default',
    })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Sub-agent event 4 类
// ---------------------------------------------------------------------------

describe('ChatSubAgentEventSchema — 4 类事件', () => {
  it('accepts task_started', () => {
    const r = ChatSubAgentEventSchema.safeParse({
      kind: 'task_started',
      ts: 1000,
      taskId: 'task-1',
      description: '搜索',
      agentType: 'Explore',
    })
    expect(r.success).toBe(true)
  })

  it('accepts task_progress with empty summary', () => {
    const r = ChatSubAgentEventSchema.safeParse({
      kind: 'task_progress',
      ts: 1000,
      taskId: 'task-1',
      summary: '',
    })
    expect(r.success).toBe(true)
  })

  it('accepts task_notification with all status values', () => {
    for (const status of ['started', 'progress', 'warning', 'completed']) {
      const r = ChatSubAgentEventSchema.safeParse({
        kind: 'task_notification',
        ts: 1000,
        taskId: 'task-1',
        message: 'msg',
        status,
      })
      expect(r.success).toBe(true)
    }
  })

  it('rejects task_notification with unknown status', () => {
    const r = ChatSubAgentEventSchema.safeParse({
      kind: 'task_notification',
      ts: 1000,
      taskId: 'task-1',
      message: 'msg',
      status: 'failed',
    })
    expect(r.success).toBe(false)
  })

  it('accepts task_completed with negative durationMs rejection', () => {
    const r1 = ChatSubAgentEventSchema.safeParse({
      kind: 'task_completed',
      ts: 1000,
      taskId: 'task-1',
      result: null,
      durationMs: 100,
    })
    expect(r1.success).toBe(true)
    const r2 = ChatSubAgentEventSchema.safeParse({
      kind: 'task_completed',
      ts: 1000,
      taskId: 'task-1',
      result: null,
      durationMs: -1,
    })
    expect(r2.success).toBe(false)
  })

  it('rejects empty taskId', () => {
    const r = ChatSubAgentEventSchema.safeParse({
      kind: 'task_started',
      ts: 1000,
      taskId: '',
      description: 'd',
      agentType: 'a',
    })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Audit log 8 项字段
// ---------------------------------------------------------------------------

describe('ChatToolAuditSchema — 8 项字段(D16)', () => {
  it('accepts a complete audit entry', () => {
    const r = ChatToolAuditSchema.safeParse({
      ts: '2026-08-09T08:00:00.000Z',
      toolName: 'Write',
      toolUseId: 'tool-1',
      args: { file_path: '/x' },
      result: { ok: true },
      decision: 'allow',
      decidedBy: 'user',
      durationMs: 42,
    })
    expect(r.success).toBe(true)
  })

  it('accepts decidedBy=auto (policy 自动放行)', () => {
    const r = ChatToolAuditSchema.safeParse({
      ts: '2026-08-09T08:00:00.000Z',
      toolName: 'Read',
      toolUseId: 'tool-2',
      args: { file_path: '/x' },
      result: 'file contents',
      decision: 'allow',
      decidedBy: 'auto',
      durationMs: 5,
    })
    expect(r.success).toBe(true)
  })

  it('rejects negative durationMs', () => {
    const r = ChatToolAuditSchema.safeParse({
      ts: '2026-08-09T08:00:00.000Z',
      toolName: 'Write',
      toolUseId: 'tool-1',
      args: {},
      result: null,
      decision: 'allow',
      decidedBy: 'user',
      durationMs: -1,
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown decidedBy', () => {
    const r = ChatToolAuditSchema.safeParse({
      ts: '2026-08-09T08:00:00.000Z',
      toolName: 'Write',
      toolUseId: 'tool-1',
      args: {},
      result: null,
      decision: 'allow',
      decidedBy: 'system',
      durationMs: 0,
    })
    expect(r.success).toBe(false)
  })

  it('rejects malformed ts', () => {
    const r = ChatToolAuditSchema.safeParse({
      ts: '2026-08-09',
      toolName: 'Write',
      toolUseId: 'tool-1',
      args: {},
      result: null,
      decision: 'allow',
      decidedBy: 'user',
      durationMs: 0,
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing toolUseId (audit 单条 id 必须唯一)', () => {
    const r = ChatToolAuditSchema.safeParse({
      ts: '2026-08-09T08:00:00.000Z',
      toolName: 'Write',
      args: {},
      result: null,
      decision: 'allow',
      decidedBy: 'user',
      durationMs: 0,
    } as never)
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// HTTP 路由契约
// ---------------------------------------------------------------------------

describe('ChatSessionSnapshotResponseSchema', () => {
  it('accepts a snapshot with meta + events', () => {
    const r = ChatSessionSnapshotResponseSchema.safeParse({
      meta: VALID_SESSION_META,
      events: [
        {
          kind: 'chat_session_init',
          ts: 1,
          sessionId: 's',
          cwd: '/x',
          model: 'claude-sonnet-5',
          tools: [],
          permissionMode: 'default',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts null meta with empty events (session 不存在的空态)', () => {
    const r = ChatSessionSnapshotResponseSchema.safeParse({
      meta: null,
      events: [],
    })
    expect(r.success).toBe(true)
  })

  it('defaults events to [] when omitted', () => {
    const r = ChatSessionSnapshotResponseSchema.safeParse({ meta: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.events).toEqual([])
  })
})

describe('ChatSessionQueryRequestSchema', () => {
  it('accepts a query body with single text content', () => {
    const r = ChatSessionQueryRequestSchema.safeParse({
      content: [{ kind: 'text', text: '你好' }],
    })
    expect(r.success).toBe(true)
  })

  it('accepts optional model override', () => {
    const r = ChatSessionQueryRequestSchema.safeParse({
      content: [{ kind: 'text', text: 'x' }],
      model: 'claude-opus-4-8',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty content array', () => {
    const r = ChatSessionQueryRequestSchema.safeParse({ content: [] })
    expect(r.success).toBe(false)
  })

  it('rejects missing content', () => {
    const r = ChatSessionQueryRequestSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})

describe('ChatSessionModelSwitchRequestSchema', () => {
  it('accepts model switch', () => {
    const r = ChatSessionModelSwitchRequestSchema.safeParse({
      model: 'claude-opus-4-8',
      expectedCostMultiplier: 5,
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty model', () => {
    expect(
      ChatSessionModelSwitchRequestSchema.safeParse({ model: '' }).success,
    ).toBe(false)
  })

  it('rejects non-positive cost multiplier', () => {
    expect(
      ChatSessionModelSwitchRequestSchema.safeParse({
        model: 'm',
        expectedCostMultiplier: 0,
      }).success,
    ).toBe(false)
    expect(
      ChatSessionModelSwitchRequestSchema.safeParse({
        model: 'm',
        expectedCostMultiplier: -1,
      }).success,
    ).toBe(false)
  })
})

describe('ChatSessionPermissionResolveRequestSchema', () => {
  it('accepts a permission resolution request', () => {
    const r = ChatSessionPermissionResolveRequestSchema.safeParse({
      requestId: 'req-1',
      decision: { decision: 'allow' },
      updatedPermissions: { behavior: 'allow' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts a permission resolution request with deny + reason', () => {
    const r = ChatSessionPermissionResolveRequestSchema.safeParse({
      requestId: 'req-1',
      decision: { decision: 'deny', reason: '不允许' },
      updatedPermissions: { behavior: 'deny', reason: '不允许' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty requestId', () => {
    const r = ChatSessionPermissionResolveRequestSchema.safeParse({
      requestId: '',
      decision: { decision: 'allow' },
      updatedPermissions: { behavior: 'allow' },
    })
    expect(r.success).toBe(false)
  })
})

describe('ChatSessionCostCapResolveSchema', () => {
  it('accepts every ChatCostCapResolve enum value', () => {
    for (const resolve of Object.values(ChatCostCapResolve)) {
      // wrapped: { resolve }
      const r = ChatSessionCostCapResolveSchema.safeParse({ resolve })
      expect(r.success).toBe(true)
      // raw enum value
      expect(ChatCostCapResolveSchema.safeParse(resolve).success).toBe(true)
    }
  })

  it('rejects unknown resolve', () => {
    const r = ChatSessionCostCapResolveSchema.safeParse({ resolve: 'continue' })
    expect(r.success).toBe(false)
  })

  it('rejects missing resolve', () => {
    const r = ChatSessionCostCapResolveSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})

describe('ChatPlanModeToggleSchema', () => {
  it('accepts enabled=true', () => {
    const r = ChatPlanModeToggleSchema.safeParse({ enabled: true })
    expect(r.success).toBe(true)
  })

  it('accepts enabled=false', () => {
    const r = ChatPlanModeToggleSchema.safeParse({ enabled: false })
    expect(r.success).toBe(true)
  })

  it('rejects missing enabled', () => {
    const r = ChatPlanModeToggleSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})

describe('ChatPermissionModeToggleSchema', () => {
  it('accepts enabled=true', () => {
    const r = ChatPermissionModeToggleSchema.safeParse({ enabled: true })
    expect(r.success).toBe(true)
  })

  it('accepts enabled=false', () => {
    const r = ChatPermissionModeToggleSchema.safeParse({ enabled: false })
    expect(r.success).toBe(true)
  })

  it('rejects missing enabled', () => {
    const r = ChatPermissionModeToggleSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ChatMcpServerConfigSchema
// ---------------------------------------------------------------------------

describe('ChatMcpServerConfigSchema', () => {
  it('accepts a complete mcp server config', () => {
    const r = ChatMcpServerConfigSchema.safeParse({
      name: 'boardchat__user_confirm',
      config: { type: 'sdk' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty name', () => {
    const r = ChatMcpServerConfigSchema.safeParse({
      name: '',
      config: {},
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing config', () => {
    const r = ChatMcpServerConfigSchema.safeParse({ name: 'x' })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// REASON_TO_HTTP_STATUS_BOARD_CHAT
// ---------------------------------------------------------------------------

describe('REASON_TO_HTTP_STATUS_BOARD_CHAT', () => {
  it('maps every reason to a valid {code, status} pair', () => {
    const expected: Record<keyof typeof REASON_TO_HTTP_STATUS_BOARD_CHAT, number> = {
      'invalid-id': 400,
      'invalid-body': 400,
      'requirement-not-found': 404,
      'card-not-found': 404,
      'session-not-found': 404,
      'session-locked': 409,
      'permission-denied': 403,
      'cost-cap-exceeded': 402,
      'internal': 500,
    }
    for (const [reason, status] of Object.entries(expected)) {
      const entry =
        REASON_TO_HTTP_STATUS_BOARD_CHAT[
          reason as keyof typeof REASON_TO_HTTP_STATUS_BOARD_CHAT
        ]
      expect(entry.status).toBe(status)
      expect(entry.code).toMatch(/^E_/)
    }
  })

  it('includes session-locked at 409 for strict single-tab lock', () => {
    expect(REASON_TO_HTTP_STATUS_BOARD_CHAT['session-locked'].status).toBe(409)
    expect(REASON_TO_HTTP_STATUS_BOARD_CHAT['session-locked'].code).toBe(
      'E_SESSION_LOCKED',
    )
  })

  it('includes cost-cap-exceeded at 402', () => {
    expect(REASON_TO_HTTP_STATUS_BOARD_CHAT['cost-cap-exceeded'].status).toBe(
      402,
    )
  })
})
