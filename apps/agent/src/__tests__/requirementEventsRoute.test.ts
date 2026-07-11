import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { sseRoutes } from '../sse/requirementEventsRoute.js'

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

/** Open an SSE request, read for readMs then destroy(). */
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

describe('GET /api/requirement/:id/events', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-sse-'))
    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: ['http://localhost:3333'] })
    await app.register(sseRoutes, { hub })
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
    const res = await openSse('/api/requirement/REFUND-001/events', {
      'x-aidevspace-token': token,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
  })

  it('emits a hello event in the initial body chunk', async () => {
    const res = await openSse('/api/requirement/REFUND-001/events', {
      'x-aidevspace-token': token,
    })
    expect(res.body).toMatch(/event: hello/)
    expect(res.body).toMatch(/"reqId":"REFUND-001"/)
    expect(res.body).toMatch(/"sid":/)
  })

  it('emits X-Accel-Buffering: no header', async () => {
    const res = await openSse('/api/requirement/REFUND-001/events', {
      'x-aidevspace-token': token,
    })
    expect(res.headers['x-accel-buffering']).toBe('no')
  })

  it('401 without token (does not open SSE)', async () => {
    const res = await openSse('/api/requirement/REFUND-001/events', {})
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
          path: '/api/requirement/REFUND-001/events',
          headers: { 'x-aidevspace-token': token },
        },
        (res) => {
          res.on('data', (c: Buffer) => {
            chunks.push(c)
            const body = Buffer.concat(chunks).toString('utf8')
            if (body.includes('event: placeholder') && !resolved) {
              resolved = true
              req.destroy()
              resolve()
            }
          })
          res.on('end', () => resolve())
        },
      )
      setTimeout(() => {
        hub.publish('REFUND-001', { type: 'placeholder', message: 'hello future' })
      }, 100)
      req.on('error', () => resolve())
      req.end()
    })
    const body = Buffer.concat(chunks).toString('utf8')
    expect(body).toMatch(/event: placeholder/)
    expect(body).toMatch(/hello future/)
  })
})
