---
Status: ready-for-agent
Type: task
Stage: 2
---

# 18 - DRAFTING 工位组件(Form 布局 · 写需求 PRD)

## 目标

把 [ADR-0011 §6 DRAFTING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 落地为工位组件。

## 范围

- [ ] 路由: `/requirements/[id]/drafting/page.tsx`
- [ ] 工位组件: `<DraftingZone data={zoneData} />`
- [ ] Form 居中布局(主区缩进到右侧,资源树和 Inline 栏各占 240/120):
  - **顶部表单字段**:
    - 标题 input(必填)
    - 关联仓库多选(从 `repos/` 读仓库列表)
    - PRD Markdown 富文本编辑器(可预览)
    - AC 结构化 checklist(可增删条目)
  - **底部操作**:
    - [💾 保存草稿] 按钮(写入 `meta.yaml` + PRD 文件)
    - [🚀 创建并启动 AI 分析] 按钮(切到 ANALYZING 工位)
- [ ] 资源树(PRD 章节大纲):基于 PRD Markdown 自动生成章节树
- [ ] Inline 栏:requirement-brainstorm / requirement-clarify / schema-design 候命 Skill 列表
- [ ] 自动保存:每 30 秒写入草稿(meta.yaml 备份)
- [ ] 单元测试:表单字段、关联仓库多选、Markdown 编辑器、AC 增删

## 验收

- 访问 `/requirements/REF-001/drafting/` 显示 Form 居中布局
- 填写标题/PRD/AC 后,点 [💾 保存草稿] 写入 meta.yaml 和 PRD 文件
- 点 [🚀 创建并启动 AI 分析] 后,跳转到 `/requirements/REF-001/analyzing/`
- 资源树章节大纲实时同步 PRD 标题层级
- Inline 栏候命 Skill 列表显示(点击可唤起 Skill)

## 依赖

- [17-zone-executing.md](17-zone-executing.md)(样板模式)
- 关联 ADR:[ADR-0011 §6 DRAFTING 布局](../docs/adr/0011-requirement-workbench-zone-adaptive.md)
- 关联原型:[11a-stage-adaptive-draft.html](../docs/design/pages/11a-stage-adaptive-draft.html)
