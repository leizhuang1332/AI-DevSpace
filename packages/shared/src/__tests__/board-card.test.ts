/**
 * 共享 board-card 契约测试 —— issue 02 / ADR-0024
 *
 * 覆盖:
 * - `generateTaskCardUlid` 26 字符 Crockford Base32、随时间升序
 * - `BoardCardListFilterSchema` 接受 enum 字段 + label 字符串
 * - `BoardCardCreateRequestSchema` title 必填、content 可选、忽略多余字段
 * - `BoardCardPatchSchema` 白名单字段、refuse 空对象
 * - `REASON_TO_HTTP_STATUS_BOARD` 错误码 → HTTP 状态覆盖
 */

import { describe, expect, it } from 'vitest'
import {
  BoardCardCreateRequestSchema,
  BoardCardListFilterSchema,
  BoardCardPatchSchema,
  REASON_TO_HTTP_STATUS_BOARD,
} from '../board-card.js'
import {
  generateTaskCardUlid,
  TASK_CARD_ID_RE,
  TaskCardPriority,
  TaskCardSource,
  TaskCardStatus,
} from '../task-card.js'

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

describe('generateTaskCardUlid', () => {
  it('emits a 26-character string matching TASK_CARD_ID_RE', () => {
    const id = generateTaskCardUlid()
    expect(id).toHaveLength(26)
    expect(id).toMatch(TASK_CARD_ID_RE)
  })

  it('uses only Crockford Base32 characters (excludes I/L/O/U)', () => {
    const id = generateTaskCardUlid()
    for (const ch of id) {
      expect(ULID_ALPHABET.includes(ch)).toBe(true)
    }
  })

  it('is time-sortable:later timestamp makes the time prefix larger', () => {
    // 用两次不同 now 验证时间戳 prefix 的字典序(随机段不可控,只断言 prefix)
    const t0 = 1_700_000_000_000
    const t1 = t0 + 1
    const id0 = generateTaskCardUlid(t0)
    const id1 = generateTaskCardUlid(t1)
    expect(id0.slice(0, 10) < id1.slice(0, 10)).toBe(true)
  })
})

describe('BoardCardListFilterSchema', () => {
  it('accepts an empty object (no filters → all cards)', () => {
    const r = BoardCardListFilterSchema.parse({})
    expect(r).toEqual({ include_archived: false })
  })

  it('accepts every TaskCardStatus / Priority / Source value', () => {
    for (const status of Object.values(TaskCardStatus)) {
      const r = BoardCardListFilterSchema.parse({ status })
      expect(r.status).toBe(status)
    }
    for (const priority of Object.values(TaskCardPriority)) {
      const r = BoardCardListFilterSchema.parse({ priority })
      expect(r.priority).toBe(priority)
    }
    for (const source of Object.values(TaskCardSource)) {
      const r = BoardCardListFilterSchema.parse({ source })
      expect(r.source).toBe(source)
    }
  })

  it('rejects unknown status', () => {
    expect(() => BoardCardListFilterSchema.parse({ status: 'frozen' })).toThrow()
  })

  it('coerces include_archived=true|false from string', () => {
    expect(BoardCardListFilterSchema.parse({ include_archived: 'true' }).include_archived).toBe(true)
    expect(BoardCardListFilterSchema.parse({ include_archived: 'false' }).include_archived).toBe(false)
  })

  it('rejects include_archived with non-boolean-like string', () => {
    expect(() => BoardCardListFilterSchema.parse({ include_archived: '1' })).toThrow()
  })

  it('accepts a label string', () => {
    const r = BoardCardListFilterSchema.parse({ label: 'backend' })
    expect(r.label).toBe('backend')
  })
})

describe('BoardCardCreateRequestSchema', () => {
  it('requires a non-empty title (after trim)', () => {
    expect(() => BoardCardCreateRequestSchema.parse({ title: '' })).toThrow()
    expect(() => BoardCardCreateRequestSchema.parse({ title: '   ' })).toThrow()
    const r = BoardCardCreateRequestSchema.parse({ title: '  退款  ' })
    expect(r.title).toBe('退款')
  })

  it('defaults content to "" when omitted', () => {
    const r = BoardCardCreateRequestSchema.parse({ title: 'x' })
    expect(r.content).toBe('')
  })

  it('accepts optional priority / assignee / labels / depends_on / order_index', () => {
    const r = BoardCardCreateRequestSchema.parse({
      title: 'x',
      priority: 'high',
      assignee: 'alice',
      labels: ['a', 'b'],
      depends_on: ['01J7X3K2P5EVR0Z3YQJD8HFKXB'],
      order_index: 3,
    })
    expect(r.priority).toBe('high')
    expect(r.labels).toEqual(['a', 'b'])
  })
})

describe('BoardCardPatchSchema', () => {
  it('rejects an empty object (at least one field required)', () => {
    expect(() => BoardCardPatchSchema.parse({})).toThrow()
  })

  it('accepts a single title change', () => {
    const r = BoardCardPatchSchema.parse({ title: '新标题' })
    expect(r.title).toBe('新标题')
  })

  it('trims title and rejects empty after trim', () => {
    const r = BoardCardPatchSchema.parse({ title: '  修后  ' })
    expect(r.title).toBe('修后')
    expect(() => BoardCardPatchSchema.parse({ title: '   ' })).toThrow()
  })

  it('accepts an is_archived toggle', () => {
    const r = BoardCardPatchSchema.parse({ is_archived: true })
    expect(r.is_archived).toBe(true)
  })

  it('accepts setting parent_id to null (unlink)', () => {
    const r = BoardCardPatchSchema.parse({ parent_id: null })
    expect(r.parent_id).toBeNull()
  })

  it('rejects created_at / updated_at / completed_at (not in whitelist)', () => {
    // Zod 严格对象会 strip 未知字段
    const r = BoardCardPatchSchema.parse({
      title: 'x',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as never)
    expect('created_at' in r).toBe(false)
    expect('updated_at' in r).toBe(false)
  })
})

describe('REASON_TO_HTTP_STATUS_BOARD', () => {
  it('maps every reason to a valid {code, status} pair', () => {
    const expected: Record<keyof typeof REASON_TO_HTTP_STATUS_BOARD, number> = {
      'invalid-id': 400,
      'invalid-body': 400,
      'requirement-not-found': 404,
      'card-not-found': 404,
      'internal': 500,
    }
    for (const [reason, status] of Object.entries(expected)) {
      const entry = REASON_TO_HTTP_STATUS_BOARD[reason as keyof typeof REASON_TO_HTTP_STATUS_BOARD]
      expect(entry.status).toBe(status)
      expect(entry.code).toMatch(/^E_/)
    }
  })
})
