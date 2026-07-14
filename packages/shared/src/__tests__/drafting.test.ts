import { describe, it, expect } from 'vitest'
import {
  generatePrdSkeleton,
  extractPrdAnchors,
  resolveAuxLink,
  validateLaunch,
  mockConvertToMarkdown,
  type AuxFile,
} from '../drafting.js'

// ============================================================================
// generatePrdSkeleton — DRAFTING 工位 PRD 骨架生成器(issue 01 验收 #2)
// ============================================================================

describe('generatePrdSkeleton', () => {
  it('生成含 4 个 H2 章节的骨架(背景 / 目标 / 验收标准 / 非目标)', () => {
    const md = generatePrdSkeleton('退款功能优化')
    expect(md).toContain('# 退款功能优化')
    expect(md).toContain('## 背景')
    expect(md).toContain('## 目标')
    expect(md).toContain('## 验收标准')
    expect(md).toContain('## 非目标')
  })

  it('H1 标题出现在 Markdown 顶部', () => {
    const md = generatePrdSkeleton('支付链路重构')
    const firstNonEmpty = md.split(/\r?\n/).find((l) => l.trim().length > 0)
    expect(firstNonEmpty).toBe('# 支付链路重构')
  })

  it('纯函数:相同 title 产出相同结果(确定性)', () => {
    expect(generatePrdSkeleton('X')).toBe(generatePrdSkeleton('X'))
  })

  it('空标题仍生成合法骨架(占位 H1)', () => {
    const md = generatePrdSkeleton('')
    expect(md.startsWith('# ')).toBe(true)
    expect(md).toContain('## 验收标准')
  })
})

// ============================================================================
// extractPrdAnchors — 仅 H1 + H2(issue 01 验收 #3)
// ============================================================================

describe('extractPrdAnchors', () => {
  it('空 markdown → 空数组', () => {
    expect(extractPrdAnchors('')).toEqual([])
  })

  it('只返回 H1 / H2,忽略 H3 及更深', () => {
    const md = `# H1
## H2
### H3(忽略)
#### H4(忽略)
## H2-2
`
    expect(extractPrdAnchors(md)).toEqual([
      { level: 1, title: 'H1', line: 0 },
      { level: 2, title: 'H2', line: 1 },
      { level: 2, title: 'H2-2', line: 4 },
    ])
  })

  it('行号 0-based,记录源 Markdown 中实际行号', () => {
    const md = `\n\n# Title\n\n## A\n\n## B\n`
    expect(extractPrdAnchors(md)).toEqual([
      { level: 1, title: 'Title', line: 2 },
      { level: 2, title: 'A', line: 4 },
      { level: 2, title: 'B', line: 6 },
    ])
  })

  it('过滤空标题(# 后无文本)', () => {
    const md = `#\n## \n##  保留\n`
    expect(extractPrdAnchors(md)).toEqual([
      { level: 2, title: '保留', line: 2 },
    ])
  })

  it('支持 CRLF 行尾', () => {
    const md = '# T1\r\n## T2\r\n'
    expect(extractPrdAnchors(md)).toEqual([
      { level: 1, title: 'T1', line: 0 },
      { level: 2, title: 'T2', line: 1 },
    ])
  })

  it('文本非标题时不误识别(#foo 无空格)', () => {
    expect(extractPrdAnchors('#foo\n> # inside quote\n')).toEqual([])
  })
})

// ============================================================================
// resolveAuxLink — 相对 Markdown 链接解析器(issue 01 验收 #4)
// ============================================================================

describe('resolveAuxLink', () => {
  const auxFiles: AuxFile[] = [
    {
      id: 'a1',
      filename: 'api-spec.md',
      body: '# API',
      usage_tag: 'api',
      source_format: 'md',
      converted_to_md: false,
    },
    {
      id: 'a2',
      filename: 'refund-flow.md',
      body: '## refund',
      usage_tag: 'data',
      source_format: 'md',
      converted_to_md: false,
    },
    {
      id: 'a3',
      filename: 'docx-input.docx',
      body: 'converted',
      usage_tag: 'sop',
      source_format: 'docx',
      converted_to_md: true,
    },
  ]

  it('合法相对路径 → 返回对应 AuxFile', () => {
    expect(resolveAuxLink('PRD.md', 'api-spec.md', auxFiles)?.id).toBe('a1')
    expect(resolveAuxLink('PRD.md', 'refund-flow.md', auxFiles)?.id).toBe('a2')
  })

  it('目标指向非 Markdown 文件 → null', () => {
    expect(resolveAuxLink('PRD.md', 'docx-input.docx', auxFiles)).toBeNull()
  })

  it('未知文件名 → null', () => {
    expect(resolveAuxLink('PRD.md', 'ghost.md', auxFiles)).toBeNull()
  })

  it('fragment-only 目标(#section)→ null', () => {
    expect(resolveAuxLink('PRD.md', '#section', auxFiles)).toBeNull()
  })

  it('外部 URL(http / mailto)→ null', () => {
    expect(resolveAuxLink('PRD.md', 'https://example.com/x.md', auxFiles)).toBeNull()
    expect(resolveAuxLink('PRD.md', 'http://x', auxFiles)).toBeNull()
    expect(resolveAuxLink('PRD.md', 'mailto:a@b.c', auxFiles)).toBeNull()
  })

  it('.. 路径穿越 → null', () => {
    expect(resolveAuxLink('PRD.md', '../etc/passwd', auxFiles)).toBeNull()
    expect(resolveAuxLink('PRD.md', '../../refund-flow.md', auxFiles)).toBeNull()
    expect(resolveAuxLink('PRD.md', 'subdir/../../../refund-flow.md', auxFiles)).toBeNull()
    // 任何路径段含 `..` 都拒绝(避免"先下后回"的语义歧义)
    expect(resolveAuxLink('PRD.md', 'subdir/../api-spec.md', auxFiles)).toBeNull()
  })

  it('绝对路径(以 / 开头)→ null(只允许相对路径)', () => {
    expect(resolveAuxLink('PRD.md', '/etc/passwd', auxFiles)).toBeNull()
    expect(resolveAuxLink('PRD.md', '/refund-flow.md', auxFiles)).toBeNull()
  })

  it('target 为空字符串 → null', () => {
    expect(resolveAuxLink('PRD.md', '', auxFiles)).toBeNull()
  })

  it('currentFile 不参与匹配(currentFile 在 PRD 解析时无需指定)', () => {
    // currentFile 形参仅保留为语义接口,不参与路径匹配;任意 currentFile 都应得到同样结果
    expect(resolveAuxLink('whatever.md', 'api-spec.md', auxFiles)?.id).toBe('a1')
    expect(resolveAuxLink('', 'api-spec.md', auxFiles)?.id).toBe('a1')
  })
})

