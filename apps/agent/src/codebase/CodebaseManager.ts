/**
 * CodebaseManager —— ADR-0030 D3 + issue 03 (替代旧 WorktreeManager)
 *
 * 路径约定(由本类一致化):
 *   - 需求 codebase:<root>/requirements/<reqId>/codebase/<repoName>/
 *   - 半成品 pending 标记:<root>/requirements/<reqId>/codebase/.pending-<repoName>
 *
 * 与旧 WorktreeManager 的本质区别:
 * - 旧:在全局仓库池 `<root>/repos/<name>/` 已有完整 clone 的前提下,用
 *   `git worktree add` 给 req 派生一个 worktree(共享 .git,秒级)
 * - 新:全局**不**保留仓库池,每个 req 独立 `git clone <gitUrl> <codebasePath>` +
 *   `git checkout -b <branchName>`,fs 上是相互独立的 git 仓库
 *
 * 错误处理:git 退出码 ≠ 0 → 返回 `{ok: false, code, message}`(不抛),由
 * RequirementService 决定如何回退半成品目录 / 清 pending。
 *
 * 路径语义(cross-platform):
 *   - getCodebasePath 返回 **OS-native 路径**(Windows 上 `C:\...`,POSIX 上
 *     `/...`),用于 fs.existsSync / mkdir 等系统调用。
 *   - 实际传给 git 的 `clone <gitUrl> <codebasePath>` / `rev-parse` 参数走
 *     `toPosixPath` 转换(Windows 上变 `/c/...`、POSIX 上保持 `/...`)。
 *
 * 强制 env:依赖注入的 `GitExec` 已经由 `createDefaultGitExec()` 处理
 * `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=""` / `SSH_ASKPASS=""` —— 缺凭据时
 * git 不在后台进程 stdin 挂死(issue 05 验收 5.1)。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { posixJoin, toPosixPath } from '../worktree/pathUtil.js'
import {
  PER_REPO_ERROR_CODES,
  RepoAttachErrorCode,
  type RepoAttachErrorCodeT,
} from '@ai-devspace/shared'

/**
 * CodebaseManager 实际可能产出的错误码子集:
 * - 排除 `E_INVALID_BRANCH_NAME` / `E_REQUIREMENT_NOT_FOUND`(前者是分支名校验,后者是 req 目录校验,都在上游拦了)
 * - 排除 `E_REPO_NAME_EXISTS`(POST /api/repos 注册时校验,不在 clone 路径)
 * - 即 `PER_REPO_ERROR_CODES` 这个 6 值联合;CloneResult 用它可避免与
 *   `AttachRepoResult.code` schema(`z.enum(PER_REPO_ERROR_CODES)`)反查时
 *   出现 TS2322(否则 TS 会把 'E_INVALID_BRANCH_NAME' 等视为可能值)。
 */
export type CloneErrorCodeT = (typeof PER_REPO_ERROR_CODES)[number]

export interface GitExecResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * 执行一条 git 命令。
 * 实现可以走 `child_process.execFile('git', args)` 或调外部脚本。
 * @param args  不含 'git' 本身(只放参数)。CodebaseManager 通过参数里带
 *              `clone <url> <path>` 或 `-C <cwd> rev-parse ...` 等。
 */
export type GitExec = (args: string[]) => Promise<GitExecResult>

/**
 * 单个 codebase 的运行时信息(供 listByRepo 派生)。
 *
 * - `path` 是绝对路径(OS-native)
 * - `branch` 不含 `origin/` 前缀(已剥);detached HEAD 时为 null
 * - `head` 是 clone 下来的 HEAD commit SHA
 */
export interface CodebaseInfo {
  /** 绝对路径,OS-native */
  path: string
  /** 当前分支名(含 origin/ 前缀剥离) */
  branch: string | null
  /** clone 下来的 HEAD commit */
  head: string
}

/**
 * 按 requirementId 聚合的 codebase 列表项 —— `listByRepo` 的返回元素。
 * 同一个 repoName 可能被多个 req 关联,这里按 reqId 拆分。
 */
export interface CodebaseByReq {
  requirementId: string
  path: string
  branch: string | null
  head: string
  /** 该 codebase 当前是否处于"克隆中"(对应 `.pending-<name>` 标记存在) */
  pending: boolean
}

/**
 * clone 的执行结果。
 *
 * - `ok: true` → 克隆 + checkout 成功,带 `path`(OS-native) + `head`(commit SHA)
 * - `ok: false` → 任意失败,带 `code` + `message`(不抛给上层)
 */
