# ADR-0011: 需求详情页采用「阶段自适应」范式（6 形态模板按 status 自动切换）

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** 项目负责人
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 15, 23, 37
**关联 ADR:**
- [ADR-0006](0006-html-prototype-as-source-of-truth.md) — HTML 原型作为视觉单一事实源
- [ADR-0007](0007-workspace-route-group-shell.md) — 详情路由 shell 拓扑
- [ADR-0009](0009-ai-failure-defense.md) — AI 翻车防线（影响 IMPLEMENTING 形态的 snapshot UI）

## Context

需求详情页（`/requirements/:id`）是 AI-DevSpace 工作台的核心页。v1.0 PRD §6.2 定义了"三栏布局"骨架（资源树 + 主工作区 + Inline 提示栏）并落地为 [docs/design/pages/03-requirement-workspace.html](../design/pages/03-requirement-workspace.html) 与 `apps/web/src/app/(workspace)/requirements/[id]/layout.tsx`。

但首版原型存在两个根本问题：

1. **以"主区放什么内容"思考**——把详情页窄化为"任务执行页"，忽略了需求全生命周期（发现 → 澄清 → 验收 → 设计 → 拆分 → 执行 → 测试 → 归档）
2. **AI thinking 缺失一等公民地位**——AI 的 ANALYZING / CLARIFYING / DESIGNING / PLANNING 阶段产生大量机器中间产物（意图拆解 / 候选方案 / 工具调用轨迹），但首版把这些塞进通用"评论流"

2026-07-12 启动重新设计，先做**调研**（30+ 产品 / 12 个方法论 / 12 个 AI 原生工具），再基于调研结论重新构思 3 个候选方案（详见 `docs/superpowers/specs/2026-07-12-requirement-detail-page-redesign.md`）。

### 调研核心发现

| 维度 | 结论 | 来源 |
|---|---|---|
| 详情页要素 Top-10 跨 18 个产品 | 100% 有标题/描述/状态/负责人；94% 有标签+评论；83% 有子任务；78% 有 PR/Branch | 调研 B |
| 4 类布局范式 | 文档主导 / 任务看板 / 数据密集 / 极简型 | 调研 B |
| AI 在详情页的 4 种形态 | 侧栏助手 / 嵌入式 / ⌘K 命令面板 / 自动审批路由 | 调研 B |
| AI 原生工具共同点 | 放弃"任务详情页"，转向"面板+inline diff"；thinking chain 透明化 | 调研 C |
| AI-DevSpace 9 态的本质 | 把 AI 思考过程显式为**可观察、可中断、可重试**的状态 | 调研 A |

### 详情页应承载的 6 大典型场景

| # | 场景 | 触发 status | 用户要做什么 |
|---|---|---|---|
| ① | 创建 / 编辑需求 | DRAFT | 写 PRD / 关联仓库 / AC 结构化输入 |
| ② | 看 AI 怎么分析 | ANALYZING | 旁观 AI 解析意图、可打断 |
| ③ | 回答 AI 提问 | CLARIFYING | 一问一答消除歧义 |
| ④ | 评审 AI 设计 | DESIGNING | 接受 / 拒绝 / 调整候选方案 |
| ⑤ | 监督 AI 实施 | IMPLEMENTING / PLANNING | 看任务图、看 Diff、看 AI 在做什么 |
| ⑥ | 归档 / 复盘 | DONE / SUBMITTING / ARCHIVED | 看产物、看 PR、归档 |

**核心约束**：6 个场景差异极大（Form vs Q&A vs Compare vs Mission Control vs Archive），单一布局形态硬塞是偷懒。

### 3 个候选方案对比（详见设计文档 §6）

| 维度 | ① 阶段自适应（推荐） | ② 对象中心 | ③ 事件流 |
|---|---|---|---|
| 承载全生命周期 | ★★★★★（每阶段最佳形态）| ★★★（始终同形态，靠视图切换）| ★★★★（事件覆盖所有阶段）|
| 像操作台 | ★★★★★ | ★★★ | ★★★ |
| AI thinking 一等公民 | ★★★★★（专属 Thinking 形态）| ★★★★ | ★★★★★ |
| 与 9 态契合 | ★★★★★（1:1）| ★★ | ★★★★ |
| 实现复杂度 | 高（6 套模板）| 中（1 套 + 6 视图）| 低（1 套事件卡）|
| 行业先例 | Replit Project Editor | Notion / Asana | GitHub Activity / Linear Timeline |

## Decision

**采用方案 ① · 阶段自适应（Stage-Adaptive）**。

详情页主区 = 6 个"形态模板"，由当前 status 自动切换。StatusBar / Sidebar / ResourceTree / Inline 提示栏 / 顶部 AI 思考条 **保持不变**——它们是空间锚点，让用户在形态切换时不丢失方向感。

### 6 形态与 status 的映射

