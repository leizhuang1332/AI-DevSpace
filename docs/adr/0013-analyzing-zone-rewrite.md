# ADR-0013: ANALYZING 工位重设计(从"观察屏"到"PRD 准入 + 技术概要协作工作台")

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** 项目负责人
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 15, 25, 28, 38, 43, 44, 49
**关联 ADR:**
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — 需求工作台工位自适应(本 ADR 覆盖其 §6 ANALYZING 布局)
- [ADR-0012](0012-requirement-workbench-shell-topology.md) — 需求工作台 shell 拓扑(本 ADR 保留 shell 拓扑)
- [ADR-0009](0009-ai-failure-defense.md) — AI 翻车防线(影响 snapshot 与回滚)

**覆盖/改写:**
- **覆盖** [CONTEXT.md](../CONTEXT.md) 决策 25 中"AI 提问触发切 CLARIFYING"的部分(详见 D3)
- **改写** [CONTEXT.md](../CONTEXT.md) 决策 25 的语义:AI 提问从"主动推送"降级为"待裁决项沉淀"(详见 D6)

---

## Context

### 起点

[ADR-0011 §6](../CONTEXT.md) 把 ANALYZING 工位定位为"旁观 AI 解析",主区形态 = "大屏卡片:AI 思考流 + 实时打字机 + [⏸ 暂停] [↶ 重置]",HTML 原型 [11e-stage-adaptive-analyzing.html](../design/pages/11e-stage-adaptive-analyzing.html) 已落盘,落地 issue [.scratch/ai-devspace-mvp/issues/19-zone-analyzing.md](../../.scratch/ai-devspace-mvp/issues/19-zone-analyzing.md) 已 `ready-for-agent`。

### 用户反馈(2026-07-12 下午,启动落地前)

> "现有功能只有观察 ai 分析过程,这么一个简单功能就开一个工作台太浪费了,应该还要承载更多功能"

用户认为 "观察" 单一职能太轻,无法支撑一个独立工位。

### 用户补充的关键故事(决定性输入)

> "DRAFTING 工位用户提供了 PRD,但是从 PRD 的粒度是很粗的,它仅表达了需求最后要达成的目标和状态,所以需要 ANALYZING 工作台来分析 PRD,拆分模块,转化成开发技术概要指导后续工作。从 PRD(业务语言)到技术概要(技术语言)有很大的语义鸿沟,所以 AI 在分析过程中要不停的向用户确认"

> "实现上是在进行 PRD 准入校验,一切没问题才生成技术概要,最后拆解成多个可独立开发的聚合模块"

> "CLARIFYING 是按可独立开发的聚合模块一个一个进行澄清,处理的是更具体的落地细节的(如果定不下来就无法开发或者开发出来会有 bug)"

### 故事提炼的两个关键概念

```
ANALYZING 输入 = PRD(粗粒度 · 业务语言 · DRAFTING 产物)
ANALYZING 职责 = PRD 准入校验 + 拆解为聚合模块
                ├─ 准入校验 4 维度
                │   · 业务合理性(是否合理)
                │   · 技术可实现性(是否能做)
                │   · 系统兼容性(是否与现有系统冲突)
                │   · 企业合规性(资损 / 性能 / 架构约束)
                ├─ 一切 OK 才生成技术概要(技术语言)
                └─ 拆解为多个可独立开发的"聚合模块"
ANALYZING 输出 = 技术概要 + 聚合模块清单

CLARIFYING 输入 = 1 个聚合模块(细粒度 · 技术语言)
CLARIFYING 职责 = 该模块的落地细节澄清
                (定不下来就无法开发 / 开发会有 bug)
```

### 与原 ADR-0011 §6 的核心矛盾

| 维度 | 原 ADR-0011 §6 | 用户故事要求 |
|---|---|---|
| 职能性质 | 旁观(单方观察 AI) | 协作(双向 AI ↔ 用户) |
| AI 提问 | 不涉及 | 持续提问(准入校验) |
| 产物 | 思考流(过程性) | 技术概要 + 聚合模块清单(最终) |
| 工位性质 | 轻量"观察屏" | "PRD 准入 + 技术概要协作"完整工作台 |

