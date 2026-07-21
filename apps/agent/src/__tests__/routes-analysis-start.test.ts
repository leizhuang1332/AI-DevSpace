import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { sseRoutes } from '../sse/requirementEventsRoute.js'
import { analysisRoutes } from '../routes/analysis.js'

let app: FastifyInstance
let hub: SseHub
let token: string
let root: string
let port: number

interface CapturedResponse {
  statusCode: number
  body: string
}

/** Open an SSE request,read for readMs,return body. */
function openSse(urlPath: string, readMs = 1500): Promise<CapturedResponse> {
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
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
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

/** 在 <root>/requirements/<reqId>/requirement.md 预置一个伪 PRD,用于会话启动。 */
function seedRequirementMd(reqId: string, content = '# 测试 PRD\n'): void {
  const dir = join(root, 'requirements', reqId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'requirement.md'), content, 'utf8')
}

describe('POST /api/requirements/:id/analysis/start', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-start-'))
    process.env.AIDEVSPACE_ROOT = root
    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await app.register(sseRoutes, { hub })
    await app.register(analysisRoutes, { hub })
    await app.ready()
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })

  afterEach(async () => {
    await app.close()
    await hub.close()
    rmSync(root, { recursive: true, force: true })
    delete process.env.AIDEVSPACE_ROOT
  })

  // ========================================================================
  // 1. 401 without token
  // ========================================================================
  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirements/req-001/analysis/start',
      headers: { 'content-type': 'application/json' },
      payload: { angle: 'architecture' },
    })
    expect(res.statusCode).toBe(401)
  })

  // ========================================================================
  // 2. 400 angle 缺失
  // ========================================================================
  it('400 当 angle 缺失', async () => {
    seedRequirementMd('req-001')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      {},
    )
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('bad_request')
    expect(String(res.body.reason)).toContain('angle')
  })

  // ========================================================================
  // 3. 400 angle 不在白名单
  // ========================================================================
  it('400 当 angle=performance 不在白名单', async () => {
    seedRequirementMd('req-001')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      { angle: 'performance' },
    )
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('bad_request')
    expect(String(res.body.reason)).toContain('angle')
  })

  // ========================================================================
  // 4. 400 session_id 格式非法(路径穿越)
  // ========================================================================
  it('400 当 session_id=../../etc/passwd 非法格式', async () => {
    seedRequirementMd('req-001')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      { angle: 'architecture', session_id: '../../etc/passwd' },
    )
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('bad_request')
    expect(String(res.body.reason)).toContain('session_id')
  })

  // ========================================================================
  // 5. 409 prd_not_ready
  // ========================================================================
  it('409 prd_not_ready 当 requirement.md 不存在', async () => {
    // 不 seedRequirementMd
    const res = await authedJson(
      'POST',
      '/api/requirements/req-missing/analysis/start',
      { angle: 'architecture' },
    )
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('prd_not_ready')
    expect(String(res.body.reason)).toContain('requirement.md')
  })

  // ========================================================================
  // 6. 409 session_already_exists
  // ========================================================================
  it('409 session_already_exists 当指定 session_id 目录已存在', async () => {
    seedRequirementMd('req-001')
    const sid = 'sess-dup-test'
    const sessionDir = join(root, 'requirements', 'req-001', 'analysis', 'sessions', sid)
    mkdirSync(sessionDir, { recursive: true })

    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      { angle: 'data', session_id: sid },
    )
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('session_already_exists')
  })

  // ========================================================================
  // 7. 201 后端生成 session_id + 落盘 _index.yaml + chunks.jsonl
  // ========================================================================
  it('201 → 不传 session_id,后端生成 + 落盘 _index.yaml + chunks.jsonl', async () => {
    seedRequirementMd('req-001')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      { angle: 'architecture' },
    )
    expect(res.statusCode).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.requirementId).toBe('req-001')
    const sid = String(res.body.sessionId)
    expect(sid).toMatch(/^sess-architecture-/)
    expect(String(res.body.index_path)).toContain('_index.yaml')
    expect(String(res.body.chunks_path)).toContain('chunks.jsonl')

    // fs 断言
    const sessionsDir = join(root, 'requirements', 'req-001', 'analysis', 'sessions')
    expect(existsSync(join(sessionsDir, '_index.yaml'))).toBe(true)
    const sessDir = join(sessionsDir, sid)
    expect(existsSync(sessDir)).toBe(true)
    expect(existsSync(join(sessDir, 'chunks.jsonl'))).toBe(true)

    // yaml 含新会话
    const yaml = readFileSync(join(sessionsDir, '_index.yaml'), 'utf8')
    expect(yaml).toContain(`id: ${sid}`)
    expect(yaml).toContain('angle: architecture')
    expect(yaml).toContain('label: 架构')
  })

  // ========================================================================
  // 8. 201 合法 session_id + label → 文件名按 sid
  // ========================================================================
  it('201 → 传合法 session_id + label,文件路径按 sid', async () => {
    seedRequirementMd('req-002')
    const sid = 'sess-custom-arch-42'
    const res = await authedJson(
      'POST',
      '/api/requirements/req-002/analysis/start',
      { angle: 'interface', session_id: sid, label: '接口V2' },
    )
    expect(res.statusCode).toBe(201)
    expect(res.body.sessionId).toBe(sid)

    const sessDir = join(root, 'requirements', 'req-002', 'analysis', 'sessions', sid)
    expect(existsSync(sessDir)).toBe(true)
    expect(existsSync(join(sessDir, 'chunks.jsonl'))).toBe(true)
    const yaml = readFileSync(
      join(root, 'requirements', 'req-002', 'analysis', 'sessions', '_index.yaml'),
      'utf8',
    )
    expect(yaml).toContain(`id: ${sid}`)
    expect(yaml).toContain('label: 接口V2')
    expect(yaml).toContain('angle: interface')
  })

  // ========================================================================
  // 9. SSE 联动:POST 后 /events 流收到 ≥5 条 analysis_chunk(真 hub)
  // ========================================================================
  it('POST 后 → SSE /events 收到 ≥5 条 analysis_chunk', async () => {
    seedRequirementMd('req-003')

    // 1. 先开 SSE 订阅
    const ssePromise = openSse('/api/requirement/req-003/events', 2000)
    // 2. 等订阅建立
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // 3. POST 触发 start
    const post = await authedJson(
      'POST',
      '/api/requirements/req-003/analysis/start',
      { angle: 'data' },
    )
    expect(post.statusCode).toBe(201)

    // 4. SSE 应收到 5 条 analysis_chunk
    const sse = await ssePromise
    expect(sse.statusCode).toBe(200)
    const matches = sse.body.match(/event: analysis_chunk/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(5)
    expect(sse.body).toMatch(/"reqId":"req-003"/)
    expect(sse.body).toMatch(/"type":"analysis_chunk"/)
    // ADR-0017 D3 · ticket 06:解析 data 行,逐 chunk 验证 source_refs 契约。
    // 不用 regex 粗断言(`source_refs` 字符串可能出现在任何位置),而是 parse 后
    // 断言 chunk 对象本身带/不带该字段。
    const dataLines = sse.body
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length).trim())
      .filter((l) => l.length > 0)
    let sseWithRefs = 0
    let sseNarration = 0
    for (const dl of dataLines) {
      try {
        const obj = JSON.parse(dl) as Record<string, unknown>
        if (obj.type !== 'analysis_chunk') continue
        const chunk = obj.chunk as Record<string, unknown>
        if (chunk.kind === 'narration') {
          sseNarration++
          expect('source_refs' in chunk).toBe(false)
        } else {
          sseWithRefs++
          expect(Array.isArray(chunk.source_refs)).toBe(true)
        }
      } catch {
        /* heartbeat 等非 JSON 行,跳过 */
      }
    }
    expect(sseWithRefs).toBe(3)
    expect(sseNarration).toBe(2)
  })

  // ========================================================================
  // 10. _index.yaml append:连续两次 start → yaml 含 2 行
  // ========================================================================
  it('连续两次 start 不同 sid → _index.yaml 含 2 行 session,字段全', async () => {
    seedRequirementMd('req-004')

    const r1 = await authedJson(
      'POST',
      '/api/requirements/req-004/analysis/start',
      { angle: 'architecture', session_id: 'sess-multi-1', label: '架构1' },
    )
    expect(r1.statusCode).toBe(201)

    const r2 = await authedJson(
      'POST',
      '/api/requirements/req-004/analysis/start',
      { angle: 'data', session_id: 'sess-multi-2', label: '数据2' },
    )
    expect(r2.statusCode).toBe(201)

    const yaml = readFileSync(
      join(root, 'requirements', 'req-004', 'analysis', 'sessions', '_index.yaml'),
      'utf8',
    )
    // 两个 id 都在
    expect(yaml).toContain('id: sess-multi-1')
    expect(yaml).toContain('id: sess-multi-2')
    // 各有一个 `- id:` 行
    const listStarts = yaml.match(/^\s*-\s+id:/gm) ?? []
    expect(listStarts.length).toBe(2)
    // 关键:旧 session 的字段(append 后)不能丢
    // 第一次写入的 session 在 append 后字段应仍正确(label / angle / detected_count / is_streaming)
    expect(yaml).toContain('label: 架构1')
    expect(yaml).toContain('angle: architecture')
    expect(yaml).toContain('detected_count: 0')
    // 第二次写入的 session 也应正确
    expect(yaml).toContain('label: 数据2')
    expect(yaml).toContain('angle: data')
    // 不能出现 undefined 字段(原 parser bug:trim 后正则不匹配,append 后 label/angle 变 'undefined')
    expect(yaml).not.toMatch(/^\s*(label|angle|detected_count):\s*undefined\s*$/m)
  })

  // ========================================================================
  // 11. chunks.jsonl 格式:web 端 loadSessionChunks() 可解析(id/ts/label/text/kind/tone/session_id)
  // ========================================================================
  it('chunks.jsonl 每行 JSON 字段都能被 web loadSessionChunks() 解析', async () => {
    seedRequirementMd('req-005')
    const sid = 'sess-format-check'
    const res = await authedJson(
      'POST',
      '/api/requirements/req-005/analysis/start',
      { angle: 'custom', session_id: sid, label: '自定义维度' },
    )
    expect(res.statusCode).toBe(201)

    const file = join(
      root,
      'requirements',
      'req-005',
      'analysis',
      'sessions',
      sid,
      'chunks.jsonl',
    )
    expect(existsSync(file)).toBe(true)
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(5)

    // 模拟 web 端 loadSessionChunks:逐行 JSON.parse + 字段断言
    const requiredFields = ['id', 'ts', 'label', 'text', 'kind', 'tone', 'session_id']
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>
      for (const f of requiredFields) {
        expect(obj).toHaveProperty(f)
        expect(typeof obj[f]).toBe('string')
      }
      expect(obj.session_id).toBe(sid)
      // kind 只能是 SSE 协议支持的 4 种之一
      expect(['narration', 'subproblem', 'risk', 'option']).toContain(obj.kind)
    }

    // 5 条覆盖 4 种 kind:前两条 START/READ 是 narration,第 3 DETECT subproblem,第 4 RISK risk,第 5 OPTION option
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, string>)
    expect(parsed[0].label).toBe('START')
    expect(parsed[1].label).toBe('READ')
    expect(parsed[2].label).toBe('DETECT')
    expect(parsed[3].label).toBe('RISK')
    expect(parsed[4].label).toBe('OPTION')
    expect(parsed[2].kind).toBe('subproblem')
    expect(parsed[3].kind).toBe('risk')
    expect(parsed[4].kind).toBe('option')
  })

  // ========================================================================
  // 12. ADR-0017 D3 · ticket 06:start mock chunks 的 source_refs 字段
  //     - 3 条 product chunk (subproblem/risk/option) 带 source_refs
  //     - 2 条 narration chunk 不带
  // ========================================================================
  it('start chunks:subproblem/risk/option 含 source_refs;narration 不含', async () => {
    seedRequirementMd('req-006')
    const sid = 'sess-source-refs'
    const res = await authedJson(
      'POST',
      '/api/requirements/req-006/analysis/start',
      { angle: 'architecture', session_id: sid },
    )
    expect(res.statusCode).toBe(201)

    const file = join(
      root,
      'requirements',
      'req-006',
      'analysis',
      'sessions',
      sid,
      'chunks.jsonl',
    )
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(5)
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>)

    // 2 条 narration:无 source_refs
    const narration = parsed.filter((c) => c.kind === 'narration')
    expect(narration.length).toBe(2)
    for (const n of narration) {
      expect('source_refs' in n).toBe(false)
    }

    // 3 条 product:有 source_refs(数组,至少 1 个)
    const products = parsed.filter((c) => c.kind !== 'narration')
    expect(products.length).toBe(3)
    for (const p of products) {
      expect(Array.isArray(p.source_refs)).toBe(true)
      expect((p.source_refs as unknown[]).length).toBeGreaterThanOrEqual(1)
    }
  })
})
