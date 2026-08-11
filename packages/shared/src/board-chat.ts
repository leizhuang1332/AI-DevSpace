/**
 * Board chat 共享契约 — issue 01 / ADR-0029
 *
 * Board chat = web 端 Claude Code CLI 可视化 UI 窗口(per-TaskCard SDK session)。
 * 每张 TaskCard 一个 SDK session,挂载在 board/tasks/<ulid>/chat/ 物理路径下。
 *
 * 本模块覆盖 ADR-0029 决策 D4 / D10 / D16 三块契约:
 * - D4 SDK 接入:session.json 17 项元数据字段 + cwd / additionalDirectories 派生
 * - D10 SSE 事件:9 类主事件 + 4 类 sub-agent 事件,discriminated union 派发
 * - D16 Audit:独立 audit log 8 项字段 + 30 天 sweep 同步保留
 *
 * 跟 ADR-0028 TaskCard transcript 的关系:
 * - ADR-0028 transcript.yaml 仅描述、不挂 Run(旧 transcript 形态)
 * - 本模块 board-chat 是 SDK session 形态,完整工具调用 + permission + sub-agent
 * - 物理路径独立:board/tasks/<ulid>/chat/session.json(我们元数据)
 *   + ~/.claude/projects/<hash-of-cwd>/<sessionId>.jsonl(SDK session log)
 *
 * 跟 ADR-0023 Analysis Run 守门契约:
 * - 本模块定义契约,Provider 实现由 issue 02 落地(必先 RED e2e 后 GREEN)
 * - MCP tool 协议(ChatPermissionRequestSchema / ChatPermissionResolvedSchema)
 *   是 Provider 内部 SDK 拦截点的契约基础
 */

import { z } from 'zod'
import { REQUIREMENT_ID_RE } from './requirement.js'
import { TASK_CARD_ID_RE } from './task-card.js'

// ---------------------------------------------------------------------------
// 引用形态:sessionId / ULID / ISO 时间
// ---------------------------------------------------------------------------

/**
 * SDK session 唯一 id(由 SDK 首次 query 返回的 system/init 消息携带)。
 *
 * SDK 0.3.206 真实形态是 base36 长串(`<base36-timestamp>-<random>`),
 * schema 只校验非空字符串,具体形态由 SDK 决定。
 */
export const ChatSessionIdSchema = z.string().min(1)
export type ChatSessionId = z.infer<typeof ChatSessionIdSchema>

const IsoDateTimeSchema = z.string().datetime({ offset: true })

/** 卡片 ulid 校验(沿用 TaskCard ULID 正则)。 */
const CardIdSchema = z
  .string()
  .regex(TASK_CARD_ID_RE, 'cardId must be a 26-character ULID')

/** 需求 id 校验(沿用 Requirement id 正则)。 */
const RequirementIdSchema = z
  .string()
  .regex(REQUIREMENT_ID_RE, 'requirementId must match req-NNN-slug pattern')

// ---------------------------------------------------------------------------
// D4:session.json 17 项元数据(ADR-0029 决策 9 / 40)
// ---------------------------------------------------------------------------

/**
 * Claude Code SDK 的 `permissionMode` 选项(ADR-0029 D4)。
 *
 * - `default` —— 工具调用走 permissionPromptToolName MCP tool 拦截;
 *   读工具自动放行,写工具弹 modal
 * - `plan` —— plan mode;AI 给 plan 等用户 Accept 后切 default 执行
 * - `bypassPermissions` —— auto-allow 开关 on;搭配
 *   `allowDangerouslySkipPermissions: true` 使用(plan mode 与之互斥)
 */
export const ChatPermissionMode = {
  DEFAULT: 'default',
  PLAN: 'plan',
  BYPASS_PERMISSIONS: 'bypassPermissions',
} as const

export type ChatPermissionModeT =
  (typeof ChatPermissionMode)[keyof typeof ChatPermissionMode]

export const ChatPermissionModeSchema = z.enum(
  Object.values(ChatPermissionMode) as [
    ChatPermissionModeT,
    ...ChatPermissionModeT[],
  ],
)

/**
 * MCP server 注册描述(session.json.mcpServers 数组单条)。
 *
 * 实际至少包含:
 * - `mcp__boardchat__user_confirm` —— 我们 permission 拦截 MCP tool
 *   (ADR-0029 D5);server 端 ChatSessionService 在每个 chat session 启动时
 *   注入
 * - 用户自定义 MCP server(workspace 级配置)
 */