---

## Decision

通过 10 轮 grilling 会话,沉淀 D1–D10 决策:

### D1 · ANALYZING 工位新定位

**原文:** ANALYZING 工位核心职责 = **PRD 准入校验 + 拆解聚合模块**。替代原"旁观 AI 解析"。

**说明:**
- 取代原 v1 "Thinking 形态 = 旁观 AI 解析"的定义
- 工位性质从"轻量观察屏"升格为"PRD 准入 + 技术概要协作工作台"
- 仍保留"环境决定装备"(决策 15 + ADR-0011)的工位哲学

### D2 · 4 核心职能(全部入选)

| # | 职能 | 阶段 | 关键 UX |
|---|---|---|---|
| ① | **解析参数配置面板** | 启动前 | 选 Skill / 选知识 / 选仓库分支 / 设优先级 |
| ② | **解析过程观察** | 进行中 | AI 思考流 + 实时打字机 + 上下文插话 |
| ③ | **解析产物交互编辑** | 进行中/完成后 | 识别子问题/风险/方案可编辑(增删改合并) |
| ④ | **多会话并行观察** | 横向 | 顶部 Tab 切换(详见 D7) |

**不入选候选(明确剔除):**
- ❌ "横向合并对比列" — 用户选了简单 Tab,不要 grid 对比视图
- ❌ "抽屉历史模式" — 与 ZoneBar 视觉位置冲突
- ❌ "Snapshot 机制" — 落盘已足够,不需冻结包(详见 D9)

### D3 · AI 提问全部留在 ANALYZING(覆盖决策 25)

**原文:** ANALYZING 工位内的所有 AI 提问 = "PRD 准入校验问询",**不触发切 CLARIFYING**。

**说明:**
- 覆盖 [CONTEXT.md](../CONTEXT.md) 决策 25 中"AI 提问等用户回答 = 触发切 CLARIFYING"的部分
- 理由:ANALYZING 的提问是"准入校验"性质,与 CLARIFYING 的"落地细节澄清"性质不同
- ANALYZING 提问留在工位内沉淀为"待裁决项"(详见 D6)

### D4 · 严重度分级 = 五级(4 准入维度 + 1 上下文确认)

```
PRD 准入仪表板(顶部 5 卡)
├─ 🔴 资损安全 (Business Critical)
├─ 🟠 性能 (Performance)
├─ 🟡 架构冲突 (Architecture Conflict)
├─ 🟢 业务合理性 (Business Reasonable)
└─ 💬 上下文确认 (Context Query)  ← 第 5 类
总体结论: ✅ 准入通过 / ⚠️ 待裁决 / ❌ 准入失败
```

**严重度归属规则(默认映射,可在 Skill frontmatter 覆盖,详见 D10):**

| 准入维度 | 默认归属 | 理由 |
|---|---|---|
| 资损安全 | 🔴 资损 | 业务红线 |
| 架构冲突(无法绕开) | 🟡 架构 | 必须改 PRD |
| 架构冲突(可绕开) | 🟡 架构 | 有 workaround |
| 性能不达标 | 🟠 性能 | 优化空间存在 |
| 业务合理性存疑 | 🟢 业务 | 需用户判断 |
| 上下文 / 细节确认 | 💬 上下文 | 普通问答(独立于 4 准入维度) |

**任一 🔴 → 总体结论 ❌ 失败**(可由用户手动改为"接受风险"继续,详见 D6)

### D5 · 新术语(3 个,需入 CONTEXT.md)

| 术语 | 定义 | 与现有术语关系 |
|---|---|---|
| **聚合模块 (Aggregate Module)** | 可独立开发的技术单元,从技术概要拆解而来 | **新** · 与 CONTEXT.md"Task"不同:聚合模块是"待澄清的工程单元",Task 是"已批准的可执行单元" |
| **PRD 准入校验 (PRD Admissibility Check)** | AI 在技术概要生成前对 PRD 的多维度校验(业务/性能/架构/合规) | **新** · 是 ANALYZING 工位的核心动作 |
| **技术概要 (Technical Brief)** | PRD 的技术语言转译结果,包含架构选型、技术栈、聚合模块清单 | **新** · 与现有 Artifact 概念兼容,但有专门形态(详见 D8) |
| **待裁决项 (Pending Adjudication Item)** | AI 标记需要用户处理的事项(准入问题 / 上下文确认) | **新** · 是决策 25 语义改写后的产物形态 |

