/**
 * Spike routes tests —— ADR-0010 P0 验收
 *
 * 覆盖:
 *  - POST /api/spike/run —— 400 on missing/empty prompt; 202 on good body
 *  - GET /api/spike/events —— SSE Content-Type + hello event
 *  - run() 会通过 hub 把 session.events() 推到订阅者
 *  - run() 失败 → placeholder 推送
 *
 * SSE 测试用真实 http.request + 端口,避开 fastify.inject() 对 SSE 长连的兼容问题。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spikeRoutes, SPIKE_CHANNEL } from '../routes/spike.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import type { AIProvider } from '../providers/AIProvider.js'
import type { AISession } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'
import type { SseEvent } from '@ai-devspace/shared'
import type { CcSwitchClient } from '../providers/CcSwitchClient.js'

function fakeCcSwitch(): CcSwitchClient {
  return {
    getCurrent: () => ({
      id: 'p-1',
      name: 'MiniMax',
      is_current: true,
      baseUrl: 'http://x',
      apiKey: 'k',
      models: {
        main: 'MiniMax-M3',
        haiku: null,
        sonnet: 'MiniMax-M3[1M]',
        opus: null,
        fable: null,
        reasoning: null,
      },
    }),
    getAll: () => [],
    getById: () => undefined,
    getModel: () => undefined,
    close: () => {},
  }
}

/** 简单 subject:支持 push + async iterator + close */
function makeSubject<T>(): {
  push(v: T): void
  close(): void
  toAsyncIterable(): AsyncIterable<T>
} {
  const queue: T[] = []
  const resolvers: Array<(v: IteratorResult<T>) => void> = []
  let closed = false
  return {
    push(v: T) {
      if (closed) return
      const r = resolvers.shift()
      if (r) r({ value: v, done: false })
      else queue.push(v)
    },
    close() {
      closed = true
      while (resolvers.length) resolvers.shift()!({ value: undefined, done: true })
    },
    toAsyncIterable() {
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<T>>((resolve) => {
              if (closed) return resolve({ value: undefined, done: true })
              const head = queue.shift()
              if (head !== undefined) resolve({ value: head, done: false })
              else resolvers.push(resolve)
            }),
          return: async () => ({ value: undefined, done: true }),
        }),
      }
    },
  }
}

/** 创建一个 fake provider:返回一个 events() 会被同步推事件的 session
 *
 * 关键时序:必须在 createSession 同步返回前把 events push 进 subject,
 * 这样 route 的事件 pump 一旦开始 for-await,就能从队列里读到;
 * 不依赖 setTimeout(避免被 route.close() 抢先 close 掉 subject)。 */
function fakeProvider(eventsToEmit: AIEvent[]): AIProvider {
  return {
    name: 'fake',
    async createSession(reqId, opts): Promise<AISession> {
      const subj = makeSubject<AIEvent>()
      // 同步 push:route 的事件 pump 一旦开始 iterate,就能读到
      for (const e of eventsToEmit) subj.push(e)
      return {
        id: 'fake-sid',
        reqId,
        kind: opts.kind,
        topic: opts.topic,
        state: 'idle',
        sdkSessionId: 'fake-sdk',
        model: undefined,
        events: () => subj.toAsyncIterable(),
        async send() {
          /* noop */
        },
        async cancel() {
          /* noop */
        },
        async close() {
          subj.close()
        },
      }
    },
    async shutdown() {},
  }
}

interface CapturedResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function openSse(port: number, readMs = 250): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        hostname: '127.0.0.1',
        port,
        path: '/api/spike/events',
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

