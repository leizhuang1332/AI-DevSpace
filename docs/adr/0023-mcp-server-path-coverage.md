---
status: accepted
---

# Analysis Run 必须覆盖真 MCP server 路径(ADR-0023)

ticket 10 揭示并修补了一处持续 7 个 ticket 的覆盖盲点:Analysis Run 的"业务工具被拒绝"问题,此前一直用 `fakeAnalysisQueryProvider` 调业务工具 handler 的方式做单元/集成测试,**绕过了 SDK `createSdkMcpServer` + `tool()` 包装层**,导致 SDK 0.3.206 在生产路径上对工具入参的真实行为没有任何覆盖。一旦真 MCP server wrapper 改变 args 形态、zod schema 过滤行为或 tool_use_id 生成方式,所有既有测试仍然 GREEN,但生产路径立刻坏掉,直到用户重新跑真模型才被发现。

本 ADR 把"改 `ClaudeCodeProvider` 的 MCP 路径必须有 e2e 测试守门"升格为平台契约,并明确状态隔离与空 PRD 防御纵深的规则。

## 背景与现象

ticket 10 的真因 R1 指出:`fakeAnalysisQueryProvider` 通过 `input.businessTools[name]` 直接 dispatch 业务 handler,跳过 SDK 内部 MCP server 协议层(zod schema 验证、args 包装、tool_use_id 生成)。fake 与真 MCP server 不等价,而 ticket 10 之前所有 Analysis Run 测试都基于 fake,因此:

- 真 SDK 在 wrapper 内可能对 args 做二次包装(`{args: modelInput}` / `{input: modelInput}`),但 fake 不感知;
- SDK 0.3.206 在 zod raw shape 之外的字段会被过滤(fake 不做 schema 校验);
- SDK 调用 wrapper 是异步并发的,模块级共享状态在跨 Run / 跨 attempt 上可能产生 race(fake 是单 attempt 同步)。

结果:Analysis Run 在生产路径上"模型发出 report_analysis_issue 但 issues.jsonl 始终 0 字节",只有真模型跑得出来,所有测试都过。

## 决策

1. **改 `apps/agent/src/providers/ClaudeCodeProvider.ts` 的 MCP server 路径(包含 `runAnalysisQuery`、`createSdkMcpServer` 注册、wrapper 闭包、zod schema 形态)必须先有 e2e 测试覆盖。** 不接受"只跑真模型肉眼验证"作为唯一回归手段。

2. **e2e 测试位置:** `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts`。该测试构造真 `ClaudeCodeProvider` 实例 + mock SDK 的 `createSdkMcpServer` / `tool` / `query`,让 SDK 内部协议真正经过 wrapper 闭包一次。集成测试(`analysis-run-routes.test.ts` 等)继续用 `fakeAnalysisQueryProvider`,只覆盖业务逻辑与持久化。

3. **状态隔离(PR-4):** Provider 的 `mcpCallCounter` 与 `AnalysisRunService.toolUseIndex` 都改为 Run 作用域局部。Provider 的 counter 改 `runAnalysisQuery` 闭包内 `let perRunCounter = 0`;Service 在 `transitionToSucceeded` / `transitionToFailed` 末尾调用新增的 `clearToolUseIndexForRun(runId)` 清理该 Run 的索引条目。理由:长寿命进程跑几十次 Run 后,模块级单例与跨 Run 累积的 Map 会产生 race / 命中旧 entry 的可能(虽然 `run_id` 校验跳过大部分,但不优雅)。

4. **空 PRD 防御纵深(PR-5):** route 层在 `createRun` 之前读 PRD,trim 后 < 50 字符 → 返 `400 {error: 'empty_prd', reason: '...', min_length: 50, actual_length}`,不进入 MCP 调用阶段。AnalysisPromptAssembler 第 9 层空 PRD 占位从 `_(PRD 尚未填写)_` 改为 `**错误:PRD 为空。本次 Run 不应启动,route 层已拒绝。**`(防御纵深,模型读到也能立刻识别异常)。Web `app/analyzing-zone` 把 `empty_prd` 单独映射成 toast 提示,与 `prd_not_ready`(409,文件缺失/全空白)区分。

5. **可观测性(PR-1,已在 5659a52 前置提交):** `makeReportIssueHandler` 在 parser 拒时写 stderr + publish `analysis_issue_rejected` SSE;`runService.reportIssue` 拒时同样。业务返回值契约仍 `{accepted: false, issue_id: '', ordinal: 0}`(不变),仅加 `reason` 字段供 SSE / 工具结果 / stderr 三方定位。

6. **真因验证(PR-3,已在 5659a52 前置提交):** 跑 PR-2 的 e2e 测试时,根据失败形态定方案:A(args 被 SDK 二次包)→ `realArgs = args?.args ?? args`;B(zod `passthrough` 行为变化)→ schema 改为更宽松形态;不要盲打。

## 不在范围内

- 不改变 `AnalysisQueryInput` / `AnalysisQueryResult` 公共契约;`runAnalysisQuery` 仍是 `(input) => Promise<AnalysisQueryResult>`,Provider 内部实现自由。
- 不引入取消/暂停/续跑入口(ticket 07 已排除)。
- 不切换到 Codex / Opencode SDK 的 Provider 路径;ticket 10 只修 ClaudeCodeProvider。
- 不把 `reason` 喂回模型(契约层决定需另行讨论,本 ticket 只暴露不喂回)。

## 主要取舍

- 选择"Provider 内部实现自由 + e2e 守门",而不是"对外暴露 MCP server 细节"或"把 fake provider 改成更接近真 SDK"——前者侵入性大、后者需要持续追踪 SDK 内部协议。
- 选择 route 层 + prompt 占位双层防御(PR-5),而不是只在 route 层拒——前者无法阻止 prompt 在中途读到"PRD 为空"的退化路径(虽然 route 已经拒了 Run 启动,但 prompt 占位的明确性有助模型未来扩展到"用户中途清空 PRD"等场景)。
- 选择 PR-4 显式清理 `toolUseIndex`,而不是改为持久化索引——后者需要 schema 升级与读盘路径同步,本 ticket 优先解决 race 风险而非持久化语义。

## 关联

- 上游: ADR-0021(Analysis Skill 驱动的 Analysis Run 协议)定义业务工具契约;ticket 09(真实 Agent SDK 验证)把 fake 路径打通。
- 下游: 任何 Provider 切换 / 协议升级 / MCP 工具新增都要先在 `analysis-run-mcp-e2e.test.ts` 加测试,再改实现。
- 父 ticket: `.scratch/analyzing-skill-runs/issues/10-mcp-pipeline-issues-persistence.md`。