### D6 · AI 准入提问 = 待裁决项(改写决策 25)

**原文:** AI 准入提问**不主动推送**,而是**沉淀为"待裁决面板"**,用户主动来 ANALYZING 面板处理(裁决/接受/转交)。

**与原决策 25 的关系:**
- **原决策 25:** "AI 提问等用户回答"是**唯一允许的 AI 主动推送**
- **改写后:** AI 提问降级为"被动沉淀",用户主动来查看;StatusBar "待裁决 N" 计数 + ZoneBar ANALYZING 状态指示共同提醒
- **更彻底符合决策 24 "不打扰,但陪伴"哲学**

**UX 行为:**
- AI 完成识别 → 写入"待裁决面板"(decision log 文件)
- 不弹窗 / 不推 toast / 不切工位
- 用户切到 ANALYZING 时,顶部"准入仪表板"显示待裁决数
- StatusBar "待裁决 N" 数字常驻(可在 DRAFTING/EXECUTING 工位也看到)
- 用户可单条裁决 / 批量裁决 / 接受风险 / 转交 CLARIFYING

### D7 · 多会话形态 = 顶部 Tab 切换(候选 A)

**原文:** 多会话呈现 = **顶部 Tab 切换**(类似浏览器 Tab),每次只显示一个会话主区。

**HTML 原型:** [11h-A-zone-multisession-tabs.html](../design/pages/11h-A-zone-multisession-tabs.html)

**被拒方案:**
- ❌ 候选 B(并排 grid + 横向对比列) — 视觉负担重,窄列难以深度编辑
- ❌ 候选 C(默认 Tab + 可切并排) — 实现复杂度翻倍,价值不显著
- ❌ 候选 D(主会话 + 抽屉历史) — 与 ZoneBar 视觉位置冲突

**UX 细节:**
- 顶部 Tab:架构角度 / 数据角度 / 接口角度 等(用户可新建会话)
- Tab 上的数字徽章:该会话已识别的子问题数
- 准入仪表板 5 维度 **全局共享**(不分子会话)
- 切换 Tab 保留各会话的滚动位置(sessionStorage)

### D8 · 技术概要产物形态 = Markdown 主体 + YAML 附录(双文件)

**原文:** 技术概要拆为 2 个文件,各取所长:

```
requirements/<req-id>/analysis/
  ├─ technical-brief.md      ← 业务背景 + 架构叙述 + 技术栈说明(叙述性)
  └─ modules.yaml            ← 聚合模块清单(结构化,可被 CLARIFYING 消费)
```

**technical-brief.md 示例结构:**

```markdown
# 退款功能优化 · 技术概要

## 1. 业务背景与目标
PRD 表达 5 个业务目标...

## 2. 架构选型
推荐方案 B:异步多阶段事件驱动...

## 3. 技术栈
- 事件总线:Kafka
- 幂等存储:Redis
- 分布式锁:ZooKeeper

## 4. 风险与缓解
(详见 modules.yaml 的 risks 字段)
```

**modules.yaml 示例结构:**

```yaml
- name: 幂等网关
  description: 全局幂等键校验,防重复创建
  deps: [refund-service]
  complexity: high
  clarifying_questions:
    - Q1: 幂等键设计规则?
    - Q2: 重试窗口期多长?
- name: 退款核心逻辑
  ...
```

**双产物同步:** ANALYZING "生成技术概要"按钮一次性落盘 2 个文件。

### D9 · ANALYZING → CLARIFYING 交接 = 直接共享文件(双向引用)

**原文:** CLARIFYING 直接读 `analysis/modules.yaml`,无快照、无交接包、无冻结点。

