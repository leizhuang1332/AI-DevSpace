---
status: drafting
updated: 2026-08-09 · 14 轮 grilling 后起草
---

# Board chat panel = web 端 Claude Code CLI 可视化 UI 窗口(ADR-0029)

承接 ADR-0028 v1.0.7 锁定决策,本期迭代将 board 详情页 transcript panel 升级为**完整的 Claude Code CLI web 镜像** —— 完整暴露 chat、tool calling、shell、skill、MCP、sub-agent、plan mode、permission 等核心能力,让 web 端用户拥有与 CLI 等权的协作体验。

## 背景与现象

### 范式转变

| 维度 | ADR-0028(原) | ADR-0029(新) |
|---|---|---|
| 形态 | 描述型 transcript(仅描述、不挂 Run) | **完整 SDK session UI 镜像** |
| 角色 | 协作型 assistant(占位) | **Claude Code CLI web 等权** |
| 工具调用 | ❌ 禁用(ADR-0028 D2) | ✅ 完整 Read/Glob/Grep/Write/Edit/Bash/Skill/MCP/Sub-agent |
| 持久化 | `board/tasks/<ulid>/transcript.yaml` 一次写 | SDK session + 我们元数据双轨 |
| Resume | ❌ | ✅ 跨刷新 / 跨 tab 续同一 session |
| Permission | ❌ 无 | ✅ 读自动 + 写弹 modal + 敏感模式永弹 |

### 14 轮 grilling 决策摘要

| 维度 | 决策 |
|---|---|
| Scope | (s1) per-TaskCard |
| Lifecycle | (l2) resume |
| 旧 transcript 迁移 | (m1) 不迁移,双轨并存 |
| Permission policy | (p2) 读自动 + 写弹 modal |
| Permission modal | (p.X.3) 顶部「🛡️ auto-allow」会话开关 |
| Permission timeout | (t1) 阻塞直到用户响应 |
| 额外约束 | 敏感模式永弹 / 顶部 UsageBar / PermissionPrompt 组件 |
| SDK 接入 | (c) `query()` + `options.resume: string` |
| 集成策略 | (b) `permissionPromptToolName: 'mcp__boardchat__user_confirm'` |
| cwd | (c1) `board/tasks/<ulid>/` |
| 静态白名单 | `additionalDirectories` = 父 req dir + `Requirement.repos` worktree |
| 持久化 | (p2) 双轨 + 30 天 SDK TTL |
| 元数据字段 | 17 项(sessionId/cwd/model/permissionMode/... + 4 项 cost) |
| 写顺序 | SDK 拿到 sessionId → 立即 atomic 写 `chat/session.json` |
| Resume 协议 | (c1) SSE per query + (r1) 严格单 tab + (d3) snapshot + resubscribe |
| SSE 事件类型 | 9 类事件,见 D10 |
| 事件映射 | (s2) 透传 stream_event + (t2) 透传 task_* + (m1) 增量 |
| Cost | (v1) 顶部 UsageBar + (m2) 切 model confirm + (o2) $5 cap |
| Plan mode | (t1) 手动 toggle + (u2) 单独 modal + (e1) accept 自动切 default + (p.X.3) on 禁用 |
| Sub-agent UI | (c1) 嵌入 + (d2) 嵌套缩进 + (v1) 4 状态 + 不加 sticky top + UsageBar sub-line |
| 入口 URL | (r1) 沿用 toggle, 不暴露 URL |
| File checkpointing | (f2) 不启用(信任 git + 手动 revert) |
| Audit | (a3) 独立 audit log + 8 项字段 + `~/.aidevspace/audit/<reqId>/<cardId>/chat.log` |

## 决策

### D1. 范式

Board chat panel = web 端 Claude Code CLI 可视化 UI 窗口(以下统称 "board chat")。

