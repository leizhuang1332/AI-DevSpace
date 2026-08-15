/**
 * RequirementService.attachRepos — 异步并行 + SSE 进度 + meta.yaml 写时机
 *
 * 覆盖(issue 03):
 * - Promise.allSettled 行为:部分失败不影响其他
 * - 任一成功 → meta.yaml.branchName 写入(SSR 持久化契约)
 * - 全失败 → 不写 meta.yaml
 * - 注册表无仓库 → 提前返 E_REPO_NOT_FOUND(不调 clone)
 * - 每个 repo 推 SSE 进度事件:pending → cloning → ready / failed
 *   - 顺序约束:每个 repo 必须先有 pending,再 cloning,再 ready/failed
 *   - 多 repo 并行:不同 repo 的事件可交错
 *
 * 测试 seam:用 mock CodebaseManager(只 spy 接口),fake workspace
 * (findRepoByName 直接返条目);SseHub 用轻量 fake(数组收集事件)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepoAttachErrorCode } from '@ai-devspace/shared'
import { RequirementService } from '../services/RequirementService.js'
import type { CodebaseManager, CodebaseManagerDeps } from '../codebase/CodebaseManager.js'
import type { WorkspaceService } from '../services/WorkspaceService.js'
import type { RepoRegistryEntry } from '@ai-devspace/shared'

// ============================================================================
// Fakes —— CodebaseManager / WorkspaceService / SseHub
// ============================================================================

/**
 * Mock CodebaseManager:不调 git,通过 `cloneImpl` 控制每个 repo 的返回。
 * 记录 setPending / clearPending / clone 调用顺序供断言。
 */
function makeMockCodebaseMgr(): CodebaseManager & {
  setPendingCalls: Array<{ reqId: string; repoName: string }>
  clearPendingCalls: Array<{ reqId: string; repoName: string }>
  cloneCalls: Array<{ reqId: string; repoName: string; branch: string }>
  cloneImpl: (
    reqId: string,
    repoName: string,
    gitUrl: string,
    branchName: string,
  ) => Promise<Awaited<ReturnType<CodebaseManager['clone']>>>
} {
  const setPendingCalls: Array<{ reqId: string; repoName: string }> = []
  const clearPendingCalls: Array<{ reqId: string; repoName: string }> = []
  const cloneCalls: Array<{ reqId: string; repoName: string; branch: string }> = []
  let cloneImpl: CodebaseManager['clone'] = async (_reqId, _repoName, _gitUrl, branchName) => ({
    ok: true as const,
    path: '/tmp/cb',
    head: 'sha',
    branch: branchName,
  })

  const mgr = {
    setPendingCalls,
    clearPendingCalls,
    cloneCalls,
    set cloneImpl(fn: typeof cloneImpl) {
      cloneImpl = fn
    },
    getCodebasePath: (reqId: string, repoName: string) =>
      `/fake/requirements/${reqId}/codebase/${repoName}`,
    getPendingPath: (reqId: string, repoName: string) =>
      `/fake/requirements/${reqId}/codebase/.pending-${repoName}`,
    setPending: vi.fn(async (reqId: string, repoName: string) => {
      setPendingCalls.push({ reqId, repoName })
    }),
    clearPending: vi.fn(async (reqId: string, repoName: string) => {
      clearPendingCalls.push({ reqId, repoName })
    }),
    remove: vi.fn(async () => {}),
    listByRepo: vi.fn(async () => []),
    scanOrphanedPending: vi.fn(async () => []),
    clone: vi.fn(async (reqId: string, repoName: string, gitUrl: string, branchName: string) => {
      cloneCalls.push({ reqId, repoName, branch: branchName })
      return cloneImpl(reqId, repoName, gitUrl, branchName)
    }),
  }
  return mgr as unknown as CodebaseManager & {
    setPendingCalls: Array<{ reqId: string; repoName: string }>
    clearPendingCalls: Array<{ reqId: string; repoName: string }>
    cloneCalls: Array<{ reqId: string; repoName: string; branch: string }>
    cloneImpl: typeof cloneImpl
  }
}

/** Fake WorkspaceService:只暴露 findRepoByName,可控。 */
function makeFakeWorkspace(entries: Record<string, RepoRegistryEntry>): WorkspaceService {
  return {
    findRepoByName: async (name: string) => entries[name] ?? null,
  } as unknown as WorkspaceService
}

