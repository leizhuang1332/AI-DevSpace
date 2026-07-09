---
Status: ready-for-agent
Type: task
Stage: 3
---

# 10 - 规范中心（代码 / 测试）

## 目标

解决痛点 3（无统一代码规范）和痛点 4（无统一测试规范）。让规范可被 Skill 自动加载，影响 AI 行为。

## 范围

- [ ] 规范存储：`~/.aidevspace/standards/`（与知识库分离，因为用途不同）
  - `code/java.md`、`code/spring-boot.md`、`code/sql.md` 等
  - `test/api-test.md`、`test/unit-test.md` 等
- [ ] Agent 端 `StandardsService`：
  - `list(scope)`：按 scope 列出（code / test）
  - `read(path)`
  - `create / update`
- [ ] Web 端 `/settings/standards` 页面：分类管理 + 编辑器（简单 textarea + 预览）
- [ ] Skill 加载规范：`code-stage` Skill 注入时自动把 `standards/code/<lang>.md` 加到上下文
- [ ] `test-stage` Skill 注入时自动把 `standards/test/<type>.md` 加到上下文
- [ ] 内置默认规范（Java 后端、Spring Boot、API 测试等开箱即用的"占位"规范）

## 验收

- 创建一个代码规范，code-stage 跑起来时 AI 输出风格符合规范
- 默认规范能直接用
- 用户编辑规范后无需重启即生效

## 依赖

- [08-builtin-skills.md](08-builtin-skills.md)
- [09-knowledge-base.md](09-knowledge-base.md)（共享 UI 模式）
