---
Status: ready-for-agent
Type: prd
Created: 2026-08-09
Feature: board-chat
Covers: ADR-0029 (board chat panel = web 端 Claude Code CLI 可视化 UI 窗口)
Supersedes: ADR-0028 D2 范围(仅描述 / 不挂 Run)→ 升级为完整 SDK session UI 镜像
Source: docs/design/pages/board-chat-subagent.html (sub-agent UI 8 方案对比)
Decisions: 14 轮 grilling 41 个 atomic 决策, 详见 ADR-0029
---

# Board chat panel = web 端 Claude Code CLI 镜像(issue 09 / ADR-0029)

## Problem Statement

用户在 AI-DevSpace 平台使用 board section 推进 TaskCard 时, 详情页右栏虽然已经存在 "transcript" 形态(issue 08 / ADR-0028), 但**当前 transcript 只是个不触发 AI 推理的文本写入器** —— 写一条 user 消息进 YAML 就完事, 永远没有 assistant 回复, 跟 CI 跑日志一样, 没有协作感:

- 用户问 "这个 deadline 怎么赶得上" / "这段代码怎么改" / "error 怎么解", **永远等不到 AI 回答**
- 想跑命令 / 改文件 / 查代码 / Git 操作, **没有工具入口**
- 想用 Skill / MCP / sub-agent, **不可用**
- 引用父 analyzing transcript 的 Run 产物, **只能手动粘贴 ID**
- 跨刷新 / 跨 tab, **历史对话不连续**(虽然 ADR-0028 派生父 snapshot, 但 snapshot 不能演进)

整个 transcript panel 跟 Claude Code CLI 比, **没有任何 AI 能力**。board 详情页右栏虽然叫 "💬 AI 协作", 实际是 "💬 人类独白"。

## Solution

把 board 详情页右栏 transcript panel 升级为**完整的 Claude Code CLI web 镜像** —— 暴露 chat、tool calling、shell、skill、MCP、sub-agent、plan mode、permission 全部核心能力, 让 web 端用户拥有与 Claude Code CLI 等权的协作体验。

**核心架构**:

- **每张 TaskCard 一个 SDK session** — `board/tasks/<ulid>/chat/session.json` 持久化(sessionId / cwd / model / 17 项元数据)
- **SDK 0.3.206 `query()` + `options.resume: string`** — 跨刷新 / 跨 tab 续同一 session
- **双轨持久化** — SDK 默认 `~/.claude/projects/<hash>/<sessionId>.jsonl` + 我们元数据双写, 30 天 SDK 默认 sweep
- **`permissionPromptToolName` MCP tool** — SDK 协议层拦截写工具, 推 SSE 给 web 弹 `<PermissionPrompt>` modal
- **cwd = `board/tasks/<ulid>/` + 静态 `additionalDirectories`** — 父 req dir + Requirement.repos worktree 路径
- **9 类 SSE 事件** — session_init / message_user / message_assistant / tool_call / tool_result / permission_request / permission_resolved / error / complete + sub-agent 4 类
- **cost cap $5** — 顶部 `<UsageBar>` 实时显示, 超 cap 弹 modal 询问
- **独立 audit log** — `~/.aidevspace/audit/<reqId>/<cardId>/chat.log`, 8 项字段, 30 天保留

**保留**:
- ADR-0028 D1 物理存储路径(`board/tasks/<ulid>/`)
- ADR-0027 D5.3 toggle 双态(URL 不暴露 chat)
- 决策 31 SSE / 决策 32 打字机 20ms / 决策 49 AI 思考条 4 指示器
- (Q12 r1) 沿用 toggle, URL 不暴露 chat
- (Q13 f2) 不启用 file checkpointing(信任 git + 手动 revert)

**触发**:
- ADR-0028 D2 部分推倒(从"仅描述"升级为"完整 SDK session")
- ADR-0023 D11 RED e2e 守门(changes 触 Provider 内部 → 必须 test RED 后 GREEN)

## User Stories

### 入口 & 切换

