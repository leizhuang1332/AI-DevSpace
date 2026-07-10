---
Status: ready-for-human
Type: prd
Created: 2026-07-10
Feature: sdk-integration
Depends on: ADR-0010
---

# SDK Integration — Claude Code SDK 在 Agent 端的实施

> 把 [ADR-0010](../../docs/adr/0010-claude-code-sdk-integration.md) 的 10 个 Q 决策落到 `apps/agent/src/`。

## 1. 背景

`/grill-with-docs` 会话 2026-07-10 跑完 10 个根问题（Q1 SDK 选择 → Q10 观测性），形成 ADR-0010。本 PRD 把决策拆成 6 个可执行的工程任务（P0-P6）。

## 2. 范围

- 6 个 Phase 任务，从骨架到端到端联调
- 实施模块路径与 ADR-0010「实施蓝图」节一致
- 依赖 `apps/agent` 已有骨架（[Issue 03](../../ai-devspace-mvp/issues/03-agent-skeleton.md)）

## 3. 验收总览

| 阶段 | 内容 | 估时 | 关联 issue |
|---|---|---|---|
| P0 | 骨架：Fastify server + CcSwitchClient + AIProvider 接口 + AISession 最小实现 + 1 条 SSE 通道 | 1 周 | [01-p0-skeleton.md](issues/01-p0-skeleton.md) |
| P1 | 写队列：WorktreeManager + WriteQueue FIFO（Q4 核心） | 0.5 周 | [02-p1-write-queue.md](issues/02-p1-write-queue.md) |
| P2 | System prompt + 5 类高危 hook | 1 周 | [03-p2-prompt-tools.md](issues/03-p2-prompt-tools.md) |
| P3 | 持久化：SessionStore + MessagesMirror + ResumeManager | 1 周 | [04-p3-persistence.md](issues/04-p3-persistence.md) |
| P4 | 错误处理：ErrorClassifier + RetryStrategy + CircuitBreaker | 0.5 周 | [05-p4-errors.md](issues/05-p4-errors.md) |
| P5 | 观测：SessionLogger + GlobalLogger + N SSE 通道 | 0.5 周 | [06-p5-observability.md](issues/06-p5-observability.md) |

**总计：~5 周 MVP**

## 4. 非范围（明确不做）

- Web 端集成（`apps/web` 不动，由 [Issue 07-ai-chat-panel](../../ai-devspace-mvp/issues/07-ai-chat-panel.md) 重写承担）
- 切换到 Codex / Opencode SDK 的实际迁移（ADR-0010 留了接口，本次只跑通 Claude Code SDK）
- Skill 系统改造（[ADR-0008](../../docs/adr/0008-skill-as-prompt-fragment.md) 单独负责）
- AI 翻车防线 UI 层（[ADR-0009](../../docs/adr/0009-ai-failure-defense.md) 单独负责）

## 5. 前置 Spike

`@anthropic-ai/claude-code` SDK 的实际行为需先验证（特别是 `model` 参数是否真接受 role 名 vs model id、sessionId resume 是否真能从中断点续），不能等所有 P0-P5 都写完才发现假设不成立。

- **Spike 输出**：`apps/agent/spike/sdk-spike.ts`（最小 demo，能跑能记发现）
- **Spike 文档**：`.scratch/feature/sdk-integration/spike-notes.md`

## 6. 决策来源

所有设计选择详见 [ADR-0010](../../docs/adr/0010-claude-code-sdk-integration.md)。本 PRD 不重复设计，只列落地任务。
