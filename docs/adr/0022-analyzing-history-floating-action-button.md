---
status: accepted
date: 2026-08-03
deciders: 项目负责人(经 `/grill-with-docs` 11 轮 grilling 拍板)
---

# ADR-0022 · ANALYZING 历史列改为浮动召唤按钮 + 浮动面板

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** 项目负责人(经 `/grill-with-docs` 11 轮 grilling 拍板)

## 关联决策与 ADR

- [CONTEXT.md](../CONTEXT.md) 决策 15(不写状态机) / 23(AI 形态 C) / 24(克制在场) / 26(Cmd+K 命令面板) / 29(90% 走 Cmd+K) / 43(AI 状态可见不抢焦) / 49(StatusBar AI 区 4 指示器) / 52(资源树按工位 = ANALYZING 无) / 53(Inline 栏仅 DRAFTING/EXECUTING)
- [ADR-0017](0017-analyzing-main-document-reader.md) —— ANALYZING 主区布局(本 ADR 在其主区右侧新增 FAB,不挤压主区列)
- [ADR-0021](0021-analyzing-skill-driven-analysis-runs.md) —— Analysis Run 模型(本 ADR 覆盖其决策 36 的抽屉形态描述)

**覆盖:**
- **覆盖** [ADR-0021 决策 36](../CONTEXT.md) 中"主区右侧 320px 永久抽屉"的描述(改为浮动召唤按钮 + 浮动面板,默认折叠)
- **不覆盖** ADR-0021 的 Analysis Skill / Analysis Run / Analysis Issue 模型本身

---

## Context

### 起点

[ADR-0021 决策 36](../CONTEXT.md) 拍板:ANALYZING 主区右侧固定一个 **320px 永久展开的抽屉**,由 [`<AnalysisHistoryDrawer>`](../apps/web/src/components/analysis-history-drawer.tsx) 实现;`analyzing-history-col` div 在 [`analyzing-zone.tsx:843-848`](../apps/web/src/components/analyzing-zone.tsx) 永久挂载。

落地后(2026-08-03 `/grill-with-docs`)用户提出新维度的痛点:

> "分析中 90% 时间看的是文档阅读器 + 识别产物,历史列只在切换 Run / 删除 / 回顾时才用;但抽屉永远占 320px,主区被吃掉 12-15%"

### 真实场景(决定性输入)

PM 在 ANALYZING 工位审视 AI 识别的 Analysis Issue 时,核心交互是:

1. **对照 PRD 阅读器**(占主区 2/3 视野)+ **识别产物 Issue 卡**(占 1/3 视野)
2. **偶尔切到历史 Run 对照**(看看上一轮识别过什么 / 删除过时 Run / 复制 Issue Response 模板)
3. **回切到当前 Run 继续审视 Issue**

历史列表是 **"偶尔用"** 的工具,但 ADR-0021 决策 36 让它 **"永远在场"** —— 主区宽度恒定 -320px,违反决策 24"克制,在场"的"克制"语义。

### 与 ADR-0021 决策 36 的核心矛盾

| 维度 | ADR-0021 决策 36 | 用户故事要求 |
|---|---|---|
| 历史列形态 | 永久 320px 抽屉 | 默认隐藏,有召唤按钮 |
| 主区宽度 | 恒定 -320px | 主区 100% 可用 |
| 切换 Run | 1 步(点 Run 行) | 2 步(点 FAB → 点 Run) |
| N 计数可见 | 实时 | 默认折叠时仍可见(克制在场) |
| 运行中 dot | 实时可见 | 折叠态走 AI 思考条 |

### 与已有决策的兼容性

| 决策 | 内容 | 本 ADR 兼容性 |
|---|---|---|
| 决策 15 | 不写状态机 | ✅ FAB 状态是组件级 UI state,非工位状态机 |
| 决策 23 | AI 形态 C(克制在场 + Cmd+K + 窄主动推送) | ✅ FAB 是"克制在场"召唤范式 |
| 决策 24 | "不打扰,但陪伴;克制,在场" | ✅ 默认折叠 = 克制;FAB 显示 N = 在场 |
| 决策 26 | Cmd+K 命令面板 | ✅ 新增"历史分析"命令(本 ADR D4.2) |
| 决策 43 | AI 状态可见不抢焦 | ✅ 运行中 dot 走 AI 思考条,FAB 不重复 |
| 决策 49 | StatusBar AI 区 4 指示器 | ✅ FAB 不展示 AI 状态,避免重复信号 |
| 决策 52 | 资源树按工位 = ANALYZING 无 | ✅ FAB 不引入 tree 形态 |
| 决策 53 | Inline 栏仅 DRAFTING/EXECUTING | ✅ FAB 不是 Inline 栏,是主区内浮动元素 |

