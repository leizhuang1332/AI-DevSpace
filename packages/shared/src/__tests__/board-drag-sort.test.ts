/**
 * board 拖拽排序算法测试 — issue 19 / ADR-0035 D2
 *
 * 覆盖:
 * - `computeOrderIndex` 前后卡中位
 * - `computeOrderIndexForHead / ForTail / ForEmptyColumn` 三边界
 * - 精度耗尽 < 1e-6 抛 `IndexPrecisionExhaustedError`
 * - prev > next 抛 `RangeError`
 * - `sortByOrderIndex` order_index asc + null last + updated_at desc
 * - `rankInColumn` 1-indexed 位置
 * - `computeOrderIndexForHead(0)` / `ForTail(0)` 抛 RangeError(空列边界)
 */

import { describe, expect, it } from 'vitest'
import {
  computeOrderIndex,
  computeOrderIndexForEmptyColumn,
  computeOrderIndexForHead,
  computeOrderIndexForTail,
  INDEX_PRECISION_EXHAUSTED,
  IndexPrecisionExhaustedError,
  rankInColumn,
  sortByOrderIndex,
} from '../board-drag-sort.js'
import type { TaskCard } from '../task-card.js'

// ---------------------------------------------------------------------------
// 桩构造(test-only,非业务根路径)
// ---------------------------------------------------------------------------

/**
 * 构造一张最小化的 TaskCard 用于排序 / 位置测试。
 * 仅填排序与位置会用到的字段(title 等冗余字段用 `id` 替代,以提升可读性)。
 */
function makeCard(
  id: string,
  orderIndex: number | null,
  updatedAt: string = '2026-08-16T00:00:00.000Z',
): TaskCard {
  return {
    id,
    parent_id: 'req-001',
    status: 'backlog',
    title: `card-${id}`,
    content: '',
    priority: null,
    assignee: null,
    labels: [],
    depends_on: [],
    order_index: orderIndex,
    source: 'manual',
    is_archived: false,
    created_at: updatedAt,
    updated_at: updatedAt,
    completed_at: null,
  }
}

// ---------------------------------------------------------------------------
// computeOrderIndex
// ---------------------------------------------------------------------------

describe('computeOrderIndex — issue 19 / ADR-0035 D2', () => {
  it('returns midpoint of prev and next', () => {
    expect(computeOrderIndex(1, 3)).toBe(2)
    expect(computeOrderIndex(0, 4)).toBe(2)
    expect(computeOrderIndex(2.5, 7.5)).toBe(5)
  })

  it('handles prev === next === 0 — gap = 0 → precision exhausted', () => {
    expect(() => computeOrderIndex(0, 0)).toThrow(IndexPrecisionExhaustedError)
  })

  it('throws RangeError when prev > next', () => {
    expect(() => computeOrderIndex(5, 2)).toThrow(RangeError)
  })

  it('throws IndexPrecisionExhaustedError when gap < 1e-6', () => {
    const gap = INDEX_PRECISION_EXHAUSTED / 2
    expect(() => computeOrderIndex(1, 1 + gap)).toThrow(IndexPrecisionExhaustedError)
  })

  it('accepts gap >= 2 * threshold as comfortable midpoint', () => {
    // 浮点中位法的「可工作间隙」下限;2x 阈值避开 JS 双精度 round-off
    // (1 + 1e-6 - 1 在 double64 下可能 < 1e-6,故不测相等边界)
    const midpoint = computeOrderIndex(1, 1 + 2 * INDEX_PRECISION_EXHAUSTED)
    expect(midpoint).toBeCloseTo(1 + INDEX_PRECISION_EXHAUSTED, 12)
  })

  it('preserves prev and next on the error for caller remediation', () => {
    try {
      computeOrderIndex(2.5, 2.5 + INDEX_PRECISION_EXHAUSTED / 2)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(IndexPrecisionExhaustedError)
      const e = err as IndexPrecisionExhaustedError
      expect(e.prev).toBe(2.5)
      expect(e.next).toBeCloseTo(2.5 + INDEX_PRECISION_EXHAUSTED / 2, 12)
    }
  })
})

// ---------------------------------------------------------------------------
// 边界:列头 / 列尾 / 空列
// ---------------------------------------------------------------------------

