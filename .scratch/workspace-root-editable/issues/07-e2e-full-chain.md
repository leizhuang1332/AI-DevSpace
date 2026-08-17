---
Status: ready-for-agent
Type: task
Created: 2026-08-17
Feature: workspace-root-editable
Parent: .scratch/workspace-root-editable/PRD.md
Blocked by: 03, 04, 05, 06
Blocks: 无
ADR: docs/adr/0037-editable-workspace-root.md
Supersedes: 无
---

# Issue 07: e2e 端到端 — settings 改 root → restart → 新 root 生效 全链路

## 背景

ADR-0037 决策落地分散在 6 个 issue 中; 缺少端到端集成测试覆盖「settings UI → agent 落 yaml → restart → 新 root 接管」全链路。

## 目标

新增 e2e 测试: 模拟 settings UI 改 workspaceRoot (含三档校验 + 错误回滚), 触发 restart, 验证新 agent 进程读新 root 成功。

## 改动清单

### apps/web + apps/agent

| # | 文件 | 改动 |
|---|---|---|
| 1 | [apps/web/e2e/workspace-root-editable.spec.ts](../../apps/web/e2e/workspace-root-editable.spec.ts) | 新建 (Playwright): 4 case (happy path / 路径不存在拒绝 / 路径无痕迹警告 + 确认 / restart 后新 root 生效) |
| 2 | [apps/agent/src/__tests__/workspace-root-editable.e2e.test.ts](../../apps/agent/src/__tests__/workspace-root-editable.e2e.test.ts) | 新建 (vitest): 3 case (validate-path + PATCH + restart 三件套端到端; spawn 真子进程验 supervisor 行为) |

### 测试脚手架

- agent 端 e2e 用 `child_process.spawn` 启 `node dist/server.js` 真子进程, 监听端口 (随机), token 直读
- web 端 e2e 沿用现有 Playwright setup, mock agent 响应
- 测试结束清理: tmp 目录 + 子进程

## 验收

- [ ] agent e2e 3 case 全过
- [ ] web e2e 4 case 全过
- [ ] CI 全绿
- [ ] 手动跑全套 (必跑 dev server, 见 CLAUDE.md「Next.js dev ↔ build 隔离」): 见 PRD §5

## 不在本 issue

- 单元测试已在 01 ~ 06 各 issue 覆盖
- 视觉回归 / 截图比对 → 留 P2+(本期靠人工 e2e 验证)

## 风险

| 风险 | 缓解 |
|---|---|
| 真子进程 e2e 跨平台(Win / macOS / Linux)路径差异 | 沿用 `normalizeWorkspaceRoot` 归一化, 测试用绝对 normalized 路径 |
| Playwright 启动 dev server 慢 | 沿用现有 `webServer` 配置, 复用 vite cache |