Board chat **完整暴露** Claude Code CLI 核心能力:
- Chat (流式 token, 增量渲染)
- Tool calling (Read / Glob / Grep / Write / Edit / MultiEdit / NotebookEdit)
- Shell (Bash)
- Skill (`~/.claude/skills/` + `options.skills`)
- MCP (任意 user mcpServers + 我们的 `mcp__boardchat__user_confirm` permission tool)
- Sub-agent (Task 工具启动嵌套 agent)
- Plan mode (`permissionMode: 'plan'` + 自动 review)
- Permission (per-tool modal + session-level auto-allow toggle)

### D2. Scope

Board chat session 绑定实体 = **TaskCard**(per-TaskCard)。

持久化路径:`board/tasks/<ulid>/chat/session.json`(我们元数据) + `~/.claude/projects/<hash-of-cwd>/<sessionId>.jsonl`(SDK session log)。

**业务产物 vs 临时物**:
- 业务产物:TaskCard 自身的 transcript.yaml(保留 `<chat>` 段作为范围独立的协作说明)
- 临时物:Board chat session 自身、SDK session 30 天 sweep 后回归新建

### D3. Lifecycle

每次进入 board chat = resume 同一 session(跨刷新 / 跨 tab 完全续)。

**SSE 协议 + 严格单 tab**:
- 同一 `(requirementId, cardId)` 只允许一个 in-flight query
- 第二个 tab 打开 = server 端拒绝 + 提示"请关闭其他 tab"
- 跨刷新 = `GET /chat/sessions/.../snapshot` 拿 transcript + POST 新 query 带 `sessionId: resume`

### D4. SDK 接入

接入方式 = `query()` + `options.resume: string`(`sdk.d.ts:1761-1763`)。

| 字段 | 取值 |
|---|---|
| `options.resume` | SDK 首次 query 返回的 `sessionId`(我们写 `session.json` 后保留) |
| `options.cwd` | `board/tasks/<ulid>/` 绝对路径 |
| `options.additionalDirectories` | `[<req-dir>, <req-dir>/repos/<repo1>/, ...]` |
| `options.model` | `claude-sonnet-5` 默认, 切昂贵 model 走 (Q8 m2) 弹 confirm |
| `options.permissionMode` | `default` / `plan` / `bypassPermissions`(根据 UI toggle) |
| `options.permissionPromptToolName` | `'mcp__boardchat__user_confirm'` |
| `options.allowDangerouslySkipPermissions` | 仅 `bypassPermissions` 时设 `true` |
| `options.skills` | `'all'` 默认(用户可隐藏) |
| `options.systemPrompt` | 自定义 chat 角色(详见 D5) |
| `options.mcpServers` | `mcp__boardchat__user_confirm` + 用户配置 |
| `options.persistSession` | `true` |
| `options.enableFileCheckpointing` | `false`(Q13 (f2) 不启用) |

**首次 query** 流程:
1. Web POST `/chat/sessions/start` 收到 `sessionId: null`
2. Server 启动 `query({options: {cwd, additionalDirectories, ...}})` 无 `resume`
3. 首个 `system/init` 消息带 `sessionId` → server **立即 atomic 写** `chat/session.json`
4. Stream 正常推 SSE

**Resume query** 流程:
1. Web GET `/chat/sessions/.../snapshot` 拿 transcript
2. Web 渲染历史
3. Web POST `/chat/sessions/.../query {content}` 触发新 turn
4. Server 读 `session.json` → 拿 `sessionId` → 启动 `query({options: {resume: sessionId, ...}})`
5. 流式 SSE

### D5. 集成策略 — permissionPromptToolName MCP tool

`options.permissionPromptToolName: 'mcp__boardchat__user_confirm'` 是 SDK 0.3.206 提供的官方 permission flow 接入点。

