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
  /**
   * 可选 logger —— Issue 09(决策账本待补):
   * 用于 `safeRm` 失败 / 半成品残留清理路径打 warn 日志。
   * 不注入时所有 warn 静默 no-op(向后兼容)。
   *
   * 契约:pino / fastify.log 风格 —— `warn(obj, msg?)`,
   * 其中 obj 是结构化字段,msg 是可读短串。
   */
  logger?: SafeRmLogger
}

/**
 * safeRm / 半成品清理用的 logger 抽象 —— 只用到 warn 一档。
 * 解耦 pino / fastify.log,便于单测注入 fake(数组收集器)。
 */
export interface SafeRmLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void
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

  /**
   * Issue 10:启动期扫「.git 残留但 working tree 空」的 codebase 目录。
   *
   * 与 `scanOrphanedPending` 的边界:
   * - `scanOrphanedPending` 只清带 `.pending-<name>` 标记的目录
   *   (clone 异常退出留下的真正半成品)
   * - `scanOrphanedCodebases` 清「.git 残留但 working tree 空」的目录
   *   (上次 attach checkout 失败 + safeRm 漏过后留下的孤儿)
   *
   * 启动钩子会 rm -rf 每个 entry + 记 warn log,让用户可排查之前的失败 attach。
   *
   * 性能:每个候选跑 `git ls-files`,~50ms;本期沿用「简单全扫」策略
   * (与 `scanOrphanedPending` 同风格)。
   */
  scanOrphanedCodebases(): Promise<OrphanedCodebaseEntry[]>
}

/**
 * Issue 10:孤儿 codebase 扫描结果条目 —— `.git` 残留但 working tree 空的目录。
 * 启动钩子会 rm -rf 每个 entry + 记 warn log。
 */
export interface OrphanedCodebaseEntry {
  reqId: string
  repoName: string
  path: string
}

