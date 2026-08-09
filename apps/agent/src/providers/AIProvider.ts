/**
 * AIProvider 抽象接口 —— ADR-0010 Q2
 *
 * 设计原则:
 * - Provider 负责「创建会话」,Session 负责「流式对话」
 * - AIEvent 走业务事件,而不是 SDK message —— 上层不依赖 SDK 升级
 * - AIEvent 是 discriminated union,Web 端按 type narrow 即可
 *
 * 本期实现:ClaudeCodeProvider;未来切 Codex/Opencode SDK 时,实现新 Provider,
 * 接口契约不变。
 */

import type { AIEvent } from './AIEvent.js'
import type { SystemPromptAssembler } from '../prompt/SystemPromptAssembler.js'

/** session 种类 —— ADR-0010 Q2 */
export type SessionKind = 'chat' | 'task'

/** 模型角色 (对应 ANTHROPIC_DEFAULT_*_MODEL) */
export type ModelRole =
  | 'main'
  | 'haiku'
  | 'sonnet'
  | 'opus'
  | 'fable'
  | 'reasoning'

/** 模型选择 —— 来自 session.meta.model (Q9.1) */
export interface ModelSelection {
  /** cc-switch.db providers.id */
  providerId: string
  /** role 名 (e.g. 'sonnet');Provider 内部解析为 model id */
  role: ModelRole
}

/** session 状态 —— ADR-0010 Q2 */
export type SessionState = 'idle' | 'busy' | 'closed' | 'errored'

/** createSession 入参 —— 只放本期需要的最小字段 */
export interface CreateSessionOptions {
  /** 已落盘会话的稳定 local_sid;未传时 Provider 生成 UUID —— ResumeManager / spike route 传入 */
  localSid?: string
  /** 会话 topic (用户起名 / 系统生成);P0 阶段先固定 'spike' */
  topic: string
  /** chat / task;P0 阶段先固定 'chat' */
  kind: SessionKind
  /** 模型选择;未指定时由 Provider 用 ProviderIndex.models.main 兜底 */
  model?: ModelSelection
  /** 续上下文:之前 SDK 返的 sdkSessionId */
  resume?: string
  /** SDK 子进程 cwd;P0 阶段可不传 */
  cwd?: string
  /** 取消信号 —— ADR-0010 Q8.2 */
  signal?: AbortSignal
  /**
   * 自定义 system prompt 装配器 —— ticket 01 (ADR-0020 D8) 双 turn 编排需求:
   * `start` handler 创建单 session 跑双 turn,每个 turn 需要装入不同 Skill body
   * (admission-check vs requirement-brainstorm)。handler 透传一个 stateful
   * assembler,每次 `send()` 前调用 setter 切换 active skill body。
   *
   * 未传时 Provider 走自身默认 assembler(或 AISession 的 system prompt 走空,
   * 见 `AiSession` 实现)。本字段是 ticket 01 新增,接口兼容——不传时行为不变。
   */
  assembler?: SystemPromptAssembler
}

/**
 * AISession 接口 —— ADR-0010 Q2
 *
 * 单个会话的句柄,所有 AI 输出通过 events AsyncIterable 推到上层。
 * 实现需维护 state 字段,与 state machine 一致:
 *   create → idle → (send → busy) → (done/close → closed | errored)
 */
export interface AISession {
  /** 持久化 id,跨重启不变 —— ADR-0010 Q7.1 local_sid */
  readonly id: string
  /** 父需求 id */
  readonly reqId: string
  /** chat / task */
  readonly kind: SessionKind
  /** 用户起的名字 / 系统生成 */
  readonly topic: string
  /** 当前状态 */
  readonly state: SessionState
  /** SDK 返的 sessionId,可用于下次 query({ resume }) */
  readonly sdkSessionId: string | undefined
  /** 选中的 model (resolved after createSession) */
  readonly model: ModelSelection | undefined

  /**
   * 发送一段用户输入;通过 events 流式拿到 AI 输出。
   * 多次 send 复用同一 session,内部维护 turn 边界。
   */
  send(text: string, attachments?: ReadonlyArray<unknown>): Promise<void>

  /** 流式事件订阅 (state machine: idle→busy→idle/closed/errored) */
  events(): AsyncIterable<AIEvent>

  /** 取消当前轮 —— 复用 AbortController.signal */
  cancel(reason?: string): Promise<void>

  /** 关闭 session,释放资源 (state → closed) */
  close(): Promise<void>
}