---

## Decision

通过 11 轮 grilling 会话,沉淀 D1-D7 决策。所有子决策遵循以下共同原则:

- **FAB = 视觉召唤**(鼠标用户入口)
- **Cmd+K 命令 = 键盘召唤**(键盘用户入口)
- **浮动面板 = non-modal popover**(不抢焦点,可与主区交互并存)
- **状态不持久化**(默认折叠,符合"克制"语义)
- **窄视口 100% 复用**(无 max-h 折叠条逻辑)

### D1 · 历史列折叠形态

**原文:** ANALYZING 工位历史列从"永久 320px 抽屉"改为 **"默认折叠的浮动召唤按钮(FAB) + 浮动面板"**。

```
旧(ADR-0021 决策 36):
┌──────────────────┬──────────┐
│ 📄 PRD 阅读器    │ 🎯 产物  │ 🗂️ 历史抽屉 320px(永久)
│                  │          │ ┌──────────┐
│                  │          │ │运行中 #412│
│                  │          │ │已完成 #408│
│                  │          │ │失败 #407 │
└──────────────────┴──────────┘ └──────────┘
主区固定 -320px

新(本 ADR):
默认态(折叠):
┌──────────────────┬──────────┐
│ 📄 PRD 阅读器    │ 🎯 产物  │  ← 主区 100% 可用
│                  │          │
│                  │          │              [🗂️ 历史分析 4]⤴
│                  │          │              ← FAB 浮动右上
└──────────────────┴──────────┘

展开态(浮动面板):
┌──────────────────┬══════════┐
│ 📄 PRD 阅读器    │ 🎯 产物  │  ← [识别产物] 列加 dim 蒙层
│                  │ dimmed ▒│
│                  │          │  ┌──────────────┐
│                  │          │  │ 🗂️ 历史 4  ✕│
│                  │          │  │ ● #412 运行中│
│                  │          │  │ ● #408 已完成│
│                  │          │  │ ● #407 失败  │
│                  │          │  └──────────────┘
└──────────────────┴══════════┘
浮动面板 absolute,不挤压主区
```

**核心区别:**
- ❌ **删除** `analyzing-history-col` 永久列(`analyzing-zone.tsx:843-848`)
- ✅ **新增** `<HistoryFab>` 浮动按钮(absolute top-3 right-3)
- ✅ **新增** `<HistoryPanel>` 浮动面板(absolute top-12 right-3, z-index 40)
- ✅ **保留** `<AnalysisHistoryDrawer>` 组件(展开态内部复用,不重写)

### D2 · 浮动召唤按钮(FAB)形态

**原文:** FAB = 主区右上角 absolute 浮动的图标+文字+N 按钮。

| 子项 | 决策 |
|---|---|
| **D2.1 位置** | `position: absolute; top: 12px; right: 12px; z-index: 30`(主区容器内) |
| **D2.2 样式** | `🗂️ 历史分析 [N]` = 图标 + 文字 + N 计数徽章(图标 14px / 文字 13px / N 数字 11px mono) |
| **D2.3 N=0** | 显示灰色 `0`(不隐藏 FAB) |
| **D2.4 不显示运行中 dot** | FAB 只显示 N,运行状态走底部 AI 思考条(决策 49 的 4 指示器) |
| **D2.5 N>99** | 显示 `99+`(Gmail 范式,不截断) |

**视觉示意:**
```
默认态:                    展开态:                     N=0:
┌────────────┐             ┌────────────┐              ┌────────────┐
│🗂️ 历史分析 4│             │🗂️ 历史分析 4│ ← act态      │🗂️ 历史分析 0│
└────────────┘             └────────────┘  brand bg    └────────────┘
  bg-elevated                                          灰色 N
```