export const ChatMcpServerConfigSchema = z.object({
  /** MCP server 名称(SDK 内部拼成 `mcp__<name>__<toolName>`) */
  name: z.string().min(1),
  /** SDK 接受的 server 配置(JSON 序列化形态;具体字段由 SDK 决定) */
  config: z.record(z.string(), z.unknown()),
})
export type ChatMcpServerConfig = z.infer<typeof ChatMcpServerConfigSchema>

/**
 * 累计 usage 子 schema(ADR-0029 决策 9 + D10 chat_complete)。
 *
 * 4 项字段常一起出现,且 `chat_complete` SSE 事件也携带 `totalTokens` /
 * `cost` 形态;抽出子 schema 让 session 元数据 + 完成态共享同一份 usage
 * 定义,避免后续字段演化时两处遗漏一处(Data Clumps 解)。
 *
 * 注:`totalTokens` 在 chat_complete 里是 input + output 之和,而
 * cumulative 用 input / output / cache 分开计;故 `ChatCumulativeUsageSchema`
 * 不强行复用 `chat_complete.totalTokens`,仅承载 session 累计侧。
 */
export const ChatCumulativeUsageSchema = z.object({
  /** 累计 cost(USD)—— 实时刷新,超 $5 触发 CostCapModal */
  cumulativeCostUsd: z.number().nonnegative(),
  /** 累计 input tokens(含 cache miss) */
  cumulativeInputTokens: z.number().int().nonnegative(),
  /** 累计 output tokens */
  cumulativeOutputTokens: z.number().int().nonnegative(),
  /** 累计 cache 读 tokens(命中 cache 部分单独计) */
  cumulativeCacheReadTokens: z.number().int().nonnegative(),
})
export type ChatCumulativeUsage = z.infer<typeof ChatCumulativeUsageSchema>

/**
 * `board/tasks/<ulid>/chat/session.json` 文件契约(ADR-0029 决策 9 + 决策 40)。
 *
 * 字段顺序与组织对齐 PRD Issue 01 验收清单:
 * - 1-7 项(sessionId / requirementId / cardId / cwd / additionalDirectories /
 *   model / permissionMode)—— SDK 接入形态
 * - 8 项(permissionPromptToolName)—— MCP tool 协议固定值
 * - 9 项(mcpServers)—— SDK mcpServers 数组
 * - 10-13 项(createdAt / lastQueryAt / queryCount / ownerUserId)—— 生命周期
 * - 14-17 项(嵌入 `cumulativeUsage` 子对象)—— 累计计费
 *
 * 写顺序契约(ADR-0029 D4):SDK 首个 system/init 消息带 sessionId →
 * server 立即 atomic 写 session.json → 写失败 → 走 fallback 重建路径。
 *
 * 字段命名(camelCase)是有意为之:与 SDK 0.3.206 `query()` 选项名
 * (`cwd` / `additionalDirectories` / `permissionMode` / ...) 一一对应,
 * 服务端落盘时无需 rename,降低 SDK 协议 ↔ 本地契约的映射负担。
 * 区别于其他 snake_case schema(`transcript.yaml` / `<ulid>.json`)
 * 是因为 board chat 与 SDK 紧耦合,跨进程边界。
 */
export const ChatSessionMetaSchema = z.object({
  /** SDK session 唯一 id(由 system/init 消息携带) */
  sessionId: ChatSessionIdSchema,
  /** 反向引用 Requirement(沿用 req-NNN-slug 格式) */
  requirementId: RequirementIdSchema,
  /** 反向引用 TaskCard(ULID 26 字符) */
  cardId: CardIdSchema,
  /** SDK options.cwd —— board/tasks/<ulid>/ 绝对路径 */
  cwd: z.string().min(1),
  /** SDK options.additionalDirectories —— 父 req dir + Requirement.repos worktree 路径 */
  additionalDirectories: z.array(z.string().min(1)).default([]),
  /** SDK options.model —— 默认 claude-sonnet-5;切换昂贵 model 走 PUT /model */
  model: z.string().min(1),
  /** SDK options.permissionMode —— 跟 UI toggle 同步 */
  permissionMode: ChatPermissionModeSchema,
  /** SDK options.permissionPromptToolName —— 固定值 mcp__boardchat__user_confirm */
  permissionPromptToolName: z
    .literal('mcp__boardchat__user_confirm')
    .default('mcp__boardchat__user_confirm'),
  /** SDK options.mcpServers —— 至少含我们 user_confirm tool,加上用户配置 */
  mcpServers: z.array(ChatMcpServerConfigSchema).default([]),
  /** session 创建时间(ISO 8601)—— 首个 system/init 消息落地时间 */
  createdAt: IsoDateTimeSchema,
  /** 最后一次 query 启动时间(ISO 8601)—— resume 时刷新 */
  lastQueryAt: IsoDateTimeSchema,
  /** 累计 query 次数(resume 也算 1 次) */
  queryCount: z.number().int().nonnegative(),
  /** session 归属用户(单 user 模型下固定为当前 owner) */
  ownerUserId: z.string().min(1),
  /** 累计 usage(嵌入 ChatCumulativeUsageSchema) */
  cumulativeUsage: ChatCumulativeUsageSchema,
})
export type ChatSessionMeta = z.infer<typeof ChatSessionMetaSchema>

