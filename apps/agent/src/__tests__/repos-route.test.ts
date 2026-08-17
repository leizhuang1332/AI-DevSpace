/**
 * Unit + e2e tests for /api/repos CRUD(issue 02 · ADR-0030 D1 / D6 / D8)
 *
 * 覆盖验收清单(issue 02 ticket):
 * - GET 200 {repos: [{name, gitUrl, description}]},无 id 字段(FR-1.2)
 * - POST 必跑 ls-remote;网络错返 401/502/408(不写 yaml);name 重复返 409
 * - PUT 改 gitUrl 必跑 ls-remote;不改 gitUrl 不跑
 * - DELETE 被使用未带 force 返 409;带 force 删除;**不** rm 任何 codebase/
 *
 * 同样覆盖 service 层 (WorkspaceService.readRepoRegistry/findRepoByName/addRepo/
 * updateRepo/removeRepo/findCodebaseUsage) —— 不必启 server。
 *
 * 测试 seam:buildServer + app.inject(端到端),WorkspaceService 公共方法(纯函数)。
 *
 * ls-remote mock:route 通过 deps.git 注入 fakeGitExec;按 (args) → (code, stderr)
 * 映射实现"成功 / 鉴权错 / 网络错"三分桶。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'yaml'
import { buildServer } from '../server.js'
import type { GitExec } from '../codebase/CodebaseManager.js'
import {
  WorkspaceService,
  RegistryConflictError,
  RegistryNotFoundError,
} from '../services/WorkspaceService.js'

// ---------------------------------------------------------------------------
// WorkspaceService 纯函数层测试 —— 不启 server
// ---------------------------------------------------------------------------

describe('WorkspaceService · RepoRegistry CRUD', () => {
  let tmpRoot: string
  let svc: WorkspaceService

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-ws-rr-'))
    svc = WorkspaceService.singleRoot(tmpRoot)
  })
  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('readRepoRegistry: 文件不存在 → 返空注册表(全新安装合法态)', async () => {
    const reg = await svc.readRepoRegistry()
    expect(reg).toEqual({ version: 1, repos: [] })
  })

  it('readRepoRegistry: 空文件 → 返空注册表', async () => {
    writeFileSync(svc.repoRegistryPath, '', 'utf8')
    const reg = await svc.readRepoRegistry()
    expect(reg).toEqual({ version: 1, repos: [] })
  })

  it('readRepoRegistry: 含注释的 yaml → 返空注册表', async () => {
    writeFileSync(svc.repoRegistryPath, '# only comment\n', 'utf8')
    const reg = await svc.readRepoRegistry()
    expect(reg).toEqual({ version: 1, repos: [] })
  })

  it('readRepoRegistry: 多余字段默认 strip(name + gitUrl + description 三字段齐全即可)', async () => {
    // FR-1.2 平滑吃下历史 yaml 残留的 id / defaultBranch
    writeFileSync(
      svc.repoRegistryPath,
      yaml.stringify({
        version: 1,
        repos: [
          {
            name: 'refund-service',
            gitUrl: 'git@github.com:co/refund.git',
            description: '退款',
            id: 'repo-refund-service',
            defaultBranch: 'main',
          },
        ],
      }),
      'utf8',
    )
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toHaveLength(1)
    expect(reg.repos[0]).toEqual({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund.git',
      description: '退款',
    })
  })

  it('findRepoByName: 存在 → 返条目;不存在 → 返 null', async () => {
    await svc.addRepo({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund.git',
      description: '退款',
    })
    expect(await svc.findRepoByName('refund-service')).toEqual({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund.git',
      description: '退款',
    })
    expect(await svc.findRepoByName('nope')).toBeNull()
  })

  it('addRepo: 追加到尾部', async () => {
    await svc.addRepo({
      name: 'a',
      gitUrl: 'git@a',
      description: 'a',
    })
    await svc.addRepo({
      name: 'b',
      gitUrl: 'git@b',
      description: 'b',
    })
    const reg = await svc.readRepoRegistry()
    expect(reg.repos.map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('addRepo: name 重复 → 抛 RegistryConflictError(E_REPO_NAME_EXISTS)', async () => {
    await svc.addRepo({
      name: 'dup',
      gitUrl: 'git@x',
      description: 'x',
    })
    await expect(
      svc.addRepo({ name: 'dup', gitUrl: 'git@y', description: 'y' }),
    ).rejects.toBeInstanceOf(RegistryConflictError)
  })

  it('updateRepo: 只改 description 时不动 gitUrl', async () => {
    await svc.addRepo({
      name: 'refund',
      gitUrl: 'git@orig',
      description: 'orig',
    })
    const next = await svc.updateRepo('refund', { description: 'new desc' })
    expect(next).toEqual({
      name: 'refund',
      gitUrl: 'git@orig',
      description: 'new desc',
    })
  })

  it('updateRepo: 同时改 gitUrl + description 一起生效', async () => {
    await svc.addRepo({
      name: 'refund',
      gitUrl: 'git@orig',
      description: 'orig',
    })
    const next = await svc.updateRepo('refund', {
      gitUrl: 'git@new',
      description: 'new',
    })
    expect(next).toEqual({
      name: 'refund',
      gitUrl: 'git@new',
      description: 'new',
    })
  })

  it('updateRepo: name 不存在 → 抛 RegistryNotFoundError(E_REPO_NOT_FOUND)', async () => {
    await expect(
      svc.updateRepo('nope', { description: 'x' }),
    ).rejects.toBeInstanceOf(RegistryNotFoundError)
  })

  it('removeRepo: 删 + 文件中确实不存在', async () => {
    await svc.addRepo({
      name: 'temp',
      gitUrl: 'git@t',
      description: 't',
    })
    await svc.removeRepo('temp')
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toEqual([])
  })

  it('removeRepo: name 不存在 → 抛 RegistryNotFoundError', async () => {
    await expect(svc.removeRepo('nope')).rejects.toBeInstanceOf(
      RegistryNotFoundError,
    )
  })

  it('findCodebaseUsage: 扫 requirements/<id>/codebase/<name>/ 子目录', async () => {
    // 模拟 2 个需求:req-001 已 clone,req-002 没 clone
    mkdirSync(join(tmpRoot, 'requirements', 'req-001', 'codebase', 'refund'), {
      recursive: true,
    })
    mkdirSync(join(tmpRoot, 'requirements', 'req-002', 'codebase', 'order'), {
      recursive: true,
    })
    // req-001 的 meta.yaml 里有 branchName
    writeFileSync(
      join(tmpRoot, 'requirements', 'req-001', 'meta.yaml'),
      yaml.stringify({ branchName: 'feat/foo' }),
      'utf8',
    )
    const usage = await svc.findCodebaseUsage('refund')
    expect(usage).toEqual([
      {
        requirementId: 'req-001',
        branch: 'feat/foo',
        codebasePath: join(tmpRoot, 'requirements', 'req-001', 'codebase', 'refund'),
      },
    ])
    // order 不被 refund 使用 → 返空
    const usageOrder = await svc.findCodebaseUsage('order')
    expect(usageOrder.length).toBeGreaterThanOrEqual(1)
    expect(usageOrder.every((u) => u.requirementId === 'req-002')).toBe(true)
  })

  it('findCodebaseUsage: 跳过 .pending-<name> 克隆中标记', async () => {
    mkdirSync(join(tmpRoot, 'requirements', 'req-001', 'codebase', 'refund'), {
      recursive: true,
    })
    // pending 标记:克隆中 → 跳过整条
    writeFileSync(
      join(tmpRoot, 'requirements', 'req-001', 'codebase', '.pending-refund'),
      'pending',
      'utf8',
    )
    const usage = await svc.findCodebaseUsage('refund')
    expect(usage).toEqual([])
  })

  it('findCodebaseUsage: requirements/ 不存在 → 返空', async () => {
    const usage = await svc.findCodebaseUsage('anything')
    expect(usage).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// HTTP route e2e —— buildServer + inject + mock gitExec
// ---------------------------------------------------------------------------

/**
 * Fake gitExec:按 args 模式匹配返回不同结果。
 *
 * - args 含 `'ls-remote'` 且 gitUrl = 'good' → 成功
 * - args 含 `'ls-remote'` 且 gitUrl = 'auth-fail' → E_AUTH
 * - args 含 `'ls-remote'` 且 gitUrl = 'network-fail' → E_NETWORK
 * - args 含 `'ls-remote'` 且 gitUrl = 'timeout' → E_TIMEOUT(超时)
 * - 其他(未预期)→ 抛错,测试红
 */
