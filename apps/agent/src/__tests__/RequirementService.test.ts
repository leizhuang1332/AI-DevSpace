/**
 * RequirementService tests —— ticket 02 worktree 真实创建
 *
 * 覆盖(决策 30:重试 3 次上限;主分支 fallback: main → master):
 * - 成功路径:N=3 全成功,worktree path 正确
 * - base 分支 fallback:fake git 对 main 返回非 0 → 自动试 master
 * - base 分支 = main 命中:跳过 master
 * - base 都不存在:E_BASE_BRANCH_NOT_FOUND
 * - 单 repo 失败(E_DISK_FULL):不影响其他
 * - 多 repo 部分失败
 * - 网络错重试:fake git 第一次返回 EAI_AGAIN,后两次 0 → 调用 4 次(1+3) 后成功
 * - 网络错重试上限:一直 EAI_AGAIN → 调用 4 次(1+3) 后停止,E_NETWORK
 * - repo 不存在(无 .git):不调 git,直接 E_REPO_NOT_FOUND
 * - 分支已存在(精确 stderr 匹配):E_BRANCH_EXISTS
 *
 * 测试基础设施:
 * - GitExec 通过 factory 注入 fake(vi.fn 记录 args)
 * - sleep 通过注入控制 → 测速不真等待
 * - 用 mkdtempSync + git init 真实创建 .git 用于 repoExistsInPool 校验
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepoAttachErrorCode, STATUS_PROGRESS_MAP } from '@ai-devspace/shared'
import {
  RequirementService,
  mapGitError,
  type RequirementServiceDeps,
} from '../services/RequirementService.js'

const ROOT = '/fake/aidevsp-svc'

// ============================================================================
// Helpers
// ============================================================================

function ok(stdout = '', stderr = ''): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout, stderr }
}
function fail(stderr: string, code = 1): { code: number; stdout: string; stderr: string } {
  return { code, stdout: '', stderr }
}

/**
 * 创建 GitExec fake:逐 call 弹一个 respond(基于 args 判定);默认 ok()。
 * 返回的 calls 数组按调用顺序记录 argv。
 */
function makeFakeGit(
  respond?: (args: string[]) => { code: number; stdout: string; stderr: string },
): {
  git: RequirementServiceDeps['git']
  calls: string[][]
} {
  const calls: string[][] = []
  const git: RequirementServiceDeps['git'] = vi.fn(async (args) => {
    calls.push(args)
    return respond ? respond(args) : ok()
  })
  return { git, calls }
}

/** 一次性 queue:每次取一个 response;耗尽后回退到 fallback */
function makeQueuedGit(
  responses: Array<{ code: number; stdout?: string; stderr?: string }>,
  fallback: { code: number; stdout?: string; stderr?: string } = ok(),
): { git: RequirementServiceDeps['git']; calls: string[][] } {
  let i = 0
  const calls: string[][] = []
  const git: RequirementServiceDeps['git'] = vi.fn(async (args) => {
    calls.push(args)
    const r = responses[i++] ?? fallback
    return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  })
  return { git, calls }
}

/** 默认行为:show-ref refs/heads/main → ok;ref master 不需要(因为 main 已通过) */
function gitMainOnly(): RequirementServiceDeps['git'] {
  return vi.fn(async (args) => {
    if (args.includes('show-ref') && args.includes('refs/heads/main')) return ok()
    return ok()
  })
}

function gitMasterOnly(): RequirementServiceDeps['git'] {
  return vi.fn(async (args) => {
    if (args.includes('show-ref') && args.includes('refs/heads/main')) return fail('not found', 1)
    if (args.includes('show-ref') && args.includes('refs/heads/master')) return ok()
    return ok()
  })
}

function gitNone(): RequirementServiceDeps['git'] {
  return vi.fn(async (args) => {
    if (args.includes('show-ref')) return fail('not found', 1)
    return ok()
  })
}

const noSleep = (_ms: number) => Promise.resolve()

// ============================================================================
// 真实文件系统 setUp —— 在 tmpdir 建一个 fake workspace,带 repos/<name>/.git
// ============================================================================

let realRoot: string
let cleanups: Array<() => void> = []

function makePoolRepo(repoName: string): string {
  const repoDir = join(realRoot, 'repos', repoName)
  mkdirSync(join(repoDir, '.git'), { recursive: true })
  // 在 .git/HEAD 写一行 "ref: refs/heads/main" 让 ls / show-ref 行为更真实(本测试
  // 不直接用真实 git —— 仅靠 existsSync(.git) 决定 E_REPO_NOT_FOUND)。
  return repoDir
}