**机制:**
- modules.yaml 是 source of truth(2 个工位共享)
- 用户切到 CLARIFYING → 自动 reload 最新 modules.yaml
- 用户回到 ANALYZING 修改 modules.yaml → 切回 CLARIFYING 再次 reload 即可
- 无版本管理 / 无冻结 / 无交接仪式(符合决策 15 "不写状态机")

**被拒方案:**
- ❌ 显式交接包 — 增加仪式成本,不一致时需重新打包
- ❌ 双向引用 + 冻结点 — 增加管理负担,MVP 单用户不需要

### D10 · 准入维度配置 = Skill frontmatter 声明(跟随 Skill)

**原文:** 每个 Skill 在 frontmatter 声明它需要检查的准入维度集合,**不同 Skill 可能有不同维度集**(如"退款分析" vs "会员分析")。

**SKILL.md frontmatter 示例:**

```yaml
---
name: refund-analyzer
triggers: [...]
default_arming: [...]
admission_dimensions:
  - loss_prevention
  - performance
  - arch_conflict
  - business_reasonable
admission_override:
  add: [coupon_consistency]   # Skill 新增维度
  skip: [business_reasonable] # Skill 跳过维度
---
```

**机制:**
- 全局默认 5 维度(资损 / 性能 / 架构 / 业务 / 上下文)
- Skill 可 `add` 新维度 / `skip` 默认维度
- 加载 Skill 时,根据 frontmatter 装配 ANALYZING 准入仪表板
- 准入维度的元数据(名称/颜色/图标)由 Skill 自身提供

**被拒方案:**
- ❌ 全局配置文件 — 不同 Skill 应有不同关注点,全局太粗
- ❌ 全局默认 + Skill 覆盖 — 复杂度高,MVP 不需要
- ❌ 需求级 meta.yaml — 过于细粒度,大多数需求不需要定制

---

## 裁决后流程(第二轮 grilling,2026-07-12 续)

基于 D6 "AI 准入提问 = 待裁决项沉淀",需要进一步定义:**用户裁决 → 产物更新**的完整闭环。

### D11 · 裁决后流程 = 增量更新(默认) + 一键重扫按钮(用户主动)

**原文:** 默认增量更新;用户可主动触发全量重扫。

**机制:**
- **增量更新(默认):** 用户裁决某项 → 该项的"裁决"仅记录在 `adjudication.md`,不立即改产物;用户点 [应用本次裁决] 按钮 → AI 基于裁决结果,增量更新 `modules.yaml` + `technical-brief.md` 对应部分
- **一键重扫(用户主动):** 主区提供 [🔄 重扫] 按钮 → AI 重新走"准入校验 + 技术概要生成 + 拆解聚合模块"全流程 → 重新生成 `modules.yaml` + `technical-brief.md`(直接覆盖旧版)

**何时用哪个:**
- 微调(单条裁决 / 数值变化 / 措辞微改)→ 增量更新
- 大改(技术栈重选 / 架构冲突未解 / 大量裁决后)→ 重扫

**被拒方案:**
- ❌ 默认重扫 — 重扫成本高,频繁重扫浪费资源
- ❌ 默认增量,无重扫按钮 — 大改时手动增量更新代价过大
- ❌ "全部裁决后自动重扫" — 违反决策 15 / 决策 25(不主动触发流程)

### D12 · 增量更新触发 = 批量提交

**原文:** 用户裁决多项 → 点 [应用本次裁决] 按钮 → AI 一次性应用所有变更。

**机制:**
- 用户裁决一项 → 该项标记为"已裁决,未应用"(蓝色圆点)
- 用户裁决多项 → 顶部出现 [应用本次裁决 (N 项)] 按钮
- 点 [应用本次裁决] → AI 一次性读取所有"已裁决,未应用"项,增量更新对应产物
- 应用后,这些项移到"已裁决"折叠区

**被拒方案:**
- ❌ 实时增量(每裁决一项立即更新) — 频繁更新导致 AI 调用碎片化
- ❌ 单条应用(每裁决一项都要点一次应用) — 负担过重

### D13 · 回答载体 = 预设选项 + 自定义文本

**原文:** 每项问题提供 2-4 个预设选项(AI 根据上下文推测的常见答案)+ 自定义文本输入框。

