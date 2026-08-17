---
Status: ready-for-agent
Type: task
Created: 2026-08-17
Feature: workspace-root-editable
Parent: .scratch/workspace-root-editable/PRD.md
Blocked by: 04
Blocks: 07
ADR: docs/adr/0037-editable-workspace-root.md
Supersedes: 无
---

# Issue 06: web `agent-restart-banner` 全局 toast / banner + SSE 监听

## 背景

ADR-0037 D4: agent 发 SSE `agent-restarting` 后, web 端须立刻 toast「连接中断, 恢复中...」; 新 agent 起来后 web 自动重连, banner 消失或变「✓ 已恢复」。

## 目标

新增全局 `<AgentRestartBanner>` 组件, 监听 SSE `agent-restarting` + `agent-restarted` 事件, 展示两态 toast。

## 改动清单

### apps/web

| # | 文件 | 改动 |
|---|---|---|
| 1 | [apps/web/src/components/agent-restart-banner.tsx](../../apps/web/src/components/agent-restart-banner.tsx) | 新建: `<AgentRestartBanner />` 客户端组件; 内部维护 `status: 'idle' \| 'restarting' \| 'recovered'` state; 用现有 SSE 客户端订阅 `/api/events` 过滤 `agent-restarting` / `agent-restarted`; 渲染固定顶栏 toast (决策 17 Linear 紧凑型) |
| 2 | [apps/web/src/app/(workspace)/layout.tsx](../../apps/web/src/app/(workspace)/layout.tsx) | 挂 `<AgentRestartBanner />` 到全局 shell 层 (与 StatusBar / Sidebar 同层, 决策 37) |
| 3 | [apps/web/src/__tests__/components/agent-restart-banner.test.tsx](../../apps/web/src/__tests__/components/agent-restart-banner.test.tsx) | 新建: 5 case (默认不渲染 / 收到 restarting 显示 / 收到 recovered 隐藏 / 收到 restarting 后再次收到 restarting 仍显示 / 收不到事件 idle) |

### 不动(明确)

- 现有 SSE 客户端(`apps/web/src/lib/sse-client.ts` 或同等;沿用其订阅通道)
- 现有 StatusBar / Sidebar 等 shell 组件

## 验收

- [ ] web 编译通过
- [ ] 新单测 5 case 全过
- [ ] web 全套件零 regression
- [ ] 手动跑 `pnpm dev` + `pnpm dev` (agent) → curl POST `/api/agent/restart` → web 顶部立刻出现 toast「连接中断, 恢复中...」 → agent 自动拉起 → web 自动重连 → toast 变「✓ 已恢复」 (3s 后淡出)