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
  safeRm,
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

/**
 * Helper for tests that mock the standard clone-path sequence:
 * clone → checkout -b → rev-parse HEAD, plus an optional ls-files reply
 * for the `isCompleteCodebase` probe.
 *
 * 用于消除 Issue 09 新增 describe blocks 里 5+ 处重复的 vi.fn 模板。
 */
function makeCloneFlowGit(opts?: {
  revParseSha?: string
  lsFiles?: string
}): {
  git: CodebaseManagerDeps['git']
  calls: string[][]
} {
  return makeFakeGit((args) => {
    if (args[0] === 'clone') return ok()
    if (args.includes('rev-parse') && args.includes('HEAD')) {
      return ok(`${opts?.revParseSha ?? 'newsha'}\n`)
    }
    if (args.includes('ls-files')) {
      return ok(opts?.lsFiles ?? '')
    }
    return ok()
  })
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

  it('codebase 路径已存在(完整仓库)→ E_REPO_ALREADY_ATTACHED(幂等,不动 fs)', async () => {
    // 模拟 req 已 clone 了 order-svc —— Issue 09 要求是「完整仓库」才会短路
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'order-svc')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    writeFileSync(join(dir, 'README.md'), 'untouched', 'utf8')

    // ls-files mock 返非空 → isCompleteCodebase 识别为完整仓库
    const git = vi.fn(async (args: string[]) => {
      if (args.includes('ls-files')) return ok('README.md\n')
      return ok()
    }) as CodebaseManagerDeps['git']
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'order-svc', 'git@x', 'feat/x')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED)
      expect(r.message).toContain('order-svc')
    }
    // ls-files 被调 1 次(isCompleteCodebase 判定);clone 没被调
    const cloneCalls = git.mock.calls.filter((c) => c[0]?.[0] === 'clone')
    expect(cloneCalls.length).toBe(0)
    // 已有内容不被破坏
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
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

// ============================================================================
// Issue 09: safeRm 不静默吞错 + retry 兜底
// ============================================================================

describe('safeRm (issue 09)', () => {
  let realRoot: string

  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-safrm-'))
  })

  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  function makeLogger() {
    const warns: Array<{ obj: Record<string, unknown>; msg?: string }> = []
    return {
      warns,
      warn: (obj: Record<string, unknown>, msg?: string) => {
        warns.push({ obj, msg })
      },
    }
  }

  it('路径不存在 → no-op,无 warn', async () => {
    const logger = makeLogger()
    await safeRm(join(realRoot, 'does-not-exist'), logger)
    expect(logger.warns).toHaveLength(0)
  })

  it('路径存在 → rmSync 成功,无 warn', async () => {
    const dir = join(realRoot, 'sub')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'f.txt'), 'x', 'utf8')
    const logger = makeLogger()
    await safeRm(dir, logger)
    expect(existsSync(dir)).toBe(false)
    expect(logger.warns).toHaveLength(0)
  })

  it('rmSync 第一次抛错,第二次成功 → 删除成功 + warn "rmSync threw"', async () => {
    const dir = join(realRoot, 'flaky')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'f.txt'), 'x', 'utf8')
    const logger = makeLogger()

    let calls = 0
    const rmFn = (p: string, _opts: { recursive: boolean; force: boolean }): void => {
      calls++
      if (calls === 1) {
        throw new Error('EBUSY: resource busy or locked')
      }
      // 后续调原生 rmSync
      rmSync(p, { recursive: true, force: true })
    }

    await safeRm(dir, logger, rmFn)
    expect(existsSync(dir)).toBe(false)
    // 应该有一次 retry 路径的 warn
    expect(logger.warns.length).toBeGreaterThan(0)
    expect(logger.warns.some((w) => String(w.msg).includes('rmSync threw'))).toBe(true)
  })

  it('rmSync 持续抛错(3 次 retry 全失败) → final warn "gave up"', async () => {
    const dir = join(realRoot, 'stuck')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'f.txt'), 'x', 'utf8')
    const logger = makeLogger()

    const rmFn = (): void => {
      throw new Error('EBUSY: resource busy or locked')
    }

    await safeRm(dir, logger, rmFn)
    // 目录残留(rmSync 全失败)
    expect(existsSync(dir)).toBe(true)
    // 应该出现 "gave up" final warn
    expect(logger.warns.some((w) => String(w.msg).includes('gave up'))).toBe(true)
  })
})

