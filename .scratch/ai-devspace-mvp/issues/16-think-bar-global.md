---
Status: wontfix
Type: task
Stage: 2
WontfixReason: 产品决定下线 — ThinkBar 无实际作用、挡视线,所有页面都不再展示。
---

# 16 - AI 思考条全局化(位置 shell 层 1 + 工位内容注入)

> **⛔ Wontfix(2026-07)** — 产品决定下线。ThinkBar 在所有页面都不再展示,
> 无实际作用、挡视线。详见 issue 文件底部的「下线处理」一节。
> 本任务文档保留为历史决策追溯。

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

---

## 下线处理(2026-07)

**触发**:产品反馈 ThinkBar 无实际作用、挡视线,所有页面都不再展示。

**改动范围**:

- 删除:`apps/web/src/components/think-bar.tsx` · `think-bar-slot.tsx` · 4 个测试
- 删除:`apps/web/src/lib/use-zone.ts` · `zone-ai-status.ts` · 1 个测试
- 删除:`packages/shared/src/__tests__/zones-schema.test.ts`(4 处 thinking_bar 引用 + enum 校验)
- 修改:`packages/shared/src/zones.ts`(删 `ZoneThinkingBar` 类型 + schema 字段)
- 修改:`apps/web/src/lib/zones.ts`(删 `ZoneThinkingBar` 类型 + 6 工位 `thinking_bar` 值)
- 修改:`apps/web/src/app/(workspace)/layout.tsx`(摘掉 `<ThinkBarSlot />` + import)
- 修改:`apps/web/src/components/wrapup-zone.tsx`(删头部死注释)
- 修改:`apps/agent/src/services/ZoneRegistry.ts`(删注释)
- 修改:`apps/agent/src/__tests__/ZoneRegistry.test.ts`(删 3 处引用 + 1 个 `thinking_bar 缺失时默认 required` 测试)
- 修改:`apps/agent/src/zones/*.yaml` × 6(删 `thinking_bar` 字段)
- 批注:`docs/adr/0012-requirement-workbench-shell-topology.md` · `0013-analyzing-zone-rewrite.md`(DEPRECATED 标记,正文保留)

**不动**:

- `apps/web/src/components/thinking-stream.tsx`(ANALYZING 工位**主区内部**组件,跟全局 ThinkBar 无关)
- `StatusBar`(顶部全局状态栏,非 ThinkBar)
- issue 19b(核心是 ThinkingStream 打字机,不受全局 ThinkBar 删除影响)