1. As a 需求 owner, 我想在 board 详情页右栏 toggle 展开态看到 "💬 AI 协作" 标题 + 物理独立 badge, so that 我知道这是 board chat 入口
2. As a 需求 owner, 我想点展开 transcript 后看到完整 chat 框(不是只 textarea), so that 我能跟 AI 协作
3. As a 需求 owner, 我想 toggle 状态不持久化, 每次进入 board 详情页从属性表开始(沿用 ADR-0022 D4.4 + 决策 24), so that 符合"克制, 在场"哲学
4. As a 需求 owner, 我想顶部 banner 提示 "📦 旧的描述型对话存档在下方, 新 chat 框是 SDK session", so that 我看到新 chat 框跟旧 transcript 的关系

### Chat 基础

5. As a 需求 owner, 我想在 chat 输入框输入文本发消息, so that 我能跟 AI 协作
6. As a 需求 owner, 我想支持 ⌘+↵ 快捷键发送, so that 我能快速发消息
7. As a 需求 owner, 我想 AI 回复按 20ms/字 打字机效果流式出现(决策 32), so that 我有"实时聊天" 体验
8. As a 需求 owner, 我想 AI 的 thinking block 跟 text 块视觉区分, so that 我能看清 AI 的思考过程
9. As a 需求 owner, 我想 user / assistant 消息气泡清晰区分, so that 我能扫一眼看清对话
10. As a 需求 owner, 我想 chat 面板有最大高度 + 滚动, so that 长对话可滚动查看

### 跨刷新 / 跨 tab

11. As a 需求 owner, 我想刷新页面后, chat 历史 + context 完整保留, so that 我能继续对话
12. As a 需求 owner, 我想 server restart / agent 重启后, chat 仍能续(走 SDK sessionId + resume), so that 我不丢历史
13. As a 需求 owner, 我想同 card 在多个 tab 打开只能 1 tab 跑, 第二个 tab 弹提示 "已在另一 tab 打开", so that 避免并发 race
14. As a 需求 owner, 我想 reload 页面时, Web 端先 GET snapshot 拿 transcript 渲染, 再 SSE 续新事件, so that UI 不出现空白

### Tools / Bash / File

15. As a 需求 owner, 我想 AI 可以 read / write / edit code files, so that 我不用离开 chat
16. As a 需求 owner, 我想 AI 可以跑 bash 命令(`pytest` / `git status` / `grep`), so that 我能跑测试 + 查代码
17. As a 需求 owner, 我想看 AI 调每个工具的 args + result 显示在 chat 流, so that 我知道 AI 在做什么
18. As a 需求 owner, 我想工具调用进行中 shows spinner, 完成后 shows result, so that 我了解 AI 进度
19. As a 需求 owner, 我想 read / glob / grep 自动放行, 无 modal, so that 我不被读工具打断
20. As a 需求 owner, 我想 write / edit / bash 写工具弹 modal, 列命令 / diff 预览, so that 我能 review AI 写
21. As a 需求 owner, 我想 modal 阻塞直到我点 [Allow once] / [Allow session] / [Deny], so that 写操作不静默
22. As a 需求 owner, 我想 run `{rm -rf /, chmod 777, mkfs, dd, git push --force, curl | sh}` 等敏感模式永远弹 modal, 即使 auto-allow 开关开了, so that 我不被静默擦数据

### Permission modal UX

23. As a 需求 owner, 我想 modal 顶部显示 AI 的 "正在做什么" + 工具名 + displayName, so that 我看清上下文
24. As a 需求 owner, 我想 modal 列写工具的 args + 命令预览, so that 我能 review
25. As a 需求 owner, 我想点击 [Allow once] 单次放行, [Allow session] 本会话后续同工具自动放行, [Deny] 拒绝, so that 我掌控粒度
26. As a 需求 owner, 我想 [Allow session] 选 [Allow directory] 增量加 cwd 白名单, so that AI 后续读 cwd 之外文件不再弹
27. As a 需求 owner, 我想 deny 时填 reason, so that AI 知道为何拒绝
28. As a 需求 owner, 我想 deny 时 AI 收到反馈继续对话, so that 它能调整方案

