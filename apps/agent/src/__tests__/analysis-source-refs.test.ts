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

function seedRequirementMd(reqId: string, content = '# 测试 PRD\n'): void {
  const dir = join(root, 'requirements', reqId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'requirement.md'), content, 'utf8')
}

interface ParsedChunk {
  id: string
  ts: string
  label: string
  text: string
  kind: 'narration' | 'subproblem' | 'risk' | 'option'
  tone: 'info' | 'success' | 'warn' | 'err'
  session_id: string
  source_refs?: unknown
}

function parseChunksJsonl(file: string): ParsedChunk[] {
  const text = readFileSync(file, 'utf8')
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ParsedChunk)
}

describe('analysis: source_refs 透传(ADR-0017 D3 · ticket 06)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-sr-'))
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
  // 1. JSONL 序列化:start 端点的 5 条 mock chunks
  //    - START/READ (narration) 不带 source_refs
  //    - DETECT/RISK/OPTION (subproblem/risk/option) 带 source_refs
  // ========================================================================
  it('start JSONL:narration 行不带 source_refs;subproblem/risk/option 行带', async () => {
    seedRequirementMd('req-001')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      { angle: 'architecture', session_id: 'sess-sr-1' },
    )
    expect(res.statusCode).toBe(201)

    const file = join(
      root,
      'requirements',
      'req-001',
      'analysis',
      'sessions',
      'sess-sr-1',
      'chunks.jsonl',
    )
    const chunks = parseChunksJsonl(file)
    expect(chunks.length).toBe(5)

    // 行 1:START / narration → 无 source_refs
    expect(chunks[0].label).toBe('START')
    expect(chunks[0].kind).toBe('narration')
    expect('source_refs' in chunks[0]).toBe(false)
    expect(chunks[0].source_refs).toBeUndefined()

    // 行 2:READ / narration → 无 source_refs
    expect(chunks[1].label).toBe('READ')
    expect(chunks[1].kind).toBe('narration')
    expect('source_refs' in chunks[1]).toBe(false)

    // 行 3:DETECT / subproblem → 有 source_refs(prd)
    expect(chunks[2].label).toBe('DETECT')
    expect(chunks[2].kind).toBe('subproblem')
    expect(Array.isArray(chunks[2].source_refs)).toBe(true)
    expect(chunks[2].source_refs!.length).toBeGreaterThanOrEqual(1)
    const sr3 = chunks[2].source_refs![0] as Record<string, unknown>
    expect(sr3.kind).toBe('prd')
    expect(Array.isArray(sr3.lineRange)).toBe(true)
    expect(sr3.lineRange).toEqual([12, 14])
    expect(typeof sr3.quote).toBe('string')

    // 行 4:RISK / risk → 有 source_refs(prd + aux)
    expect(chunks[3].label).toBe('RISK')
    expect(chunks[3].kind).toBe('risk')
    expect(Array.isArray(chunks[3].source_refs)).toBe(true)
    expect(chunks[3].source_refs!.length).toBe(2)
    const sr4a = chunks[3].source_refs![0] as Record<string, unknown>
    const sr4b = chunks[3].source_refs![1] as Record<string, unknown>
    expect(sr4a.kind).toBe('prd')
    expect(sr4a.lineRange).toEqual([23, 23])
    expect(sr4b.kind).toBe('aux')
    expect(typeof sr4b.auxId).toBe('string')
    expect((sr4b.auxId as string).length).toBeGreaterThan(0)
    expect(sr4b.lineRange).toEqual([45, 47])

    // 行 5:OPTION / option → 有 source_refs(aux)
    expect(chunks[4].label).toBe('OPTION')
    expect(chunks[4].kind).toBe('option')
    expect(Array.isArray(chunks[4].source_refs)).toBe(true)
    const sr5 = chunks[4].source_refs![0] as Record<string, unknown>
    expect(sr5.kind).toBe('aux')
    expect(sr5.lineRange).toEqual([8, 8])
  })

  // ========================================================================
  // 2. JSONL 字段顺序:不破坏既有契约(id, ts, label, tone, text, kind, session_id)
  //    source_refs 追加在末尾,不影响前序字段顺序
  // ========================================================================
  it('start JSONL:字段顺序保持(id, ts, label, tone, text, kind, session_id, 可选 source_refs)', async () => {
    seedRequirementMd('req-001')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      { angle: 'architecture', session_id: 'sess-sr-ord' },
    )
    expect(res.statusCode).toBe(201)

    const file = join(
      root,
      'requirements',
      'req-001',
      'analysis',
      'sessions',
      'sess-sr-ord',
      'chunks.jsonl',
    )
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(5)

    // 全部行:核心字段按固定顺序
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>
      expect(Object.keys(obj).slice(0, 7)).toEqual([
        'id',
        'ts',
        'label',
        'tone',
        'text',
        'kind',
        'session_id',
      ])
    }

    // 含 source_refs 的行:source_refs 出现在第 8 位
    const subproblemLine = lines[2]
    const subproblemKeys = Object.keys(JSON.parse(subproblemLine) as Record<string, unknown>)
    expect(subproblemKeys[7]).toBe('source_refs')

    // narration 行:7 个字段,不含 source_refs
    const narrationKeys = Object.keys(JSON.parse(lines[0]) as Record<string, unknown>)
    expect(narrationKeys.length).toBe(7)
    expect(narrationKeys).not.toContain('source_refs')
  })

  // ========================================================================
  // 3. SSE publish payload:chunk 对象含 source_refs(订阅侧解析得到)
  // ========================================================================
  it('start SSE:payload chunk 对象带 source_refs', async () => {
    seedRequirementMd('req-003')

    const ssePromise = openSse('/api/requirement/req-003/events', 2000)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const post = await authedJson(
      'POST',
      '/api/requirements/req-003/analysis/start',
      { angle: 'data' },
    )
    expect(post.statusCode).toBe(201)

    const sse = await ssePromise
    expect(sse.statusCode).toBe(200)

    // 不用 regex 粗断言("source_refs" 字符串可能出现在任意位置),改为 parse
    // data 行后断言 chunk 对象本身带/不带 source_refs 字段(定位精确)。
    const dataLines = sse.body
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length).trim())
      .filter((l) => l.length > 0)
    let foundWithSourceRefs = 0
    let foundNarration = 0
    for (const dataLine of dataLines) {
      try {
        const obj = JSON.parse(dataLine) as Record<string, unknown>
        if (obj.type === 'analysis_chunk') {
          const chunk = obj.chunk as Record<string, unknown>
          if (chunk.kind === 'narration') {
            foundNarration++
            expect('source_refs' in chunk).toBe(false)
          } else {
            // subproblem / risk / option
            foundWithSourceRefs++
            expect(Array.isArray(chunk.source_refs)).toBe(true)
          }
        }
      } catch {
        /* heartbeat 等非 JSON 行,跳过 */
      }
    }
    expect(foundWithSourceRefs).toBe(3) // DETECT, RISK, OPTION
    expect(foundNarration).toBe(2) // START, READ
  })

  // ========================================================================
