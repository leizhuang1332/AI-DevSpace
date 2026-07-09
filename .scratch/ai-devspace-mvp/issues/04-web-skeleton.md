---
Status: ready-for-agent
Type: task
Stage: 1
---

# 04 - Web 工作台骨架（一级导航 + 布局）

## 目标

落地 PRD §5 的信息架构与页面树，先把"壳"做出来。

## 范围

- [ ] Next.js 14 App Router 路由：
  - `/` 概览（占位）
  - `/requirements` 列表（占位）
  - `/requirements/[id]` 详情（占位）
  - `/repos`、`/repos/[name]`
  - `/knowledge`、`/skills`、`/settings`
- [ ] 左侧固定导航栏（一级 6 项，图标 + 文案）
- [ ] 顶部面包屑 + 全局状态指示器（Agent 是否在线）
- [ ] shadcn/ui 基础组件库接入（Button、Card、Dialog、Sheet、Toast）
- [ ] Tailwind 主题（亮色优先，P2 做暗色）
- [ ] 全局错误边界（Error Boundary）
- [ ] 跟 Agent 的 HTTP 客户端封装（带 token 注入）

## 验收

- 所有路由能打开，无 JS 错误
- 导航栏能正常切换
- Agent 离线时显示红色提示

## 依赖

- [01-monorepo-init.md](01-monorepo-init.md)
- [03-agent-skeleton.md](03-agent-skeleton.md)
