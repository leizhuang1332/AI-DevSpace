# ADR-0010: Claude Code SDK 集成设计（10 问 grill 定稿）

**Status:** Accepted
**Date:** 2026-07-10
**Deciders:** 项目负责人
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 9, 12, 13, 24-26, 35, 38-49 / [ADR-0004](0004-claude-code-sdk-as-ai-engine.md)（本文为细化与修订）/ [ADR-0008](0008-skill-as-prompt-fragment.md) / [ADR-0009](0009-ai-failure-defense.md)
**Supersedes:** ADR-0004 中关于"每需求一个 SDK 子进程"的描述（被本文 Q3/Q4 修订）

## Context

ADR-0004 决定了"通过 Claude Code SDK subprocess 调 AI"作为产品技术路线，但未细化：
- SDK 怎么调（query API 形态）
- AIProvider 抽象边界
- Subprocess 怎么管理（每 req 一进程？池？idle？）
- 多 session 并行写代码怎么避免冲突
- System prompt 怎么装配
- 工具权限怎么映射
- session 怎么持久化
- 错误怎么处理
- 模型怎么选（含 cc-switch 集成）
- 观测性怎么落地

`/grill-with-docs` 会话逐项击破 10 个根问题（Q1-Q10），形成本 ADR，作为 SDK 集成的实施 blueprint。

## Decision

### Q1 — SDK 选择

