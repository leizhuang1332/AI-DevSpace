import { describe, expect, it, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import { sessionsRetryRoutes } from '../routes/sessionsRetryRoute.js'
import { SessionStore } from '../session/SessionStore.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('POST /sessions/:localSid/retry', () => {
  let root: string
  let store: SessionStore
  let mockRunTurn: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'retry-test-'))
    store = new SessionStore({ root })
    mockRunTurn = vi.fn().mockResolvedValue({ runId: 'r-1' })
  })

  it('returns 404 when session does not exist', async () => {
    const app = Fastify()
    await app.register(sessionsRetryRoutes, { sessionStore: store, runTurn: mockRunTurn })
    const res = await app.inject({
      method: 'POST',
      url: '/sessions/nope/retry',
      payload: { reqId: 'r' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('session_not_found')
  })

  it('returns 409 when last_input is missing', async () => {
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    const app = Fastify()
    await app.register(sessionsRetryRoutes, { sessionStore: store, runTurn: mockRunTurn })
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${meta.sid}/retry`,
      payload: { reqId: 'REQ-1' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('no_retryable_input')
    expect(mockRunTurn).not.toHaveBeenCalled()
  })

  it('returns 200 and calls runTurn with isRetry=true when last_input exists', async () => {
    const meta = await store.createSession('REQ-1', { topic: 't', kind: 'chat' })
    await store.updateSession(meta.sid, { last_input: 'hi' })
    const app = Fastify()
    await app.register(sessionsRetryRoutes, { sessionStore: store, runTurn: mockRunTurn })
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${meta.sid}/retry`,
      payload: { reqId: 'REQ-1' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().retryToken).toBeTruthy()
    expect(mockRunTurn).toHaveBeenCalledWith(expect.objectContaining({
      inputText: 'hi',
      isRetry: true,
    }))
  })

  it('cleanup', async () => {
    await rm(root, { recursive: true, force: true })
  })
})

describe('e2e · last_input → retry route · isRetry flag', () => {
  /**
   * 端到端串联:
   * 1. AISession.send(..., sessionStore 注入) → 成功完成 → last_input 写入 meta.yaml
   * 2. retry route 读 meta.last_input → 200 + dispatch runTurn({ inputText, isRetry: true })
   * 3. AISession.isRetry=true 时首 retry 间隔=0(已由 RetryStrategy.initialDelayMs 测试覆盖,
   *    这里验证 route 这一跳把 isRetry 透传到 runTurn 入参)
   *
   * 该 e2e 还原 plan §4 数据流时序,不引入 mock SDK,改用直接 in-memory AISession 实例。
   */
  it('writes last_input on success, retry route forwards isRetry=true', async () => {
    const rootLocal = await mkdtemp(join(tmpdir(), 'retry-e2e-'))
    try {
      const localStore = new SessionStore({ root: rootLocal })
      const meta = await localStore.createSession('REQ-E2E', { topic: 't', kind: 'chat' })
      const adapter = {
        async *runTurn(): AsyncIterable<unknown> {
          yield { kind: 'assistant', text: 'ok', sessionId: 'sdk-1' }
          yield { kind: 'result', sessionId: 'sdk-1', reason: 'end_turn' }
        },
      }
      const session = new (await import('../session/AISession.js')).AiSession({
        id: meta.sid,
        reqId: meta.reqId,
        topic: meta.topic,
        kind: meta.kind,
        sessionStore: localStore,
        adapter: adapter as never,
      })
      await session.send('hello e2e')
      // 此时 meta.last_input 应是 'hello e2e'
      const updatedMeta = await localStore.getSession(meta.sid)
      expect(updatedMeta?.last_input).toBe('hello e2e')

      // 接下来 retry route 触发:app 接收 POST /sessions/:sid/retry
      const captured = { inputText: '', isRetry: undefined as boolean | undefined }
      const app = Fastify()
      await app.register(sessionsRetryRoutes, {
        sessionStore: localStore,
        runTurn: async (input) => {
          captured.inputText = input.inputText
          captured.isRetry = input.isRetry
          return { runId: 'r-e2e' }
        },
      })
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/${meta.sid}/retry`,
        payload: { reqId: 'REQ-E2E' },
      })
      expect(res.statusCode).toBe(200)
      expect(captured.inputText).toBe('hello e2e')
      expect(captured.isRetry).toBe(true)
    } finally {
      await rm(rootLocal, { recursive: true, force: true })
    }
  })
})