// ---------------------------------------------------------------------------
// Chat 决策(MCP tool 协议返回类型)
// ---------------------------------------------------------------------------

/**
 * 用户对 permission 请求的决议(ADR-0029 D5 / D8 + 决策 25)。
 *
 * - `allow` —— 放行当前请求
 * - `deny` —— 拒绝;可选 reason 让 AI 调整方案
 */
export const ChatDecision = {
  ALLOW: 'allow',
  DENY: 'deny',
} as const

export type ChatDecisionT = (typeof ChatDecision)[keyof typeof ChatDecision]

export const ChatDecisionSchema = z.enum(
  Object.values(ChatDecision) as [ChatDecisionT, ...ChatDecisionT[]],
)

/**
 * 用户决议 + 可选 reason。
 *
 * - `reason` 仅在 `decision === 'deny'` 时语义最强;但 schema 不强制(allow
 *   也可携带 reason,例如"允许但请确认文件路径")
 */
export const ChatDecisionWithReasonSchema = z.object({
  decision: ChatDecisionSchema,
  reason: z.string().optional(),
})
export type ChatDecisionWithReason = z.infer<typeof ChatDecisionWithReasonSchema>

// ---------------------------------------------------------------------------
// D5:MCP tool 协议(permissionPromptToolName = mcp__boardchat__user_confirm)
// ---------------------------------------------------------------------------

/**
 * 我们的 `mcp__boardchat__user_confirm` MCP tool handler 接 SDK 入参的形态。
 *
 * SDK 在 PreToolUse hook 拦截写工具时,把待执行工具上下文打包给我们的
 * handler;handler 推到 SSE(`chat_permission_request`),等 web 端决议后
 * 返回 `ChatPermissionResolvedSchema` 形态。
 *
 * 字段对应关系(SDK 0.3.206):
 * - `requestId` —— SDK 生成的唯一 id,web 端回复时回带
 * - `toolName` —— 待执行工具名(`Write` / `Edit` / `Bash` / ...)
 * - `input` —— 工具入参(原始 JSON;已脱敏)
 * - `displayName` / `title` / `description` —— UI 展示用
 * - `cwd` —— 当前 SDK cwd(便于 UI 提示)
 */
export const ChatPermissionRequestSchema = z.object({
  /** SDK 生成的请求 id —— web 端回复时回带 */
  requestId: z.string().min(1),
  /** 待执行工具名(SDK 标准名,例如 `Write` / `Edit` / `Bash`) */
  toolName: z.string().min(1),
  /** 工具入参(原始 JSON) */
  input: z.record(z.string(), z.unknown()),
  /** UI 显示名(可选;缺省回退 toolName) */
  displayName: z.string().optional(),
  /** Modal 标题(可选) */
  title: z.string().optional(),
  /** Modal 描述(可选) */
  description: z.string().optional(),
  /** 当前 SDK cwd(便于 modal 提示"在 X 目录下写 Y") */
  cwd: z.string().min(1).optional(),
})
export type ChatPermissionRequest = z.infer<typeof ChatPermissionRequestSchema>

/**
 * MCP tool handler 返回 SDK 的形态(ADR-0029 D5 + 决策 32)。
 *
 * `updatedPermissions` 用于 [Allow session] / [Allow directory] 的白名单增量:
 * - `{type: 'addRules', rules: [...], destination: 'session'}` —— 加工具规则白名单
 * - `{type: 'addDirectories', directories: [...], destination: 'session'}` ——
 *   加 cwd 之外目录白名单
 *
 * `behavior: 'allow' | 'deny'` 对应决议;`reason` 仅 deny 时有意义。
 */
