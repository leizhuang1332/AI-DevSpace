---
Status: ready-for-agent
Type: task
Stage: 2
---

# 14 - ZoneBar 7 Tab 组件 + Cmd+K 双通道导航

## 目标

把 [ADR-0012 §6](../docs/adr/0012-requirement-workbench-shell-topology.md) 的 ZoneBar 设计落地为 React 组件 + Cmd+K 工位搜索。

## 范围

- [ ] ZoneBar React 组件 `<ZoneBar zones={zones} currentZone={zone} />`
  - 7 Tab 渲染(Overview + 6 工位),按 lifecycle 静态排序
  - 激活态:紫色 2px 底部下划线 + 文字加粗
  - 状态色点:6px 圆点,对应决策 22 的 4 色 + 灰
  - ANALYZING 蓝点脉动(决策 49)
  - CLARIFYING 紫点 + 红圈(决策 22 CLARIFYING 特殊)
  - 无数字徽章(决策 22 MVP)
- [ ] Overview Tab 特殊处理:用 brand 紫色区分于工位状态色,点击跳 `/requirements/[id]/`
- [ ] Cmd+K 命令面板增强(基于现有决策 26 三段式):
  - 新增工位搜索:输入 `exe` / `wrp` / `@zone` 等前缀,匹配工位名
  - 选中工位后回车跳转对应路由
  - 与既有 `/` 命令前缀 + `⌘I` AI 提问切换不冲突
- [ ] 状态色与现状对齐:Phase 1 的 AI 状态指示器(StatusBar AI 区 4 指示器)仍由 ZoneBar 接管之外的 StatusBar 部分承载
- [ ] 单元测试:ZoneBar 渲染 7 Tab + 激活态正确高亮

## 验收

- 7 Tab 渲染顺序:Overview → DRAFTING → ANALYZING → CLARIFYING → DESIGNING → EXECUTING → WRAP-UP
- 当前 zone 对应 Tab 紫色下划线高亮
- ANALYZING Tab 蓝点脉动,CLARIFYING 紫点带红圈
- Cmd+K 唤起命令面板,输入 "exe" 出现 "切到 EXECUTING 工位" 选项,回车跳转
- Overview Tab 点击回到 `/requirements/[id]/`(无 ZoneBar 状态)

## 依赖

- [13-zone-router-shell.md](13-zone-router-shell.md)
- 关联 ADR:[ADR-0012 §6](../docs/adr/0012-requirement-workbench-shell-topology.md) · [§7 Cmd+K](../docs/adr/0012-requirement-workbench-shell-topology.md)
- 关联原型:[11g-zone-tab-navigator.html](../docs/design/pages/11g-zone-tab-navigator.html)