**架构**:
```
SDK 触发 Write tool → SDK 路由到 mcp__boardchat__user_confirm
  ↓
我们的 MCP tool handler 接 SDK 入参:
  { toolName, input, requestId, displayName, title, description, signal, ... }
  ↓
handler 推到 SSE 给 web: chat_permission_request
  ↓
web 弹 <PermissionPrompt> 组件
  ↓
user 点 [Allow once] / [Allow session] / [Deny]
  ↓
web POST /chat/sessions/.../permission {requestId, decision}
  ↓
server 收决议 → handler 返 {behavior: 'allow' | 'deny', updatedPermissions: [...]}
  ↓
SDK 继续执行 Write(或终止)
```

**`updatedPermissions` 用法**:
- 决议 [Allow session] → 加 `{type: 'addRules', rules: [{toolName: 'Bash', ruleContent: 'pytest:*'}], behavior: 'allow', destination: 'session'}`
- 决意 [Allow directory] → 加 `{type: 'addDirectories', directories: [<new-dir>], destination: 'session'}`

### D6. cwd

| 字段 | 取值 |
|---|---|
| `options.cwd` | `<workspaceRoot>/requirements/<req-id>/board/tasks/<ulid>/` |
| `options.additionalDirectories[0]` | `<workspaceRoot>/requirements/<req-id>/` |
| `options.additionalDirectories[1..N]` | `<workspaceRoot>/requirements/<req-id>/repos/<repo1>/`, `<...>/<repo2>/`, ... |

**派生规则**:
- cwd 一定包含 `<board-chat-session.json>` 父目录
- addDirs 至少包含父 requirement dir(让 AI 看到 PRD / analyzing / wrapup)
- addDirs 包含 `Requirement.repos` 全部 worktree 路径(`attachRepos` 创建的真实路径)
- 跨 cwd 写 = SDK 拒绝(无须上层拦截)

### D7. Model

- 默认 model: `claude-sonnet-5`
- 切换昂贵 model (opus): web 端 dropdown 改 → PUT `/chat/sessions/.../model` → `session.json.model` 字段更新 → 下次 query 走 `options.model`
- 切 opus 弹 confirm modal "<Opus 4.8 单价约 X 倍 Sonnet, 确认切?>"
- 切换回 sonnet 不弹 confirm

### D8. 预算

- 顶部 `<UsageBar>` 实时显示 session 累计 `tokens / cost / turns / duration` + sub-agent tokens 子行
- 单 session cost cap = `$5`, 累计超 $5 弹 `<CostCapModal>` "已超 $5,继续?"
  - [继续一次] / [继续本 session] / [暂停] / [新建 session]
- 不引入 workspace 配额 / 单 query 上下文 cap / auto-compact(YAGNI,留 P2)

### D9. Resume 协议

**Server 模型**:SSE per query,**不持有 session 句柄**。

**Tab 行为**:严格单 tab(同 `(reqId, cardId)` in-flight query lock)。

**断连恢复**(issue 16 修订 — 适配 SDK 0.3.206 协议变更):
```
web 刷新页面
  ↓
GET /chat/sessions/.../snapshot → 拿完整 transcript
  ↓
渲染历史
  ↓
POST /chat/sessions/.../query {content} → 触发新 query
  ↓
  优先:resumeSessionId = URL sessionId(我们 server UUID)
       → SDK 找不到对应 jsonl(sessionId 解耦,见 D9a)
       → issue 13 自愈:chat_error E_SESSION_EXPIRED
       → web 调 reset → 自动重 /start → 创新 server UUID → 创新 SDK session
  fallback:SDK 接受 resume(罕见,SDK 内部 sessionId 漂移对齐时)
  SSE 流式推送 chat_message_assistant 等
```

**单 tab lock**:
- Server 端: `chatSessionLock: Map<sessionKey, Promise<void>>`
- 同 key 第二个 query = 等待第一个完成 / 拒绝
- Web 端: lock 时 input box disabled + 顶部 "⚠️ 此 chat 已在另一 tab 打开"

### D9a. sessionId 语义重定义(issue 16)

