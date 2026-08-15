import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { requirementRoutes } from '../routes/requirement.js'
import {
  RequirementService,
  type RequirementServiceDeps,
} from '../services/RequirementService.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import type { SseEvent } from '@ai-devspace/shared'

/**
 * requirement routes — issue 03 重写后契约(ADR-0030):
 * - `repoNames` 取代旧 `repoIds`(name 全局唯一即标识,决策 105)
 * - `codebasePath` 取代旧 `worktreePath`(`requirements/<id>/codebase/<name>/`,决策 106)
 * - 不再做 `repo-` 前缀剥除(那是旧 ADR-0016 时代的物理目录映射,issue 03 删除)
 * - base 探测取消(clone 必然带 HEAD,决策 111)—— service 默认返 'main'
 *
 * 本文件覆盖 issue 03 之前的 ticket 02 / 03 / 04 / 07a 验收 + issue 03
 * 自身契约(repoNames / codebasePath / 200 全成功 / 部分成功 / 401 / 404 / 503)。
 */

let app: FastifyInstance
let root: string
let token: string
let service: RequirementService
const serviceCalls: Array<{ reqId: string; repoNames: string[]; branchName: string }> = []

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-req-'))
  const tm = new TokenManager(root)
  token = await tm.ensure()
  // 默认 git fake:issue 03 取消 base 探测,这里只需始终返 ok 给 CodebaseManager 用
  const gitFake = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
  service = new RequirementService({
    root,
    git: gitFake as RequirementServiceDeps['git'],
    sleep: () => Promise.resolve(),
  })
  // spy attachRepos 调用
  vi.spyOn(service, 'attachRepos').mockImplementation(async (reqId, repoNames, branchName) => {
    serviceCalls.push({ reqId, repoNames: [...repoNames], branchName })
    // 默认 1 个成功;测试可覆盖返部分失败
    return [
      {
        ok: true,
        repoName: repoNames[0] ?? 'r1',
        branch: branchName,
        codebasePath: join(root, 'requirements', reqId, 'codebase', repoNames[0] ?? 'r1'),
        base: 'main',
      },
    ]
  })
  vi.spyOn(service, 'checkRequirementExists').mockImplementation(async (id) => {
    return existsSync(join(root, 'requirements', id))
  })

  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(requirementRoutes, { requirementService: service, sseHub: createSseHub() })
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
  it('GET /api/requirement/:id 缺失 req → 404 with E_REQUIREMENT_NOT_FOUND (ticket 02 实装)', async () => {
    const { statusCode, body } = await authed('GET', '/api/requirement/REFUND-001')
    expect(statusCode).toBe(404)
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
    expect(body.requirementId).toBe('REFUND-001')
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
    const res = await app.inject({ method: 'GET', url: '/api/requirement/REFUND-001' })
    expect(res.statusCode).toBe(401)
  })
})

// ============================================================================
// POST /api/requirement/:id/repos —— issue 03 codebase 真实 clone
// ============================================================================