**UI 示例:**

```
Q1 · 退款金额上限?
  ◯ 1000   ◯ 5000   ◯ 10000   ◯ 不限
  [自定义输入框...]

Q3 · 退款失败时回滚策略?
  ◯ 自动回滚   ◯ 人工介入   ◯ 悬挂挂起
  [自定义输入框...]
```

**机制:**
- AI 生成问题时,基于上下文推测 2-4 个最可能的答案
- 用户可点选预设(快速路径)或填字(灵活路径)
- 自定义文本框始终可用
- 用户回答后,该问题标记为"已回答,待应用"

**被拒方案:**
- ❌ 纯自由文本 — 负担重,易格式不规范
- ❌ 接受风险(默认 AI 判断)+ 自定义 — 偏向默认 AI 决策,与"用户主导"哲学不符
- ❌ 动态表单(数值用输入框、布尔用开关) — 实现复杂,某些问题难以分类

### D14 · 重扫后产物 = 直接覆盖(不保留版本)

**原文:** 重扫后 `modules.yaml` + `technical-brief.md` 直接覆盖旧版。

**与决策 47 的关系:**
- **决策 47 自动 snapshot 机制仍适用** — 平台级机制,任何 AI 写入前都会自动快照到 `.aidevspace/snapshots/<req-id>/<ts>/`,保留 30 天
- **D14 是说 ANALYZING 工位内部不额外保留版本** — 重扫后旧版的 modules.yaml / technical-brief.md 在主目录被覆盖,但 30 天内可通过 StatusBar "↶↶ 回滚本次会话全部" 找回
- **不依赖 git** — 即使项目不是 git 仓库,snapshot 机制仍工作

**被拒方案:**
- ❌ git 提交一次 — 依赖项目是 git 仓库,某些 Skill 可能在非 git 目录运行
- ❌ 带版本号文件(.v1 / .v2) — 文件管理负担,易混乱
- ❌ .snapshot 目录保留 — 与决策 47 自动机制重复

### D15 · 已裁决项视觉状态 = 双区折叠

**原文:** 主区"待裁决面板"分两区:**待裁决(顶部展开) + 已裁决(底部折叠)**。

**UI 结构:**

```
┌──────────────────────────────────────────┐
│ 🛡 待裁决面板                              │
├──────────────────────────────────────────┤
│ ▼ 待裁决 (5) [🔵 待应用]                  │
│                                          │
│  Q1 退款金额上限?     [回答框]            │
│  Q3 退款失败回滚?     [回答框]            │
│  Q5 阈值?             [回答框]            │
│                                          │
│  [📥 应用本次裁决 (3 项)]  [🔄 重扫]    │
├──────────────────────────────────────────┤
│ ▸ 已裁决 (3) (折叠,点击展开)             │
│  ✅ Q2 退款审核流: 自动 (14:23)          │
│  ✅ Q4 幂等键: 全局自增 (14:25)          │
│  ✅ Q6 通知: webhook (14:26)            │
└──────────────────────────────────────────┘
```

**机制:**
- **待裁决区**:展开,显示当前所有未裁决项;每项有"回答框"
- **已裁决区**:默认折叠,显示 ✅ 图标 + 简述 + 裁决时间;点击展开查看详情
- **[应用本次裁决 (N 项)]** 按钮:在待裁决区底部,显示当前已裁决未应用的项数;点 → 批量提交
- **[🔄 重扫]** 按钮:紧邻 [应用] 按钮;点 → 重新走全流程

**被拒方案:**
- ❌ 同区不同图标 — 视觉混乱,难一眼区分状态
- ❌ 已裁决项全部隐藏 — 无法追溯
- ❌ 顶部仪表板聚合(不展示具体项) — 信息密度低

---

## 工位注册表更新(基于 ADR-0012 §9 13 字段)

基于本 ADR,需更新 `~/.aidevspace/zones/analyzing.yaml`:

