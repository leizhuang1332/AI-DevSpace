# ADR-0004: 通过 Claude Code SDK 调用 AI（外包 harness）

**Status:** Accepted  
**Date:** 2026-07-08

## Context

产品核心是 AI 辅助的后端开发。AI 推理的实现方式有：

- **自建 LLM 集成**（直接调 Claude/GPT API，自己写 tool calling、上下文管理、文件操作）
- **使用 Claude Code SDK / Codex SDK / Opencode SDK**（官方 CLI 工具的编程接口）

权衡：
- 自建：完全可控，但 harness 工程量大（要实现工具调用循环、上下文压缩、错误恢复、子进程管理...）
- 用 SDK：开箱即用，所有 harness 能力白嫖；锁定单一 provider 但可换

## Decision

**通过 Claude Code SDK（subprocess 方式）调用 AI**。

- Agent 守护进程通过 `@anthropic-ai/claude-code` SDK spawn 子进程
- 每个需求一个独立 SDK 子进程
- 通过 SDK 的 stdio / 流式输出与 AI 通信
- 设计上预留切换能力：未来可换 Codex SDK / Opencode SDK

**MVP 阶段仅支持 Claude Code SDK。**

## Consequences

### 正面
- **"把专业的 harness 工程外包出去"**——AI 推理、工具调用、上下文管理全交给 SDK
- 本平台专注：**状态管理 + 上下文装配 + UI 协同 + Skill 编排**
- 升级 AI 能力 = 升级 SDK 版本即可，无需改本平台代码
- 多 SDK 切换架构上已经预留

### 负面
- 锁定 Claude（短期可接受）
- SDK 升级可能带来 breaking change
- 无法深度定制 AI 推理行为

### 缓解措施
- 在 Agent 端定义抽象接口 `AIProvider`，封装 SDK 调用细节
- SDK 版本固定在 lockfile
- 关注 SDK 升级日志，及时适配

## Alternatives Considered

- **自建 LLM 集成**：3+ 人月的 harness 工程量，性价比低
- **LangGraph / AutoGen 多 Agent 编排**：用户明确偏好简单，单一 Agent + Skill 模板更合适