describe('POST /api/requirement/:id/repos — codebase attach', () => {
  beforeEach(() => {
    ;(service.checkRequirementExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
  })

  it('200 全成功:1 个 repo', async () => {
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: ['refund-service'], branchName: 'feat/test' },
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
        repoName: 'r1',
        branch: 'feat/test',
        codebasePath: '/a/b/codebase/r1',
        base: 'main',
      },
      {
        ok: false,
        repoName: 'r2',
        code: 'E_DISK_FULL',
        message: 'No space left',
      },
    ])
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: ['r1', 'r2'], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(200)
    expect(body.succeeded).toBe(1)
    expect(body.failed).toBe(1)
    const results = body.results as Array<{ ok: boolean; code?: string }>
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    expect(results[1].code).toBe('E_DISK_FULL')
  })

  it('200:response 的 repoId 来自入参 repoNames(顺序对齐)', async () => {
    ;(service.attachRepos as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ok: true,
        repoName: 'r1',
        branch: 'feat/test',
        codebasePath: '/a/b/codebase/r1',
        base: 'main',
      },
      {
        ok: false,
        repoName: 'r2',
        code: 'E_REPO_NOT_FOUND',
        message: 'no .git',
      },
    ])
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: ['r1', 'r2'], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(200)
    const results = body.results as Array<{ ok: boolean; repoId: string }>
    // 路由层把入参 repoNames[idx] 回填到 result.repoId(契约:repoName 是注册表 name,
    // 路由层不剥前缀,所以二者一致)
    expect(results[0].repoId).toBe('r1')
    expect(results[1].repoId).toBe('r2')
  })

  it('400 invalid_body: repoNames 为空', async () => {
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: [], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('invalid_body')
  })

  it('400 invalid_body: missing branchName', async () => {
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: ['r1'] },
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('invalid_body')
  })

  it('含路径非法字符 \\ → strict reject(400 E_INVALID_BRANCH_NAME)', async () => {
    // ticket 02 验收 #11:Agent 端再校验一次(前端已过滤,后端兜底)
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: ['r1'], branchName: 'feat\\bad' },
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('E_INVALID_BRANCH_NAME')
    expect(body.message).toMatch(/非法字符/)
  })

  it('400 E_INVALID_BRANCH_NAME: sanitize 后为空', async () => {
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: ['r1'], branchName: '\\\\:*?"<>|' },
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('E_INVALID_BRANCH_NAME')
  })

  it('404 E_REQUIREMENT_NOT_FOUND: req 目录不存在', async () => {
    ;(service.checkRequirementExists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/missing-id/repos',
      { repoNames: ['r1'], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(404)
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
    expect(body.requirementId).toBe('missing-id')
  })

  it('issue 03:成功结果含 codebasePath(requirements/<id>/codebase/<name>/)', async () => {
    ;(service.attachRepos as ReturnType<typeof vi.fn>).mockImplementation(
      async (reqId, repoNames, branchName) => {
        serviceCalls.push({ reqId, repoNames: [...repoNames], branchName })
        return repoNames.map((n) => ({
          ok: true as const,
          repoName: n,
          branch: branchName,
          codebasePath: join(root, 'requirements', reqId, 'codebase', n),
          base: 'main' as const,
        }))
      },
    )
    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: ['yl-web-ft-export'], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(200)
    expect(serviceCalls[0]?.repoNames).toEqual(['yl-web-ft-export'])
    const results = body.results as Array<{
      ok: boolean
      repoId: string
      codebasePath: string
    }>
    expect(results[0].repoId).toBe('yl-web-ft-export')
    expect(results[0].codebasePath).toBe(
      join(root, 'requirements', 'req-001', 'codebase', 'yl-web-ft-export'),
    )
  })

  it('issue 03:失败结果(repoName)的 repoId 也 echo 回入参 repoName(不再剥 repo- 前缀)', async () => {
    ;(service.attachRepos as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ok: false,
        repoName: 'missing-repo',
        code: 'E_REPO_NOT_FOUND',
        message: 'no .git',
      },
    ])

    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-001/repos',
      { repoNames: ['missing-repo'], branchName: 'feat/test' },
    )
    expect(statusCode).toBe(200)
    const results = body.results as Array<{ repoId: string; code: string }>
    expect(results[0].repoId).toBe('missing-repo')
    expect(results[0].code).toBe('E_REPO_NOT_FOUND')
  })

  it('401 无 token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/repos',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ repoNames: ['r1'], branchName: 'feat/test' }),
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
      payload: JSON.stringify({ repoNames: ['r1'], branchName: 'feat/test' }),
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('service_not_ready')
    await altApp.close()
  })

  it('真实路径:mock codebaseMgr/workspace → 全成功,codebasePath 落到 requirements/<id>/codebase/<name>/', async () => {
    // 重置 spy —— 通过新 register,跑真实的 attachRepos(走 codebaseMgr.clone)
    await app.close()
    // 注入一个 fake workspace(注册表里有 r1)
    const fakeWorkspace = {
      findRepoByName: vi.fn(async (name: string) =>
        name === 'r1' ? { name: 'r1', gitUrl: 'git@x', description: '' } : null,
      ),
    } as unknown as ConstructorParameters<typeof RequirementService>[0]['workspace']
    // 注入一个 codebaseMgr fake —— 直接返 ok
    const fakeCodebaseMgr = {
      getCodebasePath: (reqId: string, name: string) =>
        join(root, 'requirements', reqId, 'codebase', name),
      getPendingPath: () => '',
      clone: vi.fn(async () => ({
        ok: true as const,
        path: '/a/b/codebase/r1',
        head: 'abc',
        branch: 'feat/real',
      })),
      remove: async () => undefined,
      listByRepo: async () => [],
      setPending: async () => undefined,
      clearPending: async () => undefined,
      scanOrphanedPending: async () => [],
    } as unknown as ConstructorParameters<typeof RequirementService>[0]['codebaseMgr']
    const realGit = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
    const realService = new RequirementService({
      root,
      git: realGit as RequirementServiceDeps['git'],
      codebaseMgr: fakeCodebaseMgr,
      workspace: fakeWorkspace,
      sleep: () => Promise.resolve(),
    })
    app = Fastify({ logger: false })
    const tm = new TokenManager(root)
    await tm.ensure()
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await app.register(requirementRoutes, { requirementService: realService })
    await app.ready()

    // 建 req 目录(attachRepos 校验存在)
    mkdirSync(join(root, 'requirements', 'req-real'), { recursive: true })

    const { statusCode, body } = await authed(
      'POST',
      '/api/requirement/req-real/repos',
      { repoNames: ['r1'], branchName: 'feat/real' },
    )
    expect(statusCode).toBe(200)
    expect(body.succeeded).toBe(1)
    expect(body.failed).toBe(0)
    const results = body.results as Array<{
      ok: boolean
      codebasePath?: string
      base?: string
    }>
    expect(results[0].ok).toBe(true)
    // codebasePath 来自 CodebaseManager.clone 的 path 字段(fake 返 '/a/b/codebase/r1')
    expect(results[0].codebasePath).toBe('/a/b/codebase/r1')
    expect(results[0].base).toBe('main')
    // 真实 clone 调用过 1 次
    expect((fakeCodebaseMgr.clone as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })
})