/**
 * AIProvider 抽象接口 —— ADR-0010 Q2
 *
 * 未来切 Codex / Opencode SDK 时,实现新的 Provider 即可。
 */
export interface AIProvider {
  /** provider 名字 (e.g. 'claude-code');用于 session.meta.provider */
  readonly name: string

  /**
   * 创建一个 session —— 不立即启动 SDK 进程;
   * 实际 spawn 由首次 send() 触发(SDK 内部管理)。
   */
  createSession(reqId: string, opts: CreateSessionOptions): Promise<AISession>

  /** 关闭所有 session (e.g. agent 退出时) */
  shutdown(): Promise<void>
}

// ============================================================================
// Analysis Run 专用扩展(issue 02 · ADR-0021)
//
// AIProvider 接口默认只覆盖 chat/task session 路径。Analysis Run 需要
// 完全替换 systemPrompt + 通过 in-process MCP server 注入业务工具
// `report_analysis_issue` / `complete_analysis`,不走 AISession 包装。
//
// 通过 module augmentation 让 ClaudeCodeProvider 在自身实现该方法,
// 测试 fake provider 可选择不实现(由 AnalysisAgentRunner 走兜底)。
// ============================================================================

/** Analysis Run 路径入参(issue 02) */
export interface AnalysisQueryInput {
  prompt: string
  /** 完全替换 Claude Code 默认 system prompt(ADR-0021 决策 16) */
  systemPrompt: string
  /** SDK 子进程 cwd(指向非 git 目录,避免 git-ai.exe trace2 fork) */
  cwd: string
  /** 只读宿主工具白名单(Read / Glob / Grep) */
  allowedTools: ReadonlyArray<string>
  /** 业务工具名 → handler;handler 同步处理 + 返回 tool_result 喂回模型 */
  businessTools: Record<string, (toolUseId: string, args: unknown) => unknown>
  /**
   * 业务工具 description 覆盖(可选,key 为 tool 名)。issue 13 真因:
   * - 默认 description 是 `平台业务工具:<name>。由 handler 在平台进程内执行持久化`,
   *   对 PrdSplitRunner 这种"自定义身份"路径语义错位 → 模型谨慎 end_turn
   * - caller 注入对齐 system prompt 语义(BOARD 工位 / Analysis Run 工位)
   *   由 runner 各自负责;不传走默认
   */
  businessToolDescriptions?: Record<string, string>
  /** SDK envelope 流式回调(由 AnalysisAgentRunner 落到 log + SSE) */
  onEvent: (envelope: unknown) => void
}

/** Analysis Run 路径结果 */
export type AnalysisQueryResult =
  | { ok: true }
  | { ok: false; error: string }

/** 扩展:Analysis Run 直接 SDK query 接口(可选 —— 普通 Provider 不必实现) */
export interface AnalysisQueryCapableProvider {
  runAnalysisQuery(input: AnalysisQueryInput): Promise<AnalysisQueryResult>
}

// ============================================================================
// Board chat 路径扩展(issue 03 · ADR-0029 D4 + D9 + D10)
//
// board chat 是 web 端 Claude Code CLI 镜像(per-TaskCard SDK session);
// 跟 Analysis Run 是两条独立的 SDK query 路径(ADR-0029 D11 + ADR-0023 守门):
// - Run 路径走 `runAnalysisQuery` + 业务 MCP server `analysis-run-tools`
// - Chat 路径走 `runChatQuery` + 业务 MCP server `boardchat__user_confirm`
//
// 严格命名空间隔离:chat 路径不进入 runAnalysisQuery 闭包,不污染
// `mcpCallCounter`(issue 02 守门契约)。
// ============================================================================