function makeRequirementDir(reqId: string): void {
  mkdirSync(join(realRoot, 'requirements', reqId), { recursive: true })
}

beforeEach(() => {
  realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-reqsvc-'))
  cleanups = []
})

afterEach(() => {
  cleanups.forEach((fn) => fn())
  rmSync(realRoot, { recursive: true, force: true })
})

// ============================================================================
// mapGitError 纯函数测试
// ============================================================================

describe('mapGitError', () => {
  it('maps disk full', () => {
    expect(mapGitError('fatal: unable to write file: No space left on device')).toBe(
      RepoAttachErrorCode.E_DISK_FULL,
    )
    expect(mapGitError('ENOSPC: no space left on device')).toBe(
      RepoAttachErrorCode.E_DISK_FULL,
    )
    expect(mapGitError('fatal: disk full')).toBe(
      RepoAttachErrorCode.E_DISK_FULL,
    )
  })

  it('maps branch exists with exact wording', () => {
    expect(mapGitError("fatal: A branch named 'feat/x' already exists.")).toBe(
      RepoAttachErrorCode.E_BRANCH_EXISTS,
    )
  })

  it('maps base branch not found', () => {
    expect(mapGitError('fatal: unknown revision or path not in the working tree.')).toBe(
      RepoAttachErrorCode.E_BASE_BRANCH_NOT_FOUND,
    )
    expect(mapGitError('fatal: invalid reference: master')).toBe(
      RepoAttachErrorCode.E_BASE_BRANCH_NOT_FOUND,
    )
  })

  it('maps network errors', () => {
    expect(mapGitError('fatal: unable to access: Could not resolve host: github.com')).toBe(
      RepoAttachErrorCode.E_NETWORK,
    )
    expect(mapGitError('EAI_AGAIN')).toBe(RepoAttachErrorCode.E_NETWORK)
    expect(mapGitError('Connection refused')).toBe(RepoAttachErrorCode.E_NETWORK)
  })

  it('maps repo not found', () => {
    expect(mapGitError('fatal: not a git repository (or any parent up to mount point /)')).toBe(
      RepoAttachErrorCode.E_REPO_NOT_FOUND,
    )
    expect(mapGitError("fatal: '/path/to/repo': Not a directory")).toBe(
      RepoAttachErrorCode.E_REPO_NOT_FOUND,
    )
  })

  it('falls back to E_INTERNAL for unknown stderr', () => {
    expect(mapGitError('some random failure')).toBe(RepoAttachErrorCode.E_INTERNAL)
    expect(mapGitError('')).toBe(RepoAttachErrorCode.E_INTERNAL)
  })
})

// ============================================================================
// checkRequirementExists
// ============================================================================

describe('RequirementService.checkRequirementExists', () => {
  it('returns true when requirements/<id> exists', async () => {
    makeRequirementDir('req-001')
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })
    expect(await svc.checkRequirementExists('req-001')).toBe(true)
  })

  it('returns false when missing', async () => {
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })
    expect(await svc.checkRequirementExists('req-missing')).toBe(false)
  })
})

// ============================================================================
// resolveBaseBranch
// ============================================================================

describe('RequirementService.resolveBaseBranch', () => {
  it('returns "main" when main exists', async () => {
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })
    expect(await svc.resolveBaseBranch('/any')).toBe('main')
  })

  it('falls back to "master" when main missing', async () => {
    const svc = new RequirementService({ root: realRoot, git: gitMasterOnly(), sleep: noSleep })
    expect(await svc.resolveBaseBranch('/any')).toBe('master')
  })

  it('returns null when neither exists', async () => {
    const svc = new RequirementService({ root: realRoot, git: gitNone(), sleep: noSleep })
    expect(await svc.resolveBaseBranch('/any')).toBeNull()
  })
})

// ============================================================================
// repoExistsInPool
// ============================================================================

describe('RequirementService.repoExistsInPool', () => {
  it('returns true when repos/<name>/.git exists', () => {
    makePoolRepo('refund-service')
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })
    expect(svc.repoExistsInPool('refund-service')).toBe(true)
  })

  it('returns false when .git is missing (empty dir)', () => {
    mkdirSync(join(realRoot, 'repos', 'empty-dir'), { recursive: true })
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })
    expect(svc.repoExistsInPool('empty-dir')).toBe(false)
  })

  it('returns false when repo dir is missing entirely', () => {
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })
    expect(svc.repoExistsInPool('nope')).toBe(false)
  })
})