// ============================================================================
// POST /api/requirements —— ticket 04 文件落盘 + SSE 推送
// ============================================================================

interface CreateResBody {
  id: string
  title: string
  createdAt: string
}

/**
 * 重新装配 app 用于 POST /api/requirements 测试:
 * - 真实 RequirementService(不 spy createRequirement / attachRepos)
 * - 真实 SseHub(便于断言 requirement_created 事件)
 */
async function freshApp(opts?: { hub?: SseHub }): Promise<{
  app: FastifyInstance
  root: string
  token: string
  hub: SseHub
  cleanup: () => Promise<void>
}> {
  const localRoot = mkdtempSync(join(tmpdir(), 'aidevsp-create-'))
  const tm = new TokenManager(localRoot)
  const localToken = await tm.ensure()
  const realGit = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })) as RequirementServiceDeps['git']
  const realService = new RequirementService({
    root: localRoot,
    git: realGit,
    sleep: () => Promise.resolve(),
  })
  const localHub = opts?.hub ?? createSseHub()
  const localApp = Fastify({ logger: false })
  await localApp.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await localApp.register(requirementRoutes, {
    requirementService: realService,
    sseHub: localHub,
  })
  await localApp.ready()
  return {
    app: localApp,
    root: localRoot,
    token: localToken,
    hub: localHub,
    cleanup: async () => {
      try { await localApp.close() } catch { /* double-close */ }
      rmSync(localRoot, { recursive: true, force: true })
    },
  }
}

