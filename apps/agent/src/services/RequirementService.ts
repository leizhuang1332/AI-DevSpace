/**
 * RequirementService —— issue 03 (ADR-0030 D3 / D5) + issue 16 需求关联独立 clone
 *
 * 封装对每个 repo 走 `git clone` + `git checkout -b` 的业务逻辑:
 * 1. 校验 req 目录是否存在
 * 2. 校验 repo 在 workspace 注册表里(否则 E_REPO_NOT_FOUND)
 * 3. 调 CodebaseManager.clone(reqId, repoName, gitUrl, branchName)
 * 4. 任一成功 → 写 meta.yaml.branchName(SSR 持久化契约沿用)
 * 5. 通过 SseHub 推 `repo-clone-progress` 事件
 *    (pending → cloning → retrying → ready/failed)
 *
 * 设计要点(issue 16):
 * - **串行执行**:`for (const name of repoNames) await this.attachRepo(...)`
 *   取代 issue 03 的 Promise.allSettled 并行 —— 并发 git clone 是网络层
 *   sideband packet 错位 + GitHub HTTPS 并发竞争的根因,治本必须串行
 * - 纯函数语义:每个 repo 的失败独立处理,不抛到调用方
 * - CodebaseManager 通过 DI 注入,单元测试用 fake codebasemgr
 * - SseHub 可选注入(测试时给 fakeHub 验证事件顺序)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import yaml from 'yaml'
import mammoth from 'mammoth'
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  DetachRepoErrorCode,
  RepoAttachErrorCode,
  RepoCloneProgressStatus,
  RequirementErrorCode,
  STATUS_PROGRESS_MAP,
  UPLOAD_VALIDATION_MESSAGES,
  buildRequirementMdTemplate,
  extensionToImageMime,
  getUploadExtension,
  hasDocxMagic,
  imageMimeToExtension,
  isSupportedUploadExtension,
  isSupportedUploadMime,
  slugify,
  type AssetMeta,
  type AttachRepoResult,
  type DetachRepoResult,
  type RequirementMeta,
  type RequirementStatusT,
  type RequirementSummary,
  type ResourceTreeNode,
  type UploadValidationReason,
  type UploadValidationResult as SharedUploadValidationResult,
} from '@ai-devspace/shared'
import type {
  CodebaseManager,
  GitExec,
} from '../codebase/CodebaseManager.js'
import { createCodebaseManager } from '../codebase/CodebaseManager.js'
import type { SseHub } from '../sse/SseHub.js'
import type { WorkspaceService } from './WorkspaceService.js'

/**
 * 抽出 `name.ext` 末尾的扩展名(无 `.` 前缀);`a.b.c` → `c`,`a` → `''`。
 * 抽到这里避免在 `listAssets` 与 `resolveAssetFile` 里出现相同 inline 切片。
 */
function extractExt(name: string): string {
  if (!name.includes('.')) return ''
  return name.slice(name.lastIndexOf('.') + 1)
}

/**
 * 资源树节点排序:目录优先,然后按文件名升序(规避兄弟节点命名混排)。
 * 抽出来让 `list()` 末尾读起来清楚 —— 直接 `out.sort(compareResourceNodes)`。
 */
function compareResourceNodes(a: ResourceTreeNode, b: ResourceTreeNode): number {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1
  }
  if (a.name < b.name) return -1
  if (a.name > b.name) return 1
  return 0
}

// mammoth 1.12 运行时仍提供 convertToMarkdown,但类型声明遗漏了该兼容 API。
const mammothWithMarkdown = mammoth as typeof mammoth & {
  convertToMarkdown: typeof mammoth.convertToHtml
}

export interface ParsedUploadImage {
  name: string
  base64: string
  mime: string
}

export type ParseUploadResult =
  | { ok: true; markdown: string; images: ParsedUploadImage[] }
  | { ok: false; reason: 'parse-error'; message: string }

export type ValidateUploadResult = SharedUploadValidationResult<
  UploadValidationReason | 'parse-error'
>

function extractDataUriImages(markdown: string): ParsedUploadImage[] {
  const images: ParsedUploadImage[] = []
  const dataUriPattern = /data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)/gi

  for (const match of markdown.matchAll(dataUriPattern)) {
    images.push({
      name: `prd-${images.length + 1}`,
      mime: match[1].toLowerCase(),
      base64: match[2],
    })
  }

  return images
}

export interface RequirementServiceDeps {
  root: string
  /** 兼容旧构造 — 不再使用,保留字段以避免构造时大改测试 fixture */
  git?: GitExec
  /** clone 路径管理(issue 03);默认用 createCodebaseManager 构造 */
  codebaseMgr?: CodebaseManager
  /** workspace 注册表:用于 repoNames → gitUrl 解析 */
  workspace?: WorkspaceService
  /** SSE 通道:attachRepos 推送 `repo-clone-progress` 事件 */
  sseHub?: SseHub
  /** 测试钩子:用真实 setTimeout 时禁用以便测速 */
  sleep?: (ms: number) => Promise<void>
}

export class RequirementService {
  private readonly root: string
  private readonly codebaseMgr: CodebaseManager
  private readonly workspace?: WorkspaceService
  private readonly sseHub?: SseHub
  private readonly git?: GitExec
  private readonly sleep: (ms: number) => Promise<void>

  // ===========================================================================
  // issue:需求级 codebase detach(ADR-0034)
  //
  // Per-requirement mutex:把所有会改 `requirements/<reqId>/codebase/` 与 meta.yaml
  // 的入口(`attachRepo` / `attachRepos` / `detachRepo`)串行化,防止 detach + attach
  // 同 req 并发引发的 fs 状态机错位。模式与 `WorkspaceService.registryLock`
  // (apps/agent/src/services/WorkspaceService.ts:130-132)同款。
  // ===========================================================================
  private readonly requirementLocks = new Map<string, Promise<unknown>>()

  constructor(deps: RequirementServiceDeps) {
    this.root = deps.root
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    // 默认构造 CodebaseManager(需要一个 GitExec);如果调用方既不传 codebaseMgr
    // 也不传 git,这里降级为 undefined 抛错 —— 显式优于隐式。
    if (deps.codebaseMgr) {
      this.codebaseMgr = deps.codebaseMgr
    } else if (deps.git) {
      this.codebaseMgr = createCodebaseManager({ root: deps.root, git: deps.git })
    } else {
      throw new Error(
        'RequirementService: 必须提供 codebaseMgr 或 git(用于构造默认 CodebaseManager)',
      )
    }
    this.workspace = deps.workspace
    this.sseHub = deps.sseHub
    // Issue 12:前置校验(fetchDefaultBranch)直接复用 git。
    // 未注入时不阻断 attachRepo —— 走原 clone 路径(降级策略,见 ADR-0031)。
    this.git = deps.git
  }

