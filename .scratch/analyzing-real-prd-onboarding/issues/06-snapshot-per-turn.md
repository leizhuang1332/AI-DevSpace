# 06 — Snapshot per turn + StatusBar 回滚菜单

**What to build:** `start` handler 在 turn-1 / turn-2 写 `chunks.jsonl` 前各 snapshot 一次,分别为 `before_admission` 与 `before_brainstorm`(走 ADR-0009 `snapshotBeforeWriteAgent` 路径)。StatusBar 的"回滚"下拉菜单列出这两个 id,选中触发既有 `restoreSnapshot`(若已接)。让真 SDK 跑出的半成品可回滚到一个已知 good 状态。

**Blocked by:** 01(handler 已就位),05(回滚 UI 与 CTA 状态展示绑定)

**Status:** ready-for-agent

- [ ] turn-1 chunks 落 `chunks.jsonl` 第一行前 → 调 `snapshot('before_admission')`
- [ ] turn-2 chunks 落 `chunks.jsonl` 第一行前 → 调 `snapshot('before_brainstorm')`
- [ ] 空 turn(SDK 返回 0 chunk)不 snapshot
- [ ] StatusBar "回滚" 下拉菜单列出 `before_admission` 与 `before_brainstorm` 两个 snapshot id;选中触发 ADR-0009 既有 `restoreSnapshot` 流程
- [ ] snapshot 文件落 `~/.aidevspace/snapshots/` 目录,文件名以 `before_admission` / `before_brainstorm` 为前缀(沿用 ADR-0009 既有命名规范)
- [ ] handler wiring 单测新增三条断言:(a) 两 turn 都触发 snapshot;(b) 空 turn 不 snapshot;(c) snapshot 失败不阻断后续 turn
- [ ] `pnpm typecheck` 与 `pnpm test` 通过

**ADR ref:** ADR-0020 ticket 06 / D10

**Notes / non-goals:**
- 不修改 snapshot 落盘格式(沿用 ADR-0009 既有)
- 不动 timeline / StatusBar 其它面板
- 不引入新的 snapshot 策略(仅在 turn 边界触发,不在 chunk-row 边界)