**采用 官方 TypeScript SDK `@anthropic-ai/claude-code`（[npm](https://www.npmjs.com/package/@anthropic-ai/claude-code)）**

- Agent 端 `import { query } from '@anthropic-ai/claude-code'`
- SDK 内部 `child_process.spawn('claude', [...])`，对外暴露 `AsyncIterable<SDKMessage>` 流
- 类型完整、官方维护、隐藏 spawn 细节
- 「切换 Codex / Opencode SDK」时，`AIProvider` 抽象层是切换点

### Q2 — AIProvider 抽象接口

**采用 显式 `AISession` 会话对象 + `AIEvent` 联合类型**

```ts
interface AIProvider {
  createSession(reqId, opts): Promise<AISession>
}

interface AISession {
  readonly id: string                // 持久化 id，跨重启不变
  readonly reqId: string             // 父需求
  readonly kind: 'chat' | 'task'     // 对话型 vs 任务型
  readonly topic: string             // 用户起的名字 / 系统生成
  readonly state: 'idle' | 'busy' | 'closed' | 'errored'
  send(text, attachments?): Promise<void>
  events: AsyncIterable<AIEvent>
  cancel(reason?): Promise<void>
  close(): Promise<void>
}

type AIEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string; delta?: boolean }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'file_written'; path: string; lines: number }
  | { type: 'permission_request'; tool: string; input: unknown }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'done'; reason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens' }
```

事件粒度走"SDK 事件 → 业务事件"二段映射，不直接透传 SDK message——上层不依赖 SDK 升级。

### Q3 — Subprocess 生命周期

**每 query 瞬时 spawn，sessionId resume 续上下文**

- 每次 `query()` 内部 spawn 一次 SDK CLI 进程，流完即退
- 「session」= 逻辑身份（UUID + 磁盘 jsonl），不是常驻进程
- 多轮对话 = 多次 `query()` 调用，第二次起传 `options.resume: <sessionId>`
- 跨重启保留 = SDK 自管 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`

**推翻 ADR-0004 "每需求一个独立 SDK 子进程"假设。**

**衍生命名 / 配额：**
- 不限制 per-req session 数量上限（per-Agent 全局 in-flight 上限 5，见 Q8.3）
- session 不回收 = subprocess 不回收 = session 死 = subprocess 死

### Q4 — 写冲突策略

**采用 A：共享 req worktree + per-req 写操作 FIFO 队列**

- 不引入 per-session worktree（已被推翻——会让"需求主版本"模糊、路径膨胀、与现有 [ADR-0003](0003-git-worktree-isolation.md) 冲突）
- 同一 req 内 N 个 session 共享 `requirements/<req-id>/repos/<repo-name>/` worktree
- Agent 维护 `Map<reqId, Promise>` 队列，对**写类工具调用**（Edit/Write/NotebookEdit/Bash 写命令）FIFO 串行
- 读类工具调用（Read/Grep/Glob/Bash 读命令）不限制，全并行

```ts
const writeQueues = new Map<reqId, Promise<void>>()
async function execWriteTool(reqId, toolCall) {
  const prev = writeQueues.get(reqId) ?? Promise.resolve()
  const next = prev.then(() => doToolCall(toolCall))
  writeQueues.set(reqId, next.catch(() => {}))
  return next
}
```

**用户场景自洽：**
- "讨论 / 扫描 / review / SQL 建议" 全部只读，不进队列
- "写代码 dev session" 一次只一个，偶发排队毫秒级
- "两个 dev session 同时改不同文件" 排队，AI 拿到工具错误自然让位

### Q5 — System prompt 装配

| 子项 | 决策 |
|---|---|
| Q5.1 策略 | **`appendSystemPrompt`**（追加，保留 Claude Code 内置 system prompt） |
| Q5.2 时机 | **混合** — base（per-session）：平台哲学 + Always-on Skills 全文；dynamic（per-query）：当前 focus + 99-summary + relevant Skill 反馈 |
| Q5.3 组织 | **分节 markdown**（`## Platform Philosophy` / `## Active Skills` / `## Current Context` / `## Skill Feedback`） |
| Q5.4 文件层级 | **严格按 Skill 自报家门**（Skill frontmatter `context:` 字段声明依赖文件，Agent 拼装时去重求并集） |

### Q6 — 工具权限映射（5 类高危 → SDK allowedTools）

| 子项 | 决策 |
|---|---|
| Q6.1 拦截层 | **SDK `PreToolUse` hook**（原生支持，能看 tool name + input，能做命令/内容检测） |
| Q6.2 粒度 | **per-req 默认 + per-session 覆盖**（多数 req 策略一样写在 meta.yaml） |
| Q6.3 授权交互 | **模态弹窗**（与决策 46「4 级曝光：Inline/Toast/模态/暂停」对齐） |
| Q6.4 Skill 越权 | **每次仍走用户确认**（Skill 是提示词封装，不能绕过防线——决策 46 硬约束） |

**5 类检测（具体）：**
| 类别 | 检测 |
|---|---|
| 删业务文件 | `Bash` 含 `rm ` 且非白名单；`Edit`/`Write` 目标在「不可碰」清单 |
| force-push | `Bash` 正则 `git push.*(-f\|--force)\b` |
| 推 main | `Bash` 命令解析后 target branch ∈ {main, master} |
| 敏感信息 | `Write`/`Edit` content 走 secrets 扫描（api_key= / Bearer / AKID） |
| 跳 verify | `Bash` 含 `--no-verify` / `--no-gpg-sign` |

### Q7 — 会话持久化

| 子项 | 决策 |
|---|---|
| Q7.1 ID 体系 | **双 ID + provider 字段** — `local_sid`（Agent 生成，永久稳定）+ `sdkSessionId`（SDK 返的）+ `provider`（per-session 标记所属 SDK） |
| Q7.2 存储 | **per-req 路径** — `requirements/<req-id>/sessions/<local_sid>/{meta.yaml, messages.jsonl, log.jsonl}` |
| Q7.3 resume | **完全自动**（Web 拉 session → Agent 调 SDK `query({ resume: sdkSessionId })`） |
| Q7.4 历史 source of truth | **Agent 维护本地 `messages.jsonl` 镜像**（SDK 内部 jsonl 仅供 resume；UI 展示走本地） |

**双 ID 方案的换 SDK 友好性：**
```
切到 Codex SDK（迁移时一次性批量处理）：
  local_sid: abc-123        ← 不变
  sdkSessionId: new-codex-sid   ← 新 SDK 续上下文
  provider: codex          ← 标记已迁移
```
路径 / URL / UI / Agent 内部 session 引用全部用 `local_sid`，与 SDK 解耦。

**meta.yaml 完整形态：**
```yaml
sid: 7f3a-9c2e-...
reqId: REFUND-001
provider: claude-code
sdkSessionId: xyz-789-...
created_at: 2026-07-10T...
last_active_at: 2026-07-10T...
topic: 退款功能开发
kind: chat
cwd: /Users/.../repos/order-svc
current_focus: writing-code
# ↓ 用户手选（Q9）
model:
  providerId: 617d65f9-1b20-...
  role: sonnet
```

### Q8 — 错误处理

| 子项 | 决策 |
|---|---|
| Q8.1 错误分类+重试 | A/C/D 重试（退避 1s/3s/10s 指数，最多 3 次），B/E 不重试 |
| Q8.2 取消 | **AbortController 传给 SDK**（跨平台，优雅清理） |
| Q8.3 限流 | **per-Agent in-flight 上限 5 + FIFO 等待**（与 Q4 写队列正交，职责分离） |
| Q8.4 错误 UI | Toast「重试中 (1/3)」/ StatusBar 红 / Chat 顶部条 / 业务错误自然流 |
| Q8.5 日志 | **per-session + 全局双层**（`sessions/<sid>/log.jsonl` + `~/.aidevspace/logs/agent.log`） |
| Q8.6 错误后 resume | **强制从中断点 resume**（已收到的 partial 写入 messages.jsonl 标 `incomplete: true`） |

**5 类错误：**
| 类型 | 例子 | 重试 |
|---|---|---|
| A SDK API 瞬时 | rate limit、5xx、timeout | ✅ |
| B SDK API 永久 | auth fail、quota exhausted | ❌ |
| C 进程错误 | spawn fail、CLI exit ≠ 0 | ✅ 1 次 |
| D 网络/IO | 连接断、socket timeout | ✅ |
| E 业务错误 | `error_max_turns` / agent 主动放弃 | ❌ |

### Q9 — 模型选择

**核心原则：Agent 不存任何 model 配置，cc-switch 是 source of truth**

| 子项 | 决策 |
|---|---|
| Q9.0 catalog | **不存**——只读 `~/.cc-switch/cc-switch.db` |
| Q9.1 粒度 | **两级**（session 显式选 > provider.main 兜底） |
| Q9.2 谁选 | **仅用户手选**（无 Skill required_model / 无 kind 自动选 / 无全局 default） |
| Q9.3 切模型 | sessionId 不变，仅改 settings.json.env |
| Q9.4 cost | **仅显示 token 数**（不显示 $，cc-switch 不存 pricing） |
| Q9.5 可用模型 | = cc-switch.db `providers` 表里 `app_type='claude'` 的所有 provider |
| Q9.6 缺省 | **provider 的 `settings_config.env.ANTHROPIC_MODEL`** |

**Agent 启动只读 cc-switch.db，构建内存索引：**
```ts
type ProviderIndex = {
  id: string
  name: string
  is_current: boolean
  baseUrl: string         // 来自 settings_config.env.ANTHROPIC_BASE_URL
  apiKey: string          // 来自 settings_config.env.ANTHROPIC_AUTH_TOKEN
  models: {
    main: string | null       // ANTHROPIC_MODEL
    haiku: string | null      // ANTHROPIC_DEFAULT_HAIKU_MODEL
    sonnet: string | null     // ANTHROPIC_DEFAULT_SONNET_MODEL
    opus: string | null       // ANTHROPIC_DEFAULT_OPUS_MODEL
    fable: string | null      // ANTHROPIC_DEFAULT_FABLE_MODEL
    reasoning: string | null  // ANTHROPIC_REASONING_MODEL
  }
}
```

**Model 解析（每次 query 时，唯一 2 级）：**
```
1. session.meta.model 存在？
   ├─ 是 → 查 (providerId, role) → model id → SDK query({ model: <id> })
   └─ 否 → 用 ProviderIndex.models.main（当前 provider 的 ANTHROPIC_MODEL）
2. （无其他任何 fallback / 无自动选 / 无 Skill 覆盖）
```

**切 provider / role 实现：写 `~/.claude/settings.json.env`（不写 cc-switch.db）。** cc-switch 启动时会 sync `is_current` 字段；暂时不同步不影响 Agent 工作。

**baseUrl 唯一源 = `settings_config.env.ANTHROPIC_BASE_URL`**（不 fallback 到 `provider_endpoints` 表）。

### Q10 — 观测性 / 日志

| 子项 | 决策 |
|---|---|
| Q10.1 日志层级 | **L1-L4 全做**（StatusBar / Chat / per-session log.jsonl / 全局 agent.log） |
| Q10.2 SSE | **N 条独立 SSE 通道**（per session，Web 按 sessionId 订阅） |
| Q10.3 活动流 | **折叠在 chat 气泡下方**（展开看，不主动弹；决策 43b） |
| Q10.4 状态 UX | **StatusBar 颜色静默更新**（不打扰） |

## Consequences

### 正面

- **"专业 harness 工程外包"** — AI 推理 / 工具调用 / 上下文管理 / sub-process / sessionId 续上下文全交给 SDK
- 本平台专注：**状态管理 + 上下文装配 + UI 协同 + Skill 编排**
- 升级 AI 能力 = 升级 SDK 版本即可
- **多 SDK 切换架构已落地**（Q7 双 ID + Q9 provider 字段），未来切 Codex / Opencode SDK 业务层零改动
- **多 provider 切换已落地**（Q9 + cc-switch 集成），切 DeepSeek / GLM / MiniMax / Kimi... 业务层零改动
- **不与 cc-switch 抢着维护 model catalog**（决策 9 哲学贯彻到底）
- 多 session 互不干扰（Q4 写串行 + Q8.3 全局 in-flight 限流）

### 负面 / 代价

- 锁定 Claude Code SDK 的 query 协议（短期可接受，已选官方 SDK）
- SDK 升级可能带来 breaking change（需 Agent 侧兼容层）
- **大量工程代码**：AIProvider / AISession / CcSwitchClient / WriteQueue / SystemPromptAssembler / PreToolUse hook / 5 类检测 / SseHub / 双层日志……
- **per-req 写串行**对极少数"两个 dev session 同时改不同文件"场景排队（毫秒级，AI 自然让位）
- **session 没显式选 model 时 = 用 provider.main**，用户可能不知道能选更好 model（依赖 UI 提示）

### 缓解措施

- AIProvider 抽象层封装 SDK 调用细节
- SDK 版本固定在 lockfile
- 关注 SDK 升级日志，及时适配
- UI 入口清晰：session 设置里 model 区块明示「当前 (provider, role)」
- PreToolUse hook 失败时降级为「默认拒绝 + 用户可一键放行」

## Alternatives Considered

### 已被推翻的方案

- **A. 自建 LLM 集成**：3+ 人月的 harness 工程量，性价比低
- **B. LangGraph / AutoGen 多 Agent 编排**：违反"单一 Agent + Skill"哲学
- **C. 每 session 独立 worktree**（Q4a 原始方案）：让"需求主版本"模糊、路径膨胀、git 不允许嵌套 worktree
- **D. Clone + per-session worktree**（用户提议）：同 C + 推翻 ADR-0003
- **E. per-session 常驻 SDK 子进程**（Q3 原始假设）：伪命题，sessionId resume 已能续上下文
- **F. 双 ID 改单 ID**（Q7 提案）：违反 ADR-0004「多 SDK 切换预留」
- **G. Agent 维护 model catalog**（Q9 提案）：跟 cc-switch 重复，必然漂移
- **H. LLM 预处理 context 文件相关性**（Q5.4 ③）：每 query 多花一次 API 调用，得不偿失

## 实施蓝图

```
apps/agent/src/
├── server.ts                    # Fastify server，REST + SSE
├── providers/
│   ├── AIProvider.ts            # 抽象接口
│   ├── ClaudeCodeProvider.ts    # @anthropic-ai/claude-code SDK 实现
│   └── CcSwitchClient.ts        # 读 ~/.cc-switch/cc-switch.db
├── session/
│   ├── AISession.ts             # session 对象
│   ├── SessionStore.ts          # session meta CRUD
│   ├── MessagesMirror.ts        # messages.jsonl 读写
│   └── ResumeManager.ts         # sessionId resume 逻辑
├── worktree/
│   ├── WorktreeManager.ts       # 复用 pool + worktree 模型
│   └── WriteQueue.ts            # per-req 写操作 FIFO 队列（Q4 核心）
├── prompt/
│   ├── SystemPromptAssembler.ts # base + dynamic + sectioned（Q5）
│   └── SkillLoader.ts           # Skill frontmatter 解析
├── tools/
│   ├── PermissionHook.ts        # PreToolUse hook 包装（Q6）
│   └── HighRiskDetector.ts      # 5 类高危检测
├── error/
│   ├── ErrorClassifier.ts       # 错误分类
│   ├── RetryStrategy.ts         # 退避重试
│   └── CircuitBreaker.ts        # per-Agent in-flight 限流
├── sse/
│   └── SseHub.ts                # N 条独立 SSE 通道（Q10）
├── log/
│   ├── SessionLogger.ts         # per-session log.jsonl
│   └── GlobalLogger.ts          # 全局 agent.log
└── config/
    └── Config.ts                # Agent config（极小，无 ai 节）
```

## 迁移路径

1. **Step 1**：写本 ADR-0010，标记 [ADR-0004](0004-claude-code-sdk-as-ai-engine.md) 中被修订的段落
2. **Step 2**：更新 [CONTEXT.md](../CONTEXT.md) 决策 9 / 12 反映新设计
3. **Step 3**：起 `.scratch/feature/sdk-integration/` 拆 P0-P6 任务
4. **Step 4**：跑 SDK query() spike 验证假设（特别：`model` 参数是否真接受 role 名 vs model id、sessionId resume 是否真能从中断点续）
5. **Step 5**：按 P0-P6 顺序实施

## 相关文档

- [ADR-0001](0001-hybrid-web-agent-architecture.md) — Web ↔ Agent 通信
- [ADR-0003](0003-git-worktree-isolation.md) — Worktree 模型（被 Q4 沿用）
- [ADR-0004](0004-claude-code-sdk-as-ai-engine.md) — 选型（被本 ADR 细化）
- [ADR-0008](0008-skill-as-prompt-fragment.md) — Skill 模型（与 Q5 配合）
- [ADR-0009](0009-ai-failure-defense.md) — 翻车防线（与 Q6 配合）
- [CONTEXT.md](../CONTEXT.md) 决策 9, 12, 13, 24-26, 35, 38-49
- `.scratch/feature/sdk-integration/` — 实施任务拆解
- `../.scratch/ai-devspace-mvp/issues/07-ai-chat-panel.md` — 既有 issue，需重写以反映新设计
