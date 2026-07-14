# ADR-0011: 需求工作台工位自适应(6 工位 + 1 概览页)

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** 项目负责人
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 15, 22, 23, 24, 36, 49
**关联 ADR:**
- [ADR-0006](0006-html-prototype-as-source-of-truth.md) — HTML 原型作为视觉单一事实源
- [ADR-0012](0012-requirement-workbench-shell-topology.md) — 需求工作台 shell 拓扑(本 ADR 路由模型由其定义)
- [ADR-0009](0009-ai-failure-defense.md) — AI 翻车防线(影响 EXECUTING 工位的 snapshot UI)

## Context

需求详情页(`/requirements/:id`)是 AI-DevSpace 工作台的核心页。v1.0 PRD §6.2 定义了"三栏布局"骨架并落地为 [docs/design/pages/03-requirement-workspace.html](../design/pages/03-requirement-workspace.html)。

2026-07-12 启动重新设计,先做**调研**(30+ 产品 / 12 个方法论 / 12 个 AI 原生工具),再基于调研结论产出 3 个候选方案,采纳"阶段自适应"方案(原 v1)。

### 原 v1 决策(2026-07-12 上午)

原决策把详情页定义为"6 形态模板按 status 自动切换":

| 形态 | 触发 status |
|---|---|
| Form 形态 | DRAFT |
| Thinking 形态 | ANALYZING |
| Q&A 形态 | CLARIFYING |
| Compare 形态 | DESIGNING |
| Mission Control 形态 | PLANNING / IMPLEMENTING |
| Archive 形态 | SUBMITTING / DONE / ARCHIVED |

切换完全由 status 驱动,4 个空间锚点(StatusBar / Sidebar / 资源树 / Inline 栏)不变。

### 原 v1 的根本问题

2026-07-12 下午通过 **11 轮 grilling 会话**彻底推翻原 v1,识别 3 个根本问题:

1. **状态机驱动违反 CONTEXT.md 决策 15** —— "不写状态机,Skill 不构成阶段,用户意图驱动" 是 v1.0 已锁定决策。原 v1 让 status 强驱动 UI 切换 = 把刚被否决的状态机偷偷复活
2. **"换装是 feature" 与工位语义不符** —— 工位类比(汽车维修车间)表明工位 = 独立房间各自固定装备,不是"同一房间换家具"。"4 锚点不变"假设与工位类比矛盾
3. **资源树 / Inline 栏的"通用性"假设不成立** —— Mission Control 的资源树(任务 DAG + Diff)与 DRAFTING 的资源树(PRD 章节 + AC)是**完全不同的内容**,无法共享

### 新决策(2026-07-12 下午,11 轮 grilling 沉淀)

把"详情页"提升为**需求工作台** —— 7 个产品形态:

| 形态 | 性质 | 数量 |
|---|---|---|
| **Overview 概览页** | 仪表板(用户"看") | 1 个 |
| **工位**(zone) | 工作台(用户"做") | 6 个 |

工位是**独立路由 = 独立工作台**,不是"同一 URL 内主区换装"。

---

## Decision

### 1. 6 工位 + 1 概览 = 7 产品形态

```
需求工作台 = Overview 概览页 + 6 工位
```

| # | 形态 | 性质 | 主区长相 |
|---|---|---|---|
| 0 | **Overview 概览页** | 仪表板(非工位) | 元数据 + 完成进度 + 工位地图 + 里程碑 + AI 活动 |
| 1 | **DRAFTING 工位** | 写需求 PRD | 居中表单:标题 / PRD Markdown / 关联仓库 / AC |
| 2 | **ANALYZING 工位** | 旁观 AI 解析 | 大屏卡片:AI 思考流 + 实时打字机 + 暂停重置 |
| 3 | **CLARIFYING 工位** | 回答 AI 提问 | 当前提问 + 候选答案按钮 + 历史 |
| 4 | **DESIGNING 工位** | 评审候选方案 | 设计文档 + 候选方案 A/B/C 对比 |
| 5 | **EXECUTING 工位** | 监督 AI 实施 | 三列:DAG + Diff + AI 行为流 |
| 6 | **WRAP-UP 工位** | 归档复盘 | 产物清单 + PR/Commit + 回顾报告 |