### D3 · 浮动面板形态

**原文:** 浮动面板是绝对定位的 320px 宽列表,默认覆盖在 [识别产物] 列之上(不挤压列宽)。

| 子项 | 决策 |
|---|---|
| **D3.1 位置** | `position: absolute; top: 48px; right: 12px; z-index: 40`(FAB 正下方) |
| **D3.2 宽度** | `width: min(320px, calc(100vw - 24px))`(窄视口自适应) |
| **D3.3 高度** | 与 [识别产物] 列等高(`flex-1 min-h-0`),上限不超过 AI 思考条之上 |
| **D3.4 超出滚动** | Run 列表超出可用高度时,内部滚动(头部固定) |
| **D3.5 头部固定** | `🗂️ 历史分析 N ✕` 标题栏固定,滚动只动 Row 列表 |
| **D3.6 空态** | N=0 时显示「暂无历史 Analysis Run · 点击下方 [▶ 开始分析] 按钮发起首次分析」+ CTA |
| **D3.7 dim 蒙层** | [识别产物] 列加 `dimmed` 类(4% 黑色蒙层),不阻断交互,视觉提示"面板在前" |

**面板内容复用:** 展开态的 Run 行(`HistoryRow` 组件)直接复用 ADR-0021 已落地的 [`<AnalysisHistoryDrawer>`](../apps/web/src/components/analysis-history-drawer.tsx) 的渲染逻辑,**不重写列表组件**。

### D4 · 关闭行为与发现路径

**原文:** 浮动面板有四种关闭方式 + Cmd+K 提供键盘入口。

| 子项 | 决策 |
|---|---|
| **D4.1 关闭触发** | 点外部 + Esc + ✕ + 选中 Run 自动关(四种都关,符合 Linear popover 心智模型) |
| **D4.2 Cmd+K 新增命令** | 「🗂️ 历史分析 · req-03 · 共 4 个 Run」+ 按 `↵` 直接打开浮动面板(等同点 FAB) |
| **D4.3 不加快捷键** | 决策 29:90% 走 Cmd+K,不绑 `⌘⇧H`(避免与决策中已有的 `⌘⇧D` 对话历史混淆) |
| **D4.4 状态不持久化** | 永远默认折叠;切需求/切工位/启动新 Run 时强制收起 |

**Cmd+K 命令示意:**
```
┌──────────────────────────────────────┐
│ 🔍 历史分析                       ⌘K │
├──────────────────────────────────────┤
│ 命令                                   │
│ 🗂️ 查看历史 Analysis Run    req-03 ↵ │ ← 新增
│ 📋 Analysis Issue 列表    req-03 · 5  │
└──────────────────────────────────────┘
```

### D5 · 行为规则

**原文:** FAB / 面板与现有 ADR-0021 决策 36 焦点规则的对齐。

| 子项 | 决策 |
|---|---|
| **D5.1 删除 Run 后** | 面板保留打开,currentRun 自动切到列表中下一个 Run(按 created_at 倒序的第一个非删除 Run) |
| **D5.2 切需求 / 切工位** | FAB 面板强制收起(component unmount → state 重置) |
| **D5.3 启动新 Run** | FAB 面板强制收起(避免与新 Run focus 抢戏) |
| **D5.4 选中历史 Run** | 切 currentRun + 面板关闭 + [识别产物] 列换该 Run 的 Issue 内容 |
| **D5.5 删除按钮** | 🗑️ 仍走二次确认对话框(沿用 `AnalysisDeleteRunDialog`);不关面板 |

### D6 · a11y(可访问性)

**原文:** FAB + 面板是 non-modal popover,Tab 焦点自由,不阻断主区交互。

| 子项 | 决策 |
|---|---|
| **D6.1 FAB ARIA** | `role="button"` `aria-label="历史分析 共 4 个 Run"` `aria-expanded="false|true"` `aria-haspopup="region"` |
| **D6.2 面板 ARIA** | `role="region"` `aria-label="历史分析列表"`(**不**用 `role="dialog"`,dialog 暗示模态) |
| **D6.3 Tab 焦点** | 自由:不困焦点,焦点可在面板与主区之间自由切换 |
| **D6.4 屏幕阅读器** | FAB 状态变化通过 `aria-expanded` 同步;面板内 Run 切换通过 `aria-current="true"` 高亮 |
| **D6.5 删除按钮 ARIA** | `aria-label="删除 Run #408 已完成"`;运行中 Run 的 🔒 按钮 `aria-label="运行中的 Run 不可删除"` |

