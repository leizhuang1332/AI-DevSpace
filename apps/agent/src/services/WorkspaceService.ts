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
import { existsSync } from 'node:fs'
import yaml from 'yaml'
import {
  DEFAULT_CONFIG,
  type Config,
  type WorkspaceInfo,
  type ConfigPatch,
  type RepoRegistry,
  type RepoRegistryEntry,
  RepoRegistrySchema,
  type CodebaseUsageEntry,
} from '@ai-devspace/shared'

/** yaml 注册表读写最大退避重试次数(并发覆盖 —— issue 02 风险"macOS / Windows 文件锁语义差异") */
const REGISTRY_WRITE_MAX_RETRIES = 5
const REGISTRY_WRITE_BASE_BACKOFF_MS = 200

const SUBDIRS = ['requirements', 'repos', 'knowledge', 'skills', 'analysis-skills', 'logs'] as const

const GITIGNORE_CONTENT = [
  '# AI DevSpace workspace',
  'logs/',
  'snapshots/',
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
  /**
   * ADR-0026:一次性清理老用户升级时残留的 `~/.aidevspace/zones/*.yaml`
   * (声明式注册表已退役)。true = 删除了 zones/ 目录(含 yaml),false = 无需清理。
   * 失败不阻断启动(仅记日志),详见 `cleanupRetiredZonesDir()`。
   */
  zonesDirRetired: boolean
}

export class WorkspaceService {
  /** 默认根路径：AIDEVSPACE_HOME env > ~/.aidevspace */
  static resolveRoot(env: NodeJS.ProcessEnv = process.env): string {
    const override = env.AIDEVSPACE_HOME?.trim()
    return override && override.length > 0 ? override : join(homedir(), '.aidevspace')
  }

  /**
   * 注册表写互斥锁 —— 在进程内串行化所有 mutateRegistry 调用。
   *
   * 单纯 read-modify-write + 退避重试覆盖不了「读后写中间被穿插」
   * 的并发场景:两个线程读到 [],各自追加不同 name,各自写入 —— 后写
   * 的把先写的整文件覆盖掉,造成 lost update。
   *
   * 加 in-process mutex 后,所有 read→mutate→write 原子段被串行,
   * 不存在穿插;跨进程并发仍由 fs 文件锁 + 退避兜底(决策 113 沿用)。
   */
  private registryLock: Promise<void> = Promise.resolve()

  constructor(public readonly root: string) {}

  get configPath(): string {
    return join(this.root, 'config.yaml')
  }

  get gitignorePath(): string {
    return join(this.root, '.gitignore')
  }

  /** 幂等初始化 workspace */
  async initWorkspace(): Promise<InitWorkspaceResult> {
    const createdDirs: string[] = []
    const existedDirs: string[] = []

    for (const d of SUBDIRS) {
      const p = join(this.root, d)
      if (existsSync(p)) existedDirs.push(d)
      else {
        await mkdir(p, { recursive: true })
        createdDirs.push(d)
      }
    }

    // .gitignore: 缺失才写，存在保留
    let gitignoreCreated = false
    if (!existsSync(this.gitignorePath)) {
      await this.writeFileAtomic(this.gitignorePath, GITIGNORE_CONTENT)
      gitignoreCreated = true
    }

    // config.yaml: 不存在则写默认；存在则补缺
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
      // workspaceRoot 缺失或不一致 → 覆盖
      if (merged.workspaceRoot !== this.root) {
        merged.workspaceRoot = this.root
        dirty = true
      }
      if (dirty) {
        await this.writeConfigFile(merged)
        configBackfilled = true
      }
    }

    // ADR-0026:一次性清理老用户升级时残留的 ~/.aidevspace/zones/*.yaml
    // (声明式注册表已退役,改为 web 端 SECTION_META hardcode)。失败不阻断。
    const zonesDirRetired = await this.cleanupRetiredZonesDir()

