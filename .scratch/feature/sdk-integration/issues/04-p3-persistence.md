---
Status: needs-triage
Type: task
Stage: P3
---

# 04 - P3 持久化：SessionStore + MessagesMirror + ResumeManager

## 目标

落地 ADR-0010 Q7（会话持久化）：双 ID + provider 字段、per-req 路径、自动 resume、本地 messages.jsonl 镜像。

## 范围

- [ ] `session/SessionStore.ts` — session meta CRUD
  - `createSession(reqId, opts)` → 写 `sessions/<local_sid>/meta.yaml`
  - `getSession(localSid)` / `listSessions(reqId)` / `updateSession(localSid, patch)` / `archiveSession(localSid)`
  - meta.yaml 字段（按 ADR-0010 Q7）：sid / sdkSessionId / provider / reqId / created_at / last_active_at / topic / kind / cwd / current_focus / model: {providerId, role}
- [ ] `session/MessagesMirror.ts` — 增量写 `messages.jsonl`
  - 每条 AI 事件 → 1 行 jsonl
  - `{ id, type, role, content, timestamp, sdkMessageRaw, ... }`
  - 失败恢复（partial 流式响应标 `incomplete: true`，Q8.6）
  - 读：`readMessages(localSid, sinceId?)` 给 Web 端展示用
- [ ] `session/ResumeManager.ts` — 拿 sdkSessionId 调 SDK
  - `tryResume(localSid)` → 读 meta → `query({ resume: sdkSessionId, ... })`
  - 失败（SDK 找不到）→ 新建空 session + meta 标 `recovered: true` + 提示用户「上次对话上下文已丢失」
- [ ] 用户开已有 session 时的自动 resume 流程：
  - Web 拉 session → Agent 读 meta → 检查 sdkSessionId 存在 → 调 SDK `query({ resume })` → 流推 SSE
- [ ] 双 ID 关系维护：
  - 创建 session → 本地 sid 立即生成 + 写 meta（sdkSessionId 留空）
  - 首次 SDK query 收到 system 消息带 session_id → 回填 meta.sdkSessionId
  - 切 SDK 流程预留（per ADR-0010 Q7 切 SDK 友好性）

## 验收

- 用户点「新建会话」→ meta.yaml 立即创建（含 local_sid，sdkSessionId 为空）
- 用户发首条消息 → SDK 返回后 meta.yaml.sdkSessionId 被回填
- Web 关闭再打开 session → Agent 自动 resume → 看到之前的对话历史
- 关闭 Web 再打开 → 看到本地 `messages.jsonl` 里的所有消息（含 partial 流式响应，标 incomplete）
- 模拟 SDK 找不到 session（手动改 sdkSessionId 为无效值）→ Agent 创建新空 session，meta 标 `recovered: true`

## 依赖

- [01-p0-skeleton.md](01-p0-skeleton.md)
- [Issue 02-workspace-init.md](../../ai-devspace-mvp/issues/02-workspace-init.md)（文件系统路径约定）

## 估时

1 周