// ============================================================================
// validateLaunch — 启动校验(issue 01 验收 #5)
// ============================================================================

describe('validateLaunch', () => {
  it('trim 后 title 非空 + PRD 有非空白内容 → canLaunch=true', () => {
    expect(
      validateLaunch({ title: '退款功能优化', prdMarkdown: '# PRD' }).canLaunch,
    ).toBe(true)
  })

  it('title 仅有空白 → canLaunch=false', () => {
    expect(validateLaunch({ title: '   \t\n', prdMarkdown: '# PRD' }).canLaunch).toBe(
      false,
    )
  })

  it('title 为空 → canLaunch=false', () => {
    expect(validateLaunch({ title: '', prdMarkdown: '# PRD' }).canLaunch).toBe(false)
  })

  it('PRD 仅空白 → canLaunch=false', () => {
    expect(
      validateLaunch({ title: 't', prdMarkdown: '   \n\t  ' }).canLaunch,
    ).toBe(false)
  })

  it('PRD 为空 → canLaunch=false', () => {
    expect(validateLaunch({ title: 't', prdMarkdown: '' }).canLaunch).toBe(false)
  })

  it('title 与 PRD 均通过 → canLaunch=true', () => {
    expect(
      validateLaunch({ title: 't', prdMarkdown: 'p' }).canLaunch,
    ).toBe(true)
  })

  it('不依赖 auxFiles / repos(纯函数,接口最小)', () => {
    // 仅依赖 title + prdMarkdown 两个字段;允许调用方传空对象 / 额外字段忽略
    const r = validateLaunch({ title: 't', prdMarkdown: 'p' })
    expect(r.canLaunch).toBe(true)
  })

  it('返回 LaunchValidity 接口(不依赖 repos / aux_files)', () => {
    const r = validateLaunch({ title: 't', prdMarkdown: 'p' })
    expect(typeof r.canLaunch).toBe('boolean')
  })
})

// ============================================================================
// mockConvertToMarkdown — mock 转换器(issue 01 验收 #6)
// ============================================================================

describe('mockConvertToMarkdown', () => {
  it('.md 输入 → 返回原内容 + converted_to_md=false', () => {
    const r = mockConvertToMarkdown({ filename: 'a.md', content: '# Hello' })
    expect(r.body).toContain('# Hello')
    expect(r.source_format).toBe('md')
    expect(r.converted_to_md).toBe(false)
  })

  it('.docx 输入 → 返回 deterministic Markdown + converted_to_md=true', () => {
    const r = mockConvertToMarkdown({
      filename: 'spec.docx',
      content: 'binary-buffer',
    })
    expect(r.body).toMatch(/^# /) // 含 H1 标题
    expect(r.source_format).toBe('docx')
    expect(r.converted_to_md).toBe(true)
  })

  it('.pdf 输入 → converted_to_md=true', () => {
    const r = mockConvertToMarkdown({ filename: 'manual.pdf', content: '%PDF-1.4' })
    expect(r.source_format).toBe('pdf')
    expect(r.converted_to_md).toBe(true)
  })

  it('相同输入产出相同输出(deterministic)', () => {
    const a = mockConvertToMarkdown({ filename: 'x.docx', content: 'same' })
    const b = mockConvertToMarkdown({ filename: 'x.docx', content: 'same' })
    expect(a.body).toBe(b.body)
  })

  it('.docx 输出含 filename 提示信息(便于追溯源文件)', () => {
    const r = mockConvertToMarkdown({
      filename: 'refund-flow.docx',
      content: 'anything',
    })
    expect(r.body).toContain('refund-flow')
  })

  it('不支持的扩展名抛错(明确错误,便于上层兜底)', () => {
    expect(() =>
      mockConvertToMarkdown({ filename: 'x.txt', content: 'x' }),
    ).toThrow(/unsupported/i)
    expect(() =>
      mockConvertToMarkdown({ filename: 'x.xlsx', content: 'x' }),
    ).toThrow(/unsupported/i)
  })
})