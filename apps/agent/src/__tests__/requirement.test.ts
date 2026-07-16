import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { requirementRoutes } from '../routes/requirement.js'
import {
  RequirementService,
  type RequirementServiceDeps,
} from '../services/RequirementService.js'

let app: FastifyInstance
let root: string
let token: string
let service: RequirementService
const serviceCalls: Array<{ reqId: string; repoIds: string[]; branchName: string }> = []

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-req-'))
  const tm = new TokenManager(root)
  token = await tm.ensure()
  // 默认 git fake: show-ref refs/heads/main 成功 → base=main
  const gitFake = vi.fn(async (args: string[]) => {
    if (args.includes('show-ref') && args.includes('refs/heads/main')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  })
  service = new RequirementService({
    root,
    git: gitFake as RequirementServiceDeps['git'],
    sleep: () => Promise.resolve(),
  })
  // spy attachRepos 调用
  const origAttach = service.attachRepos.bind(service)
  vi.spyOn(service, 'attachRepos').mockImplementation(async (reqId, repoIds, branchName) => {
    serviceCalls.push({ reqId, repoIds: [...repoIds], branchName })
    // 默认 1 个成功 + 1 个失败,允许 per-test 覆盖
    return [
      {
        ok: true,
        repoId: repoIds[0] ?? 'r1',
        branch: branchName,
        worktreePath: join(root, 'requirements', reqId, 'repos', repoIds[0] ?? 'r1'),
        base: 'main',
      },
    ]
  })
  vi.spyOn(service, 'checkRequirementExists').mockImplementation(async (id) => {
    // 默认 true,允许 per-test 覆盖
    return existsSync(join(root, 'requirements', id))
  })

  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(requirementRoutes, { requirementService: service })
  await app.ready()
  serviceCalls.length = 0
})

afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function authed(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  body?: unknown,
): Promise<{
  statusCode: number
  body: Record<string, unknown>
}> {
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-aidevspace-token': token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
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

// ============================================================================
// POST /api/requirement/:id/repos —— ticket 02 worktree 创建
// ============================================================================

describe('POST /api/requirement/:id/repos — worktree attach', () => {
  beforeEach(() => {
    // 让 checkRequirementExists 默认通过
    ;(service.checkRequirementExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
  })

  it('200 全成功:1 个 repo', async () => {
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoIds: ['refund-service'], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(200)
    expect(body).toMatchObject({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 1,
      failed: 0,
    })
    expect((body.results as unknown[]).length).toBe(1)
    expect((body.results as Array<{ ok: boolean }>)[0].ok).toBe(true)
  })

  it('200 部分成功:1 个 ok + 1 个失败', async () => {
    ;(service.attachRepos as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ok: true,
        repoId: 'r1',
        branch: 'feat/test',
        worktreePath: '/a/b/r1',
        base: 'main',
      },
      {
        ok: false,
        repoId: 'r2',
        code: 'E_DISK_FULL',
        message: 'No space left',
      },
    ])
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoIds: ['r1', 'r2'], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(200)
    expect(body.succeeded).toBe(1)
    expect(body.failed).toBe(1)
    const results = body.results as Array<{ ok: boolean; code?: string }>
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    expect(results[1].code).toBe('E_DISK_FULL')
  })

  it('400 invalid_body: repoIds 为空', async () => {
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoIds: [], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('invalid_body')
  })

  it('400 invalid_body: missing branchName', async () => {
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoIds: ['r1'] },
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('invalid_body')
  })

  it('含路径非法字符 \\ → strict reject(400 E_INVALID_BRANCH_NAME)', async () => {
    // ticket 02 验收 #11:Agent 端再校验一次(前端已过滤,后端兜底)
    // strict 模式:含任何非法字符即 reject,即使 strip 后仍合法也不算通过
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoIds: ['r1'], branchName: 'feat\\bad' },
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('E_INVALID_BRANCH_NAME')
    expect(body.message).toMatch(/非法字符/)
  })

  it('400 E_INVALID_BRANCH_NAME: sanitize 后为空', async () => {
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoIds: ['r1'], branchName: '\\\\:*?"<>|' },
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('E_INVALID_BRANCH_NAME')
  })

  it('404 E_REQUIREMENT_NOT_FOUND: req 目录不存在', async () => {
    ;(service.checkRequirementExists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/missing-id/repos',
      { repoIds: ['r1'], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(404)
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
    expect(body.requirementId).toBe('missing-id')
  })

  it('401 无 token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/repos',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ repoIds: ['r1'], branchName: 'feat/test' }),
    })
    expect(res.statusCode).toBe(401)
  })

  it('503 service_not_ready:未注入 service 时', async () => {
    const altApp = Fastify({ logger: false })
    const altTm = new TokenManager(root)
    const altToken = await altTm.ensure()
    await altApp.register(authPlugin, {
      tokenManager: altTm,
      allowedOrigins: [],
    })
    await altApp.register(requirementRoutes) // 无 deps
    await altApp.ready()
    const res = await altApp.inject({
      method: 'POST',
      url: '/api/requirement/req-001/repos',
      headers: {
        'x-aidevspace-token': altToken,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ repoIds: ['r1'], branchName: 'feat/test' }),
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('service_not_ready')
    await altApp.close()
  })

  it('真实路径:makePoolRepo + makeRequirementDir → 全成功', async () => {
    // 重置 spy —— 通过新 register
    await app.close()
    const realGit = vi.fn(async (args: string[]) => {
      if (args.includes('show-ref') && args.includes('refs/heads/main')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const realService = new RequirementService({
      root,
      git: realGit as RequirementServiceDeps['git'],
      sleep: () => Promise.resolve(),
    })
    app = Fastify({ logger: false })
    const tm = new TokenManager(root)
    await tm.ensure()
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await app.register(requirementRoutes, { requirementService: realService })
    await app.ready()

    // 创建 pool repo + req 目录
    mkdirSync(join(root, 'repos', 'r1', '.git'), { recursive: true })
    mkdirSync(join(root, 'requirements', 'req-real'), { recursive: true })

    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-real/repos',
      { repoIds: ['r1'], branchName: 'feat/real' },
    )
    expect(statusCode).toBe(200)
    expect(body.succeeded).toBe(1)
    expect(body.failed).toBe(0)
    const results = body.results as Array<{ ok: boolean; worktreePath?: string; base?: string }>
    expect(results[0].ok).toBe(true)
    expect(results[0].worktreePath).toBe(join(root, 'requirements', 'req-real', 'repos', 'r1'))
    expect(results[0].base).toBe('main')
  })
})