export const ChatPermissionResolvedSchema = z.discriminatedUnion('behavior', [
  z.object({
    behavior: z.literal('allow'),
    /** 增量白名单规则(可空 —— 不增量也合法) */
    updatedPermissions: z
      .array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('addRules'),
            rules: z.array(
              z.object({
                toolName: z.string().min(1),
                ruleContent: z.string().min(1),
              }),
            ),
            destination: z.literal('session'),
          }),
          z.object({
            type: z.literal('addDirectories'),
            directories: z.array(z.string().min(1)),
            destination: z.literal('session'),
          }),
        ]),
      )
      .optional(),
    /** allow 时 reason 一般为空;保留字段便于"允许但提示"场景 */
    reason: z.string().optional(),
  }),
  z.object({
    behavior: z.literal('deny'),
    /** 拒绝理由 —— AI 收到后调整方案 */
    reason: z.string().optional(),
  }),
])
export type ChatPermissionResolved = z.infer<typeof ChatPermissionResolvedSchema>

// ---------------------------------------------------------------------------
// D10:消息 content 块
// ---------------------------------------------------------------------------

/**
 * User 消息 content 块(POST .../query body 的 content 数组单条)。
 *
 * 本期形态:
 * - `text` —— 纯文本片段
 * - `attachment` —— 客户端提供的附件(本期仅允许外部 url,不接受二进制
 *   inline;二进制路径留给未来扩展)
 *
 * 扩展原则:加新 kind 时 union 添加新分支;同时更新 PRD 与测试。
 */
export const ChatMessageUserContentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('attachment'),
    url: z.string().url(),
    /** 附件名(便于 UI 展示) */
    name: z.string().min(1).optional(),
  }),
])
export type ChatMessageUserContent = z.infer<typeof ChatMessageUserContentSchema>

/**
 * Assistant 消息 content 块(SSE 流式推送给 web 端)。
 *
 * - `text` —— 文本片段;`partial: true` 表示打字机流式追加中
 * - `thinking` —— AI 思考块;与 text 视觉区分(决策 49)
 * - `tool_use` —— 工具调用请求(对应 `chat_tool_call` SSE 事件,但允许
 *   与 text 块共置在同一条 assistant 消息内)
 */
export const ChatMessageAssistantContentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    /** 是否打字机增量追加中(决策 32:20ms/字符) */
    partial: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('thinking'),
    text: z.string(),
    partial: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('tool_use'),
    /** SDK tool_use.id —— 全局唯一,用于匹配后续 tool_result */
    toolUseId: z.string().min(1),
    name: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    partial: z.boolean().optional(),
  }),
])
export type ChatMessageAssistantContent = z.infer<
  typeof ChatMessageAssistantContentSchema
>

// ---------------------------------------------------------------------------
// D10:9 类 SSE 主事件 + 4 类 sub-agent 事件(ADR-0029 决策 24)
// ---------------------------------------------------------------------------

/**
 * SSE 事件 ts 字段 —— 数字时间戳(毫秒),与现有 SseEvent 一致
 * (见 `apps/shared/src/sse.ts` 的 `ts: number` 约定)。
 */
const SseTsSchema = z.number().int().nonnegative()

/**
 * Sub-agent 4 类事件变体(任务工具透传 SDK task_* 事件)。
 *
 * 抽出私有数组,避免在 `ChatSessionEventSchema` 与
 * `ChatSubAgentEventSchema` 两处重复定义同一 4 个变体(Duplicated Code
 * 解):前者用于 SSE 流上下文,后者用于嵌入 assistant message 的
 * `<SubAgentBlock>` 组件 narrow。
 */
const SubAgentEventVariants = [
  z.object({
    kind: z.literal('task_started'),
    ts: SseTsSchema,
    taskId: z.string().min(1),
    description: z.string(),
    agentType: z.string().min(1),
  }),
  z.object({
    kind: z.literal('task_progress'),
    ts: SseTsSchema,
    taskId: z.string().min(1),
    summary: z.string(),
  }),
  z.object({
    kind: z.literal('task_notification'),
    ts: SseTsSchema,
    taskId: z.string().min(1),
    message: z.string(),
    /** notification 携带的状态:启动 / 进度 / 警告 / 完成 */
    status: z.enum(['started', 'progress', 'warning', 'completed']),
  }),
  z.object({
    kind: z.literal('task_completed'),
    ts: SseTsSchema,
    taskId: z.string().min(1),
    result: z.unknown(),
    durationMs: z.number().int().nonnegative(),
  }),
] as const