**原语义**(D9 草案,被 issue 16 修订):

- `session.json` 的 `sessionId` = SDK 提供的 sessionId
- SDK 内部 sessionId = 我们 sessionId(一对一)
- 跨刷新恢复靠 SDK `options.resume: sessionId` 协议

**新语义**(issue 16,适配 SDK 0.3.206):

- `session.json` 的 `sessionId` = **server 端 `randomUUID()`**,用作前端会话标识 + URL path
- SDK 内部 sessionId = SDK 自行生成(藏于 `Query` 实例 / CLI subprocess),**不对外暴露**
- 两者**解耦**;不假设相等;不通过 `session.json` 表达 SDK sessionId

**SDK 0.3.206 协议根因**(issue 16 探底确证):

1. SDK 0.3.206 `Query` interface 全部方法都是控制平面方法,**没有 `sessionId` 字段**(类型层不暴露)
2. `Query.initializationResult()` 返回的 `SDKControlInitializeResponse` 字段是 commands/agents/models/account,**没有 sessionId**
3. sdk.mjs bundle 中 `subtype:"init"` 字面量 0 处 —— SDK **不在 user-facing stream emit `system/init`** 给 `for await` 调用方
4. 唯一带 sessionId 的类 `DirectConnectTransport.getSessionId()` 是远程 managed session 专用,本地 spawn CLI 路径不可用

**新流程**(`/start`):
```
1. server 端 randomUUID() = serverSessionId
2. Provider.runChatQuery({ prompt: '' })  fire-and-forget
   → SDK 内部创 session + 落 ~/.claude/projects/<hash>/<sid>.jsonl
   → SDK throw / 失败 → log warn 不阻断
3. ChatSessionService.getOrCreateSession(serverSessionId) → 立即落 session.json
4. 返 200 { meta: { sessionId: serverSessionId, ... } }
```

**新流程**(`/query`):
```
1. URL sessionId = server UUID
2. resumeSessionId = server UUID 传 SDK
3. SDK 找不到对应 jsonl → 失败
4. Provider 报 isSessionExpired=true(issue 13 信号)
5. /query handler 推 SSE chat_error { code: 'E_SESSION_EXPIRED' }
6. web 端 useChatSessionStream 收到 → 自动 useChatSessionReset
7. reset 端点删 stale session.json + audit/ + SDK jsonl
8. web 重发 /start → 拿新 server UUID → AI 正常回复
```

**跨刷新恢复**(D9 修订):

- **primary 路径**: transcript events + 我们 session.json(不依赖 SDK resume)
- **secondary 路径**(SDK resume 偶尔生效时,可优化): web 端 `useChatSessionStream` 仍走 `/query` 触发新 turn,SDK 内部 session 偶尔能 match 时跳过自愈直接回复

**新约束**(issue 16 How to apply):

1. 不再假设 SDK emit session_init
2. 不再假设 SDK 内部 sessionId === session.json.sessionId
3. SDK bootstrap / fire-and-forget 失败 → log warn 不阻断
4. 跨刷新恢复靠 transcript events + 我们 session.json(SDK resume 降为 secondary)
5. 改 `ClaudeCodeProvider` chat 路径 → RED → GREEN(ADR-0023 D11 守门)

### D10. SSE 事件类型

9 类 SSE 事件,server 推 web 端:

1. `chat_session_init` — SDK `system/init` 消息,带 `sessionId, cwd, model, tools`
2. `chat_message_user` — 我们生成的 user 消息
3. `chat_message_assistant` — SDK `assistant` 消息, 增量渲染(text / thinking block)
4. `chat_tool_call` — SDK `assistant` 消息 + `tool_use` block(部分完成 + 完整)
5. `chat_tool_result` — SDK `user` 消息 + `tool_result` block
6. `chat_permission_request` — 我们 MCP tool handler 推
7. `chat_permission_resolved` — handler 决议后推
8. `chat_error` — SDK `error` 消息
9. `chat_complete` — SDK `result` 消息, 终态

