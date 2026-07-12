---
Status: ready-for-agent
Type: task
Stage: 2
---

# 20 - CLARIFYING 工位组件(Q&A 布局 · 回答 AI 提问)

## 目标

把 [ADR-0011 §6 CLARIFYING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 落地为工位组件。

## 范围

- [ ] 路由: `/requirements/[id]/clarifying/page.tsx`
- [ ] 工位组件: `<ClarifyingZone data={zoneData} />`
- [ ] Q&A 布局(**主区全宽**,无资源树无 Inline 栏):
  - **当前提问焦点**(顶部):
    - AI 问题正文(大字号,可滚动)
    - 关联上下文链接(指向 ANALYZING 工位的产物)
  - **候选答案**(中部):
    - 2-4 个候选答案按钮(基于 requirement-clarify Skill 生成)
    - [✏️ 自定义回答] 输入框
  - **历史澄清记录**(底部,可折叠):
    - 之前的问答轮次,按时间倒序
    - 点击"回到那一步"可让 AI 重新思考
- [ ] AI 提问触发切到 CLARIFYING(对应决策 25):AI 在 ANALYZING 工位提问时,自动切到 CLARIFYING(允许的非流程触发)
- [ ] 回答后:AI 继续下一轮或切回 ANALYZING(非自动)
- [ ] 单元测试:Q&A 流程、历史回看、空状态

## 验收

- 访问 `/requirements/REF-001/clarifying/` 显示 Q&A 布局
- 当前提问 AI 问题正文清晰显示
- 点击候选答案按钮提交回答,AI 继续
- [✏️ 自定义回答] 输入框可输入自由文本
- 历史澄清记录可展开/折叠,点击"回到那一步"触发 AI 重新思考
- ZoneBar CLARIFYING Tab 紫点带红圈(决策 22 特殊标记)

## 依赖

- [17-zone-executing.md](17-zone-executing.md)(样板模式)
- 关联 ADR:[ADR-0011 §6 CLARIFYING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) · [§2 工位属性(AI 非流程触发)](../docs/adr/0011-requirement-workbench-zone-adaptive.md)
- 关联原型:[11b-stage-adaptive-clarifying.html](../docs/design/pages/11b-stage-adaptive-clarifying.html)
