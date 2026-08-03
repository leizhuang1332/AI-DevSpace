# 04 — Cmd+K 新增「🗂️ 历史分析」命令召回面板

**What to build:** 在 `<CommandPalette>` 的命令列表里新增「🗂️ 历史分析」命令,描述实时跟随当前 Requirement id 与 N 计数。键盘用户搜「历史」或输入 FAB 命令描述,即可直接打开浮动面板(等同点 FAB)。不绑 `⌘⇧H` 全局快捷键(决策 29:90% 走 Cmd+K)。

**Blocked by:** 01(注:本 ticket 不依赖 02 — Cmd+K 命令的 action 闭包直接调 FAB 打开接口,不关心面板是否已显示 Run 列表)

**Status:** ready-for-agent

- [ ] `<CommandPalette>` 的命令生成器(沿用 `buildAllCommands` 模式)新增一项:「🗂️ 历史分析」
- [ ] 命令描述格式:`req-<id> · 共 N 个 Run`,N 与 FAB 的 N 同步实时(读自当前 Requirement 的 Analysis Run 列表)
- [ ] 命令渲染为可交互 `<button>`(沿用「新建需求」命令的 `action` 闭包模式)
- [ ] `data-testid="cmd-history-fab"`
- [ ] 命令的 `action` 闭包调用 `open('historyFab')` + `closeKey('cmdK')`,沿用「新建需求」的双调用范式(避免 React 18 batching 覆盖)
- [ ] 无 req 上下文(Overview 概览页不在某 Requirement 内)→ 命令 disabled(不强渲 click handler,降级文案提示「请进入需求后再用」)
- [ ] 不绑 `⌘⇧H` 快捷键,沿用决策 29 的 90% 走 Cmd+K 哲学
- [ ] 沿用 `<CommandPalette>` 顶层 seam 加新 describe 块,覆盖:
  - 搜「历史」出现 `cmd-history-fab` 项
  - 描述包含当前 reqId + N 计数
  - 点选命令 → `open('historyFab')` + `closeKey('cmdK')` 被调
  - 无 req 上下文时命令 disabled
- [ ] 复用既有 `command-palette-zones.test.tsx` 的 next/navigation + UIOverlay mock,扩展 mock `historyFabController` 实例
- [ ] 不引入新 IPC / event 总线:Cmd+K 命令的 action 闭包直接访问 `<AnalyzingZone>` 暴露的 controller(通过 React context 或在 `(workspace)/requirements/[id]/analyzing/layout.tsx` 提供)