| 形态 | 触发 status | 主区长相 |
|---|---|---|
| **Form 形态** | DRAFT | 居中表单：标题输入 / PRD Markdown 富文本 / 关联仓库多选 / AC 结构化 checklist / [创建并启动 AI 分析] |
| **Thinking 形态** | ANALYZING | 大屏卡片：AI 正在识别"子问题 N 个 / 风险点 N 个 / 候选方案 N 个" + 实时打字机流 + [⏸ 暂停] [↶ 重置] |
| **Q&A 形态** | CLARIFYING | 当前提问焦点 + 候选答案按钮 + 历史澄清记录（可点击回到那一步）|
| **Compare 形态** | DESIGNING | 设计文档 markdown + 候选方案 A/B/C 横向对比 + 取舍点 + [✓ 选 A] [↻ 让 AI 重做] |
| **Mission Control 形态** | PLANNING / IMPLEMENTING | 三列布局：任务 DAG（依赖图）+ Diff 流（累计变更）+ AI 行为流（实时 tool call）|
| **Archive 形态** | SUBMITTING / DONE / ARCHIVED | 产物清单（卡片网格）+ 关联 PR/Commit + 变更统计 + 回顾报告 + [📦 归档] |

### 形态切换机制

- 切换**完全由 status 驱动**（不是用户手动切 Tab）—— 避免"切错地方"的状态感丢失
- 切换时主区"换装"是 feature 不是 bug —— 强化阶段感
- 顶部 StatusBar / 资源树 / 右栏 Inline / 底部 AI 思考条 **保留** —— 空间锚点不丢

### 4 个 HTML 原型（已落地于 `docs/design/pages/`）

| 文件 | 形态 | 用途 |
|---|---|---|
| [11a-stage-adaptive-draft.html](../design/pages/11a-stage-adaptive-draft.html) | DRAFT Form | 视觉对照基线 |
| [11b-stage-adaptive-clarifying.html](../design/pages/11b-stage-adaptive-clarifying.html) | CLARIFYING Q&A | 视觉对照基线 |
| [11c-stage-adaptive-designing.html](../design/pages/11c-stage-adaptive-designing.html) | DESIGNING Compare | 视觉对照基线 |
| [11d-stage-adaptive-implementing.html](../design/pages/11d-stage-adaptive-implementing.html) | IMPLEMENTING Mission Control | 视觉对照基线（最复杂，3 列 DAG/Diff/AI 行为流）|

**剩余 2 形态**（Thinking / Archive）在实施阶段补完原型。

### 与现有架构的契合

- ✅ 顶层 shell（StatusBar + Sidebar）保持不变 → 不破坏 ADR-0007 路由拓扑
- ✅ 资源树 240px + Inline 栏 120px 保留 → 不改 layout 拓扑
- ✅ Linear 紫 #5e6ad2 + Inter + JetBrains Mono → 不引入新 token
- ✅ HTML 原型作为单一事实源（ADR-0006）→ 4 个 HTML 已落盘
- ✅ AI 不抢视觉（CONTEXT.md 决策 23）→ AI 在 Thinking / Mission Control 形态有专属位

## Consequences

### 正面

- **9 态的工程化创新被显式承载** —— 用户能感知"AI 在哪个阶段"，与"操作台"的瞬时定位需求契合
- **6 形态 1:1 覆盖 6 场景** —— 没有"用一个形态硬塞"
- **阶段切换 = "换装"** 是 feature —— 强化阶段感
- **AI reasoning 一等公民** —— Thinking 形态 + Mission Control 的 AI 行为流
- **借鉴 Replit Project Editor 的形态切换范式**，但保留 AI-DevSpace 9 态语义

### 负面 / 代价

- **实现复杂度高**（6 套形态模板）—— 每个形态都需要单独的 React 组件树、状态管理、空态/加载/错误 3 态规范
- **阶段切换"突变"** —— 用户从 DESIGNING 切到 IMPLEMENTING 时主区剧变，可能造成方向感丢失
- **资源树 / Inline 栏需要弱化策略** —— Mission Control 时资源树不能抢视觉
- **新需求列表筛选 / 仪表盘**需要适配——按 status 筛选时 6 形态映射可能要扁平展示

### 风险缓解

| 风险 | 缓解措施 |
|---|---|
| 形态切换突变 | 每个形态保留相同的顶部 breadcrumb + 资源树 + Inline 栏 + 底部 AI 思考条 —— **4 个空间锚点不丢** |
| 实现复杂度 | 5 个形态可复用 Linear / Shortcut 已有模式；Mission Control 可复用 AI IDE 的 inline diff 流；先实现 1 个完整形态（如 11d）做样板 |
| 资源树抢视觉 | 形态切换时通过 CSS 降低资源树饱和度（如 11d 弱化为 outline-only）|
| 阶段切换动效 | 100-200ms 淡入淡出（不是突变）—— 用 Next.js 的 `useTransition` |

### 拒绝方案的理由

**被拒 1：旧探索 HTML（03a/03b/03c-req-detail-*.html）**