### 2. 工位的 5 个本质属性

| 属性 | 说明 |
|---|---|
| **无方向** | 工位不是流程节点,没有"上一步/下一步" |
| **任意跳转** | 用户可在 7 形态间任意切换(包括反向:WRAP-UP → DRAFTING) |
| **用户主导** | 默认用户主动切;AI 触发仅允许非流程方向(如"AI 提问 = 切 CLARIFYING",对应决策 25) |
| **独立路由** | 每个工位 = 独立 URL(`/requirements/[id]/[zone]/`) = 浏览器历史栈 |
| **环境决定装备** | 工位注册表 `default_arming` 字段决定装填哪些 Skill(环境自带工具) |

### 3. 工位切换机制

- **不是 status 自动驱动**(违反决策 15)
- **是用户主动 + AI 非流程触发**
- **工位切换 = 路由切换**(URL + 浏览器历史 + Cmd+Z)
- **顶部 ZoneBar + Cmd+K 双通道**导航(详见 [ADR-0012](0012-requirement-workbench-shell-topology.md) 第 6 节)

### 4. 工位与 Overview 的本质差异

| 维度 | 工位(6 个) | Overview(1 个) |
|---|---|---|
| 用户动作 | 做(主动操作) | 看(被动接收) |
| 信息流 | 双向(用户 ↔ AI / 系统) | 单向(系统 → 用户) |
| ZoneBar | ✅ 7 Tab 导航器 | ❌ 无 |
| 资源树 | 按 R2 决定(3 有 3 无) | ❌ 无 |
| Inline 栏 | 按 C 决定(2 有 4 无) | ❌ 无 |
| AI 思考条 | 内容由工位注入 | 显示需求级 AI 状态 |

### 5. 6 工位的核心认知任务

| 工位 | 主任务 | 主要动作 | 资源树(R2) | Inline 栏(C) |
|---|---|---|---|---|
| DRAFTING | 写需求 PRD | 主动**创作** | ❌ 主区全宽(issue 01 起改为 Inline 栏 only) | ✅ 保留(候命 Skill + 仓库底部栏) |
| ANALYZING | 旁观 AI 解析 | 被动**观察** | ❌ 主区全宽 | ❌ 无 |
| CLARIFYING | 回答 AI 提问 | 主动**回答** | ❌ 主区全宽 | ❌ 无 |
| DESIGNING | 评审候选方案 | 主动**决策** | ⚠️ 默认无 | ❌ 无 |
| EXECUTING | 监督 AI 实施 | 被动**监督** | ✅ 任务 DAG + Diff + 产物 | ✅ 保留 |
| WRAP-UP | 归档复盘 | 主动**总结** | ✅ 产物 + PR + 决策 | ❌ 无 |

> **R2 更新(issue 01 · drafting 重新设计)** —— DRAFTING 工位从"3 工位有资源树"
> 中退出。原 PRD 章节大纲 / 仓库 / 任务 / 产物 改由主区顶部锚点栏(issue 03)+ 主区
> 卡片 + 右侧 Inline 栏(候命 Skill / 仓库底部栏)承载。本表与 ADR-0012 字段默认值表
> 同步刷新:`DRAFTING has_resource_tree: false` / `has_inline_rail: true`。

### 6. 工位布局(原 6 形态,内容不变,概念改名)

| 工位布局 | 原形态名 | 主区长相 |
|---|---|---|
| DRAFTING 布局 | Form 形态 | 居中表单:标题 / PRD Markdown / 关联仓库 / AC |
| ANALYZING 布局 | Thinking 形态 | 大屏卡片:AI 思考流 + 实时打字机 + [⏸ 暂停] [↶ 重置] |
| CLARIFYING 布局 | Q&A 形态 | 当前提问 + 候选答案按钮 + 历史 |
| DESIGNING 布局 | Compare 形态 | 设计文档 + 候选方案 A/B/C 对比 + 取舍点 |
| EXECUTING 布局 | Mission Control 形态 | 三列布局:任务 DAG + Diff 流 + AI 行为流 |
| WRAP-UP 布局 | Archive 形态 | 产物清单 + 关联 PR/Commit + 变更统计 + 回顾报告 |