export type CloneResult =
  | { ok: true; path: string; head: string; branch: string }
  | { ok: false; code: CloneErrorCodeT; message: string }

export interface CodebaseManagerDeps {
  root: string
  git: GitExec
}

/**
 * 半成品清理条目 —— `scanOrphanedPending` 返回。
 * agent 启动时对每条执行 `rm -rf` + 标记清理。
 */
export interface OrphanedPendingEntry {
  reqId: string
  repoName: string
  path: string
}

export interface CodebaseManager {
  /** 计算一个 req × repo 的 codebase 路径(纯字符串拼接,OS-native) */
  getCodebasePath(reqId: string, repoName: string): string
  /** 计算该 codebase 的 pending 标记路径(OS-native) */
  getPendingPath(reqId: string, repoName: string): string

  /**
   * 异步 clone + checkout 分支。
   *
   * 步骤:
   * 1. `git clone <gitUrl> <codebasePath>`(失败 → 返 ok:false)
   * 2. `git -C <codebasePath> checkout -b <branchName>`(失败 → rm 半成品 + 返错)
   * 3. `git -C <codebasePath> rev-parse HEAD` 拿 head commit
   *
   * 副作用:
   * - 路径已存在(`<root>/requirements/<reqId>/codebase/<repoName>/` 目录在):
   *   返 `{ok:false, code: 'E_REPO_ALREADY_ATTACHED', message}`。
   *   不删已有内容(决策 109:幂等校验,不破坏)
   *
   * 设计:
   * - 半成品清理由调用方决定:本方法在「clone 失败 / checkout 失败」时**不**自动
   *   rm 目录,交给 `RequirementService.attachRepos` 决定(因为并行的失败要
   *   保证其他 clone 不被牵连)。
   *   单调用方场景可自行 catch 后调 `remove()` 清理。
   */
  clone(
    reqId: string,
    repoName: string,
    gitUrl: string,
    branchName: string,
  ): Promise<CloneResult>

  /**
   * 异步 rm -rf 半成品 / 旧 codebase 目录。
   *
   * - 目录不存在 → no-op(返 void)
   * - rm 失败 → 不抛(吞掉,清残留不应阻断调用方)
   */
  remove(reqId: string, repoName: string): Promise<void>

  /**
   * 列某个 repo 的 codebase 信息(按 requirementId 聚合)。
   *
   * 扫描 `requirements/<req-xxx>/codebase/<repoName>`(单层目录匹配),对每个
   * 存在的目录:
   * - 跑 `git -C <path> rev-parse --abbrev-ref HEAD` 拿分支名(origin/ prefix 去掉)
   * - 跑 `git -C <path> rev-parse HEAD` 拿 head
   * - `.pending-<repoName>` 标记存在 → `pending: true`
   *
   * 失败 / 损坏目录 → 跳过,不阻塞其他(reqId 仍出现在结果中但字段降级为 null)。
   */
  listByRepo(repoName: string): Promise<CodebaseByReq[]>

  /** 写 `.pending-<repoName>` 标记(空文件,touch) */
  setPending(reqId: string, repoName: string): Promise<void>
  /** 清 `.pending-<repoName>` 标记(目录本身不动) */
  clearPending(reqId: string, repoName: string): Promise<void>

  /**
   * agent 启动时扫所有 `.pending-<repoName>` 残留(在
   * `requirements/<reqId>/codebase/` 子目录下)。
   *
   * 返回的每条 entry 表示"半成品 codebase",启动钩子会:
   * - `rm -rf` 半成品目录
   * - 删 pending 标记
   * - 记 warn log,用户可据此排查之前未完成的 attach
   *
   * 性能:本期简单全扫;requirements 数 < 1000 时可接受。优化点(issue 03 风险):
   * 「只扫最近启动过 clone 的需求」推迟到后续。
   */
  scanOrphanedPending(): Promise<OrphanedPendingEntry[]>
}

