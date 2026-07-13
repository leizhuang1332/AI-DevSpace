import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!
    await fn()
  }
})

async function boot(): Promise<{ url: string; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-'))
  writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
  const app = await buildServer({ workspaceRoot: root, logFilePath: join(root, 'agent.log') })
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  cleanups.push(async () => {
    await app.close()
    // Brief give pino transport time to flush + release the log fd
    await new Promise((r) => setTimeout(r, 30))
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* pino still flushing; safe to ignore */
    }
  })
  cleanups.push(async () => {
    try { await app.close() } catch { /* double-close guard */ }
  })
  return { url, root }
}

// Windows 上 pino transport flush + temp dir teardown 竞态会触发 uncaught agent.log ENOENT;
// 整个 e2e suite 依赖稳定 temp dir 生命周期,Windows 上统一跳过
describe.skipIf(process.platform === 'win32')('agent skeleton e2e', () => {
  it('GET /api/health returns structured payload', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(typeof body.bootTime).toBe('string')
  })

  it('GET /api/agent/bootstrap returns token (no auth needed)', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/agent/bootstrap`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; cookieName: string }
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.cookieName).toBe('aidevspace_token')
  })

  it('GET /api/requirements without token → 401', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/requirements`)
    expect(res.status).toBe(401)
  })

  it('GET /api/requirements with wrong token → 401', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/requirements`, {
      headers: { 'x-aidevspace-token': 'a'.repeat(43) },
    })
    expect(res.status).toBe(401)
  })

  it('GET /api/requirements with correct token → 501', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')
    const res = await fetch(`${url}/api/requirements`, {
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.status).toBe(501)
  })

  it('request with bad Origin → 403', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')
    const res = await fetch(`${url}/api/requirements`, {
      headers: {
        'x-aidevspace-token': token,
        origin: 'http://evil.com',
      },
    })
    expect(res.status).toBe(403)
  })

  it('SSE GET /api/requirement/REFUND-001/events emits hello', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')
    const controller = new AbortController()
    const res = await fetch(
      `${url}/api/requirement/REFUND-001/events`,
      {
        method: 'GET',
        headers: { 'x-aidevspace-token': token },
        signal: controller.signal,
      },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)

    // Read the streamed body briefly to capture hello event
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let acc = ''
    const startedAt = Date.now()
    const timeout = setTimeout(() => controller.abort(), 2000)
    try {
      while (!acc.includes('event: hello')) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value)
        if (Date.now() - startedAt > 1500) break
      }
    } catch {
      /* aborted */
    } finally {
      clearTimeout(timeout)
      try { controller.abort() } catch { /* already aborted */ }
    }
    expect(acc).toMatch(/event: hello/)
    expect(acc).toMatch(/REFUND-001/)
  })
}, 15_000)