/** Fake SseHub:收集 publish 调用。 */
function makeFakeHub(): {
  hub: { publish: (key: string, event: unknown) => void }
  events: Array<{ key: string; event: unknown }>
} {
  const events: Array<{ key: string; event: unknown }> = []
  return {
    hub: {
      publish: (key: string, event: unknown) => {
        events.push({ key, event })
      },
    },
    events,
  }
}

// ============================================================================
// Tests
// ============================================================================

let realRoot: string
let cleanups: Array<() => void> = []

beforeEach(() => {
  realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-attach-async-'))
  cleanups = []
})

afterEach(() => {
  cleanups.forEach((fn) => fn())
  rmSync(realRoot, { recursive: true, force: true })
})

// ----------------------------------------------------------------------------
// attachRepos 并行 + 错误码语义
// ----------------------------------------------------------------------------

describe('RequirementService.attachRepos — async parallel', () => {
  it('并行成功 3 repo → 3 ok 结果 + codebasePath;调用顺序不受限', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
      b: { name: 'b', gitUrl: 'git@b', description: '' },
      c: { name: 'c', gitUrl: 'git@c', description: '' },
    })
    const { hub } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    // a 慢 50ms,b/c 立刻成功 → 验证并行性
    mockMgr.cloneImpl = async (reqId, repoName, _gitUrl, branchName) => {
      if (repoName === 'a') {
        await new Promise((r) => setTimeout(r, 50))
      }
      return {
        ok: true as const,
        path: `/cb/${reqId}/${repoName}`,
        head: 'sha',
        branch: branchName,
      }
    }

    const t0 = Date.now()
    const out = await svc.attachRepos('req-001', ['a', 'b', 'c'], 'feat/x')
    const elapsed = Date.now() - t0

    expect(out).toHaveLength(3)
    expect(out.every((r) => r.ok)).toBe(true)
    if (out[0]?.ok) {
      expect(out[0].codebasePath).toBe('/cb/req-001/a')
      expect(out[0].branch).toBe('feat/x')
      expect(out[0].base).toBe('main') // 恒为 main(ADR-0030:clone 必然带 HEAD)
    }
    // 并行性:总耗时 < 串行(3 * 50ms = 150ms;留足 buffer 给 CI 抖动)
    expect(elapsed).toBeLessThan(140)
  })

  it('部分失败:1 ok + 1 fail + 1 ok → results 数组独立', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
      b: { name: 'b', gitUrl: 'git@b', description: '' },
      c: { name: 'c', gitUrl: 'git@c', description: '' },
    })
    const { hub } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    mockMgr.cloneImpl = async (_reqId, repoName, _gitUrl, branchName) => {
      if (repoName === 'b') {
        return {
          ok: false as const,
          code: RepoAttachErrorCode.E_NETWORK,
          message: 'Could not resolve host',
        }
      }
      return {
        ok: true as const,
        path: `/cb/${repoName}`,
        head: 'sha',
        branch: branchName,
      }
    }

    const out = await svc.attachRepos('req-001', ['a', 'b', 'c'], 'feat/x')
    expect(out).toHaveLength(3)
    expect(out[0]?.ok).toBe(true)
    expect(out[1]?.ok).toBe(false)
    expect(out[2]?.ok).toBe(true)
    if (!out[1]?.ok) expect(out[1].code).toBe(RepoAttachErrorCode.E_NETWORK)
  })

  it('注册表无该 repo → 提前返 E_REPO_NOT_FOUND(不调 clone)', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
    })
    const { hub } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    const out = await svc.attachRepos('req-001', ['a', 'ghost'], 'feat/x')
    expect(out).toHaveLength(1)
    expect(out[0]?.ok).toBe(false)
    if (!out[0]?.ok) {
      expect(out[0].code).toBe(RepoAttachErrorCode.E_REPO_NOT_FOUND)
      expect(out[0].message).toContain('ghost')
    }
    // clone 没被调
    expect(mockMgr.cloneCalls).toHaveLength(0)
  })

  it('空 repoNames → 返空数组,无 meta.yaml 写', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({})
    const { hub } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    const out = await svc.attachRepos('req-001', [], 'feat/x')
    expect(out).toEqual([])
    // 没任何 meta.yaml 写
    const metaPath = join(realRoot, 'requirements', 'req-001', 'meta.yaml')
    expect(existsSync(metaPath)).toBe(false)
  })

  it('attachRepo 抛错 → results 数组转 E_INTERNAL(rejected branch 兜底)', async () => {
    const mockMgr = makeMockCodebaseMgr()
    mockMgr.cloneImpl = async () => {
      throw new Error('unexpected')
    }
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
    })
    const { hub } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })
    const out = await svc.attachRepos('req-001', ['a'], 'feat/x')
    expect(out).toHaveLength(1)
    expect(out[0]?.ok).toBe(false)
    if (!out[0]?.ok) {
      expect(out[0].code).toBe(RepoAttachErrorCode.E_INTERNAL)
      expect(out[0].message).toContain('unexpected')
    }
  })
})