### Plan Mode

29. As a 需求 owner, 我想顶部 `<UsageBar>` 有 `[🛡️ Plan Mode ☐]` 切换, so that 我能主动进入 plan review
30. As a 需求 owner, 我想 plan mode 下 AI 给 plan review, 弹 `<PlanModePrompt>` modal, so that 我能 review
31. As a 需求 owner, 我想 plan 内容渲染为 markdown, 列出要做的事, so that 我清爽 review
32. As a 需求 owner, 我想点 [Accept] 后 AI 自动切 default mode 执行, 不需重新 ping, so that 流程顺畅
33. As a 需求 owner, 我想 [Reject] 时 AI 收到反馈继续对话调整, so that 它能修改方案
34. As a 需求 owner, 我想 [Modify] 时弹子输入框, 我改完发到 chat 继续, so that 我能调整
35. As a 需求 owner, 我想 auto-allow 开关 on 时 plan toggle 禁用, so that 两者不冲突

### Usage Bar / Cost

36. As a 需求 owner, 我想顶部 `<UsageBar>` 实时显示 `model / tokens / cost / turns / duration`, so that 我知道本 card 跑多少
37. As a 需求 owner, 我想 `<UsageBar>` sub-line 显示含 sub-agent tokens, so that 我知道嵌套 agent 跑多少
38. As a 需求 owner, 我想累计 cost > $5 弹 `<CostCapModal>` "继续?", so that 我不会静默烧钱
39. As a 需求 owner, 我想 [继续一次] / [继续本 session] / [暂停] / [新建 session] 4 选项, so that 我掌控粒度
40. As a 需求 owner, 我想切 expensive model (opus) 弹 confirm "单价比 Sonnet X 倍, 确认?", so that 我不静默切昂贵 model
41. As a 需求 owner, 我想切回 Sonnet 不弹 confirm, so that 流程顺畅

### Skills / MCP

42. As a 需求 owner, 我想 AI 自动加载 `~/.claude/skills/` SKILL.md, so that 用户级 Skill 可用
43. As a 需求 owner, 我想 Skill 加载通过 `options.skills: 'all'` 默认, so that 不过滤
44. As a 需求 owner, 我想自定义 MCP server(workspace 级)能被 chat 加载, so that 业务工具可调
45. As a 需求 owner, 我想 Skill 名称跟 SKILL.md frontmatter `name` 一致, so that 加载稳定

### Sub-agent

46. As a 需求 owner, 我想 AI 启动 sub-agent 分析子任务, so that 我能并行处理
47. As a 需求 owner, 我想 sub-agent 块作 `<details>` 嵌入 assistant message, 跟对话流视觉一致, so that 我看清上下文
48. As a 需求 owner, 我想 sub-agent 4 状态视觉(启动 / 进度 / 完成 / 失败) + 30s-summary 文本更新, so that 我了解进度
49. As a 需求 owner, 我想 sub-sub-agent 缩进 1 级, sub-sub-sub-agent 缩进 2 级, so that 视觉层级清晰
50. As a 需求 owner, 我想 sub-agent 完成的总结能折叠查看, so that 我能聚焦主对话
51. As a 需求 owner, 我想 sub-agent 跑的命令也走 permission modal 继承 main session policy, so that 不绕过

### Audit

52. As a 需求 owner, 我想 chat 跑的每个工具调用决策(allow / deny / auto-allow)记入 audit log, so that 事后审计
53. As a 需求 owner, 我想 audit log 字段含 `ts / toolName / toolUseId / args / result / decision / decidedBy / durationMs`, so that 完整
54. As a 需求 owner, 我想 audit log 独立文件 `~/.aidevspace/audit/<reqId>/<cardId>/chat.log`, 跟 session 物理隔离, so that 不污染 chat 数据
55. As a 需求 owner, 我想 audit log 30 天保留, 跟 SDK session 同步 sweep, so that 不无限累积

### 守门契约

