# 03 — 删除 Run:面板保留 + 自动切下一个 Run

**What to build:** 重设 ADR-0021 决策 36 的删除 UX。在面板里删除 Run,不再「不切走焦点」(旧规则),改为「**面板保留打开 + currentRun 自动切到下一个 Run**」,让用户继续在「历史语境」里操作。删除按钮仍走二次确认对话框(`<AnalysisDeleteRunDialog>` 沿用),运行中 Run 仍被服务端 + UI 双重拒绝。

**Blocked by:** 01(注:本 ticket 不依赖 02 — 即使面板尚未显示 Run 列表,删除 UX 的 state 改造仍可独立落地)

**Status:** ready-for-agent

- [ ] 沿用既有 `<AnalysisDeleteRunDialog>`,不重写二次确认逻辑
- [ ] 删除确认后,面板保持打开(`isOpen` state 不变)
- [ ] 新增 `findNextRunId(runs, deletedRunId)` helper:从剩余 Run 列表按 created_at 倒序取第一个非删除 Run;列表空时返 `''`(由父组件后续回退到「无 Run」空态)
- [ ] 父组件 `AnalyzingZone.handleConfirmDelete` 改造:删除成功后,若被删的是当前选中 Run → 调 `setCurrentRunId(findNextRunId(...))`;若被删的不是当前选中 Run → currentRun 不变,只更新 N 计数
- [ ] 删除最后一个 Run → 面板仍打开,N=0 空态显示(由 ticket 07 联合兜底)
- [ ] 删除运行中 Run → 仍被服务端 + UI 双重拒绝(沿用既有 toast「运行中的 Run 不可删除」)
- [ ] 删除后 SSE `analysis_run_deleted` 事件不再触发 currentRun 切换(已被显式删除的乐观本地 state 接管,避免与 SSE 双切换竞态)
- [ ] `userManuallySwitchedRef` 在删除后重置为 `false`(让后续 SSE 终态事件可正常收敛 `startState`)
- [ ] 沿用 `<AnalyzingZone>` 顶层 seam 加新 describe 块,覆盖四种场景:
  - 删除当前选中 Run → 面板仍开 + currentRun 切到下一个
  - 删除非当前选中 Run → 面板仍开 + currentRun 不变
  - 删除最后一个 Run → 面板仍开 + 显示 N=0 空态
  - 删除运行中 Run → 被 UI 拒绝(无 DELETE 调用)
- [ ] 复用既有 `analyzing-zone-focus.test.tsx` 中删除相关 mock 夹具(`mockFetch` + `MockEventSource`),不引入新 mock 库