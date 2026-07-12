import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { requirementRoutes } from '../routes/requirement.js'

let app: FastifyInstance
let root: string
let token: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-req-'))
  const tm = new TokenManager(root)
  token = await tm.ensure()
  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(requirementRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

async function authed(method: 'GET' | 'POST' | 'PATCH', url: string): Promise<{
  statusCode: number
  body: Record<string, unknown>
}> {
  const res = await app.inject({ method, url, headers: { 'x-aidevspace-token': token } })
  return { statusCode: res.statusCode, body: res.json() }
}

describe('requirement routes return 501 not_implemented', () => {
  it('POST /api/requirement → 501 with feature=requirement.create', async () => {
    const { statusCode, body } = await authed('POST', '/api/requirement')
    expect(statusCode).toBe(501)
    expect(body.error).toBe('not_implemented')
    expect(body.feature).toBe('requirement.create')
    expect(body.issue).toBe('05')
  })

  it('GET /api/requirements → 501 with feature=requirement.list', async () => {
    const { statusCode, body } = await authed('GET', '/api/requirements')
    expect(statusCode).toBe(501)
    expect(body.feature).toBe('requirement.list')
  })

  it('GET /api/requirement/:id → 501 with feature=requirement.detail', async () => {
    const { statusCode, body } = await authed('GET', '/api/requirement/REFUND-001')
    expect(statusCode).toBe(501)
    expect(body.feature).toBe('requirement.detail')
  })

  it('PATCH /api/requirement/:id → 501 with feature=requirement.update', async () => {
    const { statusCode, body } = await authed('PATCH', '/api/requirement/REFUND-001')
    expect(statusCode).toBe(501)
    expect(body.feature).toBe('requirement.update')
  })

  it('POST /api/requirement/:id/skill → 501 with feature=requirement.run_skill, issue=08', async () => {
    const { statusCode, body } = await authed('POST', '/api/requirement/REFUND-001/skill')
    expect(statusCode).toBe(501)
    expect(body.feature).toBe('requirement.run_skill')
    expect(body.issue).toBe('08')
  })

  it('all routes require auth (401 without token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/requirements' })
    expect(res.statusCode).toBe(401)
  })
})
