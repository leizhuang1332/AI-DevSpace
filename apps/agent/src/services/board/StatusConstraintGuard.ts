/**
 * StatusConstraintGuard —— 父子 Requirement.status ↔ TaskCard.status 软约束校验
 *
 * 实现 ADR-0025 D2 + D5 表。3 条规则(父 → 子方向):
 *
 * | 父 status 目标值      | 约束                                |
 * |----------------------|-------------------------------------|
 * | `implementing`       | 非 archived 子卡**无 backlog**         |
 * | `submitting`         | 非 archived 子卡**无 in_progress**     |
 * | `done`               | 所有非 archived 子卡 status = 'done' |
 *
 * 反向(子 → 父)**不约束**(ADR-0025 D3):
 * - 子全部 done 不自动切父 done
 * - 子状态变化不直接改父 status 字段
 * - 仅通过 SSE / UI 提示
 *
 * 设计要点:
 * - **纯函数**:输入 + 卡片列表 → 输出 conflicts。不直接写父 status。
 * - **自过滤 archived**(ADR-0025 D6):即便 caller 误传 archived 卡,Guard 也按
 *   `is_archived=true` 剔除后再校验。`store.list(reqId)` 仍默认过滤,这里是
 *   defense-in-depth,避免 caller 变更时 archived 卡被误报为冲突。
 * - `simulatedChange` 支持 PATCH /cardId/status 场景:模拟"这张卡已切到新 status"
 *   再跑校验,使得改完后父约束若被破坏也能被检出。
 * - 其他父 status 值(draft / drafting / analyzing / clarifying / designing / planning / archived)
 *   不约束,返回 `{ ok: true }`。
 */

import {
  RequirementStatus,
  TaskCardStatus,
  type RequirementStatusT,
  type TaskCard,
  type TaskCardStatusT,
} from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

/** 单条冲突的描述:违反的规则名 + 命中卡 id + 当前 status。 */
export interface ConstraintConflict {
  /** 命中的非 archived 子卡 id */
  card_id: string
  /** 卡当前(或 simulated)status */
  card_status: TaskCardStatusT
  /** 触发的规则名(便于 UI 提示 + 日志) */
  rule: 'no_backlog_for_implementing' | 'no_in_progress_for_submitting' | 'all_done_for_parent_done'
}

export type GuardResult =
  | { ok: true }
  | { ok: false; conflicts: ConstraintConflict[] }

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * 软约束校验入口。
 *
 * @param parentTargetStatus 父 Requirement 的**目标** status(切到哪就传哪个)
 * @param cards              非 archived 子卡列表(`TaskCardStore.list(reqId)`)
 * @param simulatedChange    可选,模拟一张卡切到新 status 后再校验。
 *                            主要给 PATCH /cardId/status 场景用:把当前卡的
 *                            "未来状态"代入,看改完后父约束是否被破坏。
 */
export function checkStatusConstraint(args: {
  parentTargetStatus: RequirementStatusT
  cards: readonly TaskCard[]
  simulatedChange?: { cardId: string; newStatus: TaskCardStatusT }
}): GuardResult {
  const { parentTargetStatus, simulatedChange } = args
  // ADR-0025 D6:self-filter archived so caller mistakes don't surface as conflicts.
  const activeCards = args.cards.filter((c) => !c.is_archived)
  const cards = applySimulatedChange(activeCards, simulatedChange)

  switch (parentTargetStatus) {
    case RequirementStatus.IMPLEMENTING:
      return checkNoBacklog(cards)
    case RequirementStatus.SUBMITTING:
      return checkNoInProgress(cards)
    case RequirementStatus.DONE:
      return checkAllDone(cards)
    default:
      // draft / drafting / analyzing / clarifying / designing / planning / archived
      // — ADR-0025 D5 表"不限制"
      return { ok: true }
  }
}

// ---------------------------------------------------------------------------
// 3 条规则
// ---------------------------------------------------------------------------

/** Rule 1:父 implementing — 非 archived 子卡中无 backlog */
function checkNoBacklog(cards: readonly TaskCard[]): GuardResult {
  const conflicts: ConstraintConflict[] = []
  for (const card of cards) {
    if (card.status === TaskCardStatus.BACKLOG) {
      conflicts.push({
        card_id: card.id,
        card_status: card.status,
        rule: 'no_backlog_for_implementing',
      })
    }
  }
  return conflicts.length === 0 ? { ok: true } : { ok: false, conflicts }
}

/** Rule 2:父 submitting — 非 archived 子卡中无 in_progress */
function checkNoInProgress(cards: readonly TaskCard[]): GuardResult {
  const conflicts: ConstraintConflict[] = []
  for (const card of cards) {
    if (card.status === TaskCardStatus.IN_PROGRESS) {
      conflicts.push({
        card_id: card.id,
        card_status: card.status,
        rule: 'no_in_progress_for_submitting',
      })
    }
  }
  return conflicts.length === 0 ? { ok: true } : { ok: false, conflicts }
}

/** Rule 3:父 done — 所有非 archived 子卡 status = done */
function checkAllDone(cards: readonly TaskCard[]): GuardResult {
  // ADR-0025 D3 例外:"当所有非 archived TaskCard 全部 status='done' 时" — 这条
  // 校验的是**所有卡都 done 才允许父 done**;若一张都没有,父 done 反而无意义
  // 但不阻断(用户切父 done 后所有未建卡的 req 不会有冲突)。
  // 当前 ADR D2 写法是"所有非 archived 子卡 status='done'";空列表视作通过
  // —— 此时父切 done 是 no-op,等用户补卡再校验。
  if (cards.length === 0) return { ok: true }
  const conflicts: ConstraintConflict[] = []
  for (const card of cards) {
    if (card.status !== TaskCardStatus.DONE) {
      conflicts.push({
        card_id: card.id,
        card_status: card.status,
        rule: 'all_done_for_parent_done',
      })
    }
  }
  return conflicts.length === 0 ? { ok: true } : { ok: false, conflicts }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 把模拟变更套到卡片列表上(浅替换 status,不改其他字段)。 */
function applySimulatedChange(
  cards: readonly TaskCard[],
  change: { cardId: string; newStatus: TaskCardStatusT } | undefined,
): readonly TaskCard[] {
  if (!change) return cards
  return cards.map((card) =>
    card.id === change.cardId ? { ...card, status: change.newStatus } : card,
  )
}