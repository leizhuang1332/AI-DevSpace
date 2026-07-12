import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { HealthService } from '../services/HealthService.js'
import { createSseHub } from '../sse/SseHub.js'

let app: FastifyInstance
let root: string
let tm: TokenManager
let hub: ReturnType<typeof createSseHub>

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-hr-'))
  tm = new TokenManager(root)
  await tm.ensure()
  writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
  hub = createSseHub()
  app = Fastify({ logger: false })
  const healthSvc = new HealthService({
    root,
    tokenManager: tm,
    allowedOrigins: ['http://localhost:3333'],
    logFilePath: join(root, 'agent.log'),
    sseHubStats: () => hub.stats(),
    bootTime: new Date('2026-07-12T08:00:00Z'),
  })
  app.get('/api/health', { config: { public: true } }, async () => healthSvc.collect())
  await app.ready()
})

afterEach(async () => {
  await app.close()
  await hub.close()
  rmSync(root, { recursive: true, force: true })
})

describe('GET /api/health', () => {
  it('returns 200 + full structured payload when healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/"ok":true/)
    expect(res.body).toMatch(/"workspace":/)
    expect(res.body).toMatch(/"tokenPresent":true/)
  })

  it('does not require auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })
})
