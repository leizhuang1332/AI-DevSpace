/**
 * WorktreeManager tests —— ADR-0010 Q4 + ADR-0003 (P1 worktree 管理)
 *
 * 覆盖:
 *  - 路径约定:workspaceRoot/repos/<repo> + workspaceRoot/requirements/<req>/repos/<repo>
 *  - createWorktree 调用正确的 git 命令(args 顺序)
 *  - removeWorktree 调用 git worktree remove
 *  - listWorktrees 解析 git worktree list 的 porcelain 格式
 *  - getWorktreePath 是纯计算,不调 git
 *  - gitExec 失败 → createWorktree reject
 *
 * 不依赖真实 git:GitExec 通过 factory 注入,fake 实现记录命令。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createWorktreeManager,
  type GitExec,
  type GitExecResult,
} from '../worktree/WorktreeManager.js'

const ROOT = '/fake/aidevspace'

function ok(stdout = '', stderr = ''): GitExecResult {
  return { code: 0, stdout, stderr }
}
function fail(stderr: string, code = 1): GitExecResult {
  return { code, stdout: '', stderr }
}

/** 记录所有 git 调用的 fake executor */
function makeFakeGit(respond?: (args: string[]) => GitExecResult): {
  git: GitExec
  calls: string[][]
} {
  const calls: string[][] = []
  const git: GitExec = vi.fn(async (args: string[]) => {
    calls.push(args)
    return respond ? respond(args) : ok()
  })
  return { git, calls }
}

describe('createWorktreeManager', () => {
  describe('getWorktreePath', () => {
    it('computes requirements/<reqId>/repos/<repoName> path', () => {
      const { git } = makeFakeGit()
      const mgr = createWorktreeManager({ root: ROOT, git })
      expect(mgr.getWorktreePath('REFUND-001', 'order-svc')).toBe(
        '/fake/aidevspace/requirements/REFUND-001/repos/order-svc',
      )
    })

    it('does not invoke git (pure path math)', () => {
      const { git, calls } = makeFakeGit()
      const mgr = createWorktreeManager({ root: ROOT, git })
      mgr.getWorktreePath('r', 'svc')
      mgr.getWorktreePath('r2', 'svc2')
      expect(calls).toHaveLength(0)
    })
  })

  describe('getRepoPath', () => {
    it('computes the global pool path repos/<repoName>', () => {
      const { git } = makeFakeGit()
      const mgr = createWorktreeManager({ root: ROOT, git })
      expect(mgr.getRepoPath('order-svc')).toBe('/fake/aidevspace/repos/order-svc')
    })
  })

  describe('createWorktree', () => {
    it('runs git worktree add with correct args (path, -b branch, base)', async () => {
      const { git, calls } = makeFakeGit()
      const mgr = createWorktreeManager({ root: ROOT, git })

      await mgr.createWorktree('REFUND-001', 'order-svc', 'feat/refund')

      expect(calls).toHaveLength(1)
      // argv 顺序:worktree add <path> -b <branch> <base>
      expect(calls[0]).toEqual([
        '-C',
        '/fake/aidevspace/repos/order-svc',
        'worktree',
        'add',
        '/fake/aidevspace/requirements/REFUND-001/repos/order-svc',
        '-b',
        'feat/refund',
        'master',
      ])
    })

    it('propagates git exec failure as a rejection', async () => {
      const { git } = makeFakeGit(() => fail('fatal: invalid reference: master'))
      const mgr = createWorktreeManager({ root: ROOT, git })

      await expect(
        mgr.createWorktree('REFUND-001', 'order-svc', 'feat/refund'),
      ).rejects.toThrow(/invalid reference: master/)
    })
  })

  describe('removeWorktree', () => {
    it('runs git worktree remove from inside the repo', async () => {
      const { git, calls } = makeFakeGit()
      const mgr = createWorktreeManager({ root: ROOT, git })

      await mgr.removeWorktree('REFUND-001', 'order-svc')

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual([
        '-C',
        '/fake/aidevspace/repos/order-svc',
        'worktree',
        'remove',
        '/fake/aidevspace/requirements/REFUND-001/repos/order-svc',
      ])
    })

    it('propagates git exec failure as a rejection', async () => {
      const { git } = makeFakeGit(() => fail('fatal: not a working tree'))
      const mgr = createWorktreeManager({ root: ROOT, git })

      await expect(mgr.removeWorktree('REFUND-001', 'order-svc')).rejects.toThrow(
        /not a working tree/,
      )
    })
  })

  describe('listWorktrees', () => {
    it('parses porcelain v1 output into WorktreeInfo entries', async () => {
      const porcelain = [
        'worktree /fake/aidevspace/repos/order-svc',
        'HEAD abc123',
        'branch refs/heads/master',
        '',
        'worktree /fake/aidevspace/requirements/REFUND-001/repos/order-svc',
        'HEAD def456',
        'branch refs/heads/feat/refund',
        '',
      ].join('\n')
      const { git } = makeFakeGit(() => ok(porcelain))
      const mgr = createWorktreeManager({ root: ROOT, git })

      const list = await mgr.listWorktrees('order-svc')

      expect(list).toHaveLength(2)
      expect(list[0]).toEqual({
        path: '/fake/aidevspace/repos/order-svc',
        head: 'abc123',
        branch: 'master',
      })
      expect(list[1]).toEqual({
        path: '/fake/aidevspace/requirements/REFUND-001/repos/order-svc',
        head: 'def456',
        branch: 'feat/refund',
      })
    })

    it('skips detached (no branch) entries gracefully', async () => {
      const porcelain = [
        'worktree /fake/aidevspace/repos/order-svc',
        'HEAD abc123',
        'branch refs/heads/master',
        '',
        'worktree /fake/aidevspace/repos/detached',
        'HEAD 000000',
        '',
      ].join('\n')
      const { git } = makeFakeGit(() => ok(porcelain))
      const mgr = createWorktreeManager({ root: ROOT, git })

      const list = await mgr.listWorktrees('order-svc')

      expect(list).toHaveLength(1)
      expect(list[0].branch).toBe('master')
    })

    it('returns empty array when output is empty', async () => {
      const { git } = makeFakeGit(() => ok(''))
      const mgr = createWorktreeManager({ root: ROOT, git })
      const list = await mgr.listWorktrees('order-svc')
      expect(list).toEqual([])
    })
  })
})