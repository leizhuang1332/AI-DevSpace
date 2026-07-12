import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'yaml'
import { ZoneSchema, type ZoneConfig } from '@ai-devspace/shared'

export class ZoneRegistryError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message)
    this.name = 'ZoneRegistryError'
  }
}

/**
 * 工位 lifecycle 顺序 —— 用于日志、ZoneBar Tab、CLI 列表等。
 * 与 ADR-0011 决策 15(反对状态机)兼容:这是固定的视觉顺序,不是状态机。
 */
export const ZONE_LIFECYCLE_ORDER = [
  'drafting',
  'analyzing',
  'clarifying',
  'designing',
  'executing',
  'wrapup',
] as const
export type ZoneLifecycleId = (typeof ZONE_LIFECYCLE_ORDER)[number]

/**
 * ADR-0012 §9 决策 8b:entry_triggers / exit_triggers 仅允许非状态机触发。
 * 禁用模式(看起来像状态机转移):
 *   - "<zone>-completed" / "<zone>-done" / "<zone>-finished"
 *   - "complete-*" / "finish-*" / "skip-*" / "cancel-*"
 * 允许示例: "ai-asked-question"(事件类)、"user-returned"(动作类)。
 */
const STATE_MACHINE_TRIGGER_PATTERNS: RegExp[] = [
  /^[a-z][a-z0-9-]*-(completed|done|finished|skipped|cancelled)$/,
  /^(complete|finish|skip|cancel)-/,
]

function isStateMachineTrigger(name: string): boolean {
  return STATE_MACHINE_TRIGGER_PATTERNS.some((p) => p.test(name))
}

/**
 * 工位注册表 —— 加载 + 校验 yaml 工位配置。
 *
 * 用法:
 * ```ts
 * const reg = new ZoneRegistry('/path/to/zones')
 * await reg.loadAllZones()       // 启动时加载 + 校验
 * reg.loadZone('drafting')       // 单个查询(必须先 load)
 * reg.list()                     // 全部(lifecycle 顺序)
 * ```
 *
 * 启动校验:
 * - 目录不存在 → 抛 ZoneRegistryError
 * - 字段缺失 / 类型错误 → 抛 ZoneRegistryError(指明文件)
 * - id 重复 / route_segment 重复 → 抛 ZoneRegistryError
 * - entry_triggers / exit_triggers 包含状态机命名模式 → 抛 ZoneRegistryError
 *
 * 默认值兜底(由 zod schema 提供):
 * - thinking_bar: required
 * - status_pulse: false
 * - entry_triggers / exit_triggers: []
 */
export class ZoneRegistry {
  private readonly zones = new Map<string, ZoneConfig>()
  private loaded = false

  constructor(public readonly zonesDir: string) {}

  /** 加载目录里所有 *.yaml,做字段校验 + 唯一性校验 + trigger 合法性 */
  async loadAllZones(): Promise<ZoneConfig[]> {
    if (!existsSync(this.zonesDir)) {
      throw new ZoneRegistryError(`zones directory not found: ${this.zonesDir}`)
    }

    const entries = await readdir(this.zonesDir)
    const yamlFiles = entries.filter((f) => f.endsWith('.yaml')).sort()

    const loaded: ZoneConfig[] = []
    for (const file of yamlFiles) {
      const filePath = join(this.zonesDir, file)
      const raw = await readFile(filePath, 'utf8')
      const parsed = yaml.parse(raw)

      if (!parsed || typeof parsed !== 'object' || !('zone' in parsed)) {
        throw new ZoneRegistryError(
          `zones/${file}: missing top-level 'zone:' key`,
          filePath,
        )
      }

      const result = ZoneSchema.safeParse(parsed.zone)
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `    - ${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('\n')
        throw new ZoneRegistryError(
          `zones/${file} failed validation:\n${issues}`,
          filePath,
        )
      }

      const zone = result.data

      // ADR-0012 §9 决策 8b 校验:trigger 命名不应像状态机转移
      for (const t of [...zone.entry_triggers, ...zone.exit_triggers]) {
        if (isStateMachineTrigger(t)) {
          throw new ZoneRegistryError(
            `zones/${file}: trigger "${t}" looks like a state-machine transition (ADR §9 决策 8b).\n` +
              `    entry_triggers / exit_triggers 仅允许非状态机触发(e.g. "ai-asked-question")。\n` +
              `    禁止 "<zone>-completed" / "complete-*" 等流程方向转移。`,
            filePath,
          )
        }
      }

      this.zones.set(zone.id, zone)
      loaded.push(zone)
    }

    // 唯一性校验(ADR §9)
    const seenIds = new Set<string>()
    const seenSegs = new Set<string>()
    const dups: string[] = []
    for (const z of loaded) {
      if (seenIds.has(z.id)) dups.push(`id="${z.id}"`)
      if (seenSegs.has(z.route_segment)) dups.push(`route_segment="${z.route_segment}"`)
      seenIds.add(z.id)
      seenSegs.add(z.route_segment)
    }
    if (dups.length > 0) {
      throw new ZoneRegistryError(
        `duplicate zone identifier(s): ${dups.join(', ')} (each zone must have a unique id and route_segment)`,
      )
    }

    this.loaded = true

    // 按 lifecycle 顺序返回(ZoneBar Tab / 日志一致)
    const order = (id: string) => {
      const i = (ZONE_LIFECYCLE_ORDER as readonly string[]).indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return loaded.sort((a, b) => order(a.id) - order(b.id))
  }

  /** 通过 id 取单个工位;未加载 / 未知 id → 抛 ZoneRegistryError */
  loadZone(id: string): ZoneConfig {
    if (!this.loaded) {
      throw new ZoneRegistryError(
        `loadAllZones() must be called before loadZone("${id}")`,
      )
    }
    const z = this.zones.get(id)
    if (!z) {
      throw new ZoneRegistryError(`unknown zone id: "${id}"`)
    }
    return z
  }

  /** 通过 id 查询单个工位(可选);加载前 / 未命中 → undefined(便利 API) */
  get(id: string): ZoneConfig | undefined {
    return this.zones.get(id)
  }

  /** 返回所有已加载工位(按 lifecycle 顺序) */
  list(): ZoneConfig[] {
    const order = (id: string) => {
      const i = (ZONE_LIFECYCLE_ORDER as readonly string[]).indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return Array.from(this.zones.values()).sort((a, b) => order(a.id) - order(b.id))
  }
}