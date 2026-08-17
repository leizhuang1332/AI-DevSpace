import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  mkdir,
  writeFile,
  readFile,
  stat,
  rename,
  readdir,
  rm,
} from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import yaml from 'yaml'
import {
  DEFAULT_CONFIG,
  normalizeWorkspaceRoot,
  validateWorkspaceRootPure,
  WORKSPACE_TRACE_DIRS,
  type Config,
  type WorkspaceInfo,
  type ConfigPatch,
  type WorkspaceValidation,
  type RepoRegistry,
  type RepoRegistryEntry,
  RepoRegistrySchema,
  type CodebaseUsageEntry,
} from '@ai-devspace/shared'

/** yaml 注册表读写最大退避重试次数(并发覆盖 —— issue 02 风险"macOS / Windows 文件锁语义差异") */
const REGISTRY_WRITE_MAX_RETRIES = 5
const REGISTRY_WRITE_BASE_BACKOFF_MS = 200

// ADR-0030 D2: 仓库真相源从物理目录 `<root>/repos/` 改为 yaml 文件 `<root>/repos.yaml`,
// 故 SUBDIRS 不再包含 'repos';旧目录由 initWorkspace 一次性迁移(issue 04 4.4),
// 不在此处 mkdir。
const SUBDIRS = ['requirements', 'knowledge', 'skills', 'analysis-skills', 'logs'] as const

/**
 * 从 `<dir>/.git/config` 文本里抽 `[remote "origin"]` 段下的 `url = ...` 行。
 */
function parseOriginUrl(text: string): string | null {
  const originSectionMatch = text.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/)
  if (!originSectionMatch) return null
  const section = originSectionMatch[1] ?? ''
  const urlMatch = section.match(/^\s*url\s*=\s*(.+?)\s*$/m)
  return urlMatch?.[1]?.trim() || null
}

// workspace `.gitignore` 标准内容。位于 dataRoot(代码 + 工作区层面的 git 仓库)
const GITIGNORE_CONTENT = [
  '# AI DevSpace workspace',
  'logs/',
  'snapshots/',
  'requirements/*/codebase/',
  'requirements/*/codebase/**/.git/',
  '*/node_modules/',
  '.DS_Store',
  '*.log',
  '',
].join('\n')

export class WorkspaceCorruptError extends Error {
  constructor(public readonly path: string, cause: unknown) {
    super(`Workspace config at ${path} is corrupt: ${String(cause)}`)
    this.name = 'WorkspaceCorruptError'
  }
}

export interface InitWorkspaceResult {
  createdDirs: string[]
  existedDirs: string[]
  configCreated: boolean
  configBackfilled: boolean
  gitignoreCreated: boolean
  zonesDirRetired: boolean
  migratedRepos: string[]
}

