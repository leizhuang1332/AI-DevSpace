/**
 * Unit + e2e tests for GET /api/repos(issue 06 / ADR-0016)
 *
 * 覆盖验收清单(issue 06 ticket):
 * - 目录不存在(全新安装)→ 200 `{repos: []}`(决策 78)
 * - 目录存在但空 → 200 `{repos: []}`
 * - 目录存在且有子目录 → 子目录名映射成 `{id: 'repo-<name>', name: '<name>'}`
 *   按 name 字典序排序
 *
 * 同样覆盖纯函数 `readRepoPool`(无需启 server),便于快速迭代。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { buildServer } from '../server.js'
import { readRepoPool } from '../routes/repos.js'

// ---------------------------------------------------------------------------
// 纯函数 readRepoPool —— 不启 server,直接测扫描 + 排序逻辑
// ---------------------------------------------------------------------------

describe('readRepoPool (pure)', () => {
  let tmpRoot: string
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-readrepopool-'))
    // 模拟 WorkspaceService.initWorkspace 创建的 repos/ 目录
    mkdirSync(join(tmpRoot, 'repos'))
  })
  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('目录不存在 → 抛 ENOENT(由 route 层捕获并返空)', () => {
    const otherRoot = mkdtempSync(join(tmpdir(), 'aidev-norepos-'))
    try {
      expect(() => readRepoPool(otherRoot)).toThrow(/ENOENT/)
    } finally {
      rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  it('目录存在但空 → 空数组', () => {
    expect(readRepoPool(tmpRoot)).toEqual([])
  })

  it('子目录 → 映射成 {id: "repo-<name>", name: "<name>"}', () => {
    mkdirSync(join(tmpRoot, 'repos', 'refund-service'))
    mkdirSync(join(tmpRoot, 'repos', 'order-service'))
    mkdirSync(join(tmpRoot, 'repos', 'coupon-service'))
    const pool = readRepoPool(tmpRoot)
    // 不关心顺序(后续断言 sort)
    const ids = pool.map((p) => p.id).sort()
    expect(ids).toEqual([
      'repo-coupon-service',
      'repo-order-service',
      'repo-refund-service',
    ])
  })

  it('按 name 字典序排序(展示稳定)', () => {
    mkdirSync(join(tmpRoot, 'repos', 'zeta'))
    mkdirSync(join(tmpRoot, 'repos', 'alpha'))
    mkdirSync(join(tmpRoot, 'repos', 'mu'))
    const pool = readRepoPool(tmpRoot)
    expect(pool.map((p) => p.name)).toEqual(['alpha', 'mu', 'zeta'])
  })

  it('忽略文件(只收目录)', () => {
    mkdirSync(join(tmpRoot, 'repos', 'real-repo'))
    // 故意在 repos/ 里放一个文件 —— 不应出现在池中
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    writeFileSync(join(tmpRoot, 'repos', 'stray.txt'), 'noise')
    const pool = readRepoPool(tmpRoot)
    expect(pool.map((p) => p.name)).toEqual(['real-repo'])
  })
})

// ---------------------------------------------------------------------------
// HTTP route:GET /api/repos —— 通过 buildServer + inject 验证三种情形
// ---------------------------------------------------------------------------

describe('GET /api/repos (issue 06)', () => {
  let tmpRoot: string
  let app: Awaited<ReturnType<typeof buildServer>>
  let token: string

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-reposroute-'))
    process.env.AIDEVSPACE_HOME = tmpRoot
    app = await buildServer()
    await app.ready()
    token = readFileSync(join(tmpRoot, '.agent-token'), 'utf8')
  })

  afterEach(async () => {
    delete process.env.AIDEVSPACE_HOME
    if (app) await app.close()
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
  })

  function authHeaders(): Record<string, string> {
    return { 'x-aidevspace-token': token }
  }

  it('全新安装(repos 目录不存在)→ 200 {repos: []},不报错', async () => {
    // buildServer initWorkspace 已创建 repos/ 目录 → 先删掉模拟"全新安装但未初始化"场景
    // 实际 initWorkspace 会创建空目录;为真正测 ENOENT 路径,直接删掉
    rmSync(join(tmpRoot, 'repos'), { recursive: true, force: true })

    const res = await app.inject({
      method: 'GET',
      url: '/api/repos',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ repos: [] })
  })

  it('repos 目录存在但空(默认 initWorkspace 后)→ 200 {repos: []}', async () => {
    // initWorkspace 已经创建了空 repos/ 目录,直接请求即可
    const res = await app.inject({
      method: 'GET',
      url: '/api/repos',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ repos: [] })
  })

  it('repos 目录有子目录 → 子目录名映射成 {id: "repo-<name>", name: "<name>"},按字典序', async () => {
    // 先建立几个子目录(按非字典序,确保排序生效)
    mkdirSync(join(tmpRoot, 'repos', 'foo'))
    mkdirSync(join(tmpRoot, 'repos', 'baz'))
    mkdirSync(join(tmpRoot, 'repos', 'bar'))

    const res = await app.inject({
      method: 'GET',
      url: '/api/repos',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { repos: Array<{ id: string; name: string }> }
    expect(body.repos.map((r) => r.name)).toEqual(['bar', 'baz', 'foo'])
    expect(body.repos).toEqual([
      { id: 'repo-bar', name: 'bar' },
      { id: 'repo-baz', name: 'baz' },
      { id: 'repo-foo', name: 'foo' },
    ])
  })

  it('响应 schema 严格符合 ReposResponseSchema(id + name 都 ≥ 1 字符)', async () => {
    mkdirSync(join(tmpRoot, 'repos', 'refund-service'))
    const res = await app.inject({
      method: 'GET',
      url: '/api/repos',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // 字段最小集:只有 repos[].id / repos[].name
    expect(Object.keys(body).sort()).toEqual(['repos'])
    expect(Object.keys(body.repos[0]).sort()).toEqual(['id', 'name'])
  })

  it('鉴权失败:无 token → 401(authPlugin 拦截,本端点鉴权前置于业务逻辑)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/repos',
    })
    expect(res.statusCode).toBe(401)
  })
})