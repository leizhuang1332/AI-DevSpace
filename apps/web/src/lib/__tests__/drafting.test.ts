import { describe, it, expect } from 'vitest'
import {
  AUX_PANE_MIN_HEIGHT_PX,
  DEFAULT_PRD_RATIO,
  SPLIT_RESIZER_HEIGHT_PX,
  clampSplitRatio,
  emptyDrafting,
  getDraftingData,
  extractPrdOutline,
} from '@/lib/drafting'
import {
  generatePrdSkeleton,
  validateLaunch,
} from '@ai-devspace/shared'

// ============================================================================
// DraftingData 形状(issue 02 + 04 + 08):
// - 旧 acceptanceCriteria / actions 字段不再出现
// - repos / selectedRepoIds 已就位(issue 08);空草稿两者均为 []
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
    // 旧 acceptanceCriteria / actions 已彻底移除(issue 02)
    expect(
      (d as unknown as Record<string, unknown>).acceptanceCriteria,
    ).toBeUndefined()
    expect((d as unknown as Record<string, unknown>).actions).toBeUndefined()
    // 候命 Skill 列表保留(Inline 栏使用)
    expect(Array.isArray(d.skills)).toBe(true)
    // issue 04:auxFiles 默认为空数组(走 EmptyAuxPlaceholder 占位)
    expect(d.auxFiles).toEqual([])
    // issue 08:空草稿默认无仓库、无选中
    expect(d.repos).toEqual([])
    expect(d.selectedRepoIds).toEqual([])
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
    // issue 04:辅助文件 4 个(对应设计稿样例)
    expect(d.auxFiles.length).toBe(4)
    const filenames = d.auxFiles.map((a) => a.filename)
    expect(filenames).toContain('api-draft.md')
    expect(filenames).toContain('data-model.md')
    expect(filenames).toContain('existing-flow.md')
    expect(filenames).toContain('competitor-analysis.md')
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

// ============================================================================
// issue 04 · 上下分割比例常量 & clampSplitRatio
//
// 关键约束:
// - DEFAULT_PRD_RATIO = 0.6(验收 #5 默认 60/40)
// - AUX_PANE_MIN_HEIGHT_PX = 140(行卡片可视 floor)
// - SPLIT_RESIZER_HEIGHT_PX = 6(设计稿 .split-resizer 高度)
// - clampSplitRatio 守住这两个边界 + PRD 不被压到 0
// ============================================================================

describe('drafting 常量(issue 04)', () => {
  it('DEFAULT_PRD_RATIO = 0.6', () => {
    expect(DEFAULT_PRD_RATIO).toBeCloseTo(0.6, 5)
  })

  it('AUX_PANE_MIN_HEIGHT_PX = 180(行卡片 floor,符合 issue 04 验收 #6)', () => {
    expect(AUX_PANE_MIN_HEIGHT_PX).toBe(180)
  })

  it('SPLIT_RESIZER_HEIGHT_PX = 6', () => {
    expect(SPLIT_RESIZER_HEIGHT_PX).toBe(6)
  })
})

describe('clampSplitRatio', () => {
  // 一个常见容器高度:1200px 主区 → 6px 分割条 → 1194px 可分配
  // 上下限:
  //   min = 6 / 1194 ≈ 0.005
  //   max = 1 - 140 / 1194 ≈ 0.883
  const COMMON_HEIGHT = 1200
  const expectedMin = SPLIT_RESIZER_HEIGHT_PX / (COMMON_HEIGHT - SPLIT_RESIZER_HEIGHT_PX)
  const expectedMax = 1 - AUX_PANE_MIN_HEIGHT_PX / (COMMON_HEIGHT - SPLIT_RESIZER_HEIGHT_PX)

  it('默认 0.6 在合法区间内 → 原样返回', () => {
    expect(clampSplitRatio(0.6, COMMON_HEIGHT)).toBeCloseTo(0.6, 5)
  })

  it('ratio > max → 被裁到 max(确保 aux ≥ 行卡片 floor)', () => {
    const result = clampSplitRatio(0.95, COMMON_HEIGHT)
    expect(result).toBeCloseTo(expectedMax, 5)
    expect(result).toBeLessThanOrEqual(expectedMax + 1e-9)
  })

  it('ratio < min → 被抬到 min(防止 PRD 消失)', () => {
    const result = clampSplitRatio(0.001, COMMON_HEIGHT)
    expect(result).toBeCloseTo(expectedMin, 5)
    expect(result).toBeGreaterThanOrEqual(expectedMin - 1e-9)
  })

  it('ratio 边界值正好等于 max → 原样返回', () => {
    expect(clampSplitRatio(expectedMax, COMMON_HEIGHT)).toBeCloseTo(expectedMax, 5)
  })

  it('ratio 边界值正好等于 min → 原样返回', () => {
    expect(clampSplitRatio(expectedMin, COMMON_HEIGHT)).toBeCloseTo(expectedMin, 5)
  })

  it('容器高度 = 0 → 退化为 1(全部给 PRD,无 aux 空间)', () => {
    // 容器没有可分配空间时,ratio 应被钉到 1(避免除零)
    expect(clampSplitRatio(0.6, 0)).toBe(1)
  })

  it('容器高度 < 分割条高度 → 退化为 1', () => {
    // 容器 3px < 分割条 6px → 没有可分配空间
    expect(clampSplitRatio(0.6, 3)).toBe(1)
  })

  it('容器太小装不下 AUX_PANE_MIN_HEIGHT → 退到 max = min(aux 强制 floor)', () => {
    // 容器 200px:usable = 194px;若 aux 要 ≥ 140px,则 PRD 占比 ≤ (194-140)/194 ≈ 0.278
    const tiny = 200
    const result = clampSplitRatio(0.6, tiny)
    // result 应 ≤ maxPrdRatio;又因 0.6 > maxPrdRatio,被裁到 maxPrdRatio
    // maxPrdRatio = 1 - 140/194 ≈ 0.278
    expect(result).toBeCloseTo(1 - AUX_PANE_MIN_HEIGHT_PX / 194, 5)
    // 同时这个上限又 ≥ minPrdRatio = 6/194 ≈ 0.031,所以不会反向裁
    expect(result).toBeGreaterThan(SPLIT_RESIZER_HEIGHT_PX / 194 - 1e-9)
  })

  it('很大容器(4K) → 默认 0.6 仍在合法区间内', () => {
    expect(clampSplitRatio(0.6, 4000)).toBeCloseTo(0.6, 5)
  })
})