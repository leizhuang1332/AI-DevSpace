/**
 * SessionRecorder tests —— ADR-0010 Q7.1 双 ID 维护 + Q7.4 镜像 + Q8.6 partial
 *
 * 覆盖:
 *  - 累积 text 事件 → done 时写 1 条 assistant 消息到 messages.jsonl
 *  - done 带 sessionId → 回填 meta.sdkSessionId(双 ID 维护)
 *  - thinking / tool_use 事件 → 各写 1 条消息(顺序保留)
 *  - done{reason:'error'|'cancelled'} 且有 partial → 标 incomplete:true
 *  - detach() 停止消费
 *  - retrying 不写 messages;error 保留 category 诊断(Task 5)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../session/SessionStore.js'
import { MessagesMirror } from '../session/MessagesMirror.js'
import { attachRecorder } from '../session/SessionRecorder.js'
import type { AISession } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidev-rec-'))
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

/** 造一个按给定事件序列 emit 的 fake session */
function fakeSession(events: AIEvent[], id: string, reqId: string): AISession {
  return {
    id,
    reqId,
    kind: 'chat',
    topic: 't',
    state: 'idle',
    sdkSessionId: undefined,
    model: undefined,
    events() {
      return {
        [Symbol.asyncIterator]() {
          let i = 0
          return {
            async next() {
              if (i < events.length) return { value: events[i++], done: false }
              return { value: undefined, done: true }
            },
          }
        },
      }
    },
    async send() {},
    async cancel() {},
    async close() {},
  } as unknown as AISession
}

async function setupMeta(): Promise<{ store: SessionStore; mirror: MessagesMirror; sid: string; reqId: string }> {
  const store = new SessionStore({ root, now: () => '2026-07-13T00:00:00.000Z' })
  const mirror = new MessagesMirror({ root })
  const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
  return { store, mirror, sid: meta.sid, reqId: meta.reqId }
}

describe('attachRecorder text mirroring', () => {
  it('累积 text delta → done 时写 1 条 assistant 消息', async () => {
    const { store, mirror, sid, reqId } = await setupMeta()
    const session = fakeSession(
      [
        { type: 'text', text: 'Hel', delta: true },
        { type: 'text', text: 'lo', delta: true },
        { type: 'done', reason: 'end_turn', sessionId: 'sdk-1' },
      ],
      sid,
      reqId,
    )
    const rec = attachRecorder(session, { store, mirror, now: () => 'ts', idGen: () => 'msg-1' })
    await rec.done

    const msgs = await mirror.readMessages(sid)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({
      id: 'msg-1', type: 'text', role: 'assistant', content: 'Hello',
    })
    expect(msgs[0].incomplete).toBeFalsy()
  })

  it('done 带 sessionId → 回填 meta.sdkSessionId', async () => {
    const { store, mirror, sid, reqId } = await setupMeta()
    const session = fakeSession(
      [
        { type: 'text', text: 'hi', delta: false },
        { type: 'done', reason: 'end_turn', sessionId: 'sdk-backfill' },
      ],
      sid,
      reqId,
    )
    const rec = attachRecorder(session, { store, mirror })
    await rec.done

    const onDisk = await store.getSession(sid)
    expect(onDisk?.sdkSessionId).toBe('sdk-backfill')
  })
})

describe('attachRecorder non-text events', () => {
  it('thinking / tool_use 各写 1 条,顺序保留在 text 前', async () => {
    const { store, mirror, sid, reqId } = await setupMeta()
    let n = 0
    const session = fakeSession(
      [
        { type: 'thinking', text: '想一下' },
        { type: 'tool_use', name: 'Read', input: { file: 'a.ts' } },
        { type: 'text', text: '答复', delta: false },
        { type: 'done', reason: 'end_turn' },
      ],
      sid,
      reqId,
    )
    const rec = attachRecorder(session, { store, mirror, idGen: () => `m${n++}` })
    await rec.done

    const msgs = await mirror.readMessages(sid)
    expect(msgs.map((m) => m.type)).toEqual(['thinking', 'tool_use', 'text'])
    expect(msgs[1].content).toContain('Read')
  })
})

describe('attachRecorder partial (Q8.6)', () => {
  it('done{reason:error} 且有累积 partial → incomplete:true', async () => {
    const { store, mirror, sid, reqId } = await setupMeta()
    const session = fakeSession(
      [
        { type: 'text', text: '半截回答', delta: true },
        { type: 'error', code: 'sdk_throw', message: 'boom', recoverable: false },
        { type: 'done', reason: 'error' },
      ],
      sid,
      reqId,
    )
    const rec = attachRecorder(session, { store, mirror, idGen: () => 'p1' })
    await rec.done

    const msgs = await mirror.readMessages(sid)
    const textMsg = msgs.find((m) => m.type === 'text')
    expect(textMsg?.incomplete).toBe(true)
    expect(textMsg?.content).toBe('半截回答')
  })

  it('done{reason:cancelled} 无累积文本 → 不写空 text 消息', async () => {
    const { store, mirror, sid, reqId } = await setupMeta()
    const session = fakeSession(
      [{ type: 'done', reason: 'cancelled' }],
      sid,
      reqId,
    )
    const rec = attachRecorder(session, { store, mirror })
    await rec.done
    expect(await mirror.readMessages(sid)).toEqual([])
  })

  it('done{reason:max_tokens} 截断响应 → partial 标 incomplete:true', async () => {
    const { store, mirror, sid, reqId } = await setupMeta()
    const session = fakeSession(
      [
        { type: 'text', text: '超长回答被截', delta: true },
        { type: 'done', reason: 'max_tokens' },
      ],
      sid,
      reqId,
    )
    const rec = attachRecorder(session, { store, mirror, idGen: () => 'mt1' })
    await rec.done

    const [msg] = await mirror.readMessages(sid)
    expect(msg.incomplete).toBe(true)
    expect(msg.content).toBe('超长回答被截')
  })
})

describe('attachRecorder query lifecycle (Task 5)', () => {
  it('retrying 不写 messages;error 保留分类诊断', async () => {
    const { store, mirror, sid, reqId } = await setupMeta()
    const session = fakeSession(
      [
        { type: 'retrying', category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: 'retrying' },
        { type: 'error', code: 'auth', message: 'bad key', recoverable: false, category: 'B' },
        { type: 'done', reason: 'error' },
      ],
      sid,
      reqId,
    )
    const rec = attachRecorder(session, { store, mirror, idGen: () => 'err-1' })
    await rec.done

    const messages = await mirror.readMessages(sid)
    expect(messages).toHaveLength(1)
    expect(messages[0].sdkMessageRaw).toMatchObject({ code: 'auth', category: 'B' })
  })
})
