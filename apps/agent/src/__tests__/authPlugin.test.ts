import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function buildApp(token: string, allowedOrigins: string[] = [
  'http://localhost:3333',
  'http://127.0.0.1:3333',
]): Promise<FastifyInstance> {
  const root = mkdtempSync(join(tmpdir(), 'aidevsp-auth-'))
  const tm = new TokenManager(root)
  await tm.ensure()
  // Force-override token for predictable assertion
  ;(tm as unknown as { cached: string }).cached = token

  const app = Fastify({ logger: false })
  await app.register(authPlugin, {
    tokenManager: tm,
    allowedOrigins,
  })
  app.get('/api/protected', async () => ({ ok: true }))
  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true }))
  await app.ready()
  return app
}

const TOKEN = 'a'.repeat(43)

describe('authPlugin', () => {
  it('401 when no token and not public', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({ method: 'GET', url: '/api/protected' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('401 when header token is wrong', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { 'x-aidevspace-token': 'wrong' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('200 with correct X-AIDevSpace-Token header', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { 'x-aidevspace-token': TOKEN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('200 with correct cookie', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { cookie: `aidevspace_token=${TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('cookie preferred over header when both present', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: {
        cookie: `aidevspace_token=${TOKEN}`,
        'x-aidevspace-token': 'wrong',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('403 when Origin not in allowlist', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: {
        'x-aidevspace-token': TOKEN,
        origin: 'http://evil.com',
      },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'origin_not_allowed', origin: 'http://evil.com' })
  })

  it('allows request when Origin is allowlisted', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: {
        'x-aidevspace-token': TOKEN,
        origin: 'http://localhost:3333',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('skips origin check when no Origin header (e.g. curl)', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { 'x-aidevspace-token': TOKEN },
    })
    expect(res.statusCode).toBe(200)
  })

  it('200 on public route without token', async () => {
    const app = await buildApp(TOKEN)
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })
})