// ----------------------------------------------------------------------------
// meta.yaml.branchName 持久化时机
// ----------------------------------------------------------------------------

describe('RequirementService.attachRepos · branchName 持久化', () => {
  it('任一成功 → 写 meta.yaml.branchName(SSR 契约)', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
      b: { name: 'b', gitUrl: 'git@b', description: '' },
    })
    const { hub } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    mockMgr.cloneImpl = async (_r, name, _g, branchName) => {
      if (name === 'b') {
        return {
          ok: false as const,
          code: RepoAttachErrorCode.E_NETWORK,
          message: 'fail',
        }
      }
      return {
        ok: true as const,
        path: `/cb/${name}`,
        head: 'sha',
        branch: branchName,
      }
    }
    const reqDir = join(realRoot, 'requirements', 'req-001')
    // 提前建 req 目录(ticket 04 mkdir 行为)
    mkdirSync(reqDir, { recursive: true })
    const metaPath = join(reqDir, 'meta.yaml')
    // 提前写一份初始 meta(ticket 04 行为)
    writeFileSync(
      metaPath,
      `id: req-001\ntitle: 退款功能优化\ncreatedAt: '2026-07-20T08:30:00.000Z'\n`,
    )

    const out = await svc.attachRepos('req-001', ['a', 'b'], 'feat/refund')
    expect(out[0]?.ok).toBe(true)
    expect(out[1]?.ok).toBe(false)

    // meta.yaml 已写入 branchName,且其他字段保留
    const content = readFileSync(metaPath, 'utf8')
    expect(content).toContain('id: req-001')
    expect(content).toContain('title: 退款功能优化')
    expect(content).toContain('2026-07-20T08:30:00.000Z')
    expect(content).toContain('branchName: feat/refund')
  })

  it('全失败 → 不写 meta.yaml', async () => {
    const mockMgr = makeMockCodebaseMgr()
    mockMgr.cloneImpl = async () => ({
      ok: false as const,
      code: RepoAttachErrorCode.E_NETWORK,
      message: 'fail',
    })
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
    })
    const { hub } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    const out = await svc.attachRepos('req-001', ['a'], 'feat/x')
    expect(out[0]?.ok).toBe(false)
    const metaPath = join(realRoot, 'requirements', 'req-001', 'meta.yaml')
    expect(existsSync(metaPath)).toBe(false)
  })
})

// ----------------------------------------------------------------------------
// SSE 进度事件
// ----------------------------------------------------------------------------

