/**
 * WorktreeManager —— ADR-0010 Q4 + ADR-0003 (P1 worktree 管理)
 *
 * 路径约定(由 WorkspaceService 一致化):
 *   - 全局仓库池:<root>/repos/<repoName>/(主仓库,只 clone 一次)
 *   - 需求 worktree:<root>/requirements/<reqId>/repos/<repoName>/
 *
 * Git 调用都从全局仓库池 cwd 出发(`-C <repoPath>`),不污染 worktree 本身。
 * 所有 git 命令经过 `gitExec` 抽象层(由 deps.git 注入),便于测试 & 替换实现。
 *
 * 失败处理:git 退出码 ≠ 0 时,组装一个包含 stderr 的 Error 抛出。
 */

import { posixJoin } from './pathUtil.js'

export interface GitExecResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * 执行一条 git 命令。
 * 实现可以走 `child_process.execFile('git', args)` 或调外部脚本。
 * @param args  不含 'git' 本身(只放参数)。WorktreeManager 通过 `-C <cwd>` 指定 cwd。
 */
export type GitExec = (args: string[]) => Promise<GitExecResult>

export interface WorktreeInfo {
  path: string
  head: string
  /** 不含 refs/heads/ 前缀;detached HEAD 时为 null */
  branch: string | null
}

export interface WorktreeManagerDeps {
  root: string
  git: GitExec
}

export interface WorktreeManager {
  /** 计算一个 req × repo 的 worktree 路径(纯字符串拼接) */
  getWorktreePath(reqId: string, repoName: string): string
  /** 计算全局仓库池的路径 */
  getRepoPath(repoName: string): string
  /**
   * 在主仓库里给 req 建一个 worktree:
   *   git -C <repoPath> worktree add <worktreePath> -b <branchName> <baseBranch>
   * 默认 base = master。
   */
  createWorktree(reqId: string, repoName: string, branchName: string, base?: string): Promise<void>
  /**
   * 移除 req × repo 对应的 worktree:
   *   git -C <repoPath> worktree remove <worktreePath>
   */
  removeWorktree(reqId: string, repoName: string): Promise<void>
  /**
   * 列出 repo 下所有 worktree,解析 porcelain v1 输出。
   * (跨 repoName 的全局列表由调用方自己聚合 —— Manager 只看单个 repo)
   */
  listWorktrees(repoName: string): Promise<WorktreeInfo[]>
}

export function createWorktreeManager(deps: WorktreeManagerDeps): WorktreeManager {
  const { root, git } = deps

  function getRepoPath(repoName: string): string {
    return posixJoin(root, 'repos', repoName)
  }

  function getWorktreePath(reqId: string, repoName: string): string {
    return posixJoin(root, 'requirements', reqId, 'repos', repoName)
  }

  async function createWorktree(
    reqId: string,
    repoName: string,
    branchName: string,
    base = 'master',
  ): Promise<void> {
    const repoPath = getRepoPath(repoName)
    const wtPath = getWorktreePath(reqId, repoName)
    const args = [
      '-C',
      repoPath,
      'worktree',
      'add',
      wtPath,
      '-b',
      branchName,
      base,
    ]
    const result = await git(args)
    if (result.code !== 0) {
      throw new GitError('createWorktree', args, result)
    }
  }

  async function removeWorktree(reqId: string, repoName: string): Promise<void> {
    const repoPath = getRepoPath(repoName)
    const wtPath = getWorktreePath(reqId, repoName)
    const args = ['-C', repoPath, 'worktree', 'remove', wtPath]
    const result = await git(args)
    if (result.code !== 0) {
      throw new GitError('removeWorktree', args, result)
    }
  }

  async function listWorktrees(repoName: string): Promise<WorktreeInfo[]> {
    const repoPath = getRepoPath(repoName)
    const args = ['-C', repoPath, 'worktree', 'list', '--porcelain']
    const result = await git(args)
    if (result.code !== 0) {
      throw new GitError('listWorktrees', args, result)
    }
    return parsePorcelainWorktreeList(result.stdout)
  }

  return {
    getRepoPath,
    getWorktreePath,
    createWorktree,
    removeWorktree,
    listWorktrees,
  }
}

/** git worktree list --porcelain 输出 → WorktreeInfo[] */
/** detached HEAD (无 branch 行) 直接跳过 —— 我们只关心「分支上的 worktree」 */
function parsePorcelainWorktreeList(stdout: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = []
  const blocks = stdout.split(/\n\n+/).filter((b) => b.trim().length > 0)
  for (const block of blocks) {
    let path = ''
    let head = ''
    let branch: string | null = null
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length).trim()
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length).trim()
      } else if (line.startsWith('branch ')) {
        const raw = line.slice('branch '.length).trim()
        // refs/heads/<name> → <name>
        branch = raw.startsWith('refs/heads/') ? raw.slice('refs/heads/'.length) : raw
      }
    }
    // detached HEAD(没 branch)跳过,不混入列表
    if (path && branch !== null) out.push({ path, head, branch })
  }
  return out
}

export class GitError extends Error {
  constructor(
    public readonly op: string,
    public readonly args: string[],
    public readonly result: GitExecResult,
  ) {
    super(`git ${op} failed (code=${result.code}): ${result.stderr.trim() || '(no stderr)'}`)
    this.name = 'GitError'
  }
}

/**
 * 默认的 GitExec —— 用 child_process.execFile 调系统 git。
 * 默认实现,不强制使用(便于单元测试注入 fake)。
 */
export function createDefaultGitExec(): GitExec {
  // 动态 import 避免在测试环境强制拉入 child_process
  // (P1 阶段不一定会被使用 —— WorktreeManager 的实现是平台无关的)
  return async (args: string[]) => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const exec = promisify(execFile)
    try {
      const { stdout, stderr } = await exec('git', args, { encoding: 'utf8' })
      return { code: 0, stdout, stderr }
    } catch (err) {
      // execFile reject 时附带了 stdout/stderr/code
      const e = err as { code?: number; stdout?: string; stderr?: string }
      return {
        code: e.code ?? 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
      }
    }
  }
}