/**
 * 9 类主 SSE 事件 + 4 类 sub-agent 事件的 discriminated union。
 *
 * 事件类型(kind):
 * 1. `chat_session_init` —— SDK system/init 消息(sessionId / cwd / model / tools)
 * 2. `chat_message_user` —— 我们生成的 user 消息(POST .../query 落 SSE)
 * 3. `chat_message_assistant` —— SDK assistant 消息 + 流式增量
 * 4. `chat_tool_call` —— SDK tool_use block(部分完成 / 完整)
 * 5. `chat_tool_result` —— SDK tool_result block
 * 6. `chat_permission_request` —— MCP tool handler 推
 * 7. `chat_permission_resolved` —— handler 决议后推
 * 8. `chat_error` —— SDK error 消息
 * 9. `chat_complete` —— SDK result 消息终态
 * 10. `task_started` / `task_progress` / `task_notification` / `task_completed`
 *     —— sub-agent 事件(决策 24 透传 SDK task_* 事件)
 */
export const ChatSessionEventSchema = z.discriminatedUnion('kind', [
  // 1) chat_session_init —— SDK system/init 消息
  z.object({
    kind: z.literal('chat_session_init'),
    ts: SseTsSchema,
    sessionId: ChatSessionIdSchema,
    cwd: z.string().min(1),
    model: z.string().min(1),
    /** SDK 当前可用的工具名列表(Read / Write / Bash / ...) */
    tools: z.array(z.string().min(1)),
    /** 当前 permission mode 镜像(便于 UI 启动时同步) */
    permissionMode: ChatPermissionModeSchema,
  }),
  // 2) chat_message_user —— 我们生成的 user 消息
  z.object({
    kind: z.literal('chat_message_user'),
    ts: SseTsSchema,
    content: z.array(ChatMessageUserContentSchema),
  }),
  // 3) chat_message_assistant —— SDK assistant 消息 + 流式增量
  z.object({
    kind: z.literal('chat_message_assistant'),
    ts: SseTsSchema,
    content: z.array(ChatMessageAssistantContentSchema),
  }),
  // 4) chat_tool_call —— SDK tool_use block
  z.object({
    kind: z.literal('chat_tool_call'),
    ts: SseTsSchema,
    /** SDK tool_use.id —— 全局唯一 */
    id: z.string().min(1),
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    /** 部分完成 true / 完整 false;UI 据此 spinner */
    partial: z.boolean(),
  }),
  // 5) chat_tool_result —— SDK tool_result block
  z.object({
    kind: z.literal('chat_tool_result'),
    ts: SseTsSchema,
    /** 对应 tool_use.id */
    id: z.string().min(1),
    name: z.string().min(1),
    content: z.unknown(),
    isError: z.boolean(),
  }),
  // 6) chat_permission_request —— MCP tool handler 推
  z.object({
    kind: z.literal('chat_permission_request'),
    ts: SseTsSchema,
    requestId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    displayName: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    cwd: z.string().min(1).optional(),
    /**
     * true = 命中敏感模式(rm -rf /, chmod 777, mkfs, dd, git push --force,
     * curl | sh),UI 必须强制弹 modal(issue 04 · ADR-0029 D5)
     */
    forced: z.boolean().optional(),
  }),
  // 7) chat_permission_resolved —— handler 决议后推
  z.object({
    kind: z.literal('chat_permission_resolved'),
    ts: SseTsSchema,
    requestId: z.string().min(1),
    decision: ChatDecisionWithReasonSchema,
  }),
  // 8) chat_error —— SDK error 消息或路由层兜底
  z.object({
    kind: z.literal('chat_error'),
    ts: SseTsSchema,
    /**
     * 错误码 —— issue 13 收紧为 enum:
     * - `E_QUERY_FAILED` —— 路由层 catch(SDK 抛 / SSE 写失败等通用兜底)
     * - `E_SESSION_EXPIRED` —— SDK resume 不存在的 session(典型:`/start` 时
     *   FakeChatProvider 落 'sdk-fake-001' 假 id,后续切真 Provider 再 /query
     *   真 SDK 找不到该 session)。前端收到此 code 须自动调 reset 端点
     *   走端到端自愈,无需用户介入。
     */
    code: z.enum(['E_QUERY_FAILED', 'E_SESSION_EXPIRED']),
    message: z.string().min(1),
    /** 可恢复标志 —— Web 端据此决定 retry 入口 */
    recoverable: z.boolean(),
    category: z.enum(['A', 'B', 'C', 'D', 'E']).optional(),
  }),
  // 9) chat_complete —— SDK result 消息终态
  z.object({
    kind: z.literal('chat_complete'),
    ts: SseTsSchema,
    sessionId: ChatSessionIdSchema,
    /** 累计 token(input + output) */
    totalTokens: z.number().int().nonnegative(),
    /** 累计 cost(USD) */
    cost: z.number().nonnegative(),
    /** 终止原因 */
    reason: z.enum(['end_turn', 'cancelled', 'error', 'max_tokens']),
  }),
  // 10) sub-agent 事件(决策 24 透传 SDK task_* 事件)
  ...SubAgentEventVariants,
])
export type ChatSessionEvent = z.infer<typeof ChatSessionEventSchema>

