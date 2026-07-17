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

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'yaml'
import {
  RepoAttachErrorCode,
  RequirementErrorCode,
  buildRequirementMdTemplate,
  slugify,
  type AttachRepoResult,
  type RepoAttachErrorCodeT,
  type RequirementMeta,
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

  // ===========================================================================
  // ticket 04 —— POST /api/requirements 文件落盘
  // ===========================================================================

  /** `<root>/requirements` 目录路径 */
  get requirementsDir(): string {
    return join(this.root, 'requirements')
  }

  /** `<root>/requirements/<id>` 目录路径 */
  requirementDirPath(reqId: string): string {
    return join(this.requirementsDir, reqId)
  }

  /**
   * 扫 `requirements/` 目录,返回当前最大 `req-NNN-*` 编号(0 = 空目录)。
   *
   * 规则(PRD §8.2 / 决策 b2):
   * - 只看顶层目录名匹配 `^req-(\d+)-` 前缀
   * - 非数字编号的目录(如临时调试残留)忽略,不参与 max 计算
   * - 与已存目录 NNN 重叠时,调用方走 `nextRequirementId()` 拿 N+1
   */
  maxRequirementSeq(): number {
    const dir = this.requirementsDir
    if (!existsSync(dir)) return 0
    let max = 0
    for (const name of readdirSync(dir)) {
      const m = name.match(/^req-(\d+)-/)
      if (!m) continue
      const n = Number(m[1])
      if (Number.isFinite(n) && n > max) max = n
    }
    return max
  }

  /**
   * 给定 slug + 起始 NNN → 返回一个**未占用**的 `req-NNN-slug`。
   *
   * 冲突策略(决策 b2 + ticket 04 验收):
   * - 起始 N = maxSeq + 1
   * - 若目标 id 已存在 → N += 1 重试,直到找出空位
   * - 最多尝试 4 次(初始 + 3 重试);仍冲突 → 抛 `E_ID_COLLISION`
   *   (极罕见,通常说明文件系统脏或并发创建)
   */
  nextRequirementId(slug: string, startSeq?: number): string {
    const start = startSeq ?? this.maxRequirementSeq() + 1
    const maxAttempts = 4
    for (let i = 0; i < maxAttempts; i++) {
      const seq = start + i
      const candidate = `req-${String(seq).padStart(3, '0')}-${slug}`
      if (!existsSync(this.requirementDirPath(candidate))) return candidate
    }
    throw new RequirementIdCollisionError(
      `Failed to allocate requirement id after ${maxAttempts} attempts (startSeq=${start})`,
    )
  }

  /**
   * 创建需求目录 + 写 `meta.yaml` + `requirement.md`。
   *
   * 步骤:
   * 1. slug 派生(`slugify`)
   * 2. ID 分配(`nextRequirementId`,max + 1 + 冲突重试 3 次)
   * 3. mkdir `<root>/requirements/<id>/`(0700 perms)
   * 4. 写 `meta.yaml`(id / title / createdAt ISO)
   * 5. 写 `requirement.md` 空模板
   *
   * 错误码映射:
   * - `mkdir` 抛 ENOSPC → 转 `RequirementServiceError(E_DISK_FULL)`
   * - 其他 `mkdir` / `writeFile` 抛错 → `E_INTERNAL`
   *
   * 设计要点:
   * - 全部同步(走 fs/promises 也行,但 ticket 02 路径全部 sync;保持风格一致)
   * - 不依赖 WorktreeManager / git —— 本期 worktree 在 DRAFTING 首次关联 repo 时建
   * - 创建顺序:先 mkdir,再写 meta.yaml,最后 requirement.md;失败时 dir 残留由调用方决定清理
   *   (本方法失败即抛错,dir 是空目录,可被下一次 max-seq 计算跳过)
   */
  createRequirement(rawTitle: string): CreateRequirementResult {
    const title = rawTitle.trim()
    const slug = slugify(title)
    const id = this.nextRequirementId(slug)
    const createdAt = new Date().toISOString()

    const reqDir = this.requirementDirPath(id)
    try {
      mkdirSync(reqDir, { recursive: true, mode: 0o700 })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOSPC' || code === 'EDQUOT') {
        throw new RequirementServiceError(
          'E_DISK_FULL',
          'disk full while creating requirement directory',
        )
      }
      throw new RequirementServiceError(
        RequirementErrorCode.E_INTERNAL,
        `mkdir failed: ${(err as Error).message}`,
      )
    }

    const meta: RequirementMeta = { id, title, createdAt }
    try {
      this.writeMetaYaml(reqDir, meta)
      this.writeRequirementMd(reqDir, title)
    } catch (err) {
      throw new RequirementServiceError(
        RequirementErrorCode.E_INTERNAL,
        `write meta/requirement failed: ${(err as Error).message}`,
      )
    }

    return { id, title, createdAt, dirPath: reqDir }
  }

  /** 写 `meta.yaml` —— 顺序字段,lineWidth=0 防 yaml 库截断长字符串 */
  private writeMetaYaml(reqDir: string, meta: RequirementMeta): void {
    const body = yaml.stringify(meta, { indent: 2, lineWidth: 0 })
    writeFileSync(join(reqDir, 'meta.yaml'), body, { mode: 0o600 })
  }

  /** 写 `requirement.md` 空模板 */
  private writeRequirementMd(reqDir: string, title: string): void {
    writeFileSync(join(reqDir, 'requirement.md'), buildRequirementMdTemplate(title), 'utf8')
  }
}

// ---------------------------------------------------------------------------
// ticket 04 创建结果 + 错误类型
// ---------------------------------------------------------------------------

/** RequirementService.createRequirement 的成功结果 */
export interface CreateRequirementResult {
  id: string
  title: string
  createdAt: string
  /** 落盘的绝对目录路径(便于测试断言;生产代码一般不直接用) */
  dirPath: string
}

/**
 * RequirementServiceError —— 创建需求失败时抛错,带 code 便于上层映射。
 *
 * code 取自 `RequirementErrorCode`(与 ticket 04 验收 #6 错误码表对齐)。
 */
export class RequirementServiceError extends Error {
  constructor(
    public readonly code: RequirementServiceCode,
    message: string,
  ) {
    super(message)
    this.name = 'RequirementServiceError'
  }
}

/** 内部使用的 code 联合类型(避免对 SSoT schema 反向 import 循环) */
export type RequirementServiceCode =
  | 'E_ID_COLLISION'
  | 'E_DISK_FULL'
  | 'E_INTERNAL'

export class RequirementIdCollisionError extends RequirementServiceError {
  constructor(message: string) {
    super('E_ID_COLLISION', message)
    this.name = 'RequirementIdCollisionError'
  }
}
