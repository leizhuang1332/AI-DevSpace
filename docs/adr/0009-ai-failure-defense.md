# ADR-0009: AI 翻车防线（5 层 = 预 / 测 / 亮 / 回 / 学）

**Status:** Accepted  
**Date:** 2026-07-10  
**Deciders:** 项目负责人  
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 43, 46  
**关联 ADR:** [ADR-0008](0008-skill-as-prompt-fragment.md) — 同批次哲学落地

## Context

[ADR-0008](0008-skill-as-prompt-fragment.md) 把 AI 从"流程执行者"重定位为"克制在场的搭档"，解构了"AI 替用户推进"的风险。但反向风险——**AI 自己搞砸了**——v1.0 PRD 完全没有机制。

按严重度梳理翻车场景（grill 第 9 问）：

| 级别 | 场景 | 例子 | v1.0 机制 |
|---|---|---|---|
| 🟡 轻 | 写错文件内容 | DDL 写成 SELECT 语法 | ❌ 无 |
| 🟡 轻 | 误解意图 | 用户要"加索引" AI 删了字段 | ❌ 无 |
| 🟠 中 | 改坏现有代码 | 改完编译不过 / 测试挂 | ❌ 无（仅 StatusBar 标红） |
| 🟠 中 | 写到错位置 | 写到别人家的 Requirement | ❌ 无 |
| 🟠 中 | 跑死 / hang | SDK 5min 无输出 | ❌ 无 |
| 🔴 重 | 删了用户文件 | 误删非 artifact 下的 `.java` | ❌ 无 |
| 🔴 重 | 误推敏感信息 | commit 时把 `.env` 一起提 | ❌ 无 |
| 🔴 极重 | 推到 main / force push | 不可逆破坏 | ❌ 无（裸危险） |

8 类全无兜底。

约束：
1. 不能用"AI 出错就重跑"——重跑可能再错，且消耗 token
2. 不能用"全 confirm 一切"——失去"克制在场"的优势
3. 必须保护**不可逆**操作（删文件、force-push、推 main、含 secrets）——这些是错误一旦发生就难收的
4. 必须支持**学习**——同样错误不能犯第二次

## Decision

**采用 5 层防线：预 / 测 / 亮 / 回 / 学**。

### 第 1 层：预（事前阻止）

| 操作 | 默认 | 强校验 |
|---|---|---|
| 写入 `artifacts/` / `notes/` / 新建文件 | ✅ 自由 | — |
| 写入 Requirement 的 `analysis/` `design/` `plan/` `conversations/` | ✅ 自由 | 写完即 snapshot |
| 改/删 Requirement 的 `requirement.md` `meta.yaml` | ⚠ 警告 | "这会改需求核心定义，继续？" |
| 改/删 worktree 下 `src/` `*.java` `*.sql` 等业务代码 | ⚠ 警告 | 改前 + 改后各 snapshot + 展示 diff 摘要 |
| **删** worktree 下任何非 `.gitkeep` 文件 | 🚫 阻止 | 必须 `Cmd+Shift+Del` 或 `/force-delete` |
| git `push --force` | 🚫 阻止 | 永远二次确认 + 输入分支名 |
| git `push` 到 `main` / `master` | 🚫 阻止 | 永远二次确认 |
| commit 含 `.env` `*secret*` `*password*` `BEGIN PRIVATE KEY` | 🚫 阻止 | 全部 redaction 后再询问 |
| 跑 `--no-verify` 跳过 hook | ⚠ 警告 | "为什么要跳过？" |
| 单次改 ≥ 10 个文件 | ⚠ 警告 | "这是大动作，建议拆开做" |

**所有"阻止"可被用户在 Settings → AI 协作 → 危险操作白名单 临时放行**（带时间戳的"这次允许"，不存永久白名单）。

### 第 2 层：测（事中发现）

写完任何代码类文件后**自动**跑：

- 项目 linter（ESLint / Checkstyle / 等）
- 项目 type-check（tsc / javac / 等）
- **如**有 test，单测
- DDL → schema validator（sqlfluff / sql-lint / 等）
- openapi.yaml → swagger validate

**任一失败 → 走第 3 层。**

### 第 3 层：亮（高优先级曝光）

| 等级 | UI |
|---|---|
| 🟡 轻 | Inline 提示栏变体（黄）+ hover 显示 diff 摘要 |
| 🟠 中 | 强制 Toast（不自动消失）+ StatusBar 转红 + 活动流标 ⚠️ |
| 🔴 重 | 上述全部 + **模态对话框**（必须看 + 必须选"回滚"或"坚持"） |
| 🔴 极重 | 上述全部 + 暂停后续所有 AI 操作直到用户处理 |