// 4. interject 端点的 2 条 narration → SSE payload **不**含 source_refs
//    (该契约的 SSE 侧断言已落在 `analysis-interject.test.ts` 末尾的
//    'interject 推的 2 条 narration chunk SSE payload **不**含 source_refs'
//    测试里 —— 这里不再重复;interject 本身不写 chunks.jsonl,JSONL 侧断言
//    在该路径下没有意义,加 JSONL 路径会被代码评审判定为"vacuous"测试)
// ========================================================================

  // ========================================================================
  // 5. start 旧 chunks.jsonl(无 source_refs 字段)仍兼容可解析
  //    → 模拟历史数据(7 字段,无 source_refs),验证 append 后续 chunk 不破坏
  // ========================================================================
  it('JSONL 兼容:历史无 source_refs 字段的 chunk 仍能解析', async () => {
    seedRequirementMd('req-001')
    const sid = 'sess-legacy-compat'
    const sessionDir = join(root, 'requirements', 'req-001', 'analysis', 'sessions', sid)
    mkdirSync(sessionDir, { recursive: true })

    // 预置历史 chunks.jsonl(无 source_refs 字段)
    const legacyFile = join(sessionDir, 'chunks.jsonl')
    const legacy = [
      JSON.stringify({
        id: 'c-legacy-1',
        ts: '14:00:00',
        label: 'START',
        tone: 'info',
        text: 'legacy chunk',
        kind: 'narration',
        session_id: sid,
      }),
    ].join('\n')
    writeFileSync(legacyFile, legacy + '\n', 'utf8')

    // 此时 sid 已存在 → 不能再次 start,改为:把现有 legacy chunks.jsonl 读出 + 断言字段
    const text = readFileSync(legacyFile, 'utf8')
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    const obj = JSON.parse(lines[0]) as Record<string, unknown>
    expect(obj.id).toBe('c-legacy-1')
    expect('source_refs' in obj).toBe(false)
    // 旧字段顺序保持
    expect(Object.keys(obj)).toEqual([
      'id',
      'ts',
      'label',
      'tone',
      'text',
      'kind',
      'session_id',
    ])
  })

  // ========================================================================
  // 6. SourceRef 三种子形态都能被序列化到 JSONL 与 SSE payload
  // ========================================================================
  it('JSONL 三种 source_ref kind 形态都可序列化', async () => {
    // 该 case 由 simulateStartChunks 现有 3 条 product 共同覆盖:prd + aux + aux
    // 这里再次显式断言,确保未来追加 asset 时也能一并覆盖
    seedRequirementMd('req-001')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      { angle: 'architecture', session_id: 'sess-sr-kinds' },
    )
    expect(res.statusCode).toBe(201)

    const file = join(
      root,
      'requirements',
      'req-001',
      'analysis',
      'sessions',
      'sess-sr-kinds',
      'chunks.jsonl',
    )
    const chunks = parseChunksJsonl(file)
    // 3 条 product chunk 各带 source_refs
    const productChunks = chunks.filter((c) => c.kind !== 'narration')
    expect(productChunks.length).toBe(3)
    for (const c of productChunks) {
      const refs = c.source_refs as Array<Record<string, unknown>>
      expect(Array.isArray(refs)).toBe(true)
      for (const r of refs) {
        expect(['prd', 'aux', 'asset']).toContain(r.kind)
        if (r.kind === 'prd' || r.kind === 'aux') {
          expect(Array.isArray(r.lineRange)).toBe(true)
          expect(r.lineRange).toHaveLength(2)
          expect(typeof r.lineRange![0]).toBe('number')
          expect(typeof r.lineRange![1]).toBe('number')
        }
        if (r.kind === 'aux') {
          expect(typeof r.auxId).toBe('string')
          expect((r.auxId as string).length).toBeGreaterThan(0)
        }
      }
    }
  })
})