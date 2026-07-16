/**
 * RequirementService —— ticket 02 worktree 真实创建
 *
 * 封装对每个 repo 走 `git worktree add` 的业务逻辑:
 * 1. 校验 req 目录是否存在
 * 2. 探测 base 分支(main → master fallback)
 * 3. 调 WorktreeManager.createWorktree
 * 4. stderr → RepoAttachErrorCode 映射
 * 5. 网络错自动重试 3 次(决策 30)
 *
 * 设计要点:
 * - 纯函数语义:每个 repo 的失败独立处理,不抛到调用方
 * - GitExec / WorktreeManager 通过 DI 注入,单元测试用 fake git
 * - 不复用 WorktreeManager.createWorktree 的 default base(`'master'`),
 *   而是由本服务先 resolveBaseBranch 再显式传 base —— 保证 main 优先
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  RepoAttachErrorCode,
  type AttachRepoResult,
  type RepoAttachErrorCodeT,
} from '@ai-devspace/shared'

/**
 * 在 per-repo `AttachRepoResult` 失败分支 `code` 字段允许的错误码。
 * 与 PER_REPO_ERROR_CODES 一致 —— E_INVALID_BRANCH_NAME / E_REQUIREMENT_NOT_FOUND
 * 是路由层(顶层 catch)处理,不在 per-repo 结果里出现。
 */
type PerRepoCode =
  | 'E_BASE_BRANCH_NOT_FOUND'
  | 'E_DISK_FULL'
  | 'E_NETWORK'
  | 'E_REPO_NOT_FOUND'
  | 'E_BRANCH_EXISTS'
  | 'E_INTERNAL'
import {
  createWorktreeManager,
  GitError,
  type GitExec,
  type WorktreeManager,
} from '../worktree/WorktreeManager.js'

export interface RequirementServiceDeps {
  root: string
  git: GitExec
  worktreeMgr?: WorktreeManager
  maxRetries?: number
  retryDelayMs?: number
  /** 测试钩子:用真实 setTimeout 时禁用以便测速 */
  sleep?: (ms: number) => Promise<void>
}

/**
 * stderr 文本 → 错误码 + 默认消息。
 *
 * 注意:此函数只读 stderr 文本,不依赖抛错方;用于：
 * - `show-ref --verify` 失败(stderr 含 "fatal: ambiguous argument" 等)→ E_BASE_BRANCH_NOT_FOUND
 * - `worktree add -b X` 失败(stderr 含具体原因)→ 各错误码
 *
 * 网络错识别:**仅** 在 stderr 含网络错关键字时返回 E_NETWORK,
 * 其他一律按确定性错误处理(retry 不会触发)。
 */
export function mapGitError(stderr: string): RepoAttachErrorCodeT {
  const s = stderr || ''
  // 网络错(可重试)
  if (
    /\b(EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ETIMEDOUT)\b/.test(s) ||
    /Could not resolve host/.test(s) ||
    /Connection (refused|reset)/i.test(s) ||
    /network is unreachable/i.test(s)
  ) {
    return RepoAttachErrorCode.E_NETWORK
  }
  // 磁盘满
  if (/No space left on device|ENOSPC|disk full/i.test(s)) {
    return RepoAttachErrorCode.E_DISK_FULL
  }
  // 分支已存在
  if (/A branch named .* already exists/.test(s)) {
    return RepoAttachErrorCode.E_BRANCH_EXISTS
  }
  // base 分支不存在(reference / unknown revision)
  if (/invalid reference|not a valid ref|unknown revision|needed a single revision/.test(s)) {
    return RepoAttachErrorCode.E_BASE_BRANCH_NOT_FOUND
  }
  // repo 不存在(not a git repository / No such file or directory / .git missing)
  if (/not a git repository|Not a directory|No such file or directory/.test(s)) {
    return RepoAttachErrorCode.E_REPO_NOT_FOUND
  }
  return RepoAttachErrorCode.E_INTERNAL
}

export function isNetworkErrorCode(code: RepoAttachErrorCodeT): boolean {
  return code === RepoAttachErrorCode.E_NETWORK
}

export class RequirementService {
  private readonly root: string
  private readonly git: GitExec
  private readonly worktreeMgr: WorktreeManager
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(deps: RequirementServiceDeps) {
    this.root = deps.root
    this.git = deps.git
    this.maxRetries = deps.maxRetries ?? 3
    this.retryDelayMs = deps.retryDelayMs ?? 200
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    // 默认用统一 git exec 构造 manager;调用方可注入自己的 manager
    this.worktreeMgr =
      deps.worktreeMgr ?? createWorktreeManager({ root: deps.root, git: deps.git })
  }

  /** requirement 目录是否存在(`<root>/requirements/<id>`) */
  async checkRequirementExists(reqId: string): Promise<boolean> {
    const reqDir = join(this.root, 'requirements', reqId)
    return existsSync(reqDir)
  }