function makeFakeGitExec(): {
  exec: GitExec
  calls: string[][]
} {
  const calls: string[][] = []
  const exec: GitExec = vi.fn(async (args: string[]) => {
    calls.push(args)
    // route 用 `git(['ls-remote', '--heads', <url>)` —— URL 在 ls-remote 后第 2 位
    const urlIdx = args.indexOf('ls-remote') + 2
    const url = args[urlIdx] ?? ''
    if (args.includes('ls-remote')) {
      if (url === 'good' || url === 'orig') {
        // orig 也算成功(setup 用),good 是常规测试
        return { code: 0, stdout: '<sha>\trefs/heads/main\n', stderr: '' }
      }
      if (url === 'auth-fail') {
        return {
          code: 128,
          stdout: '',
          stderr:
            'Permission denied (publickey). fatal: Could not read from remote repository.',
        }
      }
      if (url === 'network-fail') {
        return {
          code: 128,
          stdout: '',
          stderr: 'fatal: unable to access: Could not resolve host: github.com',
        }
      }
      if (url === 'timeout') {
        return {
          code: 128,
          stdout: '',
          stderr: 'fatal: unable to access: Connection timed out after 10000 ms',
        }
      }
    }
    throw new Error(`fakeGitExec: unhandled args ${JSON.stringify(args)}`)
  }) as unknown as GitExec
  return { exec, calls }
}