export class WorkspaceService {
  /**
   * 默认配置目录路径:AIDEVSPACE_HOME env > ~/.aidevspace
   *
   * 返回值统一过 `normalizeWorkspaceRoot`:用户在 Git Bash 里
   * `export AIDEVSPACE_HOME=$HOME/.aidevspace`(= `/c/Users/...`)时,
   * 自动归一化为 Windows 原生 `C:\Users\...\aidevspace`,避免 Node.js
   * `path.join` 和 git.exe 都把 `/c/foo` 当 drive-relative 写到 `<cwd_drive>:\c\...`。
   * 已 native / POSIX 路径原样返回,无副作用。
   */
  static resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
    const override = env.AIDEVSPACE_HOME?.trim()
    const raw = override && override.length > 0 ? override : join(homedir(), '.aidevspace')
    return normalizeWorkspaceRoot(raw)
  }

  /**
   * @deprecated Use `resolveConfigDir` (ADR-0037 D1 / D2 拆分语义后,「root」=「configDir」不准确)。
   * 保留一期内测 + 现有调用点平滑迁移。
   */
  static resolveRoot(env: NodeJS.ProcessEnv = process.env): string {
    return WorkspaceService.resolveConfigDir(env)
  }

  /**
   * 从 `<configDir>/config.yaml` 解析出 dataRoot。
   *
   * 算法(ADR-0037 D2):
   * - config.yaml 不存在 → 返回 configDir(首次启动;initWorkspace 会 seed)
   * - 存在且 `workspaceRoot` 字段非空 → 返回 normalize 后的字段值
   * - 存在但 `workspaceRoot` 字段缺失 / 空字符串 → 返回 configDir(向后兼容)
   *
   * 解析失败(非对象 / IO 错)→ 返回 configDir(防御性,initWorkspace 会修正)
   */
  static async resolveDataRoot(configDir: string): Promise<string> {
    const configPath = join(configDir, 'config.yaml')
    if (!existsSync(configPath)) return configDir
    try {
      const raw = await readFile(configPath, 'utf8')
      const parsed = yaml.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const root = (parsed as Record<string, unknown>).workspaceRoot
        if (typeof root === 'string' && root.trim() !== '') {
          return normalizeWorkspaceRoot(root.trim())
        }
      }
    } catch {
      // fall through to default
    }
    return configDir
  }

  /**
   * 启动期单次调用,封装 configDir + dataRoot 解析。
   *
   * 用法:`const ws = await WorkspaceService.fromEnv(process.env)`
   * 替代旧的 `new WorkspaceService(WorkspaceService.resolveRoot())`。
   */
  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<WorkspaceService> {
    const configDir = WorkspaceService.resolveConfigDir(env)
    const dataRoot = await WorkspaceService.resolveDataRoot(configDir)
    return new WorkspaceService(configDir, dataRoot)
  }

  /**
   * 旧 API 单参数形式的兼容构造:configDir = dataRoot = root。
   *
   * @deprecated 用 `new WorkspaceService(configDir, dataRoot)` 或 `await WorkspaceService.fromEnv(env)` 替代。
   * 保留一期内测 + 现有 100+ 调用点平滑迁移。
   */
  static singleRoot(root: string): WorkspaceService {
    return new WorkspaceService(root, root)
  }

  /**
   * 注册表写互斥锁 —— 在进程内串行化所有 mutateRegistry 调用。
   */
  private registryLock: Promise<void> = Promise.resolve()

  constructor(
    /** 配置目录:`config.yaml` 唯一居住地(env 或 ~/.aidevspace) */
    public readonly configDir: string,
    /** 数据目录:requirements / knowledge / skills / repos.yaml / snapshots */
    public readonly dataRoot: string,
  ) {}

  /**
   * @deprecated Use `this.dataRoot` directly in new code.
   * 旧 `root` 别名返回 dataRoot,保留下游 service deps 的 `root: string` 兼容。
   */
  get root(): string {
    return this.dataRoot
  }

  get configPath(): string {
    return join(this.configDir, 'config.yaml')
  }

  get gitignorePath(): string {
    return join(this.dataRoot, '.gitignore')
  }

  /** 幂等初始化 workspace(ADR-0037 D1 / D2 + ADR-0030 仓库真相源迁移) */
  async initWorkspace(): Promise<InitWorkspaceResult> {
    const createdDirs: string[] = []
    const existedDirs: string[] = []

    // 1. dataRoot 下建子目录(requirements / knowledge / skills / analysis-skills / logs)
    for (const d of SUBDIRS) {
      const p = join(this.dataRoot, d)
      if (existsSync(p)) existedDirs.push(d)
      else {
        await mkdir(p, { recursive: true })
        createdDirs.push(d)
      }
    }

    // 2. dataRoot/.gitignore(仅当 dataRoot 是 git 仓库时)
    const isGitWorkspace = existsSync(join(this.dataRoot, '.git'))
    let gitignoreCreated = false
    if (isGitWorkspace && !existsSync(this.gitignorePath)) {
      await this.writeFileAtomic(this.gitignorePath, GITIGNORE_CONTENT)
      gitignoreCreated = true
    }

    // 3. configDir/config.yaml(seed / backfill)
    let configCreated = false
    let configBackfilled = false
    const existing = await this.readConfigFileSafe()
    if (existing === null) {
      await this.writeConfigFile(this.seedConfig())
      configCreated = true
    } else {
      let dirty = false
      const merged: Config = { ...existing }
      for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
        if (!(k in merged)) {
          (merged as Record<string, unknown>)[k] = v
          dirty = true
        }
      }
      // workspaceRoot 缺失或不一致 → 覆盖(种子 = dataRoot)
      if (merged.workspaceRoot !== this.dataRoot) {
        merged.workspaceRoot = this.dataRoot
        dirty = true
      }
      if (dirty) {
        await this.writeConfigFile(merged)
        configBackfilled = true
      }
    }

    // 4. ADR-0026: 一次性清理老用户升级残留的 zones/ 目录(dataRoot 下)
    const zonesDirRetired = await this.cleanupRetiredZonesDir()

    // 5. ADR-0030 / issue 04 4.4: 旧 `<dataRoot>/repos/` 物理目录 → `<dataRoot>/repos.yaml` 一次性迁移
    const migratedRepos = await this.migrateOldReposDirIfPresent()

    return {
      createdDirs,
      existedDirs,
      configCreated,
      configBackfilled,
      gitignoreCreated,
      zonesDirRetired,
      migratedRepos,
    }
  }

  /**
   * ADR-0026 D6.1:一次性清理 `~/.aidevspace/zones/` 目录(声明式注册表退役)。
   */
  private async cleanupRetiredZonesDir(): Promise<boolean> {
    const zonesDir = join(this.dataRoot, 'zones')
    if (!existsSync(zonesDir)) return false
    try {
      await rm(zonesDir, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * ADR-0030 / issue 04 4.4:旧 `<dataRoot>/repos/` 物理目录 → `<dataRoot>/repos.yaml` 一次性迁移。
   */
  private async migrateOldReposDirIfPresent(): Promise<string[]> {
    const oldDir = join(this.dataRoot, 'repos')
    if (!existsSync(oldDir)) return []
    return this.migrateOldReposDir(oldDir)
  }

  private async migrateOldReposDir(oldDir: string): Promise<string[]> {
    const migrated: string[] = []
    const entries = readdirSync(oldDir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    )
    for (const entry of entries) {
      const name = entry.name
      const configPath = join(oldDir, name, '.git', 'config')
      if (!existsSync(configPath)) continue
      let configText = ''
      try {
        configText = await readFile(configPath, 'utf8')
      } catch {
        continue
      }
      const gitUrl = parseOriginUrl(configText)
      if (!gitUrl) continue
      const existing = await this.findRepoByName(name)
      if (existing) continue
      try {
        await this.addRepo({ name, gitUrl, description: '' })
        migrated.push(name)
      } catch {
        // skip on conflict / IO
      }
    }
    return migrated
  }

  /**
   * WorkspaceInfo 派生读取(SSR 契约,web 端 settings shell 消费)。
   *
   * @param includes 决定返回字段:默认全字段;'server-init' 可省 diskUsageBytes 减少首屏 IO
   */
  async getWorkspaceInfo(
    includes: { diskUsage: boolean } = { diskUsage: true },
  ): Promise<WorkspaceInfo> {
    const rootExists = existsSync(this.dataRoot)
    let createdAt: number | null = null
    if (rootExists) {
      const s = await stat(this.dataRoot)
      createdAt = s.birthtimeMs || s.ctimeMs
    }

    const subdirs: Record<string, boolean> = {}
    for (const d of SUBDIRS) {
      subdirs[d] = existsSync(join(this.dataRoot, d))
    }

    const config = await this.readConfigFileSafe()
    const cfg: Config = config ?? this.seedConfig()

    const gitignoreExists = existsSync(this.gitignorePath)

    let diskUsageBytes = 0
    if (includes.diskUsage && rootExists) {
      diskUsageBytes = await this.computeDiskUsage(this.dataRoot)
    }

    return {
      // ADR-0037 D1: 同时暴露 configDir / dataRoot + 旧 `root` 别名(dataRoot)
      root: this.dataRoot,
      configDir: this.configDir,
      dataRoot: this.dataRoot,
      exists: rootExists,
      createdAt,
      subdirs,
      configPath: this.configPath,
      config: cfg,
      gitignorePath: this.gitignorePath,
      gitignoreExists,
      diskUsageBytes,
    }
  }

  async updateConfig(patch: ConfigPatch): Promise<{ config: Config }> {
    const current = await this.readConfigFileSafe()
    const base: Config = current ?? this.seedConfig()
    const next: Config = { ...base, ...patch }
    await this.writeConfigFile(next)
    return { config: next }
  }

  /**
   * settings PATCH 前的路径校验(POST /api/workspace/validate-path 共用)。
   *
   * ADR-0037 D3:三档反馈
   * - 路径不存在 → E_WS_ROOT_PATH_NOT_EXISTS
   * - 存在但无 workspace 痕迹(超集) → E_WS_ROOT_PATH_NOT_WORKSPACE
   * - 存在有 workspace 痕迹 → 无 errorCode
   *
   * 走 shared 纯函数 `validateWorkspaceRootPure`,fs 检查在 agent 层做(避免 web bundle 引入 node:fs)。
   */
  validatePath(p: string): WorkspaceValidation {
    if (!p || p.trim() === '') {
      return validateWorkspaceRootPure({ path: '', exists: false, hasAnyTrace: false })
    }
    let exists = false
    try {
      exists = existsSync(p)
    } catch {
      return validateWorkspaceRootPure({ path: p, exists: false, hasAnyTrace: false })
    }
    if (!exists) {
      return validateWorkspaceRootPure({ path: p, exists: false, hasAnyTrace: false })
    }
    let hasAnyTrace = false
    for (const dir of WORKSPACE_TRACE_DIRS) {
      try {
        if (existsSync(join(p, dir))) {
          hasAnyTrace = true
          break
        }
      } catch {
        // ignore
      }
    }
    return validateWorkspaceRootPure({ path: p, exists, hasAnyTrace })
  }

  /** 默认 config 模板,注入当前 dataRoot 路径 */
  private seedConfig(): Config {
    return {
      ...(DEFAULT_CONFIG as unknown as Config),
      workspaceRoot: this.dataRoot,
    }
  }

  // ===== private =====

  private async readConfigFileSafe(): Promise<Config | null> {
    if (!existsSync(this.configPath)) return null
    try {
      const raw = await readFile(this.configPath, 'utf8')
      const parsed = yaml.parse(raw)
      if (parsed === null || parsed === undefined) return {}
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config.yaml 根节点必须是 mapping')
      }
      return parsed as Config
    } catch (err) {
      if (err instanceof WorkspaceCorruptError) throw err
      throw new WorkspaceCorruptError(this.configPath, err)
    }
  }

  private async writeConfigFile(cfg: Config): Promise<void> {
    const text = yaml.stringify(cfg, { indent: 2, lineWidth: 0 })
    await this.writeFileAtomic(this.configPath, text)
  }

  private async writeFileAtomic(path: string, content: string): Promise<void> {
    const tmp = path + '.tmp'
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
  }

  private async computeDiskUsage(p: string): Promise<number> {
    let total = 0
    let count = 0
    const stack: string[] = [p]
    while (stack.length > 0) {
      const cur = stack.pop()!
      let entries
      try {
        entries = await readdir(cur, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const ep = join(cur, e.name)
        if (e.isDirectory()) {
          stack.push(ep)
        } else if (e.isFile()) {
          try {
            const s = await stat(ep)
            total += s.size
            count++
          } catch {
            /* ignore */
          }
        }
        if (count > 50_000) return total
      }
    }
    return total
  }

  // ===========================================================================
  // RepoRegistry CRUD —— issue 02-repos-route-crud.md / ADR-0030 D1 / D8
  //
  // 真相源 = `<dataRoot>/repos.yaml`(独立单文件)
  // 与 config.yaml 职责分离(本机设置 vs 可移植清单)
  // ===========================================================================

  get repoRegistryPath(): string {
    return join(this.dataRoot, 'repos.yaml')
  }

  async readRepoRegistry(): Promise<RepoRegistry> {
    if (!existsSync(this.repoRegistryPath)) {
      return { version: 1, repos: [] }
    }
    const raw = await readFile(this.repoRegistryPath, 'utf8')
    const parsed = yaml.parse(raw)
    if (parsed === null || parsed === undefined) {
      return { version: 1, repos: [] }
    }
    return RepoRegistrySchema.parse(parsed)
  }

  async findRepoByName(name: string): Promise<RepoRegistryEntry | null> {
    const reg = await this.readRepoRegistry()
    return reg.repos.find((r) => r.name === name) ?? null
  }

  async addRepo(entry: RepoRegistryEntry): Promise<void> {
    await this.mutateRegistry((current) => {
      if (current.repos.some((r) => r.name === entry.name)) {
        throw new RegistryConflictError(
          `仓库名 ${entry.name} 已存在`,
          'E_REPO_NAME_EXISTS',
        )
      }
      return { ...current, repos: [...current.repos, entry] }
    })
  }

  async updateRepo(
    name: string,
    patch: Partial<Pick<RepoRegistryEntry, 'gitUrl' | 'description'>>,
  ): Promise<RepoRegistryEntry> {
    let updated: RepoRegistryEntry | null = null
    await this.mutateRegistry((current) => {
      const idx = current.repos.findIndex((r) => r.name === name)
      if (idx === -1) {
        throw new RegistryNotFoundError(`仓库 ${name} 不存在`, 'E_REPO_NOT_FOUND')
      }
      const next: RepoRegistryEntry = {
        ...current.repos[idx]!,
        ...(patch.gitUrl !== undefined ? { gitUrl: patch.gitUrl } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
      }
      const nextRepos = [...current.repos]
      nextRepos[idx] = next
      updated = next
      return { ...current, repos: nextRepos }
    })
    if (!updated) {
      throw new RegistryNotFoundError(`仓库 ${name} 不存在`, 'E_REPO_NOT_FOUND')
    }
    return updated
  }

  async removeRepo(name: string): Promise<void> {
    await this.mutateRegistry((current) => {
      const next = current.repos.filter((r) => r.name !== name)
      if (next.length === current.repos.length) {
        throw new RegistryNotFoundError(`仓库 ${name} 不存在`, 'E_REPO_NOT_FOUND')
      }
      return { ...current, repos: next }
    })
  }

  async findCodebaseUsage(name: string): Promise<CodebaseUsageEntry[]> {
    const reqDir = join(this.dataRoot, 'requirements')
    if (!existsSync(reqDir)) return []
    const out: CodebaseUsageEntry[] = []
    for (const e of await readdir(reqDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const reqId = e.name
      const codeDir = join(reqDir, reqId, 'codebase', name)
      if (!existsSync(codeDir)) continue
      const pendingMarker = join(reqDir, reqId, 'codebase', `.pending-${name}`)
      if (existsSync(pendingMarker)) continue
      const branch = await this.readBranchNameSafe(join(reqDir, reqId))
      out.push({
        requirementId: reqId,
        branch,
        codebasePath: codeDir,
      })
    }
    return out
  }

  private async readBranchNameSafe(reqDir: string): Promise<string> {
    const metaPath = join(reqDir, 'meta.yaml')
    if (!existsSync(metaPath)) return ''
    try {
      const raw = await readFile(metaPath, 'utf8')
      const parsed = yaml.parse(raw)
      if (parsed && typeof parsed === 'object' && 'branchName' in parsed) {
        const b = (parsed as Record<string, unknown>).branchName
        if (typeof b === 'string') return b
      }
    } catch {
      return ''
    }
    return ''
  }

  private async mutateRegistry(
    mutator: (current: RepoRegistry) => RepoRegistry,
  ): Promise<void> {
    const prevLock = this.registryLock
    let release: () => void
    this.registryLock = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await prevLock
      let lastErr: unknown
      for (let attempt = 0; attempt < REGISTRY_WRITE_MAX_RETRIES; attempt++) {
        let next: RepoRegistry
        try {
          const current = await this.readRepoRegistry()
          next = mutator(current)
        } catch (err) {
          if (
            err instanceof RegistryConflictError ||
            err instanceof RegistryNotFoundError
          ) {
            throw err
          }
          lastErr = err
          if (attempt < REGISTRY_WRITE_MAX_RETRIES - 1) {
            const backoffMs = REGISTRY_WRITE_BASE_BACKOFF_MS * (attempt + 1)
            await new Promise((r) => setTimeout(r, backoffMs))
          }
          continue
        }
        try {
          await this.writeRegistryFile(next)
          return
        } catch (err) {
          lastErr = err
          if (attempt < REGISTRY_WRITE_MAX_RETRIES - 1) {
            const backoffMs = REGISTRY_WRITE_BASE_BACKOFF_MS * (attempt + 1)
            await new Promise((r) => setTimeout(r, backoffMs))
          }
        }
      }
      throw new RegistryWriteError(
        `repos.yaml 写入失败(重试 ${REGISTRY_WRITE_MAX_RETRIES} 次)`,
        lastErr,
      )
    } finally {
      release!()
    }
  }

  private async writeRegistryFile(reg: RepoRegistry): Promise<void> {
    const validated = RepoRegistrySchema.parse(reg)
    const text = yaml.stringify(validated, { indent: 2, lineWidth: 0 })
    await this.writeFileAtomic(this.repoRegistryPath, text)
  }
}

/** 注册表并发写失败(超过 5 次重试仍失败) */
export class RegistryWriteError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message)
    this.name = 'RegistryWriteError'
  }
}

/** 注册表写撞重(name 已被占用) */
export class RegistryConflictError extends Error {
  constructor(
    message: string,
    public readonly code: 'E_REPO_NAME_EXISTS',
  ) {
    super(message)
    this.name = 'RegistryConflictError'
  }
}

/** 注册表查 / 改 / 删撞不存在 */
export class RegistryNotFoundError extends Error {
  constructor(
    message: string,
    public readonly code: 'E_REPO_NOT_FOUND',
  ) {
    super(message)
    this.name = 'RegistryNotFoundError'
  }
}