```yaml
zone:
  # ──── 身份(必填 · 5 字段) ────
  id: analyzing
  name: ANALYZING
  display_name: PRD 准入 + 技术概要
  icon: 🧠
  route_segment: analyzing

  # ──── 环境(必填 · 5 字段) ────
  has_resource_tree: false       # 保持(主区全宽)
  has_inline_rail: false         # 保持(无右栏)
  main_layout: admission-workbench  # 改名(原 thinking-layout)
  status_color: blue
  status_pulse: true             # 保持(蓝脉动)

  # ──── 装备(必填 · 1 字段) ────
  default_arming:
    - admission-check            # NEW: 准入校验 Skill(系统级)
    - tech-brief-scaffold        # NEW: 技术概要生成 Skill
    - requirement-brainstorm
    - requirement-critique

  # ──── AI 思考条(必填 · 1 字段) ────
  thinking_bar: required         # 保持

  # ──── 触发器(可选 · 2 字段) ────
  entry_triggers:
    - "DRAFTING 工位 PRD 完成时,弹出建议:进入 ANALYZING 校验"

  exit_triggers: []              # 无自动退出(用户主导)

  # ──── 备注(可选 · 1 字段) ────
  description: |
    PRD 准入校验 + 拆解聚合模块,产出技术概要 + modules.yaml
    覆盖决策 25 的 AI 提问切 CLARIFYING 部分(详见 ADR-0013 D3/D6)
```

---

## 工位主区布局(替代 ADR-0011 §6)

```
ANALYZING 工位主区(顶到底):
┌──────────────────────────────────────────────────────────┐
│ 准入仪表板(5 维度卡 + 总体结论)                          │ D4
│ 🔴 资损 2  🟠 性能 3  🟡 架构 1  🟢 业务 0  💬 上下文 4  │
│                                              ⚠️ 待裁决 10 │
├──────────────────────────────────────────────────────────┤
│ 会话 Tab  [架构 3] [数据 5*] [接口 8] [+ 新建]  📊 生成  │ D7
├───────────────────────────┬──────────────────────────────┤
│ 🧠 思考流 (当前会话)      │ 🎯 识别产物 (可交互编辑)     │ D2 ②③
│ 14:23:01 START ...        │ 📌 子问题 5 (✏️ 编辑 / 🗑)    │
│ 14:23:02 READ ...         │   Q1 退款金额上限?           │
│ 14:23:07 DETECT ...       │   Q2 退款审核流?             │
│ 14:23:09 RISK ...         │ ⚠️ 风险点 3                  │
│ 14:23:15 THINK ...▍       │ 🎨 候选方案 2                │
├───────────────────────────┴──────────────────────────────┤
│ 启动前: 解析参数配置面板(选 Skill/知识/分支)              │ D2 ①
│ 启动后折叠为 ⚙️ 设置入口 (顶部右)
├──────────────────────────────────────────────────────────┤
│ 💬 插话输入条 (用户随时补充上下文/反向提问)               │ D2 ②
│ 💬 [提示输入...]    [提交]                               │
├──────────────────────────────────────────────────────────┤
│ AI 思考条 (全局,内容由工位注入) 🟣 AI 思考中 · 评估方案 B │
└──────────────────────────────────────────────────────────┘
```

**与原 11e HTML 区别:**
- ❌ 删除"复制思考产物"按钮(产物在右边可编辑,不需要复制)
- ❌ 删除"暂停 / 重置"作为主 CTA(降级到 AI 思考条小按钮)
- ✅ 新增顶部"准入仪表板"5 维度卡
- ✅ 新增"会话 Tab"横向导航
- ✅ 产物卡片支持交互编辑(增/删/改/合并)
- ✅ 新增底部"插话输入条"
- ✅ "生成技术概要"按钮始终可用(详见 D6)

---

## 与现有决策的关系(改写/补充)

### 覆盖决策 25

| 原决策 25 | 改写后 |
|---|---|
| "AI 提问等用户回答"是**唯一允许的 AI 主动推送** | "AI 提问" 降级为"待裁决项沉淀",**非主动推送** |
| AI 提问触发切 CLARIFYING | AI 提问**不切 CLARIFYING**(D3) |
| 触发 AI 提问以"用户真有需要"为标准 | 触发 AI 标记以"完成识别"为标准,沉淀入面板 |

**新决策 25 文本(推荐):**

