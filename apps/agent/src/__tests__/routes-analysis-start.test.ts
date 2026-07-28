import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { sseRoutes } from '../sse/requirementEventsRoute.js'
import { analysisRoutes } from '../routes/analysis.js'
import {
  createSilentProvider,
  createRecordingProvider,
} from './__helpers__/fakeAnalysisProvider.js'

let app: FastifyInstance
let hub: SseHub
let token: string
let root: string
let snapshotDir: string | null
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

// 注:ticket 01 review follow-up —— fake provider 抽取到
// `__helpers__/fakeAnalysisProvider.ts` 共享;这里 import `createSilentProvider`,
// 默认推 1 条 text + done,正好满足 SSE / jsonl 路径测试用例(≥1 chunk)。

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
    // ticket 01:start handler 真接 SDK,测试用 fake provider 避免真子进程
    await app.register(analysisRoutes, { hub, provider: createSilentProvider().provider })
    await app.ready()
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })

  afterEach(async () => {
    await app.close()
    await hub.close()
    rmSync(root, { recursive: true, force: true })
    delete process.env.AIDEVSPACE_ROOT
    if (snapshotDir) {
      rmSync(snapshotDir, { recursive: true, force: true })
      snapshotDir = null
    }
    delete process.env.AIDEVSPACE_SNAPSHOT_DIR
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
  // 9. SSE 联动:POST 后 /events 流收到 ≥1 条 analysis_chunk(真 hub)
  //   ticket 01 (ADR-0020 D8):真 SDK 流式 chunk 数可变,测试只验证"有流"即可。
  //   旧合约(5 行 mock)在 ticket 01 后失效,转交由 fake provider 在每个 turn
  //   emit 1 条 text 事件 = 2 条 narration chunk;此处断言 ≥1(双 turn 至少 1 turn 有产物)。
  // ========================================================================
  it('POST 后 → SSE /events 收到 ≥1 条 analysis_chunk', async () => {
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

    // 4. SSE 应收到 ≥1 条 analysis_chunk(ticket 01 后 fake provider 每 turn 推 1 条)
    const sse = await ssePromise
    expect(sse.statusCode).toBe(200)
    const matches = sse.body.match(/event: analysis_chunk/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(sse.body).toMatch(/"reqId":"req-003"/)
    expect(sse.body).toMatch(/"type":"analysis_chunk"/)
    // ADR-0017 D3:解析 data 行,逐 chunk 验证 source_refs 契约 —— ticket 01 默认
    // kind=narration,无 source_refs(无 PRD 段落索引)。这里只验契约,不强求具体条数。
    const dataLines = sse.body
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length).trim())
      .filter((l) => l.length > 0)
    let sseNarration = 0
    for (const dl of dataLines) {
      try {
        const obj = JSON.parse(dl) as Record<string, unknown>
        if (obj.type !== 'analysis_chunk') continue
        const chunk = obj.chunk as Record<string, unknown>
        if (chunk.kind === 'narration') {
          sseNarration++
          // ticket 01 合约:narration chunk 不带 source_refs
          expect('source_refs' in chunk).toBe(false)
        }
      } catch {
        /* heartbeat 等非 JSON 行,跳过 */
      }
    }
    expect(sseNarration).toBeGreaterThanOrEqual(1)
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
  //     ticket 01 后:fake provider 每个 turn 推 1 条 text 事件 → ≥1 行 jsonl,
  //     字段全部合法(kind=narration),无 source_refs。
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
    expect(lines.length).toBeGreaterThanOrEqual(1)

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
  })

  // ========================================================================
  // 12. ticket 01:start chunks 默认全为 narration(无 source_refs)
  //     ADR-0017 D3 · ticket 06 的 source_refs 契约在真 SDK 流式输出下不再适用
  //     (真实 AI 输出没有结构化 source_refs);narration 类别按 ADR-0017 D3 必
  //     不带 source_refs —— 这里只验证"不带"。
  // ========================================================================
  it('start chunks:narration 不带 source_refs(ADR-0017 D3 契约)', async () => {
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
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>)

    // ticket 01 合约:全部 narration(真 SDK 流式输出无结构化 source_refs)
    for (const n of parsed) {
      expect(n.kind).toBe('narration')
      expect('source_refs' in n).toBe(false)
    }
  })
})

