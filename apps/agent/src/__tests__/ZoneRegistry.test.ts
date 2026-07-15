import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ZoneRegistry,
  ZONE_LIFECYCLE_ORDER,
} from '../services/ZoneRegistry.js'

let tmpRoot: string
let zonesDir: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-zones-'))
  zonesDir = join(tmpRoot, 'zones')
  mkdirSync(zonesDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

function writeZone(file: string, content: object | string): void {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  writeFileSync(join(zonesDir, file), text, 'utf8')
}

const validZoneBody = (overrides: Record<string, unknown> = {}) => ({
  zone: {
    id: 'drafting',
    name: 'DRAFTING',
    display_name: '起草',
    icon: '✏️',
    route_segment: 'drafting',
    has_resource_tree: true,
    has_inline_rail: true,
    main_layout: 'workspace',
    status_color: 'gray',
    status_pulse: false,
    default_arming: ['requirement-drafting'],
    entry_triggers: [],
    exit_triggers: [],
    description: '撰写需求文档',
    ...overrides,
  },
})

describe('ZONE_LIFECYCLE_ORDER', () => {
  it('导出 6 工位 lifecycle 顺序', () => {
    expect(ZONE_LIFECYCLE_ORDER).toEqual([
      'drafting',
      'analyzing',
      'clarifying',
      'designing',
      'executing',
      'wrapup',
    ])
  })
})

describe('ZoneRegistry.loadAllZones', () => {
  it('加载目录中所有 yaml', async () => {
    writeZone('drafting.yaml', validZoneBody())
    const reg = new ZoneRegistry(zonesDir)
    const zones = await reg.loadAllZones()
    expect(zones).toHaveLength(1)
    expect(zones[0].id).toBe('drafting')
  })

  it('加载 6 个 yaml 后返回顺序按 lifecycle 排列', async () => {
    // 故意打乱写入顺序
    writeZone('executing.yaml', validZoneBody({ id: 'executing', route_segment: 'executing' }))
    writeZone('drafting.yaml', validZoneBody({ id: 'drafting', route_segment: 'drafting' }))
    writeZone('analyzing.yaml', validZoneBody({ id: 'analyzing', route_segment: 'analyzing' }))
    writeZone('clarifying.yaml', validZoneBody({ id: 'clarifying', route_segment: 'clarifying' }))
    writeZone('designing.yaml', validZoneBody({ id: 'designing', route_segment: 'designing' }))
    writeZone('wrapup.yaml', validZoneBody({ id: 'wrapup', route_segment: 'wrap-up' }))

    const reg = new ZoneRegistry(zonesDir)
    const zones = await reg.loadAllZones()
    expect(zones.map((z) => z.id)).toEqual([
      'drafting',
      'analyzing',
      'clarifying',
      'designing',
      'executing',
      'wrapup',
    ])
  })

  it('目录不存在时抛错', async () => {
    const reg = new ZoneRegistry(join(tmpRoot, 'nope'))
    await expect(reg.loadAllZones()).rejects.toThrow(/zones directory not found/)
  })

  it('字段缺失时抛错(指明文件路径)', async () => {
    writeZone('bad.yaml', `zone:\n  id: foo\n`)
    const reg = new ZoneRegistry(zonesDir)
    await expect(reg.loadAllZones()).rejects.toThrow(/bad\.yaml/)
  })

  it('字段类型错误立即报错(has_resource_tree 写了 "yes")', async () => {
    writeZone(
      'wrong-type.yaml',
      `zone:\n  id: foo\n  name: FOO\n  display_name: foo\n  icon: "?"\n  route_segment: foo\n  has_resource_tree: "yes"\n  has_inline_rail: false\n  main_layout: x\n  status_color: gray\n  default_arming: []\n`,
    )
    const reg = new ZoneRegistry(zonesDir)
    await expect(reg.loadAllZones()).rejects.toThrow(/wrong-type\.yaml/)
  })

  it('顶层缺 zone: key 时报错', async () => {
    writeZone('nozone.yaml', `id: foo\nname: FOO\n`)
    const reg = new ZoneRegistry(zonesDir)
    await expect(reg.loadAllZones()).rejects.toThrow(/nozone\.yaml/)
  })

  it('id 重复时启动失败', async () => {
    writeZone('a.yaml', validZoneBody({ id: 'drafting', route_segment: 'a' }))
    writeZone('b.yaml', validZoneBody({ id: 'drafting', route_segment: 'b' }))
    const reg = new ZoneRegistry(zonesDir)
    await expect(reg.loadAllZones()).rejects.toThrow(/duplicate.*id.*drafting/i)
  })

  it('route_segment 重复时启动失败', async () => {
    writeZone('a.yaml', validZoneBody({ id: 'a', route_segment: 'shared' }))
    writeZone('b.yaml', validZoneBody({ id: 'b', route_segment: 'shared' }))
    const reg = new ZoneRegistry(zonesDir)
    await expect(reg.loadAllZones()).rejects.toThrow(/duplicate.*route_segment.*shared/i)
  })

  it('忽略非 yaml 文件', async () => {
    writeZone('drafting.yaml', validZoneBody())
    writeZone('README.md', '# notes')
    writeZone('notes.txt', 'whatever')
    const reg = new ZoneRegistry(zonesDir)
    const zones = await reg.loadAllZones()
    expect(zones).toHaveLength(1)
  })

  it('status_pulse 缺失时默认 false', async () => {
    writeZone(
      'no-pulse.yaml',
      `zone:\n  id: foo\n  name: FOO\n  display_name: foo\n  icon: "?"\n  route_segment: foo\n  has_resource_tree: false\n  has_inline_rail: false\n  main_layout: x\n  status_color: gray\n  default_arming: []\n`,
    )
    const reg = new ZoneRegistry(zonesDir)
    const zones = await reg.loadAllZones()
    expect(zones[0].status_pulse).toBe(false)
  })

  describe('ADR §9 决策 8b · trigger 命名合法性', () => {
    it('entry_triggers 含 "<zone>-completed" 模式时拒绝', async () => {
      writeZone(
        'bad-trigger.yaml',
        `zone:\n  id: foo\n  name: FOO\n  display_name: foo\n  icon: "?"\n  route_segment: foo\n  has_resource_tree: false\n  has_inline_rail: false\n  main_layout: x\n  status_color: gray\n  default_arming: []\n  entry_triggers:\n    - analyzing-completed\n`,
      )
      const reg = new ZoneRegistry(zonesDir)
      await expect(reg.loadAllZones()).rejects.toThrow(/state-machine transition/)
    })

    it('entry_triggers 含 "complete-*" 模式时拒绝', async () => {
      writeZone(
        'bad-trigger2.yaml',
        `zone:\n  id: foo\n  name: FOO\n  display_name: foo\n  icon: "?"\n  route_segment: foo\n  has_resource_tree: false\n  has_inline_rail: false\n  main_layout: x\n  status_color: gray\n  default_arming: []\n  entry_triggers:\n    - complete-design\n`,
      )
      const reg = new ZoneRegistry(zonesDir)
      await expect(reg.loadAllZones()).rejects.toThrow(/state-machine transition/)
    })

    it('exit_triggers 含 "-done" 后缀时拒绝', async () => {
      writeZone(
        'bad-exit.yaml',
        `zone:\n  id: foo\n  name: FOO\n  display_name: foo\n  icon: "?"\n  route_segment: foo\n  has_resource_tree: false\n  has_inline_rail: false\n  main_layout: x\n  status_color: gray\n  default_arming: []\n  exit_triggers:\n    - designing-done\n`,
      )
      const reg = new ZoneRegistry(zonesDir)
      await expect(reg.loadAllZones()).rejects.toThrow(/state-machine transition/)
    })

    it('事件型 trigger(如 "ai-asked-question")通过', async () => {
      writeZone(
        'good-event.yaml',
        `zone:\n  id: clarifying\n  name: CLARIFYING\n  display_name: 澄清\n  icon: "?"\n  route_segment: clarifying\n  has_resource_tree: false\n  has_inline_rail: false\n  main_layout: qa\n  status_color: purple-warn\n  default_arming: []\n  entry_triggers:\n    - ai-asked-question\n`,
      )
      const reg = new ZoneRegistry(zonesDir)
      const zones = await reg.loadAllZones()
      expect(zones[0].entry_triggers).toContain('ai-asked-question')
    })
  })
})

describe('ZoneRegistry.loadZone', () => {
  it('加载后通过 id 取配置', async () => {
    writeZone('drafting.yaml', validZoneBody())
    const reg = new ZoneRegistry(zonesDir)
    await reg.loadAllZones()
    const z = reg.loadZone('drafting')
    expect(z.name).toBe('DRAFTING')
  })

  it('未调用 loadAllZones 时抛错', () => {
    const reg = new ZoneRegistry(zonesDir)
    expect(() => reg.loadZone('drafting')).toThrow(/loadAllZones\(\) must be called/)
  })

  it('未知 id 抛错', async () => {
    writeZone('drafting.yaml', validZoneBody())
    const reg = new ZoneRegistry(zonesDir)
    await reg.loadAllZones()
    expect(() => reg.loadZone('nonexistent')).toThrow(/unknown zone id/)
  })
})

describe('ZoneRegistry.get / list', () => {
  it('get 通过 id 取配置(未命中返回 undefined)', async () => {
    writeZone('drafting.yaml', validZoneBody())
    const reg = new ZoneRegistry(zonesDir)
    await reg.loadAllZones()
    expect(reg.get('drafting')?.name).toBe('DRAFTING')
    expect(reg.get('nonexistent')).toBeUndefined()
  })

  it('list 返回所有已加载工位(按 lifecycle 顺序)', async () => {
    writeZone('wrapup.yaml', validZoneBody({ id: 'wrapup', route_segment: 'wrap-up' }))
    writeZone('drafting.yaml', validZoneBody({ id: 'drafting', route_segment: 'drafting' }))
    writeZone('executing.yaml', validZoneBody({ id: 'executing', route_segment: 'executing' }))
    const reg = new ZoneRegistry(zonesDir)
    await reg.loadAllZones()
    expect(reg.list().map((z) => z.id)).toEqual(['drafting', 'executing', 'wrapup'])
  })

  it('加载前 get/list 返回空', () => {
    const reg = new ZoneRegistry(zonesDir)
    expect(reg.get('drafting')).toBeUndefined()
    expect(reg.list()).toEqual([])
  })
})

describe('ZoneRegistry · 仓库内 6 个内置 yaml', () => {
  it('apps/agent/src/zones 下 6 个 yaml 都能加载且字段齐全', async () => {
    const builtInDir = join(import.meta.dirname, '..', '..', 'src', 'zones')
    expect(existsSync(builtInDir)).toBe(true)
    const reg = new ZoneRegistry(builtInDir)
    const zones = await reg.loadAllZones()
    expect(zones).toHaveLength(6)

    expect(zones.map((z) => z.id)).toEqual([
      'drafting',
      'analyzing',
      'clarifying',
      'designing',
      'executing',
      'wrapup',
    ])

    // route_segment 唯一
    const segs = zones.map((z) => z.route_segment)
    expect(new Set(segs).size).toBe(segs.length)

    // 校验默认值兜底 + 触发器结构合法
    for (const z of zones) {
      expect(z.status_pulse === undefined || typeof z.status_pulse === 'boolean').toBe(true)
      expect(Array.isArray(z.entry_triggers)).toBe(true)
      expect(z.entry_triggers.every((t) => typeof t === 'string')).toBe(true)
      expect(Array.isArray(z.exit_triggers)).toBe(true)
      expect(z.exit_triggers.every((t) => typeof t === 'string')).toBe(true)
    }

    // CLARIFYING 至少有 AI 提问触发器(ADR §9 决策 25)
    const clarifying = reg.loadZone('clarifying')
    expect(clarifying.entry_triggers).toContain('ai-asked-question')
  })

  it('启动日志字符串与 issue 验收文案完全一致', async () => {
    const builtInDir = join(import.meta.dirname, '..', '..', 'src', 'zones')
    const reg = new ZoneRegistry(builtInDir)
    const zones = await reg.loadAllZones()
    const logLine = `${zones.length} zones loaded: ${zones.map((z) => z.id).join(', ')}`
    expect(logLine).toBe(
      '6 zones loaded: drafting, analyzing, clarifying, designing, executing, wrapup',
    )
  })
})