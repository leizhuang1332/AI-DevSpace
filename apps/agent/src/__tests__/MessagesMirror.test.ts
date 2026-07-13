/**
 * MessagesMirror tests —— ADR-0010 Q7.4 / Q8.6 (本地 messages.jsonl 镜像)
 *
 * 覆盖:
 *  - appendMessage:每条 1 行 jsonl,顺序追加
 *  - readMessages:读回全部,顺序一致
 *  - readMessages(sinceId):只返回 sinceId 之后(不含)的
 *  - appendIncomplete:partial 流式响应标 incomplete:true (Q8.6)
 *  - 坏行(半截 JSON)跳过不炸
 *  - 无文件时 readMessages 返回 []
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessagesMirror } from '../session/MessagesMirror.js'
import { sessionDirFor, messagesPathFor } from '../session/sessionPaths.js'

let root: string
const REQ = 'REQ-1'
const SID = 'sid-1'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidev-mirror-'))
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function makeMirror(): MessagesMirror {
  return new MessagesMirror({ root })
}

describe('MessagesMirror.appendMessage / readMessages', () => {
  it('每条写 1 行,读回顺序一致', async () => {
    const m = makeMirror()
    await m.appendMessage(REQ, SID, {
      id: 'm1', type: 'text', role: 'assistant', content: 'hello', timestamp: 't1',
    })
    await m.appendMessage(REQ, SID, {
      id: 'm2', type: 'text', role: 'user', content: 'hi', timestamp: 't2',
    })

    const all = await m.readMessages(SID)
    expect(all.map((x) => x.id)).toEqual(['m1', 'm2'])
    expect(all[0].content).toBe('hello')
    expect(all[1].role).toBe('user')
  })

  it('保留 sdkMessageRaw 与自定义字段', async () => {
    const m = makeMirror()
    await m.appendMessage(REQ, SID, {
      id: 'm1', type: 'tool_use', role: 'assistant', content: '',
      timestamp: 't', sdkMessageRaw: { foo: 'bar' },
    })
    const [msg] = await m.readMessages(SID)
    expect(msg.sdkMessageRaw).toEqual({ foo: 'bar' })
  })

  it('无文件时返回 []', async () => {
    const m = makeMirror()
    expect(await m.readMessages('never')).toEqual([])
  })
})

describe('MessagesMirror.readMessages(sinceId)', () => {
  it('只返回 sinceId 之后(不含)的消息', async () => {
    const m = makeMirror()
    for (const id of ['a', 'b', 'c', 'd']) {
      await m.appendMessage(REQ, SID, {
        id, type: 'text', role: 'assistant', content: id, timestamp: id,
      })
    }
    const after = await m.readMessages(SID, 'b')
    expect(after.map((x) => x.id)).toEqual(['c', 'd'])
  })

  it('sinceId 不存在时返回全部', async () => {
    const m = makeMirror()
    await m.appendMessage(REQ, SID, {
      id: 'a', type: 'text', role: 'assistant', content: 'a', timestamp: 'a',
    })
    expect((await m.readMessages(SID, 'zzz')).map((x) => x.id)).toEqual(['a'])
  })
})

describe('MessagesMirror.appendIncomplete (Q8.6)', () => {
  it('partial 流式响应标 incomplete:true', async () => {
    const m = makeMirror()
    await m.appendIncomplete(REQ, SID, {
      id: 'p1', type: 'text', role: 'assistant', content: '半截', timestamp: 't',
    })
    const [msg] = await m.readMessages(SID)
    expect(msg.incomplete).toBe(true)
    expect(msg.content).toBe('半截')
  })
})

describe('MessagesMirror 容错', () => {
  it('坏行(半截 JSON)跳过,不影响其余行', async () => {
    const m = makeMirror()
    // 手动构造:好行 + 坏行 + 好行
    mkdirSync(sessionDirFor(root, REQ, SID), { recursive: true })
    const p = messagesPathFor(root, REQ, SID)
    appendFileSync(p, JSON.stringify({ id: 'm1', type: 'text', role: 'assistant', content: 'ok', timestamp: 't' }) + '\n')
    appendFileSync(p, '{ this is not valid json\n')
    appendFileSync(p, JSON.stringify({ id: 'm2', type: 'text', role: 'assistant', content: 'ok2', timestamp: 't' }) + '\n')

    const all = await m.readMessages(SID)
    expect(all.map((x) => x.id)).toEqual(['m1', 'm2'])
  })

  it('空行忽略', async () => {
    const m = makeMirror()
    mkdirSync(sessionDirFor(root, REQ, SID), { recursive: true })
    const p = messagesPathFor(root, REQ, SID)
    appendFileSync(p, '\n\n')
    appendFileSync(p, JSON.stringify({ id: 'm1', type: 'text', role: 'assistant', content: 'ok', timestamp: 't' }) + '\n')
    appendFileSync(p, '\n')
    expect((await m.readMessages(SID)).map((x) => x.id)).toEqual(['m1'])
  })
})