用户已明确指出这 3 个方案"把详情页窄化为任务执行页"，忽略全生命周期。仍保留作探索存档，不作为实施对照。

**被拒 2：方案 ② 对象中心（12-object-hub.html）**

- 阶段无关、对象一致性最强——但 DRAFT 阶段和 IMPLEMENTING 阶段"长得一样"会丢失关键差异
- AI 行为作为子节点可能埋深
- 与 AI-DevSpace 9 态契合度仅 ★★

**被拒 3：方案 ③ 事件流（13-event-stream.html）**

- 所有阶段长得一样，认知负担最低——但 DRAFT 阶段事件流空荡，缺引导
- 缺失"概览感"（一眼看不全貌）
- 实现简单（★）但牺牲了"阶段感知"（用户原始 4 目标 ②）

## Alternatives Considered

### A. 旧探索 HTML（A/B/C 任务驱动 / 文件驱动 / 时间轴）

详见 `docs/design/pages/00-req-detail-compare.html`。已被用户明确指出"以内容为中心"的局限，**保留作存档**。

### B. 方案 ② 对象中心（Object Hub）

主区 = 元数据卡 + 6 个子节点视图 tabs（描述 / 子任务 DAG / 产物 / AI 行为 / 仓库 / 历史）+ 底部固定 AI 思考条。所有阶段长得一样。

**采用障碍**：与 9 态契合度低（★★），DRAFT 阶段缺乏引导。

### C. 方案 ③ 事件流中心（Event Stream）

主区 = 全部历史事件时间线 + 类型筛选器。资源树极简化。

**采用障碍**：DRAFT 阶段空荡，缺引导；缺失"概览感"；阶段感知弱。

### D. 方案 ① 阶段自适应（**采用**）

主区 = 6 形态模板按 status 切换。StatusBar / 资源树 / Inline 栏 / AI 思考条 4 个空间锚点不变。

**采用理由**：与 9 态 1:1 映射；6 形态覆盖 6 场景；AI thinking 一等公民；操作台感最强。

## 相关文档

### 设计文档

- [docs/superpowers/specs/2026-07-12-requirement-detail-page-redesign.md](../superpowers/specs/2026-07-12-requirement-detail-page-redesign.md) — 完整调研 + 3 方案 + 推荐

### 4 个 HTML 原型（视觉对照基线）

- [11a-stage-adaptive-draft.html](../design/pages/11a-stage-adaptive-draft.html) — DRAFT Form 形态
- [11b-stage-adaptive-clarifying.html](../design/pages/11b-stage-adaptive-clarifying.html) — CLARIFYING Q&A 形态
- [11c-stage-adaptive-designing.html](../design/pages/11c-stage-adaptive-designing.html) — DESIGNING Compare 形态
- [11d-stage-adaptive-implementing.html](../design/pages/11d-stage-adaptive-implementing.html) — IMPLEMENTING Mission Control 形态

### 旧 HTML 原型（探索存档）

- [03-requirement-workspace.html](../design/pages/03-requirement-workspace.html) — 首版三栏布局
- [03a-req-detail-task-driven.html](../design/pages/03a-req-detail-task-driven.html) — 旧方案 A
- [03b-req-detail-file-driven.html](../design/pages/03b-req-detail-file-driven.html) — 旧方案 B
- [03c-req-detail-timeline-driven.html](../design/pages/03c-req-detail-timeline-driven.html) — 旧方案 C

### 其他方案原型（被拒方案的 HTML 对照）

- [12-object-hub.html](../design/pages/12-object-hub.html) — 方案 ② 对象中心
- [13-event-stream.html](../design/pages/13-event-stream.html) — 方案 ③ 事件流

### 关联 ADR

- [ADR-0006](0006-html-prototype-as-source-of-truth.md) — HTML 原型作为单一事实源
- [ADR-0007](0007-workspace-route-group-shell.md) — 详情路由 shell 拓扑
- [ADR-0009](0009-ai-failure-defense.md) — AI 翻车防线（影响 IMPLEMENTING 形态的 snapshot UI）

### 待实施 Issue（占位）

将拆分为：
- `xx-requirement-detail-stage-adaptive-shell.md` — 形态切换框架 + status 驱动
- `xx-form-morph-draft.md` — DRAFT Form 形态落地
- `xx-qa-morph-clarifying.md` — CLARIFYING Q&A 形态落地
- `xx-compare-morph-designing.md` — DESIGNING Compare 形态落地
- `xx-mission-control-morph.md` — IMPLEMENTING Mission Control 形态落地
- `xx-thinking-morph-analyzing.md` — ANALYZING Thinking 形态（HTML 待补）
- `xx-archive-morph.md` — Archive 形态（HTML 待补）

## 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-12 | 初稿：基于调研 + 3 方案对比 + 4 个 HTML 原型落地，决定采用方案 ① 阶段自适应 | Brainstorming 会话 |