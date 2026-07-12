---
Status: ready-for-human
Type: task
Stage: 2
---

# 17 - EXECUTING 工位组件(样板 · Mission Control 三列布局)

## 目标

把 [ADR-0011 §6 EXECUTING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 落地为工位组件样板。**这是 6 工位中第一个实现的,作样板验证整套工位架构。**

## 范围

- [ ] 路由: `/requirements/[id]/executing/page.tsx`
- [ ] 工位组件: `<ExecutingZone data={zoneData} />`(后续 5 工位都按这个模式:page.tsx 渲染 zone 组件)
- [ ] Mission Control 三列布局:
  - **左列 DAG(280px)**:任务 DAG 列表(从 `plan/tasks.md` 读)
    - 顶部 stats:done / doing / wait / todo 4 数字
    - 任务卡片:id + 标题 + 状态色(已完成绿 / 进行中 brand / 等待黄 / 待办灰)
  - **中列 Diff(1fr)**:累计变更流(从 git diff 读)
    - 文件级 diff 卡片,展开显示 +/- 行
    - 顶部筛选:全部 / 修改 / 新增 / 删除
  - **右列 AI 行为流(320px)**:实时 tool call(从 SSE 推送读)
    - 事件卡片:时间戳 + 动作 + 描述 + 统计
    - 状态:info / success / warn / err
- [ ] 资源树(240px 左栏):任务 DAG + 变更文件 + 产物清单
- [ ] Inline 栏(120px 右栏):自动 snapshot 状态 / 候命 Skill / 待确认项
- [ ] 顶部 toolbar:面包屑 + [⏸ 暂停 AI] [⚙️] [⏹ 中止] 按钮
- [ ] SSE 实时刷新:任务状态 / Diff / AI 事件
- [ ] 单元测试:三列渲染、空状态、错误状态

## 验收

- 访问 `/requirements/REF-001/executing/` 显示完整 Mission Control 三列布局
- 任务 DAG 任务卡片状态色正确(对照 [11d 原型](../docs/design/pages/11d-stage-adaptive-implementing.html))
- Diff 流能正确显示 git diff 输出(+/- 行用绿/红高亮)
- AI 行为流实时刷新(SSE 推送新事件时,右侧 AI 列自动追加卡片)
- 资源树任务节点点击跳到任务详情(若有该路由)
- Inline 栏显示 snapshot 状态 + 候命 Skill 列表

## 依赖

- [13-zone-router-shell.md](13-zone-router-shell.md)
- [14-zone-bar-component.md](14-zone-bar-component.md)
- [16-think-bar-global.md](16-think-bar-global.md)
- 关联 ADR:[ADR-0011 §6 EXECUTING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md)
- 关联原型:[11d-stage-adaptive-implementing.html](../docs/design/pages/11d-stage-adaptive-implementing.html)(Mission Control 基线)

## ⚠️ 样板性质

**这是第一个完整工位组件**,后续 5 工位(18-22)基于此复制模式。如有架构问题(如资源树抽象、Inline 栏组件复用、toolbar 通用样式),应在本 issue 中解决并文档化,避免后续工位各自重复设计。
