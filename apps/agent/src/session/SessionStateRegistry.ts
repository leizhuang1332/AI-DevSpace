/**
 * SessionStateRegistry —— ADR-0010 Q10.4 + 决策 49 StatusBar 4 指示器
 *
 * 集中持有 live AISession 实例,提供:
 *  - `get(localSid)` 给 REST endpoint 读最新 state(StatusBar 刷新用)
 *  - 内部记录每个 session 的「最近写入 N」(recent_writes 计数器),由 AISession
 *    通过 onStateChange 触发 publish 时同步维护
 *  - 「待回答 N」(pending) / 「候命 N」(queued) —— 当前全局 in-flight 数 + providerSemaphore
 *    queue 数,Web 端 StatusBar 用来显示
 *
 * 不替代 AISession.state(AISession 自身仍是 source of truth);
 * registry 只做「聚合视图」,便于一个 GET 拿到所有指示器。
 */

import type { SessionState, AISession } from '../providers/AIProvider.js'
import type { ProviderSemaphore } from '../error/ProviderSemaphore.js'

/** 单 session 的状态快照(给 StatusBar 用) */
export interface SessionStateSnapshot {
  localSid: string
  reqId: string
  state: SessionState
  /** 最近 N 次写文件 / 命令执行计数(决策 49 「最近写入 N」指示器) */
  recentWrites: number
  /** 上次状态变更的 epoch ms */
  ts: number
}

/** 全局 StatusBar 4 指示器总览 —— 给 GET /api/sessions/state/all 用 */
export interface StatusBarSnapshot {
  /** 当前所有 session 的状态分布:idle/busy/closed/errored 各多少 */
  stateCounts: Record<SessionState, number>
  /** 待回答 N = 当前 busy 状态的 session 数(Web 端 StatusBar 第二指示器) */
  pending: number
  /** 候命 N = providerSemaphore 当前 queue 中等待数(决策 49 第三指示器) */
  queued: number
  /** 最近写入 N = 全局所有 session 的 recent_writes 之和(决策 49 第四指示器) */
  recentWrites: number
}

export interface SessionStateRegistryDeps {
  /** Provider FIFO 限流器(可选);提供 queued 计数 */
  providerSemaphore?: ProviderSemaphore | null
  /** 时钟注入 —— 测试可注入,默认 Date.now() */
  nowMs?: () => number
  /** 最近写入 N 的衰减窗口(默认 60_000ms);每次写入累加,超过窗口自动清零 */
  recentWritesWindowMs?: number
}

export class SessionStateRegistry {
  /** localSid → AISession 引用 */
  readonly #sessions = new Map<string, AISession>()
  /** localSid → 该 session 窗口内写入计数 */
  readonly #recentWrites = new Map<string, { count: number; windowStartMs: number }>()
  readonly #providerSemaphore: ProviderSemaphore | null | undefined
  readonly #nowMs: () => number
  readonly #windowMs: number

  constructor(deps: SessionStateRegistryDeps = {}) {
    this.#providerSemaphore = deps.providerSemaphore
    this.#nowMs = deps.nowMs ?? (() => Date.now())
    this.#windowMs = deps.recentWritesWindowMs ?? 60_000
  }

  /** 注册一个 AISession(典型在 onSessionCreated 回调中) */
  register(session: AISession): void {
    this.#sessions.set(session.id, session)
  }

  /** 注销一个 AISession(典型在 session.close() 之后) */
  unregister(localSid: string): void {
    this.#sessions.delete(localSid)
    this.#recentWrites.delete(localSid)
  }

  /** 读单个 session 的快照;不存在 → null */
  get(localSid: string): SessionStateSnapshot | null {
    const s = this.#sessions.get(localSid)
    if (!s) return null
    const rw = this.#recentWrites.get(localSid)
    const now = this.#nowMs()
    // 窗口过期 → 视为 0
    const recentWrites = rw && now - rw.windowStartMs <= this.#windowMs ? rw.count : 0
    return {
      localSid: s.id,
      reqId: s.reqId,
      state: s.state,
      recentWrites,
      ts: now,
    }
  }

  /**
   * 增加某 session 的「最近写入 N」计数。
   *
   * AISession 没有内置此信号;典型在 tool_use { name: 'Edit'/'Write'/'NotebookEdit' }
   * 通过 observers 计数时调用(server 层做 subscribe session.events 时识别)。
   */
  recordWrite(localSid: string): void {
    const now = this.#nowMs()
    const cur = this.#recentWrites.get(localSid)
    if (!cur || now - cur.windowStartMs > this.#windowMs) {
      this.#recentWrites.set(localSid, { count: 1, windowStartMs: now })
    } else {
      cur.count += 1
    }
  }

  /** 全局 StatusBar 4 指示器快照 */
  statusBar(): StatusBarSnapshot {
    const counts: Record<SessionState, number> = {
      idle: 0,
      busy: 0,
      closed: 0,
      errored: 0,
    }
    let totalWrites = 0
    const now = this.#nowMs()
    for (const s of this.#sessions.values()) {
      // s.state 是 SessionState 字面量;key 必然落在 counts 上
      counts[s.state] = (counts[s.state] ?? 0) + 1
      const rw = this.#recentWrites.get(s.id)
      if (rw && now - rw.windowStartMs <= this.#windowMs) totalWrites += rw.count
    }
    // Provider FIFO 限流器当前 queue 数 —— 给 StatusBar 「候命 N」指示器
    let queued = 0
    if (this.#providerSemaphore) {
      try {
        queued = this.#providerSemaphore.stats().queued
      } catch {
        /* 已 close 的 limiter 不应抛错 */
      }
    }
    return {
      stateCounts: counts,
      pending: counts.busy,
      queued,
      recentWrites: totalWrites,
    }
  }

  /** 列所有 active session(localSid) —— 给 dev-only debug 用 */
  listActive(): string[] {
    return [...this.#sessions.keys()]
  }
}