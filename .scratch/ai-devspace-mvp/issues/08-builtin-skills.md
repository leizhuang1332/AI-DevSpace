---
Status: wontfix
Type: task
Stage: 2
Superseded-by:
  - 08a-skill-loader-arming.md
  - 08b-context-triggers.md
  - 08c-snapshot-undo.md
  - 08d-bad-feedback-loop.md
Superseded-by-ADR:
  - docs/adr/0008-skill-as-prompt-fragment.md
  - docs/adr/0009-ai-failure-defense.md
Deprecated-on: 2026-07-10
Deprecated-reason: "Skill 是提示词封装不是流程节点"哲学反转（grill 第 1-9 问决策）。原 6 阶段 Skill 流水线（analyze→design→plan→code→test→submit）与"AI 不推动流程、控制权完全交给用户"哲学直接冲突。
---

# 08 - 6 个内置 Skill（流程落地） — **DEPRECATED 2026-07-10**

> ⚠️ **本 Issue 已废弃**。详见 [ADR-0008](docs/adr/0008-skill-as-prompt-fragment.md) 与 [ADR-0009](docs/adr/0009-ai-failure-defense.md)。
>
> 替代 Issue：
>
> - [08a-skill-loader-arming.md](08a-skill-loader-arming.md) — Skill 加载器 + 装填深度三档
> - [08b-context-triggers.md](08b-context-triggers.md) — 触发规则 + Inline 提示栏
> - [08c-snapshot-undo.md](08c-snapshot-undo.md) — 自动 snapshot + 1-click 回滚
> - [08d-bad-feedback-loop.md](08d-bad-feedback-loop.md) — 👎 反馈通道
>
> 历史归档：原 issue 内容保留在下方，仅作变更溯源。

---

## 历史归档（原 issue 内容）

## 目标

把 Vibecoding 7 步流程落成 6 个可加载 Skill：analyze / design / plan / code / test / submit。

## 范围

- [ ] `skills/_built-in/analyze-stage/SKILL.md`：
  - 注入：requirement.md + knowledge/index.md
  - 提示词：分析 PRD、识别涉及服务、列出待澄清问题
  - 产出：analysis/01-understanding.md、analysis/02-questions.md
- [ ] `skills/_built-in/design-stage/SKILL.md`：
  - 注入：analysis/* + knowledge/patterns/后端设计.md
  - 提示词：生成 DB、API、Service 设计
  - 产出：design/01-database.md、design/02-api.md、design/03-service.md
- [ ] `skills/_built-in/plan-stage/SKILL.md`：
  - 注入：design/* + analysis/*
  - 提示词：拆解为可执行任务（按服务分组）
  - 产出：plan/tasks.md
- [ ] `skills/_built-in/code-stage/SKILL.md`：
  - 注入：plan/tasks.md + design/* + code-standards
  - 提示词：按 tasks 逐项实现，对应 worktree 操作
  - 产出：git commit、artifacts/ 下的代码片段
- [ ] `skills/_built-in/test-stage/SKILL.md`：
  - 注入：code 阶段的 diff + test-standards
  - 提示词：生成单测 + 接口测试用例
  - 产出：artifacts/test-cases.yaml、测试执行结果
- [ ] `skills/_built-in/submit-stage/SKILL.md`：
  - 注入：test 结果 + 验收标准
  - 提示词：commit + push + 生成 PR 描述
  - 产出：commits、artifacts/pr-description.md
- [ ] Skill 加载器：启动时扫描 `skills/`，缓存到内存，运行时按需加载
- [ ] Web 端"运行当前 Skill"按钮 + 进度反馈

## 验收

- 6 个 Skill 都有完整的 SKILL.md（frontmatter + 提示词 + 产出清单）
- 创建一个真实需求，依次运行 6 个 Skill，能产出对应的设计、计划、代码、测试、提交记录
- 切换 Skill 时上下文正确装配（不引入无关文件）

## 依赖

- [07-ai-chat-panel.md](07-ai-chat-panel.md)
- [09-knowledge-base.md](09-knowledge-base.md)（部分 Skill 引用知识库）
- [10-coding-standards.md](10-coding-standards.md)（code-stage 引用规范）