describe('RequirementService.attachRepos · SSE progress events', () => {
  it('每个 repo 推 3 事件:cloning → ready', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
    })
    const { hub, events } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    await svc.attachRepos('req-001', ['a'], 'feat/x')

    const repoEvents = events.filter(
      (e) =>
        typeof e.event === 'object' &&
        e.event !== null &&
        (e.event as { type?: string }).type === 'repo-clone-progress',
    )
    expect(repoEvents).toHaveLength(3) // pending + cloning + ready(每个 repo 3 条)
    expect((repoEvents[0]?.event as { status: string }).status).toBe('pending')
    expect((repoEvents[1]?.event as { status: string }).status).toBe('cloning')
    expect((repoEvents[2]?.event as { status: string }).status).toBe('ready')
    // 都发到 reqId 通道
    expect(repoEvents.every((e) => e.key === 'req-001')).toBe(true)
  })

  it('多 repo 并行:每个 repo 有 cloning + ready;顺序符合「cloning 先于 ready」', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
      b: { name: 'b', gitUrl: 'git@b', description: '' },
    })
    const { hub, events } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    await svc.attachRepos('req-001', ['a', 'b'], 'feat/x')

    const repoEvents = events
      .filter(
        (e) =>
          typeof e.event === 'object' &&
          e.event !== null &&
          (e.event as { type?: string }).type === 'repo-clone-progress',
      )
      .map((e) => e.event as { repoName: string; status: string })

    expect(repoEvents).toHaveLength(6) // a + b 各 3 条(pending + cloning + ready)
    // 每个 repo:pending → cloning → ready 顺序固定
    const orderForA = repoEvents.filter((e) => e.repoName === 'a').map((e) => e.status)
    const orderForB = repoEvents.filter((e) => e.repoName === 'b').map((e) => e.status)
    expect(orderForA).toEqual(['pending', 'cloning', 'ready'])
    expect(orderForB).toEqual(['pending', 'cloning', 'ready'])
  })

  it('clone 失败 → 推 failed 事件(附 error message)', async () => {
    const mockMgr = makeMockCodebaseMgr()
    mockMgr.cloneImpl = async () => ({
      ok: false as const,
      code: RepoAttachErrorCode.E_NETWORK,
      message: 'fail-msg',
    })
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
    })
    const { hub, events } = makeFakeHub()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
    })

    await svc.attachRepos('req-001', ['a'], 'feat/x')

    const repoEvents = events.filter(
      (e) =>
        typeof e.event === 'object' &&
        e.event !== null &&
        (e.event as { type?: string }).type === 'repo-clone-progress',
    )
    expect(repoEvents).toHaveLength(3) // pending + cloning + failed
    expect((repoEvents[1]?.event as { status: string }).status).toBe('cloning')
    expect((repoEvents[2]?.event as { status: string; error?: string }).status).toBe(
      'failed',
    )
    expect((repoEvents[2]?.event as { status: string; error?: string }).error).toBe(
      'fail-msg',
    )
  })

  it('未注入 sseHub → 不抛(单元测试常见场景)', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
    })
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      // 故意不传 sseHub
    })

    const out = await svc.attachRepos('req-001', ['a'], 'feat/x')
    expect(out[0]?.ok).toBe(true)
  })
})

// ----------------------------------------------------------------------------
// attachRepo 单独调用 —— 旁路 attachRepos 的并行逻辑
// ----------------------------------------------------------------------------

describe('RequirementService.attachRepo', () => {
  it('注册表无该 repo → E_REPO_NOT_FOUND', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({})
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
    })
    const r = await svc.attachRepo('req-001', 'ghost', 'feat/x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(RepoAttachErrorCode.E_REPO_NOT_FOUND)
  })

  it('clone 成功 → 返 codebasePath + base=main', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
    })
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
    })

    mockMgr.cloneImpl = async (_reqId, _repoName, _gitUrl, branchName) => ({
      ok: true as const,
      path: '/cb/a',
      head: 'sha',
      branch: branchName,
    })
    const r = await svc.attachRepo('req-001', 'a', 'feat/x')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.codebasePath).toBe('/cb/a')
      expect(r.branch).toBe('feat/x')
      expect(r.base).toBe('main')
    }
    // setPending / clearPending 都被调
    expect(mockMgr.setPendingCalls).toEqual([{ reqId: 'req-001', repoName: 'a' }])
    expect(mockMgr.clearPendingCalls).toEqual([{ reqId: 'req-001', repoName: 'a' }])
  })

  it('clone 失败 → clearPending 仍被调(不留半成品标记);返 result', async () => {
    const mockMgr = makeMockCodebaseMgr()
    mockMgr.cloneImpl = async () => ({
      ok: false as const,
      code: RepoAttachErrorCode.E_NETWORK,
      message: 'fail',
    })
    const ws = makeFakeWorkspace({
      a: { name: 'a', gitUrl: 'git@a', description: '' },
    })
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
    })
    const r = await svc.attachRepo('req-001', 'a', 'feat/x')
    expect(r.ok).toBe(false)
    expect(mockMgr.clearPendingCalls).toHaveLength(1)
  })
})

// ============================================================================
// Issue 12: branchName 与 upstream 默认分支同名 → E_BRANCH_EXISTS
// ============================================================================

