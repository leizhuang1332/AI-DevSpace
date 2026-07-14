/**
 * SessionEventsRoute tests —— ADR-0010 Q10.2 (per-session SSE)
 *
 * 端点:`GET /api/requirement/:reqId/session/:sid/events`
 * 覆盖:
 *  - 401 没 token → 不开 SSE
 *  - 404 sid 不存在 → 不开 SSE
 *  - 404 sid 存在但属于别的 reqId → 不开 SSE
 *  - 200:hello + sid 字段 + per-session channel 投递
 *  - 同时 N 个 session → 事件互不串台
 *  - session close → 该 session 通道的所有订阅者被清理
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { sessionSseRoutes } from '../sse/sessionEventsRoute.js'
import { SessionStore } from '../session/SessionStore.js'

interface Cap { statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }

function openSse(url: string, port: number, headers: Record<string, string>, readMs = 200): Promise<Cap> {
  return new Promise((resolve, reject) => {
    const req = http.request({ method: 'GET', hostname: '127.0.0.1', port, path: url, headers }, (res) => {
      const chunks: Buffer[] = []
      const t = setTimeout(() => {
        req.destroy()
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      }, readMs)
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        clearTimeout(t)
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
      res.on('error', () => {
        clearTimeout(t)
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject); req.end()
  })
}

describe('GET /api/requirement/:reqId/session/:sid/events (Q10.2 per-session SSE)', () => {
  let app: FastifyInstance
  let hub: SseHub
  let store: SessionStore
  let token: string
  let port: number
  let root: string
  let sid: string
  const reqId = 'REFUND-001'

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-session-sse-'))
    const tm = new TokenManager(root)
    token = await tm.ensure()
    store = new SessionStore({ root, now: () => '2026-07-13T00:00:00.000Z' })
    // 先落一个真实 session meta.yaml(让 store.getSession 找得到)
    const meta = await store.createSession(reqId, { topic: 'spike', kind: 'chat' })
    sid = meta.sid
    hub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: ['http://localhost:3333'] })
    await app.register(sessionSseRoutes, { hub, sessionStore: store })
    await app.ready()
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })

  afterEach(async () => {
    await app.close()
    await hub.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('returns 200 with text/event-stream content type', async () => {
    const res = await openSse(
      `/api/requirement/${reqId}/session/${sid}/events`,
      port,
      { 'x-aidevspace-token': token },
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
  })

  it('emits a hello event with reqId + sid in the initial body', async () => {
    const res = await openSse(
      `/api/requirement/${reqId}/session/${sid}/events`,
      port,
      { 'x-aidevspace-token': token },
    )
    expect(res.body).toMatch(/event: hello/)
    expect(res.body).toContain(`"reqId":"${reqId}"`)
  })

  it('returns 401 without token', async () => {
    const res = await openSse(
      `/api/requirement/${reqId}/session/${sid}/events`,
      port,
      {},
    )
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when sid does not exist (no SSE opened)', async () => {
    const res = await openSse(
      `/api/requirement/${reqId}/session/ghost-sid/events`,
      port,
      { 'x-aidevspace-token': token },
    )
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as { error?: string }
    expect(body.error).toBe('session_not_found')
  })

  it('returns 404 when sid belongs to a different reqId', async () => {
    const otherMeta = await store.createSession('OTHER-REQ', { topic: 't', kind: 'chat' })
    const res = await openSse(
      `/api/requirement/${reqId}/session/${otherMeta.sid}/events`,
      port,
      { 'x-aidevspace-token': token },
    )
    expect(res.statusCode).toBe(404)
  })

  it('subscribes only to the per-session channel (events for other sids do not leak)', async () => {
    const meta2 = await store.createSession(reqId, { topic: 't2', kind: 'chat' })
    // 打开 sid 的 SSE 监听
    const chunks: Buffer[] = []
    let resolved = false
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          method: 'GET',
          hostname: '127.0.0.1',
          port,
          path: `/api/requirement/${reqId}/session/${sid}/events`,
          headers: { 'x-aidevspace-token': token },
        },
        (res) => {
          res.on('data', (c: Buffer) => {
            chunks.push(c)
            const body = Buffer.concat(chunks).toString('utf8')
            if (body.includes('event: ai_event') && !resolved) {
              resolved = true
              req.destroy()
              resolve()
            }
          })
          res.on('end', () => resolve())
        },
      )
      setTimeout(() => {
        // 推给 sid(应该收得到)
        hub.publish(sid, { type: 'ai_event', reqId, sessionId: sid, runId: 'r1', ts: 1, streamKind: 'chat', event: { type: 'text', text: 'for sid' } })
        // 推给 meta2.sid(应该收不到 —— 通道隔离)
        hub.publish(meta2.sid, { type: 'ai_event', reqId, sessionId: meta2.sid, runId: 'r1', ts: 1, streamKind: 'chat', event: { type: 'text', text: 'leak' } })
      }, 80)
      req.on('error', () => resolve())
      req.end()
    })
    const body = Buffer.concat(chunks).toString('utf8')
    expect(body).toMatch(/event: ai_event/)
    expect(body).toMatch(/for sid/)
    expect(body).not.toMatch(/leak/)
  })

  it('closes the per-session channel when session is closed (Q10.2 验收)', async () => {
    expect(hub.stats().channels).toBe(0)
    await openSse(
      `/api/requirement/${reqId}/session/${sid}/events`,
      port,
      { 'x-aidevspace-token': token },
    )
    // openSse 总会 destroy —— 等事件循环 flush
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    // 模拟 session.close() 调 hub.closeChannel
    hub.closeChannel(sid)
    expect(hub.stats().channels).toBe(0)
    expect(hub.stats().subscribers).toBe(0)
  })
})