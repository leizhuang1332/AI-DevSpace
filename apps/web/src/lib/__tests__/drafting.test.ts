import { describe, it, expect } from 'vitest'
import {
  extractPrdOutline,
  validateDraftingForm,
  emptyDrafting,
  getDraftingData,
  type AcceptanceCriterion,
} from '@/lib/drafting'

// ============================================================================
// extractPrdOutline — PRD Markdown → 章节大纲(issue 18 验收 #5)
// ============================================================================

describe('extractPrdOutline', () => {
  it('空 markdown → 空数组', () => {
    expect(extractPrdOutline('')).toEqual([])
  })

  it('提取 H1/H2/H3 三级标题', () => {
    const md = `# 标题一
## 标题二
### 标题三
#### 标题四(忽略,默认 maxLevel=3)
`
    expect(extractPrdOutline(md)).toEqual([
      { level: 1, title: '标题一', line: 0 },
      { level: 2, title: '标题二', line: 1 },
      { level: 3, title: '标题三', line: 2 },
    ])
  })

  it('忽略空标题与未闭合标签', () => {
    const md = `#
##  保留
#    标题前后空格保留
### `
    expect(extractPrdOutline(md)).toEqual([
      { level: 2, title: '保留', line: 1 },
      { level: 1, title: '标题前后空格保留', line: 2 },
    ])
  })

  it('maxLevel 选项控制解析深度', () => {
    const md = `# H1
## H2
### H3
#### H4
`
    expect(extractPrdOutline(md, { maxLevel: 2 })).toEqual([
      { level: 1, title: 'H1', line: 0 },
      { level: 2, title: 'H2', line: 1 },
    ])
  })

  it('行号记录正确(0-based)', () => {
    const md = `\n\n# 标题一\n\n## 标题二\n`
    expect(extractPrdOutline(md)).toEqual([
      { level: 1, title: '标题一', line: 2 },
      { level: 2, title: '标题二', line: 4 },
    ])
  })

  it('支持 CRLF 行尾', () => {
    const md = '# T1\r\n## T2\r\n'
    expect(extractPrdOutline(md)).toEqual([
      { level: 1, title: 'T1', line: 0 },
      { level: 2, title: 'T2', line: 1 },
    ])
  })

  it('文本非标题时不误识别', () => {
    const md = `#foo(no space — 不算 heading)
文字段落
> # 引用中的不算
- 列表里的 # 标题
`
    expect(extractPrdOutline(md)).toEqual([])
  })
})

// ============================================================================
// validateDraftingForm — 表单完备度(issue 18 验收 #2)
// ============================================================================

describe('validateDraftingForm', () => {
  const baseAc: AcceptanceCriterion[] = [
    { id: 'a', text: '退款成功率 ≥ 99%', checked: false },
  ]

  it('标题 / PRD / AC 都齐 → canSubmit=true', () => {
    const r = validateDraftingForm({
      title: '退款功能优化',
      prdMarkdown: '# PRD',
      acceptanceCriteria: baseAc,
    })
    expect(r.canSubmit).toBe(true)
    expect(r.canSave).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('标题为空 → canSubmit=false', () => {
    const r = validateDraftingForm({
      title: '',
      prdMarkdown: '# PRD',
      acceptanceCriteria: baseAc,
    })
    expect(r.canSubmit).toBe(false)
    expect(r.missing).toContain('title')
  })

  it('PRD 为空 → canSubmit=false', () => {
    const r = validateDraftingForm({
      title: 't',
      prdMarkdown: '',
      acceptanceCriteria: baseAc,
    })
    expect(r.canSubmit).toBe(false)
    expect(r.missing).toContain('prd')
  })

  it('无 AC 时(空数组) → canSubmit 仍可为 true(spec 没要求 AC 必填)', () => {
    const r = validateDraftingForm({
      title: 't',
      prdMarkdown: 'p',
      acceptanceCriteria: [],
    })
    expect(r.canSubmit).toBe(true)
    expect(r.missing).not.toContain('ac')
  })

  it('草稿任何时候都能存(canSave=true),即使为空', () => {
    const r = validateDraftingForm({
      title: '',
      prdMarkdown: '',
      acceptanceCriteria: [],
    })
    expect(r.canSave).toBe(true)
    expect(r.canSubmit).toBe(false)
  })

  it('首尾空白视作空', () => {
    const r = validateDraftingForm({
      title: '   ',
      prdMarkdown: '\n\n',
      acceptanceCriteria: [],
    })
    expect(r.missing).toEqual(expect.arrayContaining(['title', 'prd']))
    expect(r.missing).not.toContain('ac')
  })
})

// ============================================================================
// emptyDrafting / getDraftingData — Mock 期数据层
// ============================================================================

describe('emptyDrafting', () => {
  it('返回全空草稿结构', () => {
    const d = emptyDrafting('NEW')
    expect(d.requirementId).toBe('NEW')
    expect(d.title).toBe('')
    expect(d.prdMarkdown).toBe('')
    expect(d.acceptanceCriteria).toEqual([])
    expect(d.repos).toEqual([])
    expect(d.skills).toEqual([])
    // actions 不为空 —— 空草稿也要展示 [保存草稿]/[启动 AI] 两个按钮(disabled 由表单完备度决定)
    expect(d.actions.length).toBeGreaterThan(0)
    expect(d.actions.map((a) => a.id)).toEqual(['save', 'launch'])
    expect(d.lastSavedAt).toBeNull()
    expect(d.empty).toBe(true)
    expect(d.autosaveIntervalMs).toBeGreaterThan(0)
  })
})

describe('getDraftingData', () => {
  it('已知 id (req-001) → 返回退款功能样例数据,empty=false', async () => {
    const d = await getDraftingData('req-001')
    expect(d.requirementId).toBe('req-001')
    expect(d.empty).toBe(false)
    expect(d.title).toContain('退款')
    expect(d.acceptanceCriteria.length).toBeGreaterThan(0)
    expect(d.repos.length).toBeGreaterThan(0)
    expect(d.skills.length).toBeGreaterThanOrEqual(3)
    // 三个候命 Skill(issue 18 验收 #6)
    const skillNames = d.skills.map((s) => s.name)
    expect(skillNames).toContain('requirement-brainstorm')
    expect(skillNames).toContain('requirement-clarify')
    expect(skillNames).toContain('schema-design')
  })

  it('未知 id → 返回空草稿', async () => {
    const d = await getDraftingData('UNKNOWN')
    expect(d.empty).toBe(true)
    expect(d.title).toBe('')
  })

  it('actions 包含保存草稿与启动 AI 分析(issue 18 验收 #2 #3)', async () => {
    const d = await getDraftingData('req-001')
    const ids = d.actions.map((a) => a.id)
    expect(ids).toContain('save')
    expect(ids).toContain('launch')
    const launch = d.actions.find((a) => a.id === 'launch')!
    expect(launch.variant).toBe('primary')
    expect(launch.label).toContain('AI 分析')
  })

  it('mock 数据 PRD 至少有 H1 / H2 标题(供资源树展示)', async () => {
    const d = await getDraftingData('req-001')
    const outline = extractPrdOutline(d.prdMarkdown)
    expect(outline.length).toBeGreaterThanOrEqual(2)
    expect(outline.some((s) => s.level === 1)).toBe(true)
  })
})