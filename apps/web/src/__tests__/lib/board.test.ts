/**
 * board.ts 纯函数测试 — issue 07 / ADR-0027 D3
 *
 * 覆盖:
 * - shortCardId:ULID 末 4 位(显示用短 ID)
 * - summarizeContent:content 首 N 字摘要(默认 80,对齐 ADR-0027 D3)
 * - filterCardsByBoardFilter:4 chip 过滤逻辑(全部 / 我的 / 高优先级 / PRD 拆)
 * - STATUS_COLUMNS:5 列元数据完整性(对照 board-color-options.html 方案 A)
 * - PRIORITY_BADGE / SOURCE_LABEL 映射
 */

import { describe, it, expect } from 'vitest'
import {
  shortCardId,
  summarizeContent,
  filterCardsByBoardFilter,
  STATUS_COLUMNS,
  STATUS_COLUMN_ORDER,
  PRIORITY_BADGE,
  SOURCE_LABEL,
  filterSubtasks,
  filterDependencies,
  filterBlockedBy,
  computeParentProgress,
  formatRelativeTime,
  type BoardFilter,
} from '@/lib/board'
import type { TaskCard } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 工具:构造 TaskCard fixture
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: '01J7X3K2P5EVR0Z3YQJD8HFKX9',
    parent_id: 'req-test',
    status: 'backlog',
    title: '一张测试卡',
    content: '',
    priority: null,
    assignee: null,
    labels: [],
    depends_on: [],
    order_index: null,
    source: 'manual',
    is_archived: false,
    created_at: '2026-08-07T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
    completed_at: null,
    ...overrides,
  }
}

// ============================================================================
// shortCardId
// ============================================================================

describe('shortCardId', () => {
  it('返回 ULID 末 4 位', () => {
    const id = '01J7X3K2P5EVR0Z3YQJD8HFKX9'
    expect(shortCardId(id)).toBe('HFKX9'.slice(-4)) // 末 4 = 'FKX9'
    // 直接断言末 4
    expect(shortCardId('01J7X3K2P5EVR0Z3YQJD8HFKX9')).toBe('FKX9')
  })

  it('短于 4 字符时原样返回', () => {
    expect(shortCardId('AB')).toBe('AB')
  })

  it('空串返回空串(不抛错)', () => {
    expect(shortCardId('')).toBe('')
  })
})

// ============================================================================
// summarizeContent
// ============================================================================

describe('summarizeContent', () => {
  it('短于 max 的 content 原样返回', () => {
    expect(summarizeContent('短文本', 80)).toBe('短文本')
  })

  it('超过 max 截断 + 省略号', () => {
    const long = 'a'.repeat(100)
    const out = summarizeContent(long, 80)
    expect(out.length).toBe(80) // 80 字符,无省略号(简化:直接截断)
    expect(out).toBe('a'.repeat(80))
  })

  it('默认 max=80', () => {
    const long = 'b'.repeat(90)
    expect(summarizeContent(long)).toBe('b'.repeat(80))
  })

  it('空 content 返回空串', () => {
    expect(summarizeContent('')).toBe('')
  })

  it('trim 前后空白', () => {
    expect(summarizeContent('  hello  ', 80)).toBe('hello')
  })

  it('换行折叠为单空格(摘要单行展示)', () => {
    expect(summarizeContent('第一行\n第二行\n第三行', 80)).toBe(
      '第一行 第二行 第三行',
    )
  })
})

// ============================================================================
// filterCardsByBoardFilter
// ============================================================================

