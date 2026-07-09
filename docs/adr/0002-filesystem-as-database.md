# ADR-0002: 纯文件系统作为数据层（无数据库）

**Status:** Accepted  
**Date:** 2026-07-08

## Context

产品所有数据（需求元信息、分析产物、设计文档、对话历史、知识库、配置）需要持久化。可选方案：

- **关系型数据库**（PostgreSQL / MySQL）
- **文档数据库**（MongoDB）
- **嵌入式数据库**（SQLite）
- **纯文件系统**（markdown + YAML + JSON）

约束：
1. 用户**明确要求"所有数据以文件夹+文件管理"**
2. 必须**支持数据迁移**（整目录 tar.gz 即可）
3. 未来可能需要"全文搜索 / 关系索引"

## Decision

**纯文件系统方案**。所有数据以 markdown / YAML / JSON 文本格式存储。

- 需求元信息：`meta.yaml`（YAML frontmatter）
- 文档类：`.md` 文件
- 产物类：`.sql` / `.yaml` / `.json` 等原始格式
- 配置：`config.yaml`
- 对话历史：`.md` 文件（带时间戳和角色）

**回退方案**：当纯文件无法满足需求（如大规模全文搜索、关系查询）时，使用 **SQLite**（嵌入式、文件式、不走服务进程）。

## Consequences

### 正面
- 整目录 `tar.gz` 即可备份/迁移
- 可直接用 git 跟踪
- 透明可读，用户可手工编辑
- 零运维成本（无数据库进程）
- 与 AI 上下文装配天然契合（AI 直接读文件）

### 负面
- 没有事务、并发控制弱（多 SDK 子进程写同一文件需互斥）
- 全文搜索需要额外实现（如 ripgrep / lunr.js）
- 复杂查询能力弱
- 大量小文件时性能可能下降

### 缓解措施
- Agent 端用文件锁（`proper-lockfile`）避免并发写冲突
- 知识库的全文索引用 ripgrep + 内存缓存
- 必要时降级到 SQLite 做局部索引

## Alternatives Considered

- **PostgreSQL**：运维成本高，不符合"无服务"理念
- **MongoDB**：同上，且 JSON 文件已经能表达
- **SQLite**：备选，目前不需要

## Future Triggers to Revisit

- 知识库超过 1000 条目时考虑 SQLite FTS5
- 多用户协作时考虑集中式数据库
