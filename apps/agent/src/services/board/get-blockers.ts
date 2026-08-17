/**
 * getBlockers —— 物理删除前的反向引用检查纯函数(ADR-0036 D2)
 *
 * 提取为独立模块的理由:
 * - 纯函数无 IO,可独立单测(参见 `__tests__/board/get-blockers.test.ts`)
 * - 与现有 `StatusConstraintGuard.ts` 内联 filter 风格一致(无副作用)
 * - 后续 batch 真删路径复用同款检查,无需复制逻辑
 *
 * 行为:
 * - **子任务**:`parent_id === cardId` 的非 archived 卡
 * - **被依赖**:`depends_on.includes(cardId)` 的非 archived 卡
 * - 沿用 ADR-0025 D6「archived 不参与父 status 校验」的过滤语义:
 *   函数内部 defense-in-depth 再过滤一次 `is_archived`,避免 caller
 *   误传 archived 卡导致 blocker 误报
 * - **不**抛错;返回结构体由 caller 决定如何路由(典型:route 层根据
 *   `subtasks.length + dependents.length > 0` 返回 409)
 */

import type { TaskCard } from '@ai-devspace/shared'
import type { BoardCardBlockers } from '@ai-devspace/shared'

export function getBlockers(
  cards: readonly TaskCard[],
  cardId: string,
): BoardCardBlockers {
  const subtasks: Array<{ id: string; title: string }> = []
  const dependents: Array<{ id: string; title: string }> = []
  for (const card of cards) {
    // 自己是被删目标,不查自己(避免自引用 + parent_id === cardId 把自己算进 subtasks)
    if (card.id === cardId) continue
    if (card.is_archived) continue
    if (card.parent_id === cardId) {
      subtasks.push({ id: card.id, title: card.title })
    }
    if (card.depends_on.includes(cardId)) {
      dependents.push({ id: card.id, title: card.title })
    }
  }
  return { subtasks, dependents }
}