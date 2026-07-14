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
