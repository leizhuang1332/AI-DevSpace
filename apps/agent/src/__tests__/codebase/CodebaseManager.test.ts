/**
 * CodebaseManager tests —— issue 03 (ADR-0030 D3 / D5)
 *
 * 覆盖:
 * - 路径约定:getCodebasePath / getPendingPath 是纯字符串拼接
 * - clone 成功:git 调用顺序 + checkout -b 分支名 + rev-parse HEAD
 * - clone 失败:clone error / checkout error / mkdir error → 错误码映射
 * - clone 路径已存在:E_REPO_ALREADY_ATTACHED(幂等校验,不破坏)
 * - clone 半成品清理:checkout 失败 → 自动 rm -rf
 * - remove:存在 / 不存在都 no-op
 * - setPending / clearPending:空文件 + 路径解析
 * - scanOrphanedPending:扫所有 .pending-* 标记
 * - listByRepo:聚合按 reqId,失败降级为 null
 * - mapCloneError:纯函数 —— 网络 / 鉴权 / 磁盘满 / repo not found / fallback
 *
 * 不依赖真实 git,GitExec 通过 factory 注入 fake(vi.fn 记录 args)。
 * 部分测试用 mkdtempSync + 真实 fs(createDefaultGitExec 同款隔离风格)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepoAttachErrorCode } from '@ai-devspace/shared'
import {
  createCodebaseManager,
  mapCloneError,
  type CodebaseManagerDeps,
} from '../../codebase/CodebaseManager.js'
import { toPosixPath } from '../../worktree/pathUtil.js'

const ROOT = '/fake/aidevsp-codebase'

function ok(stdout = '', stderr = ''): {
  code: number
  stdout: string
  stderr: string
} {
  return { code: 0, stdout, stderr }
}
function fail(stderr: string, code = 1): {
  code: number
  stdout: string
  stderr: string
} {
  return { code, stdout: '', stderr }
}

/**
 * 记录所有 git 调用的 fake executor。respond 可基于 args 返回不同结果
 * (默认 ok,匹配首个响应)。
 */
function makeFakeGit(
  respond?: (args: string[]) => { code: number; stdout: string; stderr: string },
): {
  git: CodebaseManagerDeps['git']
  calls: string[][]
} {
  const calls: string[][] = []
  const git: CodebaseManagerDeps['git'] = vi.fn(async (args) => {
    calls.push(args)
    return respond ? respond(args) : ok()
  })
  return { git, calls }
}

// ============================================================================
// getCodebasePath / getPendingPath
// ============================================================================

describe('CodebaseManager · getCodebasePath / getPendingPath', () => {
  it('computes requirements/<reqId>/codebase/<repoName>', () => {
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: ROOT, git })
    expect(mgr.getCodebasePath('REFUND-001', 'order-svc')).toBe(
      join(ROOT, 'requirements', 'REFUND-001', 'codebase', 'order-svc'),
    )
    expect(mgr.getPendingPath('REFUND-001', 'order-svc')).toBe(
      join(ROOT, 'requirements', 'REFUND-001', 'codebase', '.pending-order-svc'),
    )
  })

  it('does not invoke git (pure path math)', () => {
    const { git, calls } = makeFakeGit()
    const mgr = createCodebaseManager({ root: ROOT, git })
    mgr.getCodebasePath('a', 'b')
    mgr.getPendingPath('a', 'b')
    expect(calls).toHaveLength(0)
  })
})

// ============================================================================
// clone —— 成功路径
// ============================================================================

