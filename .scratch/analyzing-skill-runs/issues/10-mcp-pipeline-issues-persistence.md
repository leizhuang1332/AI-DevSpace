# 10 — MCP 业务工具 → issues.jsonl 落盘真路径修复

**What to build:** 在真实 Claude Agent SDK 链路下，让 Analysis Run 中模型通过 `mcp__analysis__report_analysis_issue` 提交的每条合法 Analysis Issue 都能稳定写入 `<runDir>/issues.jsonl`，并把"为什么被拒"的真实原因暴露到日志和 SSE。当前 commit `1f68c25` 只补了 parser 的字段名 / metadata 形态契约，没修最底层的真因：fake provider 测试与真实 MCP server wrapper 行为不等价，真实路径完全无 e2e 覆盖。

**Blocked by:** 09 — 真实 Agent SDK 验证与规格收口

**Status:** ready-for-agent

## 真因(按影响排序)

- **R1 · 真 MCP server 路径无 e2e 覆盖**:现有 `fakeAnalysisQueryProvider` 用 `input.businessTools[name]` 直 dispatch，**绕过真实 `createSdkMcpServer` 包装**(zod schema 验证、args 包装、tool_use_id 生成全部跳过)。`apps/agent/src/providers/ClaudeCodeProvider.ts:516-541` 的 wrapper 用 `async (args: unknown) => { ... }` 单参数接 SDK 的 `(args, extra) => Promise<CallToolResult>` 双参数调用,真实 args 形态未被任何测试断言。这是**最可能的真因** —— 真实链路下 handler 收到的 `args` 与 fake provider 收到的不一致(SDK 可能二次包装),导致 `parseReportIssueInput` 在 type guard `typeof o.title === 'string'` 处失败,parser 返回 `{ok: false}`,handler 静默返 `{accepted: false, issue_id: '', ordinal: 0}`。
- **R2 · `mcpCallCounter` + `toolUseIndex` 跨 Run 状态污染**:`apps/agent/src/providers/ClaudeCodeProvider.ts:305` 的 `mcpCallCounter` 是 module-level 单例,长寿命 agent 跑几十次后 counter 上千;`AnalysisRunService.toolUseIndex` 是进程级 Map,跨 Run 累积。两者协同在"先到先得"路径上产生潜在 race / 命中旧 entry 的可能(虽然 `run_id` 校验跳过大部分)。
- **R3 · 空 PRD 导致模型退化**:route 层未在前置拒空 PRD,空 PRD 让模型读 system prompt 第 9 层"PRD 尚未填写"占位,误以为"无源可引",退化到调空 `{}` 的 tool_use 进入"试探参数"循环。

## 排除的假因

- ✅ **E1** `parseReportIssueInput` 字段名/形态契约:已用模型真实输出在隔离测试中跑通(36/36 完整输入全部 `ok: true`);`commit 1f68c25` 这条修复**正确**,不要回滚。
- ✅ **E2** `agent-start` 端口抢占:已修(1f68c25 同一 commit)。
- ✅ **E3** `runService.reportIssue` 在长寿命进程下 stale `completionRequested` / status 残留:实测 SDK 流期间 meta 恒为 `running`,`completionRequested` 不命中当前 run_id;`readMeta` 每次重读 fs 不缓存,排除 stale meta。
- ✅ **E4** Schema 验证抛 `Error` 被 SDK 包成 isError:实测 tool_result 全部是正常 `{"accepted":false,...}` JSON,不是 `isError`,说明 safeParse 100% 通过,handler 走的是正常 return 路径。

## 修复任务(分 PR 提交,顺序固定)

### PR-1 · 暴露真因(日志与 SSE)

- [ ] `apps/agent/src/analysis-run/AnalysisAgentRunner.ts` 的 `makeReportIssueHandler`:parser 拒时写 `process.stderr.write(\`[analysis-run] report rejected toolUseId=... reason=... inputKeys=...\`)`,`runService.reportIssue` 拒时写 `code=...`。
- [ ] 同步把 `reason` 写进 SSE `analysis_run_log` 事件(可选,通过新增字段 `rejection_reason` 而非 `entry: AnalysisLogEntry`)。
- [ ] 不改业务返回值契约(仍 `{accepted: false, ...}`),仅加可观测性。

### PR-2 · e2e 覆盖真 MCP server 路径(核心前置)

- [ ] 新建 `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts`。
- [ ] 构造**真 `ClaudeCodeProvider` 实例**(`new ClaudeCodeProvider(...)`),**不**走 `fakeAnalysisQueryProvider`。
- [ ] 用 `vi.spyOn(@anthropic-ai/claude-agent-sdk, 'query')` 拦截 SDK,emit 真实 envelope 序列:
  - `content_block_start{type: 'tool_use', name: 'mcp__analysis__report_analysis_issue', id: 'call_test_1', input: {title, description, source_refs: [...], metadata: {...}}}`
  - `tool_result` 回包
  - `result{type: 'result', subtype: 'success'}`
- [ ] 断言:`<runDir>/issues.jsonl` 写入 1 行;`meta.issue_count === 1`;tool_result content 文本 = `{"accepted":true,"issue_id":"...","ordinal":1}`。
- [ ] 这条 e2e 跑通前,任何改 MCP wrapper 的 commit 不可合入。

