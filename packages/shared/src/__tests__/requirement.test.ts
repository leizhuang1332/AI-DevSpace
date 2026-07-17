/**
 * 共享 requirement 契约测试 — issue 04
 *
 * 覆盖:
 * - `slugify()` —— PRD §8.3 锁定的 8 步规则
 * - `parseRequirementSeq()` —— 从 id 反解 NNN
 * - `CreateRequirementRequestSchema` —— trim + 长度 1-50
 * - `CreateRequirementResponseSchema` —— id regex + title + ISO 时间戳
 * - `buildRequirementMdTemplate()` —— 空模板结构
 */

import { describe, it, expect } from 'vitest'
import {
  REQUIREMENT_ID_RE,
  REQUIREMENT_SLUG_MAX,
  buildRequirementMdTemplate,
  parseRequirementSeq,
  slugify,
  CreateRequirementRequestSchema,
  CreateRequirementResponseSchema,
  RequirementErrorCode,
} from '../requirement.js'

// ============================================================================
// slugify —— PRD §8.3
// ============================================================================

describe('slugify', () => {
  it('中文 title → 中文 slug(\p{L} 保留)', () => {
    expect(slugify('退款功能优化')).toBe('退款功能优化')
  })

  it('中英混排 + 路径非法字符', () => {
    // `退款/优化!` → 路径非法字符 / 与 ! 全部 strip → `退款优化`
    expect(slugify('退款/优化!')).toBe('退款优化')
  })

  it('英文标题 + 标点 → kebab-case', () => {
    expect(slugify('Order Refund V2!')).toBe('order-refund-v2')
  })

  it('多个空白 + 全角空格 → 单 -', () => {
    expect(slugify('  测试 / 边界  ')).toBe('测试-边界')
  })

  it('全角空格 → -', () => {
    expect(slugify('foo　bar')).toBe('foo-bar')
  })

  it('路径非法字符 \\ : * ? " < > | → 删除', () => {
    expect(slugify('a\\b:c*d?e"f<g>h|i')).toBe('abcdefghi')
  })

  it('非允许字符 @#$ → 删除', () => {
    expect(slugify('foo@bar#baz$qux')).toBe('foobarbazqux')
  })

  it('保留 _ 和 .', () => {
    expect(slugify('foo_bar.baz')).toBe('foo_bar.baz')
  })

  it('多个连续 - 合并', () => {
    expect(slugify('foo---bar')).toBe('foo-bar')
  })

  it('首尾 - 去掉', () => {
    expect(slugify('---foo---')).toBe('foo')
  })

  it('50+ 字 → 截断到 50', () => {
    const long = 'a'.repeat(60)
    const result = slugify(long)
    expect(result.length).toBe(REQUIREMENT_SLUG_MAX)
  })

  it('空字符串 → untitled fallback', () => {
    expect(slugify('')).toBe('untitled')
  })

  it('纯非法字符 → untitled fallback', () => {
    expect(slugify('\\:*?"<>|')).toBe('untitled')
  })

  it('纯空白 → untitled fallback', () => {
    expect(slugify('   ')).toBe('untitled')
  })

  it('纯全角空格 → untitled fallback', () => {
    expect(slugify('　　　')).toBe('untitled')
  })

  it('全大写 → 全小写', () => {
    expect(slugify('FooBar')).toBe('foobar')
  })

  it('纯数字 title 保留为 slug', () => {
    expect(slugify('12345')).toBe('12345')
  })

  it('中英数字混排', () => {
    expect(slugify('退款 v2 (Beta)')).toBe('退款-v2-beta')
  })
})

// ============================================================================
// parseRequirementSeq —— 从 id 反解 NNN
// ============================================================================

describe('parseRequirementSeq', () => {
  it('3 位 NNN', () => {
    expect(parseRequirementSeq('req-001-退款功能')).toBe(1)
    expect(parseRequirementSeq('req-999-退款功能')).toBe(999)
  })

  it('> 3 位 NNN', () => {
    expect(parseRequirementSeq('req-1234-退款功能')).toBe(1234)
  })

  it('id 不匹配格式 → null', () => {
    expect(parseRequirementSeq('REQ-001-x')).toBe(null) // 大写
    expect(parseRequirementSeq('req-001')).toBe(null) // 无 slug
    expect(parseRequirementSeq('req-001-')).toBe(null) // 空 slug
    expect(parseRequirementSeq('xxx-001-y')).toBe(null) // 前缀错
    expect(parseRequirementSeq('random-string')).toBe(null)
  })

  it('NNN 部分非数字 → null', () => {
    expect(parseRequirementSeq('req-abc-foo')).toBe(null)
  })

  it('slug 含非法字符 → null', () => {
    expect(parseRequirementSeq('req-001-Foo Bar')).toBe(null) // 含空格
    expect(parseRequirementSeq('req-001-Foo!')).toBe(null) // 含 !
  })

  it('slug 以 - 开头 → null(避免歧义)', () => {
    expect(parseRequirementSeq('req-001--foo')).toBe(null)
  })
})