> 25 · **AI 主动推送触发 = 全部取消**(包括原"AI 提问等用户回答"也被降级为"待裁决项沉淀")。AI 输出物以文件标记形式落位,以 StatusBar "待裁决 N" + 工位仪表板常驻提醒。彻底贯彻决策 24 "不打扰,但陪伴"哲学。

### 补充决策 23

| 原决策 23 | 补充 |
|---|---|
| AI 存在方式 = 形态 C(混合):默认克制在场 + Cmd+K 唤起 + 极窄主动推送 + Inline 标记;**取消右栏常驻** | 补充:ANALYZING 工位的"准入仪表板"是顶部 5 卡,**不是右栏常驻**,不违反决策 23 |
| Inline 标记仅在 DRAFTING/EXECUTING | 补充:ANALYZING 工位的"待裁决 N"计数在 StatusBar 全局常驻(与 Inline 标记不同层) |

### 强化决策 43

| 原决策 43 | 强化 |
|---|---|
| (a) AI 状态始终可见(不抢焦) | ANALYZING 的"准入仪表板 5 卡"是 AI 状态的可视化(决策 + 风险 + 待办) |
| (b) AI 背景工作以活动流记录可查 | "思考流"作为 ANALYZING 主区核心,完全保留 |
| (c) AI 完成产物以文件标记形式落位 | "技术概要 + modules.yaml"是 (c) 的具体落地(详见 D8) |

---

## Consequences

### 正面

- **ANALYZING 职能清晰且丰富** — 不再是"轻量观察屏",而是 PRD 准入 + 技术概要协作的完整工作台
- **AI 哲学彻底贯彻** — 改写决策 25 后,平台无任何"AI 主动推送",彻底"不打扰"
- **与 CLARIFYING 语义边界清晰** — ANALYZING = 准入校验 + 拆模块(粗粒度),CLARIFYING = 单模块落地细节(细粒度)
- **多会话可扩展** — Tab 模式支持任意数量会话,符合决策 12 多会话机制
- **产物双形态** — Markdown 适合阅读 / YAML 适合工程消费,各取所长
- **配置跟随 Skill** — 不同业务领域有不同准入维度,合理可配置

### 负面 / 代价

- **UI 实现复杂度上升** — 主区 4 块(仪表板/会话/产物/插话)+ 准入校验逻辑,工作量是原 11e 的 ~3 倍
- **决策 25 改写** — 文档需更新(本次已更新),所有依赖"AI 提问=切 CLARIFYING"的旧假设需重审
- **modules.yaml 双产物一致性** — 用户编辑 modules.yaml 时,需保证与 technical-brief.md 同步(技术概要生成按钮可强制同步)
- **准入维度配置分散到各 Skill** — 全局统一视图需聚合,需要维护一个"Skill → 准入维度映射表"
- **会话 Tab 切换会丢滚动位置**(可优化:sessionStorage 保留)

### 风险缓解

| 风险 | 缓解措施 |
|---|---|
| UI 工作量翻倍 | 拆分实施:先实现"准入仪表板"骨架 + 单会话,再补多会话 + 插话 |
| 决策 25 改写冲击其他工位 | 审计其他 5 工位的 AI 提问逻辑,确保无依赖旧决策 25 的代码 |
| 双产物不一致 | "生成技术概要"按钮强制一致性;modules.yaml 加 schema 校验 |
| 多会话性能压力 | MVP 默认上限 5 个并发会话(可在 Skill 配置) |
| 准入维度配置分散 | 提供 `aidevspace admission list` CLI 查看当前激活的维度集合 |

---

## Alternatives Considered

### A · 维持 ADR-0011 §6 原 ANALYZING 布局

- 优势:不返工,issue 19 继续
- 拒绝:与用户故事"PRD 准入 + 技术概要协作"严重不符,职能仍过轻

### B · 多会话 = 默认 Tab + 可切并排(候选 C)

- 优势:灵活,复杂度伸缩
- 拒绝:实现复杂度翻倍,价值不显著(MVP 用户场景单 Tab 已够)

### C · AI 提问保留"切 CLARIFYING"机制(原决策 25)

