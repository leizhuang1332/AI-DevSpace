import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { sseRoutes } from '../sse/requirementEventsRoute.js'
import { analysisRoutes } from '../routes/analysis.js'
import type { AIProvider } from '../providers/AIProvider.js'

let app: FastifyInstance
let hub: SseHub
let token: string
let root: string
let port: number

// ticket 01:interject 自身仍走 mock simulator,但 AnalysisRoutesOptions 现在
// 强制 provider 字段;给个不会触发的 stub。
const STUB_PROVIDER: AIProvider = {
  name: 'stub',
  async createSession() { throw new Error('stub: not used in interject') },
  async shutdown() {},
}

interface CapturedResponse {
  statusCode: number
  body: string
}

/** Open an SSE request,read for readMs,return body. */
function openSse(urlPath: string, readMs = 500): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        headers: { 'x-aidevspace-token': token },
      },
      (res) => {
        const chunks: Buffer[] = []
        const timer = setTimeout(() => {
          req.destroy()
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        }, readMs)
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
        res.on('error', () => {
          clearTimeout(timer)
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function authedJson(
  method: 'POST',
  url: string,
  body?: Record<string, unknown>,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-aidevspace-token': token,
      'content-type': 'application/json',
    },
    payload: body,
  })
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> }
}

describe('POST /api/requirements/:id/analysis/interject', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-interject-'))
    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await app.register(sseRoutes, { hub })
    await app.register(analysisRoutes, { hub, provider: STUB_PROVIDER })
    await app.ready()
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })

  afterEach(async () => {
    await app.close()
    await hub.close()
    rmSync(root, { recursive: true, force: true })
  })

  // ========================================================================
  // 基础契约
  // ========================================================================

  it('成功 → 202 + ack 字段', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/interject', {
      text: '补充:退款限额的合规边界',
      session_id: 'sess-arch',
    })
    expect(res.statusCode).toBe(202)
    expect(res.body.status).toBe('accepted')
    expect(res.body.requirementId).toBe('req-001')
    expect(res.body.sessionId).toBe('sess-arch')
  })

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirements/req-001/analysis/interject',
      headers: { 'content-type': 'application/json' },
      payload: { text: 'x', session_id: 's1' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('400 当 body.text 缺失', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/interject', {
      session_id: 'sess-arch',
    })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('bad_request')
  })

  it('400 当 body.session_id 缺失', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/interject', {
      text: 'foo',
    })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('bad_request')
  })

  it('400 当 text 是空字符串', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/interject', {
      text: '',
      session_id: 'sess-arch',
    })
    expect(res.statusCode).toBe(400)
  })

  // ========================================================================
  // SSE 联动(issue 19b 验收 #8)
  // ========================================================================

  it('POST 后 → SSE /events 流上收到 analysis_chunk 事件', async () => {
    // 1. 打开 SSE 订阅
    const ssePromise = openSse('/api/requirement/req-001/events', 1500)

    // 2. 等订阅建立(setImmediate 让 socket 处理 + ensureHeartbeatRunning 完)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // 3. POST 触发 interject
    const post = await authedJson('POST', '/api/requirements/req-001/analysis/interject', {
      text: '需要补充:退款限额的合规边界',
      session_id: 'sess-arch',
    })
    expect(post.statusCode).toBe(202)

    // 4. SSE 流应收到至少 1 条 analysis_chunk
    const sse = await ssePromise
    expect(sse.body).toMatch(/event: analysis_chunk/)
    expect(sse.body).toMatch(/"reqId":"req-001"/)
    expect(sse.body).toMatch(/"sessionId":"sess-arch"/)
    expect(sse.body).toMatch(/"type":"analysis_chunk"/)
  })

  it('POST 推 ≥1 条 analysis_chunk(chunk.text 含用户文本回声)', async () => {
    const ssePromise = openSse('/api/requirement/req-002/events', 1500)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    await authedJson('POST', '/api/requirements/req-002/analysis/interject', {
      text: '请考虑退款金额上限设为 5000',
      session_id: 'sess-data',
    })

    const sse = await ssePromise
    expect(sse.body).toMatch(/event: analysis_chunk/)
    // 至少一条 chunk 的 text 含用户原始输入的关键词(回声)
    expect(sse.body).toContain('5000')
  })

  it('推送到正确 reqId 的订阅者(其他 reqId 不受影响)', async () => {
    const sseA = openSse('/api/requirement/req-A/events', 1500)
    const sseB = openSse('/api/requirement/req-B/events', 1500)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    await authedJson('POST', '/api/requirements/req-A/analysis/interject', {
      text: '只发给 A 的消息',
      session_id: 'sess-A',
    })

    const [a, b] = await Promise.all([sseA, sseB])
    expect(a.body).toMatch(/event: analysis_chunk/)
    expect(a.body).toMatch(/"reqId":"req-A"/)
    // B 不应收到 req-A 的 chunk
    expect(b.body).not.toMatch(/"reqId":"req-A"/)
  })

  // ========================================================================
  // ADR-0017 D3 · ticket 06:narration chunk 一律不带 source_refs
  // ========================================================================

  it('interject 推的 2 条 narration chunk SSE payload **不**含 source_refs', async () => {
    const ssePromise = openSse('/api/requirement/req-003/events', 1500)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    await authedJson('POST', '/api/requirements/req-003/analysis/interject', {
      text: '补充上下文',
      session_id: 'sess-narration',
    })

    const sse = await ssePromise
    expect(sse.body).toMatch(/event: analysis_chunk/)

    // 解析 data 行,逐条断言 chunk.kind === 'narration' → 无 source_refs 字段
    const dataLines = sse.body
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length).trim())
      .filter((l) => l.length > 0)
    let narrationCount = 0
    for (const dataLine of dataLines) {
      try {
        const obj = JSON.parse(dataLine) as Record<string, unknown>
        if (obj.type === 'analysis_chunk') {
          const chunk = obj.chunk as Record<string, unknown>
          if (chunk.kind === 'narration') {
            narrationCount++
            // 关键契约:narration 类 chunk 在 SSE payload 里**没有** source_refs 字段
            expect('source_refs' in chunk).toBe(false)
          }
        }
      } catch {
        /* heartbeat 等非 JSON 行,跳过 */
      }
    }
    expect(narrationCount).toBe(2) // INFER + THINK
  })
})
