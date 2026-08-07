# 05 — Agent PrdSplitService + PRD 拆解 Run

**What to build:** PRD 智能拆分端到端:web 触发 Run,产物落父 analysis 目录,返回候选卡片组供 board 载入;本 ticket **守门**:不动 Provider / runAnalysisQuery,只新增 prompt assembler + 产物处理。

**Blocked by:** 02 — Agent TaskCardStore,03 — Agent StatusConstraintGuard

**Status:** resolved

- [x] POST `/api/requirement/:id/board/split-from-prd` 接受 modal payload:`{粒度: 粗|中|细, expected_count: number, use_context: string[]}`
- [x] 内部调 `runAnalysisQuery`(沿用 ADR-0021 + ADR-0023,**不动 ClaudeCodeProvider 实现**)
- [x] 新增 prompt assembler `prd-split-cards.yaml`,prompt 模板来自父 analyzing transcript 历史 + PRD 段落 + 上下文
- [x] Run 在父 analyzing transcript 内(transcript 续接,不创建 task-card transcript)
- [x] 产物落 `~/.aidevspace/requirements/<id>/analysis/proposals/<run-id>/cards.yaml`(符合决策 2「目录即真相」)
- [x] 集成测试(mock runAnalysisQuery):payload → candidates[N] 返回,每条含 `title + content + suggested_status='backlog' + suggested_priority`
- [x] **守门 verify**:本 ticket 实施后,`analysis-run-mcp-e2e.test.ts` 仍 GREEN(protocol unchanged)
- [x] 不在本 ticket 触达:候选人卡片落盘为 TaskCard(留 web 端 08 处理)
- [x] `pnpm --filter @ai-devspace/agent test` GREEN

## Answer

实现完成于 commit(feat(board): PrdSplitService + POST /split-from-prd issue 05 / ADR-0027)。

**落地清单:**
- `packages/shared/src/prd-split.ts` —— Zod schema(proposal + cards file + meta + 路由 schema)
- `apps/agent/src/prd-split/proposalPaths.ts` —— 路径 + run-id helper(`prd-` 前缀)
- `apps/agent/src/prd-split/PrdSplitPromptAssembler.ts` —— 4 层 systemPrompt 纯函数(父 transcript tail + PRD + 上下文)
- `apps/agent/src/prd-split/PrdSplitService.ts` —— Run 状态 + 产物落盘 + tool_use_id 幂等 + mkdir 锁 + orphan 收敛
- `apps/agent/src/prd-split/PrdSplitRunner.ts` —— 直调 `provider.runAnalysisQuery` + `propose_card` handler(无 complete_analysis 门禁)
- `apps/agent/src/prd-split/PrdSplitRoute.ts` —— POST/GET/GET-list/DELETE 4 端点(fire-and-forget 201 + GET 轮询)
- `packages/shared/src/sse.ts` —— `prd_split_{created,proposal_reported,succeeded,failed,deleted}` 事件簇

**关键决策:**
- 直接调 `provider.runAnalysisQuery`,不复用 `AnalysisAgentRunner.runAnalysisQuery`(那个强绑 report_analysis_issue/complete_analysis/AnalysisRunService/九层 Skill prompt,与卡片拆解语义不匹配)
- 无 `complete_analysis` 门禁 —— 生成式 Run,SDK turn 结束即完成
- `propose_card` 单卡单调(镜像 report_analysis_issue),partial-progress 友好 + tool_use_id 幂等
- `suggested_status` 固定 `backlog`(spec),handler 写死,模型不传

**守门(ADR-0023 zero-touch):** 未触达 ClaudeCodeProvider / runAnalysisQuery 包装 / createSdkMcpServer / mcpCallCounter;`analysis-run-mcp-e2e.test.ts` 7/7 GREEN。

**验证:** typecheck 全包 GREEN;agent 951/951 测试 GREEN(shared 252 GREEN);prd-split 42 测试 GREEN(schema 28 + assembler 8 + service 20 + routes 14)。