describe('POST /api/requirements — ticket 04 文件落盘', () => {
  it('201:创建成功 + 文件落盘 + meta.yaml 字段正确', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: '退款功能优化' }),
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as CreateResBody
      expect(body.id).toBe('req-001-退款功能优化')
      expect(body.title).toBe('退款功能优化')
      expect(typeof body.createdAt).toBe('string')
      expect(Number.isFinite(Date.parse(body.createdAt))).toBe(true)

      const reqDir = join(root, 'requirements', body.id)
      expect(existsSync(reqDir)).toBe(true)
      expect(existsSync(join(reqDir, 'meta.yaml'))).toBe(true)
      expect(existsSync(join(reqDir, 'requirement.md'))).toBe(true)

      const metaText = readFileSync(join(reqDir, 'meta.yaml'), 'utf8')
      expect(metaText).toContain(`id: ${body.id}`)
      expect(metaText).toContain(`title: 退款功能优化`)
      expect(metaText).toContain(`createdAt: ${body.createdAt}`)

      const reqText = readFileSync(join(reqDir, 'requirement.md'), 'utf8')
      expect(reqText).toContain('# 退款功能优化')
      expect(reqText).toContain('DRAFTING')
    } finally {
      await cleanup()
    }
  })

  it('slugify:中英混排 → 中文保留为 slug', async () => {
    const { app, token, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: 'Order Refund V2!' }),
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as CreateResBody
      expect(body.id).toBe('req-001-order-refund-v2')
    } finally {
      await cleanup()
    }
  })

  it('slugify:多个空白 + 全角空格 → 单 -', async () => {
    const { app, token, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: '  测试 / 边界  ' }),
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as CreateResBody
      expect(body.id).toBe('req-001-测试-边界')
    } finally {
      await cleanup()
    }
  })

  it('slugify:空 fallback → untitled', async () => {
    const { app, token, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: '\\:*?"<>|' }),
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as CreateResBody
      expect(body.id).toBe('req-001-untitled')
    } finally {
      await cleanup()
    }
  })

  it('slugify:trim 后 0 字 → 400 E_INVALID_TITLE', async () => {
    const { app, token, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: '   \t  ' }),
      })
      expect(res.statusCode).toBe(400)
      const body = res.json() as { error: string }
      expect(body.error).toBe('E_INVALID_TITLE')
    } finally {
      await cleanup()
    }
  })

  it('slugify:> 50 字 → 400 E_INVALID_TITLE', async () => {
    const { app, token, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: 'a'.repeat(51) }),
      })
      expect(res.statusCode).toBe(400)
      const body = res.json() as { error: string }
      expect(body.error).toBe('E_INVALID_TITLE')
    } finally {
      await cleanup()
    }
  })

  it('自增 ID:连发 3 个 → NNN = 001/002/003', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      for (let i = 1; i <= 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/requirements',
          headers: {
            'x-aidevspace-token': token,
            'content-type': 'application/json',
          },
          payload: JSON.stringify({ title: `需求 ${i}` }),
        })
        expect(res.statusCode).toBe(201)
        const body = res.json() as CreateResBody
        expect(body.id).toBe(`req-00${i}-需求-${i}`)
      }
      expect(existsSync(join(root, 'requirements', 'req-001-需求-1'))).toBe(true)
      expect(existsSync(join(root, 'requirements', 'req-002-需求-2'))).toBe(true)
      expect(existsSync(join(root, 'requirements', 'req-003-需求-3'))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('ID 冲突:已有 req-001-* → 新建自动 +1 → req-002', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      mkdirSync(join(root, 'requirements', 'req-001-退款功能'), { recursive: true })
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: '退款功能' }),
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as CreateResBody
      expect(body.id).toBe('req-002-退款功能')
    } finally {
      await cleanup()
    }
  })

  it('ID 冲突:nextRequirementId 4 次全失败 → 抛 E_ID_COLLISION', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'aidevsp-collide-'))
    try {
      const svc = new RequirementService({
        root: localRoot,
        git: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })) as RequirementServiceDeps['git'],
        sleep: () => Promise.resolve(),
      })
      mkdirSync(join(localRoot, 'requirements', 'req-001-冲突'), { recursive: true })
      mkdirSync(join(localRoot, 'requirements', 'req-002-冲突'), { recursive: true })
      mkdirSync(join(localRoot, 'requirements', 'req-003-冲突'), { recursive: true })
      mkdirSync(join(localRoot, 'requirements', 'req-004-冲突'), { recursive: true })
      expect(() => svc.nextRequirementId('冲突', 1)).toThrow(/E_ID_COLLISION|Failed to allocate/)
    } finally {
      rmSync(localRoot, { recursive: true, force: true })
    }
  })

  it('401:无 token', async () => {
    const { app, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ title: 'x' }),
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await cleanup()
    }
  })

  it('503:未注入 service', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'aidevsp-create-503-'))
    const tm = new TokenManager(localRoot)
    const localToken = await tm.ensure()
    const localApp = Fastify({ logger: false })
    await localApp.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await localApp.register(requirementRoutes)
    await localApp.ready()
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/requirements',
      headers: {
        'x-aidevspace-token': localToken,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ title: 'x' }),
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('service_not_ready')
    await localApp.close()
    rmSync(localRoot, { recursive: true, force: true })
  })

  it('SSE 推送:成功事件 → 订阅者收到 requirement_created{ok:true}', async () => {
    const hub = createSseHub()
    const { app, token, cleanup } = await freshApp({ hub })
    try {
      const received: SseEvent[] = []
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: '订阅测试' }),
      })
      const body = res.json() as CreateResBody

      const unsub = hub.subscribe(body.id, (e) => received.push(e))
      hub.publish(body.id, {
        type: 'heartbeat',
        ts: Date.now(),
      })
      unsub()
      expect(received.some((e) => e.type === 'heartbeat')).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('SSE 推送:成功事件 → 订阅者直接收到(先订阅再请求)', async () => {
    const hub = createSseHub()
    const { app, root, token, cleanup } = await freshApp({ hub })
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: '先订阅后请求' }),
      })
      const body = res.json() as CreateResBody
      const received: SseEvent[] = []
      const unsub = hub.subscribe(body.id, (e) => received.push(e))
      hub.publish(body.id, { type: 'heartbeat', ts: 1 })
      unsub()
      expect(received.some((e) => e.type === 'heartbeat')).toBe(true)
      expect(existsSync(join(root, 'requirements', body.id))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('meta.yaml 是合法 yaml 且包含 id/title/createdAt', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: 'yaml 验证' }),
      })
      const body = res.json() as CreateResBody
      const metaText = readFileSync(join(root, 'requirements', body.id, 'meta.yaml'), 'utf8')
      const yaml = await import('yaml')
      const parsed = yaml.parse(metaText) as { id: string; title: string; createdAt: string }
      expect(parsed.id).toBe(body.id)
      expect(parsed.title).toBe('yaml 验证')
      expect(parsed.createdAt).toBe(body.createdAt)
      expect((parsed as Record<string, unknown>).status).toBeUndefined()
    } finally {
      await cleanup()
    }
  })
})