56. As a maintainer, 我想改 `ClaudeCodeProvider` 必先在 `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` 加新 RED 测试, GREEN 才能合入(ADR-0023 D11), so that 守门不破
57. As a maintainer, 我想现有 `runAnalysisQuery` / `createSdkMcpServer` / `mcpCallCounter` 全部不动, so that 已有的 Analysis Run 路径不破
58. As a maintainer, 我想 chat 路径独立于 Run 路径, 命名空间分离, so that 路径不混淆

### 跟 ADR-0028 共存

59. As a 需求 owner, 我想旧 transcript.yaml 仍可读(物理不删), so that 老的描述型对话不丢
60. As a 需求 owner, 我想旧 transcript 跟新 chat 视觉分离(旧 = 折叠块, 新 = 主体), so that 不混淆
61. As a 需求 owner, 我想 ad-hoc 跑 chat 写权限不污染 transacript.yaml 路径, so that 路径稳定

## Implementation Decisions

### 跨领域

1. **不持久化 URL toggle**(沿用 ADR-0027 D5.3) — 进入 board 详情页从属性表开始, 符合"克制, 在场"
2. **入口 URL 沿用 `/requirements/[id]/board/[cardId]/`** — 不暴露 `/chat/` 子路由(Q12 r1)
3. **物理路径 = `board/tasks/<ulid>/chat/`** — 跟 ADR-0028 D1 沿用, 物理隔离父 transcript
4. **SDK session 路径 = `~/.claude/projects/<hash-of-cwd>/<sessionId>.jsonl`** — SDK 0.3.206 默认, 30 天 sweep
5. **Audit log 路径 = `~/.aidevspace/audit/<reqId>/<cardId>/chat.log`** — JSONL 格式, 跟 session 物理隔离
6. **触发 ADR-0023 D11 RED e2e 守门** — Provider 内部新增 chat 路径, 必先 test RED → GREEN 合入
7. **ADR-0028 D2 部分推倒** — "transcript 仅描述" 升级为 "完整 SDK session UI 镜像", 由 ADR-0029 supersede

### Persistence

8. **双轨持久化(Q5 p2)** — SDK 默认 `~/.claude/projects/<hash>/<sessionId>.jsonl` + 我们 `board/tasks/<ulid>/chat/session.json` 元数据
9. **17 项 session.json 字段** — sessionId, requirementId, cardId, cwd, additionalDirectories, model, permissionMode, permissionPromptToolName, mcpServers, createdAt, lastQueryAt, queryCount, ownerUserId, cumulativeCostUsd, cumulativeInputTokens, cumulativeOutputTokens, cumulativeCacheReadTokens
10. **写顺序契约** — SDK 首个 `system/init` 消息 → 立即 atomic 写 `session.json` → 写失败 → 走 fallback
11. **跨刷新恢复** — `GET /chat/sessions/.../snapshot` 拿 transcript + `POST /chat/sessions/.../query {content}` 触发新 query with resume(`d3`)
12. **严格单 tab(Q6 r1)** — 同 `(reqId, cardId)` in-flight query lock, 第二个 tab 弹提示
13. **SSE per query(Q6 c1)** — 不持有 session 句柄, server restart 兼容

### SDK 0.3.206 接入

14. **接入方式 = `query()` + `options.resume: string`**(Q3 c)
15. **集成策略 = `permissionPromptToolName: 'mcp__boardchat__user_confirm'` MCP tool**(Q3.4 b)
16. **cwd = `board/tasks/<ulid>/`** + **`additionalDirectories` = `[父 req dir, req.repos worktree paths]`**(Q4 c1 + r1)
17. **model 默认 = `claude-sonnet-5`**, 切 opus 弹 confirm
18. **permissionMode 默认 = `default`**, plan / bypassPermissions 切换由 UI 决定
19. **allowDangerouslySkipPermissions = true**(仅 bypassPermissions mode)
20. **skills = `'all'`** 默认(用户可隐藏)
21. **systemPrompt = 自定义 chat 角色**(待实现期定)
22. **persistSession = true**, enableFileCheckpointing = false(Q13 f2)
23. **30 天 SDK 默认 TTL** — sweep 触发后 health check `existsSync`, 失败走"重建 session" 路径