**关键原则：AI 出错时绝不"安静"——这是"克制在场"的反义时刻，AI 必须显眼。**

### 第 4 层：回（一键回滚）

每次 AI 写入前**自动 snapshot**：

```
.aidevspace/snapshots/<req-id>/<YYYYMMDD-HHmmss-SSS>/
  ├── files/             (写入前文件副本)
  ├── meta.yaml          (操作描述：哪个 Skill / 哪个 turn / 写了哪些文件)
  └── ai-reason.md       (AI 当时为什么这么做的说明)
```

UI：

```
[↶ 回滚上次 AI 操作]    ← StatusBar 旁的常驻按钮
[↶↶ 回滚本次会话全部 AI 操作]
[查看 snapshot 列表]
```

- snapshot 保留 **30 天**后自动清理（用户在 Settings 改）
- 永久保留 vs 立即清理由用户配置
- 任何时候可挑一个 snapshot 看 diff / 回滚 / 删除

### 第 5 层：学（避免重犯）

任何 AI 输出旁都有 👎 按钮（Ink-style，hover 浮现）：

```
AI 输出了一个 SQL DDL
[👎 这有问题]   [👍 还行]   [📋 复制]
       ↓ 点 👎
+--------------------------------------+
| 这次哪里不好？                       |
|  □ 写错位置    □ 内容错误           |
|  □ 多此一举    □ 没理解我意思       |
|  □ 违反规范    □ 其他：_________   |
|  [提交]                              |
+--------------------------------------+
```

- 提交后写入 Skill 的 `bad_feedback:` 字段（`SKILL.md` frontmatter）
- 下次跑同 Skill 时，AI 主动看这条记录 → 调整输出
- 用户可在 Skill 管理页查看 / 编辑 `bad_feedback` 历史
- "👍 还行"也记录 → 正向强化

### AI 翻车时的态度

**不演戏**。不"非常抱歉给您带来困扰"，而是**事实陈述 + 询问**：

> "我刚才把 `refund_order` 表的 `amount` 字段类型写成了 `varchar(20)`，但我们项目里约定是 `decimal(10,2)`。已 snapshot 在 `.aidevspace/snapshots/req-001/20260710-153022/`。要回滚吗？"

不卑不亢，**给事实、给路径、给选项、不表演**。

## Consequences

### 正面

- 不可逆操作（删文件 / force-push / 推 main / 含 secrets）**默认阻止**——即使 AI 想搞破坏也搞不了
- 一键回滚**总是可用**——用户任何时候都能回到上一个安全状态
- 错误不沉默——AI 翻车时**显著**曝光，与"克制在场"的平时形成对比
- 错误会学习——`bad_feedback` 沉淀到 Skill，跨会话跨需求复用
- AI 不"演戏"——避免 sycophancy，用户对 AI 输出更有信任

### 负面 / 代价

- **Agent 工程量大增**——需要加 snapshot 服务、pre-action gate、post-action 验证、Settings 危险操作面板
- **每写一个文件多一次 fs.copy**——性能开销（通常 < 10ms / 文件，可接受）
- **.aidevspace 体积增长**——30 天 snapshot 需评估空间（提供手动清理入口）
- **👎 反馈**依赖用户主动点——不强制收集（避免打扰），但也不会自动发现
- **AI "翻车时显眼"** 与"克制在场"看似冲突——但这是刻意的对比，关键时刻必须显眼

### 拒绝方案的理由

- **全 confirm 一切**：失去"克制在场"的优势，AI 沦为"按确认的机器人"
- **出错了就重跑**：可能再错，消耗 token，且无法保护不可逆操作
- **纯黑盒错误日志**：用户看不见 → 失去"可审计"哲学
- **不做学（bad_feedback）**：同样错误会重复发生，长期成本高

## Alternatives Considered

- **A. 出错自动 git revert**（Aider/Cursor 模式）：依赖 git 状态，snapshot 不依赖 git 更通用
- **B. 出错就 LLM 自评**（Constitutional AI 风格）：消耗 token，且 LLM 自评未必准
- **C. 完全靠 Settings 危险操作白名单**（pre-action gate alone）：没有测/亮/回/学，单点失败就完蛋
- **D. 5 层防线 = 预/测/亮/回/学**（**采用**）：防御纵深，任何一层失败都被下层兜住

## 相关文档

- [CONTEXT.md](../CONTEXT.md) — 决策 43, 46
- [ADR-0008](0008-skill-as-prompt-fragment.md) — Skill 模型反转
- [Issue 08c-snapshot-undo.md](../.scratch/ai-devspace-mvp/issues/08c-snapshot-undo.md) — 实施
- [Issue 08d-bad-feedback-loop.md](../.scratch/ai-devspace-mvp/issues/08d-bad-feedback-loop.md) — 实施
