/**
 * StatusConstraintGuard 单元测试 —— issue 03 / ADR-0025
 *
 * 覆盖(issue 03 ticket 6):
 * - 3 条规则的正常命中 / 不命中
 *   - 父 implementing → 子 backlog 命中;子无 backlog 通过
 *   - 父 submitting → 子 in_progress 命中;子无 in_progress 通过
 *   - 父 done → 所有非 archived 子必须 done(否则冲突)
 * - 反向不约束(ADR-0025 D3):
 *   - 子 status 变化**不会**触发 Guard 自动改父 status
 *   - 父 status 不在关键值(draft / drafting / analyzing / planning / archived)→ 永远 ok
 * - archived 卡不参与约束(ADR-0025 D6)
 * - simulatedChange:模拟本卡切到新 status 后跑校验
 */

import { describe, expect, it } from 'vitest'
import {
  RequirementStatus,
  TaskCardStatus,
  type TaskCard,
  type TaskCardStatusT,
} from '@ai-devspace/shared'
import { checkStatusConstraint } from '../../services/board/StatusConstraintGuard.js'

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

const BASE_TIME = '2026-08-06T08:00:00.000Z'

function card(
  id: string,
  status: TaskCardStatusT,
  overrides: Partial<TaskCard> = {},
): TaskCard {
  return {
    id,
    parent_id: 'req-001',
    status,
    title: `card ${id}`,
    content: '',
    priority: null,
    assignee: null,
    labels: [],
    depends_on: [],
    order_index: null,
    source: 'manual',
    is_archived: false,
    created_at: BASE_TIME,
    updated_at: BASE_TIME,
    completed_at: null,
    ...overrides,
  }
}

const BACKLOG_A = card('01J7X3K2P5EVR0Z3YQJD8HFKAA', TaskCardStatus.BACKLOG)
const BACKLOG_B = card('01J7X3K2P5EVR0Z3YQJD8HFKBX', TaskCardStatus.BACKLOG)
const TODO_A = card('01J7X3K2P5EVR0Z3YQJD8HFKCC', TaskCardStatus.TODO)
const IN_PROGRESS_A = card(
  '01J7X3K2P5EVR0Z3YQJD8HFKDD',
  TaskCardStatus.IN_PROGRESS,
)
const IN_PROGRESS_B = card(
  '01J7X3K2P5EVR0Z3YQJD8HFKXX',
  TaskCardStatus.IN_PROGRESS,
)
const IN_REVIEW_A = card(
  '01J7X3K2P5EVR0Z3YQJD8HFKEE',
  TaskCardStatus.IN_REVIEW,
)
const DONE_A = card('01J7X3K2P5EVR0Z3YQJD8HFKFF', TaskCardStatus.DONE)

// ---------------------------------------------------------------------------
// Rule 1 — implementing 需子无 backlog
// ---------------------------------------------------------------------------