### 9 类 SSE 事件 (Q6.4)

24. SSE 事件 9 类 + sub-agent 4 类 = 13 类 server→web 事件

```
1. chat_session_init         { sessionId, cwd, model, tools, ... }
2. chat_message_user         { ts, content }
3. chat_message_assistant    { ts, content, partial: bool }    # 增量
4. chat_thinking             { ts, content }
5. chat_tool_call            { id, name, args, partial: bool }
6. chat_tool_result          { id, name, content, isError: bool }
7. chat_permission_request   { requestId, toolName, args, title, description }
8. chat_permission_resolved  { requestId, decision }
9. chat_error                { code, message }
10. chat_complete             { sessionId, totalTokens, cost, ... }
11. task_started              { task_id, description, agent_type }
12. task_progress             { task_id, summary }
13. task_completed            { task_id, result, duration_ms }
```

25. **stream_event 透传(Q7 s2)** — SDK 原始 Anthropic API 流事件原样推, web 端按 20ms 打字机渲染
26. **task_* 事件透传(Q7 t2)** — sub-agent 事件原样推, web 端嵌入 UI 渲染
27. **message 增量(Q7 m1)** — 流式打字机 UX, 20ms 节奏 web 端控

### Permission Flow

28. **policy(Q2 p2)** — 读工具自动 / 写工具弹 modal
29. **modal 形态(Q2 p.X.3)** — 顶部 `🛡️ Auto-allow` 开关, 开 = bypassPermissions, 关 = `permissionPromptToolName` MCP tool 拦截
30. **timeout(Q2 t1)** — modal 阻塞直到用户响应(timeout 报错但目前 SDK 不报,我们 strick 等)
31. **敏感模式永弹(Q2 额外)** — `{rm -rf /, chmod 777, mkfs, dd, git push --force, curl | sh}` 即使 auto-allow on 也弹
32. **MCP tool handler 返 `updatedPermissions`** — 实现 [Allow session] 增量加白名单
33. **permissionPromptToolName MCP tool** — 这是核心拦截点, provider 内部实现自起

### Plan Mode

34. **触发(Q10 t1)** — 顶部 `<UsageBar>` 手动 toggle, 默认 off
35. **modal(Q10 u2)** — 单独 `<PlanModePrompt>` 组件, plan 渲染为 markdown
36. **accept transition(Q10 e1)** — 接受后自动切 `default` mode, AI 继续执行
37. **modify** — 弹子输入框, 改完发到 chat
38. **auto-allow 互斥(Q10.4)** — auto-allow on 时 plan toggle disabled

### Cost / Tokens

39. **`<UsageBar>` 实时显示(Q8 v1)** — model / tokens / cost / turns / duration + sub-agent tokens sub-line
40. **切 model 弹 confirm(Q8 m2)** — 切 opus 弹 "单价比 Sonnet X 倍, 确认?"
41. **单 session cap $5(Q8 o2)** — 超 cap 弹 `<CostCapModal>` 4 选项
42. **不引入** — workspace 配额 / 单 query 上下文 cap / auto-compact / multi-user 协作(留 P2)

### Sub-agent UI

43. **嵌入 assistant message(Q11 c1)** — `<details>` 块作 assistant 内子块
44. **嵌套缩进(Q11 d2)** — sub-sub-agent 缩进 1 级, 等等
45. **4 状态视觉(Q11 v1)** — 启动 / 进度 / 完成 / 失败
46. **不加 sticky top active bar(Q11.4)** — 取消
47. **UsageBar sub-line 显示含 sub-agent tokens(Q11.5 y)**
48. **permission 继承 main session policy**(Q11.6) — 不引入 per-sub-agent policy

### Audit

49. **独立 audit log(Q14 a3)** — `~/.aidevspace/audit/<reqId>/<cardId>/chat.log`
50. **8 字段 audit 记录(Q14.2)** — `ts, toolName, toolUseId, args, result, decision, decidedBy, durationMs`
51. **30 天保留, 跟 SDK session 同步 sweep**

