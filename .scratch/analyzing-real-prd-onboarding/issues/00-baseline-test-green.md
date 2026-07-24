# 00 — baseline `agent-skeleton.e2e` 测试拉绿

**What to build:** 当前 `apps/agent` 包里 1 个 e2e 测试持续失败(`agent-skeleton.e2e.test.ts:161` 的 "start end-to-end:chunks.jsonl 5 行 + 3 行带 source_refs",期望 201 拿到 409)。本 ticket 单独修好这条 baseline,让 ticket 01 接手前 CI 重回绿底色。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 定位根因:`apps/agent/src/routes/analysis.ts` 的 `start` handler 在两个位置读取 root —— 行 256(本路由 `requirement.md` 检查)与行 330(`generate-brief` 同位置),均 `process.env.AIDEVSPACE_ROOT ?? defaultAgentRoot()`;而 `apps/agent/src/server.ts:71` 把 `buildServer({ workspaceRoot })` 注入为 Fastify 实例上的 `workspaceRoot`。测试 `boot()` 传临时目录,真实 route 没读它,fallback 到 `~/.aidevspace`,又因为 `requirement.md` 不在那个目录返回 409 `prd_not_ready`(也可能在残留时返回 409 `session_already_exists`)
- [ ] 选取 fix 路径(最小改动原则):
    - **首选:**让 `start` handler 与 `generate-brief` handler 从 Fastify 装饰器读 `workspaceRoot`,与其它 routes(workspaceRoutes / reposRoutes 等)对齐;fallback 行为仅在装饰器未设时退化
    - **次选:**测试 `boot()` 内 `process.env.AIDEVSPACE_ROOT = root` 显式注入,route 不改(改动小但路径不与其他 route 对齐,长期有债)
- [ ] 一个 commit 实现一个 fix;commit message 写明属于 setup 校正还是实现校正
- [ ] 跑 `apps/agent` 单测:`pnpm --filter @ai-devspace/agent test`,从 baseline 1 failed 转为 0 failed
- [ ] 不复活任何之前 deactivated 的代码,不引入任何新的业务行为
- [ ] 不写新测试,只调既有

**ADR ref:** 不引用 ADR-0020(本 ticket 范围在它之前)

**Notes / non-goals:**
- 不动其它 7 个 ticket 的范围(本 ticket 是它们的 baseline 前置)
- 不动 SDK / provider 接入(那是 ticket 01)
- 不动 `agent-skeleton.e2e` 之外的任何测试
- 不动 SSE / SessionStore / WorkspaceService 等其它模块