export function createCodebaseManager(deps: CodebaseManagerDeps): CodebaseManager {
  const { root, git } = deps

  /** OS-native path,用于 fs 系统调用 */
  function getCodebasePath(reqId: string, repoName: string): string {
    return join(root, 'requirements', reqId, 'codebase', repoName)
  }

  /** `.pending-<name>` 标记的 OS-native path */
  function getPendingPath(reqId: string, repoName: string): string {
    return join(root, 'requirements', reqId, 'codebase', `.pending-${repoName}`)
  }

  async function clone(
    reqId: string,
    repoName: string,
    gitUrl: string,
    branchName: string,
  ): Promise<CloneResult> {
    const codebasePath = getCodebasePath(reqId, repoName)

    // 0. 路径已存在 → E_REPO_ALREADY_ATTACHED(幂等校验)
    //    不删已有内容,让上层路由决定如何处理(决策 109)
    if (existsSync(codebasePath)) {
      return {
        ok: false,
        code: RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED,
        message: `codebase ${repoName} 已被 req ${reqId} 关联`,
      }
    }

    // 确保父目录存在(首次 attach 时)
    const codebaseDir = join(root, 'requirements', reqId, 'codebase')
    try {
      mkdirSync(codebaseDir, { recursive: true, mode: 0o700 })
    } catch (err) {
      return {
        ok: false,
        code: RepoAttachErrorCode.E_DISK_FULL,
        message: `mkdir ${codebaseDir} failed: ${(err as Error).message}`,
      }
    }

    // 1. git clone <gitUrl> <codebasePath>
    const cloneArgs = ['clone', gitUrl, toPosixPath(codebasePath)]
    let cloneRes: GitExecResult
    try {
      cloneRes = await git(cloneArgs)
    } catch (err) {
      return {
        ok: false,
        code: RepoAttachErrorCode.E_INTERNAL,
        message: `git clone threw: ${(err as Error).message}`,
      }
    }
    if (cloneRes.code !== 0) {
      const code = mapCloneError(cloneRes.stderr)
      return {
        ok: false,
        code,
        message: cloneRes.stderr.trim() || `git clone exited with code ${cloneRes.code}`,
      }
    }

    // 2. checkout -b <branchName>(在 clone 出来的目录里)
    const checkoutArgs = [
      '-C',
      toPosixPath(codebasePath),
      'checkout',
      '-b',
      branchName,
    ]
    let checkoutRes: GitExecResult
    try {
      checkoutRes = await git(checkoutArgs)
    } catch (err) {
      // checkout 抛错罕见(默认 execFile 不抛),仅做兜底
      await safeRm(codebasePath)
      return {
        ok: false,
        code: RepoAttachErrorCode.E_INTERNAL,
        message: `git checkout threw: ${(err as Error).message}`,
      }
    }
    if (checkoutRes.code !== 0) {
      // checkout 失败 → 半成品目录清掉(决策 110:不留半成品)
      await safeRm(codebasePath)
      return {
        ok: false,
        code: RepoAttachErrorCode.E_INTERNAL,
        message:
          checkoutRes.stderr.trim() || `git checkout exited with code ${checkoutRes.code}`,
      }
    }

    // 3. 拿 HEAD commit(给上层当 head 字段)
    const headArgs = ['-C', toPosixPath(codebasePath), 'rev-parse', 'HEAD']
    const headRes = await git(headArgs)
    const head = headRes.code === 0 ? headRes.stdout.trim() : ''

    return { ok: true, path: codebasePath, head, branch: branchName }
  }

  async function remove(reqId: string, repoName: string): Promise<void> {
    const codebasePath = getCodebasePath(reqId, repoName)
    await safeRm(codebasePath)
  }

  async function listByRepo(repoName: string): Promise<CodebaseByReq[]> {
    const out: CodebaseByReq[] = []
    const reqDir = join(root, 'requirements')
    if (!existsSync(reqDir)) return out
    let entries: string[]
    try {
      entries = readdirSync(reqDir)
    } catch {
      return out
    }
    for (const entry of entries) {
      if (!entry.startsWith('req-')) continue
      const codebasePath = join(reqDir, entry, 'codebase', repoName)
      if (!existsSync(codebasePath)) continue
      // 跳过非目录的同名文件(防御性)
      try {
        const stat = statSync(codebasePath)
        if (!stat.isDirectory()) continue
      } catch {
        continue
      }

      const pending = existsSync(getPendingPath(entry, repoName))

      // 拿分支 + HEAD(失败降级为 null,不阻塞该 entry 出现)
      let branch: string | null = null
      let head = ''
      try {
        const branchRes = await git([
          '-C',
          toPosixPath(codebasePath),
          'rev-parse',
          '--abbrev-ref',
          'HEAD',
        ])
        if (branchRes.code === 0) {
          const raw = branchRes.stdout.trim()
          // 剥 origin/ 前缀(我们 clone 后 checkout -b,所以正常情况就是分支原名,
          // 但用户在 codebase 里 git checkout origin/main 之后也会带 origin/ 前缀)
          branch = raw.startsWith('origin/') ? raw.slice('origin/'.length) : raw
          if (branch === 'HEAD') branch = null
        }
        const headRes = await git([
          '-C',
          toPosixPath(codebasePath),
          'rev-parse',
          'HEAD',
        ])
        if (headRes.code === 0) head = headRes.stdout.trim()
      } catch {
        /* 降级:branch/head 留默认值 */
      }

      out.push({
        requirementId: entry,
        path: codebasePath,
        branch,
        head,
        pending,
      })
    }
    return out
  }

  async function setPending(reqId: string, repoName: string): Promise<void> {
    const codebaseDir = join(root, 'requirements', reqId, 'codebase')
    try {
      mkdirSync(codebaseDir, { recursive: true, mode: 0o700 })
    } catch {
      /* 即使 mkdir 失败,touch 失败也会让上层捕获;不在此处抛错 */
    }
    try {
      writeFileSync(getPendingPath(reqId, repoName), '', { mode: 0o600 })
    } catch {
      /* pending 标记写失败不应阻断 clone —— 让上层正常进行 */
    }
  }

  async function clearPending(reqId: string, repoName: string): Promise<void> {
    const p = getPendingPath(reqId, repoName)
    try {
      rmSync(p, { force: true })
    } catch {
      /* 文件可能本来就不存在,swallow */
    }
  }

  async function scanOrphanedPending(): Promise<OrphanedPendingEntry[]> {
    const out: OrphanedPendingEntry[] = []
    const reqDir = join(root, 'requirements')
    if (!existsSync(reqDir)) return out
    let reqEntries: string[]
    try {
      reqEntries = readdirSync(reqDir)
    } catch {
      return out
    }
    for (const reqId of reqEntries) {
      if (!reqId.startsWith('req-')) continue
      const codebaseDir = join(reqDir, reqId, 'codebase')
      if (!existsSync(codebaseDir)) continue
      let entries: string[]
      try {
        entries = readdirSync(codebaseDir)
      } catch {
        continue
      }
      for (const name of entries) {
        if (!name.startsWith('.pending-')) continue
        const repoName = name.slice('.pending-'.length)
        const path = getCodebasePath(reqId, repoName)
        out.push({ reqId, repoName, path })
      }
    }
    return out
  }

  return {
    getCodebasePath,
    getPendingPath,
    clone,
    remove,
    listByRepo,
    setPending,
    clearPending,
    scanOrphanedPending,
  }
}