// ============================================================================
// attachRepo — 成功路径
// ============================================================================

describe('RequirementService.attachRepo — success path', () => {
  it('returns ok=true with worktreePath + base=main', async () => {
    makePoolRepo('refund-service')
    makeRequirementDir('req-001')
    const { git, calls } = makeFakeGit() // 默认 ok
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })

    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.worktreePath).toBe(
        join(realRoot, 'requirements', 'req-001', 'repos', 'refund-service'),
      )
      expect(r.branch).toBe('feat/test')
      expect(r.base).toBe('main')
    }
    // 调用顺序:show-ref main → show-ref master(不该调) → worktree add
    expect(calls.length).toBe(2)
    expect(calls[0]).toContain('refs/heads/main')
    expect(calls[1]).toEqual([
      '-C',
      join(realRoot, 'repos', 'refund-service'),
      'worktree',
      'add',
      join(realRoot, 'requirements', 'req-001', 'repos', 'refund-service'),
      '-b',
      'feat/test',
      'main',
    ])
  })

  it('returns base=master when only master exists', async () => {
    makePoolRepo('order-service')
    const svc = new RequirementService({ root: realRoot, git: gitMasterOnly(), sleep: noSleep })

    const r = await svc.attachRepo('req-001', 'order-service', 'feat/x')

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.base).toBe('master')
  })
})

// ============================================================================
// attachRepo — 提前失败(未调 git)
// ============================================================================

describe('RequirementService.attachRepo — pre-git failures', () => {
  it('returns E_REPO_NOT_FOUND when repo dir/.git missing', async () => {
    makeRequirementDir('req-001')
    const { git, calls } = makeFakeGit()
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })

    const r = await svc.attachRepo('req-001', 'nonexistent', 'feat/test')

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(RepoAttachErrorCode.E_REPO_NOT_FOUND)
    // 未调 git
    expect(calls.length).toBe(0)
  })

  it('returns E_BASE_BRANCH_NOT_FOUND when neither main nor master exists', async () => {
    makePoolRepo('refund-service')
    makeRequirementDir('req-001')
    const calls: string[][] = []
    const git = vi.fn(async (args: string[]) => {
      calls.push(args)
      if (args.includes('show-ref')) return fail('not found', 1)
      return ok()
    })
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })

    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_BASE_BRANCH_NOT_FOUND)
      expect(r.message).toMatch(/main/)
    }
    // 只调了 2 次 show-ref,未调 worktree add
    expect(calls.length).toBe(2)
    expect(calls.every((c) => c.includes('show-ref'))).toBe(true)
  })
})

// ============================================================================
// attachRepo — git 失败 → RepoAttachErrorCode 映射
// ============================================================================

describe('RequirementService.attachRepo — git stderr mapping', () => {
  beforeEach(() => {
    makePoolRepo('refund-service')
  })

  it('E_DISK_FULL: stderr contains "No space left"', async () => {
    const { git } = makeFakeGit((args) => {
      if (args.includes('show-ref')) return ok()
      return fail('fatal: unable to write file: No space left on device')
    })
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })
    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(RepoAttachErrorCode.E_DISK_FULL)
  })

  it('E_BRANCH_EXISTS: exact git wording', async () => {
    const { git } = makeFakeGit((args) => {
      if (args.includes('show-ref')) return ok()
      return fail("fatal: A branch named 'feat/test' already exists.")
    })
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })
    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(RepoAttachErrorCode.E_BRANCH_EXISTS)
  })

  it('E_REPO_NOT_FOUND: "not a git repository" stderr', async () => {
    // 强制 .git 存在但 git 命令返回此错(模拟主仓库被破坏)
    const { git } = makeFakeGit((args) => {
      if (args.includes('show-ref')) return ok()
      return fail('fatal: not a git repository (or any parent up to mount point /)')
    })
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })
    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(RepoAttachErrorCode.E_REPO_NOT_FOUND)
  })

  it('E_INTERNAL: unknown stderr', async () => {
    const { git } = makeFakeGit((args) => {
      if (args.includes('show-ref')) return ok()
      return fail('some random failure message')
    })
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })
    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(RepoAttachErrorCode.E_INTERNAL)
  })
})

