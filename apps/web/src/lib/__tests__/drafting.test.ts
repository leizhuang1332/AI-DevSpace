import { describe, it, expect } from 'vitest'
import {
  emptyDrafting,
  getDraftingData,
  extractPrdOutline,
} from '@/lib/drafting'
import {
  generatePrdSkeleton,
  validateLaunch,
} from '@ai-devspace/shared'

// ============================================================================
// DraftingData 形状(issue 02):无 acceptanceCriteria / repos / actions
// ============================================================================

describe('emptyDrafting', () => {
  it('返回全空草稿结构(空 title + 空 PRD + empty=true)', () => {
    const d = emptyDrafting('NEW')
    expect(d.requirementId).toBe('NEW')
    expect(d.title).toBe('')
    expect(d.prdMarkdown).toBe('')
    expect(d.empty).toBe(true)
    expect(d.lastSavedAt).toBeNull()
    // 30s 自动保存周期(issue 02 验收 #4)
    expect(d.autosaveIntervalMs).toBe(30_000)
    // 无 acceptanceCriteria / repos / actions(issue 02 移除项)
    expect(
      (d as unknown as Record<string, unknown>).acceptanceCriteria,
    ).toBeUndefined()
    expect((d as unknown as Record<string, unknown>).repos).toBeUndefined()
    expect((d as unknown as Record<string, unknown>).actions).toBeUndefined()
    // 候命 Skill 列表保留(Inline 栏使用)
    expect(Array.isArray(d.skills)).toBe(true)
  })
})

describe('getDraftingData', () => {
  it('已知 id (req-001) → 返回退款功能样例数据(空=false)', async () => {
    const d = await getDraftingData('req-001')
    expect(d.requirementId).toBe('req-001')
    expect(d.empty).toBe(false)
    expect(d.title).toContain('退款')
    expect(d.prdMarkdown.length).toBeGreaterThan(0)
    // 样例 PRD 至少含 1 个 H1 + 4 个 H2(骨架填充结果)
    const anchors = extractPrdOutline(d.prdMarkdown).filter((s) => s.level <= 2)
    expect(anchors.filter((s) => s.level === 1).length).toBeGreaterThanOrEqual(1)
    expect(anchors.filter((s) => s.level === 2).length).toBeGreaterThanOrEqual(4)
    // 候命 Skill 3 个(Inline 栏)
    expect(d.skills.length).toBeGreaterThanOrEqual(3)
    const skillNames = d.skills.map((s) => s.name)
    expect(skillNames).toContain('requirement-brainstorm')
    expect(skillNames).toContain('requirement-clarify')
    expect(skillNames).toContain('schema-design')
  })

  it('未知 id → 返回空草稿(empty=true,PRD 空等待骨架填充)', async () => {
    const d = await getDraftingData('UNKNOWN')
    expect(d.empty).toBe(true)
    expect(d.title).toBe('')
    expect(d.prdMarkdown).toBe('')
  })

  it('mock 样例 PRD 由 generatePrdSkeleton 生成(可追溯到 ticket 01 骨架)', async () => {
    const d = await getDraftingData('req-001')
    // 应与 generatePrdSkeleton(title) 完全一致
    expect(d.prdMarkdown).toBe(generatePrdSkeleton(d.title))
  })
})

// ============================================================================
// 启动校验的 web 端契约(issue 02 验收 #6 #7):
// validateLaunch 在 packages/shared,web 端通过 validateLaunch 重新导出并使用;
// 这里覆盖 web 端契约 —— title trim 非空 + PRD trim 非空 → canLaunch=true。
// ============================================================================

describe('validateLaunch(web 端契约)', () => {
  it('title 与 PRD 均有非空白内容 → canLaunch=true', () => {
    expect(
      validateLaunch({ title: '退款功能优化', prdMarkdown: '# PRD' }).canLaunch,
    ).toBe(true)
  })

  it('title 全空白 → canLaunch=false', () => {
    expect(
      validateLaunch({ title: '   \t\n', prdMarkdown: '# PRD' }).canLaunch,
    ).toBe(false)
  })

  it('PRD 全空白 → canLaunch=false', () => {
    expect(
      validateLaunch({ title: 't', prdMarkdown: '   \n\t  ' }).canLaunch,
    ).toBe(false)
  })

  it('不依赖仓库 / 辅助文件 —— 仅看 title + prdMarkdown 两个字段', () => {
    const r = validateLaunch({ title: 't', prdMarkdown: 'p' })
    expect(r.canLaunch).toBe(true)
    expect(typeof r.canLaunch).toBe('boolean')
  })
})

// ============================================================================
// extractPrdOutline — 历史 API(issue 03 锚点栏会用 shared 包的 extractPrdAnchors);
// 本文件保留作为本期骨架填充结果的基础断言工具。
// ============================================================================

describe('extractPrdOutline', () => {
  it('空 markdown → 空数组', () => {
    expect(extractPrdOutline('')).toEqual([])
  })

  it('骨架结果含 H1 + 4 个 H2(背景 / 目标 / 验收标准 / 非目标)', () => {
    const md = generatePrdSkeleton('退款功能优化')
    const outline = extractPrdOutline(md)
    const h1 = outline.find((s) => s.level === 1)
    const h2Titles = outline.filter((s) => s.level === 2).map((s) => s.title)
    expect(h1?.title).toBe('退款功能优化')
    expect(h2Titles).toEqual(['背景', '目标', '验收标准', '非目标'])
  })
})