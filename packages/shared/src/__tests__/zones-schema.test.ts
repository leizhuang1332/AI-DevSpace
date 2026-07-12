import { describe, it, expect } from 'vitest'
import { ZoneSchema } from '../zones.js'

const validZone = {
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
  thinking_bar: 'required',
  entry_triggers: [],
  exit_triggers: [],
  description: '撰写需求文档',
}

describe('ZoneSchema', () => {
  describe('完整字段集', () => {
    it('接受完整 15 字段对象', () => {
      const r = ZoneSchema.parse(validZone)
      expect(r.id).toBe('drafting')
      expect(r.has_resource_tree).toBe(true)
      expect(r.thinking_bar).toBe('required')
      expect(r.entry_triggers).toEqual([])
    })

    it('导出 15 个属性', () => {
      const keys = Object.keys(ZoneSchema.shape).sort()
      expect(keys).toEqual(
        [
          'default_arming',
          'description',
          'display_name',
          'entry_triggers',
          'exit_triggers',
          'has_inline_rail',
          'has_resource_tree',
          'icon',
          'id',
          'main_layout',
          'name',
          'route_segment',
          'status_color',
          'status_pulse',
          'thinking_bar',
        ].sort(),
      )
    })
  })

  describe('身份(5 字段)', () => {
    it('id 缺失时报错', () => {
      const { id, ...rest } = validZone
      expect(() => ZoneSchema.parse(rest)).toThrow()
    })
    it('id 为空字符串时报错', () => {
      expect(() => ZoneSchema.parse({ ...validZone, id: '' })).toThrow()
    })
    it('name 缺失时报错', () => {
      const { name, ...rest } = validZone
      expect(() => ZoneSchema.parse(rest)).toThrow()
    })
    it('display_name 缺失时报错', () => {
      const { display_name, ...rest } = validZone
      expect(() => ZoneSchema.parse(rest)).toThrow()
    })
    it('icon 缺失时报错', () => {
      const { icon, ...rest } = validZone
      expect(() => ZoneSchema.parse(rest)).toThrow()
    })
    it('route_segment 缺失时报错', () => {
      const { route_segment, ...rest } = validZone
      expect(() => ZoneSchema.parse(rest)).toThrow()
    })
  })

  describe('环境(5 字段)', () => {
    it('has_resource_tree 必须是 boolean（"yes" 报错）', () => {
      expect(() =>
        ZoneSchema.parse({ ...validZone, has_resource_tree: 'yes' as unknown as boolean }),
      ).toThrow()
    })
    it('has_inline_rail 必须是 boolean', () => {
      expect(() =>
        ZoneSchema.parse({ ...validZone, has_inline_rail: 1 as unknown as boolean }),
      ).toThrow()
    })
    it('main_layout 缺失时报错', () => {
      const { main_layout, ...rest } = validZone
      expect(() => ZoneSchema.parse(rest)).toThrow()
    })
    it('status_color 必须是受控枚举', () => {
      expect(() =>
        ZoneSchema.parse({ ...validZone, status_color: 'rainbow' as unknown as 'gray' }),
      ).toThrow()
    })
    it('status_pulse 必须是 boolean', () => {
      expect(() =>
        ZoneSchema.parse({ ...validZone, status_pulse: 'true' as unknown as boolean }),
      ).toThrow()
    })
  })

  describe('装备(1 字段)', () => {
    it('default_arming 必须是 string[]', () => {
      expect(() =>
        ZoneSchema.parse({ ...validZone, default_arming: 'code-review' as unknown as string[] }),
      ).toThrow()
    })
    it('default_arming 可以为空数组', () => {
      const r = ZoneSchema.parse({ ...validZone, default_arming: [] })
      expect(r.default_arming).toEqual([])
    })
    it('default_arming 元素必须都是 string', () => {
      expect(() =>
        ZoneSchema.parse({ ...validZone, default_arming: [1, 2] as unknown as string[] }),
      ).toThrow()
    })
  })

  describe('AI 思考条(1 字段 + 默认值)', () => {
    it('thinking_bar 必须是 required / minimal / hidden', () => {
      expect(() =>
        ZoneSchema.parse({ ...validZone, thinking_bar: 'always' as unknown as 'required' }),
      ).toThrow()
    })
    it('thinking_bar 缺失时默认 required', () => {
      const { thinking_bar, ...rest } = validZone
      const r = ZoneSchema.parse(rest)
      expect(r.thinking_bar).toBe('required')
    })
  })

  describe('触发器(2 字段 + 默认值)', () => {
    it('entry_triggers 缺失时默认 []', () => {
      const { entry_triggers, ...rest } = validZone
      const r = ZoneSchema.parse(rest)
      expect(r.entry_triggers).toEqual([])
    })
    it('exit_triggers 缺失时默认 []', () => {
      const { exit_triggers, ...rest } = validZone
      const r = ZoneSchema.parse(rest)
      expect(r.exit_triggers).toEqual([])
    })
    it('entry_triggers 元素必须都是 string', () => {
      expect(() =>
        ZoneSchema.parse({ ...validZone, entry_triggers: [1] as unknown as string[] }),
      ).toThrow()
    })
  })

  describe('备注(1 字段 · 可选)', () => {
    it('description 可选 · 缺失时为 undefined', () => {
      const { description, ...rest } = validZone
      const r = ZoneSchema.parse(rest)
      expect(r.description).toBeUndefined()
    })
    it('description 可为空字符串', () => {
      const r = ZoneSchema.parse({ ...validZone, description: '' })
      expect(r.description).toBe('')
    })
  })

  describe('status_pulse 默认值', () => {
    it('缺失时默认 false', () => {
      const { status_pulse, ...rest } = validZone
      const r = ZoneSchema.parse(rest)
      expect(r.status_pulse).toBe(false)
    })
  })
})