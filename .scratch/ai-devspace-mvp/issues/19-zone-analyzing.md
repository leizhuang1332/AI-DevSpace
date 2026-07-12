---
Status: wontfix
Type: task
Stage: 2
SupersededBy: ADR-0013
---

# 19 - ANALYZING 工位组件(Thinking 布局 · AI 观察屏)

> ⚠️ **本 issue 已被 [ADR-0013](../../docs/adr/0013-analyzing-zone-rewrite.md) 整体替代。**
>
> 原定位"旁观 AI 解析(Thinking 布局·AI 观察屏)"过轻,无法承载一个工位复杂度。
> 2026-07-12 通过 10 轮 grilling 重设计,新定位 = **PRD 准入校验 + 拆解聚合模块**(详见 ADR-0013 D1-D10)。
>
> 原 HTML 原型 [11e-stage-adaptive-analyzing.html](../../docs/design/pages/11e-stage-adaptive-analyzing.html) 保留作存档,**不作为实施对照**。
>
> **新实施路径**:ADR-0013 §"落地 Issue" 列出了 8 个拆分 issue(19a-19h),将由对应工位组件实施任务承接。

## 原始目标(存档)

把 [ADR-0011 §6 ANALYZING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 落地为工位组件。

## 目标

把 [ADR-0011 §6 ANALYZING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 落地为工位组件。

## 范围

- [ ] 路由: `/requirements/[id]/analyzing/page.tsx`
- [ ] 工位组件: `<AnalyzingZone data={zoneData} />`
- [ ] Thinking 大屏卡片布局(**主区全宽**,无资源树无 Inline 栏):
  - **顶部 stats**:子问题 N / 风险点 N / 候选方案 N
  - **中部思考流**:
    - AI 思考过程打字机流(SSE 推送 chunk,10-100 字符 / chunk)
    - 实时打字(20ms / 字,决策 32)
    - 点击跳过打字
  - **底部操作**: [⏸ 暂停] [↶ 重置] 按钮
- [ ] StatusBar AI 状态:`status_pulse: true`(蓝脉动) + 状态点显示 ANALYZING
- [ ] AI 行为流作为副产物(主区展示给用户看,不是右栏)
- [ ] AI 完成 ANALYZING 后:弹出"AI 分析完成,切到 CLARIFYING 吗?"提示(非自动跳转)
- [ ] 单元测试:打字机流、暂停/重置、空状态、错误状态

## 验收

- 访问 `/requirements/REF-001/analyzing/` 显示 Thinking 大屏卡片布局
- AI 思考流打字机效果流畅(20ms / 字)
- [⏸ 暂停] 按钮停止打字,再次点击继续
- [↶ 重置] 按钮清空当前分析,从头开始
- ZoneBar ANALYZING Tab 蓝点脉动
- AI 完成分析后,弹出非自动跳转提示(决策 15 反对状态机)

## 依赖

- [17-zone-executing.md](17-zone-executing.md)(样板模式)
- [16-think-bar-global.md](16-think-bar-global.md)(think-bar 同步显示 AI 状态)
- 关联 ADR:[ADR-0011 §6 ANALYZING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md)
- 关联原型:[11e-stage-adaptive-analyzing.html](../docs/design/pages/11e-stage-adaptive-analyzing.html)
