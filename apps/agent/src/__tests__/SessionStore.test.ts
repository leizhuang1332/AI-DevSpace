/**
 * SessionStore tests —— ADR-0010 Q7.1 / Q7.2 (会话 meta CRUD)
 *
 * 覆盖:
 *  - createSession:立即写 meta.yaml,sdkSessionId 空,含 local_sid / created_at / last_active_at
 *  - getSession:读回 meta;找不到返回 null
 *  - listSessions:列 req 下全部 session(按 created_at)
 *  - updateSession:合并 patch(回填 sdkSessionId)+ 刷新 last_active_at
 *  - archiveSession:标 archived:true
 *  - now 注入:时间戳可断言
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'yaml'
import { SessionStore } from '../session/SessionStore.js'
import { metaPathFor } from '../session/sessionPaths.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidev-store-'))
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function makeStore(now = () => '2026-07-13T00:00:00.000Z'): SessionStore {
  return new SessionStore({ root, now })
}

describe('SessionStore.createSession', () => {
  it('立即写 meta.yaml,sdkSessionId 空,含 local_sid + 时间戳', async () => {
    const store = makeStore()
    const meta = await store.createSession('REQ-1', { topic: '退款功能', kind: 'chat' })

    expect(meta.sid).toMatch(/[0-9a-f-]{36}/)
    expect(meta.reqId).toBe('REQ-1')
    expect(meta.provider).toBe('claude-code')
    expect(meta.sdkSessionId).toBe('')
    expect(meta.topic).toBe('退款功能')
    expect(meta.kind).toBe('chat')
    expect(meta.created_at).toBe('2026-07-13T00:00:00.000Z')
    expect(meta.last_active_at).toBe('2026-07-13T00:00:00.000Z')

    const p = metaPathFor(root, 'REQ-1', meta.sid)
    expect(existsSync(p)).toBe(true)
    const onDisk = yaml.parse(readFileSync(p, 'utf8'))
    expect(onDisk.sid).toBe(meta.sid)
    expect(onDisk.sdkSessionId).toBe('')
  })

  it('透传 cwd / current_focus / model', async () => {
    const store = makeStore()
    const meta = await store.createSession('REQ-1', {
      topic: 't',
      kind: 'task',
      cwd: '/repos/order-svc',
      current_focus: 'writing-code',
      model: { providerId: 'p-1', role: 'sonnet' },
    })
    expect(meta.cwd).toBe('/repos/order-svc')
    expect(meta.current_focus).toBe('writing-code')
    expect(meta.model).toEqual({ providerId: 'p-1', role: 'sonnet' })
  })
})

describe('SessionStore.getSession / listSessions', () => {
  it('getSession 读回;找不到返回 null', async () => {
    const store = makeStore()
    const created = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    const got = await store.getSession(created.sid)
    expect(got?.sid).toBe(created.sid)
    expect(await store.getSession('missing')).toBeNull()
  })

  it('listSessions 列 req 下全部;别的 req 不混入;无目录返回空', async () => {
    const store = makeStore()
    await store.createSession('REQ-1', { topic: 'a', kind: 'chat' })
    await store.createSession('REQ-1', { topic: 'b', kind: 'chat' })
    await store.createSession('REQ-2', { topic: 'c', kind: 'chat' })

    const list1 = await store.listSessions('REQ-1')
    expect(list1).toHaveLength(2)
    expect(list1.map((m) => m.topic).sort()).toEqual(['a', 'b'])

    expect(await store.listSessions('REQ-NONE')).toEqual([])
  })
})

describe('SessionStore.updateSession', () => {
  it('回填 sdkSessionId 并刷新 last_active_at', async () => {
    let t = '2026-07-13T00:00:00.000Z'
    const store = new SessionStore({ root, now: () => t })
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })

    t = '2026-07-13T01:00:00.000Z'
    const updated = await store.updateSession(meta.sid, { sdkSessionId: 'sdk-xyz' })
    expect(updated.sdkSessionId).toBe('sdk-xyz')
    expect(updated.last_active_at).toBe('2026-07-13T01:00:00.000Z')
    expect(updated.created_at).toBe('2026-07-13T00:00:00.000Z')

    // 落盘确认
    const onDisk = await store.getSession(meta.sid)
    expect(onDisk?.sdkSessionId).toBe('sdk-xyz')
  })

  it('更新不存在的 session 抛错', async () => {
    const store = makeStore()
    await expect(store.updateSession('missing', { sdkSessionId: 'x' })).rejects.toThrow()
  })

  it('记录 last_cancel_at 并刷新 last_active_at', async () => {
    let t = '2026-07-13T00:00:00.000Z'
    const store = new SessionStore({ root, now: () => t })
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    t = '2026-07-13T02:00:00.000Z'
    const updated = await store.updateSession(meta.sid, {
      last_cancel_at: '2026-07-13T01:59:59.000Z',
    })
    expect(updated.last_cancel_at).toBe('2026-07-13T01:59:59.000Z')
    expect(updated.last_active_at).toBe(t)
  })
})

describe('SessionStore.archiveSession', () => {
  it('标 archived:true', async () => {
    const store = makeStore()
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    const archived = await store.archiveSession(meta.sid)
    expect(archived.archived).toBe(true)
    const onDisk = await store.getSession(meta.sid)
    expect(onDisk?.archived).toBe(true)
  })
})
