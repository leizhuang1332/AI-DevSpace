---
Status: ready-for-agent
Type: task
Stage: 1
---

# 03 - Agent 守护进程骨架（HTTP + WebSocket）

## 目标

落地 ADR-0001：Agent 是独立 Node 进程，通过 HTTP REST + WebSocket 与 Web 通信。

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
  - `WS /ws/requirement/:id`（流式回传 AI 输出）
- [ ] 简单的 API Key 鉴权（从 `config.yaml` 读取，本机部署用静态 token）
- [ ] CORS 限制仅允许 `http://localhost:3333`
- [ ] 健康检查：进程崩溃自动重启（用 `pm2` 或 nohup 脚本）
- [ ] 日志输出到 `~/.aidevspace/logs/agent.log`

## 验收

- `curl http://localhost:7777/api/health` 返回 200
- WebSocket 连接能用 Postman/wscat 测试
- 启动脚本 `pnpm agent:start` 能拉起并保活

## 依赖

- [01-monorepo-init.md](01-monorepo-init.md)
- [02-workspace-init.md](02-workspace-init.md)
