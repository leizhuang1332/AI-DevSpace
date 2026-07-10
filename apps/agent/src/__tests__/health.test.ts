import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'

describe('GET /api/health', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 200 with { ok: true, name: "agent", workspaceRoot: string }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.name).toBe('agent')
    expect(typeof body.workspaceRoot).toBe('string')
    expect(body.workspaceRoot.length).toBeGreaterThan(0)
  })
})