describe('RequirementService.attachRepo · branchName vs default branch (issue 12)', () => {
  let realRoot: string

  beforeEach(() => {
    realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-issue12-'))
  })

  afterEach(() => {
    rmSync(realRoot, { recursive: true, force: true })
  })

  /**
   * ls-remote mock —— 匹配 args 返预设 stdout。
   * 不传 match 时默认返「ref: refs/heads/main\t<sha>」(默认分支 main)。
   */
  function makeLsRemoteGit(
    match?: (args: string[]) => { code: number; stdout: string; stderr: string } | null,
  ): CodebaseManagerDeps['git'] {
    return vi.fn(async (args: string[]) => {
      if (args[0] === 'ls-remote') {
        const override = match?.(args)
        if (override) return override
        // 默认 ls-remote 返 main 为默认分支
        return { code: 0, stdout: 'ref: refs/heads/main\tabc123\n', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    }) as CodebaseManagerDeps['git']
  }

  it('branchName === upstream default → E_BRANCH_EXISTS,不调 clone', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      foo: { name: 'foo', gitUrl: 'git@x', description: '' },
    })
    const { hub } = makeFakeHub()
    // 默认分支 main;用户也填 main → 应该返 E_BRANCH_EXISTS
    const git = makeLsRemoteGit()
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
      git,
    })

    const r = await svc.attachRepo('req-001', 'foo', 'main')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_BRANCH_EXISTS)
      expect(r.message).toContain('main')
    }
    // 关键:clone 不被调
    expect(mockMgr.cloneCalls).toHaveLength(0)
    // 前置校验在 setPending 之前就返了 → 不产生 pending 标记
    expect(mockMgr.setPendingCalls).toHaveLength(0)
    expect(mockMgr.clearPendingCalls).toHaveLength(0)
  })

  it('branchName 不同于 upstream default → 走原 clone 路径,行为不变', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      foo: { name: 'foo', gitUrl: 'git@x', description: '' },
    })
    const { hub } = makeFakeHub()
    const git = makeLsRemoteGit() // 默认 main
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
      git,
    })

    const r = await svc.attachRepo('req-001', 'foo', 'feat/x')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.branch).toBe('feat/x')
      // mock 默认 cloneImpl 返 path: '/tmp/cb';断言非空,精确值由 makeMockCodebaseMgr 决定
      expect(r.codebasePath).toBeTruthy()
    }
    // clone 被调
    expect(mockMgr.cloneCalls).toHaveLength(1)
  })

  it('ls-remote 失败(网络/鉴权/仓库空)→ 降级 null,不阻断(走原 clone 路径)', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      foo: { name: 'foo', gitUrl: 'git@x', description: '' },
    })
    const { hub } = makeFakeHub()
    // ls-remote 失败(code ≠ 0)
    const git = makeLsRemoteGit(() => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: Could not resolve host',
    }))
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
      git,
    })

    const r = await svc.attachRepo('req-001', 'foo', 'main')
    // ls-remote 失败 → 不知道 default 分支 → 不阻断 → 走原 clone 路径
    expect(r.ok).toBe(true)
    expect(mockMgr.cloneCalls).toHaveLength(1)
  })

  it('ls-remote stdout 无 symref(空仓库)→ 降级 null,不阻断', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      foo: { name: 'foo', gitUrl: 'git@x', description: '' },
    })
    const { hub } = makeFakeHub()
    // ls-remote 返成功但 stdout 无 symref 行(空仓库常见)
    const git = makeLsRemoteGit(() => ({
      code: 0,
      stdout: '',
      stderr: '',
    }))
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
      git,
    })

    const r = await svc.attachRepo('req-001', 'foo', 'main')
    expect(r.ok).toBe(true)
    expect(mockMgr.cloneCalls).toHaveLength(1)
  })

  it('未注入 git → fetchDefaultBranch no-op,走原 clone 路径(向后兼容)', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      foo: { name: 'foo', gitUrl: 'git@x', description: '' },
    })
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      // 不传 git
    })

    const r = await svc.attachRepo('req-001', 'foo', 'main')
    // 即使 branchName 是 main,因为没注入 git,前置校验跳过 → 走原 clone
    expect(r.ok).toBe(true)
    expect(mockMgr.cloneCalls).toHaveLength(1)
  })

  it('upstream 默认分支是 master + 用户填 master → 同样命中 E_BRANCH_EXISTS', async () => {
    const mockMgr = makeMockCodebaseMgr()
    const ws = makeFakeWorkspace({
      foo: { name: 'foo', gitUrl: 'git@x', description: '' },
    })
    const { hub } = makeFakeHub()
    // ls-remote 返 master 为默认分支
    const git = makeLsRemoteGit(() => ({
      code: 0,
      stdout: 'ref: refs/heads/master\tdef456\n',
      stderr: '',
    }))
    const svc = new RequirementService({
      root: realRoot,
      codebaseMgr: mockMgr,
      workspace: ws,
      sseHub: hub,
      git,
    })

    const r = await svc.attachRepo('req-001', 'foo', 'master')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(RepoAttachErrorCode.E_BRANCH_EXISTS)
    }
    expect(mockMgr.cloneCalls).toHaveLength(0)
  })
})

// 占位避免 lint
void ({} as CodebaseManagerDeps)