describe('CodebaseManager.clone · success', () => {
  let realRoot: string
  let cleanups: Array<() => void> = []

  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-codebase-ok-'))
    cleanups = []
    // 提前建 reqDir 让 CodebaseManager 不需要 mkdir
    mkdirSync(join(realRoot, 'requirements', 'req-001'), { recursive: true })
  })

  afterEach(() => {
    cleanups.forEach((fn) => fn())
    rmSync(realRoot, { recursive: true, force: true })
  })

  it('clone + checkout -b 成功 → rev-parse HEAD 拿 commit', async () => {
    const { git, calls } = makeFakeGit()
    // mock 第二/三次调用 (clone → checkout → rev-parse HEAD)
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'order-svc', 'git@github.com:co/order.git', 'feat/x')

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.path).toBe(
        join(realRoot, 'requirements', 'req-001', 'codebase', 'order-svc'),
      )
      expect(r.head).toBe('')
      expect(r.branch).toBe('feat/x')
    }
    // 调用序列:clone → checkout -b → rev-parse HEAD(3 次)
    expect(calls.length).toBe(3)
    expect(calls[0]?.[0]).toBe('clone')
    expect(calls[0]?.[1]).toBe('git@github.com:co/order.git')
    // 注:实际传给 git 的 codebasePath 走 `toPosixPath`(Windows 上
    // 变 `/c/...`,POSIX 上保持 `/...`),所以断言必须用 toPosixPath 包一层。
    const codebasePathPosix = toPosixPath(
      join(realRoot, 'requirements', 'req-001', 'codebase', 'order-svc'),
    )
    // checkout -b <branch>
    expect(calls[1]).toEqual([
      '-C',
      codebasePathPosix,
      'checkout',
      '-b',
      'feat/x',
    ])
    // rev-parse HEAD
    expect(calls[2]).toEqual([
      '-C',
      codebasePathPosix,
      'rev-parse',
      'HEAD',
    ])
  })

  it('rev-parse HEAD 成功 → head 字段返回 commit SHA', async () => {
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'clone') return ok()
      if (args.includes('rev-parse') && args.includes('HEAD')) {
        return ok('abc123def456\n')
      }
      return ok()
    }) as CodebaseManagerDeps['git']
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'order-svc', 'git@x', 'b1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.head).toBe('abc123def456')
  })
})

// ============================================================================
// clone —— 失败路径
// ============================================================================

describe('CodebaseManager.clone · failure', () => {
  let realRoot: string
  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-codebase-fail-'))
    mkdirSync(join(realRoot, 'requirements', 'req-001'), { recursive: true })
  })
  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  it('codebase 路径已存在 → E_REPO_ALREADY_ATTACHED(幂等,不动 fs)', async () => {
    // 模拟 req 已 clone 了 order-svc
    mkdirSync(join(realRoot, 'requirements', 'req-001', 'codebase', 'order-svc'), {
      recursive: true,
    })
    writeFileSync(
      join(realRoot, 'requirements', 'req-001', 'codebase', 'order-svc', 'README.md'),
      'untouched',
      'utf8',
    )
    const { git, calls } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'order-svc', 'git@x', 'feat/x')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED)
      expect(r.message).toContain('order-svc')
    }
    // 不调 git
    expect(calls.length).toBe(0)
    // 已有内容不被破坏
    expect(existsSync(join(realRoot, 'requirements', 'req-001', 'codebase', 'order-svc', 'README.md'))).toBe(true)
  })

  it('clone git 失败 → 错误码映射;半成品目录存在时**不**清(由调用方决定)', async () => {
    // mkdir 提前建好,clone 调用前 codebasePath 不存在 → 进入 clone 分支
    const { git, calls } = makeFakeGit((args) => {
      if (args[0] === 'clone') return fail('fatal: Could not resolve host: github.com', 128)
      return ok()
    })
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'order-svc', 'git@github.com:x/y.git', 'feat/x')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_NETWORK)
      expect(r.message).toMatch(/Could not resolve host/)
    }
    expect(calls.length).toBe(1) // 只调了 clone
  })

  it('clone 成功但 checkout -b 失败 → 自动 rm 半成品 + 返错', async () => {
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'clone') return ok()
      if (args.includes('checkout')) return fail('fatal: invalid reference', 128)
      return ok()
    }) as CodebaseManagerDeps['git']
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'order-svc', 'git@x', 'feat/x')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_INTERNAL)
      expect(r.message).toMatch(/invalid reference|fatal/i)
    }
    // 半成品目录被清(虽然我们这里 mock git,没真实 clone 出来;但半成品是 mkdir 提前建的,
    // checkout 失败会走 safeRm 把那个目录清掉)
    expect(existsSync(join(realRoot, 'requirements', 'req-001', 'codebase', 'order-svc'))).toBe(false)
  })

  it('clone / checkout 全部抛错 → 兜底 E_INTERNAL + clearPending 友好失败', async () => {
    const git = vi.fn(async () => {
      throw new Error('unexpected')
    }) as CodebaseManagerDeps['git']
    const mgr = createCodebaseManager({ root: realRoot, git })
    const r = await mgr.clone('req-001', 'order-svc', 'git@x', 'feat/x')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_INTERNAL)
      expect(r.message).toContain('unexpected')
    }
  })
})