**额外 sub-agent 事件**:
- `task_started` / `task_progress` / `task_notification` / `task_completed` (Q7 (t2) 透传)

### D11. 守门

**触发 ADR-0023 RED e2e 守门**(`apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts`):

- 任何 `apps/agent/src/providers/ClaudeCodeProvider.ts` 修改必先 RED 后 GREEN
- 新增 chat 路径 = Provider 内部新增方法, e2e 测试必须覆盖新路径 SDK 调用、permission flow、stream event 解析
- 现有 `runAnalysisQuery` / `createSdkMcpServer` / `mcpCallCounter` 全部不动

### D12. 既存数据

- 旧 transcript.yaml 不迁移(D2 决策 m1)
- 旧 user 消息保留在 `board/tasks/<ulid>/transcript.yaml` 不动
- 旧 board chat panel 顶部 banner 提示 "📦 旧的描述型对话存档在下方,新 chat 框是 SDK session"
- UI 选项: collapse 旧 transcript section(默认折叠)

### D13. 决策 31 / 32 / 49 延续

| 决策 | 在本 ADR 的应用 |
|---|---|
| 决策 31 SSE(用 `@fastify/sse`,不用 WebSocket) | 沿用, board chat 走 SSE |
| 决策 32 打字机 20ms/字符 | 沿用, web 端 token 渲染节流 20ms |
| 决策 49 AI 思考条 4 指示器 | board chat 顶部 UsageBar 是本地化, 跟全局 AI 思考条并行 |

### D14. Sub-agent UI

- 容器形态: `<details>` 块嵌入 assistant message 内
- 嵌套: sub-sub-agent 缩进 1 级,sub-sub-sub-agent 2 级, 等
- 状态: 4 状态视觉(启动 / 进度 / 完成 / 失败)
- 不加 sticky top active bar
- UsageBar sub-line 显示含 sub-agent tokens

### D15. 入口 URL

沿用 `/requirements/[id]/board/[cardId]/`(Q12 (r1)):
- 不暴露 `/chat/` 子路由
- chat 仍是 toggle 展开态(ADR-0027 D5.3 沿用)
- sessionId 完全 server-side

### D16. Audit

- 独立 audit log `~/.aidevspace/audit/<reqId>/<cardId>/chat.log`
- 格式 JSONL,每行 1 条记录
- 8 项字段:`ts, toolName, toolUseId, args, result, decision, decidedBy, durationMs`
- 30 天保留,跟 SDK session 同步 sweep
- 跟 session.json 元数据**物理隔离**, 不污染
- 跟 Run 体系**不混淆**(chat ≠ Run)

### D17. File Checkpointing

不启用 SDK `enableFileCheckpointing`:
- 信任 git + 用户手动 revert
- 撤销 AI 写文件 = `git checkout` / `git stash`
- 性能 0 开销
- 跟 (Q13 f2) 决策一致

## 不在范围内

- **Plan mode UI 完整流程留 impl 阶段** — D10 + UX 形态已定, 实施期跟 SDK ExitPlanMode 协议对齐
- **Multi-user 协同** — board chat 当前 single-user(单 tab lock),多人协作留 P2
- **工作区配额 / 单 query 上下文 cap / auto-compact** — 留 P2
- **board chat 写入 / 改 TaskCard 字段** — 仍禁(ADR-0028 D2 部分保留, 由 permission sensitive-pattern 拦截)
- **board chat 触发 Run** — 仍禁, Run 走父 analyzing transcript 路径不变
- **File checkpointing 启用** — 留 P2, 后期用户有需要可开
- **深链 chat(URL 暴露)** — 留 P2, 默认 toggle 不深链

## 主要取舍

