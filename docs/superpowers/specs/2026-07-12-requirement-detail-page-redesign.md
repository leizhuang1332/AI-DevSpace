---
status: draft-for-user-review
created: 2026-07-12
type: research-and-redesign-proposal
scope: AI-DevSpace `/requirements/:id` 详情页（含 workspace / repos / artifacts / history / settings 五个子路由）
related:
  - docs/superpowers/specs/2026-07-12-requirement-detail-page-redesign.md (本文件)
  - CONTEXT.md
  - .scratch/ai-devspace-mvp/PRD.md §6
  - .scratch/ai-devspace-mvp/UI-POLISH-SPEC.md §4
  - docs/design/pages/03-requirement-workspace.html (旧 HTML 原型)
  - docs/design/pages/03a-03c (本次探索出的 3 方案 HTML)
---

# 需求详情页重新设计 · 调研 + 设计提案

> **本文档目的**：把"重新设计需求详情页"这件事从问题界定 → 调研 → 提炼 → 候选方案 → 推荐，全部沉淀为可审阅的单一事实源。

---

## 第 0 部分 · 任务目标

### 0.1 用户原始 4 项目标（来自首条设计请求）

1. **日常开发流程与操作** — 详情页要支撑每天的开发活动，不是单次查看
2. **阶段感知** — 用户在不同阶段看到的信息不一样
3. **AI 融入工作流** — 和 AI 的交流不能是另一个孤立的聊天框
4. **操作台感** — 像操作台，不像聊天框

### 0.2 用户的关键修正（来自第 4 轮反馈）

> "我觉的这是不是三个方案也是三种数据呈现形式，要从全局出发，要充分考虑需求开发的全生命周期。不仅仅是任务管理（这只是全流程中的一小部分）。先调研一下标准的需求管理和开发流程和范式，以及同类产品的实现方式"

**修正的含义**：
- 我之前 3 方案（A 任务驱动 / B 文件驱动 / C 时间轴）都把"详情页"窄化为"任务执行页"
- 详情页应该承载 **需求全生命周期**（发现 → 澄清 → 验收 → 设计 → 拆分 → 执行 → 测试 → 归档），不是"任务"这一个环节
- 视角要从"主区放什么内容"转向"详情页如何承载不同阶段的不同形态"

---

## 第 1 部分 · 现状回顾

### 1.1 已落地的代码骨架

```
apps/web/src/app/(workspace)/requirements/[id]/
├── layout.tsx                # 三栏 grid-cols-[240px_1fr_120px]
├── page.tsx                  # 默认 workspace tab (markdown 渲染)
├── repos/page.tsx
├── artifacts/page.tsx
├── history/page.tsx
└── settings/page.tsx
```

锁定元素（来自 [CONTEXT.md §决策 37](../../CONTEXT.md) + [ADR-0007](../adr/0007-workspace-route-group-shell.md)）：

- 顶层 shell = StatusBar + Sidebar（56px）+ 主区
- 详情路由 layout = 资源树（240px）+ 主区 + InlineRail（120px）
- AI **不占右栏常驻位**（[UI-POLISH-SPEC §4.1](../../adr/0005-brand-palette-six-step.md) 范式变化）
- AI 通过 ⌘K 命令面板、Toast、Inline 浮窗出现

### 1.2 已有 HTML 原型（本次调研前）

`docs/design/pages/03-requirement-workspace.html`（按 ADR-0006 视觉对照标准）：

- 顶部 StatusBar（含 Tab 栏 + 状态条）
- 左 240px ResourceTree（6 段分组：概览/分析/设计/计划/产物/对话/仓库）
- 中 主工作区（CenterTabs：markdown/diff/files/chat + 操作条 + 文档渲染）
- 右 120px Inline 提示栏（AI 提示浮窗收纳）

### 1.3 本次新增的探索性 HTML 原型（不替代 03）

```
docs/design/pages/00-req-detail-compare.html     # 3 方案对比入口
docs/design/pages/03a-req-detail-task-driven.html # 方案 A 任务驱动
docs/design/pages/03b-req-detail-file-driven.html # 方案 B 文件驱动
docs/design/pages/03c-req-detail-timeline-driven.html # 方案 C 时间轴驱动
```

**注意**：这 4 个 HTML 是本次 brainstorming 探索产物，**用户已指出它们都把详情页窄化为任务执行页**。它们作为"以内容为中心"的探索存档保留，**不作为最终视觉对照标准**。

---

## 第 2 部分 · 调研方法

本次采用 3 个并行主调研 agent，每个主 agent 内部分别进一步并行子 agent：

| 主 Agent | 主题 | 子 Agent 数 |
|---|---|---|
| 方法论 | 需求 / 项目 / 任务管理的方法论与全生命周期模型 | 1（直查） |
| 产品 | 18 个项目管理 / Issue 详情页对比 | 1（直查） |
| AI IDE / 工作台 | AI 原生开发工具的工作区与 AI 透明度 | 5（deep-research 派 5 子 agent） |

**总计**：8 份独立调研，覆盖 30+ 产品 + 12 个方法论 + 5 个 AI 原生工具。

---

## 第 3 部分 · 调研发现

### 3.1 调研 A · 需求 / 项目管理方法论

#### 3.1.1 横向对比表 · 方法论 × 8 个标准环节

8 个标准环节：**发现 Discovery / 澄清 Clarification / 验收标准 Acceptance Criteria / 设计 Design / 拆分 Decomposition / 执行 Execution / 测试 Testing / 回顾归档 Retrospective & Archival**

| 方法论 | 发现 | 澄清 | 验收标准 | 设计 | 拆分 | 执行 | 测试 | 回顾归档 |
|---|---|---|---|---|---|---|---|---|
| **Scrum** | Product Backlog Grooming | Sprint Planning Q&A | Definition of Done | — | Backlog Refinement | Sprint 执行 + Daily | Sprint Review 演示 | Sprint Retrospective |
| **Scrumban** | Inbox / Backlog | WIP 触发 Pull 讨论 | Done 协议 | — | 持续拆卡 | 单件流 | Review 列 | 周期 Retro + 流动度量 |
| **Shape Up** | Shaping(粗糙原型+边界) | Betting Table(投资人下注) | Hill Chart(山顶=已知未知) | Shaping 阶段产出 | 6 周 Cycle 内自组织 | Building(团队自治,固定时间变动范围) | Bug Bash | Cool-down(2 周修缮、收尾、归档) |
| **Kanban** | 可视化、需求请求 | 站会即时澄清 | Definition of Flow / WIP 策略 | — | 按队列拆分 | 单件流,WIP 限制 | Review 列 / 集成测试 | Lead/Cycle Time 度量、Kaizen |
| **User Story Mapping** | 用户旅程工作坊 | Backbone 故事线 | Walking Skeleton 验证 | — | 垂直 Slice = Release | 按 Slice 实施 | 端到端最小可交付 | Release 切片回顾 |
| **BDD / Three Amigos** | Example Mapping | Three Amigos 同会话 | Given-When-Then 场景 | — | Scenario 拆分 | Step Definition 实现 | 自动化 Spec | Living Documentation |
| **SAFe** | Envision / Vision | PI Planning(双向商谈) | Feature → Story AC | Architectural Runway | Feature → Story → Task | 4~5 个 Iteration | Iteration Review | Inspect & Adapt |
| **Spotify Model** | Mission / Vision | Squad 自治对齐 | Squad DoD | — | Squad 内部拆分 | Squad Triage | Guild 共享实践 | Tribe 级别 Retro |
| **ITIL v3/4** | Service Strategy / Engage | Service Design | Service Level Requirement | Service Design | Service Transition | Operation / Deliver&Support | Validation Test | Continual Improvement |
| **BABOK (IIBA)** | Strategy Analysis | Elicitation & Collaboration | Verify / Validate | Requirements Analysis & Design Definition | Decompose / Prioritize | Lifecycle Management | 评估/确认 | Solution Evaluation |
| **IREB CPRE** | Elicitation | Negotiation | Validation | Documentation & Modeling | Modular Decomposition | Traceability | Review / Test | Configuration Management |
| **IEEE 830 / 29148** | Stakeholder Needs | SRS §1 Introduction | Verification & Validation | §3 Requirements 详写 | Sub-requirements 树 | Implementation | Verification Approach | Change Mgmt |
| **Spec-driven (GitHub Spec Kit)** | `/specify` 用户意图澄清 | `/specify` 多轮澄清 | Acceptance Scenarios | `/plan` 技术实现方案 | `/tasks` 依赖排序 | `/implement` AI agent 编写 | `/tasks` 测试优先 | 宪法文件 + 复盘 |
| **Vibecoding (Karpathy)** | 自然语言 prompt | Re-prompt 循环 | Vibe-check(目测+接受 diff) | — | — | LLM 全权写代码 | 接受/拒绝 diff | 出现解决不了就重写 prompt |
| **Cursor / Devin / Bolt / Lovable** | 自然语言描述 + 模板 | Chat 界面追问 | Prompt 内嵌"约束" | — | — | VM / Sandbox 并行执行 | 浏览器预览 | 文档/README 自动生成 |