// ============================================================================
// attachRepo — 网络错重试(决策 30)
// ============================================================================

describe('RequirementService.attachRepo — network retry', () => {
  beforeEach(() => {
    makePoolRepo('refund-service')
  })

  it('retries network errors and succeeds on later attempt', async () => {
    // 调用序列:show-ref main → worktree add(EAI_AGAIN) → worktree add(ok) → return
    // 验证:retry 至少被触发(>1 次 git worktree add),且最终 ok
    const responses: Array<{ code: number; stdout: string; stderr: string }> = [
      fail('EAI_AGAIN'), // worktree add #1 (fail → retry)
      ok(), // worktree add #2 (succeed → return)
    ]
    const calls: string[][] = []
    const git = vi.fn(async (args: string[]) => {
      calls.push(args)
      if (args.includes('show-ref')) return ok() // main-only 路径
      return responses.shift() ?? ok()
    })

    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })
    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')

    expect(r.ok).toBe(true)
    const worktreeAdds = calls.filter((c) => c.includes('worktree'))
    // 第 1 次失败 → 第 2 次成功(>1 次表示 retry 触发)
    expect(worktreeAdds.length).toBe(2)
  })

  it('returns E_NETWORK after maxRetries exhausted (1 + 3 = 4 worktree add calls)', async () => {
    const calls2: string[][] = []
    const git = vi.fn(async (args: string[]) => {
      calls2.push(args)
      if (args.includes('show-ref')) return ok()
      return fail('fatal: Could not resolve host: github.com')
    })
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })

    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(RepoAttachErrorCode.E_NETWORK)
    // 4 次 worktree add(初始 + 3 重试)
    const wtAdds = calls2.filter((c) => c.includes('worktree'))
    expect(wtAdds.length).toBe(4)
  })

  it('does NOT retry non-network errors', async () => {
    const calls3: string[][] = []
    const git = vi.fn(async (args: string[]) => {
      calls3.push(args)
      if (args.includes('show-ref')) return ok()
      return fail('fatal: A branch named \'x\' already exists.')
    })
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })

    const r = await svc.attachRepo('req-001', 'refund-service', 'feat/test')

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(RepoAttachErrorCode.E_BRANCH_EXISTS)
    // 只调 1 次 worktree add(立即返回)
    const wtAdds = calls3.filter((c) => c.includes('worktree'))
    expect(wtAdds.length).toBe(1)
  })
})

// ============================================================================
// attachRepos — 批量 + 部分失败语义
// ============================================================================

describe('RequirementService.attachRepos — batch + partial failure', () => {
  it('all 3 repos succeed', async () => {
    makePoolRepo('a')
    makePoolRepo('b')
    makePoolRepo('c')
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })

    const out = await svc.attachRepos('req-001', ['a', 'b', 'c'], 'feat/test')

    expect(out.every((r) => r.ok)).toBe(true)
    expect(out.length).toBe(3)
  })

  it('partial: N=3 中 1 个失败', async () => {
    makePoolRepo('a')
    // b 不存在
    makePoolRepo('c')

    const git = vi.fn(async (args: string[]) => {
      if (args.includes('show-ref')) return ok()
      return ok()
    })
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })

    const out = await svc.attachRepos('req-001', ['a', 'b', 'c'], 'feat/test')

    expect(out.length).toBe(3)
    expect(out[0].ok).toBe(true)
    expect(out[1].ok).toBe(false)
    if (!out[1].ok) expect(out[1].code).toBe(RepoAttachErrorCode.E_REPO_NOT_FOUND)
    expect(out[2].ok).toBe(true)
  })

  it('all fail: returns 3 results all ok=false', async () => {
    // 不创建任何 repos
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })
    const out = await svc.attachRepos('req-001', ['x', 'y', 'z'], 'feat/test')
    expect(out.every((r) => !r.ok)).toBe(true)
  })

  it('empty repoIds returns empty array', async () => {
    const svc = new RequirementService({ root: realRoot, git: gitMainOnly(), sleep: noSleep })
    const out = await svc.attachRepos('req-001', [], 'feat/test')
    expect(out).toEqual([])
  })

  it('serial processing: one repo failure does not block subsequent', async () => {
    makePoolRepo('a')
    // 强制 a 的 worktree add 失败
    const calls4: string[][] = []
    const git = vi.fn(async (args: string[]) => {
      calls4.push(args)
      if (args.includes('show-ref')) return ok()
      // a 失败(ENOENT)
      if (args.includes('worktree') && calls4.filter((c) => c.includes('worktree')).length === 1) {
        return fail('fatal: not a git repository')
      }
      return ok()
    })
    makePoolRepo('b')
    const svc = new RequirementService({ root: realRoot, git, sleep: noSleep })

    const out = await svc.attachRepos('req-001', ['a', 'b'], 'feat/test')

    expect(out.length).toBe(2)
    expect(out[0].ok).toBe(false)
    expect(out[1].ok).toBe(true)
  })
})

