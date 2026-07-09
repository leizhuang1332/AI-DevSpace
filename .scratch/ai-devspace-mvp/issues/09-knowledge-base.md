---
Status: ready-for-agent
Type: task
Stage: 3
---

# 09 - 知识库（浏览 + 检索 + 自动沉淀）

## 目标

解决痛点 7（重复问题重复解决）。让知识库可浏览、可检索、可由 AI 自动沉淀。

## 范围

- [ ] 知识库目录结构（已在 PRD §4 定义）：
  - `~/.aidevspace/knowledge/domain/`
  - `~/.aidevspace/knowledge/patterns/`
  - `~/.aidevspace/knowledge/bugs/`
  - `~/.aidevspace/knowledge/index.yaml`（手动维护的索引）
- [ ] Agent 端 `KnowledgeService`：
  - `list()`：列出所有知识条目
  - `read(path)`：读取单条
  - `create(path, content)`：新增
  - `update(path, content)`
  - `search(query)`：基于 ripgrep 全文搜索
- [ ] Web 端 `/knowledge` 页面：左侧分类树，右侧内容（Markdown 渲染）
- [ ] Web 端知识库搜索框（顶栏全局可用）
- [ ] AI 自动沉淀：在需求 "submit-stage" 完成后，AI 总结可复用经验写到 `knowledge/` 下（用户确认后才落盘）
- [ ] Skill 中通过 `@knowledge/<name>` 引用

## 验收

- 能新增一条知识，Web 端立刻可见
- 全文搜索能命中正文内容
- 一个需求完成时，AI 提议的"沉淀知识"卡片能展示给用户确认

## 依赖

- [04-web-skeleton.md](04-web-skeleton.md)
- [08-builtin-skills.md](08-builtin-skills.md)
