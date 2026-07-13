/**
 * Spike routes tests —— ADR-0010 P0 + P4 (typed SSE / 持久化 / 取消)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spikeRoutes, SPIKE_CHANNEL } from '../routes/spike.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { SessionStore } from '../session/SessionStore.js'
import { MessagesMirror } from '../session/MessagesMirror.js'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import type { AIProvider, AISession } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'
import type { SseEvent } from '@ai-devspace/shared'
import type { CcSwitchClient } from '../providers/CcSwitchClient.js'

function fakeCcSwitch(): CcSwitchClient {
  return {
    getCurrent: () => ({
      id: 'p-1', name: 'MiniMax', is_current: true, baseUrl: 'http://x', apiKey: 'k',
      models: { main: 'MiniMax-M3', haiku: null, sonnet: 'MiniMax-M3[1M]', opus: null, fable: null, reasoning: null },
    }),
    getAll: () => [], getById: () => undefined, getModel: () => undefined, close: () => {},
  }
}

/**
 * Tee 流:每个 events() 调用得到独立队列 —— recorder + route pump 各自消费一份。
 */
function makeSubject<T>() {
  type Sub = { queue: T[]; pending: Array<(v: IteratorResult<T>) => void>; closed: boolean }
  const subs: Sub[] = []
  let closed = false
  return {
    push(v: T) {
      if (closed) return
      for (const s of subs) {
        if (s.closed) continue
        const r = s.pending.shift()
        if (r) r({ value: v, done: false })
        else s.queue.push(v)
      }
    },
    close() {
      closed = true
      for (const s of subs) {
        if (s.closed) continue
        s.closed = true
        while (s.pending.length) s.pending.shift()!({ value: undefined, done: true })
      }
    },
    toAsyncIterable() {
      const sub: Sub = { queue: [], pending: [], closed: false }
      if (closed) sub.closed = true
      subs.push(sub)
      return { [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<T>>((resolve) => {
          const head = sub.queue.shift()
          if (head !== undefined) resolve({ value: head, done: false })
          else if (sub.closed) resolve({ value: undefined, done: true })
          else sub.pending.push(resolve)
        }),
        return: async () => {
          sub.closed = true
          return { value: undefined, done: true }
        },
      }) }
    },
  }
}

function fakeProvider(
  eventsToEmit: AIEvent[],
  opts: { cancelSpy?: ReturnType<typeof vi.fn>; sessionId?: string } = {},
): AIProvider {
  return {
    name: 'fake',
    async createSession(reqId, o): Promise<AISession> {
      const subj = makeSubject<AIEvent>()
      let sendResolve!: () => void
      const sendPromise = new Promise<void>((r) => { sendResolve = r })
      // session.id 必须等于 meta.sid —— AISession.id 语义是 localSid
      const sid = opts.sessionId ?? o.localSid ?? 'fake-sid'
      const session: AISession = {
        id: sid, reqId, kind: o.kind, topic: o.topic, state: 'idle',
        sdkSessionId: 'fake-sdk', model: undefined,
        events: () => subj.toAsyncIterable(),
        async send() { await sendPromise },
        async cancel(reason) { opts.cancelSpy?.(reason); subj.close(); sendResolve() },
        async close() { subj.close(); sendResolve() },
      }
      setImmediate(() => {
        for (const e of eventsToEmit) subj.push(e)
        subj.close()
        sendResolve()
      })
      return session
    },
    async shutdown() {},
  }
}

function fakeProviderLong(opts: { cancelSpy?: ReturnType<typeof vi.fn> } = {}): AIProvider {
  return {
    name: 'fake-long',
    async createSession(reqId, o): Promise<AISession> {
      const subj = makeSubject<AIEvent>()
      // 让 send 等到外部 close —— 这样 liveSessions 期间 cancel 可以命中
      let resolveSend!: () => void
      const sendPromise = new Promise<void>((r) => { resolveSend = r })
      return {
        id: 'long-sid', reqId, kind: o.kind, topic: o.topic, state: 'idle',
        sdkSessionId: 'long-sdk', model: undefined,
        events: () => subj.toAsyncIterable(),
        async send() { await sendPromise },
        async cancel(reason) {
          opts.cancelSpy?.(reason)
          resolveSend()
          subj.close()
        },
        async close() { resolveSend(); subj.close() },
      }
    },
    async shutdown() {},
  }
}