describe('checkStatusConstraint — implementing rule', () => {
  it('returns ok when no non-archived backlog cards exist', () => {
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.IMPLEMENTING,
      cards: [TODO_A, IN_PROGRESS_A, IN_REVIEW_A, DONE_A],
    })
    expect(result.ok).toBe(true)
  })

  it('flags every backlog card as a conflict', () => {
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.IMPLEMENTING,
      cards: [BACKLOG_A, BACKLOG_B, IN_PROGRESS_A, DONE_A],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.conflicts).toHaveLength(2)
    expect(result.conflicts.map((c) => c.card_id).sort()).toEqual([
      BACKLOG_A.id,
      BACKLOG_B.id,
    ])
    expect(result.conflicts.every((c) => c.rule === 'no_backlog_for_implementing')).toBe(true)
  })

  it('self-filters archived cards (ADR-0025 D6 defense-in-depth)', () => {
    // 即使 caller 误传 archived 卡,Guard 也按 `is_archived=true` 剔除;
    // 防止 archived backlog 被误报为冲突。
    const archivedBacklog = card(BACKLOG_A.id, TaskCardStatus.BACKLOG, {
      is_archived: true,
    })
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.IMPLEMENTING,
      cards: [archivedBacklog, IN_PROGRESS_A, DONE_A],
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rule 2 — submitting 需子无 in_progress
// ---------------------------------------------------------------------------

describe('checkStatusConstraint — submitting rule', () => {
  it('returns ok when no non-archived in_progress cards exist', () => {
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.SUBMITTING,
      cards: [BACKLOG_A, TODO_A, IN_REVIEW_A, DONE_A],
    })
    expect(result.ok).toBe(true)
  })

  it('flags in_progress cards as conflicts', () => {
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.SUBMITTING,
      cards: [BACKLOG_A, IN_PROGRESS_A, DONE_A],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.conflicts).toEqual([
      {
        card_id: IN_PROGRESS_A.id,
        card_status: TaskCardStatus.IN_PROGRESS,
        rule: 'no_in_progress_for_submitting',
      },
    ])
  })

  it('self-filters archived cards on submitting rule (ADR-0025 D6 defense-in-depth)', () => {
    const archivedInProgress = card(IN_PROGRESS_A.id, TaskCardStatus.IN_PROGRESS, {
      is_archived: true,
    })
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.SUBMITTING,
      cards: [BACKLOG_A, archivedInProgress, DONE_A],
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rule 3 — done 需所有非 archived 子都 done
// ---------------------------------------------------------------------------

describe('checkStatusConstraint — done rule', () => {
  it('returns ok when every non-archived card is done', () => {
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.DONE,
      cards: [DONE_A],
    })
    expect(result.ok).toBe(true)
  })

  it('returns ok for an empty requirement (no cards yet)', () => {
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.DONE,
      cards: [],
    })
    expect(result.ok).toBe(true)
  })

  it('flags every non-done non-archived card as a conflict', () => {
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.DONE,
      cards: [DONE_A, BACKLOG_A, IN_PROGRESS_A],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.conflicts.map((c) => c.card_id).sort()).toEqual([
      BACKLOG_A.id,
      IN_PROGRESS_A.id,
    ])
    expect(
      result.conflicts.every((c) => c.rule === 'all_done_for_parent_done'),
    ).toBe(true)
  })

  it('self-filters archived cards on done rule (ADR-0025 D6 defense-in-depth)', () => {
    const archivedTodo = card(TODO_A.id, TaskCardStatus.TODO, {
      is_archived: true,
    })
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.DONE,
      cards: [DONE_A, archivedTodo],
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 反向不约束(ADR-0025 D3)
// ---------------------------------------------------------------------------

describe('checkStatusConstraint — non-key parent statuses', () => {
  it.each([
    RequirementStatus.DRAFT,
    RequirementStatus.DRAFTING,
    RequirementStatus.ANALYZING,
    RequirementStatus.CLARIFYING,
    RequirementStatus.DESIGNING,
    RequirementStatus.PLANNING,
    RequirementStatus.ARCHIVED,
  ])('always returns ok for %s parent (no constraint)', (status) => {
    const result = checkStatusConstraint({
      parentTargetStatus: status,
      cards: [BACKLOG_A, IN_PROGRESS_A, DONE_A],
    })
    expect(result.ok).toBe(true)
  })

  it('does not auto-flip parent when all children are done (reverse direction)', () => {
    // 反向:子全 done → Guard 校验父当前 status,父若不是 done 仍 ok
    // 验证 Guard 本身没有"子全 done → 触发父切 done"逻辑
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.IMPLEMENTING,
      cards: [DONE_A, DONE_A],
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// simulatedChange(用于 PATCH /cardId/status 场景)
// ---------------------------------------------------------------------------

describe('checkStatusConstraint — simulatedChange', () => {
  it('simulates the card switch and reports conflicts as if it already happened', () => {
    // 父 implementing,子 A 是 backlog,模拟 A 切到 todo(应该变得合规)
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.IMPLEMENTING,
      cards: [BACKLOG_A, BACKLOG_B],
      simulatedChange: { cardId: BACKLOG_A.id, newStatus: TaskCardStatus.TODO },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.conflicts).toEqual([
      {
        card_id: BACKLOG_B.id,
        card_status: TaskCardStatus.BACKLOG,
        rule: 'no_backlog_for_implementing',
      },
    ])
  })

  it('reports the simulated card itself if it remains in violation', () => {
    // 父 submitting,两张独立 in_progress 卡:模拟 A → in_review,B 不变 → 仍冲突
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.SUBMITTING,
      cards: [IN_PROGRESS_A, IN_PROGRESS_B],
      simulatedChange: {
        cardId: IN_PROGRESS_A.id,
        newStatus: TaskCardStatus.IN_REVIEW,
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.conflicts[0]?.card_id).toBe(IN_PROGRESS_B.id)
    expect(result.conflicts[0]?.rule).toBe('no_in_progress_for_submitting')
  })

  it('simulatedChange clears conflict when the only violator is fixed', () => {
    const result = checkStatusConstraint({
      parentTargetStatus: RequirementStatus.IMPLEMENTING,
      cards: [BACKLOG_A],
      simulatedChange: { cardId: BACKLOG_A.id, newStatus: TaskCardStatus.TODO },
    })
    expect(result.ok).toBe(true)
  })
})