// ============================================================================
// _unused —— 避免 lint 报 ROOT 未用(测试用真实文件系统即可)
// ============================================================================

// ROOT 是 plan 文档里出现的常量子名,这里保留引用占位避免 lint
void ROOT

// ============================================================================
// ticket 07a —— listRequirements + status 派生(ADR-0014 D2 方案 β)
// ============================================================================

/** 写一个最小可用的 meta.yaml(id / title / createdAt) */
function writeMetaYaml(reqDir: string, opts: { id: string; title: string; createdAt: string }): void {
  mkdirSync(reqDir, { recursive: true })
  writeFileSync(
    join(reqDir, 'meta.yaml'),
    `id: ${opts.id}\ntitle: ${opts.title}\ncreatedAt: ${opts.createdAt}\n`,
  )
}

/** 强制设置目录 mtime(用于测试排序) */
function setMtime(reqDir: string, time: Date): void {
  utimesSync(reqDir, time, time)
}

describe('RequirementService.listRequirements', () => {
  it('空目录 → []', () => {
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    expect(svc.listRequirements()).toEqual([])
  })

  it('1 个 req:无产物 → status=draft, progress=0, repos=[]', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      id: 'req-001-foo',
      title: 'foo',
      status: 'draft',
      progress: 0,
      repos: [],
    })
    expect(typeof r[0].createdAt).toBe('string')
    expect(typeof r[0].updatedAt).toBe('string')
  })

  it('1 个 req:requirement.md 空白(< 10 字节) → status=draft', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    writeFileSync(join(realRoot, 'requirements', 'req-001-foo', 'requirement.md'), '# x\n')
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    expect(svc.listRequirements()[0].status).toBe('draft')
  })

  it('1 个 req:requirement.md 非空(> 10 字节) → status=drafting', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    writeFileSync(
      join(realRoot, 'requirements', 'req-001-foo', 'requirement.md'),
      '# 退款功能优化\n\n<!-- 在 DRAFTING 工位编写需求背景、目标、AC -->\n',
    )
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    expect(svc.listRequirements()[0].status).toBe('drafting')
    expect(svc.listRequirements()[0].progress).toBe(0)
  })

  it('1 个 req:有 analysis/ → status=analyzing, progress=20', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-001-foo', 'analysis'))
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()[0]
    expect(r.status).toBe('analyzing')
    expect(r.progress).toBe(STATUS_PROGRESS_MAP.analyzing)
    expect(r.progress).toBe(20)
  })

  it('1 个 req:有 clarifying/ → status=clarifying, progress=30', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-001-foo', 'clarifying'))
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()[0]
    expect(r.status).toBe('clarifying')
    expect(r.progress).toBe(30)
  })

  it('1 个 req:有 design/ → status=designing, progress=40', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-001-foo', 'design'))
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()[0]
    expect(r.status).toBe('designing')
    expect(r.progress).toBe(40)
  })

  it('1 个 req:有 plan/tasks.md → status=planning, progress=50', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-001-foo', 'plan'), { recursive: true })
    writeFileSync(join(realRoot, 'requirements', 'req-001-foo', 'plan', 'tasks.md'), '- [ ] t1')
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()[0]
    expect(r.status).toBe('planning')
    expect(r.progress).toBe(50)
  })

  it('1 个 req:有 wrapup/ → status=done, progress=100', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-001-foo', 'wrapup'))
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()[0]
    expect(r.status).toBe('done')
    expect(r.progress).toBe(100)
  })

  it('1 个 req:有 .archived → status=archived, progress=100', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    writeFileSync(join(realRoot, 'requirements', 'req-001-foo', '.archived'), '')
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()[0]
    expect(r.status).toBe('archived')
    expect(r.progress).toBe(100)
  })

  it('1 个 req:wrapup/ + .archived → status=archived(优先级最高)', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-001-foo', 'wrapup'))
    writeFileSync(join(realRoot, 'requirements', 'req-001-foo', '.archived'), '')
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    expect(svc.listRequirements()[0].status).toBe('archived')
  })

  it('排序:3 个 req mtime 不同 → updatedAt 倒序', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-a'), {
      id: 'req-001-a',
      title: 'a',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    writeMetaYaml(join(realRoot, 'requirements', 'req-002-b'), {
      id: 'req-002-b',
      title: 'b',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    writeMetaYaml(join(realRoot, 'requirements', 'req-003-c'), {
      id: 'req-003-c',
      title: 'c',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    setMtime(join(realRoot, 'requirements', 'req-001-a'), new Date('2026-07-10T00:00:00Z'))
    setMtime(join(realRoot, 'requirements', 'req-002-b'), new Date('2026-07-15T00:00:00Z'))
    setMtime(join(realRoot, 'requirements', 'req-003-c'), new Date('2026-07-17T00:00:00Z'))
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()
    expect(r.map((x) => x.id)).toEqual([
      'req-003-c',
      'req-002-b',
      'req-001-a',
    ])
  })

  it('容错:meta.yaml 损坏 → 跳过该目录,其他目录仍返回', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-good'), {
      id: 'req-001-good',
      title: 'good',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-002-bad'), { recursive: true })
    writeFileSync(
      join(realRoot, 'requirements', 'req-002-bad', 'meta.yaml'),
      'garbage: : : not yaml {{{',
    )
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('req-001-good')
  })

  it('容错:requirements/ 下残留 .DS_Store 等隐藏项 → 不算 req', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    // 残留 .DS_Store(不应被识别为 req)
    mkdirSync(join(realRoot, 'requirements', '.DS_Store'))
    // 残留临时目录(以 . 开头)
    mkdirSync(join(realRoot, 'requirements', '.tmp-debug'))
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('req-001-foo')
  })

  it('repos 派生:requirements/<id>/repos/<repoName> 子目录名 → repos 数组', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-001-foo', 'repos', 'refund-service'), {
      recursive: true,
    })
    mkdirSync(join(realRoot, 'requirements', 'req-001-foo', 'repos', 'order-service'), {
      recursive: true,
    })
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()[0]
    expect(r.repos.sort()).toEqual(['order-service', 'refund-service'])
  })

  it('repos 派生:repos/ 目录不存在 → repos=[]', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    expect(svc.listRequirements()[0].repos).toEqual([])
  })

  it('updatedAt 用 reqDir 的 mtime(避免与 meta.yaml createdAt 混淆)', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-foo'), {
      id: 'req-001-foo',
      title: 'foo',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    setMtime(join(realRoot, 'requirements', 'req-001-foo'), new Date('2026-07-17T05:42:23.000Z'))
    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()[0]
    expect(r.updatedAt).toBe('2026-07-17T05:42:23.000Z')
    expect(r.createdAt).toBe('2026-07-01T00:00:00.000Z')
  })
})