/**
 * clone 的 stderr 文本 → 错误码。
 *
 * 与旧 `mapGitError`(针对 `worktree add`)的区别:
 * - 没有 E_BRANCH_EXISTS(全新 clone 不可能撞本地分支,决策 111)
 * - 没有 E_BASE_BRANCH_NOT_FOUND(clone 必带 HEAD)
 * - 增加 E_REPO_NOT_FOUND(注册表无 gitUrl 时不传到这里 —— 这是更上层的校验,
 *   这里保留只是兜底 stderr 含 "Repository not found")
 *
 * 启发式匹配:
 * - 网络关键字 → E_NETWORK
 * - 鉴权关键字 → E_AUTH(走 SSoT)
 * - 磁盘满 → E_DISK_FULL
 * - "Repository not found" / "could not read" → E_REPO_NOT_FOUND
 * - 其他 → E_INTERNAL
 */
export function mapCloneError(stderr: string): CloneErrorCodeT {
  const s = stderr || ''
  if (
    /\b(EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ETIMEDOUT)\b/.test(s) ||
    /Could not resolve host/.test(s) ||
    /Connection (refused|reset)/i.test(s) ||
    /network is unreachable/i.test(s)
  ) {
    return RepoAttachErrorCode.E_NETWORK
  }
  if (
    /Permission denied/.test(s) ||
    /publickey/.test(s) ||
    /Authentication failed/.test(s)
  ) {
    return RepoAttachErrorCode.E_AUTH
  }
  if (/No space left on device|ENOSPC|disk full/i.test(s)) {
    return RepoAttachErrorCode.E_DISK_FULL
  }
  if (/Repository not found|not found/i.test(s)) {
    return RepoAttachErrorCode.E_REPO_NOT_FOUND
  }
  return RepoAttachErrorCode.E_INTERNAL
}

/** rm -rf 兜底:目录可能不存在,任何错误都 swallow(清理不应抛) */
async function safeRm(p: string): Promise<void> {
  try {
    rmSync(p, { recursive: true, force: true })
  } catch {
    /* swallow */
  }
}

// 重新导出 posixJoin 供调用方(比如 spec 测试)使用;CodebaseManager 内部仍依赖。
export { posixJoin }