/** board chat 单次 query 输入(ADR-0029 D4) */
export interface ChatQueryInput {
  /** 用户本次输入文本(模型 prompt) */
  prompt: string
  /** SDK options.cwd —— board/tasks/<ulid>/ 绝对路径 */
  cwd: string
  /** SDK options.additionalDirectories —— 父 req dir + Requirement.repos worktree */
  additionalDirectories: ReadonlyArray<string>
  /** SDK options.model —— claude-sonnet-5 默认,切昂贵 model 走 PUT /model */
  model: string
  /** SDK options.permissionMode —— 'default' | 'plan' | 'bypassPermissions' */
  permissionMode: 'default' | 'plan' | 'bypassPermissions'
  /** SDK sessionId(resume 协议 D9)—— 首次 query 留空,后续 query 必带 */
  resumeSessionId?: string
  /**
   * resume 协议冻结的 cwd(ADR-0029 D4 + D9):ChatSessionService 从落盘
   * session.json 读到的 cwd,Provider 优先采纳,忽略调用方传入的 cwd。
   * 首次 query 不传(没有落盘 session.json);后续 resume 必须传。
   *
   * 设计动机:resume 时调用方可能传新 cwd,但 SDK resume 协议要求 cwd 与
   * session 创建时一致 —— 由 ChatSessionService 作为唯一真相源,确保
   * Provider 永远用落盘的 cwd,避免 SDK 拒绝 resume。
   */
  frozenCwd?: string
  /** MCP tool handler —— provider 内部包装为 `mcp__boardchat__user_confirm` */
  userConfirmHandler: (
    args: {
      toolName: string
      input: Record<string, unknown>
      requestId: string
      displayName?: string
      title?: string
      description?: string
    },
  ) => Promise<
    | {
        behavior: 'allow'
        updatedPermissions?: ReadonlyArray<unknown>
        reason?: string
      }
    | { behavior: 'deny'; message?: string }
  >
  /** SDK envelope + SSE 事件回调 —— 由 ChatSessionService 落到 SSE hub */
  onEvent: (event: ChatStreamEvent) => void
  /** 取消信号 —— 服务端清理 in-flight query 用 */
  signal?: AbortSignal
}

/** chat 路径 SDK envelope → SSE 事件 统一形态 */
export type ChatStreamEvent =
  | { kind: 'session_init'; sessionId: string; cwd: string; model: string }
  | { kind: 'message_user'; ts: number; text: string }
  | {
      kind: 'message_assistant'
      ts: number
      text?: string
      thinking?: string
      partial?: boolean
    }
  | {
      kind: 'tool_call'
      ts: number
      id: string
      name: string
      args: Record<string, unknown>
      partial: boolean
    }
  | {
      kind: 'tool_result'
      ts: number
      id: string
      name: string
      output: unknown
      isError: boolean
    }
  | {
      kind: 'permission_request'
      ts: number
      requestId: string
      toolName: string
      input: Record<string, unknown>
      displayName?: string
      title?: string
      description?: string
      /**
       * true = 命中敏感模式(rm -rf /, chmod 777, mkfs, dd, git push --force,
       * curl | sh),UI 必须强制弹 modal;不能被 route 层 auto-allow 旁路
       * (issue 04 · ADR-0029 D5 敏感模式永弹)
       */
      forced?: boolean
    }
  | { kind: 'permission_resolved'; ts: number; requestId: string }
  | { kind: 'task_started'; ts: number; taskId: string; description: string; agentType: string }
  | { kind: 'task_progress'; ts: number; taskId: string; summary: string }
  | { kind: 'task_completed'; ts: number; taskId: string; result: unknown; durationMs: number }
  | { kind: 'error'; ts: number; code: string; message: string; recoverable: boolean }
  | {
      kind: 'complete'
      ts: number
      sessionId: string
      totalTokens: number
      cost: number
      reason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens'
    }

/** board chat 路径结果 */
export type ChatQueryResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string }

/** 扩展:board chat 直接 SDK query 接口(可选 —— 普通 Provider 不必实现) */
export interface ChatQueryCapableProvider {
  runChatQuery(input: ChatQueryInput): Promise<ChatQueryResult>
}

// ============================================================================
// AIProvider module augmentation —— 让可选方法挂到接口上
// (TypeScript 的 declaration merging 不能直接扩展同名属性,通过函数签名
// 兼容实现 —— 调用前用 type guard 检验)。
//
// 集中放这里,把 Analysis Run (issue 02) + Board chat (issue 03) 两个可选
// 扩展并列;AnalysisAgentRunner / board chat 路由各自 type-guard 后调用。
// ============================================================================
declare module './AIProvider.js' {
  interface AIProvider {
    /** 见 AnalysisQueryCapableProvider(issue 02);非 Analysis Run 场景
     *  不必实现 —— AnalysisAgentRunner 会 type-guard 后调用 */
    runAnalysisQuery?: AnalysisQueryCapableProvider['runAnalysisQuery']
    /** 见 ChatQueryCapableProvider(issue 03);chat 路径专用 —
     *  board chat 路由(issue 05) type-guard 后调用 */
    runChatQuery?: ChatQueryCapableProvider['runChatQuery']
  }
}