/** ChatSessionEventSchema 的 kind 字段字面量集合(给上层 narrow switch 用)。 */
export type ChatSessionEventKind = ChatSessionEvent['kind']

/**
 * Sub-agent 4 类事件专属 union —— 给 web 端嵌入 assistant message 的
 * `<SubAgentBlock>` 组件 narrow 用。
 *
 * 复用 `SubAgentEventVariants`,与 `ChatSessionEventSchema` 共享同一份定义。
 */
export const ChatSubAgentEventSchema = z.discriminatedUnion('kind', [
  ...SubAgentEventVariants,
])
export type ChatSubAgentEvent = z.infer<typeof ChatSubAgentEventSchema>

// ---------------------------------------------------------------------------
// D16:Audit log 8 项字段(ADR-0029 决策 50)
// ---------------------------------------------------------------------------

/**
 * Audit log 决议主体(ADR-0029 D16 / 决策 50 + issue 06)。
 *
 * 5 个决定者维度,按主体是否到用户 UI 区分:
 * - `user` —— 用户在前端 modal 显式决议(Allow once / Deny)
 * - `auto-allow-toggle` —— 读工具命中 auto-allow toggle,SDK 内部放行;
 *   用户可在 board chat 上关 toggle 走 user 路径(同 sessionIn-memory permit cache)
 * - `bypassPermissions` —— 用户开 `permissionMode: bypassPermissions`,
 *   SDK 全部跳过拦截;此为模式级开关
 * - `timeout` —— 用户长时间未响应默认 deny
 * - `deny-pattern` —— 命中我们 hard-coded 敏感模式(`rm -rf /` /
 *   `chmod 777` / `mkfs` / `dd of=/dev/sda` / `git push --force` /
 *   `curl | sh`),handler 直接 deny
 */
export const ChatAuditDecidedBy = {
  USER: 'user',
  AUTO_ALLOW_TOGGLE: 'auto-allow-toggle',
  BYPASS_PERMISSIONS: 'bypassPermissions',
  TIMEOUT: 'timeout',
  DENY_PATTERN: 'deny-pattern',
} as const

export type ChatAuditDecidedByT =
  (typeof ChatAuditDecidedBy)[keyof typeof ChatAuditDecidedBy]

export const ChatAuditDecidedBySchema = z.enum(
  Object.values(ChatAuditDecidedBy) as [
    ChatAuditDecidedByT,
    ...ChatAuditDecidedByT[],
  ],
)

/**
 * Audit log 单条记录,落 `~/.aidevspace/audit/<reqId>/<cardId>/chat.log` JSONL。
 *
 * 8 项字段(ADR-0029 决策 50):
 * - `ts` —— 工具调用开始时间(ISO 8601)
 * - `toolName` —— SDK 工具名(Write / Edit / Bash / ...)
 * - `toolUseId` —— SDK tool_use.id(对应 audit 单条)
 * - `args` —— 工具入参(已脱敏)
 * - `result` —— 工具结果(已脱敏);error 时含 error 信息
 * - `decision` —— 'allow' / 'deny'(MCP tool 决议结果)
 * - `decidedBy` —— 决议主体:`ChatAuditDecidedBySchema` 5 维(见上)
 * - `durationMs` —— 工具执行耗时(毫秒)
 *
 * 物理隔离(ADR-0029 D16):audit log 与 session.json 物理独立,跟 Run
 * 体系 audit 不混淆;30 天保留,跟 SDK session 同步 sweep。
 */
export const ChatToolAuditSchema = z.object({
  /** 工具调用开始时间(ISO 8601) */
  ts: IsoDateTimeSchema,
  /** SDK 工具名(Write / Edit / Bash / Read / ...) */
  toolName: z.string().min(1),
  /** SDK tool_use.id —— 全局唯一 */
  toolUseId: z.string().min(1),
  /** 工具入参(已脱敏;二进制 / 长字段压缩) */
  args: z.record(z.string(), z.unknown()),
  /** 工具结果(已脱敏;失败时含 error 信息) */
  result: z.unknown(),
  /** 决议结果 */
  decision: ChatDecisionSchema,
  /** 决议主体 —— 5 维(见 `ChatAuditDecidedBySchema`) */
  decidedBy: ChatAuditDecidedBySchema,
  /** 工具执行耗时(毫秒) */
  durationMs: z.number().int().nonnegative(),
})
export type ChatToolAudit = z.infer<typeof ChatToolAuditSchema>