// ============================================================================
// mapCloneError 纯函数
// ============================================================================

describe('mapCloneError', () => {
  it('网络错 → E_NETWORK', () => {
    expect(mapCloneError('fatal: Could not resolve host: github.com')).toBe(
      RepoAttachErrorCode.E_NETWORK,
    )
    expect(mapCloneError('EAI_AGAIN')).toBe(RepoAttachErrorCode.E_NETWORK)
    expect(mapCloneError('Connection refused')).toBe(RepoAttachErrorCode.E_NETWORK)
    expect(mapCloneError('Network is unreachable')).toBe(RepoAttachErrorCode.E_NETWORK)
  })

  it('鉴权错 → E_AUTH', () => {
    expect(mapCloneError('Permission denied (publickey).')).toBe(
      RepoAttachErrorCode.E_AUTH,
    )
    expect(mapCloneError('fatal: Authentication failed')).toBe(
      RepoAttachErrorCode.E_AUTH,
    )
  })

  it('磁盘满 → E_DISK_FULL', () => {
    expect(mapCloneError('fatal: unable to write file: No space left on device')).toBe(
      RepoAttachErrorCode.E_DISK_FULL,
    )
  })

  it('repo 不存在 → E_REPO_NOT_FOUND', () => {
    expect(mapCloneError('fatal: Repository not found.')).toBe(
      RepoAttachErrorCode.E_REPO_NOT_FOUND,
    )
  })

  it('未知 stderr → E_INTERNAL', () => {
    expect(mapCloneError('random failure')).toBe(RepoAttachErrorCode.E_INTERNAL)
    expect(mapCloneError('')).toBe(RepoAttachErrorCode.E_INTERNAL)
  })
})

// ============================================================================
// remove / setPending / clearPending / scanOrphanedPending
// ============================================================================

describe('CodebaseManager · remove + pending APIs', () => {
  let realRoot: string
  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-codebase-pending-'))
  })
  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  it('remove:目录存在 → rm -rf;不存在 → no-op(不抛)', async () => {
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })
    // 1. 不存在
    await mgr.remove('req-001', 'order-svc') // 不抛
    // 2. 存在
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'order-svc')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'f.txt'), 'x', 'utf8')
    await mgr.remove('req-001', 'order-svc')
    expect(existsSync(dir)).toBe(false)
  })

  it('setPending:写空文件到 .pending-<name>;clearPending 删除它', async () => {
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })
    await mgr.setPending('req-001', 'order-svc')
    const p = mgr.getPendingPath('req-001', 'order-svc')
    expect(existsSync(p)).toBe(true)
    await mgr.clearPending('req-001', 'order-svc')
    expect(existsSync(p)).toBe(false)
    // 再清一次(已不存在) → no-op
    await mgr.clearPending('req-001', 'order-svc')
  })

  it('scanOrphanedPending:扫所有 .pending-* 残留', async () => {
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })
    // req-A:有 2 个 pending(订单 + 退款)
    const codeA = join(realRoot, 'requirements', 'req-A', 'codebase')
    mkdirSync(codeA, { recursive: true })
    writeFileSync(join(codeA, '.pending-order-svc'), '', 'utf8')
    writeFileSync(join(codeA, '.pending-refund-svc'), '', 'utf8')
    // req-B:无 pending
    mkdirSync(join(realRoot, 'requirements', 'req-B', 'codebase'), { recursive: true })
    // 非 req- 开头的目录:不应该被扫
    mkdirSync(join(realRoot, 'requirements', '.tmp-debug', 'codebase'), {
      recursive: true,
    })
    writeFileSync(
      join(realRoot, 'requirements', '.tmp-debug', 'codebase', '.pending-x'),
      '',
      'utf8',
    )

    const orphans = await mgr.scanOrphanedPending()
    expect(orphans.sort((a, b) => a.repoName.localeCompare(b.repoName))).toEqual([
      {
        reqId: 'req-A',
        repoName: 'order-svc',
        path: join(realRoot, 'requirements', 'req-A', 'codebase', 'order-svc'),
      },
      {
        reqId: 'req-A',
        repoName: 'refund-svc',
        path: join(realRoot, 'requirements', 'req-A', 'codebase', 'refund-svc'),
      },
    ])
  })

  it('scanOrphanedPending:requirements/ 不存在 → 返 []', async () => {
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })
    const orphans = await mgr.scanOrphanedPending()
    expect(orphans).toEqual([])
  })
})

