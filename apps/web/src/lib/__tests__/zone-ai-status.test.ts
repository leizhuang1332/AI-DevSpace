import { describe, it, expect } from 'vitest'
import {
  getZoneAIStatus,
  getRequirementAIStatus,
  ambientAIStatus,
} from '../zone-ai-status'

/**
 * AI 状态数据层测试(issue 16):ThinkBar 的内容由注册表 + 路由决定。
 *
 * 三个数据源:
 * 1. getZoneAIStatus(zone): 工位级 — 用于 zone 路由
 * 2. getRequirementAIStatus(id): 需求级 — 用于 Overview 路由
 * 3. ambientAIStatus: 其他路由的默认 ambient 状态
 *
 * 输出格式: { title, sub }
 * - title: 1 行短文本(如 "AI 正在执行 T-05" / "AI 累计工作 1h 23min")
 * - sub: 副标题(如 meta 信息:时间戳 / 候命 / 待回答)
 */

describe('getZoneAIStatus(zone)', () => {
  it('6 工位都有对应状态', () => {
    const segments = [
      'drafting',
      'analyzing',
      'clarifying',
      'designing',
      'executing',
      'wrap-up',
    ]
    for (const seg of segments) {
      expect(() => getZoneAIStatus(seg)).not.toThrow()
      const s = getZoneAIStatus(seg)
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.sub.length).toBeGreaterThan(0)
    }
  })

  it('EXECUTING 工位显示任务级状态(对照 11g 原型 "AI 正在执行 T-05")', () => {
    const s = getZoneAIStatus('executing')
    expect(s.title).toMatch(/AI|执行|任务/)
    // 至少包含任务标识(T-NN)
    expect(s.title).toMatch(/T-\d+/)
  })

  it('ANALYZING 工位显示思考状态', () => {
    const s = getZoneAIStatus('analyzing')
    expect(s.title.length).toBeGreaterThan(0)
  })

  it('CLARIFYING 工位显示提问等待状态', () => {
    const s = getZoneAIStatus('clarifying')
    expect(s.title.length).toBeGreaterThan(0)
  })

  it('WRAP-UP 工位显示归档状态', () => {
    const s = getZoneAIStatus('wrap-up')
    expect(s.title.length).toBeGreaterThan(0)
  })

  it('未知 zone segment 抛错(便于上层兜底或 fallback)', () => {
    expect(() => getZoneAIStatus('unknown-zone' as never)).toThrow()
  })
})

describe('getRequirementAIStatus(requirementId)', () => {
  it('已知需求(req-001)返回非空 status', async () => {
    const s = await getRequirementAIStatus('req-001')
    expect(s.title.length).toBeGreaterThan(0)
    expect(s.sub.length).toBeGreaterThan(0)
  })

  it('req-001 包含累计工作时长(对照 11g/12 原型 "AI 累计工作 1h 23min")', async () => {
    const s = await getRequirementAIStatus('req-001')
    expect(s.title).toMatch(/累计|工作|1h|小时/)
  })

  it('未知 id 返回空 idle 状态,不抛错', async () => {
    const s = await getRequirementAIStatus('unknown-id')
    expect(s.title).toBeTypeOf('string')
    expect(s.sub).toBeTypeOf('string')
  })
})

describe('ambientAIStatus', () => {
  it('返回通用 standby 状态(其他路由默认)', () => {
    const s = ambientAIStatus()
    expect(s.title.length).toBeGreaterThan(0)
    expect(s.sub.length).toBeGreaterThan(0)
  })
})
