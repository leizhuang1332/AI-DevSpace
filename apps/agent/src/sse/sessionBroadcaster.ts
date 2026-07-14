/**
 * Per-session SSE broadcaster —— ADR-0010 Q10.2/Q10.4
 *
 * 把单个 AISession 的事件流扇出到两类订阅者:
 *  - **req-level 通道**(reqId):同一需求下所有 session 的事件汇集,Web 端
 *    在 overview / 跨 session 视图里用
 *  - **session-level 通道**(localSid):该 session 的专属事件流,Web 端打开
 *    单 session tab 时订阅(Q10.2 验收:N session 各开 1 条 SSE)
 *
 * 同时观察:
 *  - onStateChange —— 推到 session-level 通道 + req-level 通道(StatusBar 色码)
 *  - tool_use / file_written —— 累加「最近写入 N」并推到两通道(决策 49)
 *
 * 关闭协议:close() 取消事件 pump,调 hub.closeChannel(sessionId) 驱逐
 * 该 session 所有订阅者;后续 publish 不再触发(避免「session 关闭后还收事件」)。
 */

import type { SseHub } from './SseHub.js'
import type { AISession } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'
import type { SessionState } from '../providers/AIProvider.js'
import { mapAiEventToSse } from './mapAiEventToSse.js'
import type { SessionStateRegistry } from '../session/SessionStateRegistry.js'

/** 写入工具名集合 —— 决策 49「最近写入 N」计数目标 */
const WRITE_TOOL_NAMES = new Set(['Edit', 'Write', 'NotebookEdit'])

export interface SessionBroadcasterOptions {
  hub: SseHub
  registry: SessionStateRegistry
  runId: string
  /** 调试日志 —— 错误时打印(避免主流程被 observer 异常打断) */
  onError?: (err: unknown, ctx: { sessionId: string }) => void
  /** 时钟 —— 测试可注入 */
  nowMs?: () => number
}

export interface SessionBroadcaster {
  /** 关闭 broadcaster —— 取消事件 pump + 清掉 session 通道订阅者 */
  close(): Promise<void>
}

/**
 * 启动 broadcaster;返回 handle 用于关闭。
 *
 * 注意:本函数只 attach 监听 / pump,不持有 session 所有权;
 * 调用方仍负责 session.close()。
 */
export function attachSessionBroadcaster(
  session: AISession,
  reqId: string,
  opts: SessionBroadcasterOptions,
): SessionBroadcaster {
  const { hub, registry, runId, onError, nowMs = () => Date.now() } = opts
  let closed = false

  // 1) AIEvent pump —— 推到两通道
  const pump = (async () => {
    try {
      for await (const event of session.events()) {
        if (closed) return
        const sseEvent = mapAiEventToSse(runId, reqId, session.id, event, nowMs())
        hub.publish(reqId, sseEvent)
        hub.publish(session.id, sseEvent)
        // 写工具 / file_written → 累加「最近写入 N」并广播
        if (isWriteEvent(event)) {
          registry.recordWrite(session.id)
          hub.publish(reqId, {
            type: 'session_writes',
            reqId,
            sessionId: session.id,
            ts: nowMs(),
            recentWrites: snapshotWrites(registry, session.id),
          })
          hub.publish(session.id, {
            type: 'session_writes',
            reqId,
            sessionId: session.id,
            ts: nowMs(),
            recentWrites: snapshotWrites(registry, session.id),
          })
        }
      }
    } catch (err) {
      onError?.(err, { sessionId: session.id })
    }
  })()

  // 2) 状态变化 —— 推到两通道(Q10.4 StatusBar 色码)
  // AISession 没有暴露 onStateChange 注册入口;走 events() 的 lifecycle 子类
  // (done/error) 是终态变化,busy → idle 的隐式转换也通过这些事件触发。
  // 但 idle → busy 的转换发生在 send() 调用瞬间,在 events() 流之外 —— 因此
  // 注册一个独立 listener:每轮 send() 启动时由 AISession 通过 onStateChange
  // 调起。为简化,本函数不重复实现状态追踪,Server 层会在 AISession 构造时
  // 注入 onStateChange(对应字段见 AISession deps)。

  return {
    async close(): Promise<void> {
      if (closed) return
      closed = true
      // 取消 pump(ai_event 已经不再 emit,但 for await 可能在等下一个事件;
      // 调 session.close() 会让 events() 流自然终止)
      try {
        await pump
      } catch {
        /* ignore */
      }
      // session 关闭 → 清掉该 session 通道的所有订阅者(Q10.2 验收)
      hub.closeChannel(session.id)
    },
  }
}

/** 把 AIEvent 判定为「写入」事件(决策 49 「最近写入 N」计数目标) */
function isWriteEvent(event: AIEvent): boolean {
  if (event.type === 'file_written') return true
  if (event.type === 'tool_use') {
    return typeof event.name === 'string' && WRITE_TOOL_NAMES.has(event.name)
  }
  return false
}

/** 读 registry 当前窗口内的写入计数 */
function snapshotWrites(registry: SessionStateRegistry, sessionId: string): number {
  return registry.get(sessionId)?.recentWrites ?? 0
}

/**
 * 给 AISession 的 onStateChange 回调用的 publish 工厂 —— server.ts 在构造
 * AISession 时注入,负责把 state 变化推到两通道。
 */
export function makeStateChangePublisher(
  hub: SseHub,
  nowMs: () => number = () => Date.now(),
): (event: { localSid: string; reqId: string; state: SessionState; ts: number }) => void {
  return ({ localSid, reqId, state, ts }) => {
    const ev = { type: 'session_state' as const, reqId, sessionId: localSid, ts, state }
    hub.publish(reqId, ev)
    hub.publish(localSid, ev)
  }
}