// ---------------------------------------------------------------------------
// HTTP 路由契约(ADR-0029 D3 / D4 / D7 / D8 / D9)
// ---------------------------------------------------------------------------

/**
 * GET `/chat/sessions/<reqId>/<cardId>/snapshot` 响应契约。
 *
 * - `meta` —— session.json 元数据(session 不存在时为 null,UI 走空态)
 * - `events` —— 历史 SSE 事件流(从 SDK jsonl 派生;用于跨刷新渲染)
 *
 * 注意:这里 `meta` 为 null 时 `events` 也必须为空数组 —— 没有 session
 * 就没有历史;UI 据此判定走"空 chat 框"渲染。
 */
export const ChatSessionSnapshotResponseSchema = z.object({
  meta: ChatSessionMetaSchema.nullable(),
  events: z.array(ChatSessionEventSchema).default([]),
})
export type ChatSessionSnapshotResponse = z.infer<
  typeof ChatSessionSnapshotResponseSchema
>

/**
 * POST `/chat/sessions/<reqId>/<cardId>/query` body 契约。
 *
 * - `content` —— 本次 query 的 user 消息 content 数组(支持多模态扩展)
 * - `model` —— 可选覆盖 session.json.model(本期固定走 session.json;保留
 *   字段便于未来临时切换)
 */
export const ChatSessionQueryRequestSchema = z.object({
  content: z.array(ChatMessageUserContentSchema).min(1),
  model: z.string().min(1).optional(),
})
export type ChatSessionQueryRequest = z.infer<
  typeof ChatSessionQueryRequestSchema
>

/**
 * POST `/chat/sessions/<reqId>/<cardId>/start` body 契约(issue 12)。
 *
 * **与 `/query` 共用 schema 已弃用**:`/start` 只 bootstrap sessionId,
 * 不处理用户输入(用户首条消息由 `/query` 唯一处理,见 issue 10)。
 * 共用 schema 会暴露"它们语义一致"的错误信号,且要求 client 传
 * `content` 既冗余又误导。
 *
 * 字段:
 * - `model` —— 可选覆盖 session.json.model(本期固定走 session.json;
 *   保留字段便于未来临时切换)
 *
 * Back-compat 策略(issue 12 How to apply):老客户端可能仍带 `content` 字段;
 * zod 默认 strip 未知字段,**服务端静默忽略**(不报错),不破老调用。
 * 后续若新增字段必须为 optional,且不得删除现有 optional 字段(老客户端
 * 可能在跑)。
 */
export const ChatSessionStartRequestSchema = z.object({
  model: z.string().min(1).optional(),
})
export type ChatSessionStartRequest = z.infer<
  typeof ChatSessionStartRequestSchema
>

/**
 * PUT `/chat/sessions/<reqId>/<cardId>/model` body 契约(ADR-0029 D7)。
 *
 * - `model` —— 目标 model 名
 * - `confirmExpensive` —— 切换昂贵 model(opus)时前端必须先弹 confirm 再提交,
 *   web 端用 `expectedCostMultiplier` 展示"X 倍";后端不重复拦截(信任调用方)
 */
export const ChatSessionModelSwitchRequestSchema = z.object({
  model: z.string().min(1),
  /** 单价倍数 —— 仅供 UI 展示,不做服务端权威校验 */
  expectedCostMultiplier: z.number().positive().optional(),
})
export type ChatSessionModelSwitchRequest = z.infer<
  typeof ChatSessionModelSwitchRequestSchema
>

/**
 * POST `/chat/sessions/<reqId>/<cardId>/permission` body 契约(ADR-0029 D5)。
 *
 * - `requestId` —— 对应 `chat_permission_request` SSE 事件的 requestId
 * - `decision` —— 用户决议
 * - `updatedPermissions` —— [Allow session] / [Allow directory] 增量白名单
 */
export const ChatSessionPermissionResolveRequestSchema = z.object({
  requestId: z.string().min(1),
  decision: ChatDecisionWithReasonSchema,
  updatedPermissions: ChatPermissionResolvedSchema,
})
export type ChatSessionPermissionResolveRequest = z.infer<
  typeof ChatSessionPermissionResolveRequestSchema
>