  /**
   * 探测 base 分支:优先 main,fallback master。
   * - 两者都存在 → 返回 'main'(优先)
   * - 仅 master → 返回 'master'
   * - 两者都不存在 → 返回 null(调用方转 E_BASE_BRANCH_NOT_FOUND)
   *
   * 用 `git show-ref --verify` 是 idempotent + 不修改仓库状态。
   */
  async resolveBaseBranch(repoPath: string): Promise<'main' | 'master' | null> {
    // 先试 main
    const mainRes = await this.git([
      '-C',
      repoPath,
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/main',
    ])
    if (mainRes.code === 0) return 'main'
    // fallback master
    const masterRes = await this.git([
      '-C',
      repoPath,
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/master',
    ])
    if (masterRes.code === 0) return 'master'
    return null
  }

  /**
   * pool repo 是否存在(基于 `<root>/repos/<repoName>/.git` 存在性)
   *
   * 故意检查 `.git` 而非纯目录:避免空目录被误判为合法 repo。
   * 真实 clone 后 `.git` 一定存在。
   */
  repoExistsInPool(repoName: string): boolean {
    const poolPath = this.worktreeMgr.getPoolRepoPath(repoName)
    return existsSync(join(poolPath, '.git'))
  }

  /**
   * 为单个 repo 创建 worktree,带网络错重试。
   *
   * 错误码语义:
   * - 提前失败(未调 git):`E_REPO_NOT_FOUND` / `E_BASE_BRANCH_NOT_FOUND`
   * - 调 git 后失败:由 `mapGitError` 决定
   * - 网络错:重试 maxRetries 次后仍失败才返回 `E_NETWORK`
   *
   * @returns AttachRepoResult (ok=true 给 worktree path,ok=false 给 code + message)
   */
  async attachRepo(
    reqId: string,
    repoName: string,
    branchName: string,
  ): Promise<AttachRepoResult> {
    // 1. repo 存在性
    if (!this.repoExistsInPool(repoName)) {
      return {
        ok: false,
        repoId: repoName,
        code: RepoAttachErrorCode.E_REPO_NOT_FOUND,
        message: `仓库 ${repoName} 不存在于全局池(<root>/repos/${repoName}/.git)`,
      }
    }

    const repoPath = this.worktreeMgr.getPoolRepoPath(repoName)

    // 2. base 分支探测
    const base = await this.resolveBaseBranch(repoPath)
    if (base === null) {
      return {
        ok: false,
        repoId: repoName,
        code: RepoAttachErrorCode.E_BASE_BRANCH_NOT_FOUND,
        message: 'main 与 master 分支都不存在;无法确定 base 分支',
      }
    }

    // 3. worktree add,网络错重试
    const worktreePath = this.worktreeMgr.getWorktreePath(reqId, repoName)
    let lastErr: { code: PerRepoCode; message: string } | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // 指数退避:200 / 400 / 800ms
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1)
        await this.sleep(delay)
      }
      const args = [
        '-C',
        repoPath,
        'worktree',
        'add',
        worktreePath,
        '-b',
        branchName,
        base,
      ]
      let res: { code: number; stdout: string; stderr: string }
      try {
        res = await this.git(args)
      } catch (err) {
        // GitExec 自己 throw(罕见;默认实现不会 throw,直接返回 code)
        lastErr = {
          code: RepoAttachErrorCode.E_INTERNAL,
          message: err instanceof Error ? err.message : String(err),
        }
        continue
      }
      if (res.code === 0) {
        return {
          ok: true,
          repoId: repoName,
          branch: branchName,
          worktreePath,
          base,
        }
      }
      const code = mapGitError(res.stderr)
      // mapGitError 不会返回 E_INVALID_BRANCH_NAME / E_REQUIREMENT_NOT_FOUND,
      // 这两个是路由层处理的。这里 cast 到 PerRepoCode 满足类型约束。
      lastErr = { code: code as PerRepoCode, message: res.stderr.trim() || `git exited with code ${res.code}` }
      // 仅网络错重试;其他错误立即返回
      if (!isNetworkErrorCode(code)) break
    }

    // 4. 失败
    return {
      ok: false,
      repoId: repoName,
      code: lastErr?.code ?? RepoAttachErrorCode.E_INTERNAL,
      message: lastErr?.message ?? 'unknown git failure',
    }
  }

  /**
   * 批量 attach:逐个串行处理,任一 repo 失败不影响其他。
   * 错误码映射策略见 `attachRepo`。
   */
  async attachRepos(
    reqId: string,
    repoIds: readonly string[],
    branchName: string,
  ): Promise<AttachRepoResult[]> {
    const out: AttachRepoResult[] = []
    for (const id of repoIds) {
      out.push(await this.attachRepo(reqId, id, branchName))
    }
    return out
  }
}