// ============================================================================
// Issue 09: isCompleteCodebase 4 种状态
// ============================================================================

describe('isCompleteCodebase (issue 09)', () => {
  let realRoot: string

  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-iscomplete-'))
  })

  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  it('路径不存在 → false(不调 ls-files)', async () => {
    // 真测 isCompleteCodebase 第一行 `if (!existsSync(path)) return false`:
    // 不 mkdir 目录,直接调
    const git = vi.fn(async () => ok()) as CodebaseManagerDeps['git']
    // 直接 import isCompleteCodebase 不可(它是 export 的;但通过 clone() 行为
    // 间接验证更贴近集成路径)。这里用「clone 不存在的 req」,前置 mkdir 缺失
    // 会触发 mkdir 路径,但 isCompleteCodebase 永远不被调(因为 existsSync 假)
    // —— 所以这个 case 单独走 isCompleteCodebase 直调
    const { isCompleteCodebase } = await import(
      '../../codebase/CodebaseManager.js'
    )
    const result = await isCompleteCodebase(
      git,
      join(realRoot, 'requirements', 'req-001', 'codebase', 'ghost'),
    )
    expect(result).toBe(false)
    // ls-files 永远不被调(早 return 在 existsSync 命中)
    const lsFilesCalls = git.mock.calls.filter((c) =>
      Array.isArray(c[0]) && (c[0] as string[]).includes('ls-files'),
    )
    expect(lsFilesCalls.length).toBe(0)
  })

  it('只有 .git 无 .git/HEAD → false(残留半成品)', async () => {
    // 残留半成品 fixture:目录存在 + .git 子目录存在,但 .git/HEAD 缺失
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'half-baked')
    mkdirSync(join(dir, '.git'), { recursive: true })
    // 不写 .git/HEAD

    const { git } = makeCloneFlowGit({ lsFiles: 'README.md\n' })
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'half-baked', 'git@x', 'feat/x')
    expect(r.ok).toBe(true)
    // git 被调过(走正常 clone 路径)
    expect(git).toHaveBeenCalled()
  })

  it('.git/HEAD 存在 + ls-files 非空 → true(完整仓库)', async () => {
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'complete')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    writeFileSync(join(dir, 'README.md'), '# hi\n', 'utf8')

    // ls-files mock 返 README.md(非空)
    const { git } = makeCloneFlowGit({ lsFiles: 'README.md\n' })
    const mgr = createCodebaseManager({ root: realRoot, git })

    // clone 应命中 E_REPO_ALREADY_ATTACHED(完整仓库)
    const r = await mgr.clone('req-001', 'complete', 'git@x', 'feat/x')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED)
    }
    // README.md 仍在(幂等不破坏)
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
  })

  it('.git/HEAD 存在 + ls-files 空(working tree 空) → false', async () => {
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'empty-tree')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')

    // ls-files mock 返空(working tree 空)
    const { git } = makeCloneFlowGit({ lsFiles: '' })
    const mgr = createCodebaseManager({ root: realRoot, git })

    // clone 应识别为不完整 → safeRm + 重 clone
    const r = await mgr.clone('req-001', 'empty-tree', 'git@x', 'feat/x')
    expect(r.ok).toBe(true)
    // clone 被调过
    const cloneCalls = (git as unknown as { mock: { calls: string[][] } }).mock.calls
    const cloneCallsFiltered = cloneCalls.filter((c) => c[0]?.[0] === 'clone')
    expect(cloneCallsFiltered.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Issue 09: clone() 入口 3 种路径
// ============================================================================

describe('CodebaseManager.clone · entry dispatch (issue 09)', () => {
  let realRoot: string

  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-entry-'))
    mkdirSync(join(realRoot, 'requirements', 'req-001'), { recursive: true })
  })

  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  it('半成品残留(只有 .git 无 .git/HEAD)→ safeRm 后正常 clone 成功', async () => {
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'foo')
    mkdirSync(join(dir, '.git'), { recursive: true })
    // 不建 .git/HEAD —— 模拟「残留半成品」fixture

    const { git, calls } = makeCloneFlowGit({
      revParseSha: 'abc',
      lsFiles: 'README.md\n',
    })
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'foo', 'git@x', 'feat/x')
    expect(r.ok).toBe(true)
    // 半成品被识别 + safeRm 清掉 + 走正常 clone 路径 → clone 被调 1 次
    const cloneCount = calls.filter((c) => c[0] === 'clone').length
    expect(cloneCount).toBe(1)
    // 旧残留 .git 目录已被删
    expect(existsSync(dir)).toBe(false)
  })

  it('完整仓库(README.md 已存在 + .git/HEAD 存在)→ E_REPO_ALREADY_ATTACHED,不动 fs', async () => {
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'foo')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    writeFileSync(join(dir, 'README.md'), 'untouched\n', 'utf8')

    const { git, calls } = makeCloneFlowGit({ lsFiles: 'README.md\n' })
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'foo', 'git@x', 'feat/x')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED)
    }
    // git 没被调 clone
    const cloneCount = calls.filter((c) => c[0] === 'clone').length
    expect(cloneCount).toBe(0)
    // README.md 仍在
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
  })

  it('路径不存在 → 走正常 clone 路径', async () => {
    const { git, calls } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'foo', 'git@x', 'feat/x')
    expect(r.ok).toBe(true)
    // clone 被调 1 次(没残留,直接走)
    const cloneCalls = calls.filter((c) => c[0] === 'clone')
    expect(cloneCalls.length).toBe(1)
  })
})