/**
 * POST `/chat/sessions/<reqId>/<cardId>/cost-cap` body 契约(ADR-0029 D8 决策 41)。
 *
 * 单 session cost 累计超 $5 触发 `<CostCapModal>` 时,用户选择 4 选项之一:
 * - `continue_once` —— 继续本次 query,本次不计 cap
 * - `continue_session` —— 本 session 后续不再 cap
 * - `pause` —— 暂停当前 query,等待用户后续指令
 * - `new_session` —— 关闭当前 session,新建一个
 */
export const ChatCostCapResolve = {
  CONTINUE_ONCE: 'continue_once',
  CONTINUE_SESSION: 'continue_session',
  PAUSE: 'pause',
  NEW_SESSION: 'new_session',
} as const

export type ChatCostCapResolveT =
  (typeof ChatCostCapResolve)[keyof typeof ChatCostCapResolve]

export const ChatCostCapResolveSchema = z.enum(
  Object.values(ChatCostCapResolve) as [ChatCostCapResolveT, ...ChatCostCapResolveT[]],
)

export const ChatSessionCostCapResolveSchema = z.object({
  resolve: ChatCostCapResolveSchema,
})
export type ChatSessionCostCapResolve = z.infer<
  typeof ChatSessionCostCapResolveSchema
>

/**
 * PUT `/chat/sessions/<reqId>/<cardId>/plan-mode` body 契约(ADR-0029 D8 决策 34-37)。
 *
 * - `enabled` —— true 进入 plan mode / false 切回 default
 * - 仅在 session 当前 `permissionMode !== 'bypassPermissions'` 时允许;
 *   auto-allow on 时 plan toggle disabled(由 web 端拦截 + 后端二次校验)
 */
export const ChatPlanModeToggleSchema = z.object({
  enabled: z.boolean(),
})
export type ChatPlanModeToggle = z.infer<typeof ChatPlanModeToggleSchema>

/**
 * PUT `/chat/sessions/<reqId>/<cardId>/permission-mode` body 契约
 * (ADR-0029 D4 / D8 · issue 08 auto-allow toggle)。
 *
 * - `enabled` —— true 切 `bypassPermissions`(auto-allow on,SDK 全部跳过拦截);
 *   false 切回 `default`(恢复写工具弹 modal)
 * - 与 plan mode 互斥:session 当前 `permissionMode === 'plan'` 时拒绝
 *   (后端二次校验 + web 端 disabled,对称于 plan-mode 路由对 bypassPermissions 的守门)
 */
export const ChatPermissionModeToggleSchema = z.object({
  enabled: z.boolean(),
})
export type ChatPermissionModeToggle = z.infer<
  typeof ChatPermissionModeToggleSchema
>

// ---------------------------------------------------------------------------
// 错误码(reason → { code, status } 单一来源,与 board-card.ts 风格一致)
// ---------------------------------------------------------------------------

/**
 * Board chat 业务错误 reason 字面量。
 *
 * - `invalid-id` / `invalid-body` —— 路由层 400
 * - `requirement-not-found` / `card-not-found` / `session-not-found` —— 404
 * - `session-locked` —— 409(同 `(reqId, cardId)` in-flight query 锁冲突)
 * - `permission-denied` —— 403
 * - `cost-cap-exceeded` —— 402(用户必须先回 cost-cap resolve)
 * - `internal` —— 500
 */
export type BoardChatFailReason =
  | 'invalid-id'
  | 'invalid-body'
  | 'requirement-not-found'
  | 'card-not-found'
  | 'session-not-found'
  | 'session-locked'
  | 'permission-denied'
  | 'cost-cap-exceeded'
  | 'internal'

export const REASON_TO_HTTP_STATUS_BOARD_CHAT: Record<
  BoardChatFailReason,
  { code: string; status: number }
> = {
  'invalid-id': { code: 'E_INVALID_ID', status: 400 },
  'invalid-body': { code: 'E_INVALID_BODY', status: 400 },
  'requirement-not-found': {
    code: 'E_REQUIREMENT_NOT_FOUND',
    status: 404,
  },
  'card-not-found': { code: 'E_CARD_NOT_FOUND', status: 404 },
  'session-not-found': { code: 'E_SESSION_NOT_FOUND', status: 404 },
  'session-locked': { code: 'E_SESSION_LOCKED', status: 409 },
  'permission-denied': { code: 'E_PERMISSION_DENIED', status: 403 },
  'cost-cap-exceeded': { code: 'E_COST_CAP_EXCEEDED', status: 402 },
  'internal': { code: 'E_INTERNAL', status: 500 },
}
