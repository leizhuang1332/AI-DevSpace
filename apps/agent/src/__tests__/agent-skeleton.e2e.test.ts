import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
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

  it('GET /api/requirements with correct token → 200 + 空数组(新实装 ticket 07a)', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')
    const res = await fetch(`${url}/api/requirements`, {
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { requirements: unknown[] }
    expect(Array.isArray(body.requirements)).toBe(true)
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

  // ========================================================================
  // ADR-0017 ticket 06 · 端到端验收(对应 ticket "集成验证"段):
  // 1. POST /api/requirements/<id>/analysis/start → 201
  // 2. chunks.jsonl 读出 5 行,3 行含 source_refs / 2 行不含
  // 3. SSE /events 收到 5 个 analysis_chunk,payload 含 source_refs
  // ========================================================================
  it('start end-to-end:chunks.jsonl 5 行 + 3 行带 source_refs', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')

    // 1. seed requirement.md
    const reqId = 'req-source-refs-e2e'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(join(reqDir, 'requirement.md'), '# e2e PRD\n', 'utf8')

    // 2. POST /api/requirements/:id/analysis/start → 201
    const post = await fetch(
      `${url}/api/requirements/${reqId}/analysis/start`,
      {
        method: 'POST',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ angle: 'architecture', session_id: 'sess-e2e-sr' }),
      },
    )
    expect(post.status).toBe(201)
    const postBody = (await post.json()) as { sessionId: string; chunks_path: string }
    expect(postBody.sessionId).toBe('sess-e2e-sr')

    // 3. 读 chunks.jsonl → 5 行,3 行含 source_refs / 2 行不含
    const text = readFileSync(postBody.chunks_path, 'utf8')
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(5)
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
    const productLines = parsed.filter((c) => c.kind !== 'narration')
    expect(productLines.length).toBe(3)
    for (const c of productLines) {
      expect(Array.isArray(c.source_refs)).toBe(true)
    }
    const narrationLines = parsed.filter((c) => c.kind === 'narration')
    expect(narrationLines.length).toBe(2)
    for (const c of narrationLines) {
      expect('source_refs' in c).toBe(false)
    }

    // 4. SSE 订阅 /events,验证 source_refs 也走 SSE 推送
    const controller = new AbortController()
    const sse = await fetch(`${url}/api/requirement/${reqId}/events`, {
      method: 'GET',
      headers: { 'x-aidevspace-token': token },
      signal: controller.signal,
    })
    expect(sse.status).toBe(200)
    expect(sse.headers.get('content-type')).toMatch(/^text\/event-stream/)

    const reader = sse.body!.getReader()
    const decoder = new TextDecoder()
    let acc = ''
    const startedAt = Date.now()
    const timeout = setTimeout(() => controller.abort(), 2500)
    try {
      while (Date.now() - startedAt < 2000) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value)
        if ((acc.match(/event: analysis_chunk/g) ?? []).length >= 5) break
      }
    } catch {
      /* aborted */
    } finally {
      clearTimeout(timeout)
      try { controller.abort() } catch { /* already aborted */ }
    }

    // 解析 5 条 data 行,逐条断言 chunk.source_refs 契约
    const dataLines = acc
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length).trim())
      .filter((l) => l.length > 0)
    let withRefs = 0
    let narration = 0
    for (const dl of dataLines) {
      try {
        const obj = JSON.parse(dl) as Record<string, unknown>
        if (obj.type !== 'analysis_chunk') continue
        const chunk = obj.chunk as Record<string, unknown>
        if (chunk.kind === 'narration') {
          narration++
          expect('source_refs' in chunk).toBe(false)
        } else {
          withRefs++
          expect(Array.isArray(chunk.source_refs)).toBe(true)
        }
      } catch {
        /* non-JSON */
      }
    }
    expect(withRefs).toBe(3)
    expect(narration).toBe(2)
  })
}, 30_000)
