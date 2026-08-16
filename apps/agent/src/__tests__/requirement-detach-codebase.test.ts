/**
 * ADR-0034 —— 需求级 codebase detach 测试
 *
 * 双层覆盖(决策 Q9):
 * - 第一层:`RequirementService.detachRepo` service 单测(真 fs,不真 clone)
 * - 第二层:`HTTP DELETE /api/requirement/:id/codebase/:name` fastify.inject 集成
 *
 * 镜像样板:
 * - `requirement.test.ts:1-93`(fixture 模板 + authed helper)
 * - `repos-route.test.ts:617-747`(DELETE handler 测试结构)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'yaml'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { requirementRoutes } from '../routes/requirement.js'
import {
  RequirementService,
  type RequirementServiceDeps,
} from '../services/RequirementService.js'
import { createSseHub } from '../sse/SseHub.js'

// ---------------------------------------------------------------------------
// 共用 fixture
// ---------------------------------------------------------------------------

let app: FastifyInstance
let root: string
let token: string
let service: RequirementService

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-detach-'))
  const tm = new TokenManager(root)
  token = await tm.ensure()
  const gitFake = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
  service = new RequirementService({
    root,
    git: gitFake as RequirementServiceDeps['git'],
    sleep: () => Promise.resolve(),
  })

  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(requirementRoutes, {
    requirementService: service,
    sseHub: createSseHub(),
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function authed(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-aidevspace-token': token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  // 204 / 205 无 body —— 不能 res.json(),会抛 Unexpected end of JSON input
  if (res.statusCode === 204 || res.statusCode === 205) {
    return { statusCode: res.statusCode, body: {} }
  }
  return { statusCode: res.statusCode, body: res.json() }
}

// ---------------------------------------------------------------------------
// fixture helper:准备一个 DRAFTING req + N 个空 codebase/<name>/
// ---------------------------------------------------------------------------

function createReqWithCodebases(
  reqId: string,
  repoNames: readonly string[],
  opts: { branchName?: string; status?: 'drafting' | 'analyzing' } = {},
): void {
  const reqDir = join(root, 'requirements', reqId)
  mkdirSync(reqDir, { recursive: true, mode: 0o700 })
  // meta.yaml(branchName 可选)
  const meta: Record<string, unknown> = {
    id: reqId,
    title: reqId,
    createdAt: new Date().toISOString(),
  }
  if (opts.branchName) meta.branchName = opts.branchName
  writeFileSync(join(reqDir, 'meta.yaml'), yaml.stringify(meta), { mode: 0o600 })
  // requirement.md(决定 status='drafting' 的关键)
  if (opts.status === 'analyzing') {
    // 用 analysis/ 子目录触发 analyzing 派生
    mkdirSync(join(reqDir, 'analysis'), { recursive: true })
  }
  if (opts.status !== 'analyzing') {
    // drafting:requirement.md 存在且 > 10 字节
    writeFileSync(
      join(reqDir, 'requirement.md'),
      '# test\n\n足够长的 requirement.md 内容使 DRAFTING 阈值通过。\n',
      'utf8',
    )
  }
  // codebase/<name>/
  for (const name of repoNames) {
    mkdirSync(join(reqDir, 'codebase', name), { recursive: true })
    // 留个文件让 rm 有内容可清(safeRm 验证)
    writeFileSync(
      join(reqDir, 'codebase', name, 'README.md'),
      'fake codebase for testing detach\n',
      'utf8',
    )
  }
}

// ===========================================================================
// Layer 1 —— RequirementService.detachRepo service 单测
// ===========================================================================

describe('RequirementService.detachRepo (ADR-0034)', () => {
  it('happy path:detach 单 repo 后 codebase/<name>/ 目录消失', async () => {
    const reqId = 'req-001-detach-happy'
    createReqWithCodebases(reqId, ['multica', 'spma'], { branchName: 'feat/x' })

    const result = await service.detachRepo(reqId, 'multica')

    expect(result.ok).toBe(true)
    expect(result.repoName).toBe('multica')
    expect(result.remainingRepos).toEqual(['spma'])
    expect(existsSync(join(root, 'requirements', reqId, 'codebase', 'multica'))).toBe(
      false,
    )
    expect(existsSync(join(root, 'requirements', reqId, 'codebase', 'spma'))).toBe(true)
  })

  it('N=1→0:meta.yaml::branchName 被清空', async () => {
    const reqId = 'req-002-detach-last'
    createReqWithCodebases(reqId, ['only-one'], { branchName: 'feat/last' })

    const result = await service.detachRepo(reqId, 'only-one')

    expect(result.ok).toBe(true)
    expect(result.remainingRepos).toEqual([])
    // meta.yaml 已被写,branchName 字段应被清成空串
    const metaRaw = readFileSync(
      join(root, 'requirements', reqId, 'meta.yaml'),
      'utf8',
    )
    const parsed = yaml.parse(metaRaw) as { branchName?: string }
    // branchName 字段可能不存在(完全删)或为空串 —— persistBranchName 现有实现
    // 是 spread + 覆盖空串,所以会是 ''(行为按现有 attachRepos 同款)
    expect(parsed.branchName ?? '').toBe('')
  })

  it('N=2→1:meta.yaml::branchName 保留(还有其他 repo 共享)', async () => {
    const reqId = 'req-003-detach-mid'
    createReqWithCodebases(reqId, ['a', 'b'], { branchName: 'feat/shared' })

    const result = await service.detachRepo(reqId, 'a')

    expect(result.ok).toBe(true)
    expect(result.remainingRepos).toEqual(['b'])
    const metaRaw = readFileSync(
      join(root, 'requirements', reqId, 'meta.yaml'),
      'utf8',
    )
    const parsed = yaml.parse(metaRaw) as { branchName?: string }
    expect(parsed.branchName).toBe('feat/shared')
  })

  it('req 不存在:返回 E_REQUIREMENT_NOT_FOUND,不动 fs', async () => {
    const result = await service.detachRepo('req-999-missing', 'foo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe('E_REQUIREMENT_NOT_FOUND')
    expect(result.message).toContain('req-999-missing')
    expect(existsSync(join(root, 'requirements', 'req-999-missing'))).toBe(false)
  })

  it('req 状态为 analyzing:返回 E_REQUIREMENT_NOT_DRAFTING,不动 fs', async () => {
    const reqId = 'req-004-analyzing'
    createReqWithCodebases(reqId, ['x'], {
      branchName: 'feat/y',
      status: 'analyzing',
    })

    const result = await service.detachRepo(reqId, 'x')

    expect(result.ok).toBe(false)
    expect(result.code).toBe('E_REQUIREMENT_NOT_DRAFTING')
    expect(result.message).toContain('analyzing')
    // 状态门禁 — codebase/ 必须保留(Q2)
    expect(existsSync(join(root, 'requirements', reqId, 'codebase', 'x'))).toBe(
      true,
    )
    // meta.yaml::branchName 也必须保留(没碰 meta.yaml)
    const metaRaw = readFileSync(
      join(root, 'requirements', reqId, 'meta.yaml'),
      'utf8',
    )
    const parsed = yaml.parse(metaRaw) as { branchName?: string }
    expect(parsed.branchName).toBe('feat/y')
  })

  it('codebase/<name>/ 不存在:返回 E_CODEBASE_NOT_FOUND,不动 fs', async () => {
    const reqId = 'req-005-no-codebase'
    // 创建 req 但不带 codebase/<name>/
    createReqWithCodebases(reqId, [], { branchName: 'feat/z' })

    const result = await service.detachRepo(reqId, 'ghost-repo')

    expect(result.ok).toBe(false)
    expect(result.code).toBe('E_CODEBASE_NOT_FOUND')
    expect(existsSync(join(root, 'requirements', reqId, 'meta.yaml'))).toBe(true)
  })

  it('并发:同 req 内 attach + detach 串行执行(锁起作用)', async () => {
    const reqId = 'req-006-concurrent'
    createReqWithCodebases(reqId, ['a'], { branchName: 'feat/race' })

    // 用 flag 跟踪"是否在持锁 body 内";任意时刻只能有一个为 true。
    let detachInside = false
    let attachInside = false
    const overlaps: string[] = []

    // 给 codebaseMgr.remove 加 padding,让 detach 持锁更长时间,便于观察交错
    const origRemove = service['codebaseMgr'].remove.bind(service['codebaseMgr'])
    vi.spyOn(service['codebaseMgr'], 'remove').mockImplementation(
      async (rId, rName) => {
        detachInside = true
        if (attachInside) overlaps.push('detach-overlaps-attach')
        await new Promise((r) => setTimeout(r, 20)) // 让 attach 有机会排队
        try {
          return await origRemove(rId, rName)
        } finally {
          detachInside = false
        }
      },
    )

    // 模拟 attach inner body 也走相同 flag
    vi.spyOn(service, '_attachRepoInner').mockImplementation(
      async (rid, name, _branch) => {
        attachInside = true
        if (detachInside) overlaps.push('attach-overlaps-detach')
        await new Promise((r) => setTimeout(r, 5))
        try {
          return {
            ok: true,
            repoName: name,
            branch: 'feat/race',
            codebasePath: join(root, 'requirements', rid, 'codebase', name),
            base: 'main',
          }
        } finally {
          attachInside = false
        }
      },
    )

    // 同时启动 detach + attach
    await Promise.all([
      service.detachRepo(reqId, 'a'),
      service.attachRepo(reqId, 'b', 'feat/race'),
    ])

    // 关键断言:任一时刻 detachInside 与 attachInside 不能同时为 true
    expect(overlaps).toEqual([])

    // 验证最终状态
    expect(detachInside).toBe(false)
    expect(attachInside).toBe(false)
  })

  it('codebaseMgr.remove 抛错时:错误传到 caller,meta.yaml 未触', async () => {
    const reqId = 'req-007-rm-fail'
    createReqWithCodebases(reqId, ['doomed'], { branchName: 'feat/doom' })

    // 强制 codebaseMgr.remove 抛错
    vi.spyOn(service['codebaseMgr'], 'remove').mockImplementation(async () => {
      throw new Error('safeRm failed: EBUSY')
    })

    await expect(service.detachRepo(reqId, 'doomed')).rejects.toThrow(
      'safeRm failed: EBUSY',
    )

    // meta.yaml 不应被改:branchName 仍在
    const metaRaw = readFileSync(
      join(root, 'requirements', reqId, 'meta.yaml'),
      'utf8',
    )
    const parsed = yaml.parse(metaRaw) as { branchName?: string }
    expect(parsed.branchName).toBe('feat/doom')
    // codebase 目录仍在(rm 失败,未被删)
    expect(existsSync(join(root, 'requirements', reqId, 'codebase', 'doomed'))).toBe(
      true,
    )
  })
})

// ===========================================================================
// Layer 2 —— HTTP DELETE /api/requirement/:id/codebase/:name 集成
// ===========================================================================

describe('HTTP DELETE /api/requirement/:id/codebase/:name (ADR-0034)', () => {
  it('未带 token → 401', async () => {
    const reqId = 'req-008-no-auth'
    createReqWithCodebases(reqId, ['x'], { branchName: 'feat/x' })

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/${reqId}/codebase/x`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('happy path → 204 No Content;codebase 目录消失', async () => {
    const reqId = 'req-009-http-happy'
    createReqWithCodebases(reqId, ['a', 'b'], { branchName: 'feat/happy' })

    const { statusCode, body } = await authed(
      'DELETE',
      `/api/requirement/${reqId}/codebase/a`,
    )

    expect(statusCode).toBe(204)
    expect(body).toEqual({}) // 204 不带 body
    expect(existsSync(join(root, 'requirements', reqId, 'codebase', 'a'))).toBe(
      false,
    )
    expect(existsSync(join(root, 'requirements', reqId, 'codebase', 'b'))).toBe(true)
  })

  it('req 不存在 → 404 E_REQUIREMENT_NOT_FOUND', async () => {
    const { statusCode, body } = await authed(
      'DELETE',
      '/api/requirement/req-010-missing/codebase/foo',
    )
    expect(statusCode).toBe(404)
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
    expect(body.requirementId).toBe('req-010-missing')
  })

  it('req 非 drafting → 409 E_REQUIREMENT_NOT_DRAFTING', async () => {
    const reqId = 'req-011-analyzing'
    createReqWithCodebases(reqId, ['y'], {
      branchName: 'feat/y',
      status: 'analyzing',
    })

    const { statusCode, body } = await authed(
      'DELETE',
      `/api/requirement/${reqId}/codebase/y`,
    )
    expect(statusCode).toBe(409)
    expect(body.error).toBe('E_REQUIREMENT_NOT_DRAFTING')
  })

  it('codebase 不存在 → 404 E_CODEBASE_NOT_FOUND', async () => {
    const reqId = 'req-012-no-codebase'
    createReqWithCodebases(reqId, [], { branchName: 'feat/none' })

    const { statusCode, body } = await authed(
      'DELETE',
      `/api/requirement/${reqId}/codebase/ghost`,
    )
    expect(statusCode).toBe(404)
    expect(body.error).toBe('E_CODEBASE_NOT_FOUND')
  })

  it('name 含 "/" → 400 E_INVALID_REPO_NAME', async () => {
    const reqId = 'req-013-slash'
    createReqWithCodebases(reqId, ['ok'], { branchName: 'feat/x' })

    const { statusCode, body } = await authed(
      'DELETE',
      `/api/requirement/${reqId}/codebase/${encodeURIComponent('evil/path')}`,
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('E_INVALID_REPO_NAME')
  })

  it('name 含 ".." 被 Fastify URL 规范化先吃掉,返 404', async () => {
    // 说明:`..` 由 Fastify(find-my-way)在路由层 URL 规范化时被吃掉,
    // 路径解析后变成 `/api/requirement/<reqId>`,不匹配本路由模式 → 404。
    // 这是 Fastify 自身的路径穿越防御,与 handler 内的 `..` 校验是双层防御;
    // handler 校验仍覆盖 service-direct 调用路径(测试在 service 单测覆盖)。
    const reqId = 'req-014-dotdot'
    createReqWithCodebases(reqId, ['ok'], { branchName: 'feat/x' })

    const { statusCode } = await authed(
      'DELETE',
      `/api/requirement/${reqId}/codebase/${encodeURIComponent('..')}`,
    )
    expect(statusCode).toBe(404)
  })

  it('name 含 "\\" → 400 E_INVALID_REPO_NAME', async () => {
    const reqId = 'req-014b-backslash'
    createReqWithCodebases(reqId, ['ok'], { branchName: 'feat/x' })

    // 反斜杠走 %5C URL 编码;Fastify 不会规范化反斜杠,会解码后传给 handler
    const { statusCode, body } = await authed(
      'DELETE',
      `/api/requirement/${reqId}/codebase/${encodeURIComponent('foo\\bar')}`,
    )
    expect(statusCode).toBe(400)
    expect(body.error).toBe('E_INVALID_REPO_NAME')
  })

  it('codebaseMgr.remove 抛错 → 500 E_INTERNAL', async () => {
    const reqId = 'req-015-rm-fail-http'
    createReqWithCodebases(reqId, ['bad'], { branchName: 'feat/x' })

    vi.spyOn(service['codebaseMgr'], 'remove').mockImplementation(async () => {
      throw new Error('safeRm failed: simulated fd race')
    })

    const { statusCode, body } = await authed(
      'DELETE',
      `/api/requirement/${reqId}/codebase/bad`,
    )
    expect(statusCode).toBe(500)
    expect(body.error).toBe('E_INTERNAL')
    expect(String(body.message)).toContain('safeRm failed')
  })
})