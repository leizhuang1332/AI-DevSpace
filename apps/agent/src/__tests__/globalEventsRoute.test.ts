/**
 * GET /api/events/requirements — ticket 07a 全局需求事件 SSE 通道
 *
 * 与 per-req 通道的关键区别:
 * - channel key 是固定字符串 'requirements'(全局),而不是 reqId
 * - hello event 带 `channel` 字段(不带 `reqId`)—— 用 SseEvent.hello 扩展字段验证
 *
 * 测试覆盖(对齐 requirementEventsRoute.test.ts):
 * - 200 + text/event-stream content-type
 * - hello 帧包含 channel='requirements'
 * - X-Accel-Buffering: no header
 * - 401 无 token
 * - hub.publish('requirements', ...) 事件被流消费
 * - socket 关闭时 unsubscribe(避免泄漏)
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
import { globalEventsRoutes } from '../sse/globalEventsRoute.js'

let app: FastifyInstance
let hub: SseHub
let token: string
let root: string
let port: number

interface CapturedResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function openSse(
  urlPath: string,
  headers: Record<string, string> = {},
  readMs = 250,
): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        const timer = setTimeout(() => {
          req.destroy()
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        }, readMs)
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('GET /api/events/requirements — ticket 07a global channel', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-global-sse-'))
    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: ['http://localhost:3333'] })
    await app.register(globalEventsRoutes, { hub })
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
    const res = await openSse('/api/events/requirements', {
      'x-aidevspace-token': token,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
  })

  it('emits hello event with channel=requirements', async () => {
    const res = await openSse('/api/events/requirements', {
      'x-aidevspace-token': token,
    })
    expect(res.body).toMatch(/event: hello/)
    expect(res.body).toMatch(/"channel":"requirements"/)
    expect(res.body).toMatch(/"sid":/)
  })

  it('emits X-Accel-Buffering: no header', async () => {
    const res = await openSse('/api/events/requirements', {
      'x-aidevspace-token': token,
    })
    expect(res.headers['x-accel-buffering']).toBe('no')
  })

  it('401 without token (does not open SSE)', async () => {
    const res = await openSse('/api/events/requirements', {})
    expect(res.statusCode).toBe(401)
  })

  it('writes a publish() event to the stream body', async () => {
    const chunks: Buffer[] = []
    let resolved = false
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          method: 'GET',
          hostname: '127.0.0.1',
          port,
          path: '/api/events/requirements',
          headers: { 'x-aidevspace-token': token },
        },
        (res) => {
          res.on('data', (c: Buffer) => {
            chunks.push(c)
            const body = Buffer.concat(chunks).toString('utf8')
            if (body.includes('event: requirement_created') && !resolved) {
              resolved = true
              req.destroy()
              resolve()
            }
          })
          res.on('end', () => resolve())
        },
      )
      setTimeout(() => {
        hub.publish('requirements', {
          type: 'requirement_created',
          reqId: 'req-001-foo',
          ok: true,
          ts: Date.now(),
          title: 'foo',
          createdAt: '2026-07-17T00:00:00.000Z',
        })
      }, 100)
      req.on('error', () => resolve())
      req.end()
    })
    const body = Buffer.concat(chunks).toString('utf8')
    expect(body).toMatch(/event: requirement_created/)
    expect(body).toMatch(/"reqId":"req-001-foo"/)
  })

  it('unsubscribes from SseHub when client socket closes', async () => {
    expect(hub.stats().subscribers).toBe(0)
    await openSse('/api/events/requirements', {
      'x-aidevspace-token': token,
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(hub.stats().subscribers).toBe(0)
  })
})