describe('STATUS_PROGRESS_MAP 集成(service 返回的 progress 与 shared 一致)', () => {
  it('抽样验证 3 个 status 的 progress 一致', () => {
    writeMetaYaml(join(realRoot, 'requirements', 'req-001-draft'), {
      id: 'req-001-draft',
      title: 'd',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    writeMetaYaml(join(realRoot, 'requirements', 'req-002-planning'), {
      id: 'req-002-planning',
      title: 'p',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    writeMetaYaml(join(realRoot, 'requirements', 'req-003-done'), {
      id: 'req-003-done',
      title: 'D',
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mkdirSync(join(realRoot, 'requirements', 'req-002-planning', 'plan'), { recursive: true })
    writeFileSync(join(realRoot, 'requirements', 'req-002-planning', 'plan', 'tasks.md'), '')
    mkdirSync(join(realRoot, 'requirements', 'req-003-done', 'wrapup'))

    const svc = new RequirementService({ root: realRoot, git: vi.fn(), sleep: noSleep })
    const r = svc.listRequirements()
    const byId = new Map(r.map((x) => [x.id, x]))
    expect(byId.get('req-001-draft')?.progress).toBe(STATUS_PROGRESS_MAP.draft)
    expect(byId.get('req-002-planning')?.progress).toBe(STATUS_PROGRESS_MAP.planning)
    expect(byId.get('req-003-done')?.progress).toBe(STATUS_PROGRESS_MAP.done)
  })
})
