# 05 — Agent PrdSplitService + PRD 拆解 Run

**What to build:** PRD 智能拆分端到端:web 触发 Run,产物落父 analysis 目录,返回候选卡片组供 board 载入;本 ticket **守门**:不动 Provider / runAnalysisQuery,只新增 prompt assembler + 产物处理。

**Blocked by:** 02 — Agent TaskCardStore,03 — Agent StatusConstraintGuard

**Status:** ready-for-agent

- [ ] POST `/api/requirement/:id/board/split-from-prd` 接受 modal payload:`{粒度: 粗|中|细, expected_count: number, use_context: string[]}`
- [ ] 内部调 `runAnalysisQuery`(沿用 ADR-0021 + ADR-0023,**不动 ClaudeCodeProvider 实现**)
- [ ] 新增 prompt assembler `prd-split-cards.yaml`,prompt 模板来自父 analyzing transcript 历史 + PRD 段落 + 上下文
- [ ] Run 在父 analyzing transcript 内(transcript 续接,不创建 task-card transcript)
- [ ] 产物落 `~/.aidevspace/requirements/<id>/analysis/proposals/<run-id>/cards.yaml`(符合决策 2「目录即真相」)
- [ ] 集成测试(mock runAnalysisQuery):payload → candidates[N] 返回,每条含 `title + content + suggested_status='backlog' + suggested_priority`
- [ ] **守门 verify**:本 ticket 实施后,`analysis-run-mcp-e2e.test.ts` 仍 GREEN(protocol unchanged)
- [ ] 不在本 ticket 触达:候选人卡片落盘为 TaskCard(留 web 端 08 处理)
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
