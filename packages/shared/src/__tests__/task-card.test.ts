/**
 * TaskCard 共享契约测试 — issue 01 / ADR-0024
 */

import { describe, expect, it } from 'vitest'
import {
  TASK_CARD_ID_RE,
  TaskCardPriority,
  TaskCardSchema,
  TaskCardSource,
  TaskCardStatus,
} from '../task-card.js'

const validTaskCard = {
  id: '01J7X3K2P5EVR0Z3YQJD8HFKXA',
  parent_id: 'req-001-refund',
  status: 'in_progress',
  title: '开发退款接口',
  content: '实现退款服务的 HTTP 接口。',
  priority: 'high',
  assignee: 'user-123',
  labels: ['backend', 'refund'],
  depends_on: ['01J7X3K2P5EVR0Z3YQJD8HFKYB'],
  order_index: 2,
  source: 'prd_split',
  is_archived: false,
  created_at: '2026-08-06T08:00:00.000Z',
  updated_at: '2026-08-06T09:00:00.000Z',
  completed_at: null,
} as const

/**
 * 用 `validTaskCard` 作为基线，覆盖指定字段（其余字段保留）。
 * helper 替用例屏蔽 "先解构再 void" 的 lint 模板。
 */
function patch(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...validTaskCard, ...overrides }
}

/** 删除一个必填字段后用于 "缺必填" 反例。 */
function omitField<K extends keyof typeof validTaskCard>(key: K): Record<string, unknown> {
  const { [key]: _drop, ...rest } = validTaskCard
  void _drop
  return rest
}

// ---------------------------------------------------------------------------
// 正例
// ---------------------------------------------------------------------------

describe('TaskCardSchema — issue 01', () => {
  it('accepts a complete TaskCard', () => {
    const result = TaskCardSchema.safeParse(validTaskCard)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(validTaskCard)
  })

  it('defaults the 8 cold fields when only the required ones are provided', () => {
    const result = TaskCardSchema.safeParse({
      id: '01J7X3K2P5EVR0Z3YQJD8HFKXA',
      title: '草稿卡片',
      created_at: '2026-08-06T08:00:00.000Z',
      updated_at: '2026-08-06T08:00:00.000Z',
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.parent_id).toBe(null)
    expect(result.data.status).toBe('backlog')
    expect(result.data.content).toBe('')
    expect(result.data.priority).toBe(null)
    expect(result.data.assignee).toBe(null)
    expect(result.data.labels).toEqual([])
    expect(result.data.depends_on).toEqual([])
    expect(result.data.order_index).toBe(null)
    expect(result.data.source).toBe('manual')
    expect(result.data.is_archived).toBe(false)
    expect(result.data.completed_at).toBe(null)
  })

  it('trims the title before length check', () => {
    const result = TaskCardSchema.safeParse(patch({ title: '  退款服务  ' }))

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.title).toBe('退款服务')
  })
})

// ---------------------------------------------------------------------------
// 必填与字段级报错
// ---------------------------------------------------------------------------

describe('TaskCardSchema — required fields', () => {
  it.each([
    ['id', 'id must be a 26-character ULID'],
    ['title', 'title must not be empty'],
  ] as const)('rejects missing %s with a field-level path', (field, hint) => {
    void hint
    const result = TaskCardSchema.safeParse(omitField(field))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map((i) => i.path[0])).toContain(field)
  })

  it('rejects whitespace-only title', () => {
    const result = TaskCardSchema.safeParse(patch({ title: '   \t  ' }))
    expect(result.success).toBe(false)
  })

  it('rejects missing created_at / updated_at', () => {
    const { created_at: _c, updated_at: _u, ...rest } = validTaskCard
    void _c
    void _u
    const result = TaskCardSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ULID 校验
// ---------------------------------------------------------------------------

describe('TASK_CARD_ID_RE', () => {
  it('matches a 26-character Crockford Base32 string', () => {
    expect(TASK_CARD_ID_RE.test('01J7X3K2P5EVR0Z3YQJD8HFKXA')).toBe(true)
  })

  it('rejects ids shorter than 26 characters', () => {
    const result = TaskCardSchema.safeParse(
      patch({ id: '01J7X3K2P5EVR0Z3YQJD8HFKX' }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects ids longer than 26 characters', () => {
    const result = TaskCardSchema.safeParse(
      patch({ id: '01J7X3K2P5EVR0Z3YQJD8HFKXAA' }),
    )
    expect(result.success).toBe(false)
  })

  it.each([
    ['I', 'I1J7X3K2P5EVR0Z3YQJD8HFKX'],
    ['L', '01J7X3K2L5EVR0Z3YQJD8HFKX'],
    ['O', '01J7X3K2O5EVR0Z3YQJD8HFKX'],
    ['U', '01J7X3K2U5EVR0Z3YQJD8HFKX'],
  ])('rejects ids containing excluded character %s', (_label, id) => {
    const result = TaskCardSchema.safeParse(patch({ id }))
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 枚举校验
// ---------------------------------------------------------------------------

describe('TaskCardSchema — enums', () => {
  it.each([
    ['status', Object.values(TaskCardStatus)],
    ['source', Object.values(TaskCardSource)],
    ['priority', Object.values(TaskCardPriority)],
  ] as const)('accepts every TaskCard%s value', (field, values) => {
    for (const value of values) {
      const result = TaskCardSchema.safeParse(patch({ [field]: value }))
      expect(result.success).toBe(true)
    }
  })

  it.each([
    ['status', 'frozen'],
    ['source', 'auto'],
    ['priority', 'critical'],
  ] as const)('rejects unknown %s with a field-level path', (field, value) => {
    const result = TaskCardSchema.safeParse(patch({ [field]: value }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path[0]).toBe(field)
  })
})

// ---------------------------------------------------------------------------
// Markdown content 安全
// ---------------------------------------------------------------------------

describe('TaskCardSchema — content safety', () => {
  it.each([
    ['<script>alert(1)</script>', 'script tag'],
    ['<img src="x" onerror="alert(1)" />', 'event handler'],
    ['<iframe src="https://evil"></iframe>', 'iframe tag'],
    ['[click](javascript:alert(1))', 'javascript: protocol'],
    ['![inline](data:text/html,<script>alert(1)</script>)', 'data: protocol'],
  ])('rejects unsafe content: %s (%s)', (content) => {
    const result = TaskCardSchema.safeParse(patch({ content }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path[0]).toBe('content')
  })

  it('accepts safe markdown with images and code', () => {
    const result = TaskCardSchema.safeParse(
      patch({
        content: '实现步骤：\n\n```ts\nconst x = 1\n```\n\n![流程](https://example.com/flow.png)',
      }),
    )
    expect(result.success).toBe(true)
  })
})