### 7. 8 个 HTML 原型(已落盘 / 落地中)

| 文件 | 形态 | 状态 |
|---|---|---|
| [12-requirement-overview.html](../design/pages/12-requirement-overview.html) | Overview 概览页 | ✅ 落盘 |
| [11a-stage-adaptive-draft.html](../design/pages/11a-stage-adaptive-draft.html) | DRAFTING 布局 | ✅ 落盘 |
| [11b-stage-adaptive-clarifying.html](../design/pages/11b-stage-adaptive-clarifying.html) | CLARIFYING 布局 | ✅ 落盘 |
| [11c-stage-adaptive-designing.html](../design/pages/11c-stage-adaptive-designing.html) | DESIGNING 布局 | ✅ 落盘 |
| [11d-stage-adaptive-implementing.html](../design/pages/11d-stage-adaptive-implementing.html) | EXECUTING 布局 | ✅ 落盘 |
| [11e-stage-adaptive-analyzing.html](../design/pages/11e-stage-adaptive-analyzing.html) | ANALYZING 布局 | ✅ 落盘 |
| [11f-stage-adaptive-archive.html](../design/pages/11f-stage-adaptive-archive.html) | WRAP-UP 布局 | ✅ 落盘 |
| [11g-zone-tab-navigator.html](../design/pages/11g-zone-tab-navigator.html) | ZoneBar 7 Tab 导航器 | ✅ 落盘 |

### 8. 4 个关键决策回顾(11 轮 grilling 沉淀)

| 决策 | 结论 | 理由 |
|---|---|---|
| **R2 资源树按工位** | 3 工位有(DRAFTING/EXECUTING/WRAP-UP),3 工位无 | 工位 = 独立工作台,资源树是环境属性 |
| **选项 C Inline 栏下放** | 仅 DRAFTING / EXECUTING 保留 | 决策 23 取消右栏常驻;Inline 栏只在需要时占位 |
| **A3 AI 思考条全局** | 位置 shell 层 1,内容由工位注入,新增 `thinking_bar` 字段 | 决策 24"克制在场"要求 AI 状态始终可见 |
| **方案 E 顶部 Tab + Cmd+K** | 7 Tab 排序:Overview → DRAFTING → ... → WRAP-UP | 决策 16 状态可视化 + 决策 26 Cmd+K 命令面板 |

---

## Consequences

### 正面

- **7 产品形态清晰分离** —— 各司其职,无"用一个形态硬塞"
- **工位独立路由** —— 符合"工位 = 独立工作台"语义
- **AI thinking 一等公民** —— 各工位都有专属位(ANALYZING 思考流 / EXECUTING AI 行为流)
- **Overview 提供需求全貌** —— 元数据 + 进度 + 工位入口 + 里程碑 + AI 活动
- **工位集合可扩展** —— 声明式注册表,以后加第 7、第 8 工位只是注册 yaml
- **保留"阶段感"但消除"状态机"** —— 工位切换有视觉变化(路由跳转),但不是系统自动推动

### 负面 / 代价

- **6 套工位组件 + 1 套 Overview** —— 工作量是原 6 形态的 ~1.17 倍(几乎没多,因为 Overview 是新增)
- **ZoneBar 时有时无** —— Overview 时无,工位时有,UI 跳变(可接受,GitHub PR 先例验证)
- **工位注册表必须 v1.0 上线前完成** —— 是基础设施,延迟会导致后续返工
- **`/requirements/[id]/` 重定向有 SSR 开销** —— 需要读 cookie + 检查 zone 存在
- **`default_arming` 双源叠加** —— 工位默认 + Skill `triggers:`,系统需去重

### 风险缓解

