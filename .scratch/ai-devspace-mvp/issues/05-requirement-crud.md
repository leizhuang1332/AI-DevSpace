---
Status: ready-for-agent
Type: task
Stage: 2
---

# 05 - 需求 CRUD + 详情页三栏布局

## 目标

把"需求"做成产品的核心对象（PRD §5.2），端到端跑通"创建 → 列表 → 详情 → 状态切换 → 归档"。

## 范围

- [ ] Agent 端 `RequirementService`：
  - `create(meta, requirement.md)`：建目录结构、生成 `meta.yaml`、绑定 repo worktree
  - `list()`：扫描 `requirements/`，读取 `meta.yaml` 返回列表
  - `get(id)`：读取整个需求目录内容
  - `update(id, patch)`：更新 `meta.yaml`
  - `archive(id)`：移动到 `_archived/`
- [ ] Web 端需求列表页（Linear 风格，状态分组）
- [ ] Web 端新建需求 Dialog（名称、关联 repo 多选、PRD 粘贴）
- [ ] Web 端需求详情页三栏布局：
  - 左 240px 资源树（VSCode Explorer 风格）
  - 中 flex 主工作区（动态 Tab 骨架）
  - 右 360px AI 助手面板（占位，本期不做对话）
- [ ] meta.yaml 字段：`id`, `title`, `status`, `createdAt`, `updatedAt`, `repos[]`, `tags[]`, `assignee`
- [ ] 状态切换 UI（DRAFT / ANALYZING / DESIGNING / PLANNING / IMPLEMENTING / SUBMITTING / DONE / ARCHIVED，**MVP 阶段写死这 8 个，P2 改 Skill 驱动**）

## 验收

- 能创建 1 个需求并出现在列表
- 详情页三栏布局正确，资源树可点击切换 Tab
- 状态切换后 `meta.yaml` 落盘正确

## 依赖

- [02-workspace-init.md](02-workspace-init.md)
- [04-web-skeleton.md](04-web-skeleton.md)
- [06-repo-worktree.md](06-repo-worktree.md)（repo 多选依赖它）