// ============================================================================
// ticket 07a — GET /api/requirements(由文件系统产物目录派生)
// ============================================================================

describe('GET /api/requirements — ticket 07a list endpoint', () => {
  it('200:空目录 → requirements=[]', async () => {
    const { app, token, cleanup } = await freshApp()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { requirements: unknown[] }
      expect(body.requirements).toEqual([])
    } finally {
      await cleanup()
    }
  })

  it('200:1 个 req 无产物 → status=draft, progress=0, repos=[]', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      mkdirSync(join(root, 'requirements', 'req-001-foo'), { recursive: true })
      writeFileSync(
        join(root, 'requirements', 'req-001-foo', 'meta.yaml'),
        'id: req-001-foo\ntitle: foo\ncreatedAt: 2026-07-17T00:00:00.000Z\n',
      )
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        requirements: Array<{
          id: string
          title: string
          status: string
          progress: number
          repos: string[]
        }>
      }
      expect(body.requirements).toHaveLength(1)
      expect(body.requirements[0]).toMatchObject({
        id: 'req-001-foo',
        title: 'foo',
        status: 'draft',
        progress: 0,
        repos: [],
      })
    } finally {
      await cleanup()
    }
  })

  it('200:1 个 req 有 analysis/ → status=analyzing, progress=20', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      mkdirSync(join(root, 'requirements', 'req-001-foo'), { recursive: true })
      writeFileSync(
        join(root, 'requirements', 'req-001-foo', 'meta.yaml'),
        'id: req-001-foo\ntitle: foo\ncreatedAt: 2026-07-17T00:00:00.000Z\n',
      )
      mkdirSync(join(root, 'requirements', 'req-001-foo', 'analysis'))
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      const body = res.json() as {
        requirements: Array<{ status: string; progress: number }>
      }
      expect(body.requirements[0].status).toBe('analyzing')
      expect(body.requirements[0].progress).toBe(20)
    } finally {
      await cleanup()
    }
  })

  it('401:无 token', async () => {
    const { app, cleanup } = await freshApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/requirements' })
      expect(res.statusCode).toBe(401)
    } finally {
      await cleanup()
    }
  })

  it('503:未注入 service', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'aidevsp-list-503-'))
    const tm = new TokenManager(localRoot)
    const localToken = await tm.ensure()
    const localApp = Fastify({ logger: false })
    await localApp.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await localApp.register(requirementRoutes)
    await localApp.ready()
    const res = await localApp.inject({
      method: 'GET',
      url: '/api/requirements',
      headers: { 'x-aidevspace-token': localToken },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('service_not_ready')
    await localApp.close()
    rmSync(localRoot, { recursive: true, force: true })
  })

  it('500:service.listRequirements 抛错 → E_INTERNAL', async () => {
    const localRoot = mkdtempSync(join(tmpdir(), 'aidevsp-list-500-'))
    try {
      const tm = new TokenManager(localRoot)
      const localToken = await tm.ensure()
      const realService = new RequirementService({
        root: localRoot,
        git: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })) as RequirementServiceDeps['git'],
        sleep: () => Promise.resolve(),
      })
      vi.spyOn(realService, 'listRequirements').mockImplementation(() => {
        throw new Error('boom')
      })
      const localApp = Fastify({ logger: false })
      await localApp.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
      await localApp.register(requirementRoutes, { requirementService: realService })
      await localApp.ready()
      const res = await localApp.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': localToken },
      })
      expect(res.statusCode).toBe(500)
      expect(res.json().error).toBe('E_INTERNAL')
      await localApp.close()
    } finally {
      rmSync(localRoot, { recursive: true, force: true })
    }
  })
})

