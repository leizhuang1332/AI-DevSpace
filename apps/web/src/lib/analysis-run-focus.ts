/**
 * Analysis Run 焦点选择 helper(analyzing-fab ticket 03 · ADR-0022 D5.1)
 *
 * 删除 Run 后,父组件 `AnalyzingZone.handleConfirmDelete` 需要给
 * `currentRunId` 一个新值。按 ADR-0022 D5.1:
 *
 * - 「下一个 Run」= 按 created_at 倒序的第一个非 deletedRunId 的 Run
 * - 列表空 / 全删 → 返 `''`(由父组件后续回退到「无 Run」空态)
 *
 * helper 自身再做一次防御性 created_at 倒序:父组件 AnalyzingZone 在初始
 * state 已经按倒序排过,但 SSE 追加新 Run 时 `setRuns` 不再排,边界情况下
 * 仍可能出现非倒序。helper 内部的 sort 与 AnalysisHistoryFabPanel /
 * AnalysisHistoryDrawer 保持一致(后者亦做防御性 sort,见
 * `analysis-history-fab-panel.tsx:63` 与 `analysis-history-drawer.tsx:73`)。
 *
 * 状态无关:helper 不看 `run.status`。运行中 Run 仍可作 fallback(尽管
 * ticket 03 验收 8 联动 ticket 01 已有「空态由 ticket 07 兜底」语义,
 * 但本 helper 单纯按 created_at 倒序取最前者,语义上不掺 status 决策)。
 */

import type { AnalysisRunMeta } from '@ai-devspace/shared'

/**
 * 删除 `deletedRunId` 后,「下一个 Run」的 run_id。
 *
 * @param runs 当前已知的 Analysis Run 列表(任意顺序)
 * @param deletedRunId 被删除的 Run id(用于从候选中排除)
 * @returns created_at 最大的非 deletedRunId 的 run_id;空时返 ''
 */
export function findNextRunId(
  runs: ReadonlyArray<AnalysisRunMeta>,
  deletedRunId: string,
): string {
  // 防御性 created_at 倒序(ISO 8601 字符串字典序与时间序一致,稳)
  const sorted = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at))
  for (const run of sorted) {
    if (run.run_id !== deletedRunId) return run.run_id
  }
  // 列表空 / 所有候选都是 deletedRunId / runs 列表只含 deletedRunId
  return ''
}
