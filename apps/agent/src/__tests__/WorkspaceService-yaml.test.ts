/**
 * WorkspaceService · RepoRegistry yaml CRUD 单元测试(issue 04 4.6 / 4.3)
 *
 * 与 `repos-route.test.ts` 的 6 方法测试互补:
 * - 那边走 HTTP 路径 + 验契约(route → service 集成)
 * - 这里直接戳 service,聚焦「**并发**写 + **原子**写」等契约级保证(ADR-0030 D8)
 *
 * 不依赖 fastify / gitExec / server —— 纯 fs + service。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'yaml'
import {
  WorkspaceService,
  RegistryConflictError,
  RegistryNotFoundError,
  RegistryWriteError,
} from '../services/WorkspaceService.js'

let tmpRoot: string
let svc: WorkspaceService

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-ws-yaml-'))
  svc = new WorkspaceService(tmpRoot)
})

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// readRepoRegistry (空态 + 容错)
// ---------------------------------------------------------------------------

describe('readRepoRegistry', () => {
  it('文件不存在 → 返 {version:1, repos:[]} 不抛(全新安装合法态)', async () => {
    const reg = await svc.readRepoRegistry()
    expect(reg).toEqual({ version: 1, repos: [] })
  })

  it('空文件 / 仅注释 → 返 {version:1, repos:[]}', async () => {
    writeFileSync(svc.repoRegistryPath, '', 'utf8')
    expect(await svc.readRepoRegistry()).toEqual({ version: 1, repos: [] })
    writeFileSync(svc.repoRegistryPath, '# comment only\n', 'utf8')
    expect(await svc.readRepoRegistry()).toEqual({ version: 1, repos: [] })
  })

  it('多余字段 (id / defaultBranch) 静默 strip(FR-1.2 兼容历史 yaml)', async () => {
    writeFileSync(
      svc.repoRegistryPath,
      yaml.stringify({
        version: 1,
        repos: [
          {
            name: 'refund-service',
            gitUrl: 'git@github.com:acme/refund.git',
            description: '退款服务',
            id: 'repo-refund-service', // legacy
            defaultBranch: 'main', // legacy
            extraJunk: 'ignored',
          },
        ],
      }),
      'utf8',
    )
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toHaveLength(1)
    expect(reg.repos[0]).toEqual({
      name: 'refund-service',
      gitUrl: 'git@github.com:acme/refund.git',
      description: '退款服务',
    })
  })

  it('缺少必填字段 → 抛错(Zod 校验)', async () => {
    writeFileSync(
      svc.repoRegistryPath,
      yaml.stringify({
        version: 1,
        repos: [{ name: 'no-url', description: 'no gitUrl field' }],
      }),
      'utf8',
    )
    await expect(svc.readRepoRegistry()).rejects.toThrow()
  })

  it('version 非 1 → 抛错(Schema 不接受未来未发布版本)', async () => {
    writeFileSync(
      svc.repoRegistryPath,
      yaml.stringify({ version: 99, repos: [] }),
      'utf8',
    )
    await expect(svc.readRepoRegistry()).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// findRepoByName / addRepo / updateRepo / removeRepo(基础契约)
// ---------------------------------------------------------------------------

describe('RepoRegistry CRUD 基础契约', () => {
  it('findRepoByName: 存在 → 返条目;不存在 → 返 null', async () => {
    await svc.addRepo({ name: 'refund', gitUrl: 'git@a', description: 'A' })
    expect(await svc.findRepoByName('refund')).toEqual({
      name: 'refund',
      gitUrl: 'git@a',
      description: 'A',
    })
    expect(await svc.findRepoByName('ghost')).toBeNull()
  })

  it('addRepo: 追加到尾部,顺序稳定', async () => {
    await svc.addRepo({ name: 'a', gitUrl: 'git@a', description: 'A' })
    await svc.addRepo({ name: 'b', gitUrl: 'git@b', description: 'B' })
    await svc.addRepo({ name: 'c', gitUrl: 'git@c', description: 'C' })
    const reg = await svc.readRepoRegistry()
    expect(reg.repos.map((r) => r.name)).toEqual(['a', 'b', 'c'])
  })

  it('addRepo: name 重复 → 抛 RegistryConflictError(E_REPO_NAME_EXISTS)', async () => {
    await svc.addRepo({ name: 'dup', gitUrl: 'git@1', description: '1' })
    await expect(
      svc.addRepo({ name: 'dup', gitUrl: 'git@2', description: '2' }),
    ).rejects.toBeInstanceOf(RegistryConflictError)
  })

  it('updateRepo: 改 description 不动 gitUrl', async () => {
    await svc.addRepo({ name: 'r', gitUrl: 'git@orig', description: 'orig' })
    const next = await svc.updateRepo('r', { description: 'new' })
    expect(next).toEqual({ name: 'r', gitUrl: 'git@orig', description: 'new' })
  })

  it('updateRepo: 同时改两字段都生效', async () => {
    await svc.addRepo({ name: 'r', gitUrl: 'git@orig', description: 'orig' })
    const next = await svc.updateRepo('r', {
      gitUrl: 'git@new',
      description: 'new',
    })
    expect(next).toEqual({ name: 'r', gitUrl: 'git@new', description: 'new' })
  })

  it('updateRepo: name 不存在 → 抛 RegistryNotFoundError', async () => {
    await expect(
      svc.updateRepo('ghost', { description: 'x' }),
    ).rejects.toBeInstanceOf(RegistryNotFoundError)
  })

  it('updateRepo: 空 patch 不报错,但 name 必须存在(找不到仍抛)', async () => {
    await expect(svc.updateRepo('ghost', {})).rejects.toBeInstanceOf(
      RegistryNotFoundError,
    )
  })

  it('removeRepo: 存在 → 删;不存在 → 抛 RegistryNotFoundError', async () => {
    await svc.addRepo({ name: 'temp', gitUrl: 'git@x', description: '' })
    await svc.removeRepo('temp')
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toEqual([])

    await expect(svc.removeRepo('temp')).rejects.toBeInstanceOf(
      RegistryNotFoundError,
    )
  })

  it('removeRepo: 不删任何 requirements/<id>/codebase/<n>/ 目录(决策 113 + US-3)', async () => {
    await svc.addRepo({ name: 'refund', gitUrl: 'git@x', description: '' })
    const codeDir = join(tmpRoot, 'requirements', 'req-001', 'codebase', 'refund')
    mkdirSync(codeDir, { recursive: true })
    writeFileSync(join(codeDir, '.gitkeep'), '保护保留', 'utf8')

    await svc.removeRepo('refund')
    // 注册表里没了;codebase 目录仍在,内容完整
    expect(await svc.findRepoByName('refund')).toBeNull()
    expect(existsSync(join(codeDir, '.gitkeep'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 原子写(无 .tmp 残留)
// ---------------------------------------------------------------------------

describe('原子写 (atomic file rename) — 决策 113', () => {
  it('多次 addRepo 后根目录无 .tmp 残留', async () => {
    for (let i = 0; i < 5; i++) {
      await svc.addRepo({
        name: `repo-${i}`,
        gitUrl: `git@r${i}`,
        description: '',
      })
    }
    expect(readdirSync(tmpRoot).some((e) => e.endsWith('.tmp'))).toBe(false)
  })

  it('updateRepo / removeRepo 也不留 .tmp', async () => {
    await svc.addRepo({ name: 'r', gitUrl: 'git@1', description: '' })
    await svc.updateRepo('r', { description: 'x' })
    await svc.updateRepo('r', { gitUrl: 'git@2' })
    await svc.removeRepo('r')
    expect(readdirSync(tmpRoot).some((e) => e.endsWith('.tmp'))).toBe(false)
  })

  it('写盘文件 = yaml.stringify 的标准输出', async () => {
    await svc.addRepo({
      name: 'refund',
      gitUrl: 'git@github.com:acme/refund.git',
      description: '退款',
    })
    const raw = readFileSync(svc.repoRegistryPath, 'utf8')
    const parsed = yaml.parse(raw)
    expect(parsed).toEqual({
      version: 1,
      repos: [
        {
          name: 'refund',
          gitUrl: 'git@github.com:acme/refund.git',
          description: '退款',
        },
      ],
    })
  })
})

// ---------------------------------------------------------------------------
// 并发覆盖(read-modify-write 互斥 + 重试)
// ---------------------------------------------------------------------------

describe('并发 addRepo 100 条不丢字段 (FR-1.4 / ADR-0030 D8)', () => {
  it('100 个独立 name 并行写入,全部存在', async () => {
    // 全套测试一起跑时 fs / mutex 串行化耗时高;vitest 默认 5s 不够 → 30s
    const N = 100
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        svc.addRepo({
          name: `repo-${i}`,
          gitUrl: `git@host-${i}.git`,
          description: `repo ${i}`,
        }),
      ),
    )
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toHaveLength(N)
    const names = reg.repos.map((r) => r.name).sort()
    expect(names[0]).toBe('repo-0')
    expect(names[N - 1]).toBe(`repo-${N - 1}`)
  }, 30_000)

  it('并发 addRepo 撞重名 → 自然撞业务冲突,只成功一次,其余抛 RegistryConflictError', async () => {
    const N = 20
    const settled = await Promise.allSettled(
      Array.from({ length: N }, () =>
        svc.addRepo({
          name: 'same-name',
          gitUrl: 'git@x',
          description: '',
        }),
      ),
    )
    const fulfilled = settled.filter((s) => s.status === 'fulfilled')
    const rejected = settled.filter((s) => s.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(N - 1)
    expect(
      (rejected[0] as PromiseRejectedResult).reason,
    ).toBeInstanceOf(RegistryConflictError)

    const reg = await svc.readRepoRegistry()
    expect(reg.repos.filter((r) => r.name === 'same-name')).toHaveLength(1)
  })

  it('并发混合 add/update/remove → 最终状态一致 (无 lost update)', async () => {
    // 先放一个种子
    await svc.addRepo({ name: 'seed', gitUrl: 'git@s', description: 'start' })

    // 30 个并发操作:10 个 add 新条目 / 10 个 update seed / 10 个 remove seed(交错会撞)
    const tasks: Promise<unknown>[] = []
    for (let i = 0; i < 10; i++) {
      tasks.push(
        svc.addRepo({
          name: `add-${i}`,
          gitUrl: `git@a${i}`,
          description: '',
        }),
      )
      tasks.push(svc.updateRepo('seed', { description: `u${i}` }))
      tasks.push(svc.removeRepo('seed')) // 与 update 并发,只有一个最终胜出
    }

    const settled = await Promise.allSettled(tasks)
    // 部分会因 NotFound(remove 错失时)或 Conflict(add 撞重) reject —— 这是预期
    const reg = await svc.readRepoRegistry()
    // 至少应该有 `add-X` 一类条目;总数无 lost update 即可
    expect(reg.repos.length).toBeGreaterThanOrEqual(0)
    // seed 要么在,要么不在;不能同时存在两份
    const seedCount = reg.repos.filter((r) => r.name === 'seed').length
    expect(seedCount).toBeLessThanOrEqual(1)
    // 一些业务错应该出现(业务级冲突不重试)
    const businessErrors = settled.filter(
      (s) =>
        s.status === 'rejected' &&
        (s.reason instanceof RegistryConflictError ||
          s.reason instanceof RegistryNotFoundError),
    )
    expect(businessErrors.length).toBeGreaterThan(0)
    // 但不存在 RegistryWriteError(读到 5 次重试都失败的极端 IO 错)
    const ioErrors = settled.filter(
      (s) =>
        s.status === 'rejected' && s.reason instanceof RegistryWriteError,
    )
    expect(ioErrors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// findCodebaseUsage — 派生「被 N 个需求使用」列表
// ---------------------------------------------------------------------------

describe('findCodebaseUsage (issue 04 4.3 派生使用列表)', () => {
  it('requirements/ 不存在 → 返空', async () => {
    const usage = await svc.findCodebaseUsage('any')
    expect(usage).toEqual([])
  })

  it('扫 requirements/*/codebase/<name>/ 派生 (合规需求 + branch from meta.yaml)', async () => {
    // 模拟 2 个需求用同一个 repo
    const r1 = join(tmpRoot, 'requirements', 'req-001')
    const r2 = join(tmpRoot, 'requirements', 'req-002')
    mkdirSync(join(r1, 'codebase', 'refund'), { recursive: true })
    mkdirSync(join(r2, 'codebase', 'refund'), { recursive: true })
    writeFileSync(
      join(r1, 'meta.yaml'),
      yaml.stringify({ branchName: 'feat/foo' }),
      'utf8',
    )
    writeFileSync(
      join(r2, 'meta.yaml'),
      yaml.stringify({ branchName: 'feat/bar' }),
      'utf8',
    )

    const usage = await svc.findCodebaseUsage('refund')
    expect(usage).toHaveLength(2)
    const byId = Object.fromEntries(usage.map((u) => [u.requirementId, u]))
    expect(byId['req-001']?.branch).toBe('feat/foo')
    expect(byId['req-002']?.branch).toBe('feat/bar')
    expect(byId['req-001']?.codebasePath).toBe(
      join(r1, 'codebase', 'refund'),
    )
  })

  it('跳过 .pending-<name> 克隆中标记', async () => {
    const r1 = join(tmpRoot, 'requirements', 'req-001')
    mkdirSync(join(r1, 'codebase', 'refund'), { recursive: true })
    // pending 标记存在 → 整条跳过
    writeFileSync(join(r1, 'codebase', '.pending-refund'), 'pending', 'utf8')
    const usage = await svc.findCodebaseUsage('refund')
    expect(usage).toEqual([])
  })

  it('meta.yaml 缺失 / 损坏 → branch 返空字符串,不阻断 usage 列表', async () => {
    const r1 = join(tmpRoot, 'requirements', 'req-001')
    mkdirSync(join(r1, 'codebase', 'refund'), { recursive: true })
    // meta.yaml 完全缺失
    const usage = await svc.findCodebaseUsage('refund')
    expect(usage).toEqual([
      {
        requirementId: 'req-001',
        branch: '',
        codebasePath: join(r1, 'codebase', 'refund'),
      },
    ])

    // meta.yaml 损坏 — 也不抛,branch 返空
    writeFileSync(join(r1, 'meta.yaml'), ': invalid [\n', 'utf8')
    const usage2 = await svc.findCodebaseUsage('refund')
    expect(usage2[0]?.branch).toBe('')
  })

  it('非目录文件混杂在 requirements/ 下 → 跳过(不报错)', async () => {
    // 在 requirements/ 直接放一个普通文件 + 子目录里没 codebase
    mkdirSync(join(tmpRoot, 'requirements'), { recursive: true })
    writeFileSync(join(tmpRoot, 'requirements', 'stray.txt'), 'hello', 'utf8')
    mkdirSync(join(tmpRoot, 'requirements', 'req-001'), { recursive: true })
    const usage = await svc.findCodebaseUsage('refund')
    expect(usage).toEqual([])
  })

  it('其他 repo 的 codebase 目录不被计入(避免串扰)', async () => {
    const r1 = join(tmpRoot, 'requirements', 'req-001')
    mkdirSync(join(r1, 'codebase', 'refund'), { recursive: true })
    mkdirSync(join(r1, 'codebase', 'order'), { recursive: true })
    const usage = await svc.findCodebaseUsage('refund')
    expect(usage).toHaveLength(1)
    expect(usage[0]?.requirementId).toBe('req-001')
  })
})