interface Cap { statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }
function openSse(port: number, readMs = 250): Promise<Cap> {
  return new Promise((resolve, reject) => {
    const req = http.request({ method: 'GET', hostname: '127.0.0.1', port, path: '/api/spike/events' }, (res) => {
      const chunks: Buffer[] = []
      const t = setTimeout(() => { req.destroy(); resolve({ statusCode: res.statusCode ?? 0, headers: res.headers as any, body: Buffer.concat(chunks).toString('utf8') }) }, readMs)
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => { clearTimeout(t); resolve({ statusCode: res.statusCode ?? 0, headers: res.headers as any, body: Buffer.concat(chunks).toString('utf8') }) })
      res.on('error', () => { clearTimeout(t); resolve({ statusCode: res.statusCode ?? 0, headers: res.headers as any, body: Buffer.concat(chunks).toString('utf8') }) })
    })
    req.on('error', reject); req.end()
  })
}

describe('spike routes', () => {
  let fastify: FastifyInstance, hub: SseHub, port: number, root: string
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-spike-'))
    hub = createSseHub({ heartbeatMs: 60_000 })
    const store = new SessionStore({ root, now: () => '2026-07-13T00:00:00.000Z' })
    const mirror = new MessagesMirror({ root })
    fastify = Fastify({ logger: false })
    await fastify.register(spikeRoutes, { hub, provider: fakeProvider([
      { type: 'text', text: 'hi', delta: false },
      { type: 'done', reason: 'end_turn', sessionId: 'fake-sdk' },
    ]), ccSwitch: fakeCcSwitch(), store, mirror })
    await fastify.ready()
    const url = await fastify.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })
  afterEach(async () => {
    await fastify.close(); await hub.close()
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  })

  it('rejects empty prompt with 400', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: '' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_request')
  })

  it('rejects missing prompt with 400', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/spike/run', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('accepts good body with 202 + sessionId + meta.yaml', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'hello' } })
    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.status).toBe('accepted')
    expect(typeof body.runId).toBe('string')
    expect(body.reqId).toBe(SPIKE_CHANNEL)
    expect(typeof body.sessionId).toBe('string')
    expect(existsSync(join(root, 'requirements', SPIKE_CHANNEL, 'sessions', body.sessionId, 'meta.yaml'))).toBe(true)
  })

  it('uses provided reqId', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'hi', reqId: 'custom-req' } })
    expect(res.json().reqId).toBe('custom-req')
  })

  it('GET /events sends Content-Type text/event-stream and hello', async () => {
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

  it('GET /events emits X-Accel-Buffering: no header', async () => {
    const res = await openSse(port, 100)
    expect(res.headers['x-accel-buffering']).toBe('no')
  })

  it('POST run pushes session.events() through hub as typed ai_event', async () => {
    const received: SseEvent[] = []
    hub.subscribe(SPIKE_CHANNEL, (e) => received.push(e))
    const res = await fastify.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'hello' } })
    expect(res.statusCode).toBe(202)
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toContainEqual(expect.objectContaining({
      type: 'ai_event', reqId: SPIKE_CHANNEL,
      event: { type: 'text', text: 'hi', delta: false },
    }))
  })

  it('POST run with retrying/error/done emits typed retrying + query_failed', async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'aidevsp-spike-retry-'))
    const hub2 = createSseHub({ heartbeatMs: 60_000 })
    const store2 = new SessionStore({ root: root2, now: () => '2026-07-13T00:00:00.000Z' })
    const mirror2 = new MessagesMirror({ root: root2 })
    const app = Fastify({ logger: false })
    await app.register(spikeRoutes, {
      hub: hub2, ccSwitch: fakeCcSwitch(), store: store2, mirror: mirror2,
      provider: fakeProvider([
        { type: 'retrying', category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: 'retrying' },
        { type: 'error', code: 'auth', message: 'bad key', recoverable: false, category: 'B' },
        { type: 'done', reason: 'error', sessionId: 'sdk-1' },
      ]),
    })
    await app.ready()
    const received: SseEvent[] = []
    hub2.subscribe(SPIKE_CHANNEL, (e) => received.push(e))
    const res = await app.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'hello' } })
    expect(res.statusCode).toBe(202)
    await new Promise((r) => setTimeout(r, 80))
    const r = received.find((e) => e.type === 'retrying')
    expect(r).toBeDefined()
    expect(r).toMatchObject({ type: 'retrying', category: 'A', retry: 1, maxRetries: 3, delayMs: 1000, message: 'retrying' })
    expect((r as any).runId).toBeTruthy()
    expect((r as any).reqId).toBe(SPIKE_CHANNEL)
    expect((r as any).sessionId).toBeTruthy()
    expect(typeof (r as any).ts).toBe('number')
    const f = received.find((e) => e.type === 'query_failed')
    expect(f).toBeDefined()
    expect(f).toMatchObject({ type: 'query_failed', category: 'B', code: 'auth', message: 'bad key', retryable: false })
    await app.close(); await hub2.close(); rmSync(root2, { recursive: true, force: true })
  })

  it('done{cancelled} emits query_cancelled typed event', async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'aidevsp-spike-cancel-event-'))
    const hub2 = createSseHub({ heartbeatMs: 60_000 })
    const store2 = new SessionStore({ root: root2, now: () => '2026-07-13T00:00:00.000Z' })
    const mirror2 = new MessagesMirror({ root: root2 })
    const app = Fastify({ logger: false })
    await app.register(spikeRoutes, {
      hub: hub2, ccSwitch: fakeCcSwitch(), store: store2, mirror: mirror2,
      provider: fakeProvider([
        { type: 'text', text: 'partial', delta: false },
        { type: 'done', reason: 'cancelled', sessionId: 'sdk-c' },
      ]),
    })
    await app.ready()
    const received: SseEvent[] = []
    hub2.subscribe(SPIKE_CHANNEL, (e) => received.push(e))
    await app.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'hi' } })
    await new Promise((r) => setTimeout(r, 80))
    const c = received.find((e) => e.type === 'query_cancelled')
    expect(c).toBeDefined()
    expect(c).toMatchObject({ type: 'query_cancelled', reqId: SPIKE_CHANNEL })
    expect((c as any).sessionId).toBeTruthy()
    expect(typeof (c as any).runId).toBe('string')
    expect(typeof (c as any).ts).toBe('number')
    await app.close(); await hub2.close(); rmSync(root2, { recursive: true, force: true })
  })

  it('provider.createSession failure → query_failed typed; 202 + sessionId; liveSessions 不污染', async () => {
    const root3 = mkdtempSync(join(tmpdir(), 'aidevsp-spike-createfail-'))
    const hub3 = createSseHub({ heartbeatMs: 60_000 })
    const store3 = new SessionStore({ root: root3, now: () => '2026-07-13T00:00:00.000Z' })
    const mirror3 = new MessagesMirror({ root: root3 })
    const throwingProvider: AIProvider = {
      name: 'fake-throw', async createSession(): Promise<AISession> { throw new Error('boom') }, async shutdown() {},
    }
    const app = Fastify({ logger: false })
    await app.register(spikeRoutes, { hub: hub3, provider: throwingProvider, ccSwitch: fakeCcSwitch(), store: store3, mirror: mirror3 })
    await app.ready()
    const received: SseEvent[] = []
    hub3.subscribe(SPIKE_CHANNEL, (e) => received.push(e))
    const res = await app.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'x' } })
    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.status).toBe('accepted')
    expect(typeof body.sessionId).toBe('string')
    expect(existsSync(join(root3, 'requirements', SPIKE_CHANNEL, 'sessions', body.sessionId, 'meta.yaml'))).toBe(true)
    await new Promise((r) => setTimeout(r, 80))
    const f = received.find((e) => e.type === 'query_failed')
    expect(f).toBeDefined()
    expect(f).toMatchObject({ type: 'query_failed', category: 'B', code: 'session_create_failed', retryable: false })
    expect((f as any).message).toMatch(/boom/)
    expect((f as any).sessionId).toBe(body.sessionId)
    const cancel = await app.inject({ method: 'POST', url: `/api/spike/session/${body.sessionId}/cancel` })
    expect(cancel.statusCode).toBe(404)
    await app.close(); await hub3.close(); rmSync(root3, { recursive: true, force: true })
  })

  it('POST cancel 命中 live session → 202 + cancel(user)', async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'aidevsp-spike-cancel-'))
    const hub2 = createSseHub({ heartbeatMs: 60_000 })
    const store2 = new SessionStore({ root: root2, now: () => '2026-07-13T00:00:00.000Z' })
    const mirror2 = new MessagesMirror({ root: root2 })
    const cancelSpy = vi.fn()
    const app = Fastify({ logger: false })
    await app.register(spikeRoutes, { hub: hub2, provider: fakeProviderLong({ cancelSpy }), ccSwitch: fakeCcSwitch(), store: store2, mirror: mirror2 })
    await app.ready()
    const run = await app.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'long' } })
    const { sessionId } = run.json()
    expect(typeof sessionId).toBe('string')
    const cancel = await app.inject({ method: 'POST', url: `/api/spike/session/${sessionId}/cancel` })
    expect(cancel.statusCode).toBe(202)
    expect(cancel.json()).toEqual({ status: 'cancelling', sessionId })
    expect(cancelSpy).toHaveBeenCalledWith('user')
    await app.close(); await hub2.close(); rmSync(root2, { recursive: true, force: true })
  })

  it('POST cancel for unknown sessionId → 404', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/spike/session/does-not-exist/cancel' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('session_not_running')
  })

  it('POST run 真实落 messages.jsonl + ai_event typed SSE', async () => {
    const received: SseEvent[] = []
    hub.subscribe(SPIKE_CHANNEL, (e) => received.push(e))
    const res = await fastify.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'hello' } })
    expect(res.statusCode).toBe(202)
    const { sessionId } = res.json()
    await new Promise((r) => setTimeout(r, 80))
    const mirror = new MessagesMirror({ root })
    const messages = await mirror.readMessages(sessionId)
    const at = messages.find((m) => m.role === 'assistant' && m.type === 'text')
    expect(at).toBeDefined()
    expect(at?.content).toBe('hi')
    expect(received.some((e) => e.type === 'ai_event')).toBe(true)
  })
})

