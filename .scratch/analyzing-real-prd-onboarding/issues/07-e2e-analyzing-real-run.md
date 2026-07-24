# 07 — e2e `analyzing-real-run.spec.ts` 真跑对接

**What to build:** Playwright 端到端套件:启动 web + agent,创建新需求,进入 ANALYZING,点"开始分析",验证 AdmissionDashboard 5 卡填 + ProductList 至少 1 个 subproblem。`ANTHROPIC_API_KEY` 缺失时 e2e 自动 SKIP 并打印明确日志。提供 reviewer 验收脚本(可在本地手工跑并归档 SSE / chunks.jsonl 头几行,作为 PR 上线门槛物证)。

**Blocked by:** 01, 02, 03, 05, 06

**Status:** ready-for-agent

- [ ] 新增 `apps/web/e2e/analyzing-real-run.spec.ts`
- [ ] spec 步骤:
    1. 启动 web + agent(走既有 `pnpm dev:web` + `pnpm dev:agent` 守护脚本)
    2. 等 SDK idle(健康检查)
    3. 走 DRAFTING 上传或 fixture 创建新需求(本 spec 内 fixture 优先,避免 docx 解析分支干扰)
    4. 进 ANALYZING → 见 AdmissionDashboard 空态 + "开始分析" 按钮
    5. 点按钮 → SSE 推 chunks → 等待 5 卡 count 全部 > 0 与 ProductList 至少 1 个 subproblem
    6. 截图保存到 e2e artifact 并 attach
    7. `cat requirements/<id>/analysis/sessions/<sid>/chunks.jsonl` 头 5 行写入 spec 报告
- [ ] spec 启动时检查 `process.env.ANTHROPIC_API_KEY`;缺时 `test.skip()` 并打印 SKIPPED 日志行(明确告知原因)
- [ ] CI 默认跑(若 secret 设置);开发机可直接 `pnpm e2e` 跑
- [ ] 提供 reviewer 手工验收脚本(`scripts/verify-analyzing-real-run.sh`):跑一次真 SDK 并把 SSE / chunks.jsonl 头几行归档到 `~/.aidevspace/verification/`
- [ ] `pnpm typecheck` 与 `pnpm test` 通过;e2e 在 CI 默认 SKIP 时不 fail

**ADR ref:** ADR-0020 ticket 07 / D11 / 上线门槛

**Notes / non-goals:**
- 不引入 `MockClaudeProvider`(参 ADR-0020 D11)
- CI 上若 secret 缺失,默认 SKIP 不 fail(参 ADR-0020 上线门槛第 4 项)
- 不覆盖 `interject` / `generate-brief` 真跑(见 ADR-0020 D13 / D14 后续 PR)
- 不覆盖 SkillsPage 改造(见 ADR-0020 D12 后续 PR)
