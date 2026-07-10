# ADR-0008: Skill 是提示词封装（Anthropic Progressive Disclosure 落地），不是流程节点

**Status:** Accepted  
**Date:** 2026-07-10  
**Deciders:** 项目负责人  
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 11, 15, 24, 38–43

## Context

v1.0 PRD 和 Issue `08-builtin-skills.md` 把"Skill"建模为**流程节点**——6 个固定阶段（analyze → design → plan → code → test → submit）拼成一条线性流水线：

```
▶ 运行当前 Skill  →  Skill 加载提示词 + 注入上下文 + 跑 SDK + 落盘
                  →  meta.yaml: status=CLARIFYING/DESIGNING/...
                  →  下一步建议
```

这套模型的问题（**这一轮 9 问 grill 的核心冲突**）：

1. **本质是 AI 推动流程**——"当前 Skill"这个概念就是 AI 在告诉用户"流程到第几步了"
2. **违反用户原始哲学**——"不控制流程，只做赋能，控制权完全交给用户；让 AI 像空气一样"
3. **违反人机合作关系**——用户变成了"按阶段确认的审批者"，而不是"主导工作流的思考者"
4. **与 Anthropic 官方 Skills 概念不一致**——Anthropic 的 Skills = 可加载的提示词片段（progressive disclosure），是有名无"生命周期"的内容资产，不是"执行单元"

约束：

1. 必须保留"AI 在所有节点赋能"（用户原话）→ 不能"什么都不装"
2. 必须保留"控制权完全交给用户"→ 不能 AI 替用户决定
3. 必须保留"感知不到又不可或缺"→ 不能 AI 完全隐身
4. 已存在 7 个内置 Skill 文件夹，需兼容或拆解（不能直接删，会破坏现有 Issue 链路）

## Decision

**采用 D 方案：Skill = 提示词封装 + 用户驱动的装填调度**。

### 1. Skill 的本质

- **不是执行单元**——没有"启动/运行/停止"状态，没有"Skill A 执行中"这种概念
- **是 system prompt 的可拼接片段**——一个 Skill = frontmatter 元信息 + 正文行为规范
- **不是流程节点**——7 步 Vibecoding 流程是用户故事场景，不是产品内置状态机
- 用户可任意跳、漏、重排、并发跑多个 Skill

### 2. 触发信号 = 声明式规则，零 LLM 推理

每个 Skill 的 `SKILL.md` frontmatter 声明 `triggers:`：

```yaml
triggers:
  file_globs: ["requirement.md", "**/prd*.md"]
  focus_states: ["requirement.read", "requirement.draft"]
  artifact_kinds: ["sql.ddl", "openapi.yaml"]
  project_signals: ["has_analysis=false"]
```

Web 前端用**纯函数** `matchTriggers(skill, currentContext) → bool` 评估，**不调用 LLM**。Cmd+K 永远兜底（用户可绕过 trigger 显式唤起任意 Skill）。

### 3. 装填深度三档（Arming Level）

| 档位 | 注入内容 | 默认 |
|---|---|---|
| **Always-on** | 完整 SKILL.md 正文进 system prompt | 限 ≤3 个（可配），新增二次确认 |
| **On-arming** | 仅 name + 1 句描述进 system prompt | ✅ 默认 |
| **Dormant** | 0 注入 | — |

LLM 看到 armed Skill 的元数据 + Always-on 的全文。**LLM 不得仅因"用户消息像某个 Skill 的领域"就自主加载该 Skill 全文**——只能基于元数据回应 + 显式建议由用户加载。

### 4. 显式加载 = 用户主导

- 用户输入 `/skill-name` 或 UI 点击 → 临时把该 Skill 完整正文抬到 system prompt 顶层
- Cmd+K 命令面板 = 能力浏览器，不分上下文，全 Skill 全展示

### 5. AI 在场 = "克制在场"（决策 24）

- **陪伴先于推动**——状态可见、行为可追，但不替用户决定下一步
- **不打扰**——5 类必沉默（用户在读 / 全屏 / 后台 / 通话 / 拒绝≥3）触发时连 Inline 提示栏都不出
- **人机合作感**——用户主导，AI 兜底

## Consequences

### 正面

- 用户始终握开关——AI 不替用户做"该分析/该设计/该编码"之类的判断
- 触发逻辑可审计——纯函数 + 声明式规则，零 LLM 黑盒
- 资源消耗可控——多数 Skill 走 On-arming，元数据 < 1K tokens
- 与 Anthropic Skills 官方模型对齐——未来 Claude API 升级可平滑兼容
- 修复了 v1.0 PRD 中的本质矛盾（"AI 是执行者" vs "控制权完全交给用户"）

### 负面 / 代价

- **Skill 数量会膨胀**——6 阶段变成 N 能力，需要 Skill 作者自己维护 `triggers:` 和 `hint:` 字段
- **需要重写 Skill loader**——旧的"按阶段调用"逻辑废弃，改为"按上下文装填 + 按命令显式加载"双轨
- **UI 重构**——`▶ 运行当前 Skill` 按钮删除；Cmd+K 升级为能力浏览器；新增 StatusBar AI 区（4 指示器）；新增 Inline 提示栏
- **学习成本**——用户需要理解 arming level 三档 + trigger 机制
- **被拒绝的反馈需要新通道**——`bad_feedback:` 字段、👎 按钮（见 ADR-0009）

### 拒绝方案的理由

- **保留 6 阶段 Skill 作默认模板、用户可自由插入/重排/跳过**——本质还是流程编排，"AI 是空气"成空话
- **让 LLM 自主决定何时加载哪个 Skill**（Anthropic 原始模型）——违反"控制权完全交给用户"
- **完全删除 Skill 概念，让用户自己写提示词**——失去"上下文触发的能力"这一关键赋能形态

## Alternatives Considered

- **A. 保留 6 阶段 Skill 作默认骨架**：开发者只需按阶段跑，UX 简单。但与"控制权完全交给用户"哲学冲突。
- **B. 完全删除 Skill 概念**：用户自己写提示词片段。失去系统化封装，新人上手成本高。
- **C. LLM 自主调用 Skill**（Anthropic 原生模式）：最 AI-native，但用户失去控制权。
- **D. Skill = 提示词封装 + 用户驱动的装填调度**（**采用**）：平衡了"AI 赋能"与"用户主权"。

## 迁移路径

1. **Step 1**：标记 `.scratch/ai-devspace-mvp/issues/08-builtin-skills.md` 为 `Status: wontfix`
2. **Step 2**：新建 `08a-skill-loader-arming.md` / `08b-context-triggers.md` / `08c-snapshot-undo.md` / `08d-bad-feedback-loop.md` 替代
3. **Step 3**：删除或重构 `_built-in/*-stage/` 6 个目录，按能力维度新建 Skill
4. **Step 4**：更新 [CONTEXT.md](../CONTEXT.md) 决策 11 / 15 / 23-25，新增决策 38-43

## 相关文档

- [CONTEXT.md](../CONTEXT.md) — 决策 11, 15, 24-25, 38-43
- [ADR-0009](0009-ai-failure-defense.md) — 翻车防线（与本 ADR 同步落地）
- [PRD §1 / §6.3](../.scratch/ai-devspace-mvp/PRD.md) — 产品定位
- [Issue 08a–08d](../.scratch/ai-devspace-mvp/issues/) — 实施拆分