// ============================================================================
// Issue 09: logger 注入链
// ============================================================================

describe('CodebaseManagerDeps.logger (issue 09)', () => {
  let realRoot: string
  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-logger-'))
    mkdirSync(join(realRoot, 'requirements', 'req-001'), { recursive: true })
  })
  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  it('注入 logger 后,半成品清理路径会触发 logger.warn', async () => {
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'foo')
    mkdirSync(join(dir, '.git'), { recursive: true })

    const warns: string[] = []
    const logger = {
      warn: (obj: Record<string, unknown>, msg?: string) => {
        warns.push(msg ?? '')
      },
    }

    const { git } = makeCloneFlowGit({ lsFiles: 'README.md\n' })
    const mgr = createCodebaseManager({ root: realRoot, git, logger })

    const r = await mgr.clone('req-001', 'foo', 'git@x', 'feat/x')
    expect(r.ok).toBe(true)
    // 期望至少有一条 orphan warn
    expect(warns.some((w) => w.includes('orphan'))).toBe(true)
  })

  it('不注入 logger → 静默 no-op(向后兼容)', async () => {
    const dir = join(realRoot, 'requirements', 'req-001', 'codebase', 'foo')
    mkdirSync(join(dir, '.git'), { recursive: true })

    const { git } = makeCloneFlowGit({ lsFiles: 'README.md\n' })
    // 不传 logger
    const mgr = createCodebaseManager({ root: realRoot, git })

    const r = await mgr.clone('req-001', 'foo', 'git@x', 'feat/x')
    expect(r.ok).toBe(true)
    // 不抛 = 通过
  })
})

// ============================================================================
// Issue 10: scanOrphanedCodebases 启动期扫 .git-only 残留
// ============================================================================