**小结**：**澄清 + 验收标准 + 拆分**是几乎所有方法论的"刚需三角"；传统人类 Sprint 视角强调"分组 / WIP / 站会"；重型框架强调"分层 + 度量"；学术派强调"完整性 + 文档化 + 验证"；**AI 原生流派（Spec Kit / Vibecoding）直接砍掉了传统"设计 + 拆分"**，把"澄清"和"验收"内化到 prompt 里。

#### 3.1.2 跨方法论详情页应承载的 12 个核心信息/动作

| # | 信息 / 动作 | 说明 | 主要方法论支撑 |
|---|---|---|---|
| 1 | 标题 + 唯一 ID | 一句话描述目标 | 全部 |
| 2 | 背景 / 问题陈述 | "为什么做这个",Who & Why | BABOK Strategy Analysis、USM Backbone、Spec Kit `/specify` |
| 3 | 描述 / 当前行为 | As-Is / To-Be | BABOK、IEEE 29148 §2 |
| 4 | 验收标准（AC） | 可测试的 Given-When-Then 或 DoD | BDD、IEEE SRS §3、Scrum DoD |
| 5 | 优先级 / 时间盒 | MoSCoW / Hill Chart 位置 | Scrum、Shape Up、Kanban |
| 6 | 负责人 / 协作人 | 单 Owner，多人协作 | Scrum(PO/Dev)、SAFe、Spotify Squad |
| 7 | 状态（State Machine） | 当前阶段、可合法转移 | Jira / Linear / AI-DevSpace 9 态 |
| 8 | 状态历史 / 时间线 | 何时进入何状态、停留时长 | Kanban Lead/Cycle Time、SAFe PI 度量 |
| 9 | 关联(链接) / 依赖 | Blocks / Blocked by / Parent-child | Jira / Linear / IREB Traceability |
| 10 | 子任务 / 拆分 | 用户故事切片、任务清单 | USM Slice、Spec Kit `/tasks`、Backlog Refinement |
| 11 | 评论 / 活动流 | 沟通 + 决策留痕 | 全部 |
| 12 | 关联文件 / 代码 / Spec | 代码、文档、Spec、PR | Vibecoding / Spec Kit / Devin 隐含 |

**最低可用集（8）**：1, 3, 4, 5, 6, 7, 8, 11。
**完整版（12）**：再加 2, 9, 10, 12。
**AI 原生增强**：12 关联 Spec/代码 + 13 阻塞 + AI 自动摘要评论 11。

#### 3.1.3 AI-DevSpace 9 态 vs 传统方法论状态机

| 阶段 | AI-DevSpace 9 态 | Jira 默认 4 态 | Linear 默认 6 态 | 经典 5 态 |
|---|---|---|---|---|
| 0 酝酿 | **DRAFT** 草稿 | — | Backlog | — |
| 1 分析意图 | **ANALYZING** 分析中 | To Do | Backlog / Todo | Open |
| 2 澄清疑问 | **CLARIFYING** 澄清中 | To Do | Todo | Open |
| 3 设计方案 | **DESIGNING** 设计中 | In Progress | In Progress | In Progress |
| 4 拆分计划 | **PLANNING** 计划中 | In Progress | In Progress | In Progress |
| 5 实施实现 | **IMPLEMENTING** 实现中 | In Progress | In Progress | In Progress |
| 6 验收提交 | **SUBMITTING** 提交中 | In Review | In Review | In Review |
| 7 完成 | **DONE** 完成 | Done | Done | Done / Closed |
| 8 归档 | **ARCHIVED** 已归档 | — | Cancelled | Closed |

#### 3.1.4 9 态的本质差异

**传统 Jira / Linear 把"实现"看作一个原子动作**（`In Progress` 一桶装），因为执行者 = 人 = 一个连续体。**状态粒度 = 人的视角粒度**。

**AI-DevSpace 把"澄清 / 设计 / 计划 / 实施"拆成 4 个独立状态**，因为执行者 = AI Agent = 一组可独立调用、独立失败、独立重试的子动作：

1. **ANALYZING** — LLM 解析输入、识别隐含意图
2. **CLARIFYING** — LLM 向用户发问、等待回应、消除歧义
3. **DESIGNING** — LLM 生成多个候选方案、做技术选型
4. **PLANNING** — LLM 把方案拆解为有序任务、分配工具调用
5. **IMPLEMENTING** — LLM 实际生成代码 / 改文件
6. **SUBMITTING** — 自动跑测试 / 创建 PR / 推送 review

**关键差异**：每个 AI 状态都可独立**重试 / 失败 / 跳过 / 人工接管**——这是 AI 系统的天然特性。人类不需要"重试澄清"，但 LLM 会，所以需要把"澄清"独立成可暂停-可恢复的状态。

**额外洞察**：DRAFT 与 ARCHIVED 是"场外状态"，只有 DRAFT → ANALYZING 和 ARCHIVED 是终态。9 态构成**两层结构**：核心 7 态（ANALYZING → SUBMITTING）是工作流主干，2 个边缘态（DRAFT / ARCHIVED）是生命周期端点。这与传统工作流"主干 + Cancelled"的扁平结构不同。

#### 3.1.5 调研 A 的事实引用

