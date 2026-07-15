---
Status: ready-for-agent
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 03 — 4 个触发入口接入(Cmd+K + 概览页 + 需求列表页 + ⌘N 焦点)

**What to build:**

用户从 4 个入口都能打开新建需求弹窗(1fe6abd 已重写 `NewRequirementModal`),且焦点 / a11y 全套对得上。

| # | 入口 | 位置 | 实现 |
|---|---|---|---|
| 1 | `⌘N` / `Ctrl+N` 全局快捷键 | 任何页面 | ui-overlay-store.tsx 已实现,本 ticket 补焦点回触发按钮 + Esc 关闭 |
| 2 | Cmd+K 命令面板搜"新建需求" | command-palette.tsx | 新增命令项:label="新建需求", icon="✨", shortcut hint="⌘N", action=`useUIOverlay().openCmdN()` |
| 3 | 概览页 `+ 新建需求` 按钮 | (workspace)/page.tsx:18 | onClick → `useUIOverlay().openCmdN()` |
| 4 | 需求列表页 `+ 新建需求` 按钮 | (workspace)/requirements/page.tsx:27 | onClick → `useUIOverlay().openCmdN()` |

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 入口 2:Cmd+K 命令面板输入"新建需求"能搜到该项,回车 / 点击触发弹窗
- [ ] 入口 3:概览页按钮 onClick 触发弹窗(去除 mock `console.log`)
- [ ] 入口 4:需求列表页按钮 onClick 触发弹窗(去除 mock)
- [ ] 入口 1:⌘N / Ctrl+N 全局键触发弹窗(已实现)
- [ ] 4 个入口共用同一 `<NewRequirementModal />` 组件(单一实例,决策 36)
- [ ] 关闭弹窗(✕ / ESC / `[取消]`)后焦点回到触发按钮(决策 24 / 决策 30 a11y)
- [ ] 4 个入口触发后,弹窗状态完全一致(autoFocus / slug 预览 / 字数计数 / disabled 条件)
- [ ] 空需求列表场景(0 个需求)下,概览页按钮引导文案是"创建你的第一个需求"
- [ ] 视觉对照:`apps/web/src/components/new-requirement-modal.tsx` 已重写版本
- [ ] 单元测试覆盖 4 个入口都能 `openCmdN()`,且弹窗实例是单例
- [ ] e2e 测试(playwright 或类似):从 4 个入口打开 → 填写 → 关闭 → 焦点回归