export function createCodebaseManager(deps: CodebaseManagerDeps): CodebaseManager {
  const { root, git, logger } = deps

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

    // 0. 路径已存在 + 是完整仓库 → E_REPO_ALREADY_ATTACHED(幂等校验,决策 109)
    //    路径已存在但**不完整**(只有 .git 没 working tree / 残留半成品)
    //    → log warn + safeRm 后继续 clone(Issue 09)
    const existing = existsSync(codebasePath)
    if (existing) {
      const complete = await isCompleteCodebase(git, codebasePath)
      if (complete) {
        return {
          ok: false,
          code: RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED,
          message: `codebase ${repoName} 已被 req ${reqId} 关联`,
        }
      }
      logger?.warn(
        { reqId, repoName, path: codebasePath },
        'clone: found orphan half-baked codebase, removing before retry',
      )
      // Issue 13:safeRm 失败必须 throw,clone() 入口不再继续
      // (避免在脏目录上跑 git clone 必败 → 永久循环)
      try {
        await safeRm(codebasePath, logger)
      } catch (err) {
        return {
          ok: false,
          code: RepoAttachErrorCode.E_INTERNAL,
          message: `safeRm 失败,无法清理残留半成品 ${codebasePath}: ${(err as Error).message}`,
        }
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
      // Issue 13:git clone 中途被 kill(SIGTERM / 超时)可能已部分创建
      // codebasePath(含 .git 残留),必须 safeRm 清理
      try {
        await safeRm(codebasePath, logger)
      } catch {
        /* safeRm 失败抛错也 swallow —— 外层会返 E_INTERNAL */
      }
      return {
        ok: false,
        code: RepoAttachErrorCode.E_INTERNAL,
        message: `git clone threw: ${(err as Error).message}`,
      }
    }
    if (cloneRes.code !== 0) {
      // Issue 13:git clone 失败时 codebasePath 可能已部分创建(典型:
      // 网络超时后 git 留 .git 残余但 exit code ≠ 0),必须 safeRm 清理
      try {
        await safeRm(codebasePath, logger)
      } catch {
        /* 同上 */
      }
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
      // Issue 13:safeRm 可能抛(失败 swallow 到外层 E_INTERNAL)
      try {
        await safeRm(codebasePath, logger)
      } catch {
        /* safeRm 失败不掩盖 git checkout 原始错误 */
      }
      return {
        ok: false,
        code: RepoAttachErrorCode.E_INTERNAL,
        message: `git checkout threw: ${(err as Error).message}`,
      }
    }
    if (checkoutRes.code !== 0) {
      // checkout 失败 → 半成品目录清掉(决策 110:不留半成品)
      // Issue 13:safeRm 失败 swallow
      try {
        await safeRm(codebasePath, logger)
      } catch {
        /* safeRm 失败不掩盖 git checkout 原始错误 */
      }
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

    // 4. 自检 + 兜底(Issue 11):working tree 必须非空
    //    边缘 case:.git 完整但 <codebase>/ 下没 tracked 文件(外部 rm / fs 损坏)
    await ensureWorkingTree(git, codebasePath, logger)

    return { ok: true, path: codebasePath, head, branch: branchName }
  }

  async function remove(reqId: string, repoName: string): Promise<void> {
    const codebasePath = getCodebasePath(reqId, repoName)
    // Issue 13:safeRm 失败抛错 —— remove 是公开 API,swallow 兜底
    // (调用方 server.ts boot 钩子应该用 try/catch 容忍,不该阻断启动)
    try {
      await safeRm(codebasePath, logger)
    } catch (err) {
      logger?.warn(
        { reqId, repoName, path: codebasePath, err: (err as Error).message },
        'remove: safeRm failed, directory may persist',
      )
    }
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

  /**
   * Issue 10:启动期扫所有「.git 残留但 working tree 空」的 codebase 目录。
   *
   * 与 `scanOrphanedPending` 的边界(见接口注释):本函数不查 `.pending-` 标记,
   * 只看每个候选 `codebase/<name>/` 目录本身是否完整 —— 复用 Issue 09 的
   * `isCompleteCodebase` 判定。
   *
   * 容错:
   * - requirements 目录不存在 → `[]`(与 scanOrphanedPending 一致)
   * - 单个 codebase 目录 readdir / stat 失败 → 跳过该 entry,不阻塞其他
   * - `isCompleteCodebase` 内部已 swallow git 失败,返 false → 报为孤儿
   */
  async function scanOrphanedCodebases(): Promise<OrphanedCodebaseEntry[]> {
    const out: OrphanedCodebaseEntry[] = []
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
        // 跳过 .pending-<name> 标记(由 scanOrphanedPending 处理)
        // + 隐藏文件(.DS_Store / .archived 等)
        if (name.startsWith('.')) continue
        const path = join(codebaseDir, name)
        // 仅扫目录(同名非目录文件跳过)
        try {
          const st = statSync(path)
          if (!st.isDirectory()) continue
        } catch {
          continue
        }
        // 复用 Issue 09 判定:不完整 = 孤儿
        const complete = await isCompleteCodebase(git, path)
        if (!complete) {
          out.push({ reqId, repoName: name, path })
        }
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
    scanOrphanedCodebases,
  }
}

/**
 * clone 的 stderr 文本 → 错误码。
 *
 * 与旧 `mapGitError`(针对 `worktree add`)的区别:
 * - 没有 E_BASE_BRANCH_NOT_FOUND(clone 必带 HEAD)
 * - 增加 E_REPO_NOT_FOUND(注册表无 gitUrl 时不传到这里 —— 这是更上层的校验,
 *   这里保留只是兜底 stderr 含 "Repository not found")
 *
 * 决策 111-v2(ADR-0031)边界澄清:
 * - E_BRANCH_EXISTS 由 RequirementService.attachRepo **前置校验**返,
 *   不依赖 clone / checkout -b 的 stderr 文本(不保证出现 "A branch named 'x'
 *   already exists" 这种固定格式)。所以本函数不再生成 E_BRANCH_EXISTS,
 *   仅在 RepoAttachErrorCode 联合里占位。
 * - clone 本身不会撞本地分支(全新仓库,本地无分支);但 `git checkout -b
 *   <branchName>` 在 clone 后会撞(origin 默认分支已存在)。前置拦截避免
 *   走到必败路径。
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

/**
 * 「codebase 路径是不是一个完整 git 仓库 + working tree」
 * - 不存在 → false
 * - 仅 .git 存在但 working tree 为空(残留半成品 / working tree 被外力清空)→ false
 * - 完整仓库 + working tree 至少有 1 个非 .git 文件 → true
 *
 * 实现(Issue 09 + Issue 11 e2e 反馈修正):
 * - `<path>/.git/HEAD` 存在 —— 说明 `.git` 元数据完整
 * - `readdirSync(path)` 至少 1 个非 . 前缀条目 —— 说明 working tree 有真实内容
 *
 * 不用 `git ls-files`:ls-files 列 HEAD commit 的 tracked 文件,与 working tree
 * 当前内容无关。working tree 被 `rm -rf` 清空后,ls-files 仍会列 HEAD commit 文件,
 * 导致误判为「完整仓库」。readdirSync 直接看 working tree,语义与 spec「working tree
 * 是否有内容」严格对齐。
 *
 * 仅在 clone() 入口做幂等判断时跑(只有 existsSync 命中才调),不污染干净路径。
 * 导出(供 Issue 10 `scanOrphanedCodebases` 复用):本质是「判定函数」。
 *
 * @param _git 保留参数(向后兼容测试 fixture);实现已不再需要 git 调用。
 */
export async function isCompleteCodebase(
  _git: GitExec,
  path: string,
): Promise<boolean> {
  if (!existsSync(path)) return false
  const gitHead = join(path, '.git', 'HEAD')
  if (!existsSync(gitHead)) return false
  try {
    const entries = readdirSync(path)
    // 隐藏文件(.git/.pending-*/.DS_Store/.archived)不算 working tree 内容
    return entries.some((e) => !e.startsWith('.'))
  } catch {
    return false
  }
}

/**
 * Issue 11:确保 working tree 至少有 1 个 tracked 文件(防御性兜底)。
 *
 * - 正常情况:git clone + checkout -b 之后 working tree 必有内容,no-op
 * - 边缘 case:working tree 被外部干扰清空(.git 完整但 <codebase>/ 空)
 *   → 跑 `git reset --hard HEAD` 强制恢复
 *
 * 与 `isCompleteCodebase` 的边界:
 * - `isCompleteCodebase` 是「判定用」(true/false),用于入口短路
 * - `ensureWorkingTree` 是「修复用」(void),用于 clone 成功后兜底
 *
 * 风险:`git reset --hard HEAD` 有破坏性,但本函数只在 ls-files 为空时调,
 * 此时 working tree 已经没有未提交改动可丢,reset 是安全的。
 *
 * 导出供测试验证 4 种行为:有内容 / 空 → reset / reset 失败 / 不传 logger。
 */
export async function ensureWorkingTree(
  git: GitExec,
  codebasePath: string,
  logger?: SafeRmLogger,
): Promise<void> {
  const checkArgs = ['-C', toPosixPath(codebasePath), 'ls-files']
  const checkRes = await git(checkArgs)
  if (checkRes.code === 0 && checkRes.stdout.trim().length > 0) return
  // working tree 为空 → 强制 reset
  logger?.warn(
    { path: codebasePath },
    'clone: working tree empty after success, running reset --hard HEAD',
  )
  const resetRes = await git([
    '-C',
    toPosixPath(codebasePath),
    'reset',
    '--hard',
    'HEAD',
  ])
  if (resetRes.code !== 0) {
    logger?.warn(
      { path: codebasePath, stderr: resetRes.stderr },
      'clone: reset --hard HEAD failed, leaving empty working tree',
    )
  }
}

/**
 * rm -rf 兜底(Issue 09 + Issue 13):
 * - 失败必须 warn(不再静默,fd 竞争下 retry 3 次兜底)
 * - **Issue 13 修正:失败必须 throw**(原 swallow 行为导致半成品永远残留)
 *
 * macOS Finder / Spotlight 索引偶尔会持有 fd,rmSync 会 EBUSY / EACCES。
 *
 * 历史(Issue 09):
 * - 原实现静默吞错 → .git 残留 + 下次 attach 命中 E_REPO_ALREADY_ATTACHED
 * - 改为 fd retry 3 次后仍 warn(不抛)
 *
 * Issue 13 全局修复:
 * - 旧设计「清理不应抛」导致 bug 链:clone() 第 1 步失败残留 .git →
 *   下次 attach 入口 safeRm 也失败 → 代码继续走 git clone → 在有 .git
 *   的目录上必败 → 永远循环
 * - 改为 throw 让调用方决定:clone() 入口直接放弃(避免在脏目录上 git clone);
 *   其他调用点(remove / boot cleanup)用 try/catch 兜底
 *
 * 导出供测试验证 4 种行为:no-op / 成功 / 部分失败 / 全失败(throw)。
 * `rmFn` 默认是 `fs.rmSync`,测试可注入可控 rm。
 */
export async function safeRm(
  p: string,
  logger?: SafeRmLogger,
  rmFn: (path: string, opts: { recursive: boolean; force: boolean }) => void = rmSync,
): Promise<void> {
  const tryRm = (): boolean => {
    try {
      rmFn(p, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }
  if (tryRm()) {
    if (!existsSync(p)) return
    logger?.warn({ path: p }, 'safeRm: directory still exists after rmSync')
  } else {
    logger?.warn({ path: p }, 'safeRm: rmSync threw, will retry')
  }
  // fd 竞争 retry:macOS Finder/Spotlight 索引偶尔会持有 fd,等 100ms 重试
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if (tryRm() && !existsSync(p)) return
  }
  // Issue 13:失败必须 throw,不再 swallow(让调用方知道「半成品还在」)
  const message = `safeRm gave up after 3 retries, directory may persist: ${p}`
  logger?.warn({ path: p }, message)
  throw new Error(message)
}

// 重新导出 posixJoin 供调用方(比如 spec 测试)使用;CodebaseManager 内部仍依赖。
export { posixJoin }