- 优势:决策 25 不变,无冲击
- 拒绝:与用户故事矛盾(ANALYZING 中 AI 就要不停问),且更彻底的"不打扰"是更好的产品哲学

### D · 显式交接包(ANALYZING → CLARIFYING)

- 优势:严格单向,可追溯
- 拒绝:增加仪式成本,实际场景中用户希望双向引用(改完 ANALYZING 自动同步 CLARIFYING)

### E · (已选) PRD 准入 + 技术概要 + Tab 多会话 + 直接共享 + Skill 配置

- 优势:与用户故事完全对齐,哲学彻底,产品形态清晰
- 代价:UI 工作量大,决策 25 需改写

---

## 落地 Issue(待拆分)

将原 [.scratch/ai-devspace-mvp/issues/19-zone-analyzing.md](../../.scratch/ai-devspace-mvp/issues/19-zone-analyzing.md) 拆分为:

- `19a-analyzing-admission-dashboard.md` — 准入仪表板 5 维度卡组件
- `19b-analyzing-session-tabs.md` — 多会话 Tab 切换组件(基于 11h-A)
- `19c-analyzing-product-edit.md` — 识别产物交互编辑(增/删/改/合并)
- `19d-analyzing-config-panel.md` — 解析参数配置面板
- `19e-analyzing-prompt-input.md` — 插话输入条
- `19f-analyzing-tech-brief-gen.md` — 生成技术概要按钮(Markdown + YAML 双产物)
- `19g-analyzing-adjudication-panel.md` — 待裁决面板(替代原"AI 提问切 CLARIFYING")
- `19h-analyzing-zone-yaml-update.md` — 工位注册表更新

**优先级:**
- P0:19a(准入仪表板)、19f(技术概要生成) — 核心
- P1:19b(多会话)、19c(产物编辑) — 关键 UX
- P2:19d(参数配置)、19e(插话) — 增强
- P3:19g(待裁决面板)、19h(注册表更新) — 配套

---

## 相关文档

### 用户故事与决策

- 本 ADR 由 10 轮 grilling 会话沉淀(2026-07-12 下午)
- 用户原始反馈:"现有功能只有观察 ai 分析过程,这么一个简单功能就开一个工作台太浪费了"
- 用户补充故事:PRD 准入校验 + 拆解聚合模块

### HTML 原型

| 文件 | 用途 |
|---|---|
| [11e-stage-adaptive-analyzing.html](../design/pages/11e-stage-adaptive-analyzing.html) | 原 v1 形态(Thinking 屏,作存档) |
| [11h-zone-multisession-form-compare.html](../design/pages/11h-zone-multisession-form-compare.html) | 多会话 4 候选对比 |
| [11h-A-zone-multisession-tabs.html](../design/pages/11h-A-zone-multisession-tabs.html) | **已选**:多会话 Tab 切换(候选 A) |
| [11h-B-zone-multisession-grid.html](../design/pages/11h-B-zone-multisession-grid.html) | 被拒:并排 grid(候选 B) |
| [11h-C-zone-multisession-hybrid.html](../design/pages/11h-C-zone-multisession-hybrid.html) | 被拒:Tab + grid 混合(候选 C) |
| [11h-D-zone-multisession-drawer.html](../design/pages/11h-D-zone-multisession-drawer.html) | 被拒:抽屉历史(候选 D) |

### 待落地 Issue

- [.scratch/ai-devspace-mvp/issues/19-zone-analyzing.md](../../.scratch/ai-devspace-mvp/issues/19-zone-analyzing.md) — 原 issue(将被 19a-19h 拆分替代)

### 关联 ADR

- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — 工位自适应(本 ADR 覆盖其 §6)
- [ADR-0012](0012-requirement-workbench-shell-topology.md) — shell 拓扑(本 ADR 保留)
- [ADR-0009](0009-ai-failure-defense.md) — AI 翻车防线(snapshot 机制仍适用)

---

## 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-12 | 初稿:基于 10 轮 grilling 会话,沉淀 D1–D10,重设计 ANALYZING 工位职能范围与产品形态 | Grilling 会话 |
