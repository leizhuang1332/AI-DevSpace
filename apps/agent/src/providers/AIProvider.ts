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