  async parseUpload(buffer: Buffer, filename: string): Promise<ParseUploadResult> {
    const extension = getUploadExtension(filename)
    if (extension === '.md' || extension === '.txt') {
      return {
        ok: true,
        markdown: buffer.toString('utf8'),
        images: [],
      }
    }

    if (extension === '.docx') {
      try {
        const result = await mammothWithMarkdown.convertToMarkdown(
          { buffer },
          {
            convertImage: mammoth.images.imgElement(async (image) => ({
              src: `data:${image.contentType};base64,${await image.readAsBase64String()}`,
            })),
          },
        )
        return {
          ok: true,
          markdown: result.value,
          images: extractDataUriImages(result.value),
        }
      } catch (error) {
        return {
          ok: false,
          reason: 'parse-error',
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }

    return {
      ok: false,
      reason: 'parse-error',
      message: `不支持的文件格式: ${extension}`,
    }
  }

  async validateUpload(
    buffer: Buffer,
    filename: string,
    declaredMime: string,
  ): Promise<ValidateUploadResult> {
    const extension = getUploadExtension(filename)
    if (!isSupportedUploadExtension(extension)) {
      return {
        ok: false,
        reason: 'ext',
        message: UPLOAD_VALIDATION_MESSAGES.ext,
      }
    }

    if (!isSupportedUploadMime(declaredMime)) {
      return {
        ok: false,
        reason: 'mime',
        message: UPLOAD_VALIDATION_MESSAGES.mime,
      }
    }

    if (extension === '.docx' && !hasDocxMagic(buffer)) {
      return {
        ok: false,
        reason: 'magic',
        message: UPLOAD_VALIDATION_MESSAGES.magic,
      }
    }

    if (buffer.length > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        reason: 'size',
        message: UPLOAD_VALIDATION_MESSAGES.size,
      }
    }

    if (extension !== '.docx') return { ok: true }

    const parsed = await this.parseUpload(buffer, filename)
    if (!parsed.ok) return parsed

    if (
      parsed.images.some(
        (image) => Buffer.byteLength(image.base64, 'base64') > MAX_UPLOAD_IMAGE_BYTES,
      )
    ) {
      return {
        ok: false,
        reason: 'image-too-large',
        message: UPLOAD_VALIDATION_MESSAGES.imageTooLarge,
      }
    }

    return { ok: true }
  }

  /** requirement 目录是否存在(`<root>/requirements/<id>`) */
  async checkRequirementExists(reqId: string): Promise<boolean> {
    const reqDir = join(this.root, 'requirements', reqId)
    return existsSync(reqDir)
  }

  /**
   * 探测 base 分支:优先 main,fallback master —— 已废弃(issue 03 取消 base 探测)。
   *
   * 历史:旧 WorktreeManager 路径需要在已 clone 的主仓库里探测 main/master
   * 才能 worktree add -b。新 CodebaseManager 直接 `git clone + git checkout -b`,
   * clone 必然带 HEAD,不依赖 base 探测。本方法保留仅为不破坏旧测试,所有内部
   * 调用都已删除;未来若有用户调到这里,直接抛错指引新路径。
   */
  async resolveBaseBranch(_repoPath: string): Promise<null> {
    throw new Error(
      'resolveBaseBranch 已废弃(issue 03):CodebaseManager.clone 不再需要 base 探测',
    )
  }

  /**
   * 为单个 repo 跑 clone(issue 03 新实装)。
   *
   * 流程:
   * 1. 查注册表(workspace.findRepoByName)→ 拿到 gitUrl;缺失返 E_REPO_NOT_FOUND
   * 2. setPending(写 `.pending-<name>` 标记)
   * 3. codebaseMgr.clone(reqId, repoName, gitUrl, branchName) → 真实 git clone
   * 4. clearPending(无论成败 —— 标记已写就清掉,半成品由 codebaseMgr 内部清理)
   *
   * 锁:detach(ADR-0034)需要 per-requirement 互斥,因此公共 `attachRepo` 把整
   * 个 body 包进 `withRequirementLock`;`_attachRepoInner` 是无锁实现,被
   * `attachRepos` 在持锁的 body 内复用,避免双重 acquire 死锁。
   *
   * @returns AttachRepoResult (ok=true 给 codebasePath,ok=false 给 code + message)
   */
  async attachRepo(
    reqId: string,
    repoName: string,
    branchName: string,
  ): Promise<AttachRepoResult> {
    return this.withRequirementLock(reqId, () =>
      this._attachRepoInner(reqId, repoName, branchName),
    )
  }

  /** attachRepo 的无锁实现 —— 严禁直接从 route handler 调用,只供持锁的
   *  `attachRepo` / `attachRepos` 在锁内调用。 */
  private async _attachRepoInner(
    reqId: string,
    repoName: string,
    branchName: string,
  ): Promise<AttachRepoResult> {
    // 1. 查注册表
    if (!this.workspace) {
      return {
        ok: false,
        repoName,
        code: RepoAttachErrorCode.E_INTERNAL,
        message: 'RequirementService.workspace 未注入,无法查注册表',
      }
    }
    const entry = await this.workspace.findRepoByName(repoName)
    if (!entry) {
      return {
        ok: false,
        repoName,
        code: RepoAttachErrorCode.E_REPO_NOT_FOUND,
        message: `注册表无仓库 ${repoName}`,
      }
    }

    // 1.5 Issue 12:前置校验 —— branchName 不能与 upstream 默认分支同名
    //    (避免走到 git checkout -b 必败路径,产生孤儿 .git)
    //    ls-remote 失败(网络 / 鉴权 / 仓库空)→ 降级 null,不阻断。
    if (this.git) {
      const defaultBranch = await this.fetchDefaultBranch(this.git, entry.gitUrl)
      if (defaultBranch && defaultBranch === branchName) {
        this.broadcastProgress(
          reqId,
          repoName,
          'failed',
          `branchName "${branchName}" 与 upstream 默认分支同名,无法创建`,
        )
        return {
          ok: false,
          repoName,
          code: RepoAttachErrorCode.E_BRANCH_EXISTS,
          message: `branchName "${branchName}" 与 ${entry.gitUrl} 默认分支同名`,
        }
      }
    }

    // 2. 推 pending + 落半成品标记
    await this.codebaseMgr.setPending(reqId, repoName)
    this.broadcastProgress(reqId, repoName, 'cloning')

    // 3. clone(Issue 16:传 onRetry 回调,SSE 推送 retrying 状态)
    let result: Awaited<ReturnType<typeof this.codebaseMgr.clone>>
    try {
      result = await this.codebaseMgr.clone(
        reqId,
        repoName,
        entry.gitUrl,
        branchName,
        // attempt 是 1-based 次数(第 1 次 retry = 第 2 次尝试)。
        // spec 16.5 badge 用 attempt 显示「第 N/2 次重试」(N=attempt, 2=MAX_RETRIES)
        (attempt) => {
          this.broadcastProgressWithAttempt(
            reqId,
            repoName,
            'retrying',
            attempt,
            `网络抖动,第 ${attempt} 次重试中...`,
          )
        },
      )
    } catch (err) {
      // clone 不应抛(默认实现都返 result);兜底
      await this.codebaseMgr.clearPending(reqId, repoName)
      this.broadcastProgress(reqId, repoName, 'failed', (err as Error).message)
      return {
        ok: false,
        repoName,
        code: RepoAttachErrorCode.E_INTERNAL,
        message: (err as Error).message,
      }
    }

    // 4. 清 pending(无论成败 —— 标记已写就清掉)
    await this.codebaseMgr.clearPending(reqId, repoName)

    if (result.ok) {
      this.broadcastProgress(reqId, repoName, 'ready')
      // base 字段保留为 'main'(ADR-0030:clone 必然带 HEAD,语义与 'main' 等价;
      // 此处不依赖本地探测,统一返回 'main' 给 web 端做条件渲染兼容)
      return {
        ok: true,
        repoName,
        branch: branchName,
        codebasePath: result.path,
        base: 'main',
      }
    }
    this.broadcastProgress(reqId, repoName, 'failed', result.message)
    return {
      ok: false,
      repoName,
      code: result.code,
      message: result.message,
    }
  }

  /**
   * 推 `repo-clone-progress` 事件到 req 通道(Web 端订阅后实时显示哪个 repo
   * 还在 cloning / 已 ready / failed)。
   *
   * - status: 'pending' | 'cloning' | 'ready' | 'failed'
   * - failed 时附 error 字段
   * - SseHub 没注入时 silently no-op(单元测试环境常见)
   *
   * 不耦合具体 SseEvent variant 定义 —— `SseHub.publish` 接受 SseEvent 联合,
   * 这里直接构造一个 `{type: 'repo-clone-progress', ...}` 形状对象。
   */
  private broadcastProgress(
    reqId: string,
    repoName: string,
    status: RepoCloneProgressStatus,
    error?: string,
  ): void {
    this.broadcastProgressWithAttempt(reqId, repoName, status, undefined, error)
  }

  /**
   * Issue 16:broadcastProgress 的变体 —— 附 `attempt` 数字。
   * SSE 事件带 attempt 字段,前端 badge 用此显示「第 N/2 次重试」文案。
   */
  private broadcastProgressWithAttempt(
    reqId: string,
    repoName: string,
    status: RepoCloneProgressStatus,
    attempt?: number,
    error?: string,
  ): void {
    if (!this.sseHub) return
    const event = {
      type: 'repo-clone-progress' as const,
      reqId,
      repoName,
      status,
      ts: Date.now(),
      ...(error ? { error } : {}),
      ...(attempt !== undefined ? { attempt } : {}),
    }
    this.sseHub.publish(reqId, event)
  }

  /**
   * Issue 12 / ADR-0031:`git ls-remote --symref <gitUrl> HEAD` 拿 upstream
   * 默认分支名(如 'main' / 'master')。
   *
   * - 成功 → 返回分支名
   * - 失败(网络 / 鉴权 / 仓库空 / stdout 无 symref)→ 返 null(降级,不阻断 attach)
   * - 抛错(罕见,execFile 默认不抛)→ catch 后返 null
   *
   * 一次 ~200ms 网络调用,但 attach 是低频操作(< 10 次/用户/天),
   * 总延迟影响可忽略。鉴权失败 / hang 由 `createDefaultGitExec` 的 5min
   * timeout + 强制 env(Issue 05)兜底。
   */
  private async fetchDefaultBranch(
    git: GitExec,
    gitUrl: string,
  ): Promise<string | null> {
    try {
      const res = await git(['ls-remote', '--symref', gitUrl, 'HEAD'])
      if (res.code !== 0) return null
      // stdout 格式: "ref: refs/heads/main\t<commit-sha>"
      const match = res.stdout.match(/ref:\s*refs\/heads\/(\S+)/)
      return match?.[1] ?? null
    } catch {
      return null
    }
  }

  /**
   * 批量 attach(issue 03 + 16):**串行** + 异步,任一成功 → meta.yaml 持久化 branchName。
   *
   * 流程:
   * 0. 校验:所有 repoName 必须在注册表存在(否则提前返 E_REPO_NOT_FOUND)
   * 1. 给每个 repo 推 pending 事件
   * 2. `Promise.allSettled` 并行跑 attachRepo,失败不影响其他
   * 3. 收集 results;任一成功 → 写 meta.yaml.branchName
   *
   * 设计要点:
   * - 任一 repo 失败都独立返,符合 attach-repos-dialog 的部分成功渲染
   * - 半成品目录由 CodebaseManager.clone 在 checkout 失败时自清
   * - meta.yaml 写失败只 warn,不回滚已成功的 clone
   *
   * 锁(ADR-0034):per-requirement mutex 串行化所有 fs 写入口,防止与
   * `detachRepo` 并发引发状态机错位。持锁 body 内调用 `_attachRepoInner`
   * 而非 `attachRepo`,避免双重 acquire 死锁。
   */
  async attachRepos(
    reqId: string,
    repoNames: readonly string[],
    branchName: string,
  ): Promise<AttachRepoResult[]> {
    return this.withRequirementLock(reqId, async () => {
      // 0. 校验(注册表里必须有所有 repo)
      if (!this.workspace) {
        return repoNames.map((name) => ({
          ok: false,
          repoName: name,
          code: RepoAttachErrorCode.E_INTERNAL,
          message: 'RequirementService.workspace 未注入,无法查注册表',
        }))
      }
      for (const name of repoNames) {
        const entry = await this.workspace.findRepoByName(name)
        if (!entry) {
          return [
            {
              ok: false,
              repoName: name,
              code: RepoAttachErrorCode.E_REPO_NOT_FOUND,
              message: `注册表无仓库 ${name}`,
            },
          ]
        }
      }

      // 1. pending 事件(每个 repo 一次,不等 clone 启动就告诉前端「马上开始」)
      for (const name of repoNames) {
        this.broadcastProgress(reqId, name, 'pending')
      }

      // 2. Issue 16:串行跑 _attachRepoInner,不再 Promise.allSettled 并行
      //    根因:多个 git clone OS 进程并发时,网络层 sideband packet 错位
      //    + GitHub HTTPS 并发大文件下载竞争 → 多个 repo 同时失败
      //    取舍:N 个 repo 用户等 N×T 时间,体感稳定可预测(每个都成功/失败清晰)
      //    锁:直接调 _attachRepoInner(无锁)而非 this.attachRepo(包锁),避免死锁
      const results: AttachRepoResult[] = []
      for (const name of repoNames) {
        try {
          results.push(await this._attachRepoInner(reqId, name, branchName))
        } catch (err) {
          // _attachRepoInner 不应抛(默认实现都返 result);兜底
          results.push({
            ok: false as const,
            repoName: name,
            code: RepoAttachErrorCode.E_INTERNAL,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }

      // 3. 任一成功 → 写 meta.yaml.branchName(SSR 持久化契约)
      if (results.some((r) => r.ok)) {
        this.persistBranchName(reqId, branchName)
      }

      return results
    })
  }

  // ===========================================================================
  // ADR-0034 —— 需求级 codebase detach
  //
  // 取消某个 repo 与本 req 的关联:
  // 1. 验 req 存在
  // 2. 验 codebase/<name>/ 存在
  // 3. rm 先(CodebaseManager.remove 已含 safeRm + 清 .pending-<name>)
  // 4. deriveRepos 看剩余 N;N=0 → 顺带清 meta.yaml::branchName(用空串)
  // 5. 返 {ok:true, remainingRepos:[]},route 层映射 204
  //
  // 状态门禁:已去掉。原 Q2 "仅 DRAFTING 可 detach" 限制 ANALYZING / BOARD /
  // WRAP-UP 期间无法取消关联,但用户实际操作中存在需求已 analyzing 才发现
  // attach 错了库、必须 detach 重来的场景 —— 加状态门禁只会把"重新 attach"
  // 的修复路径堵死。Detach 是破坏性操作,确认对话框 (ADR-0034 Q3) 是兜底。
  //
  // 失败语义(ADR-0034 Q7 rm 先 + Q4 仅 N=1→0 时清 branchName):
  // - rm 失败(safeRm throw)→ 直接抛到 caller,meta.yaml 未触;route 层 500
  // - rm 成功 + deriveRepos 看 N=0 + persistBranchName 失败 → branchName 残留,
  //   纯字段脏;下次 attach 会用新 branchName 覆盖空字符串,无副作用
  // ===========================================================================
  async detachRepo(
    reqId: string,
    repoName: string,
  ): Promise<DetachRepoResult> {
    return this.withRequirementLock(reqId, async () => {
      // 1. 验 req 存在
      if (!(await this.checkRequirementExists(reqId))) {
        return {
          ok: false,
          code: DetachRepoErrorCode.E_REQUIREMENT_NOT_FOUND,
          message: `需求 ${reqId} 不存在`,
        }
      }

      const reqDir = this.requirementDirPath(reqId)

      // 2. 验 codebase/<name>/ 存在
      const codeDir = join(reqDir, 'codebase', repoName)
      if (!existsSync(codeDir)) {
        return {
          ok: false,
          code: DetachRepoErrorCode.E_CODEBASE_NOT_FOUND,
          message: `codebase ${repoName} 不存在`,
        }
      }

      // 3. rm 先(Q7)。CodebaseManager.remove 内部走 safeRm(fd race retry 3 次,
      //    Issue 13 后 throw);失败直接抛出,meta.yaml 未触。
      await this.codebaseMgr.remove(reqId, repoName)

      // 4. deriveRepos 看 N,Q4:仅当 N=1→0 时清 branchName
      const remaining = this.deriveRepos(reqDir)
      if (remaining.length === 0) {
        // persistBranchName(reqId, '') 走现有实现 → 覆盖 branchName 字段为空串;
        // 失败仅 console.warn(沿用 attachRepos 同样语义),不影响 detach 主结果
        this.persistBranchName(reqId, '')
      }

      return {
        ok: true,
        repoName,
        remainingRepos: remaining,
      }
    })
  }

  /**
   * Per-requirement 进程内 mutex(ADR-0034 Q5):
   * 把所有改 `requirements/<reqId>/codebase/` 与 meta.yaml 的入口串行化。
   *
   * 模式参考 `WorkspaceService.registryLock`(apps/agent/src/services/
   * WorkspaceService.ts:130-132 + 596-647)。`fn` throw → 锁自动释放。
   *
   * 跨进程并发(多 agent 实例 / 多进程)目前不防 —— 与 `WorkspaceService.mutateRegistry`
   * 一样靠调用方在更高层加进程间锁。本期 DRAFTING 是单用户单进程场景,暂不引入。
   */
  private async withRequirementLock<T>(
    reqId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.requirementLocks.get(reqId) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    this.requirementLocks.set(reqId, next)
    try {
      await prev
      return await fn()
    } finally {
      release()
      // 仅当当前 entry 仍是本调用注册的 next 才删,避免误删并发持有的更新 entry
      if (this.requirementLocks.get(reqId) === next) {
        this.requirementLocks.delete(reqId)
      }
    }
  }

  /** 把 branchName 写入 meta.yaml —— 抽出独立方法便于 attachRepos 调用 */
  private persistBranchName(reqId: string, branchName: string): void {
    try {
      const reqDir = this.requirementDirPath(reqId)
      // reqDir 不存在时(测试绕过 createRequirement / 早期 call site):
      // 兜底 mkdirSync,避免 writeMetaYaml 抛 ENOENT
      if (!existsSync(reqDir)) {
        mkdirSync(reqDir, { recursive: true, mode: 0o700 })
      }
      const existing = this.readMetaYaml(reqDir)
      const nextMeta: RequirementMeta = existing
        ? { ...existing, branchName }
        : {
            id: reqId,
            title: reqId,
            createdAt: new Date().toISOString(),
            branchName,
          }
      this.writeMetaYaml(reqDir, nextMeta)
    } catch (err) {
      // meta.yaml 写盘失败不应回滚已成功的 clone —— 仅日志告警
      // eslint-disable-next-line no-console
      console.warn(
        `[RequirementService] failed to persist branchName to meta.yaml for ${reqId}:`,
        err,
      )
    }
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
  createRequirement(
    rawTitle: string,
    prdMarkdown?: string,
    images?: readonly ParsedUploadImage[],
  ): CreateRequirementResult {
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
      // ticket 03 (ADR-0015 D3 / D5) —— Dialog 预填路径:
      // 1) 落 `assets/prd-N.<ext>`(若有 images,与 `landAssets` 行为一致);
      // 2) 把 markdown 中的 `data:` URI 替换为相对路径;
      // 3) 写 `requirement.md`(无 images / 无 prdMarkdown → 默认模板)。
      // 关键:ticket 03 验收要求 DRAFTING 打开看到完整 PRD(含图片),
      //   因此 images 落地必须发生在 createRequirement(而不是 parseForDialog)。
      const finalMarkdown = images && images.length > 0
        ? this.landAssetsAndRewrite(id, prdMarkdown ?? '', images)
        : prdMarkdown
      this.writeRequirementMd(reqDir, title, finalMarkdown)
    } catch (err) {
      throw new RequirementServiceError(
        RequirementErrorCode.E_INTERNAL,
        `write meta/requirement failed: ${(err as Error).message}`,
      )
    }

    return { id, title, createdAt, dirPath: reqDir }
  }

  /**
   * ticket 03 私有 helper:在 `createRequirement` 内一步完成 `landAssets` +
   * `replaceDataUriWithAssetPath`,返回替换后的 markdown。
   * - `prdMarkdown` 已经是 `parseForDialog` 解析后的形态(含 data URI)
   * - `images` 与 `parseUpload` 返回的 images 数组一致
   * - 写盘失败抛错(沿用 `landAssets` 语义)
   */
  private landAssetsAndRewrite(
    reqId: string,
    prdMarkdown: string,
    images: readonly ParsedUploadImage[],
  ): string {
    this.landAssets(reqId, images)
    return this.replaceDataUriWithAssetPath(reqId, prdMarkdown)
  }

  /** 写 `meta.yaml` —— 顺序字段,lineWidth=0 防 yaml 库截断长字符串 */
  private writeMetaYaml(reqDir: string, meta: RequirementMeta): void {
    const body = yaml.stringify(meta, { indent: 2, lineWidth: 0 })
    writeFileSync(join(reqDir, 'meta.yaml'), body, { mode: 0o600 })
  }

  /** 写 `requirement.md` —— 默认走模板;ticket 03 Dialog 预填时传入解析后的 markdown */
  private writeRequirementMd(
    reqDir: string,
    title: string,
    prdMarkdown?: string,
  ): void {
    const body =
      prdMarkdown && prdMarkdown.trim().length > 0
        ? prdMarkdown
        : buildRequirementMdTemplate(title)
    writeFileSync(join(reqDir, 'requirement.md'), body, 'utf8')
  }

  // ===========================================================================
  // ticket 07a —— 列出所有需求(ADR-0014 状态软标签 + progress 派生)
  // ===========================================================================

  /**
   * 区分 draft / drafting 的 requirement.md 字节阈值(> 此值视为已起草)。
   *
   * 默认空模板含 "# <title>\n\n<!-- ... -->\n\n" 约 50+ 字,远大于 10;
   * 纯空白或单标题的极短文件视为 draft(尚未开始写内容)。
   */
  private static readonly DRAFTING_CONTENT_MIN_BYTES = 10

  /**
   * 列出所有需求(ticket 07a · ADR-0014)。
   *
   * 算法:
   * 1. 扫 <root>/requirements/ 顶层,过滤 ^req-\d+- 目录(与 maxRequirementSeq 一致)
   * 2. 每个 reqDir 读 meta.yaml → { id, title, createdAt }
   * 3. 派生 status(方案 β,见 deriveStatus)
   * 4. 派生 progress = STATUS_PROGRESS_MAP[status]
   * 5. 派生 repos = requirements/<id>/codebase/ 子目录名列表(过滤 . 开头,issue 08)
   * 6. 派生 updatedAt = fs.statSync(reqDir).mtime.toISOString()
   * 7. 排序:按 updatedAt 倒序
   *
   * 容错:某 reqDir 读 meta.yaml / stat 失败 → 跳过该目录(不抛)。
   */
  listRequirements(): RequirementSummary[] {
    const out: RequirementSummary[] = []
    const dir = this.requirementsDir
    if (!existsSync(dir)) return out

    for (const name of readdirSync(dir)) {
      if (!/^req-\d+-/.test(name)) continue
      const reqDir = this.requirementDirPath(name)
      try {
        const meta = this.readMetaYaml(reqDir)
        if (!meta) continue
        const status = this.deriveStatus(reqDir)
        const summary: RequirementSummary = {
          id: meta.id,
          title: meta.title,
          status,
          progress: STATUS_PROGRESS_MAP[status],
          repos: this.deriveRepos(reqDir),
          createdAt: meta.createdAt,
          updatedAt: this.deriveUpdatedAt(reqDir),
        }
        out.push(summary)
      } catch (err) {
        // 容错:残缺 reqDir 不阻塞整体列表;不引入 logger 依赖,用 console.warn 兜底
        // eslint-disable-next-line no-console
        console.warn(`[RequirementService] skipping malformed reqDir=${reqDir}:`, err)
        continue
      }
    }

    // 按 updatedAt 倒序
    out.sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    )
    return out
  }

  /** 读 meta.yaml(返回 RequirementMeta);格式不对或字段缺失返回 null */
  private readMetaYaml(reqDir: string): RequirementMeta | null {
    const file = join(reqDir, 'meta.yaml')
    if (!existsSync(file)) return null
    try {
      const raw = readFileSync(file, 'utf8')
      const parsed = yaml.parse(raw) as
        | { id?: unknown; title?: unknown; createdAt?: unknown }
        | null
      if (
        !parsed ||
        typeof parsed.id !== 'string' ||
        typeof parsed.title !== 'string' ||
        typeof parsed.createdAt !== 'string'
      ) {
        return null
      }
      return { id: parsed.id, title: parsed.title, createdAt: parsed.createdAt }
    } catch {
      return null
    }
  }

  /**
   * 派生 status(ADR-0014 D2 方案 β)
   *
   * 优先级(高 → 低):
   * - 顶层 .archived 文件存在 → 'archived'
   * - wrapup/ 子目录存在 → 'done'
   * - plan/tasks.md 存在 → 'planning'(优先于 implementing,因 plan 是 implementing 前置)
   * - design/ 子目录存在 → 'designing'
   * - clarifying/ 子目录存在 → 'clarifying'
   * - analysis/ 子目录存在 → 'analyzing'
   * - requirement.md 存在且非空(> 10 字节) → 'drafting'
   * - 否则 → 'draft'
   */
  private deriveStatus(reqDir: string): RequirementStatusT {
    if (existsSync(join(reqDir, '.archived'))) return 'archived'
    if (existsSync(join(reqDir, 'wrapup'))) return 'done'
    if (existsSync(join(reqDir, 'plan', 'tasks.md'))) return 'planning'
    if (existsSync(join(reqDir, 'design'))) return 'designing'
    if (existsSync(join(reqDir, 'clarifying'))) return 'clarifying'
    if (existsSync(join(reqDir, 'analysis'))) return 'analyzing'
    // drafting 与 draft 区分:requirement.md 存在且非空(> DRAFTING_CONTENT_MIN_BYTES)
    const reqMd = join(reqDir, 'requirement.md')
    if (existsSync(reqMd)) {
      try {
        const content = readFileSync(reqMd, 'utf8')
        if (content.length > RequirementService.DRAFTING_CONTENT_MIN_BYTES) return 'drafting'
      } catch {
        /* fallthrough to draft */
      }
    }
    return 'draft'
  }

  /** 派生 repos = reqDir/codebase/ 子目录名列表(过滤 . 开头 + 非目录)
   *
   * issue 08 (ADR-0030 D5 · Q11):路径常量 `repos/` → `codebase/`,对齐
   * issue 03 的 `CodebaseManager` clone 落盘形态。
   *
   * - 老形态 `requirements/<id>/repos/<name>/` (旧 WorktreeManager 的 worktree
   *   目录)保留在盘上**不被迁移**,代码只读 `codebase/`;决策 Q11 显式接受
   *   「老 worktree 内未 push 的本地提交不可恢复」代价,UI 提示「重新关联会
   *   丢失本地未提交改动」是 P2 优化。
   * - `.pending-<name>` 半成品标记(由 `CodebaseManager.setPending` 创建)
   *   一并被过滤,与后端 `CodebaseManager.listByRepo` 行为一致。
   * - 同名非目录(如用户误放的 `README.md` / `.DS_Store`)**不**被当作
   *   「仓库」返回;与 `CodebaseManager.scanOrphanedPending`、
   *   `WorkspaceService.scanLegacyPerRequirementRepos` 行为一致。
   */
  private deriveRepos(reqDir: string): string[] {
    const codebaseDir = join(reqDir, 'codebase')
    if (!existsSync(codebaseDir)) return []
    try {
      return readdirSync(codebaseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
    } catch {
      return []
    }
  }

  /** 派生 updatedAt = reqDir mtime(ISO);失败兜底 epoch 0 */
  private deriveUpdatedAt(reqDir: string): string {
    try {
      return statSync(reqDir).mtime.toISOString()
    } catch {
      return new Date(0).toISOString()
    }
  }

  // ===========================================================================
  // ticket 02 —— `assets/` 落地(ADR-0015 D5)
  // ===========================================================================

  /** `requirements/<id>/assets/` 绝对路径 */
  assetsDir(reqId: string): string {
    return join(this.requirementDirPath(reqId), 'assets')
  }

  /** `requirements/<id>/assets/<name>` 绝对路径 */
  assetPath(reqId: string, name: string): string {
    return join(this.assetsDir(reqId), name)
  }

  /**
   * 把 `parseUpload()` 给的图片数组按顺序写到 `requirements/<id>/assets/`:
   * 第 i 张 → `prd-<i>.<ext>`(`ext` 通过 `imageMimeToExtension(mime)` 派生)。
   *
   * 语义:
   * - 同步写盘(沿用本类其他 IO 风格,如 `createRequirement`)。
   * - `mkdir -p` 确保 `assets/` 存在(recursive: true)。
   * - base64 → Buffer → `writeFileSync`(mode 0o600,与 `meta.yaml` 一致)。
   * - 写盘失败抛错 —— **不**做写一半回滚,上游覆盖流程决定是否回滚。
   * - 返回项里 `path` 与 `url` 分离:`path` 是相对 workspace root 的相对路径,
   *   `url` 是 `/api/requirement/<id>/assets/<name>`(供前端 fetcher 使用)。
   */
  landAssets(
    reqId: string,
    images: readonly ParsedUploadImage[],
  ): AssetMeta[] {
    if (images.length === 0) return []
    const dir = this.assetsDir(reqId)
    mkdirSync(dir, { recursive: true, mode: 0o700 })

    const out: AssetMeta[] = []
    images.forEach((image, idx) => {
      const name = `prd-${idx + 1}.${imageMimeToExtension(image.mime)}`
      const bytes = Buffer.from(image.base64, 'base64')
      const absPath = this.assetPath(reqId, name)
      writeFileSync(absPath, bytes, { mode: 0o600 })
      out.push({
        name,
        path: this.relativeAssetPath(reqId, name),
        url: this.assetUrl(reqId, name),
        size: bytes.length,
        mime: image.mime,
      })
    })
    return out
  }

  /** `path` 字段相对 workspace root(便于 agent 内部测试断言;实际写盘走 `assetPath`)
   *
   *  **必须用 POSIX 分隔符** —— 该字段经 JSON API 返回给 web 端作为逻辑资源标识
   *  (拼 URL / 做 key / 展示),不是用来给 fs 用的。Windows 下若用 `join()` 会
   *  产出 `requirements\<id>\assets\x.png`,反斜杠进 URL 即破。真实写盘路径由
   *  `assetPath()` 单独用 `join()` 生成,与本方法无关。 */
  private relativeAssetPath(reqId: string, name: string): string {
    return `requirements/${reqId}/assets/${name}`
  }

  /** `url` 字段:agent 路由路径(前端 fetcher 追加 agent base) */
  private assetUrl(reqId: string, name: string): string {
    return `/api/requirement/${encodeURIComponent(reqId)}/assets/${encodeURIComponent(name)}`
  }

  /**
   * 替换 markdown 中的 `data:image/<mime>;base64,...` 段为相对路径。
   *
   * 契约:
   * - 纯函数:不入参 mutation,返回新字符串。
   * - 严格按出现顺序编号(第 1 张 → `prd-1.<ext>`、第 2 张 → `prd-2.<ext>` ……),
   *   与 `landAssets` 的命名一致。
   * - 不识别的 data URI(非 image / 缺 base64 / 非完整 URI)保留原文不动 —— 上游
   *   `validateUpload` 已经把陌生内容挡在进栈前,这里再宽容一次。
   * - 与 `landAssets` 共享 `imageMimeToExtension`,保证命名一致。
   */
  replaceDataUriWithAssetPath(reqId: string, markdown: string): string {
    const re = /data:(image\/[a-z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)/gi
    let n = 0
    return markdown.replace(re, (_match, mime: string, _b64: string) => {
      n += 1
      return `assets/prd-${n}.${imageMimeToExtension(mime)}`
    })
  }

  // ===========================================================================
  // ticket 03 (ADR-0015 D3 / D8) —— 上传管道 service entry
  //
  // 把 ticket 01 + 02 的 `parseUpload` / `landAssets` / `replaceDataUriWithAssetPath`
  // 串成两条语义不同的入口:
  // - `parseForDialog(buffer, filename, mime)`  —— 仅跑闸门 + 解析,返回 markdown,**不写盘**
  //   用于 Dialog 预填;真正的写盘等到用户点"创建"时由 createRequirement 接管。
  // - `uploadAndReplace(reqId, buffer, filename, mime)` —— 闸门 + 解析 + 落地 assets/
  //   + 替换 data URI + 覆盖 requirement.md,用于 DRAFTING 工位"上传新版本"(W4)。
  //
  // 两条入口都先跑 `validateUpload`(ext + magic + MIME + size + 单图 ≤ 2 MB),
  // 闸门失败 → 返回 `{ok:false, reason, message}`,调用方映射到顶部红条。
  // ===========================================================================

  /**
   * Dialog 预填:闸门通过后跑 `parseUpload` 返回 markdown + 待落地的图片列表。
   *
   * **不写盘**(不调 `landAssets` / 不写 `requirement.md`)—— 真正的写盘在用户
   * 点"创建"那一刻由 `createRequirement(title, markdown, images)` 接管。
   *
   * 返回结构:
   * - `markdown`            —— 解析后的 markdown(图片仍是 `data:` URI)
   * - `images`              —— 抽出的 base64 图片数组;前端 Dialog 不直接落盘,
   *                           而是把它随 POST /api/requirements 一起发给服务端,
   *                           在 createRequirement 阶段调 `landAssets`
   * - 闸门/解析失败 → 返回 `{ok:false, reason, message}`,不写盘
   */
  async parseForDialog(
    buffer: Buffer,
    filename: string,
    mime: string,
  ): Promise<
    | { ok: true; markdown: string; images: readonly ParsedUploadImage[] }
    | { ok: false; reason: UploadValidationReason | 'parse-error'; message?: string }
  > {
    const validation = await this.validateUpload(buffer, filename, mime)
    if (!validation.ok) return validation
    const parsed = await this.parseUpload(buffer, filename)
    if (!parsed.ok) return parsed
    return { ok: true, markdown: parsed.markdown, images: parsed.images }
  }

  /**
   * DRAFTING 覆盖:闸门 + 解析 + 落地 assets/ + 替换 data URI + 覆盖 requirement.md。
   *
   * 契约:
   * - 闸门失败 / 解析失败 → `{ok:false, ...}`,**不写盘**;调用方显示顶部红条。
   * - req 目录不存在 → `{ok:false, reason:'requirement-not-found'}`,前端提示用户该 req 已不存在。
   * - 写盘失败抛错(landAssets / writeFileSync 自身错误)—— 由 route 层映射到 500。
   * - 成功后返回 `{ok:true, markdown, assets}`:`markdown` 是已经替换为相对路径的版本,
   *   `assets` 是 `landAssets` 返回的元数据(供前端 MarkdownPreview 渲染)。
   *
   * 覆盖强度 W4:不弹 modal / 不输入确认 / 不写历史快照 —— 本方法直接覆盖。
   */
  async uploadAndReplace(
    reqId: string,
    buffer: Buffer,
    filename: string,
    mime: string,
  ): Promise<
    | {
        ok: true
        markdown: string
        assets: AssetMeta[]
      }
    | {
        ok: false
        reason:
          | UploadValidationReason
          | 'parse-error'
          | 'requirement-not-found'
        message?: string
      }
  > {
    const reqDir = this.requirementDirPath(reqId)
    if (!existsSync(reqDir)) {
      return {
        ok: false,
        reason: 'requirement-not-found',
        message: `requirement ${reqId} 不存在`,
      }
    }

    const validation = await this.validateUpload(buffer, filename, mime)
    if (!validation.ok) return validation

    const parsed = await this.parseUpload(buffer, filename)
    if (!parsed.ok) return parsed

    // 1. 落地图片(若有);同步写盘 → 失败抛错,上层 route 映射 500
    const landed = this.landAssets(reqId, parsed.images)

    // 2. markdown 中的 data URI → 相对路径
    const markdown = this.replaceDataUriWithAssetPath(reqId, parsed.markdown)

    // 3. 覆盖 requirement.md(同步,沿用 landAssets 风格)
    this.replaceRequirementMd(reqId, markdown)

    return { ok: true, markdown, assets: landed }
  }

  /**
   * 覆盖式写 `requirement.md`(ticket 03 W4 强度)。
   * - 同步写盘(沿用本类其他 IO 风格)
   * - 失败抛错,由 route 层映射到 500
   * - 不重命名、不写历史、不动 `meta.yaml`(ADR-0015 D4 锁)
   */
  replaceRequirementMd(reqId: string, markdown: string): void {
    const mdPath = join(this.requirementDirPath(reqId), 'requirement.md')
    writeFileSync(mdPath, markdown, 'utf8')
  }

  // ===========================================================================
  // ticket 02 —— get(reqId) 与 list(reqId) 资源树
  // ===========================================================================

  /** 拉取单个 requirement 详情,含 `assets[]` (ADR-0015 D5)。
   *
   * 返回结构:
   * - `id` / `title` / `createdAt` —— 来自 `meta.yaml`
   * - `requirementMarkdown` —— `requirement.md` 全文(缺失则 `null`)
   * - `assets[]` —— `requirements/<id>/assets/` 内文件,按文件名升序
   *   (ticket 02 验收:`get(reqId).assets` 含 `prd-1.png` 元数据)。
   * - 不存在 → 返回 `null`(上层映射 404)
   */
  get(reqId: string): {
    id: string
    title: string
    createdAt: string
    requirementMarkdown: string | null
    assets: AssetMeta[]
  } | null {
    const reqDir = this.requirementDirPath(reqId)
    if (!existsSync(reqDir)) return null

    const meta = this.readMetaYaml(reqDir)
    if (!meta) return null

    const mdPath = join(reqDir, 'requirement.md')
    let requirementMarkdown: string | null = null
    if (existsSync(mdPath)) {
      try {
        requirementMarkdown = readFileSync(mdPath, 'utf8')
      } catch {
        requirementMarkdown = null
      }
    }

    const assets = this.listAssets(reqId)

    return {
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      requirementMarkdown,
      assets,
    }
  }

  /**
   * 列出 `requirements/<id>/assets/` 的元数据(按文件名升序)。
   *
   * 内部用于 `get(reqId).assets`,也供 list 树形扫描时子叶节点派生
   * `AssetMeta`(避免在 `list()` 里又重写 stat 逻辑)。
   *
   * 文件大小由 `statSync` 拿实际磁盘字节数,与 `landAssets` 写入字节数
   * 一致(同一文件,即便后续被覆盖也是当前字节数)。
   */
  listAssets(reqId: string): AssetMeta[] {
    const dir = this.assetsDir(reqId)
    if (!existsSync(dir)) return []
    let names: string[]
    try {
      names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort()
    } catch {
      return []
    }
    const out: AssetMeta[] = []
    for (const name of names) {
      const absPath = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(absPath)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      out.push({
        name,
        path: this.relativeAssetPath(reqId, name),
        url: this.assetUrl(reqId, name),
        size: st.size,
        mime: extensionToImageMime(extractExt(name)),
      })
    }
    return out
  }

  /**
   * 列出指定 requirement 的资源树(顶层目录深度),应用 ADR-0015 D5 的过滤:
   *
   * - `_` 前缀目录排除(沿用既有 `_archived/` 处理)
   * - `.` 前缀目录排除(隐藏文件,如 `.archived`、`.DS_Store`)
   * - `assets/` 不带下划线因此**纳入**(ADR-0015 D5 + 验收)
   * - 顶层文件:不递归到子目录(顶层 + 一层子目录共两层);子目录里只列文件名
   *   不带路径前缀(验收:assets/ 节点下能看到 `prd-1.png`)
   *
   * 数据源说明:这里的实现是简单的两遍 `readdirSync`(顶层 + 直接子目录
   * 各一次)。不递归更深,避免资源树因 worktree 之类深层结构膨胀。
   */
  list(reqId: string): ResourceTreeNode[] {
    const reqDir = this.requirementDirPath(reqId)
    if (!existsSync(reqDir)) return []
    const out: ResourceTreeNode[] = []
    let top: string[]
    try {
      top = readdirSync(reqDir)
    } catch {
      return []
    }

    for (const name of top) {
      if (name.startsWith('_') || name.startsWith('.')) continue
      const abs = join(reqDir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        let children: string[]
        try {
          children = readdirSync(abs)
            .filter((n) => !n.startsWith('.'))
            .sort()
        } catch {
          children = []
        }
        out.push({
          name,
          path: name,
          type: 'directory',
          children: children.map((child) => ({
            name: child,
            // POSIX 分隔符:ResourceTree 的 path 是 API 层逻辑标识(前端拿去拼
            // URL / 做 React key),不是 fs 路径。Windows 下用 `sep` 会产出
            // `assets\prd-1.png`,反斜杠进 URL 即破。
            path: `${name}/${child}`,
            type: 'file' as const,
          })),
        })
      } else if (st.isFile()) {
        out.push({ name, path: name, type: 'file' })
      }
    }

    out.sort(compareResourceNodes)
    return out
  }

  // ===========================================================================
  // ticket 02 —— 单个 asset 文件读取 + 路径安全(API 用)
  // ===========================================================================

  /**
   * 给定 `reqId` + 用户输入的 `filename`,返回:
   * - `null` —— 路径不安全(穿越 / 含 null byte / 绝对路径 / 解析后超出 assets/)
   * - `{ absPath, mime, size }` —— 安全且文件存在
   *
   * 安全策略:
   * 1. 拒绝含 NUL byte 的输入(`\0`)
   * 2. 拒绝含 `/` 或 `\` 的输入(路径分隔符穿越)
   * 3. 拒绝绝对路径(以 `/` 或 Windows drive letter 开头)
   * 4. 解析后的绝对路径必须以 `assetsDir(reqId)` 开头(`path.resolve` 风格)
   * 5. 文件存在且为 regular file
   */
  resolveAssetFile(
    reqId: string,
    filename: string,
  ): { absPath: string; mime: string; size: number } | null {
    if (!filename || filename.includes('\0')) return null
    // `filename` 必须是单段 basename:拒绝 `sub/x.png` / `..\x.png` / `..\\x.png`。
    // 上面两个 include 已经覆盖 POSIX / 与 Windows \ 两种分隔符,够用。
    if (filename.includes('/') || filename.includes('\\')) return null

    const root = this.assetsDir(reqId)
    const target = join(root, filename)
    const normalizedRoot = root.endsWith(sep) ? root : root + sep
    if (!target.startsWith(normalizedRoot) && target !== root) return null

    if (!existsSync(target)) return null
    let st
    try {
      st = statSync(target)
    } catch {
      return null
    }
    if (!st.isFile()) return null

    return {
      absPath: target,
      mime: extensionToImageMime(extractExt(filename)),
      size: st.size,
    }
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
