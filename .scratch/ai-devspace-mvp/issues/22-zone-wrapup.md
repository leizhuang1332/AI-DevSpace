---
Status: ready-for-agent
Type: task
Stage: 2
---

# 22 - WRAP-UP 工位组件(Archive 布局 · 归档复盘)

## 目标

把 [ADR-0011 §6 WRAP-UP 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 落地为工位组件。

## 范围

- [ ] 路由: `/requirements/[id]/wrap-up/page.tsx`
- [ ] 工位组件: `<WrapupZone data={zoneData} />`
- [ ] Archive 布局(资源树有,Inline 栏无,think-bar `minimal`):
  - **顶部回顾报告**(主区):
    - AC 通过情况(从 PRD AC checklist 对比实际产物)
    - 关键决策回顾(用户在 DESIGNING 工位的选择记录)
    - AI 活动统计(总写入 / 思考时长 / 快照数 / Skill 调用次数)
  - **中部产物清单**(卡片网格):
    - 每张产物卡片:类型(SQL/OpenAPI/DDL/序列图等)+ 名称 + 路径链接
    - 关联 PR/Commit(从 git log 读)
  - **底部变更统计**:
    - +N / -N 行 + 文件数 + 仓库数
  - **归档操作**:
    - [📦 归档] 按钮:把需求状态改为 ARCHIVED,触发知识沉淀(可选)
    - [🔄 重新打开] 按钮:回到 EXECUTING 工位继续
- [ ] 资源树:产物清单 + PR/Commit + 决策回顾(按 R2)
- [ ] ZoneBar WRAP-UP Tab 灰点 + `thinking_bar: minimal`
- [ ] 单元测试:产物渲染、归档触发、知识沉淀

## 验收

- 访问 `/requirements/REF-001/wrap-up/` 显示 Archive 布局
- 顶部回顾报告正确汇总(AC 通过率 / 决策数 / AI 活动)
- 中部产物清单卡片可点击跳到文件
- 底部变更统计与 git log 一致
- 点 [📦 归档] 触发需求状态改为 ARCHIVED(决策 25 主动推送触发保留一类:归档完成)
- ZoneBar WRAP-UP Tab 灰点 + 激活态高亮
- ThinkBar 显示 minimal 模式(无按钮,仅状态点 + 1 行)

## 依赖

- [17-zone-executing.md](17-zone-executing.md)(样板模式)
- [16-think-bar-global.md](16-think-bar-global.md)(thinking_bar: minimal 实现)
- 关联 ADR:[ADR-0011 §6 WRAP-UP 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) · [§5 资源树按工位(R2)](../docs/adr/0011-requirement-workbench-zone-adaptive.md)
- 关联原型:[11f-stage-adaptive-archive.html](../docs/design/pages/11f-stage-adaptive-archive.html)