describe('spike routes + authPlugin interaction', () => {
  let app: FastifyInstance, authedHub: SseHub, root: string, port: number
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-spike-auth-'))
    const tm = new TokenManager(root); await tm.ensure()
    const store = new SessionStore({ root, now: () => '2026-07-13T00:00:00.000Z' })
    const mirror = new MessagesMirror({ root })
    authedHub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: ['http://localhost:3333'] })
    await app.register(spikeRoutes, { hub: authedHub, provider: fakeProvider([]), ccSwitch: fakeCcSwitch(), store, mirror })
    await app.ready()
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })
  afterEach(async () => {
    await app.close(); await authedHub.close(); rmSync(root, { recursive: true, force: true })
  })

  it('GET /events is public (no token → 200)', async () => {
    const res = await new Promise<Cap>((resolve, reject) => {
      const req = http.request({ method: 'GET', hostname: '127.0.0.1', port, path: '/api/spike/events' }, (r) => {
        const t = setTimeout(() => { req.destroy(); resolve({ statusCode: r.statusCode ?? 0, headers: r.headers as any, body: '' }) }, 100)
        r.on('data', () => {}); r.on('error', () => { clearTimeout(t); resolve({ statusCode: r.statusCode ?? 0, headers: r.headers as any, body: '' }) })
        r.on('end', () => { clearTimeout(t); resolve({ statusCode: r.statusCode ?? 0, headers: r.headers as any, body: '' }) })
      })
      req.on('error', reject); req.end()
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
  })

  it('POST /run is public (no token → 202/400)', async () => {
    const r400 = await app.inject({ method: 'POST', url: '/api/spike/run', payload: {} })
    expect(r400.statusCode).toBe(400)
    const r202 = await app.inject({ method: 'POST', url: '/api/spike/run', payload: { prompt: 'hi' } })
    expect(r202.statusCode).toBe(202)
  })
})