/**
 * getBlockers 单测 —— issue 02 / ADR-0036 D2
 *
 * 覆盖:
 * - 子任务命中(`parent_id === cardId`)
 * - 被依赖命中(`depends_on.includes(cardId)`)
 * - archived 卡不计入 blocker(defense-in-depth,沿用 ADR-0025 D6)
 * - 自引用 / 空 / 同时命中
 * - 命中返回结构形态:`{ id, title }[]`
 */

import { describe, expect, it } from 'vitest'
import {
  TaskCardPriority,
  TaskCardSource,
  TaskCardStatus,
  type TaskCard,
} from '@ai-devspace/shared'
import { getBlockers } from '../../services/board/get-blockers.js'

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

const T0 = '2026-08-17T10:00:00.000Z'

function mkCard(overrides: Partial<TaskCard> & { id: string }): TaskCard {
  return {
    id: overrides.id,
    parent_id: overrides.parent_id ?? 'req-001-test',
    status: overrides.status ?? TaskCardStatus.BACKLOG,
    title: overrides.title ?? `card ${overrides.id}`,
    content: overrides.content ?? '',
    priority: overrides.priority ?? null,
    assignee: overrides.assignee ?? null,
    labels: overrides.labels ?? [],
    depends_on: overrides.depends_on ?? [],
    order_index: overrides.order_index ?? null,
    source: overrides.source ?? TaskCardSource.MANUAL,
    is_archived: overrides.is_archived ?? false,
    created_at: overrides.created_at ?? T0,
    updated_at: overrides.updated_at ?? T0,
    completed_at: overrides.completed_at ?? null,
  }
}

const TARGET = '01J7X3K2P5EVR0Z3YQJD8HFKAA'

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

describe('getBlockers', () => {
  it('returns empty blockers when no cards reference the target', () => {
    const cards = [
      mkCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFKBB' }),
      mkCard({ id: '01J7X3K2P5EVR0Z3YQJD8HFKCC' }),
    ]
    const result = getBlockers(cards, TARGET)
    expect(result).toEqual({ subtasks: [], dependents: [] })
  })

  it('returns empty blockers for empty input', () => {
    expect(getBlockers([], TARGET)).toEqual({ subtasks: [], dependents: [] })
  })

  it('finds subtasks where parent_id === cardId', () => {
    const cards = [
      mkCard({ id: TARGET, title: 'target' }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKBB',
        parent_id: TARGET,
        title: '子 A',
      }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKCC',
        parent_id: TARGET,
        title: '子 B',
      }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKDD',
        parent_id: 'req-001-test', // 不命中
        title: '无关',
      }),
    ]
    const result = getBlockers(cards, TARGET)
    expect(result.subtasks.map((s) => s.title).sort()).toEqual(['子 A', '子 B'])
    expect(result.dependents).toEqual([])
    expect(result.subtasks[0]).toEqual({ id: '01J7X3K2P5EVR0Z3YQJD8HFKBB', title: '子 A' })
  })

  it('finds dependents where depends_on includes cardId', () => {
    const cards = [
      mkCard({ id: TARGET, title: 'target' }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKBB',
        depends_on: [TARGET, 'other-id'],
        title: '依赖方 A',
      }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKCC',
        depends_on: [TARGET],
        title: '依赖方 B',
      }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKDD',
        depends_on: ['other-id'], // 不命中
        title: '无关',
      }),
    ]
    const result = getBlockers(cards, TARGET)
    expect(result.dependents.map((d) => d.title).sort()).toEqual(['依赖方 A', '依赖方 B'])
    expect(result.subtasks).toEqual([])
  })

  it('hits both subtasks and dependents simultaneously', () => {
    const cards = [
      mkCard({ id: TARGET, title: 'target' }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKBB',
        parent_id: TARGET,
        title: '子',
      }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKCC',
        depends_on: [TARGET],
        title: '依赖方',
      }),
    ]
    const result = getBlockers(cards, TARGET)
    expect(result.subtasks.map((s) => s.title)).toEqual(['子'])
    expect(result.dependents.map((d) => d.title)).toEqual(['依赖方'])
  })

  it('excludes archived cards from blocker lists (defense-in-depth)', () => {
    const cards = [
      mkCard({ id: TARGET, title: 'target' }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKBB',
        parent_id: TARGET,
        title: '子 archived',
        is_archived: true,
      }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKCC',
        parent_id: TARGET,
        title: '子 active',
      }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKDD',
        depends_on: [TARGET],
        title: '依赖方 archived',
        is_archived: true,
      }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKEE',
        depends_on: [TARGET],
        title: '依赖方 active',
      }),
    ]
    const result = getBlockers(cards, TARGET)
    expect(result.subtasks.map((s) => s.title)).toEqual(['子 active'])
    expect(result.dependents.map((d) => d.title)).toEqual(['依赖方 active'])
  })

  it('treats self-reference: parent_id === cardId on the target itself', () => {
    // 边界场景:cardId 自己有 parent_id === cardId —— 这张 target 自己也是自己的子任务
    // 业务上不会发生(parent_id 一般是 reqId 或另一张卡的 id),但函数行为要明确:
    // target 不出现在 blockers(因为我们只查"其他卡引用 target",不查 target 自己)
    const cards = [
      mkCard({
        id: TARGET,
        title: 'target',
        parent_id: TARGET, // 自引用
      }),
    ]
    const result = getBlockers(cards, TARGET)
    expect(result.subtasks).toEqual([])
    expect(result.dependents).toEqual([])
  })

  it('handles cards with non-matching cardId gracefully', () => {
    // 输入中包含 target 但 cardId 参数不匹配任何卡
    const cards = [mkCard({ id: TARGET, title: 'target' })]
    const result = getBlockers(cards, '01J7X3K2P5EVR0Z3YQJD8HFKZZ')
    expect(result).toEqual({ subtasks: [], dependents: [] })
  })

  it('preserves card.title and card.id in the returned structure', () => {
    const cards = [
      mkCard({ id: TARGET, title: 'target' }),
      mkCard({
        id: '01J7X3K2P5EVR0Z3YQJD8HFKBB',
        parent_id: TARGET,
        title: '子 with special chars 特殊',
        priority: TaskCardPriority.URGENT,
      }),
    ]
    const result = getBlockers(cards, TARGET)
    expect(result.subtasks[0]?.id).toBe('01J7X3K2P5EVR0Z3YQJD8HFKBB')
    expect(result.subtasks[0]?.title).toBe('子 with special chars 特殊')
    // priority / status 等不外泄
    expect(Object.keys(result.subtasks[0] ?? {}).sort()).toEqual(['id', 'title'])
  })
})