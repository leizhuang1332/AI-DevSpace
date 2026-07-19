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

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import yaml from 'yaml'
import mammoth from 'mammoth'
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  RepoAttachErrorCode,
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
  type RepoAttachErrorCodeT,
  type RequirementMeta,
  type RequirementStatusT,
  type RequirementSummary,
  type ResourceTreeNode,
  type UploadValidationReason,
  type UploadValidationResult as SharedUploadValidationResult,
} from '@ai-devspace/shared'

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
   * 5. 派生 repos = requirements/<id>/repos/ 子目录名列表(过滤 . 开头)
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

  /** 派生 repos = reqDir/repos/ 子目录名列表(过滤 . 开头) */
  private deriveRepos(reqDir: string): string[] {
    const reposDir = join(reqDir, 'repos')
    if (!existsSync(reposDir)) return []
    try {
      return readdirSync(reposDir).filter((n) => !n.startsWith('.'))
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

  /** `path` 字段相对 workspace root(便于 agent 内部测试断言;实际写盘走 `assetPath`) */
  private relativeAssetPath(reqId: string, name: string): string {
    return join('requirements', reqId, 'assets', name)
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
            path: `${name}${sep}${child}`,
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
