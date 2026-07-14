/**
 * SessionBroadcaster tests —— ADR-0010 Q10.2/Q10.4 双通道投递
 *
 * 覆盖(Q10.2 验收 + Q10.4 验收):
 *  - AIEvent 同时推到 reqId + sessionId 两个通道
 *  - tool_use(Edit/Write/NotebookEdit)与 file_written 累加 recentWrites
 *  - session.close() → broadcaster.close() 清理该 session 通道订阅者
 *  - 写工具以外的 tool_use(Read/Grep)不计入 recentWrites
 *  - streamKind 字段正确附带(chat/activity/lifecycle)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { SessionStateRegistry } from '../session/SessionStateRegistry.js'
import { attachSessionBroadcaster, makeStateChangePublisher } from '../sse/sessionBroadcaster.js'
import type { AISession } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'

function fakeSession(id: string, reqId: string): {
  session: AISession
  push: (event: AIEvent) => void
  end: () => void
} {
  // 单一 queue / pending,所有 events() 调用共享 —— 避免每次新建时把旧的 iterator 漏掉
  const queue: AIEvent[] = []
  const pending: Array<(v: IteratorResult<AIEvent>) => void> = []
  let closed = false
  const session: AISession = {
    id,
    reqId,
    kind: 'chat',
    topic: 'test',
    state: 'idle',
    sdkSessionId: undefined,
    model: undefined,
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<AIEvent>> => {
          if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false })
          if (closed) return Promise.resolve({ value: undefined, done: true })
          return new Promise((resolve) => pending.push(resolve))
        },
        return: async () => {
          if (closed) return { value: undefined, done: true }
          closed = true
          while (pending.length) pending.shift()!({ value: undefined, done: true })
          return { value: undefined, done: true }
        },
      }),
    }),
    send: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    close: async () => {
      if (closed) return
      closed = true
      while (pending.length) pending.shift()!({ value: undefined, done: true })
    },
  }
  return {
    session,
    push: (event: AIEvent) => {
      if (closed) return
      const r = pending.shift()
      if (r) r({ value: event, done: false })
      else queue.push(event)
    },
    end: () => session.close(),
  }
}

/** 让 microtask 队列 flush —— vitest 同步测试块边界可能卡 for-await 的 continuation */
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
}

describe('attachSessionBroadcaster (Q10.2/Q10.4)', () => {
  let hub: SseHub
  let registry: SessionStateRegistry

  beforeEach(() => {
    hub = createSseHub({ heartbeatMs: 60_000 })
    registry = new SessionStateRegistry()
  })

  it('AIEvent 同时推到 reqId 和 sessionId 通道', async () => {
    const { session, push, end } = fakeSession('sid-1', 'REQ-001')
    const broadcaster = attachSessionBroadcaster(session, 'REQ-001', {
      hub,
      registry,
      runId: 'run-1',
    })
    const reqEvents: unknown[] = []
    const sessionEvents: unknown[] = []
    hub.subscribe('REQ-001', (e) => reqEvents.push(e))
    hub.subscribe('sid-1', (e) => sessionEvents.push(e))

    push({ type: 'text', text: 'hi', delta: false })
    push({ type: 'done', reason: 'end_turn' })
    end()
    await flush()
    await broadcaster.close()

    expect(reqEvents).toHaveLength(2)
    expect(sessionEvents).toHaveLength(2)
    // 两个流应该内容一致(streamKind + event 都带)
    expect(reqEvents[0]).toMatchObject({
      type: 'ai_event',
      streamKind: 'chat',
      event: { type: 'text', text: 'hi' },
    })
    expect(sessionEvents[0]).toMatchObject({
      type: 'ai_event',
      streamKind: 'chat',
      event: { type: 'text', text: 'hi' },
    })
    expect(reqEvents[1]).toMatchObject({ type: 'ai_event', streamKind: 'lifecycle' })
  })

  it('写工具 tool_use(Edit) → 累加 recentWrites + 广播 session_writes', async () => {
    const { session, push, end } = fakeSession('sid-1', 'REQ-001')
    registry.register(session)
    const broadcaster = attachSessionBroadcaster(session, 'REQ-001', {
      hub,
      registry,
      runId: 'run-1',
    })
    const sessionEvents: { type: string }[] = []
    hub.subscribe('sid-1', (e) => sessionEvents.push(e))

    push({ type: 'tool_use', name: 'Edit', input: { path: '/x' } })
    push({ type: 'tool_use', name: 'Write', input: { path: '/y' } })
    push({ type: 'file_written', path: '/z', lines: 3 })
    end()
    await flush()
    await broadcaster.close()

    // 3 个 tool 事件 → 3 个 ai_event + 3 个 session_writes
    const writeEvts = sessionEvents.filter((e) => e.type === 'session_writes')
    expect(writeEvts).toHaveLength(3)
    expect(writeEvts.at(-1)).toMatchObject({ type: 'session_writes', recentWrites: 3 })
    expect(registry.get('sid-1')?.recentWrites).toBe(3)
  })

  it('读类 tool_use(Read/Grep) 不计入 recentWrites(Q10.3 活动流仍展示,但不是「写」)', async () => {
    const { session, push, end } = fakeSession('sid-2', 'REQ-001')
    registry.register(session)
    const broadcaster = attachSessionBroadcaster(session, 'REQ-001', {
      hub,
      registry,
      runId: 'run-1',
    })
    push({ type: 'tool_use', name: 'Read', input: { path: '/x' } })
    push({ type: 'tool_use', name: 'Grep', input: { pattern: 'y' } })
    end()
    await flush()
    await broadcaster.close()

    expect(registry.get('sid-2')?.recentWrites).toBe(0)
  })

  it('broadcaster.close() 调 hub.closeChannel(sid) 驱逐订阅者', async () => {
    const { session, push, end } = fakeSession('sid-3', 'REQ-001')
    const broadcaster = attachSessionBroadcaster(session, 'REQ-001', {
      hub,
      registry,
      runId: 'run-1',
    })
    const unsub = hub.subscribe('sid-3', () => {})
    expect(hub.stats().channels).toBe(1)
    expect(hub.stats().subscribers).toBe(1)
    push({ type: 'text', text: 'x' })
    end()
    await flush()
    await broadcaster.close()
    expect(hub.stats().channels).toBe(0)
    expect(hub.stats().subscribers).toBe(0)
    unsub()
  })
})

describe('makeStateChangePublisher', () => {
  it('state 变化推到 reqId + sessionId 双通道', () => {
    const hub = createSseHub({ heartbeatMs: 60_000 })
    const reqEvents: { type: string; state?: string }[] = []
    const sessionEvents: { type: string; state?: string }[] = []
    hub.subscribe('REQ-001', (e) => reqEvents.push(e as { type: string; state?: string }))
    hub.subscribe('sid-1', (e) => sessionEvents.push(e as { type: string; state?: string }))

    const publish = makeStateChangePublisher(hub, () => 12345)
    publish({ localSid: 'sid-1', reqId: 'REQ-001', state: 'busy', ts: 12345 })
    publish({ localSid: 'sid-1', reqId: 'REQ-001', state: 'idle', ts: 12350 })

    expect(reqEvents.map((e) => e.state)).toEqual(['busy', 'idle'])
    expect(sessionEvents.map((e) => e.state)).toEqual(['busy', 'idle'])
    expect(reqEvents.every((e) => e.type === 'session_state')).toBe(true)
    expect(sessionEvents.every((e) => e.type === 'session_state')).toBe(true)
  })
})