### D7 · 响应式

**原文:** FAB 模式天然兼容窄视口,无需 `max-h-[200px]` 折叠条逻辑。

| 子项 | 决策 |
|---|---|
| **D7.1 窄视口 FAB** | FAB 始终渲染,不因 < 1024px 隐藏 |
| **D7.2 窄视口面板** | 面板宽度自适应 `min(320px, calc(100vw - 24px))`,不溢出视口 |
| **D7.3 高度自适应** | 面板 max-height = 主区高度(主区 `flex-1`),窄视口下主区更窄 → 面板更扁 |
| **D7.4 z-index 层级** | FAB z-30 / 面板 z-40 / Cmd+K overlay z-50(确保 Cmd+K 永远最上层) |

### 与现有决策的关系

#### 覆盖 ADR-0021 决策 36(部分)

| 原 ADR-0021 决策 36 | 本 ADR 改写后 |
|---|---|
| 历史 Run 通过"历史分析"侧边抽屉按时间倒序切换 | 历史 Run 通过浮动面板按时间倒序切换(FAB 召唤) |
| 抽屉永久展开(右栏 320px 常驻) | FAB 默认折叠,展开后浮动面板覆盖 [识别产物] 列之上 |
| 父组件 AnalyzingZone 维护 currentRunId + 用户主动切换标记 | 不变(FAB / 面板是 currentRunId 的消费者,非维护者) |

#### 不覆盖的 ADR-0021 决策

| 决策 | 内容 | 本 ADR 兼容性 |
|---|---|---|
| Analysis Run 单 Skill 模型 | 一个 Run 一个 Skill | ✅ 不变 |
| Issue Response 持续完善 | 用户填 Markdown 答复 | ✅ 不变 |
| 删除 Run 级联清理 | Issue + Response + Log 全删 | ✅ 不变 |
| Issue 提交幂等 | 同工具调用重放去重 | ✅ 不变 |

#### 强化决策 23 + 24(AI 形态 C + 克制在场)

- **决策 23(形态 C)** 在 ANALYSIS 工位的具体落地:Cmd+K 提供"历史分析"命令(本 ADR D4.2),FAB 提供视觉召唤;两条路径覆盖鼠标 / 键盘两类用户。
- **决策 24"克制,在场"** 的 FAB 化:默认折叠 = 克制;FAB 显示 N + 灰 0 = 在场但不抢焦;面板 non-modal = 在场但允许用户继续看主区。

---

## 工位主区布局(替代 ADR-0021 决策 36 的抽屉部分)

```
ANALYZING 工位主区(顶到底):
┌──────────────────────────────────────────────────────────┐
│ Stage strip(② 分析徽章 + 进度 + 状态)                    │ 保留
├──────────────────────────────────────────────────────────┤
│ Toolbar(面包屑 + 复制/暂停/重置)                          │ 保留
├──────────────────────────────────────────────────────────┤
│ 准入仪表板(替换为 Analysis Skill 选择面板)               │ ADR-0021 改
├──────────────── 2 份 ──────────────┬─── 1 份 ─────────────┤
│ 📑 文档阅读器                       │ 🎯 识别产物        │ ADR-0017
│ [PRD · 🔗 3] [aux-api.md · 🔗 2]  │ 📌 Issue 卡         │
│                                    │ + Issue Response    │
│ 退款单笔金额上限 ≤ 1000 元 ▓▓     │ (Markdown 编辑器)   │
│ [配图 1]                            │                     │
│ 退款审核流由财务人工审核             │                     │
│ [...]                               │                     │
├────────────────────────────────────┴─────────────────────┤
│ AI 思考条(全局)🟣 AI 思考中 · 已识别 3/5              │ 决策 49
│                              ┌────────────┐           │
│                              │🗂️ 历史分析 4│ ← FAB   │
│                              └────────────┘           │
└──────────────────────────────────────────────────────────┘

FAB 点开后(浮动面板展开):
┌──────────────────┬══════════════┐
│ 📄 PRD 阅读器    │ 🎯 识别产物  │
│                  │ dimmed ▒    │
│                  │             │  ┌──────────────┐
│                  │             │  │🗂️ 历史 4  ✕│
│                  │             │  │● #412 运行中│
│                  │             │  │● #408 已完成│
│                  │             │  │● #407 失败  │
│                  │             │  │● #400 已完成│
│                  │             │  └──────────────┘
│                  │             │  ← absolute top-12 right-3 z-40
└──────────────────┴══════════════┘
主区宽度不变,面板覆盖在 [识别产物] 列之上
```