describe('spike routes', () => {
  let fastify: FastifyInstance
  let hub: SseHub
  let port: number

  beforeEach(async () => {
    hub = createSseHub({ heartbeatMs: 60_000 })
    fastify = Fastify({ logger: false })
    await fastify.register(spikeRoutes, {
      hub,
      provider: fakeProvider([
        { type: 'text', text: 'hi', delta: false },
        { type: 'done', reason: 'end_turn', sessionId: 'fake-sdk' },
      ]),
      ccSwitch: fakeCcSwitch(),
    })
    await fastify.ready()
    const url = await fastify.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })

  afterEach(async () => {
    await fastify.close()
    await hub.close()
  })

  it('POST /api/spike/run rejects empty prompt with 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/spike/run',
      payload: { prompt: '' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toBe('bad_request')
  })

  it('POST /api/spike/run rejects missing prompt with 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/spike/run',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /api/spike/run accepts good body with 202', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/spike/run',
      payload: { prompt: 'hello' },
    })
    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.status).toBe('accepted')
    expect(typeof body.runId).toBe('string')
    expect(body.reqId).toBe(SPIKE_CHANNEL)
  })

  it('POST /api/spike/run uses provided reqId', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/spike/run',
      payload: { prompt: 'hi', reqId: 'custom-req' },
    })
    const body = res.json()
    expect(body.reqId).toBe('custom-req')
  })

  it('GET /api/spike/events sends Content-Type text/event-stream and hello', async () => {
    const res = await openSse(port, 200)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    expect(res.body).toMatch(/event: hello/)
    const dataLine = res.body.split('\n').find((l) => l.startsWith('data: '))
    expect(dataLine).toBeDefined()
    const helloEvent = JSON.parse(dataLine!.slice('data: '.length))
    expect(helloEvent.type).toBe('hello')
    expect(helloEvent.reqId).toBe(SPIKE_CHANNEL)
  })

  it('GET /api/spike/events emits X-Accel-Buffering: no header', async () => {
    const res = await openSse(port, 100)
    expect(res.headers['x-accel-buffering']).toBe('no')
  })

  it('POST run pushes session.events() through hub to subscribers', async () => {
    const received: SseEvent[] = []
    hub.subscribe(SPIKE_CHANNEL, (e) => received.push(e))
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/spike/run',
      payload: { prompt: 'hello' },
    })
    expect(res.statusCode).toBe(202)
    // 等异步 pump 推完(close 在 send 后会触发)
    await new Promise((r) => setTimeout(r, 50))
    expect(received.length).toBeGreaterThanOrEqual(2)
    const messages = received
      .filter((e) => e.type === 'placeholder')
      .map((e) => JSON.parse((e as { message: string }).message).ev)
    expect(messages).toContainEqual({ type: 'text', text: 'hi', delta: false })
    expect(messages).toContainEqual({
      type: 'done',
      reason: 'end_turn',
      sessionId: 'fake-sdk',
    })
  })

  it('POST run failure publishes placeholder via hub', async () => {
    const received: SseEvent[] = []
    const throwingProvider: AIProvider = {
      name: 'fake-throw',
      async createSession(): Promise<AISession> {
        throw new Error('boom')
      },
      async shutdown() {},
    }
    const app = Fastify({ logger: false })
    await app.register(spikeRoutes, {
      hub,
      provider: throwingProvider,
      ccSwitch: fakeCcSwitch(),
    })
    await app.ready()
    hub.subscribe(SPIKE_CHANNEL, (e) => received.push(e))
    await app.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'x' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(received.some((e) => e.type === 'placeholder' && e.message.includes('boom'))).toBe(true)
    await app.close()
  })
})

describe('spike routes + authPlugin interaction', () => {
  let app: FastifyInstance
  let authedHub: SseHub
  let root: string
  let port: number

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-spike-auth-'))
    const tm = new TokenManager(root)
    await tm.ensure()
    authedHub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    // 注册 authPlugin(模拟 server.ts 的真实场景) + spikeRoutes
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: ['http://localhost:3333'] })
    await app.register(spikeRoutes, {
      hub: authedHub,
      provider: fakeProvider([]),
      ccSwitch: fakeCcSwitch(),
    })
    await app.ready()
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })

  afterEach(async () => {
    await app.close()
    await authedHub.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('GET /api/spike/events is public (no token → 200, not 401)', async () => {
    const res = await openSseOnPort(port, 100)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
  })

  it('POST /api/spike/run is public (no token → 202/400, not 401)', async () => {
    // 缺 prompt → 400(不是 401)
    const res400 = await app.inject({ method: 'POST', url: '/api/spike/run', payload: {} })
    expect(res400.statusCode).toBe(400)
    // 有 prompt → 202
    const res202 = await app.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'hi' } })
    expect(res202.statusCode).toBe(202)
  })
})

function openSseOnPort(port: number, readMs: number): Promise<{
  statusCode: number
  headers: Record<string, string | string[] | undefined>
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        hostname: '127.0.0.1',
        port,
        path: '/api/spike/events',
      },
      (res) => {
        const timer = setTimeout(() => {
          req.destroy()
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
          })
        }, readMs)
        res.on('data', () => {})
        res.on('error', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
          })
        })
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}