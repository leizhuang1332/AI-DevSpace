import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  mkdir,
  writeFile,
  readFile,
  stat,
  rename,
  readdir,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import yaml from 'yaml'
import {
  DEFAULT_CONFIG,
  type Config,
  type WorkspaceInfo,
  type ConfigPatch,
} from '@ai-devspace/shared'

const SUBDIRS = ['requirements', 'repos', 'knowledge', 'skills', 'logs'] as const

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
}

export class WorkspaceService {
  /** 默认根路径：AIDEVSPACE_HOME env > ~/.aidevspace */
  static resolveRoot(env: NodeJS.ProcessEnv = process.env): string {
    const override = env.AIDEVSPACE_HOME?.trim()
    return override && override.length > 0 ? override : join(homedir(), '.aidevspace')
  }

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

    return { createdDirs, existedDirs, configCreated, configBackfilled, gitignoreCreated }
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
}