---

## Consequences

### 正面

- **主区宽度解放**:从固定 -320px 改为 100% 可用,文档阅读器 + 识别产物两列呼吸空间显著增加
- **克制在场语义落地**:默认折叠符合决策 24,FAB 显示 N 仍提供"在迭代过几轮"信号
- **窄视口天然兼容**:FAB 是 absolute 定位,不挤压主区,旧 `max-h-[200px]` 折叠条逻辑可删除
- **Cmd+K 双通道**:FAB 服务鼠标用户,Cmd+K 服务键盘用户,符合决策 23 形态 C
- **a11y 友好**:non-modal popover 不困焦点,屏幕阅读器通过 `aria-expanded` 同步
- **组件复用**:展开态的 Run 行复用 ADR-0021 已落地的 `<AnalysisHistoryDrawer>` 渲染逻辑,不重写列表组件

### 负面 / 代价

- **多两个组件**:`<HistoryFab>` + `<HistoryPanel>`,组件树变深
- **删除 UX 重新设计**:删除 Run 后焦点处理从"不切走"(决策 36)改为"切到下一个 Run"(D5.1),需新增"下一个 Run"的判定逻辑(按 created_at 倒序)
- **Cmd+K 命令面板新增条目**:命令清单维护成本微增,但仅 1 条命令(随 Requirement 切换动态更新描述)
- **z-index 层级管理**:FAB z-30 / 面板 z-40 / Cmd+K overlay z-50(D7.4),三套 z-index 必须保证 Cmd+K 永远最上层
- **面板覆盖 [识别产物] 列**:虽然不挤压,但视觉 dim 后用户阅读识别产物的体验微降;可接受因为"用户召唤了面板 = 用户主动选择看历史"

### 风险缓解

| 风险 | 缓解措施 |
|---|---|
| 用户找不到 FAB | Cmd+K 新增「历史分析」命令(D4.2)+ 命令面板 `⌘/` 速查里加 FAB 提示 |
| 删除 Run 后 currentRun 找不到下一个 | 父组件 AnalyzingZone 在 `deleteAnalysisRun` 后调 `setCurrentRunId(findNextRunId(runs))`,列表空时回退到最新 Run(本 ADR 不涉及) |
| 面板宽度在窄屏溢出 | CSS `width: min(320px, calc(100vw - 24px))` 兜底(D3.2) |
| Cmd+K 命令描述与 Requirement 漂移 | 命令渲染时按 `useRequirement()` 取当前 reqId,实时跟随;无 reqId 时命令 disabled |
| 面板 z-index 与现有 modal 冲突 | z-index 统一在 `tailwind.config` 命名(`z-fab` / `z-panel` / `z-overlay`),避免散落魔数 |

---

## Alternatives Considered

### A · 维持 ADR-0021 决策 36 不变(永久 320px 抽屉)

- 优势:零返工,已落地的 `<AnalysisHistoryDrawer>` 直接复用
- 拒绝:用户故事"主区宽度解放"无法承载;违反决策 24"克制"语义;窄视口 `max-h-[200px]` 折叠条是历史包袱

### B · 折叠为按钮 + 永久按钮位(B 方案原型 v1)

- 优势:FAB 不引入新概念,纯组件级 state
- 拒绝:展开后 320px 抽屉仍挤压主区(用户明确拒绝);必须配合 `max-h` 折叠条

### C · 完全隐藏 + Cmd+K 唯一召回路径(A 方案)

- 优势:主区 100% 可用
- 拒绝:用户"忘了历史列表存在";违反决策 24"在场"语义;N 计数无任何提示

### D · 折叠为窄把手(C 方案)

