---
Status: ready-for-agent
Type: task
Stage: 2
---

# 21 - DESIGNING 工位组件(Compare 布局 · 评审 AI 设计)

## 目标

把 [ADR-0011 §6 DESIGNING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 落地为工位组件。

## 范围

- [ ] 路由: `/requirements/[id]/designing/page.tsx`
- [ ] 工位组件: `<DesigningZone data={zoneData} />`
- [ ] Compare 布局(**主区全宽**,无资源树无 Inline 栏,符合 R2):
  - **左侧设计文档**:
    - markdown 渲染(从 `artifacts/design.md` 读)
    - 可滚动,固定目录锚点
  - **右侧候选方案对比**(横向 A/B/C 卡片):
    - 每个候选方案卡片:标题 + 关键差异 + 取舍点(优点/缺点/适用场景)
    - 状态色点:yellow(决策 22 等待决策)
  - **底部操作**:
    - [✓ 选 A] [✓ 选 B] [✓ 选 C] 接受方案
    - [↻ 让 AI 重做] 触发 AI 重新设计
    - [✏️ 自定义调整] 输入框让 AI 调整方案
- [ ] 选择方案后:切到 PLANNING/EXECUTING 工位(非自动,但有引导提示)
- [ ] ZoneBar DESIGNING Tab 黄点(决策 22 等待决策)
- [ ] 单元测试:对比渲染、方案选择、AI 重做

## 验收

- 访问 `/requirements/REF-001/designing/` 显示 Compare 布局
- 左侧设计文档 markdown 正确渲染
- 右侧 3 个候选方案卡片横向对比,每个有清晰差异点
- 点 [✓ 选 A] 后切到 EXECUTING 工位(带确认提示)
- 点 [↻ 让 AI 重做] 触发 AI 重新生成方案
- ZoneBar DESIGNING Tab 黄点 + 激活态高亮

## 依赖

- [17-zone-executing.md](17-zone-executing.md)(样板模式)
- 关联 ADR:[ADR-0011 §6 DESIGNING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) · [§5 资源树按工位(R2)](../docs/adr/0011-requirement-workbench-zone-adaptive.md)
- 关联原型:[11c-stage-adaptive-designing.html](../docs/design/pages/11c-stage-adaptive-designing.html)