### 守门契约

52. **触发 ADR-0023 D11 RED e2e** — `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` 必加新 RED 测试
53. **Provider 内部新增 chat 路径** — 与 `runAnalysisQuery` 命名空间分离, 不污染
54. **`mcpCallCounter` 不被 chat 路径触碰** — 物理上 chat 路径不进入 runAnalysisQuery 闭包

## Testing Decisions

### 3-seam 体系

**Seam 1 (E2E, 最高)** — `apps/web/e2e/board-chat.spec.ts` (新建)

- Playwright 驱动浏览器完整流程
- 覆盖:
  - 打开 board 详情页 → 验证右栏默认属性态
  - 点 `[💬 在对话中打开]` → 切换 transcript toggle → 看到 chat 框
  - 输入消息发 → 看到 AI 流式出现(text + thinking)
  - AI 触发 Write tool → 弹 `<PermissionPrompt>` modal
  - 点 [Allow] → 看到 tool result + 后续 AI 继续
  - 切 model dropdown → 弹 confirm modal
  - 切 plan mode → AI 给 plan → 弹 `<PlanModePrompt>` modal
  - 点 [Accept] → AI 切 default mode 执行
  - cost 触 $5 → 弹 `<CostCapModal>` 4 选项
  - 刷新页面 → 历史 transcript 完整恢复 → 续对话
  - 开 2 个 tab → 第二个 tab 弹 "已在另一 tab 打开"
- 优先: web 端真实交互全链路

**Seam 2 (Agent 集成, RED e2e 守门)** — `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` (扩展)

- 构造真 `ClaudeCodeProvider` 实例 + mock SDK `createSdkMcpServer` / `tool` / `query`
- 覆盖 chat 路径 SDK 内部协议经过 wrapper 闭包一次
- 覆盖:
  - chat query 启动 → system/init 收到 sessionId → session.json 落盘
  - permissionPromptToolName MCP tool 触发 → handler 收 SDK 入参 → 推 SSE → 收决议 → 返 `PermissionResult`
  - stream_event 透传 → 9 类 SSE 事件 mapping
  - tool_use_id 唯一性
  - resume 协议: `options.resume: sessionId` 加载 SDK jsonl
- 必先 RED 后 GREEN 才能合入(ADR-0023 D11 守门契约)

**Seam 3 (Web 组件)** — `apps/web/src/__tests__/board/board-chat-panel.test.tsx` (新建)

- RTL 组件测试, mock SSE 流
- 覆盖:
  - `<UsageBar>` 渲染 model / tokens / cost / turns / duration + sub-agent sub-line
  - `<PermissionPrompt>` 渲染 modal + 3 选项 + decision 决议
  - `<PlanModePrompt>` 渲染 plan markdown + 3 选项
  - `<CostCapModal>` 4 选项
  - `<SubAgentBlock>` 4 状态视觉 + 嵌套缩进
  - `<ToolCallBubble>` 渲染 args + result
  - Transcript 容器渲染 user / assistant 气泡 + SubAgent 嵌
  - 单 tab lock display

### 什么不该测

- **不测 SDK 内部协议** — SDK 0.3.206 行为不归我们
- **不测 PermissionResult 内部结构** — 测 MCP tool handler 跟 SDK 通讯就好
- **不测 fastify-sse 内部** — 测我们 emit 的事件 shape
- **不测 audit log 文件权限** — 测写入 + 字段

### Prior art

- `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` — 现有 RED e2e, 模仿的 test pattern
- `apps/agent/src/__tests__/board/board-transcript-route.test.ts` — 现有 route test, 复用 test fixture
- `apps/web/src/__tests__/board/board-card-detail-page.test.tsx` — 现有组件 test, 复用 RTL pattern
- `apps/web/e2e/board.spec.ts` — 现有 e2e, 复用 Playwright pattern

### 守门触发

