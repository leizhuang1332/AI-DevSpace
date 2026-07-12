---
Status: ready-for-agent
Type: task
Stage: 2
---

# 15 - Overview 概览页(5 项内容)

## 目标

把 [ADR-0011 §1 + §4](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 的 Overview 概览页落地为 `/requirements/[id]/page.tsx` 组件。

## 范围

- [ ] Overview 主区组件 `<OverviewPage requirementId={id} />`
  - 顶部 banner:面包屑 + 标题(从 meta.yaml 读)+ req-id + 状态色徽章 + 元数据栏(状态/仓库/负责人/创建时间/最近更新)
- [ ] 5 项内容卡片(2x2 网格布局):
  - **左上:完成进度** — 4 stat cell(已完成/进行中/等待中/待办)+ 进度条 + 详情段(代码/产物/PR)
  - **右上:工作台地图** — 6 个工位卡片(带状态色 + 当前 zone 高亮),点击跳对应工位
  - **左下:关键里程碑时间线** — 7 节点(DRAFTING → ... → WRAP-UP),当前 zone 高亮,已完成/进行中/待办三态
  - **右下:AI 活动概览** — 3 stat cell(总写入行/Skill 调用/快照数)+ 6 工位活跃度条
- [ ] 元数据来源:从 `meta.yaml` 读(状态、仓库、负责人等)+ 从各工位的产物汇总(进度、里程碑、AI 活动)
- [ ] 数据聚合层 `getRequirementOverview(id): OverviewData`
- [ ] 空状态:新建需求时显示"暂无数据,先去 DRAFTING 工位写 PRD"
- [ ] 单元测试:5 项内容都能渲染,空数据时不崩

## 验收

- 访问 `/requirements/REF-001/` 时,Overview 5 项内容正确渲染(对照 [12-requirement-overview.html](../docs/design/pages/12-requirement-overview.html) 基线)
- 工位地图点击 "WRAP-UP" 卡片跳转到 `/requirements/REF-001/wrap-up/`
- 时间线当前 zone 高亮,已完成节点绿色对勾
- AI 活动概览进度条数字与 meta.yaml 数据一致
- 新建需求(无产物)显示空状态引导

## 依赖

- [13-zone-router-shell.md](13-zone-router-shell.md)(Overview 路由)
- [14-zone-bar-component.md](14-zone-bar-component.md)(Overview 时无 ZoneBar)
- 关联 ADR:[ADR-0011 §1](../docs/adr/0011-requirement-workbench-zone-adaptive.md) · [§4 工位与 Overview 差异](../docs/adr/0011-requirement-workbench-zone-adaptive.md)
- 关联原型:[12-requirement-overview.html](../docs/design/pages/12-requirement-overview.html)
