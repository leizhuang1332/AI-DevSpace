/**
 * SessionStateRoute tests —— ADR-0010 Q10.4 + 决策 49 StatusBar 4 指示器
 *
 * 端点:
 *  - GET /api/sessions/:localSid/state       单 session 快照
 *  - GET /api/sessions/state/all             全局 StatusBar 总览
 *
 * 覆盖:
 *  - 活 session → 200 + state/recentWrites
 *  - 不存在 → 404
 *  - 已落盘但 live 不存在 → 200 + state: closed(给「上次的会话」StatusBar 项用)
 *  - 全局快照返回 4 指示器结构
 *  - 401:没 token 拒绝
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { SessionStore } from '../session/SessionStore.js'
import { SessionStateRegistry } from '../session/SessionStateRegistry.js'
import { sessionStateRoutes } from '../routes/sessionStateRoute.js'
import type { AISession } from '../providers/AIProvider.js'

function fakeSession(id: string, reqId: string, state: AISession['state']): AISession {
  return {
    id,
    reqId,
    kind: 'chat',
    topic: 'test',
    state,
    sdkSessionId: undefined,
    model: undefined,
    events: () => { throw new Error('unused') },
    send: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }
}

describe('GET /api/sessions/:localSid/state + /state/all (Q10.4)', () => {
  let app: FastifyInstance
  let store: SessionStore
  let registry: SessionStateRegistry
  let token: string
  let root: string
  const reqId = 'REFUND-001'

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-state-'))
    const tm = new TokenManager(root)
    token = await tm.ensure()
    store = new SessionStore({ root, now: () => '2026-07-13T00:00:00.000Z' })
    registry = new SessionStateRegistry()
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: ['http://localhost:3333'] })
    await app.register(sessionStateRoutes, { registry, store })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('GET /api/sessions/:sid/state → 404 when sid is unknown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/ghost-sid/state',
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error?: string }
    expect(body.error).toBe('session_not_found')
  })

  it('GET /api/sessions/:sid/state → 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/whatever/state' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /api/sessions/:sid/state → 200 with live state when session is registered', async () => {
    const meta = await store.createSession(reqId, { topic: 't', kind: 'chat' })
    const session = fakeSession(meta.sid, reqId, 'busy')
    registry.register(session)
    registry.recordWrite(meta.sid)

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${meta.sid}/state`,
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { localSid: string; reqId: string; state: string; recentWrites: number }
    expect(body.localSid).toBe(meta.sid)
    expect(body.reqId).toBe(reqId)
    expect(body.state).toBe('busy')
    expect(body.recentWrites).toBe(1)
  })

  it('GET /api/sessions/:sid/state → 200 closed when meta exists but live missing', async () => {
    const meta = await store.createSession(reqId, { topic: 't', kind: 'chat' })
    // 注意:registry 没 register() → live 缺失,但 meta 落盘了
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${meta.sid}/state`,
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { state: string; recentWrites: number }
    expect(body.state).toBe('closed')
    expect(body.recentWrites).toBe(0)
  })

  it('GET /api/sessions/state/all → 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/state/all' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /api/sessions/state/all → 200 with 4-indicator structure', async () => {
    const m1 = await store.createSession(reqId, { topic: 'a', kind: 'chat' })
    const m2 = await store.createSession(reqId, { topic: 'b', kind: 'chat' })
    registry.register(fakeSession(m1.sid, reqId, 'busy'))
    registry.register(fakeSession(m2.sid, reqId, 'idle'))
    registry.recordWrite(m1.sid)
    registry.recordWrite(m1.sid)
    registry.recordWrite(m2.sid)

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/state/all',
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      stateCounts: Record<string, number>
      pending: number
      queued: number
      recentWrites: number
    }
    expect(body.stateCounts).toEqual({ idle: 1, busy: 1, closed: 0, errored: 0 })
    expect(body.pending).toBe(1)
    expect(body.queued).toBe(0)
    expect(body.recentWrites).toBe(3)
  })
})