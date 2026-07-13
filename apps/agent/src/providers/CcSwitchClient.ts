/**
 * CcSwitchClient —— ADR-0010 Q9
 *
 * Agent 启动时只读打开 ~/.cc-switch/cc-switch.db,构建内存 ProviderIndex;
 * 提供 4 个查询方法:getCurrent / getAll / getById / getModel。
 *
 * 设计要点:
 * - **只读**打开 (Database readonly: true) —— cc-switch 不会因为我们读到一半写不进去而失败
 * - **内存索引** —— 启动一次,后续查询 O(1);不重复 parse JSON
 * - **可注入 Database 工厂** —— 测试时可注入内存 mock
 * - **不存 model catalog** —— 严格遵循 Q9.0「不存」原则,只读 cc-switch.db
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

/** 模型角色 —— 与 cc-switch.db settings_config.env 字段对齐 */
export type ModelRole =
  | 'main'
  | 'haiku'
  | 'sonnet'
  | 'opus'
  | 'fable'
  | 'reasoning'

/** Provider 索引条目 —— 与 ADR-0010 Q9 type ProviderIndex 一致 */
export interface ProviderIndex {
  id: string
  name: string
  is_current: boolean
  /** 来自 settings_config.env.ANTHROPIC_BASE_URL */
  baseUrl: string
  /** 来自 settings_config.env.ANTHROPIC_AUTH_TOKEN */
  apiKey: string
  /** 6 个 role 对应的 model id,缺失为 null */
  models: Record<ModelRole, string | null>
}

/** 解析后 (providerId, role) → model id */
export interface ResolvedModel {
  providerId: string
  providerName: string
  role: ModelRole
  modelId: string
}

/** 注入的 better-sqlite3 Database 工厂;默认用真 sqlite3 */
export type DatabaseFactory = (dbPath: string, opts: { readonly: true }) => Database.Database

/** 默认 factory —— 真实 better-sqlite3 */
async function defaultFactory(dbPath: string, opts: { readonly: true }): Promise<Database.Database> {
  const { default: Database } = await import('better-sqlite3')
  return new Database(dbPath, opts)
}

export interface CcSwitchClientOptions {
  /** cc-switch.db 路径,默认 ~/.cc-switch/cc-switch.db */
  dbPath?: string
  /** 注入 database factory (测试用) */
  factory?: DatabaseFactory
  /** 日志输出函数 (default: console.log) */
  log?: (msg: string) => void
}

export interface CcSwitchClient {
  /** 当前选中的 provider (is_current=1) */
  getCurrent(): ProviderIndex | undefined
  /** 所有 claude provider,按 is_current DESC, sort_index, created_at */
  getAll(): ProviderIndex[]
  /** 按 providerId 查询 */
  getById(providerId: string): ProviderIndex | undefined
  /** 解析 (providerId, role) → model id;缺 provider / 缺 role model → undefined */
  getModel(providerId: string, role: ModelRole): ResolvedModel | undefined
  /** 关闭 db handle (进程退出时调用) */
  close(): void
}

/**
 * 解析 settings_config JSON 字符串为 env。
 * 容错:解析失败或不是对象 → 返回空对象 (不让单条数据坏掉整个 index)。
 */
function parseEnv(settingsConfigJson: string): Record<string, string> {
  try {
    const parsed = JSON.parse(settingsConfigJson) as { env?: unknown }
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.env === 'object' && parsed.env !== null) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed.env as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    }
    return {}
  } catch {
    return {}
  }
}

/** 从 env 中提 6 个 role 对应的 model id;字段缺失 → null */
function extractModels(env: Record<string, string>): Record<ModelRole, string | null> {
  return {
    main: env['ANTHROPIC_MODEL'] ?? null,
    haiku: env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] ?? null,
    sonnet: env['ANTHROPIC_DEFAULT_SONNET_MODEL'] ?? null,
    opus: env['ANTHROPIC_DEFAULT_OPUS_MODEL'] ?? null,
    fable: env['ANTHROPIC_DEFAULT_FABLE_MODEL'] ?? null,
    reasoning: env['ANTHROPIC_REASONING_MODEL'] ?? null,
  }
}

/**
 * 构造 CcSwitchClient。打开 db 失败 → throw (caller 决定是否降级)。
 * 索引在 init 时一次性构建,后续 query 不再 hit db。
 */
export async function createCcSwitchClient(opts: CcSwitchClientOptions = {}): Promise<CcSwitchClient> {
  const dbPath = opts.dbPath ?? join(homedir(), '.cc-switch', 'cc-switch.db')
  const log = opts.log ?? ((m: string) => console.log(m))
  const factory = opts.factory ?? defaultFactory

  log(`[cc-switch] reading ${dbPath}`)

  const db = await factory(dbPath, { readonly: true })

  // 拉所有 app_type='claude' 的 provider
  type Row = {
    id: string
    name: string
    is_current: number
    settings_config: string
  }
  const rows = db
    .prepare(
      `SELECT id, name, is_current, settings_config
       FROM providers
       WHERE app_type = 'claude'
       ORDER BY is_current DESC, sort_index, created_at`,
    )
    .all() as Row[]

  const index: ProviderIndex[] = rows.map((row) => {
    const env = parseEnv(row.settings_config)
    return {
      id: row.id,
      name: row.name,
      is_current: row.is_current === 1,
      baseUrl: env['ANTHROPIC_BASE_URL'] ?? '',
      apiKey: env['ANTHROPIC_AUTH_TOKEN'] ?? '',
      models: extractModels(env),
    }
  })

  // 控制台打出当前 provider 状态 (issue 验收要求)
  const current = index.find((p) => p.is_current) ?? index[0]
  if (current) {
    log(`[cc-switch] current provider: ${current.name}`)
    log(`[cc-switch] baseUrl: ${current.baseUrl}`)
    log(`[cc-switch] models:`)
    for (const [role, id] of Object.entries(current.models)) {
      if (id) log(`  ${role.padEnd(10)} → ${id}`)
    }
  } else {
    log('[cc-switch] no claude provider found')
  }

  const byId = new Map<string, ProviderIndex>(index.map((p) => [p.id, p]))

  return {
    getCurrent(): ProviderIndex | undefined {
      return current
    },
    getAll(): ProviderIndex[] {
      return index
    },
    getById(providerId: string): ProviderIndex | undefined {
      return byId.get(providerId)
    },
    getModel(providerId: string, role: ModelRole): ResolvedModel | undefined {
      const p = byId.get(providerId)
      if (!p) return undefined
      const modelId = p.models[role]
      if (!modelId) return undefined
      return { providerId: p.id, providerName: p.name, role, modelId }
    },
    close(): void {
      db.close()
    },
  }
}