// ============================================================================
// REQUIREMENT_ID_RE
// ============================================================================

describe('REQUIREMENT_ID_RE', () => {
  it('matches valid ids', () => {
    expect(REQUIREMENT_ID_RE.test('req-001-foo')).toBe(true)
    expect(REQUIREMENT_ID_RE.test('req-999-退款功能')).toBe(true)
    expect(REQUIREMENT_ID_RE.test('req-1234-foo_bar.baz')).toBe(true)
  })

  it('rejects invalid ids', () => {
    expect(REQUIREMENT_ID_RE.test('REQ-001-foo')).toBe(false) // 大写
    expect(REQUIREMENT_ID_RE.test('req-001-')).toBe(false) // 空 slug
    expect(REQUIREMENT_ID_RE.test('req-001-Foo Bar')).toBe(false) // 空格
    expect(REQUIREMENT_ID_RE.test('req-001-Foo!')).toBe(false) // 标点
  })
})

// ============================================================================
// CreateRequirementRequestSchema —— title 校验
// ============================================================================

describe('CreateRequirementRequestSchema', () => {
  it('accepts valid title', () => {
    const r = CreateRequirementRequestSchema.safeParse({ title: '退款功能' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.title).toBe('退款功能')
  })

  it('trims whitespace before length check', () => {
    const r = CreateRequirementRequestSchema.safeParse({ title: '  退款  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.title).toBe('退款')
  })

  it('rejects empty title after trim', () => {
    const r = CreateRequirementRequestSchema.safeParse({ title: '   \t  ' })
    expect(r.success).toBe(false)
  })

  it('rejects empty string', () => {
    const r = CreateRequirementRequestSchema.safeParse({ title: '' })
    expect(r.success).toBe(false)
  })

  it('rejects > 50 chars', () => {
    const r = CreateRequirementRequestSchema.safeParse({ title: 'a'.repeat(51) })
    expect(r.success).toBe(false)
  })

  it('accepts exactly 50 chars', () => {
    const r = CreateRequirementRequestSchema.safeParse({ title: 'a'.repeat(50) })
    expect(r.success).toBe(true)
  })

  it('rejects missing title', () => {
    const r = CreateRequirementRequestSchema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('rejects non-string title', () => {
    const r = CreateRequirementRequestSchema.safeParse({ title: 123 })
    expect(r.success).toBe(false)
  })
})

// ============================================================================
// CreateRequirementResponseSchema —— 201 响应
// ============================================================================

describe('CreateRequirementResponseSchema', () => {
  it('accepts valid response', () => {
    const r = CreateRequirementResponseSchema.safeParse({
      id: 'req-001-退款功能',
      title: '退款功能',
      createdAt: '2026-07-17T05:42:23.169Z',
    })
    expect(r.success).toBe(true)
  })

  it('rejects id not matching pattern', () => {
    const r = CreateRequirementResponseSchema.safeParse({
      id: 'REQ-001-x',
      title: 'x',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing createdAt', () => {
    const r = CreateRequirementResponseSchema.safeParse({
      id: 'req-001-x',
      title: 'x',
    })
    expect(r.success).toBe(false)
  })
})

// ============================================================================
// buildRequirementMdTemplate
// ============================================================================

describe('buildRequirementMdTemplate', () => {
  it('produces # <title> + placeholder', () => {
    const md = buildRequirementMdTemplate('退款功能')
    expect(md).toContain('# 退款功能')
    expect(md).toContain('DRAFTING')
  })

  it('empty title → placeholder "未命名需求"', () => {
    const md = buildRequirementMdTemplate('')
    expect(md).toContain('# 未命名需求')
  })

  it('whitespace-only title → placeholder', () => {
    const md = buildRequirementMdTemplate('   ')
    expect(md).toContain('# 未命名需求')
  })

  it('template ends with newline', () => {
    const md = buildRequirementMdTemplate('foo')
    expect(md.endsWith('\n')).toBe(true)
  })

  it('contains HTML-style comment hint', () => {
    const md = buildRequirementMdTemplate('foo')
    expect(md).toMatch(/<!--[\s\S]+-->/)
  })
})

// ============================================================================
// RequirementErrorCode —— 错误码常量
// ============================================================================

describe('RequirementErrorCode', () => {
  it('exposes expected codes', () => {
    expect(RequirementErrorCode.E_AUTH).toBe('E_AUTH')
    expect(RequirementErrorCode.E_INVALID_TITLE).toBe('E_INVALID_TITLE')
    expect(RequirementErrorCode.E_ID_COLLISION).toBe('E_ID_COLLISION')
    expect(RequirementErrorCode.E_DISK_FULL).toBe('E_DISK_FULL')
    expect(RequirementErrorCode.E_NETWORK).toBe('E_NETWORK')
    expect(RequirementErrorCode.E_INTERNAL).toBe('E_INTERNAL')
  })
})