- 优势:默认态下手感最轻
- 拒绝:竖排文字与 Linear 风格冲突;悬停展开误触率高;窄视口与 `max-h` 折叠条冲突

### E · (已选) FAB + 浮动面板(本 ADR)

- 优势:克制在场语义最契合;Cmd+K 双通道;窄视口天然兼容;组件复用度高
- 代价:多 2 个组件;删除 UX 需重新设计

### F · FAB + 浮动面板 + 默认展开(常驻召唤)

- 优势:用户每次进入 ANALYZING 立即看到历史列表
- 拒绝:违反决策 24"克制"语义;FAB 默认折叠才能体现"召唤";用户每次都看到历史 = 噪声

---

## 落地 Issue(待拆分)

将本 ADR 拆分为以下 ticket,落到 `.scratch/analyzing-fab/issues/`(新建):

1. **`01-history-fab-component.md`** —— 新建 `<HistoryFab>` 浮动按钮组件(D2);删除 `analyzing-history-col` 永久列(`analyzing-zone.tsx:843-848`);FAB z-index 命名约定
2. **`02-history-panel-component.md`** —— 新建 `<HistoryPanel>` 浮动面板组件(D3);复用 `<AnalysisHistoryDrawer>` 的 `HistoryRow` 渲染逻辑;dim 蒙层实现
3. **`03-cmdk-history-command.md`** —— Cmd+K 命令面板新增「🗂️ 历史分析」命令(D4.2);命令描述跟随当前 Requirement
4. **`04-delete-run-focus-redirect.md`** —— 删除 Run 后 currentRun 自动切到下一个 Run(D5.1);父组件 `AnalyzingZone` 新增 `findNextRunId` helper
5. **`05-a11y-and-aria.md`** —— FAB / 面板 ARIA 属性(D6);删除对话框 `aria-modal` 不变;vitest 单测覆盖 Tab 焦点 + Esc 行为
6. **`06-narrow-viewport-and-tests.md`** —— 窄视口 FAB + 面板 CSS 自适应(D7);删除旧 `max-h-[200px]` 折叠条逻辑;E2E 验证

**优先级:**
- P0:01(FAB 组件)+ 02(面板组件)+ 04(删除 UX 重设)——核心闭环
- P1:03(Cmd+K 命令)+ 05(a11y)——可发现性 + 可访问性
- P2:06(响应式 + 测试)——可用性兜底

---

## 相关文档

### 用户故事与决策

- 本 ADR 由 11 轮 `/grill-with-docs` grilling 会话沉淀(2026-08-03)
- 用户原始痛点:"分析中 90% 时间不看历史,但抽屉永远占 320px"
- HTML 原型:
  - [13-analyzing-history-fold-compare.html](../docs/design/pages/13-analyzing-history-fold-compare.html) —— 4 候选对比(A/B/C/D)
  - [13-B-analyzing-history-button-position.html](../docs/design/pages/13-B-analyzing-history-button-position.html) —— 4 位置变体对比(①/②/③/④)

### 关联 ADR

- [ADR-0017](0017-analyzing-main-document-reader.md) —— ANALYZING 主区文档阅读器(本 ADR FAB 在其主区右侧)
- [ADR-0021](0021-analyzing-skill-driven-analysis-runs.md) —— Analysis Run 模型(本 ADR 覆盖其决策 36 的抽屉形态)
- [CONTEXT.md](../CONTEXT.md) 决策 23 / 24 / 26 / 29 / 43 / 49 / 52 / 53 —— 全部兼容

### 实现层默认(非 ADR 决策)

- FAB 点击关闭时走 React `useEffect` 监听 `mousedown` 事件(判断 `event.target` 是否在 FAB 或面板内)
- Cmd+K 「历史分析」命令描述格式:`🗂️ 历史分析 · {reqTitle 截断 20 字符} · 共 {N} 个 Run`
- 面板头部 ✕ 图标采用 `✕`(Unicode 0x2715),与现有 modal 关闭按钮一致

---

## 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-08-03 | 初稿:基于 11 轮 `/grill-with-docs` grilling 会话,沉淀 D1-D7,新增 FAB + 浮动面板形态,覆盖 ADR-0021 决策 36 的抽屉描述 | Grilling 会话 |