describe('filterCardsByBoardFilter', () => {
  const cards: TaskCard[] = [
    makeCard({ id: 'c1', status: 'backlog', priority: 'low', source: 'manual', assignee: 'user-a' }),
    makeCard({ id: 'c2', status: 'todo', priority: 'high', source: 'prd_split', assignee: 'user-b' }),
    makeCard({ id: 'c3', status: 'in_progress', priority: 'urgent', source: 'sub_split', assignee: 'user-a' }),
    makeCard({ id: 'c4', status: 'done', priority: null, source: 'manual', assignee: null }),
  ]

  it("filter='all' 返回全部", () => {
    expect(filterCardsByBoardFilter(cards, 'all')).toHaveLength(4)
  })

  it("filter='mine' 只返 assignee === currentUserId", () => {
    const out = filterCardsByBoardFilter(cards, 'mine', 'user-a')
    expect(out.map((c) => c.id)).toEqual(['c1', 'c3'])
  })

  it("filter='mine' 无 currentUserId → 返回空(assignee 都不匹配 null)", () => {
    expect(filterCardsByBoardFilter(cards, 'mine', undefined)).toHaveLength(0)
  })

  it("filter='high-priority' 只返 priority high/urgent", () => {
    const out = filterCardsByBoardFilter(cards, 'high-priority')
    expect(out.map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it("filter='prd-split' 只返 source prd_split", () => {
    const out = filterCardsByBoardFilter(cards, 'prd-split')
    expect(out.map((c) => c.id)).toEqual(['c2'])
  })

  it('空数组任何 filter 都返空', () => {
    expect(filterCardsByBoardFilter([], 'all')).toHaveLength(0)
    expect(filterCardsByBoardFilter([], 'mine', 'user-a')).toHaveLength(0)
    expect(filterCardsByBoardFilter([], 'high-priority')).toHaveLength(0)
    expect(filterCardsByBoardFilter([], 'prd-split')).toHaveLength(0)
  })

  it('不修改原数组(返回新数组)', () => {
    const original = [...cards]
    filterCardsByBoardFilter(cards, 'high-priority')
    expect(cards).toEqual(original)
  })
})

// ============================================================================
// STATUS_COLUMNS
// ============================================================================

describe('STATUS_COLUMNS', () => {
  it('5 列顺序 = backlog / todo / in_progress / in_review / done', () => {
    expect(STATUS_COLUMN_ORDER).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
    ])
  })

  it('每列有 label + dotColor + nameColor + bgColor + dotHollow 字段', () => {
    for (const status of STATUS_COLUMN_ORDER) {
      const col = STATUS_COLUMNS[status]
      expect(col).toBeDefined()
      expect(col.label).toBeTruthy()
      expect(col.dotColor).toMatch(/^#[0-9a-f]{6}$/i)
      expect(col.nameColor).toMatch(/^#[0-9a-f]{6}$/i)
      expect(col.bgColor).toMatch(/^#[0-9a-f]{6}[0-9a-f]{2}$/i)
      expect(typeof col.dotHollow).toBe('boolean')
    }
  })

  it('backlog dot 实心(dotHollow=false) + 颜色 #94a3b8(方案 A)', () => {
    expect(STATUS_COLUMNS.backlog.dotColor).toBe('#94a3b8')
    expect(STATUS_COLUMNS.backlog.dotHollow).toBe(false)
  })

  it('todo dot 空心(dotHollow=true) + 颜色 #cbd5e1(方案 A)', () => {
    expect(STATUS_COLUMNS.todo.dotColor).toBe('#cbd5e1')
    expect(STATUS_COLUMNS.todo.dotHollow).toBe(true)
  })

  it('in_progress dot #f59e0b / in_review #16a34a / done #3b82f6', () => {
    expect(STATUS_COLUMNS.in_progress.dotColor).toBe('#f59e0b')
    expect(STATUS_COLUMNS.in_review.dotColor).toBe('#16a34a')
    expect(STATUS_COLUMNS.done.dotColor).toBe('#3b82f6')
  })

  it('列名色对照方案 A', () => {
    expect(STATUS_COLUMNS.backlog.nameColor).toBe('#475569')
    expect(STATUS_COLUMNS.todo.nameColor).toBe('#64748b')
    expect(STATUS_COLUMNS.in_progress.nameColor).toBe('#b45309')
    expect(STATUS_COLUMNS.in_review.nameColor).toBe('#15803d')
    expect(STATUS_COLUMNS.done.nameColor).toBe('#1d4ed8')
  })
})

// ============================================================================
// PRIORITY_BADGE / SOURCE_LABEL
// ============================================================================

describe('PRIORITY_BADGE', () => {
  it('4 档优先级 + 无(null)各有 bg/text 色', () => {
    for (const p of ['urgent', 'high', 'medium', 'low'] as const) {
      const badge = PRIORITY_BADGE[p]
      expect(badge.bg).toMatch(/^#/)
      expect(badge.text).toMatch(/^#/)
      expect(badge.label).toBeTruthy()
    }
  })

  it('urgent #fee2e2/#991b1b(对照 HTML :89)', () => {
    expect(PRIORITY_BADGE.urgent).toEqual({
      bg: '#fee2e2',
      text: '#991b1b',
      label: 'Urgent',
    })
  })

  it('high #ffedd5/#9a3412', () => {
    expect(PRIORITY_BADGE.high.bg).toBe('#ffedd5')
    expect(PRIORITY_BADGE.high.text).toBe('#9a3412')
  })

  it('medium #fef3c7/#92400e', () => {
    expect(PRIORITY_BADGE.medium.bg).toBe('#fef3c7')
    expect(PRIORITY_BADGE.medium.text).toBe('#92400e')
  })

  it('low #dbeafe/#1e40af', () => {
    expect(PRIORITY_BADGE.low.bg).toBe('#dbeafe')
    expect(PRIORITY_BADGE.low.text).toBe('#1e40af')
  })
})

describe('SOURCE_LABEL', () => {
  it('prd_split → PRD 拆', () => {
    expect(SOURCE_LABEL.prd_split).toBe('PRD 拆')
  })

  it('sub_split → 子拆', () => {
    expect(SOURCE_LABEL.sub_split).toBe('子拆')
  })

  it('manual → 手动', () => {
    expect(SOURCE_LABEL.manual).toBe('手动')
  })
})

// ============================================================================
// 类型导出 sanity
// ============================================================================

describe('BoardFilter type', () => {
  it('4 个 filter 字面量', () => {
    const filters: BoardFilter[] = ['all', 'mine', 'high-priority', 'prd-split']
    expect(filters).toHaveLength(4)
  })
})

// ============================================================================
// filterSubtasks / filterDependencies / filterBlockedBy (issue 08)
// ============================================================================

describe('filterSubtasks', () => {
  it('返回 parent_id 指向该卡的卡片', () => {
    const parent = makeCard({ id: 'PARENT0000000000000000AA', parent_id: 'req-1' })
    const child1 = makeCard({ id: 'CHILD000000000000000001A', parent_id: 'PARENT0000000000000000AA' })
    const child2 = makeCard({ id: 'CHILD000000000000000002A', parent_id: 'PARENT0000000000000000AA' })
    const other = makeCard({ id: 'OTHER00000000000000000AA', parent_id: 'req-1' })
    const cards = [parent, child1, child2, other]
    expect(filterSubtasks(cards, 'PARENT0000000000000000AA')).toEqual([child1, child2])
  })

  it('无子任务 → 空数组', () => {
    expect(filterSubtasks([], 'nope')).toEqual([])
  })

  it('不改原数组', () => {
    const cards = [makeCard({ parent_id: 'p1' })]
    const snapshot = [...cards]
    filterSubtasks(cards, 'p1')
    expect(cards).toEqual(snapshot)
  })
})

describe('filterDependencies', () => {
  it('返回 depends_on 指向的卡(在列表里 find)', () => {
    const dep1 = makeCard({ id: 'DEP1000000000000000000AA' })
    const dep2 = makeCard({ id: 'DEP2000000000000000000AA' })
    const card = makeCard({ id: 'MAIN000000000000000000AA', depends_on: ['DEP1000000000000000000AA', 'DEP2000000000000000000AA'] })
    expect(filterDependencies([dep1, dep2], card)).toEqual([dep1, dep2])
  })

  it('depends_on 里的 id 找不到 → 跳过(返回空)', () => {
    const dep1 = makeCard({ id: 'DEP1000000000000000000AA' })
    const missing = makeCard({ id: 'MAIN000000000000000000AA', depends_on: ['NOPE'] })
    // 'NOPE' 不在 [dep1] 里 → 过滤后空数组
    expect(filterDependencies([dep1], missing)).toEqual([])
  })

  it('空 depends_on → 空数组', () => {
    const card = makeCard({ depends_on: [] })
    expect(filterDependencies([], card)).toEqual([])
  })
})

describe('filterBlockedBy', () => {
  it('返回 depends_on 含本卡 id 的卡(反向:谁依赖我)', () => {
    const me = makeCard({ id: 'ME00000000000000000000AA' })
    const blocked1 = makeCard({ id: 'BLK1000000000000000000AA', depends_on: ['ME00000000000000000000AA'] })
    const blocked2 = makeCard({ id: 'BLK2000000000000000000AA', depends_on: ['ME00000000000000000000AA', 'other'] })
    const unrelated = makeCard({ id: 'UNRL00000000000000000AAA', depends_on: ['other'] })
    const cards = [me, blocked1, blocked2, unrelated]
    expect(filterBlockedBy(cards, 'ME00000000000000000000AA')).toEqual([blocked1, blocked2])
  })
})

describe('computeParentProgress', () => {
  it('done 卡数 / 活跃卡总数', () => {
    const cards = [
      makeCard({ id: 'a', status: 'done', is_archived: false }),
      makeCard({ id: 'b', status: 'done', is_archived: false }),
      makeCard({ id: 'c', status: 'in_progress', is_archived: false }),
      makeCard({ id: 'd', status: 'backlog', is_archived: false }),
    ]
    expect(computeParentProgress(cards)).toEqual({ done: 2, total: 4 })
  })

  it('archived 卡不计入总数', () => {
    const cards = [
      makeCard({ id: 'a', status: 'done', is_archived: false }),
      makeCard({ id: 'b', status: 'done', is_archived: true }),
      makeCard({ id: 'c', status: 'backlog', is_archived: false }),
    ]
    expect(computeParentProgress(cards)).toEqual({ done: 1, total: 2 })
  })

  it('空列表 → {done:0, total:0}', () => {
    expect(computeParentProgress([])).toEqual({ done: 0, total: 0 })
  })
})

describe('formatRelativeTime', () => {
  it('< 1 分钟 → 刚刚', () => {
    const iso = new Date(Date.now() - 10_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('刚刚')
  })

  it('< 1 小时 → N 分钟前', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('5 分钟前')
  })

  it('< 24 小时 → N 小时前', () => {
    const iso = new Date(Date.now() - 3 * 3_600_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('3 小时前')
  })

  it('>= 24 小时 → N 天前', () => {
    const iso = new Date(Date.now() - 2 * 86_400_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('2 天前')
  })

  it('解析失败 → 原样返回', () => {
    expect(formatRelativeTime('not-a-date')).toBe('not-a-date')
  })

  it('未来时间 → 原样返回(防御性)', () => {
    const iso = new Date(Date.now() + 86_400_000).toISOString()
    expect(formatRelativeTime(iso)).toBe(iso)
  })
})
