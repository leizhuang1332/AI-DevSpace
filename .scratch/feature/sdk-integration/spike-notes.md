# SDK Spike 笔记

**目的：** 验证 [ADR-0010](../../docs/adr/0010-claude-code-sdk-integration.md) 中关键假设的真实行为。

**关联：** `.scratch/feature/sdk-integration/issues/01-p0-skeleton.md`

---

## 假设清单

| # | 假设 | 验证方式 | 状态 |
|---|---|---|---|
| H1 | `query()` 返回 `AsyncIterable<SDKMessage>`，流式产出 | 控制台 log | ⏳ 待跑 |
| H2 | `model` 参数接受 role 名（如 `'sonnet'`） | Spike A1 | ⏳ 待跑 |
| H3 | `model` 参数接受 model id 字符串（如 `'MiniMax-M3[1M]'`） | Spike A2 | ⏳ 待跑 |
| H4 | `resume: <sdkSessionId>` 续上下文（第二 query 提到第一 query 的内容） | Spike B | ⏳ 待跑 |
| H5 | 首次 `query()` 推回的 system 消息含 `session_id` | Spike B 拿 sid | ⏳ 待跑 |
| H6 | `cc-switch.db` 当前 `is_current=1` 的 provider 可被 Agent 读出 | `loadCcSwitchIndex()` 打印 | ⏳ 待跑 |
| H7 | `settings_config.env.ANTHROPIC_*_MODEL` 字段存在并可解析 | 控制台打印 models 表 | ⏳ 待跑 |
| H8 | `settings_config.env.ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 存在 | 控制台打印 baseUrl | ⏳ 待跑 |

---

## 跑 spike 的步骤

### 1. 装依赖

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
pnpm add @anthropic-ai/claude-code better-sqlite3
pnpm add -D @types/better-sqlite3 tsx
```

### 2. 跑 spike

```bash
cd d:/TraeProject/AI-DevSpace/apps/agent
pnpm tsx spike/sdk-spike.ts
```

### 3. 复制输出

把控制台完整输出贴到本文件「跑出来的结果」节。

---

## 跑出来的结果

> ⏳ **TODO**：跑完 spike 后粘贴输出

```
（粘贴处）
```

---

## 假设验证矩阵

> ⏳ **TODO**：跑完后填

| 假设 | 状态 | 备注 |
|---|---|---|
| H1 | ⏳ | |
| H2 | ⏳ | |
| H3 | ⏳ | |
| H4 | ⏳ | |
| H5 | ⏳ | |
| H6 | ⏳ | |
| H7 | ⏳ | |
| H8 | ⏳ | |

---

## 如果假设不成立（应急方案）

### H2 / H3 不成立（model 参数只接受其中一种）

- 只能接受 role 名 → Agent 永远在 SDK 调之前做 (providerId, role) → model id 解析
- 只能接受 model id → Agent 拿不到 role 名这个 UI 抽象，必须直接展示 model id

**应对：** 不影响 P0-P6 整体设计，只是 UI 抽象层级调整。

### H4 不成立（resume 不工作）

- Agent 必须维护完整的对话历史，自己 replay 给 SDK（context self-management）
- 等于部分自建 harness

**应对：** 大改 [ADR-0010 Q3](README.md)——需要实现「消息 replay」机制。估时从 5 周 → 8 周。

### H5 不成立（system 消息不含 session_id）

- Agent 无法从 SDK 拿到 sdkSessionId
- 只能 Agent 自己生成 UUID 作为 sessionId，SDK 接受外部传入的 sessionId（需验证）
- 或者完全废弃 sessionId 机制，每次 query 都重传全部历史

**应对：** 视具体协议改 [Issue 04-p3-persistence.md](issues/04-p3-persistence.md)。

### H6 / H7 / H8 不成立（cc-switch.db schema 与我们假设不同）

- CcSwitchClient 改 schema 解析
- 视具体差异调整