| 风险 | 缓解措施 |
|---|---|
| 工位组件工作量翻倍 | 先实现 EXECUTING 一个完整工位作样板,验证后批量复制其他 5 个 + Overview |
| ZoneBar UI 跳变 | 100-200ms 淡入淡出过渡(Next.js `useTransition`) |
| 重定向 SSR 性能 | cookie 读取 + zone 存在检查缓存,实测 < 10ms |
| 工位注册表早期变更 | v1.0 锁定 13 字段集,变更需新 ADR |
| AI 触发工位切换违反决策 15 | entry_triggers 仅允许非流程方向(如 AI 提问 = 切 CLARIFYING),禁止流程方向 |

### 拒绝方案的理由

**被拒 1:旧探索 HTML(03a/03b/03c-req-detail-*.html)**

用户已明确指出这 3 个方案"把详情页窄化为任务执行页",忽略全生命周期。仍保留作探索存档,不作为实施对照。

**被拒 2:方案 ② 对象中心(12-object-hub.html)**

- 阶段无关、对象一致性最强——但 DRAFTING 工位和 EXECUTING 工位"长得一样"会丢失关键差异
- AI 行为作为子节点可能埋深
- 与 AI-DevSpace 工位集合契合度低(工位是核心概念,被对象中心稀释)

**被拒 3:方案 ③ 事件流(13-event-stream.html)**

- 所有阶段长得一样,认知负担最低——但 DRAFTING 阶段事件流空荡,缺引导
- 缺失"概览感"(一眼看不全貌)
- 实现简单但牺牲了"阶段感知"

**被拒 4:原 ADR-0011 v1(6 形态按 status 自动切换)**

- 状态机驱动违反决策 15
- "换装是 feature" 与工位类比不符
- 资源树 / Inline 栏"通用性"假设不成立
- 11 轮 grilling 推翻,本文为重写版

---

## Alternatives Considered

### A. 旧探索 HTML(任务驱动 / 文件驱动 / 时间轴)

详见 `docs/design/pages/00-req-detail-compare.html`。已被用户明确指出"以内容为中心"的局限,**保留作存档**。

### B. 方案 ② 对象中心(Object Hub)

主区 = 元数据卡 + 6 个子节点视图 tabs(描述 / 子任务 DAG / 产物 / AI 行为 / 仓库 / 历史)+ 底部固定 AI 思考条。所有阶段长得一样。

**采用障碍**:与工位集合契合度低,DRAFTING 阶段缺乏引导。

### C. 方案 ③ 事件流中心(Event Stream)

主区 = 全部历史事件时间线 + 类型筛选器。资源树极简化。

**采用障碍**:DRAFTING 阶段空荡,缺引导;缺失"概览感";阶段感知弱。

### D. 方案 ① 阶段自适应(原 ADR-0011 v1,被本 ADR 替换)

6 形态按 status 自动切换。StatusBar / 资源树 / Inline 栏 / AI 思考条 4 个空间锚点不变。

**采用障碍**:状态机驱动违反决策 15;"换装"与工位类比不符;资源树 / Inline 栏通用性假设不成立。

### E. (已选) 工位独立路由 + Overview 概览页

6 工位 + 1 Overview = 7 产品形态,工位 = 独立路由 = 独立工作台,Overview 是仪表板。

**采用理由**:工位集合 = 用户当前工作环境(无方向),与决策 15 用户意图驱动契合;7 形态覆盖 7 场景;AI thinking 一等公民;Overview 提供全貌视角。

---

## 相关文档

### 设计文档

- `docs/superpowers/specs/2026-07-12-requirement-detail-page-redesign.md` — 完整调研 + 3 方案(起源文档)

### 8 个 HTML 原型(视觉对照基线)