// ============================================================================
// issue 08 — deriveRepos 路径常量 repos → codebase(ADR-0030 D5 · Q11)
//
// 老 worktree 形态目录 `requirements/<id>/repos/<name>/` 保留在盘上,
// 但代码只读 `codebase/`;老形态目录即使有内容也不再被识别为"已关联仓库"。
// ============================================================================

describe('GET /api/requirements — issue 08 路径 codebase/ vs 老形态 repos/ 共存', () => {
  /** 替测试 req 写 meta.yaml,让 listRequirements 能扫到 */
  function writeReqMeta(root: string, id: string): void {
    const reqDir = join(root, 'requirements', id)
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(
      join(reqDir, 'meta.yaml'),
      `id: ${id}\ntitle: fixture\ncreatedAt: 2026-08-01T00:00:00.000Z\n`,
      'utf8',
    )
  }

  /** 在 req 下建 codebase/<name>/ 子目录(issue 03 的真实落盘形态) */
  function touchCodebase(root: string, id: string, names: string[]): void {
    for (const n of names) {
      mkdirSync(join(root, 'requirements', id, 'codebase', n), {
        recursive: true,
      })
    }
  }

  /** 在 req 下建老形态 repos/<name>/ 子目录(issue 08 前的老 worktree 形态) */
  function touchLegacyRepos(root: string, id: string, names: string[]): void {
    for (const n of names) {
      mkdirSync(join(root, 'requirements', id, 'repos', n), { recursive: true })
    }
  }

  it('issue 08:仅 codebase/foo/ 存在 → repos=[foo]', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      writeReqMeta(root, 'req-001-codebase-only')
      touchCodebase(root, 'req-001-codebase-only', ['foo'])
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      const body = res.json() as {
        requirements: Array<{ id: string; repos: string[] }>
      }
      const req = body.requirements.find((r) => r.id === 'req-001-codebase-only')
      expect(req?.repos).toEqual(['foo'])
    } finally {
      await cleanup()
    }
  })

  it('issue 08:仅老形态 repos/bar/ 存在(无 codebase)→ repos=[]', async () => {
    // 决策 Q11:老 worktree 形态目录保留在盘上但不识别;前端显示「未关联」
    const { app, root, token, cleanup } = await freshApp()
    try {
      writeReqMeta(root, 'req-002-legacy-only')
      touchLegacyRepos(root, 'req-002-legacy-only', ['bar'])
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      const body = res.json() as {
        requirements: Array<{ id: string; repos: string[] }>
      }
      const req = body.requirements.find((r) => r.id === 'req-002-legacy-only')
      expect(req?.repos).toEqual([])
    } finally {
      await cleanup()
    }
  })

  it('issue 08:codebase/foo + 老形态 repos/bar 共存 → 只返 [foo](bar 被忽略)', async () => {
    // 集成 e2e 场景:老用户升级路径 —— 老 worktree 仍在盘上,但新 attach 已落 codebase/
    const { app, root, token, cleanup } = await freshApp()
    try {
      writeReqMeta(root, 'req-003-mixed')
      touchCodebase(root, 'req-003-mixed', ['foo'])
      touchLegacyRepos(root, 'req-003-mixed', ['bar'])
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      const body = res.json() as {
        requirements: Array<{ id: string; repos: string[] }>
      }
      const req = body.requirements.find((r) => r.id === 'req-003-mixed')
      expect(req?.repos).toEqual(['foo'])
      expect(req?.repos).not.toContain('bar')
    } finally {
      await cleanup()
    }
  })

  it('issue 08:codebase/ 下 . 开头的目录被过滤(.pending- 标记)(与后端 deriveRepos 一致)', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      writeReqMeta(root, 'req-004-pending')
      touchCodebase(root, 'req-004-pending', ['valid', '.pending-stale'])
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      const body = res.json() as {
        requirements: Array<{ id: string; repos: string[] }>
      }
      const req = body.requirements.find((r) => r.id === 'req-004-pending')
      expect(req?.repos).toEqual(['valid'])
    } finally {
      await cleanup()
    }
  })

  it('issue 08:codebase/ 与 repos/ 都不存在 → repos=[]', async () => {
    const { app, root, token, cleanup } = await freshApp()
    try {
      writeReqMeta(root, 'req-005-bare')
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      const body = res.json() as {
        requirements: Array<{ id: string; repos: string[] }>
      }
      const req = body.requirements.find((r) => r.id === 'req-005-bare')
      expect(req?.repos).toEqual([])
    } finally {
      await cleanup()
    }
  })

  it('issue 08:codebase/ 下同名非目录文件(README.md)不当作仓库(防御性,与 scanLegacy 一致)', async () => {
    // code-review spec 反馈指出的轻 bug:用户可能在 codebase/ 下误放
    // README.md / .DS_Store 等文件,这些不是仓库,不应出现在 deriveRepos
    // 输出里。
    const { app, root, token, cleanup } = await freshApp()
    try {
      const id = 'req-006-non-dir-file'
      writeReqMeta(root, id)
      mkdirSync(join(root, 'requirements', id, 'codebase'), { recursive: true })
      // 真仓库
      mkdirSync(join(root, 'requirements', id, 'codebase', 'real-repo'), {
        recursive: true,
      })
      // 非目录同名文件(误放)
      writeFileSync(
        join(root, 'requirements', id, 'codebase', 'README.md'),
        'fake',
        'utf8',
      )
      const res = await app.inject({
        method: 'GET',
        url: '/api/requirements',
        headers: { 'x-aidevspace-token': token },
      })
      const body = res.json() as {
        requirements: Array<{ id: string; repos: string[] }>
      }
      const req = body.requirements.find((r) => r.id === id)
      expect(req?.repos).toEqual(['real-repo'])
      expect(req?.repos).not.toContain('README.md')
    } finally {
      await cleanup()
    }
  })
})