    return {
      createdDirs,
      existedDirs,
      configCreated,
      configBackfilled,
      gitignoreCreated,
      zonesDirRetired,
    }
  }

  /**
   * ADR-0026 D6.1:一次性清理 `~/.aidevspace/zones/` 目录(声明式注册表退役)。
   *
   * - 目录不存在 → 返 false(全新安装,合法空态)
   * - 目录存在 → 递归 rm(含 *.yaml),返 true
   * - rm 失败 → 静默吞掉(返 false),不阻断 agent 启动;老用户升级容错
   *
   * 幂等:目录被删后,下次启动 existsSync=false 直接返 false,无副作用。
   */
  private async cleanupRetiredZonesDir(): Promise<boolean> {
    const zonesDir = join(this.root, 'zones')
    if (!existsSync(zonesDir)) return false
    try {
      await rm(zonesDir, { recursive: true, force: true })
      return true
    } catch {
      // 静默失败:不阻断启动;zones yaml 残留不影响新逻辑(无消费方)
      return false
    }
  }

  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    const rootExists = existsSync(this.root)
    let createdAt: number | null = null
    if (rootExists) {
      const s = await stat(this.root)
      createdAt = s.birthtimeMs || s.ctimeMs
    }

    const subdirs: Record<string, boolean> = {}
    for (const d of SUBDIRS) {
      subdirs[d] = existsSync(join(this.root, d))
    }

    const config = await this.readConfigFileSafe()
    const cfg: Config = config ?? this.seedConfig()

    const gitignoreExists = existsSync(this.gitignorePath)

    let diskUsageBytes = 0
    if (rootExists) diskUsageBytes = await this.computeDiskUsage(this.root)

    return {
      root: this.root,
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

  /** 默认 config 模板，注入当前 root 路径 */
  private seedConfig(): Config {
    return {
      ...(DEFAULT_CONFIG as unknown as Config),
      workspaceRoot: this.root,
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
        if (count > 50_000) return total // 兜底：超过 50k 文件不再深算
      }
    }
    return total
  }

  // ===========================================================================
  // RepoRegistry CRUD —— issue 02-repos-route-crud.md / ADR-0030 D1 / D8
  //
  // 真相源 = `<root>/repos.yaml`(独立单文件,顶层 {version: 1, repos: []})
  // 与 config.yaml 职责分离(本机设置 vs 可移植清单,决策 Q2)。
  //
  // 所有读 / 写都走 service 层:route handler 不直接 fs,避免并发 read-modify-write
  // 漂移(issue 02 风险"macOS / Windows 文件锁语义差异")。并发保护分两层:
  // - 进程内:registryLock(简单 Promise chain)串行化所有 read→mutate→write
  // - 跨进程:200ms 退避重试 + yaml.stringify 覆盖写(决策 113 沿用)
  // ===========================================================================

  /** `<root>/repos.yaml` 绝对路径 —— service 内部 + 测试共享 */
  get repoRegistryPath(): string {
    return join(this.root, 'repos.yaml')
  }

  /**
   * 读 `<root>/repos.yaml` → RepoRegistry。
   *
   * - 文件不存在 → 返 `{version: 1, repos: []}`(全新安装合法态,沿用 ADR-0016 D6 语义)
   * - 解析失败 / 校验失败 → 抛 `Error`(route 层映射 500 E_REPO_REGISTRY_READ_FAILED)
   */
  async readRepoRegistry(): Promise<RepoRegistry> {
    if (!existsSync(this.repoRegistryPath)) {
      return { version: 1, repos: [] }
    }
    const raw = await readFile(this.repoRegistryPath, 'utf8')
    const parsed = yaml.parse(raw)
    // 空文件 / 解析返 null → 当空注册表处理(yaml.parse 对空字符串 / '# comment only' 返 null)
    if (parsed === null || parsed === undefined) {
      return { version: 1, repos: [] }
    }
    // Zod 校验 —— 多余字段 strip / 缺字段报错
    return RepoRegistrySchema.parse(parsed)
  }

  /**
   * 按 name 找仓库条目;不存在返 null。
   *
   * name 是全局唯一即标识(决策 105),无需处理 "repo-<name>" slug 派生链
   * —— ADR-0016 时代的 `id` 字段已退役。
   */
  async findRepoByName(name: string): Promise<RepoRegistryEntry | null> {
    const reg = await this.readRepoRegistry()
    return reg.repos.find((r) => r.name === name) ?? null
  }

  /**
   * 追加一条仓库条目 —— 必须在外部先跑 ls-remote 验证可达(Q5)。
   *
   * 写盘 = read-modify-write 全文件,加 200ms 退避的轻量重试(最多 5 次)
   * 覆盖 yaml 库 / fs 层面的并发竞态。**不**保留读到的条目顺序之外的状态;
   * add 永远追加到尾部。
   *
   * 抛错条件:
   * - name 已被占用(由调用方预先查 `findRepoByName` 决定 —— 此处不重复查,
   *   走 read-modify-write 自然撞 → 抛 RegistryConflictError)
   * - yaml 写失败(磁盘满 / IO 错)
   */
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

  /**
   * 按 name 更新 gitUrl / description。
   *
   * - name 字段不可改(标识)
   * - 改动 gitUrl 时调用方必须先跑 ls-remote 验证(Q5)
   * - 未提供字段保持原值
   * - name 不存在抛 RegistryNotFoundError
   */
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
      // 防御性:mutateRegistry 失败时这里不会到;留给类型系统兜底
      throw new RegistryNotFoundError(`仓库 ${name} 不存在`, 'E_REPO_NOT_FOUND')
    }
    return updated
  }

  /**
   * 按 name 移除仓库条目;name 不存在抛 RegistryNotFoundError。
   *
   * **绝不** rm 任何 `requirements/<req-id>/codebase/<name>/` 目录(决策 113)——
   * 注册表与 codebase 是两套真相源,解耦。
   */
  async removeRepo(name: string): Promise<void> {
    await this.mutateRegistry((current) => {
      const next = current.repos.filter((r) => r.name !== name)
      if (next.length === current.repos.length) {
        throw new RegistryNotFoundError(`仓库 ${name} 不存在`, 'E_REPO_NOT_FOUND')
      }
      return { ...current, repos: next }
    })
  }

  /**
   * 扫 `requirements/<req-id>/codebase/<name>/` 派生「该仓库被 N 个需求使用」(决策 Q6 / 114)。
   *
   * 路径:`<root>/requirements/<reqId>/codebase/<name>/` —— `.pending-<name>`
   * 标记视作「克隆中」,不计入 usage(未就绪不算关联)。
   *
   * 性能:仓库数 < 100,需求数通常 < 50,N×M 远低于 5000;filesystem stat 无并发问题。
   * 单次 readdir 不抛 ENOENT(目录不存在 → 返空数组)。
   */
  async findCodebaseUsage(name: string): Promise<CodebaseUsageEntry[]> {
    const reqDir = join(this.root, 'requirements')
    if (!existsSync(reqDir)) return []
    const out: CodebaseUsageEntry[] = []
    for (const e of await readdir(reqDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const reqId = e.name
      const codeDir = join(reqDir, reqId, 'codebase', name)
      if (!existsSync(codeDir)) continue
      // 跳过 .pending-<name>(克隆中标记,不算关联)
      // —— directory 实体本身就是 codeDir,不被 prefix 过滤,需要单独看
      // pending 标记文件存在 → 跳过整条 usage
      const pendingMarker = join(reqDir, reqId, 'codebase', `.pending-${name}`)
      if (existsSync(pendingMarker)) continue
      // 读 meta.yaml 拿 branchName(SSR 持久化契约沿用)
      const branch = await this.readBranchNameSafe(join(reqDir, reqId))
      out.push({
        requirementId: reqId,
        branch,
        codebasePath: codeDir,
      })
    }
    return out
  }

  /** 读 `requirements/<id>/meta.yaml` 的 branchName 字段;失败返 ''(不阻断 usage 列表) */
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
      return ''
    } catch {
      return ''
    }
  }

  /**
   * 注册表 read-modify-write 原子操作(轻量重试覆盖并发)。
   *
   * 行为:
   * - 串行化:所有调用通过 registryLock 排队,避免 read→mutate→write 中间被穿插
   * - 读 → 改(由 mutator 计算)→ 写
   * - mutator 抛冲突错(RegistryConflictError / RegistryNotFoundError)
   *   → 不重试,直接抛出 —— 这是业务级冲突,与并发无关
   * - 写失败(ENOENT / EEXIST / EAGAIN 等 IO 错)→ 200ms 退避重试,最多 5 次
   * - 超过 5 次 → 抛 RegistryWriteError(让 route 层映射 500 E_REGISTRY_WRITE_FAILED)
   *
   * 注:yaml 库本身不保证并发安全;靠 in-process mutex + 退避重试兜底,
   * 跨进程并发仍由 fs 文件锁 + 退避兜底(决策 113 沿用)。
   */
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
          // 业务级冲突(mutor 主动抛出)—— 不重试,直接抛给 caller
          if (
            err instanceof RegistryConflictError ||
            err instanceof RegistryNotFoundError
          ) {
            throw err
          }
          // 读阶段意外错(理论上 readRepoRegistry 自身不会抛业务错)—— 当 write 错处理
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
            // 200ms 起步的线性退避(简单;并发冲突低概率,无需指数)
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
    // 序列化前再过一遍 Zod(防御性 —— 防止 mutator 计算出非法数据)
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