// ============================================================================
// listByRepo —— 按 reqId 聚合
// ============================================================================

describe('CodebaseManager.listByRepo', () => {
  let realRoot: string
  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-codebase-list-'))
  })
  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  it('空仓库 → []', async () => {
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })
    expect(await mgr.listByRepo('order-svc')).toEqual([])
  })

  it('req-A + req-B 都 clone 了 order-svc → 聚合返回 2 条,branch/head 由 git 派生', async () => {
    mkdirSync(join(realRoot, 'requirements', 'req-A', 'codebase', 'order-svc'), {
      recursive: true,
    })
    mkdirSync(join(realRoot, 'requirements', 'req-B', 'codebase', 'order-svc'), {
      recursive: true,
    })

    const git = vi.fn(async (args: string[]) => {
      if (args.includes('--abbrev-ref')) {
        return ok('feat/x\n')
      }
      if (args.includes('rev-parse') && args.includes('HEAD')) {
        return ok('abc123\n')
      }
      return ok()
    }) as CodebaseManagerDeps['git']
    const mgr = createCodebaseManager({ root: realRoot, git })

    const list = await mgr.listByRepo('order-svc')
    expect(list).toHaveLength(2)
    expect(list.find((e) => e.requirementId === 'req-A')).toMatchObject({
      branch: 'feat/x',
      head: 'abc123',
      pending: false,
    })
    expect(list.find((e) => e.requirementId === 'req-B')).toMatchObject({
      branch: 'feat/x',
      head: 'abc123',
      pending: false,
    })
  })

  it('存在 .pending-<name> 标记 → pending=true', async () => {
    mkdirSync(join(realRoot, 'requirements', 'req-A', 'codebase', 'order-svc'), {
      recursive: true,
    })
    writeFileSync(
      join(realRoot, 'requirements', 'req-A', 'codebase', '.pending-order-svc'),
      '',
      'utf8',
    )
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })
    const list = await mgr.listByRepo('order-svc')
    expect(list).toHaveLength(1)
    expect(list[0]?.pending).toBe(true)
  })

  it('origin/ 前缀 剥离;detached HEAD(branch=HEAD) → null', async () => {
    mkdirSync(join(realRoot, 'requirements', 'req-A', 'codebase', 'order-svc'), {
      recursive: true,
    })
    const git = vi.fn(async (args: string[]) => {
      if (args.includes('--abbrev-ref')) return ok('origin/main\n')
      if (args.includes('rev-parse') && args.includes('HEAD')) return ok('def456\n')
      return ok()
    }) as CodebaseManagerDeps['git']
    const mgr = createCodebaseManager({ root: realRoot, git })
    const list = await mgr.listByRepo('order-svc')
    expect(list[0]?.branch).toBe('main') // 剥 origin/

    // detached HEAD(branch=HEAD) → null
    const git2 = vi.fn(async (args: string[]) => {
      if (args.includes('--abbrev-ref')) return ok('HEAD\n')
      return ok('sha\n')
    }) as CodebaseManagerDeps['git']
    const mgr2 = createCodebaseManager({ root: realRoot, git: git2 })
    const list2 = await mgr2.listByRepo('order-svc')
    expect(list2[0]?.branch).toBeNull()
  })

  it('其他 repo 的 codebase 不被列入', async () => {
    mkdirSync(join(realRoot, 'requirements', 'req-A', 'codebase', 'order-svc'), {
      recursive: true,
    })
    mkdirSync(join(realRoot, 'requirements', 'req-A', 'codebase', 'refund-svc'), {
      recursive: true,
    })
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })
    const list = await mgr.listByRepo('order-svc')
    expect(list).toHaveLength(1)
    expect(list[0]?.path).toContain('order-svc')
  })
})

// ROOT 占位(纯路径测试用)
void ROOT
void readdirSync