- **舍弃 (p1) 纯 SDK 格式** — 选 (p2) 双轨,因为 SDK 30 天 sweep + cwd 跨 workspace 移动 = 双轨保险
- **舍弃 (c2) 长寿命 session server 持有** — 选 (c1) SSE per query, 因为 server restart 兼容 + 内存压力 0
- **舍弃 (r2) 多 tab 共享** — 选 (r1) 严格单 tab, 因为 SDK 同一 sessionId 并发 resume 不保护(race)
- **舍弃 (c4) cwd + addDirs 白名单** — 选 (c1) cwd + static addDirs, 实现简单 + 用户进入就知道 AI 看哪些
- **舍弃 (a4) Run 体系 audit** — 选 (a3) 独立 audit, 因为 chat ≠ Run, 物理隔离减少耦合
- **舍弃 (f1) checkpointing 默认 on** — 选 (f2) 不启用, 信任 git + 性能 0 开销
- **舍弃 (c3) 独立 sidebar sub-agent** — 选 (c1) 嵌入 assistant, 跟对话流视觉一致
- **舍弃 (r2) `/chat/` 子路由** — 选 (r1) 沿用 toggle, 0 URL 改动 + 跟 ADR-0027 D5.3 沿用

## 关联

### 上游

- ADR-0027 — board section 引入 + 5 列布局 + 详情页 toggle 双态
- ADR-0028 — TaskCard transcript 物理独立 + Run 路径不动(本 ADR 范围超越 ADR-0028 D2, 沿用 D1/D3 物理存储路径)
- ADR-0023 — Analysis Run MCP 守门(本 ADR 触发 RED e2e 守门)
- ADR-0021 — Analysis Run 协议(运行不动, chat 路径独立)
- 决策 31 (SSE) / 决策 32 (打字机) / 决策 49 (AI 思考条 4 指示器)

### 下游

- 实施期: `apps/agent/src/providers/ClaudeCodeProvider.ts` 新增 chat 路径, 触 ADR-0023 RED e2e
- 实施期: `apps/agent/src/services/board/ChatSessionService.ts` 新建
- 实施期: `apps/agent/src/routes/board-chat.ts` 新建
- 实施期: `apps/web/src/components/board/detail/CardTranscriptPanel.tsx` 大改
- 实施期: `apps/web/src/components/board/detail/CardTranscriptInput.tsx` 拆成 input + UsageBar + PermissionPrompt
- 实施期: 新建组件 `<UsageBar>` / `<PermissionPrompt>` / `<PlanModePrompt>` / `<CostCapModal>` / `<SubAgentBlock>` / `<ToolCallBubble>`
- 实施期: `apps/web/src/lib/board-chat-hooks.ts` 新建
- 实施期: `packages/shared/src/board-chat.ts` 新建 schema
- 实施期: `apps/web/src/lib/audit-log.ts` 新建

### 实施位置

- Server `chat/session.json` 路径: `board/tasks/<ulid>/chat/session.json`
- Audit log 路径: `~/.aidevspace/audit/<reqId>/<cardId>/chat.log`
- HTML 原型: [docs/design/pages/board-chat-subagent.html](docs/design/pages/board-chat-subagent.html)(sub-agent UI 8 方案对比)
- 入口 URL: `/requirements/[id]/board/[cardId]/`(沿用,不暴露 chat)
- 守门测试: `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` 必加新 RED 测试

## 守门契约

- 本 ADR 任何 Provider 内部修改必须先 RED 后 GREEN
- 现有 `runAnalysisQuery` / `createSdkMcpServer` / `mcpCallCounter` 全部不动
- 新增 chat 路径独立于 Run 路径, 命名空间分离
- 决策 31 / 32 / 49 沿用, 不需要新立
- ADR-0028 D2 部分保留(D12 既存数据迁移策略), D4 部分保留(D11 守门契约)
- ADR-0029 修改 = 走 ADR-0029 review 流程, 不直接改 ADR-0028 字面