// =============================================================================
// ticket 06 (ADR-0020 D10):turn-bounded snapshot wiring
//
// 这组 describe 自带 Fastify 实例,因为需要 inject 不同的 recording provider
// (eventsByTurn 控制 0 chunk / 正常 chunk / 异常场景)。setup 模式沿用
// `analysis-source-refs.test.ts`:不共享 beforeEach app,每个 it 自己 build。
// =============================================================================
describe('start handler turn-snapshot wiring (ADR-0020 D10)', () => {
  let localRoot: string
  let localHub: SseHub
  let localApp: FastifyInstance
  let localSnapshotDir: string
  let localToken: string
  let localTm: TokenManager

  beforeEach(async () => {
    localRoot = mkdtempSync(join(tmpdir(), 'aidevsp-t06-snap-'))
    localSnapshotDir = mkdtempSync(join(tmpdir(), 'aidevsp-t06-snaps-'))
    process.env.AIDEVSPACE_ROOT = localRoot
    process.env.AIDEVSPACE_SNAPSHOT_DIR = localSnapshotDir
    localTm = new TokenManager(localRoot)
    localToken = await localTm.ensure()
    localHub = createSseHub({ heartbeatMs: 60_000 })
  })

  afterEach(async () => {
    if (localApp) await localApp.close()
    if (localHub) await localHub.close()
    rmSync(localRoot, { recursive: true, force: true })
    rmSync(localSnapshotDir, { recursive: true, force: true })
    delete process.env.AIDEVSPACE_ROOT
    delete process.env.AIDEVSPACE_SNAPSHOT_DIR
  })

  async function bootWithProvider(provider: import('../providers/AIProvider.js').AIProvider) {
    localApp = Fastify({ logger: false })
    await localApp.register(authPlugin, { tokenManager: localTm, allowedOrigins: [] })
    await localApp.register(sseRoutes, { hub: localHub })
    await localApp.register(analysisRoutes, { hub: localHub, provider, workspaceRoot: localRoot })
    await localApp.ready()
  }

  async function postStart(reqId: string, body: Record<string, unknown>) {
    const res = await localApp.inject({
      method: 'POST',
      url: `/api/requirements/${reqId}/analysis/start`,
      headers: { 'x-aidevspace-token': localToken, 'content-type': 'application/json' },
      payload: body,
    })
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> }
  }

  function seedReq(reqId: string): void {
    const dir = join(localRoot, 'requirements', reqId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'requirement.md'), '# snapshot test PRD\n', 'utf8')
  }

  // --------------------------------------------------------------------------
  // 1. 两 turn 都触发 snapshot:turn-1 / turn-2 各有 text 事件 → before_admission
  //    + before_brainstorm 两个 snapshot dir 都存在,内含 chunks.jsonl
  // --------------------------------------------------------------------------
  it('两 turn 都触发 snapshot(before_admission + before_brainstorm 都落盘)', async () => {
    const { provider } = createRecordingProvider({
      eventsByTurn: [
        // turn-1:admission(2 条 text + done)
        //
        // audit-2026-07-26 #2 之后 SDK text 事件先过 `analysis-chunk-parser`,
        // **块边界 = 空行或标记行**(SDK 推的是 delta,不再是"1 事件 = 1 chunk")。
        // 因此测试数据必须用 `\n\n` 显式分块,否则两段会被正确地合并成 1 条 chunk。
        [
          { type: 'text', text: 'admission 段 1\n\n', delta: false },
          { type: 'text', text: 'admission 段 2\n\n', delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-t1' },
        ],
        // turn-2:brainstorm(1 条 text + done)
        [
          { type: 'text', text: 'brainstorm 段 1\n\n', delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-t2' },
        ],
      ],
    })
    await bootWithProvider(provider)

    const reqId = 'req-snap-both'
    seedReq(reqId)
    const res = await postStart(reqId, { angle: 'architecture', session_id: 'sess-snap-both' })
    expect(res.statusCode).toBe(201)

    // 等异步双 turn 跑完(实测 3500ms 足够跑完 fake provider 的 3 条 events)
    await new Promise((r) => setTimeout(r, 3000))

    // before_admission / before_brainstorm 两个 dir 都应存在
    const reqSnapDir = join(localSnapshotDir, reqId)
    expect(existsSync(join(reqSnapDir, 'before_admission'))).toBe(true)
    expect(existsSync(join(reqSnapDir, 'before_brainstorm'))).toBe(true)
    // 每个 dir 都应有 chunks.jsonl + .session-id sidecar
    for (const id of ['before_admission', 'before_brainstorm']) {
      expect(existsSync(join(reqSnapDir, id, 'chunks.jsonl'))).toBe(true)
      expect(existsSync(join(reqSnapDir, id, '.session-id'))).toBe(true)
      expect(readFileSync(join(reqSnapDir, id, '.session-id'), 'utf8')).toBe('sess-snap-both')
    }
    // before_admission 应是 turn-1 开始时的空 chunks.jsonl(start handler 已预创建空文件)
    expect(readFileSync(join(reqSnapDir, 'before_admission', 'chunks.jsonl'), 'utf8')).toBe('')
    // before_brainstorm 应是 turn-2 开始前的 jsonl(turn-1 已写入 2 行)
    const turn1Lines = readFileSync(join(reqSnapDir, 'before_brainstorm', 'chunks.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    expect(turn1Lines.length).toBe(2)
  })

  // --------------------------------------------------------------------------
  // 2. 空 turn 不 snapshot:turn-1 0 chunk → before_admission dir 被清掉;
  //    turn-2 正常 → before_brainstorm 保留
  // --------------------------------------------------------------------------
  it('空 turn(SDK 返回 0 chunk)不 snapshot —— before_admission dir 被清', async () => {
    const { provider } = createRecordingProvider({
      eventsByTurn: [
        // turn-1:无 text 直接 done → 0 chunk
        [{ type: 'done', reason: 'end_turn' as const, sessionId: 'rec-t1' }],
        // turn-2:正常 1 条 text
        [
          { type: 'text', text: 'brainstorm 段', delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-t2' },
        ],
      ],
    })
    await bootWithProvider(provider)

    const reqId = 'req-snap-empty'
    seedReq(reqId)
    const res = await postStart(reqId, { angle: 'data', session_id: 'sess-snap-empty' })
    expect(res.statusCode).toBe(201)

    await new Promise((r) => setTimeout(r, 3000))

    const reqSnapDir = join(localSnapshotDir, reqId)
    // turn-1 写了 0 chunk → before_admission dir 应被 remove(空 turn 不 snapshot)
    expect(existsSync(join(reqSnapDir, 'before_admission'))).toBe(false)
    // turn-2 写了 1 chunk → before_brainstorm dir 应保留
    expect(existsSync(join(reqSnapDir, 'before_brainstorm'))).toBe(true)
    expect(existsSync(join(reqSnapDir, 'before_brainstorm', 'chunks.jsonl'))).toBe(true)
  })

  // --------------------------------------------------------------------------
  // 3. snapshot 失败不阻断后续 turn:把 AIDEVSPACE_SNAPSHOT_DIR 指到非法路径
  //    (把一个**已存在文件**当作 snapshot 父目录 → mkdirSync 失败)→ 两条 turn
  //    都仍跑通,chunks.jsonl 拿到完整 turn-2 产物
  // --------------------------------------------------------------------------
  it('snapshot 失败不阻断后续 turn —— turn-2 仍跑出 chunks', async () => {
    // 把 snapshot dir 临时指向一个**已存在文件**(blocker):helper 内部 mkdirSync
    // 会因 ENOTDIR 失败,验证 best-effort 兜底
    const blockerDir = mkdtempSync(join(tmpdir(), 'aidevsp-t06-block-'))
    writeFileSync(join(blockerDir, 'blocker'), '', 'utf8')
    process.env.AIDEVSPACE_SNAPSHOT_DIR = join(blockerDir, 'blocker')

    try {
      const { provider } = createRecordingProvider({
        eventsByTurn: [
          [
            { type: 'text', text: 'admission 段', delta: false },
            { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-t1' },
          ],
          [
            { type: 'text', text: 'brainstorm 段', delta: false },
            { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-t2' },
          ],
        ],
      })
      await bootWithProvider(provider)

      const reqId = 'req-snap-fail'
      seedReq(reqId)
      const res = await postStart(reqId, { angle: 'custom', session_id: 'sess-snap-fail' })
      // POST 仍 201 —— 启动不应被 snapshot 失败阻断
      expect(res.statusCode).toBe(201)

      await new Promise((r) => setTimeout(r, 3000))

      // chunks.jsonl 仍落 turn-1 + turn-2 内容(2 条 text → 2 行)
      const chunksFile = join(
        localRoot,
        'requirements',
        reqId,
        'analysis',
        'sessions',
        'sess-snap-fail',
        'chunks.jsonl',
      )
      const lines = readFileSync(chunksFile, 'utf8').split('\n').filter((l) => l.trim().length > 0)
      expect(lines.length).toBe(2)
    } finally {
      rmSync(blockerDir, { recursive: true, force: true })
    }
  })

  // --------------------------------------------------------------------------
  // 4. (bonus)REST 端点契约:GET list + POST restore 走通
  // --------------------------------------------------------------------------
  it('GET /analysis/snapshots + POST /analysis/restore 端到端', async () => {
    const { provider } = createRecordingProvider({
      eventsByTurn: [
        [
          { type: 'text', text: 'admission 段', delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-t1' },
        ],
        [
          { type: 'text', text: 'brainstorm 段', delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'rec-t2' },
        ],
      ],
    })
    await bootWithProvider(provider)

    const reqId = 'req-snap-restore'
    seedReq(reqId)
    const post = await postStart(reqId, { angle: 'architecture', session_id: 'sess-restore' })
    expect(post.statusCode).toBe(201)

    await new Promise((r) => setTimeout(r, 3000))

    // 先 list
    const list = await localApp.inject({
      method: 'GET',
      url: `/api/requirements/${reqId}/analysis/snapshots`,
      headers: { 'x-aidevspace-token': localToken },
    })
    expect(list.statusCode).toBe(200)
    const listBody = list.json() as { snapshots: Array<{ id: string; sessionId: string | null }> }
    const ids = listBody.snapshots.map((s) => s.id).sort()
    expect(ids).toEqual(['before_admission', 'before_brainstorm'])
    expect(listBody.snapshots[0].sessionId).toBe('sess-restore')

    // 还原 before_admission → 最新 session 的 chunks.jsonl 变空
    const restore = await localApp.inject({
      method: 'POST',
      url: `/api/requirements/${reqId}/analysis/restore`,
      headers: { 'x-aidevspace-token': localToken, 'content-type': 'application/json' },
      payload: { snapshot_id: 'before_admission' },
    })
    expect(restore.statusCode).toBe(200)
    const restoredBody = restore.json() as { ok: boolean; restoredSessionId: string; chunksLines: number }
    expect(restoredBody.ok).toBe(true)
    expect(restoredBody.restoredSessionId).toBe('sess-restore')
    expect(restoredBody.chunksLines).toBe(0)

    // 验证 chunks.jsonl 被覆盖为空
    const chunksAfter = join(
      localRoot,
      'requirements',
      reqId,
      'analysis',
      'sessions',
      'sess-restore',
      'chunks.jsonl',
    )
    expect(readFileSync(chunksAfter, 'utf8')).toBe('')
  })

  // --------------------------------------------------------------------------
  // 5. 400 / 404:restore body 校验 + 不存在的 snapshot_id
  // --------------------------------------------------------------------------
  it('restore 端点:非法 snapshot_id → 400;未知 id → 400(snapshot_id 同样不在白名单)', async () => {
    const { provider } = createSilentProvider()
    await bootWithProvider(provider)

    const reqId = 'req-snap-bad'
    seedReq(reqId)
    await postStart(reqId, { angle: 'architecture', session_id: 'sess-bad' })
    await new Promise((r) => setTimeout(r, 1000))

    const r1 = await localApp.inject({
      method: 'POST',
      url: `/api/requirements/${reqId}/analysis/restore`,
      headers: { 'x-aidevspace-token': localToken, 'content-type': 'application/json' },
      payload: { snapshot_id: 'bogus' },
    })
    expect(r1.statusCode).toBe(400)
    expect((r1.json() as { error: string }).error).toBe('bad_request')

    const r2 = await localApp.inject({
      method: 'POST',
      url: `/api/requirements/${reqId}/analysis/restore`,
      headers: { 'x-aidevspace-token': localToken, 'content-type': 'application/json' },
      payload: {},
    })
    expect(r2.statusCode).toBe(400)
  })

  // --------------------------------------------------------------------------
  // 6. snapshot 默认开启(audit-2026-07-26 #4)
  //
  // 旧契约:`AIDEVSPACE_SNAPSHOT_DIR` 未设 → list 返空 + restore 404
  // (`snapshot_dir_unset`)。审计判定这是缺陷而非特性 —— 默认启动脚本从不设
  // 该变量,于是正常启动应用时 ticket 06 的整条回滚能力等于没上线:
  // 不生成 snapshot、列表恒空、StatusBar 回滚入口永不出现。
  //
  // 新契约:env 未设 → 落到 `<workspaceRoot>/snapshots/analysis`,snapshot
  // 默认开启;env 显式配置时仍然优先(上一条测试覆盖)。
  // --------------------------------------------------------------------------
  it('未配置 AIDEVSPACE_SNAPSHOT_DIR 时默认落 <workspaceRoot>/snapshots/analysis', async () => {
    delete process.env.AIDEVSPACE_SNAPSHOT_DIR
    const { provider } = createSilentProvider()
    await bootWithProvider(provider)

    const reqId = 'req-snap-default'
    seedReq(reqId)
    await postStart(reqId, { angle: 'architecture', session_id: 'sess-default' })
    await new Promise((r) => setTimeout(r, 1000))

    // 1. 磁盘上落到默认目录
    expect(existsSync(join(localRoot, 'snapshots', 'analysis', reqId, 'before_admission'))).toBe(
      true,
    )

    // 2. list 端点看得到(StatusBar 回滚入口的前提)
    const list = await localApp.inject({
      method: 'GET',
      url: `/api/requirements/${reqId}/analysis/snapshots`,
      headers: { 'x-aidevspace-token': localToken },
    })
    expect(list.statusCode).toBe(200)
    const snapshots = (list.json() as { snapshots: Array<{ id: string }> }).snapshots
    expect(snapshots.map((s) => s.id)).toContain('before_admission')

    // 3. restore 走通(不再是 snapshot_dir_unset 404)
    const r = await localApp.inject({
      method: 'POST',
      url: `/api/requirements/${reqId}/analysis/restore`,
      headers: { 'x-aidevspace-token': localToken, 'content-type': 'application/json' },
      payload: { snapshot_id: 'before_admission' },
    })
    expect(r.statusCode).toBe(200)
    // restore 用的是**注入的** workspace root,写回本测试的临时目录
    expect((r.json() as { chunksPath: string }).chunksPath).toContain(reqId)
  })
})