// ============================================================================
// ticket 07a — POST /api/requirements 双推 SSE(全局 + per-req)
// ============================================================================

describe('POST /api/requirements — ticket 07a SSE 双推(per-req + global)', () => {
  it('成功时双推:per-req 通道 + 全局 requirements 通道都收到 requirement_created', async () => {
    const hub = createSseHub()
    const { app, token, cleanup } = await freshApp({ hub })
    try {
      const perReqReceived: SseEvent[] = []
      const globalReceived: SseEvent[] = []
      const unsubGlobal = hub.subscribe('requirements', (e) => globalReceived.push(e))

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ title: '双推测试' }),
      })
      const body = res.json() as CreateResBody

      const unsubPerReq = hub.subscribe(body.id, (e) => perReqReceived.push(e))
      hub.publish(body.id, { type: 'heartbeat', ts: 1 })
      unsubPerReq()

      unsubGlobal()

      expect(perReqReceived.some((e) => e.type === 'heartbeat')).toBe(true)

      expect(globalReceived.some((e) => e.type === 'requirement_created')).toBe(true)
      const ev = globalReceived.find((e) => e.type === 'requirement_created')
      expect(ev).toBeDefined()
      if (ev && ev.type === 'requirement_created') {
        expect(ev.reqId).toBe(body.id)
        expect(ev.ok).toBe(true)
      }
    } finally {
      await cleanup()
    }
  })
})