/**
 * SessionRecorder —— ADR-0010 Q7.1 双 ID 维护 + Q7.4 镜像 + Q8.6 partial
 *
 * 把一个 live AISession 的 events() 流接到磁盘:
 *   - 累积 assistant `text` 事件,turn 结束(done)时 flush 成 1 条消息
 *   - `thinking` / `tool_use` / `tool_result` / `file_written` /
 *     `permission_request` / `error` 各写 1 条消息(顺序保留)
 *   - done 携带 sessionId(SDK 返的)→ 回填 meta.sdkSessionId(双 ID 维护:
 *     创建时 sdkSessionId 空,首次 query 后回填)
 *   - done{reason:'error'|'cancelled'|'max_tokens'} 且有累积 partial →
 *     标 incomplete:true(Q8.6:被中断/截断的响应不完整)
 *   - `retrying` 是 query 进度信号,不在镜像中落 messages.jsonl(P4 Task 5):
 *     RetryStrategy 会按重试节奏 emit 多次,如果每条都落 messages 会污染会话
 *     时间线;真正的失败在 `error` 事件中以 category 形式落盘供诊断
 *
 * 用法:必须在 session.send() **之前** attach,才能捕获整轮事件。
 *   const rec = attachRecorder(session, { store, mirror })
 *   await session.send('...')
 *   await rec.done   // 等镜像写完
 *   rec.detach()     // 或提前停止消费
 */

import { randomUUID } from 'node:crypto'
import type { AISession } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'
import type { SessionStore } from './SessionStore.js'
import type { MessagesMirror } from './MessagesMirror.js'

export interface RecorderDeps {
  store: SessionStore
  mirror: MessagesMirror
  /** 消息 id 生成器 —— 默认 crypto.randomUUID */
  idGen?: () => string
  /** 时间戳 —— 默认 new Date().toISOString() */
  now?: () => string
}

export interface RecorderHandle {
  /** 消费循环结束的 promise(session 流关闭时 resolve) */
  done: Promise<void>
  /** 提前停止消费(不再写盘) */
  detach: () => void
}

/** 把 session 事件流接到 SessionStore + MessagesMirror */
export function attachRecorder(session: AISession, deps: RecorderDeps): RecorderHandle {
  const idGen = deps.idGen ?? (() => randomUUID())
  const now = deps.now ?? (() => new Date().toISOString())
  const reqId = session.reqId
  const localSid = session.id

  const iterable = session.events()
  const iterator = iterable[Symbol.asyncIterator]()
  let stopped = false

  /** 累积中的 assistant 文本(跨多个 text delta 事件) */
  let textBuffer = ''
  /** 本轮是否已回填过 sdkSessionId(避免重复写盘) */
  let sdkBackfilled = false

  async function flushText(incomplete: boolean): Promise<void> {
    if (textBuffer.length === 0) return
    const content = textBuffer
    textBuffer = ''
    await emit('text', 'assistant', content, undefined, incomplete)
  }

  /** 写 1 条消息到镜像;非 text 事件先 flush 掉累积文本以保留顺序 */
  async function emit(
    type: string,
    role: string,
    content: string,
    sdkMessageRaw?: unknown,
    incomplete?: boolean,
  ): Promise<void> {
    await deps.mirror.appendMessage(reqId, localSid, {
      id: idGen(),
      type,
      role,
      content,
      timestamp: now(),
      ...(sdkMessageRaw !== undefined ? { sdkMessageRaw } : {}),
      ...(incomplete ? { incomplete: true } : {}),
    })
  }

  async function handle(ev: AIEvent): Promise<void> {
    switch (ev.type) {
      case 'text':
        textBuffer += ev.text
        return
      case 'thinking':
        await flushText(false)
        await emit('thinking', 'assistant', ev.text)
        return
      case 'tool_use':
        await flushText(false)
        await emit('tool_use', 'assistant', safeJson({ name: ev.name, input: ev.input }), {
          name: ev.name, input: ev.input,
        })
        return
      case 'tool_result':
        await flushText(false)
        await emit('tool_result', 'tool', safeJson({ name: ev.name, output: ev.output }), {
          name: ev.name, output: ev.output,
        })
        return
      case 'file_written':
        await flushText(false)
        await emit('file_written', 'tool', `${ev.path} (+${ev.lines})`, {
          path: ev.path, lines: ev.lines,
        })
        return
      case 'permission_request':
        await flushText(false)
        await emit('permission_request', 'system', safeJson({ tool: ev.tool, input: ev.input }), {
          tool: ev.tool, input: ev.input,
        })
        return
      case 'retrying':
        // query 进度信号 —— 不在 messages.jsonl 中落消息,
        // 仅由 SseHub 推到 web 端(走 ai_event / retrying 通道)
        return
      case 'error':
        await emit('error', 'system', ev.message, {
          code: ev.code,
          recoverable: ev.recoverable,
          ...(ev.category ? { category: ev.category } : {}),
        })
        return
      case 'done': {
        // 双 ID 维护:回填 sdkSessionId(仅当 SDK 返了且未回填过)
        if (ev.sessionId && !sdkBackfilled) {
          sdkBackfilled = true
          try {
            await deps.store.updateSession(localSid, { sdkSessionId: ev.sessionId })
          } catch {
            // meta 已不在(session 被删)——不阻断镜像
          }
        }
        // partial:被中断(error/cancelled)或被截断(max_tokens)时,
        // 已累积的文本是不完整响应 → 标 incomplete (Q8.6)
        const incomplete =
          ev.reason === 'error' || ev.reason === 'cancelled' || ev.reason === 'max_tokens'
        await flushText(incomplete)
        return
      }
    }
  }

  const done = (async () => {
    try {
      while (!stopped) {
        const r = await iterator.next()
        if (r.done) break
        await handle(r.value)
      }
    } finally {
      // 流意外结束但还有残留文本 → 当作 incomplete flush
      await flushText(true).catch(() => {})
    }
  })()

  return {
    done,
    detach() {
      stopped = true
      void iterator.return?.(undefined)
    },
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