- 任何 Provider 内部修改 → Seam 2 RED e2e 必须新增对应测试
- 任何 UI 组件逻辑变更 → Seam 3 React 组件 test 必须更新
- 任何 protocol 端点变更 → Seam 1 e2e 必须覆盖

## Out of Scope

- **Multi-user 协同** — board chat 当前 single-user, 多人协作留 P2
- **工作区配额 / 单 query 上下文 cap / auto-compact** — 留 P2
- **board chat 写入 / 改 TaskCard 字段** — 仍禁(ADR-0028 D2 部分保留, 由 permission sensitive-pattern 拦截)
- **board chat 触发 Run** — 仍禁, Run 走父 analyzing transcript 路径不变
- **File checkpointing 启用** — 留 P2, 后期用户有需要可开
- **深链 chat(URL 暴露)** — 留 P2, 默认 toggle 不深链
- **board chat 流式 SSE 新增 UI 状态**(e.g. 后台 thinking BouncingBall 动画)— 留 P2
- **board chat 跨 req 跨 workspace 转移** — 留 P2
- **board chat 写文件 → 触发 git commit 自动** — 留 P2
- **board chat 自动 suggest next prompt** — SDK 0.3.206 有 `promptSuggestions` 选项, 留 P2
- **mobile / 响应式 < 1280px** — 沿用 board detail 桌面端约束
- **Skill admin 上传 UI** — 沿用全局 Skill admin, board chat 不独立

## Further Notes

### 落地顺序(参考 board-section PRD 路径)

1. **Phase 1: Schema + 守门** — `packages/shared/src/board-chat.ts` + Seam 2 RED e2e 增量
2. **Phase 2: Server-side** — `apps/agent/src/services/board/ChatSessionService.ts` + `apps/agent/src/routes/board-chat.ts` + 我们的 `mcp__boardchat__user_confirm` MCP tool handler
3. **Phase 3: Audit log** — `apps/agent/src/lib/audit-log.ts` 独立 service
4. **Phase 4: Web 改造** — `CardTranscriptPanel` 大改 + `CardTranscriptInput` 拆成 `UsageBar` + `PermissionPrompt` + `PlanModePrompt` + `CostCapModal` + `SubAgentBlock` + `ToolCallBubble`
5. **Phase 5: Component tests** — Seam 3 React 测试
6. **Phase 6: E2E** — Seam 1 Playwright
7. **Phase 7: 守门 GREEN** — Seam 2 全部 RED → GREEN
8. **Phase 8: Web 端 attrs/特性** — sensitive-pattern 拦截, UI 细节

### 风险点

- **SDK 0.3.206 行为依赖** — mcpServers 重挂 / session_file 路径 / sessionId 命名 / resume 协议 — 实施期摸石头
- **permissionPromptToolName 协议** — 我们 MCP tool handler 跟 SDK 控制流同步, 错就阻塞工具
- **30 天 SDK sweep** — health check `existsSync` 在 SDK 文件路径, 实施期需精确知道路径
- **SSE 协议** — react-query SSE 集成 + 错误恢复, 实施期打补丁
- **Provider 内部 PR-4 状态隔离** — chat 路径要有自己的 counter, 跟 runAnalysisQuery 隔离

### 跟踪

- ADR-0029 草案: [docs/adr/0029-board-chat-sdk-session.md](docs/adr/0029-board-chat-sdk-session.md)
- sub-agent UI 原型: [docs/design/pages/board-chat-subagent.html](docs/design/pages/board-chat-subagent.html)
- ADR-0028 添加 `superseded-by: 0029` 字面改动待落地
- 实施 issues: 拆 9 个, 详见 `.scratch/board-chat/issues/`
- 14 轮 grilling 41 个决策, ADR-0029 D1-D17 落地

### 不在 ADR-0028 改动范围内

- ADR-0028 D1 / D3 / D5 / D6 物理路径与 UI 框架沿用
- ADR-0028 D2 / D4 范围推倒, 由 ADR-0029 supersede
- ADR-0028 D5 transcript schema 保留, 与 chat session 共存
- ADR-0028 transcript.yaml 旧数据不迁移, 走 (m1) 双轨