/** 注入 fake gitExec 到 buildServer */
function makeServerWithFakeGit(
  tmpRoot: string,
  git: ReturnType<typeof makeFakeGitExec>,
) {
  return buildServer({
    workspaceRoot: tmpRoot,
    provider: undefined,
    git: git.exec,
  })
}

describe('HTTP /api/repos (issue 02 CRUD)', () => {
  let tmpRoot: string
  let app: Awaited<ReturnType<typeof buildServer>>
  let token: string
  let fakeGit: ReturnType<typeof makeFakeGitExec>

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-reposcrud-'))
    process.env.AIDEVSPACE_HOME = tmpRoot
    fakeGit = makeFakeGitExec()
    app = await makeServerWithFakeGit(tmpRoot, fakeGit)
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

  // -------------------------------------------------------------------------
  // GET /api/repos —— 来自 yaml 注册表,无 id 字段
  // -------------------------------------------------------------------------

  describe('GET /api/repos', () => {
    it('注册表文件不存在 → 200 {repos: []}(全新安装)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ repos: [] })
    })

    it('返回 {name, gitUrl, description} 三字段,无 id 字段(FR-1.2)', async () => {
      // 手工塞一个 yaml 文件进去(模拟迁移场景:残留 id 字段)
      writeFileSync(
        join(tmpRoot, 'repos.yaml'),
        yaml.stringify({
          version: 1,
          repos: [
            {
              name: 'refund-service',
              gitUrl: 'git@github.com:co/refund.git',
              description: '退款',
              id: 'repo-refund-service', // legacy → strip
            },
          ],
        }),
        'utf8',
      )
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        repos: Array<Record<string, unknown>>
      }
      expect(body.repos).toHaveLength(1)
      expect(body.repos[0]).toEqual({
        name: 'refund-service',
        gitUrl: 'git@github.com:co/refund.git',
        description: '退款',
      })
      expect(body.repos[0]).not.toHaveProperty('id')
    })

    it('鉴权失败:无 token → 401(authPlugin 拦截)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos',
      })
      expect(res.statusCode).toBe(401)
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/repos —— 必跑 ls-remote;name 重复返 409
  // -------------------------------------------------------------------------

  describe('POST /api/repos', () => {
    it('成功:ls-remote 通过 + name 唯一 → 201,写入 yaml', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'refund-service',
          gitUrl: 'good',
          description: '退款',
        },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toEqual({
        name: 'refund-service',
        gitUrl: 'good',
        description: '退款',
      })
      // 写盘断言
      const yamlPath = join(tmpRoot, 'repos.yaml')
      expect(existsSync(yamlPath)).toBe(true)
      const parsed = yaml.parse(readFileSync(yamlPath, 'utf8'))
      expect(parsed.repos).toHaveLength(1)
      expect(parsed.repos[0].name).toBe('refund-service')
      // 必跑了 ls-remote
      expect(fakeGit.calls.some((c) => c.includes('ls-remote'))).toBe(true)
    })

    it('name 重复 → 409 E_REPO_NAME_EXISTS,不写 yaml', async () => {
      // 先种一条
      await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'refund', gitUrl: 'good', description: 'first' },
      })
      fakeGit.calls.length = 0
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'refund', gitUrl: 'good', description: 'second' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({
        error: 'E_REPO_NAME_EXISTS',
      })
      // 第二次**也**跑了 ls-remote:顺序改成 ls-remote → 唯一性,防止 SSRF / 端口扫描
      expect(fakeGit.calls.some((c) => c.includes('ls-remote'))).toBe(true)
      // yaml 里只有 1 条
      const parsed = yaml.parse(
        readFileSync(join(tmpRoot, 'repos.yaml'), 'utf8'),
      )
      expect(parsed.repos).toHaveLength(1)
    })

    it('ls-remote 鉴权错 → 401 E_AUTH,不写 yaml;message 用固定文案(不漏 stderr)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'private-repo',
          gitUrl: 'auth-fail',
          description: 'x',
        },
      })
      expect(res.statusCode).toBe(401)
      const body = res.json() as { error: string; message: string }
      expect(body.error).toBe('E_AUTH')
      // 固定文案,不暴露 git stderr(M1:可能含凭据片段)
      expect(body.message).toBe('git ls-remote 鉴权失败')
      expect(body.message).not.toContain('publickey')
      expect(existsSync(join(tmpRoot, 'repos.yaml'))).toBe(false)
    })

    it('ls-remote 网络错 → 502 E_NETWORK,不写 yaml;message 用固定文案', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'unreachable',
          gitUrl: 'network-fail',
          description: 'x',
        },
      })
      expect(res.statusCode).toBe(502)
      const body = res.json() as { error: string; message: string }
      expect(body.error).toBe('E_NETWORK')
      expect(body.message).toBe('git ls-remote 网络不可达')
      expect(body.message).not.toContain('Could not resolve host')
      expect(existsSync(join(tmpRoot, 'repos.yaml'))).toBe(false)
    })

    it('body schema 校验失败 → 400(name 缺失)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { gitUrl: 'good', description: '' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // PUT /api/repos/:name —— 改 gitUrl 必跑 ls-remote;不改 gitUrl 不跑
  // -------------------------------------------------------------------------

  describe('PUT /api/repos/:name', () => {
    beforeEach(async () => {
      // 先清掉(前一个 it 可能留下的 refund 条目),再种一条
      const cleanupRes = await app.inject({
        method: 'DELETE',
        url: '/api/repos/refund',
        headers: authHeaders(),
      })
      // 显式断言:DELETE 应返 204(存在并删)或 404(本来就没)
      expect([204, 404]).toContain(cleanupRes.statusCode)
      const setupRes = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'refund',
          gitUrl: 'orig',
          description: 'orig',
        },
      })
      // 显式断言:POST 必须 201(setup 失败立即抛出,不转嫁给后续 it)
      expect(setupRes.statusCode).toBe(201)
      fakeGit.calls.length = 0
    })

    it('改 description(不动 gitUrl) → 200,不跑 ls-remote', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/repos/refund',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { description: 'new desc' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ description: 'new desc' })
      // 没跑 ls-remote
      expect(fakeGit.calls.some((c) => c.includes('ls-remote'))).toBe(false)
    })

    it('改 gitUrl(值不同 orig → good) → 必跑 ls-remote;通过则 200', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/repos/refund',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { gitUrl: 'good' },
      })
      expect(res.statusCode).toBe(200)
      expect(fakeGit.calls.some((c) => c.includes('ls-remote'))).toBe(true)
    })

    it('改 gitUrl 但 ls-remote 鉴权错 → 401 E_AUTH,不写 yaml', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/repos/refund',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { gitUrl: 'auth-fail' },
      })
      expect(res.statusCode).toBe(401)
      // yaml 仍是原值
      const parsed = yaml.parse(
        readFileSync(join(tmpRoot, 'repos.yaml'), 'utf8'),
      )
      expect(parsed.repos[0].gitUrl).toBe('orig')
    })

    it('name 不存在 → 404 E_REPO_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/repos/nope',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { description: 'x' },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'E_REPO_NOT_FOUND' })
    })

    it('不允许改 name → 即使 body 带 name 也被忽略(name 是 URL path 唯一标识)', async () => {
      // route 把 name 字段剔掉,只看 gitUrl/description;
      // 这里测「body 含 name 字段也能 PUT,但 url 里那个 name 不变」
      const res = await app.inject({
        method: 'PUT',
        url: '/api/repos/refund',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'new-name',
          description: 'x',
        },
      })
      expect(res.statusCode).toBe(200)
      const parsed = yaml.parse(
        readFileSync(join(tmpRoot, 'repos.yaml'), 'utf8'),
      )
      expect(parsed.repos[0].name).toBe('refund') // 路径里的 name 没变
    })

    it('gitUrl / description 都不传 → 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/repos/refund',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /api/repos/:name —— 被使用未带 force 返 409;带 force 删除
  // -------------------------------------------------------------------------

  describe('DELETE /api/repos/:name', () => {
    beforeEach(async () => {
      // 先清掉前一个 it 留下的 refund 条目,再种
      const cleanupRes = await app.inject({
        method: 'DELETE',
        url: '/api/repos/refund',
        headers: authHeaders(),
      })
      expect([204, 404]).toContain(cleanupRes.statusCode)
      const setupRes = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'refund',
          gitUrl: 'good',
          description: 'd',
        },
      })
      expect(setupRes.statusCode).toBe(201)
    })

    it('未被使用 → 204 No Content;yaml 中确实不存在', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/repos/refund',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(204)
      const parsed = yaml.parse(
        readFileSync(join(tmpRoot, 'repos.yaml'), 'utf8'),
      )
      expect(parsed.repos).toEqual([])
    })

    it('被 1 个需求使用 + 未带 force → 409 E_REPO_IN_USE + usage 列表', async () => {
      // 模拟 codebase/ 已存在
      mkdirSync(
        join(tmpRoot, 'requirements', 'req-001', 'codebase', 'refund'),
        { recursive: true },
      )
      writeFileSync(
        join(tmpRoot, 'requirements', 'req-001', 'meta.yaml'),
        yaml.stringify({ branchName: 'feat/x' }),
        'utf8',
      )
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/repos/refund',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(409)
      const body = res.json() as {
        error: string
        message: string
        usage: Array<{ requirementId: string }>
      }
      expect(body.error).toBe('E_REPO_IN_USE')
      expect(body.usage).toHaveLength(1)
      expect(body.usage[0].requirementId).toBe('req-001')
      // yaml 中还在
      const parsed = yaml.parse(
        readFileSync(join(tmpRoot, 'repos.yaml'), 'utf8'),
      )
      expect(parsed.repos).toHaveLength(1)
    })

    it('被使用 + 带 ?force=true → 204;但**不** rm 任何 codebase/', async () => {
      const codebaseDir = join(
        tmpRoot,
        'requirements',
        'req-001',
        'codebase',
        'refund',
      )
      mkdirSync(codebaseDir, { recursive: true })
      writeFileSync(join(codebaseDir, 'README.md'), '# keep me', 'utf8')

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/repos/refund?force=true',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(204)
      // yaml 中已删
      const parsed = yaml.parse(
        readFileSync(join(tmpRoot, 'repos.yaml'), 'utf8'),
      )
      expect(parsed.repos).toEqual([])
      // codebase/ 完整保留
      expect(existsSync(codebaseDir)).toBe(true)
      expect(readFileSync(join(codebaseDir, 'README.md'), 'utf8')).toBe(
        '# keep me',
      )
    })

    it('被使用但有 .pending-<name> 标记 → 当作未关联,不返 409', async () => {
      // 克隆中标记存在 → 不算 usage
      mkdirSync(
        join(tmpRoot, 'requirements', 'req-001', 'codebase', 'refund'),
        { recursive: true },
      )
      writeFileSync(
        join(
          tmpRoot,
          'requirements',
          'req-001',
          'codebase',
          '.pending-refund',
        ),
        'pending',
        'utf8',
      )
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/repos/refund',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(204)
    })

    it('name 不存在 → 404 E_REPO_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/repos/nope',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'E_REPO_NOT_FOUND' })
    })
  })

  // -------------------------------------------------------------------------
  // GET /api/repos/:name/usage —— issue 07 D6 「被 N 个需求使用」派生
  // -------------------------------------------------------------------------

  describe('GET /api/repos/:name/usage', () => {
    it('注册表有该仓库 + 无需求使用 → 200 {repoName, usage: []}', async () => {
      // 先种一条
      const setup = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'refund', gitUrl: 'good', description: 'd' },
      })
      expect(setup.statusCode).toBe(201)

      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/refund/usage',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ repoName: 'refund', usage: [] })
    })

    it('注册表有该仓库 + 1 个需求使用 → 200 含 1 条 usage', async () => {
      // 种仓库
      const setup = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'refund', gitUrl: 'good', description: 'd' },
      })
      expect(setup.statusCode).toBe(201)

      // 模拟 req-001 已 clone + meta.yaml 含 branchName
      mkdirSync(
        join(tmpRoot, 'requirements', 'req-001', 'codebase', 'refund'),
        { recursive: true },
      )
      writeFileSync(
        join(tmpRoot, 'requirements', 'req-001', 'meta.yaml'),
        yaml.stringify({ branchName: 'feat/foo' }),
        'utf8',
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/refund/usage',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        repoName: string
        usage: Array<{
          requirementId: string
          branch: string
          codebasePath: string
        }>
      }
      expect(body.repoName).toBe('refund')
      expect(body.usage).toHaveLength(1)
      expect(body.usage[0]).toEqual({
        requirementId: 'req-001',
        branch: 'feat/foo',
        codebasePath: join(
          tmpRoot,
          'requirements',
          'req-001',
          'codebase',
          'refund',
        ),
      })
    })

    it('注册表无该仓库 → 404 E_REPO_NOT_FOUND(usage 仍返空无意义,前端需要知道)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/nope/usage',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'E_REPO_NOT_FOUND' })
    })

    it('.pending-<name> 克隆中标记存在 → usage 跳过该 req(与 DELETE 语义一致)', async () => {
      // 种仓库
      const setup = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'refund', gitUrl: 'good', description: 'd' },
      })
      expect(setup.statusCode).toBe(201)

      // req-001 处于克隆中
      mkdirSync(
        join(tmpRoot, 'requirements', 'req-001', 'codebase', 'refund'),
        { recursive: true },
      )
      writeFileSync(
        join(
          tmpRoot,
          'requirements',
          'req-001',
          'codebase',
          '.pending-refund',
        ),
        'pending',
        'utf8',
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/refund/usage',
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ repoName: 'refund', usage: [] })
    })

    it('鉴权失败:无 token → 401(authPlugin 拦截)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/anything/usage',
      })
      expect(res.statusCode).toBe(401)
    })
  })
})

// ---------------------------------------------------------------------------
// 并发写测试 —— 200ms 退避重试覆盖(issue 02 风险"macOS / Windows 文件锁")
// ---------------------------------------------------------------------------

describe('WorkspaceService · yaml 并发写', () => {
  let tmpRoot: string
  let svc: WorkspaceService

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-ws-concurrent-'))
    svc = WorkspaceService.singleRoot(tmpRoot)
  })
  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('10 路并发 addRepo 全部成功,最终所有条目都存在(200ms 退避覆盖)', async () => {
    const names = Array.from({ length: 10 }, (_, i) => `repo-${i}`)
    await Promise.all(
      names.map((name) =>
        svc.addRepo({
          name,
          gitUrl: `git@${name}`,
          description: '',
        }),
      ),
    )
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toHaveLength(10)
    expect(reg.repos.map((r) => r.name).sort()).toEqual(names.sort())
  })
})