| 文件 | 形态 |
|---|---|
| [12-requirement-overview.html](../design/pages/12-requirement-overview.html) | Overview 概览页 |
| [11a-stage-adaptive-draft.html](../design/pages/11a-stage-adaptive-draft.html) | DRAFTING 工位布局 |
| [11b-stage-adaptive-clarifying.html](../design/pages/11b-stage-adaptive-clarifying.html) | CLARIFYING 工位布局 |
| [11c-stage-adaptive-designing.html](../design/pages/11c-stage-adaptive-designing.html) | DESIGNING 工位布局 |
| [11d-stage-adaptive-implementing.html](../design/pages/11d-stage-adaptive-implementing.html) | EXECUTING 工位布局 |
| [11e-stage-adaptive-analyzing.html](../design/pages/11e-stage-adaptive-analyzing.html) | ANALYZING 工位布局 |
| [11f-stage-adaptive-archive.html](../design/pages/11f-stage-adaptive-archive.html) | WRAP-UP 工位布局 |
| [11g-zone-tab-navigator.html](../design/pages/11g-zone-tab-navigator.html) | ZoneBar 7 Tab 导航器 |

### 旧 HTML 原型(探索存档)

- [03-requirement-workspace.html](../design/pages/03-requirement-workspace.html) — 首版三栏布局
- [03a-req-detail-task-driven.html](../design/pages/03a-req-detail-task-driven.html) — 旧方案 A
- [03b-req-detail-file-driven.html](../design/pages/03b-req-detail-file-driven.html) — 旧方案 B
- [03c-req-detail-timeline-driven.html](../design/pages/03c-req-detail-timeline-driven.html) — 旧方案 C

### 其他方案原型(被拒方案的 HTML 对照)

- [12-object-hub.html](../design/pages/12-object-hub.html) — 方案 ② 对象中心
- [13-event-stream.html](../design/pages/13-event-stream.html) — 方案 ③ 事件流

### 关联 ADR

- [ADR-0006](0006-html-prototype-as-source-of-truth.md) — HTML 原型作为单一事实源
- [ADR-0012](0012-requirement-workbench-shell-topology.md) — 需求工作台 shell 拓扑(本 ADR 路由模型)
- [ADR-0009](0009-ai-failure-defense.md) — AI 翻车防线(影响 EXECUTING 工位 snapshot UI)

### 被本 ADR 替换

- ADR-0011 v1(原文件名 `0011-requirement-detail-page-stage-adaptive.md`,已 rename 到 `0011-requirement-workbench-zone-adaptive.md`)—— git history 保留作 v1 探索存档

---

## 待实施 Issue(占位)

将拆分为:
- `xx-zone-registration-yaml.md` — 工位注册表 13 字段 schema 落地
- `xx-zone-router-shell.md` — `[id]/[zone]/` 路由层级 + 工位专属 shell
- `xx-zone-bar-component.md` — ZoneBar 7 Tab 组件 + Cmd+K 双通道
- `xx-overview-page.md` — Overview 概览页落地(5 项内容)
- `xx-think-bar-global.md` — AI 思考条全局化(位置 + 工位内容注入)
- `xx-zone-drafting.md` — DRAFTING 工位组件
- `xx-zone-analyzing.md` — ANALYZING 工位组件
- `xx-zone-clarifying.md` — CLARIFYING 工位组件
- `xx-zone-designing.md` — DESIGNING 工位组件
- `xx-zone-executing.md` — EXECUTING 工位组件(优先级最高,作样板)
- `xx-zone-wrapup.md` — WRAP-UP 工位组件

---

## 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-12 | 初稿：基于调研 + 3 方案对比 + 4 个 HTML 原型落地,决定采用方案 ① 阶段自适应(6 形态按 status 自动切换) | Brainstorming 会话 |
| 2026-07-12 | 补完 11e ANALYZING + 11f Archive 两个 HTML 原型,6 形态原型齐备 | 本次迭代 |
| 2026-07-12 | **11 轮 grilling 会话全文重写**:6 形态 → 6 工位 + 1 Overview;status 驱动 → 工位独立路由(用户主动 + AI 非流程触发);4 锚点不变 → 各工位独立设计环境;新增 ADR-0012 关联;旧 ADR-0007 由 ADR-0012 标 SUPERSEDED;文件 rename + 全文替换 | 本次重写 |
| 2026-07-12 | 新增 12-overview 原型 + 11g 升级 7 Tab,8 个 HTML 原型齐备 | 本次重写 |