describe('computeOrderIndexForHead / ForTail / ForEmptyColumn', () => {
  it('head = first / 2', () => {
    expect(computeOrderIndexForHead(10)).toBe(5)
    expect(computeOrderIndexForHead(2)).toBe(1)
  })

  it('head accepts fractional first', () => {
    expect(computeOrderIndexForHead(1.5)).toBe(0.75)
  })

  it('head rejects first <= 0', () => {
    expect(() => computeOrderIndexForHead(0)).toThrow(RangeError)
    expect(() => computeOrderIndexForHead(-1)).toThrow(RangeError)
  })

  it('tail = last + 1', () => {
    expect(computeOrderIndexForTail(10)).toBe(11)
    expect(computeOrderIndexForTail(1.5)).toBe(2.5)
  })

  it('tail rejects last <= 0', () => {
    expect(() => computeOrderIndexForTail(0)).toThrow(RangeError)
    expect(() => computeOrderIndexForTail(-1)).toThrow(RangeError)
  })

  it('empty column starts at 1', () => {
    expect(computeOrderIndexForEmptyColumn()).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// sortByOrderIndex
// ---------------------------------------------------------------------------

describe('sortByOrderIndex — issue 19 / ADR-0035 D2', () => {
  it('orders ascending by order_index', () => {
    const sorted = sortByOrderIndex([
      makeCard('c', 3),
      makeCard('a', 1),
      makeCard('b', 2),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('places null order_index at the tail (列尾追加)', () => {
    const sorted = sortByOrderIndex([
      makeCard('null1', null),
      makeCard('a', 1),
      makeCard('null2', null),
      makeCard('b', 2),
    ])
    // null 排尾部,同 null 之间保持原顺序(stable sort)
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b', 'null1', 'null2'])
  })

  it('tie-breaks by updated_at desc within same order_index', () => {
    const sorted = sortByOrderIndex([
      makeCard('old', 1, '2026-08-16T00:00:00.000Z'),
      makeCard('new', 1, '2026-08-16T01:00:00.000Z'),
      makeCard('mid', 1, '2026-08-16T00:30:00.000Z'),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['new', 'mid', 'old'])
  })

  it('does not mutate the input array', () => {
    const input = [makeCard('c', 3), makeCard('a', 1), makeCard('b', 2)]
    const before = input.map((c) => c.id)
    sortByOrderIndex(input)
    expect(input.map((c) => c.id)).toEqual(before)
  })

  it('handles empty input', () => {
    expect(sortByOrderIndex([])).toEqual([])
  })

  it('handles all-null input (新入列尚未 fill order_index)', () => {
    const sorted = sortByOrderIndex([
      makeCard('a', null),
      makeCard('b', null),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
// rankInColumn
// ---------------------------------------------------------------------------

describe('rankInColumn — issue 19 / ADR-0035 D2', () => {
  it('returns 1-indexed rank among sorted column', () => {
    const cards = [
      makeCard('a', 1),
      makeCard('b', 2),
      makeCard('c', 3),
    ]
    expect(rankInColumn(cards[0]!, cards)).toBe(1)
    expect(rankInColumn(cards[1]!, cards)).toBe(2)
    expect(rankInColumn(cards[2]!, cards)).toBe(3)
  })

  it('handles unsorted input — sort is internal', () => {
    const cards = [
      makeCard('c', 3),
      makeCard('a', 1),
      makeCard('b', 2),
    ]
    expect(rankInColumn(cards[1]!, cards)).toBe(1) // a 在第 1 位
    expect(rankInColumn(cards[2]!, cards)).toBe(2)
    expect(rankInColumn(cards[0]!, cards)).toBe(3)
  })

  it('returns -1 for a card not in the column', () => {
    const cards = [makeCard('a', 1), makeCard('b', 2)]
    const stranger = makeCard('z', 99)
    expect(rankInColumn(stranger, cards)).toBe(-1)
  })

  it('null order_index ranks to tail', () => {
    const cards = [
      makeCard('a', 1),
      makeCard('b', 2),
      makeCard('tail1', null),
      makeCard('tail2', null),
    ]
    expect(rankInColumn(cards[0]!, cards)).toBe(1)
    expect(rankInColumn(cards[1]!, cards)).toBe(2)
    expect(rankInColumn(cards[2]!, cards)).toBe(3)
    expect(rankInColumn(cards[3]!, cards)).toBe(4)
  })

  it('column total matches rankInColumn tail', () => {
    const cards = [makeCard('a', 1), makeCard('b', 2), makeCard('c', 3)]
    for (const card of cards) {
      const rank = rankInColumn(card, cards)
      expect(rank).toBeGreaterThanOrEqual(1)
      expect(rank).toBeLessThanOrEqual(cards.length)
    }
  })
})