| # | 来源 | 关键摘录 |
|---|---|---|
| A1 | Atlassian — [Discover the Spotify model](https://www.atlassian.com/agile/agile-at-scale/spotify) | "Squad 类似 mini-startup，Tribe 聚合相关 Squad，Chapter 横向能力对齐，Guild 跨组织兴趣社区。" |
| A2 | InfoQ — [Scaling Agile At Spotify: An Interview with Henrik Kniberg](https://www.infoq.com/news/2013/04/scaling-agile-spotify-kniberg/) | Kniberg & Ivarsson 2012 白皮书官方访谈 |
| A3 | Scaled Agile — [PI Planning](https://www.scaledagileframework.com/pi-planning/) | PI Planning 双向商谈机制 |
| A4 | Atlassian Scrum Guide — [5 ceremonies](https://www.atlassian.com/agile/scrum) | Sprint / Product Backlog / Daily / Review / Retro |
| A5 | Basecamp Shape Up（Ryan Singer）— [Shape Up 文档](https://basecamp.com/shapeup) | 6 周 Cycle + 2 周 Cool-down;Shaping → Betting Table → Building → Cool-down |
| A6 | David J. Anderson — *Kanban: Successful Evolutionary Change for Your Technology Business*（2010）| 6 大核心实践 |
| A7 | Jeff Patton — *User Story Mapping*（O'Reilly）| Backbone → Walking Skeleton → User Story |
| A8 | BDD / Three Amigos — [Introducing BDD](https://dannorth.net/2006/09/introducing-bdd/) | Given-When-Then / 活文档 |
| A9 | IIBA BABOK v3 — [BABOK Guide](https://www.iiba.org/standards-and-resources/babok/) | 6 Knowledge Areas |
| A10 | IREB CPRE Foundation — [IREB 官网](https://www.ireb.org/) | Foundation Level 关注需求工程基础活动 |
| A11 | IEEE 830-1998 → IEEE 29148-2018 | SRS 结构（Introduction / Stakeholders / Requirements / V&V） |
| A12 | ITIL 4 — [ITIL Foundation](https://www.axelos.com/certifications/itil-service-management/itil-4-foundation) | Service Value Chain 6 活动 |
| A13 | Andrej Karpathy — [X 推文 2025-02-02](https://x.com/karpathy/status/1886192184808149383) | "There's a new kind of coding I call 'vibe coding'..." |
| A14 | GitHub Spec Kit — [Spec Kit 仓库](https://github.com/github/spec-kit) | /specify → /plan → /tasks → /implement 四阶段 |
| A15 | IBM — [What is Vibe Coding?](https://www.ibm.com/think/topics/vibe-coding) | "AI-dependent software development practice..." |
| A16 | Linear Method — [Linear Docs: Cycles](https://linear.app/docs/cycles) | Linear 6 状态 |

---

### 3.2 调研 B · 项目管理产品详情页（18 个）

#### 3.2.1 产品分类速览

| 类别 | 产品 | 范式（一句话） |
|---|---|---|
| **开发者向 PM** | Linear | 中栏描述 + 右栏属性面板；极简字段、键盘流驱动、AI 命令面板 ⌘K |
| | Shortcut (Clubhouse) | 中栏描述 + 右栏"Story 状态/负责人/分支"侧栏；强 Git 集成 |
| | Height | 极简 Linear 风格；强调 ⌘K 与自动状态 |
| | Plane | 类 Linear 开源版；三段式（中描述 / 左子任务 / 右属性） |
| | ZenHub | 寄生 GitHub Issue 右栏；Pipeline/Sprint/Estimate |
| | Focalboard | 类 Trello 但带详细字段页 |
| **传统重型** | Jira | 富文本描述为绝对中心；右栏字段极多（30+ 自定义） |
| | Azure DevOps | 多 Tab 工作项表单（Details/History/Links/Attachments） |
| | Rally | 三栏 + 强 Iteration/Release 树 |
| **轻量协作** | Trello | "Card Back" 右侧抽屉：标题→描述→成员→标签→清单→附件 |
| | Asana | 中栏描述 + 右栏字段面板；富子任务、依赖关系视觉化 |
| | ClickUp | 多 Tab 详情页（Description/Subtasks/Comments/Activity/Files） |
| | Notion | 文档即页面；右栏数据库属性 + AI 总结 / 内联 AI |
| | Tower / 飞书项目 | 右侧抽屉 + Tabs（属性 / 子任务 / 评论 / 历史） |
| **代码平台原生** | GitHub Issues | 左中描述+评论时间线 + 右侧 metadata 栏 |
| | GitLab Issues | 类似 GitHub 但侧栏强调 MR/Epic 链接 |
| | Bitbucket Issues | 极简：左描述 + 评论区 + 顶部元数据栏 |

#### 3.2.2 详情页要素 Top-10 排行（跨 18 个产品统计）

| 排名 | 元素 | 出现率 | 评价 |
|---|---|---|---|
| 1 | 标题 + ID/编号 | 18/18 (100%) | 所有产品都有 |
| 2 | 描述（富文本正文） | 18/18 (100%) | 主导元素 |
| 3 | 状态 (Status/Workflow State) | 18/18 (100%) | 必有 |
| 4 | 负责人 (Assignee) | 17/18 (94%) | Bitbucket 部分弱化 |
| 5 | 标签 / Labels | 17/18 (94%) | GitHub/Linear/Plane 强 |
| 6 | 评论 / Activity 时间线 | 17/18 (94%) | 主流为底部时间线 |
| 7 | 子任务 / Sub-tasks | 15/18 (83%) | Linear/Asana/ClickUp 强；Trello 用 Checklist |
| 8 | 关联 PR / Branch | 14/18 (78%) | GitHub/GitLab/Bitbucket 原生；Linear/Shortcut 深度 |
| 9 | Due date / 截止日期 | 14/18 (78%) | Trello/Asana/ClickUp 强 |
| 10 | 优先级 Priority | 13/18 (72%) | Jira/Linear/Asana 用色块 |

**少数派元素（<50%）**：

- 估时 / Story Points：5/18 = 28%（Linear / Shortcut / Jira / ClickUp / Plane）
- Sprint / Cycle / Iteration：5/18 = 28%
- 依赖 / Dependencies：4/18 = 22%
- AI 总结 / 下一步：5/18 = 28%（Rovo / Linear AI / GitHub Copilot for Issues / Notion AI / ClickUp AI）
- **可执行结果入口：几乎全部缺失**（除 GitLab MR 状态、GitHub Checks API 间接）

#### 3.2.3 布局范式 4 类

| 范式 | 代表 | 核心特征 | 关键观察 |
|---|---|---|---|
| **文档主导型** | Jira / GitHub Issues / GitLab / Bitbucket | 富文本居中 60%；评论时间线在底部；元数据右栏 | GitHub 2024 后改版接近文档主导 |
| **任务看板型** | Linear / Height / Plane / Trello / Shortcut | 父需求 + 嵌套子任务是核心；主区可切列表/看板/时间线 | Linear 把 sub-issues/projects/cycles 做成嵌套折叠面板 |
| **数据密集型** | Jira 自定义 / ClickUp / Azure DevOps / Rally | 30+ 字段，主描述被挤到第三栏；字段可分 Tab | ClickUp 把"字段+描述+子任务+评论+活动+附件"全部 Tab 化 |
| **极简型** | Linear / Plane / Notion / GitHub Issues 精简模式 | 字段极少（<10）；其他信息 ⌘K 唤起 | Linear 单字母快捷键把鼠标降到最低 |

#### 3.2.4 AI 在详情页里的 4 种形态

| 形态 | 代表 | 触发 | 输出 |
|---|---|---|---|
| **侧栏助手** | Notion AI / ClickUp AI Brain / Rovo Chat | 右栏/底部固定 | 总结长 issue、生成会议纪要 |
| **嵌入式 AI** | GitHub Copilot for Issues / Notion AI 内联 | 编辑器内 `/ai` | 生成 issue 描述、子任务 |
| **AI 命令面板** | Linear AI ⌘K / Plane AI / Height Autopilot | 命令面板输自然语言 | 解析意图、执行动作 |
| **AI 审批 / 路由** | Rovo 自动分类 / Linear AI Triage / Copilot Issues | issue 创建时 | 自动标签、推荐负责人、识别 duplicate |

#### 3.2.5 关键发现 · 对 AI-DevSpace 最相关的 5 条

1. **「代码 / 仓库 / 产物」关联是开发者向 PM 工具的核心差异化** — GitHub / Linear / Shortcut / ZenHub 都在 metadata 栏做"Development"区块
2. **AI 不抢占视觉，但可以"动手"是主流共识** — Rovo 用折叠面板、Copilot 用 /ai 触发、Linear 用 ⌘K；AI 给的是建议（suggest），用户必须显式 accept
3. **子任务 / 关联项是使用率最高的次级元素（Top 7）** — 详情页"描述"之外最大视觉权重应该给"子任务 / 关联制品"，而不是评论
4. **键盘流 / 极简字段是开发者向 PM 工具的护城河** — Linear J/K/I/P/S/L/D 快捷键
5. **「关联产物 / 可执行入口」是 AI-DevSpace 的差异化锚点，主流产品都缺失** — AI-DevSpace 应把"产物的运行时状态"直接渲染在父需求详情页

#### 3.2.6 调研 B 的事实引用

| # | 来源 | 关键摘录 |
|---|---|---|
| B1 | Linear — [Issue Views 文档](https://linear.app/docs/issue-views) | Linear 详情页布局范式 |
| B2 | Linear AI — [Linear AI 产品页](https://linear.app/ai) | AI 命令面板 + Triage |
| B3 | Shortcut — [Help: Story view](https://help.shortcut.com/hc/en-us/articles/360000046826-Stories) | Story 详情页 + 分支集成 |
| B4 | Plane — [Plane 仓库](https://github.com/makeplane/plane) | 三段式开源 PM |
| B5 | Jira — [New Jira issue view](https://confluence.atlassian.com/jiracorecloud/the-new-jira-issue-view-938040503.html) | 文档主导型 + 30+ 字段 |
| B6 | Atlassian Rovo — [产品页](https://www.atlassian.com/software/rovo) | AI teammate + Rovo Studio |
| B7 | Azure DevOps — [Form Layout](https://learn.microsoft.com/en-us/azure/devops/organizations/settings/work/customize-process-form?view=azure-devops) | 多 Tab 工作项表单 |
| B8 | Trello — [Cards Help](https://help.trello.com/article/818-cards) | Card Back 抽屉 |
| B9 | ClickUp — [Help Center](https://help.clickup.com/) | ClickUp 2.0 多 Tab 详情 |
| B10 | Notion — [Notion AI](https://www.notion.so/product/ai) | 内联 AI + Q&A |
| B11 | Notion — [editing-properties](https://www.notion.com/help/editing-properties) | 数据库属性 |
| B12 | GitHub — [Issues 文档](https://docs.github.com/en/issues) | 右侧 metadata 栏 |
| B13 | GitHub — [Copilot for Issues GA](https://github.blog/changelog/2024-05-21-github-copilot-for-issues-is-now-generally-available/) | /ai 内联生成 |
| B14 | GitHub — [Copilot for Issues 入门](https://github.blog/news-insights/product-news/github-copilot-for-issues-4-steps-to-get-you-started/) | 4 步使用 |
| B15 | GitLab — [Issue Design System](https://design.gitlab.com/components/issue) | 侧栏强调 MR/Epic |
| B16 | 飞书项目 — [关联工作项信息](https://www.feishu.cn/content/60ws558p) | 跨空间同步控件 |
| B17 | 飞书项目 — [敏捷开发模板](https://www.feishu.cn/practice_template/16382) | Sprint / Backlog 范式 |
| B18 | 飞书 AI 智能字段 — [CSDN 评测](https://blog.csdn.net/meisongqing/article/details/146361028) | AI 自动填字段 |
| B19 | Notion 3.0 AI Agent — [腾讯新闻](https://new.qq.com/rain/a/20250920A03SPS00) | Notion Agent 进化 |

---

### 3.3 调研 C · AI 原生 IDE / Agent 工作台（12+ 个）

#### 3.3.1 5 类范式

| 范式 | 代表产品 | 核心特征 |
|---|---|---|
| **IDE 内嵌 AI** | Cursor / Continue.dev / Cody (Sourcegraph) / Windsurf / Tabnine | 编辑器为主，AI 在侧栏对话；inline ghost-text diff；持久化上下文 (.cursorrules / .continuerules / .windsurfrules) |
| **Agent 异步执行** | Devin (Cognition) / Factory / Replit Agent / Manus AI / Smol Developer | 需求组织成会话；Progress tab 展示步骤；Shell 输出 + IDE 编辑 + Browser 活动；Playbook / Droid / Plan mode |
| **AI 应用生成器** | Bolt.new / Lovable / v0 / Splash | 对话 + 实时预览（iframe / WebContainer / 多候选 thumbnail） |
| **AI 编码工作台** | Aider / Claude Code / Zed AI / Phind / Cline | CLI / REPL / 原生 IDE；审批粒度差异大；checkpoint 机制 |
| **AI 驱动项目管理** | Linear AI / Height / Atlassian Rovo / Notion AI / Asana AI | 传统项目页 + AI 增强；AI 不占独立位 |

#### 3.3.2 12 个产品速览

| 产品 | 主形态 | 审批粒度 | Checkpoint | 上下文 | 自动化开关 | 生态亮点 |
|---|---|---|---|---|---|---|
| **Aider** | CLI | hunk 级 | git commit per turn | repo map + `--read` + `@file` | `--auto-accept-edits` | git-first / auto commit msg |
| **Claude Code** | CLI + REPL | tool-call 级 | git 自动 + `/rewind` | CLAUDE.md + TodoWrite | `acceptEdits` mode | TodoWrite 任务图显式化 |
| **Zed AI** | IDE 原生 | hunk 级（reject 保留原 buffer） | inline 拒保留 | `@file` / `@symbol` | 无明确 auto | GPU 原生 + 被动预测 |
| **Phind** | Web IDE | 整段级 | 整段回滚 | `@file` + 自动相关文件 | 模式切换 | Search-first / 实时 web search |
| **Cline** | VS Code 插件 | file 级 | 显式 Restore Checkpoint | `@file` + codebase index | 逐条 Save | MCP + browser screenshot |
| **Cursor** | 编辑器 | inline diff | .cursorrules | `@file` / 项目索引 | accept-all | Composer / Reasoning 块 |
| **Continue.dev** | VS Code / JetBrains | inline | .continuerules | `@file` | accept-all | 开源 + 本地模型 |
| **Cody (Sourcegraph)** | IDE | inline | .cody/rules | `@file` + 跨仓索引 | accept-all | 全代码库语义搜索 |
| **Windsurf** | 编辑器 | inline diff | .windsurfrules | `@file` | Flow / Cascade | Cascade 自主 agent |
| **Devin** | Web IDE | 整段（take over） | session restore | DeepWiki + Ask Devin | 全自动 | Playbook 模板 |
| **Factory** | Web/Desktop | task 级 | session log | Slack 注入 | Mission Control | Droid + orchestrator |
| **Replit Agent** | Web IDE | task 级（Apply） | Checkpoint 自动 | Project Editor | Plan mode 必审 | Active 隔离副本 |
| **Bolt.new** | WebContainer | 整段 | Restore | WebContainer iframe | 自动落盘 | 三段式（prompt/code/preview） |
| **Lovable** | Web IDE | 整段 | GitHub 同步 | `#file` + Visual Edit | 自动 | "指着改哪里" |
| **v0** | Web | 整段 | 无（丢弃式） | `#component` | 自动 | 多候选 thumbnail |

#### 3.3.3 5 条共同范式提炼

1. **所有产品都放弃"任务详情页"，转向"面板 + inline diff"** — AI 输出不再进"详情页"，而是直接进 IDE 编辑器或侧栏
2. **三层结果档（只读 / 预览落盘 / 自动落盘）成为行业标配** — 审批粒度逐步细化为 hunk / file / task
3. **thinking chain 透明化是新的产品分水岭** — Cursor 的 Reasoning 块、Windsurf 的 Plan markdown 文件、Cline 的 screenshot 对比
4. **持久化上下文（.cursorrules / .windsurfrules / CLAUDE.md / Spec Kit 宪法）正在把 AI 从"问答对象"重塑为"项目协作者"** — 跨 session 的项目记忆
5. **审批时机不断前置** — Claude Code 的"先列 TodoWrite → 用户 ack → 再执行"成为主流；Devin / Factory 的"Plan 阶段必审"几乎成必选

#### 3.3.4 调研 C 的事实引用

| # | 来源 | 关键摘录 |
|---|---|---|
| C1 | Aider — [conventions 文档](https://aider.chat/docs/usage/conventions.html) | commit-per-turn / repo map |
| C2 | Aider — [GitHub 仓库](https://github.com/Aider-AI/aider) | CLI 实现 |
| C3 | Claude Code — [GitHub 仓库](https://github.com/anthropics/claude-code) | REPL + agent loop |
| C4 | Claude Code — [Slash commands](https://docs.claude.com/en/docs/claude-code/slash-commands) | /init /clear /model /compact |
| C5 | Claude Code — [Manage permissions](https://docs.claude.com/en/docs/claude-code/iam) | permission modes |
| C6 | Zed — [Inline Edit 文档](https://zed.dev/docs/ai/inline-edit) | popover + ghost-text |
| C7 | Zed — [Assistant Panel](https://zed.dev/docs/ai/assistant-panel) | 线程化对话 |
| C8 | Zed — [Introducing Inline Edit](https://zed.dev/blog/inline-edit) | AI 在缓冲区原地给改动 |
| C9 | Phind — [官网](https://www.phind.com/) | Search-first mode |
| C10 | Phind — [Code Agent 介绍](https://www.phind.com/agents) | Chat / Edit 模式切换 |
| C11 | Cline — [官网](https://cline.bot/) | MCP + browser tool |
| C12 | Cline — [文档](https://docs.cline.bot/) | Checkpoint + screenshot |
| C13 | Cline — [GitHub 仓库](https://github.com/cline/cline) | MCP marketplace |
| C14 | Cursor — [官方文档](https://docs.cursor.com/) | Composer / Cmd-K |
| C15 | Continue — [官方文档](https://docs.continue.dev/) | 开源 IDE AI |
| C16 | Sourcegraph Cody — [官方文档](https://sourcegraph.com/docs/cody) | 全代码库搜索 |
| C17 | Windsurf — [官方文档](https://docs.codeium.com/windsurf/getting-started) | Cascade / Flow |
| C18 | Devin — [Session Tools](https://docs.devin.ai/work-with-devin/devin-session-tools) | Progress tab + take over |
| C19 | Devin — [Playbooks](https://docs.devin.ai/product-guides/using-playbooks) | 任务模板 |
| C20 | Devin — [DeepWiki](https://docs.devin.ai/work-with-devin/deepwiki) | 代码库问答 |
| C21 | Factory — [Web 入门](https://docs.factory.ai/web/getting-started/overview) | Droid + Mission Control |
| C22 | Factory — [Missions](https://docs.factory.ai/web/missions) | 多 worker 编排 |
| C23 | Factory — [Slack Integration](https://docs.factory.ai/integrations/slack) | 上下文注入 |
| C24 | Replit — [Project Editor](https://docs.replit.com/learn/projects-and-artifacts/project-editor) | Plan mode + Build |
| C25 | Replit — [Task Board](https://docs.replit.com/references/agent/task-board) | Draft/Active/Ready/Done |
| C26 | Replit — [Checkpoints](https://docs.replit.com/references/version-control/checkpoints-and-rollbacks) | 自动 checkpoint |
| C27 | Bolt.new — [官网](https://bolt.new/) | 三段式 + WebContainer |
| C28 | Lovable — [官网](https://lovable.dev/) | Visual Edit + GitHub 同步 |
| C29 | v0 — [官网](https://v0.app/) | 多候选 thumbnail |
| C30 | Manus AI — [官网](https://manus.im/) | 云端异步任务空间 |
| C31 | Smol Developer — [GitHub 仓库](https://github.com/smol-ai/developer) | 极简 CLI |
| C32 | GitHub Spec Kit — [仓库](https://github.com/github/spec-kit) | /specify /plan /tasks /implement |

---

## 第 4 部分 · 关键洞察

### 4.1 之前 3 方案的"窄"（A/B/C 任务驱动 / 文件驱动 / 时间轴）

我之前在 brainstorming 第一轮提出的 3 个方案（A 任务驱动 / B 文件驱动 / C 时间轴）有 3 个根本问题：

1. **以"主区放什么内容"思考**（任务列表 / Markdown / 阶段轴），而不是"用户在生命周期不同阶段要做什么"
2. **把"详情页"当成静态容器**，没有体现**阶段切换时信息和动作的剧变**（DRAFT 阶段只需 PRD 描述；IMPLEMENTING 阶段需要代码/Diff/产物/AI 行为；DONE 阶段需要回顾归档）
3. **没把"AI 思考过程"作为一等公民** — 调研明确指出"AI reasoning artifacts"应该是独立时间线，而非塞在评论里

### 4.2 对 AI-DevSpace 详情页最重要的 5 条洞察

**洞察 1：详情页应暴露"AI 思考过程"作为一等公民，而非简单评论流**

传统详情页的活动流是"人说的话"。AI-DevSpace 的 ANALYZING / CLARIFYING / DESIGNING / PLANNING 阶段会产生大量机器中间产物：**意图拆解、候选方案、决策依据、工具调用轨迹**。这些不是评论（comments），也不是状态变更（history），而是 **"思考证据（Reasoning Artifacts）"**。

**设计含义**：详情页应区分三类时间线：
- **状态变更**（粗粒度，时间 + 状态名）
- **人类讨论**（评论 / @ / 决策）
- **AI 推理产物**（LLM 输入/输出、Prompt 链、Diff、Tool Call 日志）—— 可折叠 / 可重放

参考 Vibecoding 的"接受/拒绝 diff"模型：每个 SUBMITTING 节点下应能展开看到完整 diff 与 LLM reasoning。

**洞察 2：「代码 / 仓库 / 产物」关联是开发者向 PM 工具的核心差异化**

GitHub / Linear / Shortcut / ZenHub 都在 metadata 栏做"Development"区块。AI-DevSpace 必须强化这一点，并把**关联产物（artifact）/ 可执行入口**做到 GitHub / Linear / Jira 都做不到的事——把 AI 跑出来的代码 / 部署 / 测试结果直接渲染在父需求详情页上。

**洞察 3：AI 不抢占视觉，但可以"动手"是主流产品共识**

Rovo 用"At a glance view"折叠面板、GitHub Copilot 用 /ai 内联触发、Linear 用 ⌘K 模式、AI IDE 用 inline diff + checkpoint。AI 给的是建议（suggest），用户必须显式 accept 才执行动作。

**洞察 4：子任务 / 关联项是详情页使用率最高的次级元素（Top 7）**

15/18 产品把 sub-task 作为详情页核心交互。详情页"描述"之外最大视觉权重应该给"子任务 / 关联制品"，而不是评论或活动流。这与 AI-DevSpace 的"AI 协作产出可执行产物"理念契合——agent 执行任务后产生的代码、文档、部署链接都应该作为 sub-artifact 嵌在父需求下。

**洞察 5：「验收标准」必须是结构化、可执行、可断言的字段**

跨方法论对比看，AC 是唯一**几乎所有流派都强制要求**的环节。AC 不能是富文本（无法机器消费），应是 **结构化字段**（`Given` / `When` / `Then` / `Metrics` / `Pass criteria`）。AC 应能在 SUBMITTING 状态被**自动校验**（LLM-as-judge / 自动测试）。不通过的 AC 应能**回退到 CLARIFYING**，而不是直接卡死——这与传统"Done 不可逆"的 Jira 哲学相反。

---

## 第 5 部分 · 详情页应承载的 6 大典型场景

基于全生命周期 8 环节 + AI-DevSpace 9 态，详情页需要同时支持这 6 个典型场景：

| 场景 | 触发状态 | 用户来详情页要做什么 | 核心信息 |
|---|---|---|---|
| **① 创建 / 编辑需求** | DRAFT | 写 PRD / 贴描述 / 关联初始仓库 | 富文本描述、仓库选择、AC 结构化输入 |
| **② 看 AI 怎么分析** | ANALYZING | 旁观 AI 解析意图、识别风险；可打断 | AI 思考产物（识别出的子问题、相关代码片段、知识引用） |
| **③ 回答 AI 提问** | CLARIFYING | 一问一答快速消除歧义 | 待答问题列表 + 历史澄清记录 |
| **④ 评审 AI 设计** | DESIGNING | 接受 / 拒绝 / 调整 AI 生成的方案 | 设计文档 + 多个候选方案对比 + Diff |
| **⑤ 监督 AI 实施** | IMPLEMENTING / PLANNING | 看任务图、看进度、看 Diff、看 AI 在做什么 | 任务 DAG + 实时 AI 行为 + Diff 流 + checkpoint |
| **⑥ 归档 / 复盘** | DONE / SUBMITTING / ARCHIVED | 看产物清单、看 PR、看变更、归档 | 产物清单、关联 PR/commit、回顾报告 |

**核心问题**：这 6 个场景在同一个详情页里要并存，且**不同阶段主区应该长得不一样**（不是单纯切 Tab，而是主区内容/布局自适应）。

---

## 第 6 部分 · 候选方案

### 6.1 方案 ① · 阶段自适应（Stage-Adaptive）

**核心思想**：详情页主区有 6 个"形态模板"，对应 6 个场景，由当前 status 自动切换。资源树 / Inline 提示栏 / StatusBar 保持不变。

**主区 = 当前形态模板（由 status 决定）**

| 形态 | 状态 | 主区长相 |
|---|---|---|
| **Form 形态** | DRAFT | 居中表单：标题输入 / PRD 富文本 / 关联仓库多选 / AC 结构化输入 / [创建并启动 AI 分析] |
| **Thinking 形态** | ANALYZING | 大屏卡片：AI 正在识别"子问题 N 个 / 风险点 N 个 / 候选方案 N 个" + 实时打字机流 + [⏸ 暂停] [↶ 重置] |
| **Q&A 形态** | CLARIFYING | 问题列表（折叠展开）+ 当前提问焦点 + 候选答案 + 历史澄清记录（可点击回到那一步） |
| **Compare 形态** | DESIGNING | 设计文档 markdown + 候选方案 A/B/C 横向对比 + 每个候选的"取舍点" + [✓ 选 A] [↻ 让 AI 重做] |
| **Mission Control 形态** | IMPLEMENTING / PLANNING | 任务 DAG（依赖图）+ 进行中任务卡 + AI 行为流（实时）+ checkpoint 时间轴 + Diff 流 |
| **Archive 形态** | DONE / SUBMITTING / ARCHIVED | 产物清单（卡片网格）+ 关联 PR/Commit + 变更统计 + 回顾报告 + [📦 归档] |

**线框图（DRAFT 形态）**：

```
┌─────────────────────────────────────────────────────────────┐
│ 退款功能优化 · 草稿                                          │ StatusBar
├──────┬───────────────────────────────────────────┬──────────┤
│ 资源 │           📝 新建需求                        │ Inline   │
│ 树   │  ──────────────────────────────────────  │ 提示栏   │
│      │  标题: [退款功能优化_________________]    │          │
│      │                                            │          │
│      │  PRD (Markdown):                          │          │
│      │  ┌────────────────────────────────────┐  │          │
│      │  │ # 退款功能优化                       │  │          │
│      │  │ ## 背景                             │  │          │
│      │  │ 用户发起退款申请后 ...               │  │          │
│      │  │ ## 验收标准                          │  │          │
│      │  │ - [ ] 退款成功率 ≥ 99%              │  │          │
│      │  │ - [ ] 平均退款时长 ≤ 30s             │  │          │
│      │  └────────────────────────────────────┘  │          │
│      │                                            │          │
│      │  关联仓库: [✓] refund-service [✓] order  │          │
│      │                                            │          │
│      │  [取消]              [保存草稿] [▶ 创建]  │          │
└──────┴───────────────────────────────────────────┴──────────┘
```

**线框图（IMPLEMENTING 形态）**：

```
┌─────────────────────────────────────────────────────────────┐
│ 退款功能优化 · 实施中 · 60%                                  │ StatusBar
├──────┬───────────────────────────────────────────┬──────────┤
│ 资源 │  任务 DAG          │  AI 行为流           │ Inline   │
│ 树   │  ┌────────────┐    │  14:23 Edit file     │ 提示栏   │
│      │  │ #1 schema  │────│  14:23 Bash test     │          │
│      │  └────────────┘    │  14:23 Write diff    │          │
│      │       │            │  ──────────────      │          │
│      │  ┌────────────┐    │  14:24 ⏸ 暂停 - 等   │          │
│      │  │ #7 接口    │◀───│  待回答 Q3 错误码    │          │
│      │  └────────────┘    │  [⌘K 回答]            │          │
│      │       │            │                      │          │
│      │  ┌────────────┐    │                      │          │
│      │  │ #8 测试    │    │                      │          │
│      │  └────────────┘    │                      │          │
│      │                    │                      │          │
│      │  Checkpoints:      │  Diff 流:            │          │
│      │  ⏱ 14:20 +3 -1    │  + RefundController  │          │
│      │  ⏱ 14:23 +8 -2    │  + 2 tests           │          │
│      │  ⏱ 14:24 paused   │  - 1 old test        │          │
└──────┴───────────────────────────────────────────┴──────────┘
```

**优势**：
- 每个阶段主区形态最贴合该阶段任务
- AI thinking 一等公民
- 阶段切换自然流畅
- 与 AI-DevSpace 9 态 1:1 映射
- 让用户感知"AI 在哪个阶段"，与"操作台"的瞬时定位需求契合

**代价**：
- 实现复杂度高（6 套形态模板）
- 阶段切换时主区"突变"，可能造成方向感丢失

### 6.2 方案 ② · 对象中心（Object Hub）

**核心思想**：详情页是"需求对象"的浏览器。所有东西（描述 / 子任务 / 产物 / 对话 / 仓库 / AI 行为）都是这个对象的子节点。主区始终是**结构化的子节点视图**，可下钻。阶段信息被弱化为"AI 行为流"的时间戳。

**6 个子节点视图**（不是 6 个形态模板，是 6 种"对象内容"）：
- 描述：富文本 PRD / AC / 风险点
- 子任务 DAG：依赖图（横轴=时间，纵轴=任务）—— 类似 Replit Task Board
- 产物：卡片网格（SQL / API / 配置 / 文档）
- AI 行为：时间线（tool call + diff + reasoning），可按阶段筛选
- 仓库：关联仓库 + 提交 + PR
- 历史：状态变更 + 评论 + 决策

**线框图**：

```
┌─────────────────────────────────────────────────────────────┐
│ 退款功能优化 [●实施中] [60%]            [↶ 回滚] [⌘K 命令]  │ StatusBar
├──────┬───────────────────────────────────────────┬──────────┤
│ 资源 │  需求对象浏览器                            │ Inline   │
│ 树   │  ──────────────────────────────────────  │ 提示栏   │
│ (对  │  ┌── 元数据 ──────────────────────────┐  │          │
│ 象   │  │ 状态: 实施中  进度: 60%  阶段: ④   │  │          │
│ 子   │  │ 仓库: refund, order                 │  │          │
│ 节   │  │ AC: 4 条 · 通过 3 条 · 阻塞 1 条    │  │          │
│ 点)  │  └─────────────────────────────────────┘  │          │
│      │                                            │          │
│      │  活跃视图: [描述] [子任务 DAG] [产物 4]    │          │
│      │           [AI 行为 12] [仓库 2] [历史 23]  │          │
│      │  ──────────────────────────────────────  │          │
│      │                                            │          │
│      │  [展开当前选中的子节点内容...]             │          │
│      │                                            │          │
│      │                                            │          │
│      │  AI 思考条 (始终在底部):                   │          │
│      │  🟣 AI 正在写 RefundController · 等回答 Q3 │          │
│      │  [⏸ 暂停] [⌘K 提问] [↶ 回滚]              │          │
└──────┴───────────────────────────────────────────┴──────────┘
```

**优势**：
- 阶段无关、对象一致性最强
- 任何时候都看得到同一对象的全貌
- 可下钻、可对比

**代价**：
- DRAFT 阶段和 IMPLEMENTING 阶段"长得一样"，用户需要主动选视图
- AI 行为作为子节点可能埋深

### 6.3 方案 ③ · 事件流中心（Event Stream）

**核心思想**：详情页是**这个需求的全部历史事件的时间线**。一切（状态变更、评论、AI 行为、子任务完成、产物生成、commit、决策）都是事件。主区是事件流，可按类型筛选。资源树极简化（只有仓库/产物索引）。

```
┌─────────────────────────────────────────────────────────────┐
│ 退款功能优化 [●实施中] [60%]                                 │ StatusBar
├──────┬───────────────────────────────────────────┬──────────┤
│ 资源 │  📰 事件流 (默认 All)  [状态] [AI] [人] [产物] [代码] │ Inline │
│ 树   │  ──────────────────────────────────────  │ 提示栏   │
│ (极  │  ┌─────────────────────────────────────┐  │          │
│ 简)  │  │ 14:24 · AI 行为 · IMPLEMENTING       │  │          │
│      │  │  ⏸ 等待 Q3 错误码决策                 │  │          │
│      │  │  [→ 去回答]                          │  │          │
│      │  └─────────────────────────────────────┘  │          │
│      │  ┌─────────────────────────────────────┐  │          │
│      │  │ 14:23 · AI 行为 · IMPLEMENTING       │  │          │
│      │  │  ✏️ Edit RefundController.java         │  │          │
│      │  │  +15 / -3                            │  │          │
│      │  │  [📄 看 Diff] [↶ 回滚]                │  │          │
│      │  └─────────────────────────────────────┘  │          │
│      │  ┌─────────────────────────────────────┐  │          │
│      │  │ 14:20 · 产物 · IMPL                  │  │          │
│      │  │  📦 refund-api.yaml v3 已采纳         │  │          │
│      │  └─────────────────────────────────────┘  │          │
│      │  ┌─────────────────────────────────────┐  │          │
│      │  │ 14:18 · 状态变更 · IMPL              │  │          │
│      │  │  DESIGNING → IMPLEMENTING            │  │          │
│      │  │  ── 7 个子任务已拆解                  │  │          │
│      │  └─────────────────────────────────────┘  │          │
│      │  ┌─────────────────────────────────────┐  │          │
│      │  │ 14:00 · AI 行为 · DESIGNING          │  │          │
│      │  │  生成候选方案 A/B/C · 采纳 A         │  │          │
│      │  └─────────────────────────────────────┘  │          │
│      │                                            │          │
│      │  AI 思考条 (始终在底部):                  │          │
│      │  🟣 AI 暂停中 · 等 Q3 错误码决策           │          │
│      │  [▶ 继续] [⌘K 提问] [↶ 回滚]              │          │
└──────┴───────────────────────────────────────────┴──────────┘
```

**优势**：
- 所有阶段长得一样，认知负担最低
- 事件 = 完整审计日志
- 可直接对标 Linear / Height 的活动流 + Replit 的 work log

**代价**：
- DRAFT 阶段空荡（没什么事件）
- 需要主动滚动到最新
- 缺失"概览感"（一眼看不全貌）

---

## 第 7 部分 · 三方案对比

| 维度 | ① 阶段自适应 | ② 对象中心 | ③ 事件流 |
|---|---|---|---|
| **承载全生命周期** | ★★★★★（每阶段最佳形态） | ★★★（始终同形态，靠视图切换） | ★★★★（事件覆盖所有阶段） |
| **像操作台** | ★★★★★ | ★★★ | ★★★ |
| **AI thinking 一等公民** | ★★★★★（专属"Thinking 形态"） | ★★★★（独立子节点 + 底部条） | ★★★★★（事件流主体） |
| **概览感 / 进度感** | 中（看 status 切形态） | ★★★★★（元数据卡 + 视图切换） | 弱（事件列表） |
| **实现复杂度** | 高（6 套模板） | 中（1 套 + 6 视图） | 低（1 套事件卡） |
| **阶段切换体验** | ★★★★（主区"换装"） | ★★★★★（无变化） | ★★★★★（无变化） |
| **与 AI-DevSpace 9 态契合** | ★★★★★（1:1 映射） | ★★（弱化状态） | ★★★★（状态作为事件） |
| **行业先例** | Replit Project Editor | Notion / Asana | GitHub Activity / Linear Timeline |

---

## 第 8 部分 · 推荐

**推荐方案 ① 阶段自适应**，理由：

1. **9 态不是装饰，是工程化创新**（调研结论）—— 应该让 UI 显式承载这个创新，让用户感知"AI 在哪个阶段"
2. **6 大场景的需求** 差异太大（Form vs Mission Control vs Archive），用同形态硬塞是偷懒
3. **阶段切换 = "换装"** 不是 bug 而是 feature —— 它给用户**强烈的阶段感**，符合"操作台"的瞬时定位需求
4. **借鉴 Replit Project Editor** 的形态切换范式，但保留 AI-DevSpace 的 9 态语义
5. **契合用户 4 目标**：
   - ①日常开发流程 → 6 形态恰好覆盖 8 环节
   - ②阶段感知 → 1:1 映射 9 态，**最强方案**
   - ③AI 融入 → Thinking / Mission Control 形态把 AI 行为提升为一等公民
   - ④操作台感 → 形态切换 + 强动作按钮 = 操作台范式

**风险点与缓解**：
- 实现复杂度高（6 套形态）—— **缓解**：5 个形态可复用 Linear / Shortcut 已有模式；Mission Control 可复用 AI IDE 的 inline diff 流
- 阶段切换"突变" —— **缓解**：每个形态保留相同的顶部 breadcrumb + 资源树 + Inline 提示栏 + 底部 AI 思考条，给用户空间锚点

---

## 第 9 部分 · 待决策点（需用户确认）

| # | 决策点 | 选项 |
|---|---|---|
| D1 | 是否采纳方案 ① 阶段自适应？ | (a) 采纳 / (b) 改用 ② 或 ③ / (c) 杂交 |
| D2 | 是否需要先看 HTML 原型？ | (a) 直接进入 Plan / (b) 先做 DRAFT + IMPLEMENTING 两个 HTML 原型 / (c) 做全部 6 形态 |
| D3 | AC 字段是否升级为结构化 Given-When-Then？ | (a) 是 / (b) 否（保持富文本） |
| D4 | 任务 DAG 是必需元素还是可选？ | (a) 必需 / (b) 仅在 IMPLEMENTING 显示 / (c) 简化为列表 |
| D5 | "关联产物 / 可执行入口"是否要做为差异化锚点？ | (a) 是（独立右栏模块） / (b) 嵌入产物视图 / (c) 暂不做 |
| D6 | AI reasoning 是否作为独立时间线（vs 嵌入评论）？ | (a) 独立时间线 / (b) 嵌入评论 / (c) 都不做 |

---

## 第 10 部分 · 术语表

| 术语 | 含义 |
|---|---|
| **需求 Requirement** | AI-DevSpace 工作单位，物理目录 `~/.aidevspace/requirements/req-<id>/` |
| **详情页** | `/requirements/:id` 路由，承载需求整个生命周期 |
| **9 态** | DRAFT / ANALYZING / CLARIFYING / DESIGNING / PLANNING / IMPLEMENTING / SUBMITTING / DONE / ARCHIVED |
| **AC 验收标准** | Acceptance Criteria，结构化字段 |
| **产物 Artifact** | AI 产出的可保存中间结果（SQL / OpenAPI / 配置 / 文档） |
| **DAG** | 有向无环图，PLANNING 阶段产出的任务依赖图 |
| **Checkpoint** | AI 写入前的快照，支持回滚 |
| **形态模板** | 方案 ① 中对应不同 status 的主区布局 |
| **Inline 提示栏** | 右栏 120px 收纳 AI 主动推送的浮窗 |
| **AI 思考条** | 详情页底部固定条，显示 AI 当前状态（与 Inline 提示栏区分） |

---

## 第 11 部分 · 完整事实引用列表（按主题汇总）

### 方法论（A）
- A1: <https://www.atlassian.com/agile/agile-at-scale/spotify>
- A2: <https://www.infoq.com/news/2013/04/scaling-agile-spotify-kniberg/>
- A3: <https://www.scaledagileframework.com/pi-planning/>
- A4: <https://www.atlassian.com/agile/scrum>
- A5: <https://basecamp.com/shapeup>
- A6: David J. Anderson, *Kanban* (2010)
- A7: Jeff Patton, *User Story Mapping* (O'Reilly)
- A8: <https://dannorth.net/2006/09/introducing-bdd/>
- A9: <https://www.iiba.org/standards-and-resources/babok/>
- A10: <https://www.ireb.org/>
- A11: IEEE 830-1998 → IEEE 29148-2018
- A12: <https://www.axelos.com/certifications/itil-service-management/itil-4-foundation>
- A13: <https://x.com/karpathy/status/1886192184808149383>
- A14: <https://github.com/github/spec-kit>
- A15: <https://www.ibm.com/think/topics/vibe-coding>
- A16: <https://linear.app/docs/cycles>

### 项目管理产品（B）
- B1: <https://linear.app/docs/issue-views>
- B2: <https://linear.app/ai>
- B3: <https://help.shortcut.com/hc/en-us/articles/360000046826-Stories>
- B4: <https://github.com/makeplane/plane>
- B5: <https://confluence.atlassian.com/jiracorecloud/the-new-jira-issue-view-938040503.html>
- B6: <https://www.atlassian.com/software/rovo>
- B7: <https://learn.microsoft.com/en-us/azure/devops/organizations/settings/work/customize-process-form?view=azure-devops>
- B8: <https://help.trello.com/article/818-cards>
- B9: <https://help.clickup.com/>
- B10: <https://www.notion.so/product/ai>
- B11: <https://www.notion.com/help/editing-properties>
- B12: <https://docs.github.com/en/issues>
- B13: <https://github.blog/changelog/2024-05-21-github-copilot-for-issues-is-now-generally-available/>
- B14: <https://github.blog/news-insights/product-news/github-copilot-for-issues-4-steps-to-get-you-started/>
- B15: <https://design.gitlab.com/components/issue>
- B16: <https://www.feishu.cn/content/60ws558p>
- B17: <https://www.feishu.cn/practice_template/16382>
- B18: <https://blog.csdn.net/meisongqing/article/details/146361028>
- B19: <https://new.qq.com/rain/a/20250920A03SPS00>

### AI IDE / 工作台（C）
- C1: <https://aider.chat/docs/usage/conventions.html>
- C2: <https://github.com/Aider-AI/aider>
- C3: <https://github.com/anthropics/claude-code>
- C4: <https://docs.claude.com/en/docs/claude-code/slash-commands>
- C5: <https://docs.claude.com/en/docs/claude-code/iam>
- C6: <https://zed.dev/docs/ai/inline-edit>
- C7: <https://zed.dev/docs/ai/assistant-panel>
- C8: <https://zed.dev/blog/inline-edit>
- C9: <https://www.phind.com/>
- C10: <https://www.phind.com/agents>
- C11: <https://cline.bot/>
- C12: <https://docs.cline.bot/>
- C13: <https://github.com/cline/cline>
- C14: <https://docs.cursor.com/>
- C15: <https://docs.continue.dev/>
- C16: <https://sourcegraph.com/docs/cody>
- C17: <https://docs.codeium.com/windsurf/getting-started>
- C18: <https://docs.devin.ai/work-with-devin/devin-session-tools>
- C19: <https://docs.devin.ai/product-guides/using-playbooks>
- C20: <https://docs.devin.ai/work-with-devin/deepwiki>
- C21: <https://docs.factory.ai/web/getting-started/overview>
- C22: <https://docs.factory.ai/web/missions>
- C23: <https://docs.factory.ai/integrations/slack>
- C24: <https://docs.replit.com/learn/projects-and-artifacts/project-editor>
- C25: <https://docs.replit.com/references/agent/task-board>
- C26: <https://docs.replit.com/references/version-control/checkpoints-and-rollbacks>
- C27: <https://bolt.new/>
- C28: <https://lovable.dev/>
- C29: <https://v0.app/>
- C30: <https://manus.im/>
- C31: <https://github.com/smol-ai/developer>
- C32: <https://github.com/github/spec-kit>

### AI-DevSpace 内部引用（D）
- D1: [CONTEXT.md](../../CONTEXT.md)
- D2: [.scratch/ai-devspace-mvp/PRD.md](../../../.scratch/ai-devspace-mvp/PRD.md) §6
- D3: [.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md](../../../.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md) §4
- D4: [ADR-0006 HTML 原型作为单一事实源](../adr/0006-html-prototype-as-source-of-truth.md)
- D5: [ADR-0007 路由组 shell](../adr/0007-workspace-route-group-shell.md)
- D6: [ADR-0005 6 阶品牌色](../adr/0005-brand-palette-six-step.md)
- D7: [docs/design/pages/03-requirement-workspace.html](../../design/pages/03-requirement-workspace.html)（旧版 HTML）
- D8: [docs/design/pages/00-req-detail-compare.html](../../design/pages/00-req-detail-compare.html)（本次对比页）

---

## 第 12 部分 · 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-12 | 初稿：调研 + 3 候选方案 + 推荐 | Brainstorming 会话 |

---

**待办**：spec self-review → 用户审阅 → writing-plans