### PR-3 · 针对性修 MCP wrapper(等 PR-2 失败信号定方案)

- [ ] 跑 PR-2 拿真因,**不要盲打**。预期失败形态之一(从强到弱):
  - **A**:handler 收到的 `args` 是 `{args: modelInput}`(SDK 二次包)→ `realArgs = args?.args ?? args`。
  - **B**:zod `looseArgsShape = z.object({}).passthrough()` 在 SDK 0.3.206 下对 `passthrough` 行为有变,SDK 直接拒 tool_call,handler 收不到回调 → 改 schema 为 `z.record(z.unknown())` 或直接放弃 schema 校验。
  - **C**:wrapper 异步时 `++mcpCallCounter` 产生 race → 配合 PR-4 修。
- [ ] 修完后 PR-2 e2e 必须红→绿。

### PR-4 · 状态隔离(防 cross-Run 污染)

- [ ] `apps/agent/src/providers/ClaudeCodeProvider.ts`:删 `let mcpCallCounter = 0` module-level;改 `runAnalysisQuery` 闭包内 `let perRunCounter = 0`,wrapper 引用闭包变量。
- [ ] `apps/agent/src/analysis-run/AnalysisRunService.ts`:新增 `clearToolUseIndexForRun(run_id: string)`,在 `transitionToSucceeded` / `transitionToFailed` 末尾调一次。
- [ ] 回归测试 `analysis-run-resilience.test.ts`:长寿命进程跑 Run A + Run B 共用 `toolUseId='mcp-report_analysis_issue-1'`,断言两条 issue 各自落盘。

### PR-5 · 契约收紧(route 层前置拒空 PRD)

- [ ] `apps/agent/src/routes/analysis-run.ts` 在 `runService.createRun` 前:读 PRD,trim 后 < 50 字符 → 返 `400 {error: 'empty_prd', reason: '...'}`,不进入 MCP 调用阶段。
- [ ] `apps/agent/src/analysis-run/AnalysisPromptAssembler.ts:181`:空 PRD 占位从 `_(PRD 尚未填写)_` 改为 `**错误:PRD 为空。本次 Run 不应启动,route 层已拒绝。**`(配合 PR-5 走防御纵深,模型读到也能立刻识别异常)。
- [ ] 前端 Web `app/analyzing-zone` 把 400 错误码映射成 toast 提示"请先填写 PRD"。

### PR-6 · 文档(架构债)

- [ ] 新建 `docs/adr/0023-mcp-server-path-coverage.md`:记录 fake provider 与真 MCP server 不等价是历史盲点,决策"改 MCP wrapper 必须先有 e2e"(指向 PR-2)。
- [ ] `AGENT.md` / `CONTRIBUTING.md`(如存在)加一条:"改 `apps/agent/src/providers/ClaudeCodeProvider.ts` 必须先在 `analysis-run-mcp-e2e.test.ts` 加测试"。

## 复现步骤(供未来回归)

1. `pnpm dev` 启动 web + agent。
2. 在 Web 端打开一个 PRD 内容 ≥ 200 字的 Requirement(避免 PR-5 触发空 PRD 拦截)。
3. 点击"开始分析",选择 `prd-completeness`。
4. 等 Run 完成(`status: succeeded`)。
5. 期望:Run 详情页 Issue 列表 ≥ 1 条;`<runDir>/issues.jsonl` 非空(行数 = `meta.issue_count`)。
6. 当前(修复前)结果:Issue 列表空,`issues.jsonl` 0 字节,`meta.issue_count: 0`,但 `log.jsonl` 包含 N 条 `mcp__analysis__report_analysis_issue` tool_use 且 tool_result 全部 `{"accepted":false,"issue_id":"","ordinal":0}`。

## 完成定义

- [ ] 上述 6 个 PR 全部合入 main。
- [ ] 真模型跑一次 Analysis Run(PRD 非空),`issues.jsonl` 写入 ≥ 1 行,`meta.issue_count > 0`,`log.jsonl` 中所有 `mcp__analysis__report_analysis_issue` tool_result 都是 `{"accepted":true,...}`(允许 `duplicate: true` 命中幂等)。
- [ ] `pnpm test apps/agent` 757 → 增加 PR-2 / PR-4 / PR-5 关联测试后全过。
- [ ] `tsc --noEmit` 三个包(apps/agent, apps/web, packages/shared)全过。
- [ ] 新增 ADR-0023 写明 fake provider 与真 MCP server 的覆盖差。

## 暂不在本 ticket 范围

- 取消 / 暂停 / 续跑入口(已在 07 排除)
- 多 Provider 切换(Codex / Opencode SDK)—— 本 ticket 只修 ClaudeCodeProvider 路径
- 自动 retry 行为调整(已在 07 处理)
- 把 `reason` 喂回 model 的契约层决定(需另行讨论,本 ticket 只暴露不喂回)

## 关联

- 父 PRD:`../PRD.md`
- ADR:0021(基础契约)+ 待写 0023(本次架构债)
- 相关 issue:07(失败/重试/恢复)、09(真实 SDK 验证)
- 上游 1f68c25 commit(本 ticket 视为其不完整修复的延伸)
