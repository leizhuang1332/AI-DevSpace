import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
let snapshotDir: string

// ticket 01:AnalysisRoutesOptions 现在强制要求 provider;generate-brief 自身
// 不调 provider,但注册时仍需一个 stub 对象。
const STUB_PROVIDER: AIProvider = {
  name: 'stub',
  async createSession() { throw new Error('stub: not used in generate-brief') },
  async shutdown() {},
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

describe('POST /api/requirements/:id/analysis/generate-brief', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-genbrief-'))
    snapshotDir = mkdtempSync(join(tmpdir(), 'aidevsp-genbrief-snap-'))
    process.env.AIDEVSPACE_ROOT = root
    process.env.AIDEVSPACE_SNAPSHOT_DIR = snapshotDir
    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await app.register(sseRoutes, { hub })
    await app.register(analysisRoutes, { hub, provider: STUB_PROVIDER })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    await hub.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(snapshotDir, { recursive: true, force: true })
    delete process.env.AIDEVSPACE_ROOT
    delete process.env.AIDEVSPACE_SNAPSHOT_DIR
  })

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirements/req-001/analysis/generate-brief',
      headers: { 'content-type': 'application/json' },
      payload: { session_id: 'sess-arch' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('400 当 session_id 缺失', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/generate-brief', {})
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('bad_request')
  })

  it('400 当 session_id 是空字符串', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/generate-brief', {
      session_id: '',
    })
    expect(res.statusCode).toBe(400)
  })

  it('成功 → 200 + 写双文件 + 返回路径与时间戳', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.brief_path).toContain('technical-brief.md')
    expect(res.body.modules_path).toContain('modules.yaml')
    expect(typeof res.body.generated_at).toBe('string')
    expect(new Date(res.body.generated_at as string).toString()).not.toBe('Invalid Date')
    // 文件实际落盘
    const brief = join(root, 'requirements', 'req-001', 'analysis', 'technical-brief.md')
    const modules = join(root, 'requirements', 'req-001', 'analysis', 'modules.yaml')
    expect(existsSync(brief)).toBe(true)
    expect(existsSync(modules)).toBe(true)
    expect(readFileSync(brief, 'utf8')).toContain('# ')
    expect(readFileSync(modules, 'utf8')).toContain('modules:')
    // brief 含 4 章节
    expect(readFileSync(brief, 'utf8')).toContain('## 1. 业务背景与目标')
    expect(readFileSync(brief, 'utf8')).toContain('## 4. 风险与缓解')
    // modules 含 4 模块
    expect(readFileSync(modules, 'utf8')).toContain('m-idempotent-gateway')
    expect(readFileSync(modules, 'utf8')).toContain('m-refund-core')
    expect(readFileSync(modules, 'utf8')).toContain('m-rollback-handler')
    expect(readFileSync(modules, 'utf8')).toContain('m-notification')
  })

  it('旧版 modules.yaml 被覆盖(不保留版本号)', async () => {
    await authedJson('POST', '/api/requirements/req-002/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    await authedJson('POST', '/api/requirements/req-002/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    const modules = join(root, 'requirements', 'req-002', 'analysis', 'modules.yaml')
    // 不应存在 .v1 / .v2 备份
    expect(existsSync(join(root, 'requirements', 'req-002', 'analysis', 'modules.v1.yaml'))).toBe(
      false,
    )
    expect(existsSync(modules)).toBe(true)
  })

  it('snapshot 落盘(配置 AIDEVSPACE_SNAPSHOT_DIR 时)', async () => {
    // 首次写入(无旧版 → 不 snapshot,但创建目录)
    await authedJson('POST', '/api/requirements/req-003/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    // 第二次写入 → 旧版 snapshot 落盘
    await authedJson('POST', '/api/requirements/req-003/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    // snapshot 目录有 req-003 子目录 + 至少 1 个时间戳目录
    const reqSnapDir = join(snapshotDir, 'req-003')
    expect(existsSync(reqSnapDir)).toBe(true)
    const tsDirs = readdirSync(reqSnapDir)
    expect(tsDirs.length).toBeGreaterThanOrEqual(1)
    // 至少含 technical-brief.md 或 modules.yaml 之一
    const hasBrief = tsDirs.some((ts) =>
      existsSync(join(reqSnapDir, ts, 'technical-brief.md')),
    )
    const hasModules = tsDirs.some((ts) => existsSync(join(reqSnapDir, ts, 'modules.yaml')))
    expect(hasBrief || hasModules).toBe(true)
  })

  it('一次 generate-brief 调用:brief + modules 共享同一 ts 目录(便于原子回滚)', async () => {
    // 先预写一份 v1,触发 snapshot
    await authedJson('POST', '/api/requirements/req-bundle/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    // 再次调用 → 触发 snapshot(v1 应被快照)
    await authedJson('POST', '/api/requirements/req-bundle/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    const reqSnapDir = join(snapshotDir, 'req-bundle')
    expect(existsSync(reqSnapDir)).toBe(true)
    const tsDirs = readdirSync(reqSnapDir)
    expect(tsDirs.length).toBeGreaterThanOrEqual(1)
    // 关键断言:每个 ts 目录应同时包含 brief 与 modules(原子 snapshot bundle)
    const tsDir = tsDirs[tsDirs.length - 1]
    expect(existsSync(join(reqSnapDir, tsDir, 'technical-brief.md'))).toBe(true)
    expect(existsSync(join(reqSnapDir, tsDir, 'modules.yaml'))).toBe(true)
  })

  it('未配置 AIDEVSPACE_SNAPSHOT_DIR 时不 snapshot', async () => {
    delete process.env.AIDEVSPACE_SNAPSHOT_DIR
    const res = await authedJson('POST', '/api/requirements/req-004/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    expect(res.statusCode).toBe(200)
    // snapshot 目录不应被创建
    expect(existsSync(join(snapshotDir, 'req-004'))).toBe(false)
  })
})