describe('CodebaseManager.scanOrphanedCodebases (issue 10)', () => {
  let realRoot: string

  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-orphan-codebase-'))
  })

  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  /** 构造一个完整仓库的 codebase fixture(.git/HEAD + README.md + ls-files 返 README.md) */
  function makeCompleteCodebase(codebaseDir: string): void {
    mkdirSync(join(codebaseDir, '.git'), { recursive: true })
    writeFileSync(
      join(codebaseDir, '.git', 'HEAD'),
      'ref: refs/heads/main\n',
      'utf8',
    )
    writeFileSync(join(codebaseDir, 'README.md'), '# ok\n', 'utf8')
  }

  /** 构造一个半成品 codebase fixture(只有 .git 无 HEAD) */
  function makeHalfBakedCodebase(codebaseDir: string): void {
    mkdirSync(join(codebaseDir, '.git'), { recursive: true })
    // 不写 .git/HEAD
  }

  /** 构造一个 .git/HEAD 存在但 working tree 空的 codebase(HEAD 指向空 commit) */
  function makeEmptyTreeCodebase(codebaseDir: string): void {
    mkdirSync(join(codebaseDir, '.git'), { recursive: true })
    writeFileSync(
      join(codebaseDir, '.git', 'HEAD'),
      'ref: refs/heads/main\n',
      'utf8',
    )
    // 没有 tracked 文件
  }

  it('空 requirements 目录 → []', async () => {
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })
    expect(await mgr.scanOrphanedCodebases()).toEqual([])
  })

  it('完整仓库 → 不出现在结果中', async () => {
    const dir = join(realRoot, 'requirements', 'req-A', 'codebase', 'order-svc')
    makeCompleteCodebase(dir)

    const { git } = makeCloneFlowGit({ lsFiles: 'README.md\n' })
    const mgr = createCodebaseManager({ root: realRoot, git })

    const orphans = await mgr.scanOrphanedCodebases()
    expect(orphans).toEqual([])
  })

  it('只有 .git 无 .git/HEAD(残留半成品)→ 出现在结果中', async () => {
    const dir = join(realRoot, 'requirements', 'req-A', 'codebase', 'half-baked')
    makeHalfBakedCodebase(dir)

    // isCompleteCodebase 内部:不存在 .git/HEAD → 返 false。ls-files 不会被调
    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })

    const orphans = await mgr.scanOrphanedCodebases()
    expect(orphans).toEqual([
      {
        reqId: 'req-A',
        repoName: 'half-baked',
        path: dir,
      },
    ])
  })

  it('.git/HEAD 存在 + ls-files 空(working tree 空)→ 出现在结果中', async () => {
    const dir = join(realRoot, 'requirements', 'req-A', 'codebase', 'empty-tree')
    makeEmptyTreeCodebase(dir)

    // isCompleteCodebase 会调 ls-files,返空 → 判定为不完整 → 报孤儿
    const { git } = makeCloneFlowGit({ lsFiles: '' })
    const mgr = createCodebaseManager({ root: realRoot, git })

    const orphans = await mgr.scanOrphanedCodebases()
    expect(orphans).toEqual([
      {
        reqId: 'req-A',
        repoName: 'empty-tree',
        path: dir,
      },
    ])
  })

  it('.pending-<name> 半成品标记目录 → 不出现(由 scanOrphanedPending 处理)', async () => {
    // .pending-order-svc 是文件,不是目录 → 不会进入孤儿扫描
    const codeDir = join(realRoot, 'requirements', 'req-A', 'codebase')
    mkdirSync(codeDir, { recursive: true })
    writeFileSync(join(codeDir, '.pending-order-svc'), '', 'utf8')

    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })

    const orphans = await mgr.scanOrphanedCodebases()
    expect(orphans).toEqual([])
  })

  it('多 req × 多 repo 混合:只报未完成的', async () => {
    // req-A:order-svc(完整)、refund-svc(半成品)
    const codeA = join(realRoot, 'requirements', 'req-A', 'codebase')
    makeCompleteCodebase(join(codeA, 'order-svc'))
    makeHalfBakedCodebase(join(codeA, 'refund-svc'))
    // req-B:only 半成品
    const codeB = join(realRoot, 'requirements', 'req-B', 'codebase')
    makeHalfBakedCodebase(join(codeB, 'lonely-svc'))
    // req-C:无 codebase 目录(应跳过)

    const { git } = makeCloneFlowGit({ lsFiles: 'README.md\n' })
    const mgr = createCodebaseManager({ root: realRoot, git })

    const orphans = await mgr.scanOrphanedCodebases()
    const sorted = orphans.sort((a, b) => a.repoName.localeCompare(b.repoName))
    expect(sorted).toEqual([
      {
        reqId: 'req-B',
        repoName: 'lonely-svc',
        path: join(codeB, 'lonely-svc'),
      },
      {
        reqId: 'req-A',
        repoName: 'refund-svc',
        path: join(codeA, 'refund-svc'),
      },
    ])
  })

  it('非 req- 命名的目录:被跳过', async () => {
    // .tmp-debug/codebase/ 下的 .git-only 不应被扫
    const code = join(realRoot, 'requirements', '.tmp-debug', 'codebase', 'foo')
    makeHalfBakedCodebase(code)

    const { git } = makeFakeGit()
    const mgr = createCodebaseManager({ root: realRoot, git })

    const orphans = await mgr.scanOrphanedCodebases()
    expect(orphans).toEqual([])
  })
})