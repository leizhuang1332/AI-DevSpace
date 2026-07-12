---
Status: ready-for-agent
Type: task
Stage: 2
---

# 16 - AI 思考条全局化(位置 shell 层 1 + 工位内容注入)

## 目标

把 [ADR-0012 §3](../docs/adr/0012-requirement-workbench-shell-topology.md) 的 AI 思考条全局化落地:位置 shell 层 1(永远在),内容由 `useZone()` hook 注入当前路由的语境。

## 范围

- [ ] Shell 层 1 加 think-bar slot:`app/(workspace)/layout.tsx` 底部加 `<ThinkBar slot="bottom-fixed" />`
- [ ] `useZone()` hook:从当前路由推断 zone(工位路由 → zone,Overview → "overview",其他路由 → null)
- [ ] ThinkBar 内容按 zone 决定:
  - **工位路由**:从 zone 注册表读 `thinking_bar` 字段,渲染工位级 AI 状态(如 EXECUTING 工位显示"AI 正在执行 T-05")
  - **Overview 路由**:显示需求级 AI 状态(如"AI 累计工作 1h 23min · 124 行写入")
  - **其他路由**(需求列表/Dashboard 等):`thinking_bar` 字段值由注册表决定(默认 `required`,但非工作台路由可能有不同策略)
- [ ] `thinking_bar` 字段三档实现:`required`(完整 + 按钮)/ `minimal`(状态点 + 1 行)/ `hidden`(不显示)
- [ ] 视觉规格(沿用 11g 原型):脉冲点 + 1 行文本 + 右侧按钮(暂停/查看详情)
- [ ] 单元测试:6 工位 + Overview + 需求列表都渲染正确内容

## 验收

- 所有工位路由底部都有 ThinkBar,内容随 zone 变
- Overview 路由底部 ThinkBar 显示需求级 AI 状态(对照 12-overview 原型)
- WRAP-UP 工位 ThinkBar 显示 `minimal` 模式(仅状态点 + 1 行短文本,无按钮)
- 切换 zone 时,ThinkBar 内容有过渡动画(100-200ms 淡入淡出)

## 依赖

- [12-zone-registration-yaml.md](12-zone-registration-yaml.md)(thinking_bar 字段)
- [13-zone-router-shell.md](13-zone-router-shell.md)(useZone hook)
- 关联 ADR:[ADR-0012 §3](../docs/adr/0012-requirement-workbench-shell-topology.md) · [§9 thinking_bar 字段](../docs/adr/0012-requirement-workbench-shell-topology.md)
- 关联原型:[11g-zone-tab-navigator.html](../docs/design/pages/11g-zone-tab-navigator.html) 底部条
