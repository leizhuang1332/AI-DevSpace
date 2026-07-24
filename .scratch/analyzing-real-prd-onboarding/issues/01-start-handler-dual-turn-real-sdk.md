# 01 — `start` handler 单 session 双 turn 真接 SDK

**What to build:** 后端 `start` handler 接 Claude Agent SDK,创建 1 个 `AISession`,做两次 `sendMessage`(turn-1 admission-check、turn-2 requirement-brainstorm)。每次 SDK 流结束即把 chunk 落 `chunks.jsonl` 一行并通过 SSE 推给 web。turn-2 的 user message 自然引用 turn-1 产出(SDK 同 session 自动保留 history)。整个链路让用户在 ANALYZING 工位上能"开始分析 → 看到真 AI 推的产物出现",不再依赖 `simulate*` mock。

**Blocked by:** 00 — baseline `agent-skeleton.e2e` 测试拉绿;不修好这条 e2e,ticket 01 落地时无法判断"真 SDK 改对了"还是"被这条已存在的失败掩盖"

**Status:** ready-for-agent

- [ ] `start` handler 不再调 `simulateStartChunks`;改为创建 `AISession` 并按 ADR-0020 D8 编排双 turn
- [ ] turn-1 收到 SDK 流式 chunk → 写入 `requirements/<id>/analysis/sessions/<sid>/chunks.jsonl` 一行,并通过 SSE 推 web
- [ ] turn-2 同一 session,SDK 自动保留 turn-1 history;user message 显式提示"已知准入结果,继续 brainstorm"
- [ ] handler 不另造 `done` chunk 标记;turn-done 完全由 SDK `sendMessage` 流关闭事件表达(ADR-0020 D8 末段约定)
- [ ] 单 turn 失败时 jsonl 可留下部分 row,session 保留半成品状态(snapshot 防御由 ticket 06 提供)
- [ ] provider 桥接点(`ClaudeCodeProvider` / `AISession`)沿用既有路径;**不**引入 `MockClaudeProvider` 等抽象层(ADR-0020 D11)
- [ ] handler wiring 单测:turn-1 与 turn-2 都被触发、session 创建一次、user message 文本符合 ADR-0020 D8 描述
- [ ] `pnpm typecheck` 与 `pnpm test` 通过

**Notes / non-goals:**
- 准入 / brainstorm 产物 prompt 内容由 ticket 02(SKILL.md)提供;本 ticket 不写 prompt
- AdmissionDashboard 渲染条件 / CTA 按钮由 ticket 05
- snapshot 落盘与回滚菜单由 ticket 06
- e2e 套件由 ticket 07
- `apps/agent/src/zones/analyzing.yaml` 不动(handler 内部硬过滤 active Skills)
