---
Status: ready-for-agent
Type: task
Stage: 1
---

# 03 - Agent 守护进程骨架（HTTP + SSE）

## 目标

落地 ADR-0001 + 决策 31：Agent 是独立 Node 进程，通过 **HTTP REST + SSE** 与 Web 通信（Client → Agent 走 REST POST 发起请求；Agent → Client 走 SSE 长连流式推送 AI 输出与状态变更）。

## 范围

- [ ] Fastify 服务起在 `localhost:7777`
- [ ] REST 路由骨架：
  - `GET /api/health`
  - `GET /api/workspace`
  - `POST /api/requirement`（创建）
  - `GET /api/requirements`（列表）
  - `GET /api/requirement/:id`（详情）
  - `PATCH /api/requirement/:id`（更新 meta）
  - `POST /api/requirement/:id/skill`（运行 Skill，触发 SDK）
  - `GET /api/requirement/:id/events`（**SSE** 长连，流式回传 AI 输出 / 状态变更 / 错误；使用 `@fastify/sse`）
- [ ] 动态 Token 鉴权（`~/.aidevspace/.agent-token` 0600/ACL，决策 34；请求头 `X-AIDevSpace-Token`）+ Origin 校验仅允许 `http://localhost:3333`
- [ ] 健康检查：进程崩溃自动重启（用 `pm2` 或 nohup 脚本）
- [ ] 日志输出到 `~/.aidevspace/logs/agent.log`

## 验收

- `curl http://localhost:7777/api/health` 返回 200
- SSE 长连接能用 `curl -N http://localhost:7777/api/requirement/:id/events` 测试（流式逐行输出）
- 启动脚本 `pnpm agent:start` 能拉起并保活

## 依赖

- [01-monorepo-init.md](01-monorepo-init.md)
- [02-workspace-init.md](02-workspace-init.md)
