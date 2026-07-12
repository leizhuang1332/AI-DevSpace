import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { BootstrapResponse } from '@ai-devspace/shared'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { bootstrapRoutes } from '../routes/bootstrap.js'

let app: FastifyInstance
let root: string
let tm: TokenManager

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-boot-'))
  tm = new TokenManager(root)
  await tm.ensure()
  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(bootstrapRoutes, { tokenManager: tm, apiBase: 'http://localhost:7777' })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

describe('GET /api/agent/bootstrap', () => {
  it('returns the token via public route (no auth needed)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    expect(res.statusCode).toBe(200)
    const parsed = BootstrapResponse.safeParse(res.json())
    expect(parsed.success).toBe(true)
  })

  it('always returns the same token (no rotation)', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    const r2 = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    expect(r1.json().token).toBe(r2.json().token)
  })

  it('body includes cookie metadata for the Web client', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    const body = res.json()
    expect(body.cookieName).toBe('aidevspace_token')
    expect(body.cookieAttributes.SameSite).toBe('Strict')
    expect(body.cookieAttributes.Path).toBe('/')
    expect(body.cookieAttributes.MaxAge).toBe(2_592_000)
  })

  it('exposes apiBase + agentVersion + sseNote', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    const body = res.json()
    expect(body.apiBase).toBe('http://localhost:7777')
    expect(body.agentVersion).toBe('0.0.0')
    expect(body.sseNote).toMatch(/EventSource/)
  })

  it('token in response matches the on-disk file', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent/bootstrap' })
    const body = res.json()
    const onDisk = readFileSync(join(root, '.agent-token'), 'utf8')
    expect(body.token).toBe(onDisk)
  })
})
