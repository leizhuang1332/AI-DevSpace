/**
 * ResumeManager tests —— ADR-0010 Q7.3 / Q8.6 (自动 resume)
 *
 * 覆盖:
 *  - 有效 sdkSessionId → provider.createSession({ resume: sdkSessionId }),recovered=false
 *  - probe 判定失效(SDK 找不到)→ 新建空 session(无 resume)+ meta 标 recovered:true
 *  - 无 sdkSessionId(全新)→ fresh session,无 resume,recovered=false
 *  - session 不存在 → throw
 *  - createOpts 透传 topic / kind / model / cwd
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../session/SessionStore.js'
import { ResumeManager } from '../session/ResumeManager.js'
import type { AIProvider, AISession, CreateSessionOptions } from '../providers/AIProvider.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidev-resume-'))
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

/** 一个记录 createSession 入参的 mock provider */
function makeProvider() {
  const calls: Array<{ reqId: string; opts: CreateSessionOptions }> = []
  const provider: AIProvider = {
    name: 'claude-code',
    async createSession(reqId, opts) {
      calls.push({ reqId, opts })
      return { id: opts.resume ? 'resumed' : 'fresh', reqId } as unknown as AISession
    },
    async shutdown() {},
  }
  return { provider, calls }
}

describe('ResumeManager.tryResume', () => {
  it('有效 sdkSessionId → createSession 带 resume,recovered=false', async () => {
    const store = new SessionStore({ root })
    const meta = await store.createSession('REQ-1', {
      topic: 't', kind: 'chat', cwd: '/repos/x', model: { providerId: 'p', role: 'sonnet' },
    })
    await store.updateSession(meta.sid, { sdkSessionId: 'sdk-valid' })

    const { provider, calls } = makeProvider()
    const rm = new ResumeManager({ store, provider, probe: async () => true })
    const res = await rm.tryResume(meta.sid)

    expect(res.recovered).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].reqId).toBe('REQ-1')
    expect(calls[0].opts.localSid).toBe(meta.sid)
    expect(calls[0].opts.resume).toBe('sdk-valid')
    expect(calls[0].opts.topic).toBe('t')
    expect(calls[0].opts.kind).toBe('chat')
    expect(calls[0].opts.cwd).toBe('/repos/x')
    expect(calls[0].opts.model).toEqual({ providerId: 'p', role: 'sonnet' })
  })

  it('probe 判定失效 → 新空 session(无 resume)+ meta 标 recovered:true', async () => {
    const store = new SessionStore({ root })
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    await store.updateSession(meta.sid, { sdkSessionId: 'sdk-gone' })

    const probe = vi.fn(async () => false)
    const { provider, calls } = makeProvider()
    const rm = new ResumeManager({ store, provider, probe })
    const res = await rm.tryResume(meta.sid)

    expect(probe).toHaveBeenCalledWith('sdk-gone')
    expect(res.recovered).toBe(true)
    expect(calls[0].opts.localSid).toBe(meta.sid)
    expect(calls[0].opts.resume).toBeUndefined()

    // meta 落盘更新
    const onDisk = await store.getSession(meta.sid)
    expect(onDisk?.recovered).toBe(true)
    expect(onDisk?.sdkSessionId).toBe('')
  })

  it('无 sdkSessionId(全新)→ fresh session,无 resume,recovered=false,不 probe', async () => {
    const store = new SessionStore({ root })
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })

    const probe = vi.fn(async () => true)
    const { provider, calls } = makeProvider()
    const rm = new ResumeManager({ store, provider, probe })
    const res = await rm.tryResume(meta.sid)

    expect(res.recovered).toBe(false)
    expect(probe).not.toHaveBeenCalled()
    expect(calls[0].opts.localSid).toBe(meta.sid)
    expect(calls[0].opts.resume).toBeUndefined()
  })

  it('无 probe 注入时,有 sdkSessionId 直接 resume(视为有效)', async () => {
    const store = new SessionStore({ root })
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    await store.updateSession(meta.sid, { sdkSessionId: 'sdk-x' })

    const { provider, calls } = makeProvider()
    const rm = new ResumeManager({ store, provider })
    const res = await rm.tryResume(meta.sid)
    expect(res.recovered).toBe(false)
    expect(calls[0].opts.resume).toBe('sdk-x')
  })

  it('session 不存在 → throw', async () => {
    const store = new SessionStore({ root })
    const { provider } = makeProvider()
    const rm = new ResumeManager({ store, provider })
    await expect(rm.tryResume('missing')).rejects.toThrow()
  })
})
