# ADR-0012: 需求工作台 shell 拓扑(工位独立路由 + Overview 概览页)

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** 项目负责人
**SUPERSEDES:** [ADR-0007](0007-workspace-route-group-shell.md)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 15, 22, 23, 24, 26, 36, 37, 49
**关联 ADR:**
- [ADR-0006](0006-html-prototype-as-source-of-truth.md) — HTML 原型作为视觉单一事实源
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — 需求工作台工位自适应(本 ADR 的内容由其驱动)

---

## Context

ADR-0007 定义了需求详情路由的 shell 拓扑:

```
(workspace)/layout.tsx                  Shell 层 1: StatusBar + Sidebar + 键盘监听
(workspace)/requirements/[id]/layout.tsx Shell 层 2: 资源树 + Inline 提示栏
(workspace)/requirements/[id]/page.tsx   主区
```

2026-07-12 通过 11 轮 grilling 会话,在 ADR-0011 工位自适应决策下,产出了**新的产品架构**,把 ADR-0007 的核心拓扑**完全推翻**:

### 关键变化

1. **工位 = 独立路由**(独立工作台)—— 不再是"同一 URL 内主区换装"
2. **新增 Overview 概览页** —— `/requirements/[id]/` 是仪表板,不是工位
3. **Inline 栏下放** —— 仅 DRAFTING / EXECUTING 保留,其他工位不占右栏
4. **资源树按工位** —— 3 工位有(DRAFTING / EXECUTING / WRAP-UP),3 工位无
5. **AI 思考条全局化** —— 位置 shell 层 1,内容由当前工位注入
6. **ZoneBar 新增** —— 7 Tab 顶部导航,Overview + 6 工位

### 为什么 ADR-0007 必须废除(而非补丁)

- ADR-0007 的"shell 层 2 = 资源树 + Inline 栏"被工位模型**整体下放**
- 在原文上 patch 会产生内部逻辑矛盾(资源树 / Inline 栏既属于 shell 又属于工位)
- 新写 ADR-0012 能完整沉淀 11 轮 grilling 决策,文档清晰可追溯

---

## Decision

### 1. URL 结构(7 产品形态)

```
/requirements/                          ← 需求列表(决策 36 路由组)
  └── [id]/                            ← Overview 概览页(NEW · 非工位)
        ├── drafting/                  ← 工位 1: 写需求
        ├── analyzing/                 ← 工位 2: 旁观 AI 思考
        ├── clarifying/                ← 工位 3: 回答 AI 提问
        ├── designing/                 ← 工位 4: 评审候选方案
        ├── executing/                 ← 工位 5: 监督 AI 实施
        └── wrap-up/                   ← 工位 6: 归档复盘
```

| URL | 性质 | ZoneBar |
|---|---|---|
| `/requirements/[id]/` | Overview 概览页(仪表板) | ❌ 无 |
| `/requirements/[id]/[zone]/` | 工位(独立工作台) | ✅ 7 Tab |

### 2. Shell 拓扑图(对比 ADR-0007)

**旧(ADR-0007,已废除)**:
```
(workspace)/layout.tsx                          StatusBar + Sidebar + Cmd+K 等键盘监听
(workspace)/requirements/[id]/layout.tsx         资源树 + Inline 提示栏
(workspace)/requirements/[id]/page.tsx           主区
```

**新(ADR-0012,本 ADR)**:
```
(workspace)/layout.tsx                                   Shell 层 1:
                                                          StatusBar + Sidebar
                                                          + Cmd+K/Cmd+N/Cmd+/ 键盘监听
                                                          + ZoneBar(7 Tab · 工位路由时)
                                                          + AI 思考条(全局 · 内容由工位)
(workspace)/requirements/[id]/page.tsx                   Overview 概览页(无 ZoneBar)
(workspace)/requirements/[id]/[zone]/layout.tsx          工位专属 shell:
                                                          资源树(has_resource_tree=true 时)
                                                          + Inline 栏(has_inline_rail=true 时)
(workspace)/requirements/[id]/[zone]/page.tsx            工位布局(主区)
```

### 3. Shell 层 1 详解(workspace layout)

| 元素 | 存在 | 备注 |
|---|---|---|
| StatusBar | ✅ | 沿用 ADR-0007 决策 37 |
| Sidebar | ✅ | 沿用 ADR-0007 决策 37 |
| Cmd+K / Cmd+N / Cmd+/ 监听 | ✅ | 沿用 ADR-0007 决策 37 |
| ZoneBar(7 Tab) | ✅ **工位路由时** | NEW · 7 Tab · Overview 排第一 |
| AI 思考条 | ✅ 全局 · 内容由 `useZone()` hook 注入 | NEW · 全局位置 + 工位内容 |
| 资源树 | ❌(下放工位) | — |
| Inline 栏 | ❌(下放工位,仅 DRAFTING/EXECUTING) | — |

### 4. 工位专属 shell 详解(zone layout)

每个工位路由 `[id]/[zone]/` 下的 layout:

| 元素 | 条件 | 默认 |
|---|---|---|
| 资源树 | 工位注册表 `has_resource_tree: true` | DRAFTING / EXECUTING / WRAP-UP 为 true |
| Inline 栏 | 工位注册表 `has_inline_rail: true` | 仅 DRAFTING / EXECUTING 为 true |
| 主区(工位布局) | 必填 | 6 个独立 React 组件 |

### 5. Overview 概览页详解

**位置**: `/requirements/[id]/`

**性质**: 第 7 产品形态,但**不是工位**(用户"看"而非"做")

**内容范围**(推荐集 5 项,基于 11 轮 grilling 第 11 决策):

| 内容 | 说明 |
|---|---|
| 需求元数据 | 标题 / 状态 / 仓库 / 负责人 / 创建时间 |
| 完成进度 | 任务完成率 / 产物清单 / PR 状态 / Commit 计数 |
| 工位地图 | 6 个工位卡片(带状态色)作为工位入口 |
| 关键里程碑时间线 | 各工位进入/退出时间戳 |
| AI 活动概览 | AI 在哪个工位最活跃 / 总写入次数 / 待回答数 |

**ZoneBar**: ❌ 不显示(Overview 是仪表板,不是工作台,不需要"工作台导航器")

### 6. ZoneBar 设计

**位置**: Shell 层 1 · 顶部(StatusBar 之下 · 主区之上)

**Tab 排序**(lifecycle 静态排序):
```
Overview → DRAFTING → ANALYZING → CLARIFYING → DESIGNING → EXECUTING → WRAP-UP
```

**视觉规格**:

| 元素 | 规格 |
|---|---|
| 高度 | 44px |
| Tab 文字 | 12-14px Inter(决策 28 紧凑风) |
| 图标 | 16px emoji |
| 状态色点 | 6px(对应决策 22) |
| 激活态 | 紫色 2px 底部下划线 + 文字加粗 + brand-600 文字色 |
| 数字徽章 | ❌ 无(决策 22 MVP 不带数字徽章) |
| 脉动 | ANALYZING 蓝点脉动(对应决策 49 AI 思考中) |
| CLARIFYING 特殊 | 紫点 + 红圈(决策 22 CLARIFYING 特殊标记) |

**Cmd+K 双通道**: Tab 给视觉反馈,Cmd+K 给键盘流快速切工位(0 增量 UI)

### 7. Cmd+K 命令面板增强

复用决策 26 三段式,新增工位搜索:

| 前缀 | 行为 |
|---|---|
| `/` | 命令(已有) |
| `@zone` 或 工位名 | 切工位 |
| `⌘I` | 问 AI(已有) |

工位搜索结果示例:
- 输入 `exe` → "切到 EXECUTING 工位"
- 输入 `wrp` → "切到 WRAP-UP 工位"

### 8. `/requirements/[id]/` 默认行为

**重定向逻辑**:

```typescript
// /requirements/[id]/page.tsx
export default async function RequirementEntry({ params }) {
  const cookieZone = cookies().get('last_zone')?.value
  const targetZone = cookieZone && zonesExist(cookieZone)
    ? cookieZone
    : 'drafting'  // 默认工位
  redirect(`/requirements/${params.id}/${targetZone}/`)
}
```

**规则**:
- 默认重定向到 `drafting`(lifecycle 起点)
- cookie `last_zone` 覆盖(用户上次停留的工位)
- **永不**基于 `meta.yaml.status` 推断工位(决策 15 反对状态机)

### 9. 工位注册表

**位置**: `~/.aidevspace/zones/*.yaml`(全局,非需求级)

**v1.0 不开放 user 自定义**(只平台内置),简化架构

**13 字段集**(基于 11 轮 grilling 第 8 决策):

```yaml
# ~/.aidevspace/zones/executing.yaml
zone:
  # ──── 身份(必填 · 5 字段) ────
  id: executing                  # 唯一 ID
  name: EXECUTING                # Tab 显示名
  display_name: 执行中            # 中文显示(a11y / 工具提示)
  icon: ⚡                        # Tab 图标
  route_segment: executing       # URL 片段

  # ──── 环境(必填 · 5 字段) ────
  has_resource_tree: true        # 资源树有无(R2)
  has_inline_rail: true          # Inline 栏有无(选项 C:仅 DRAFTING/EXECUTING)
  main_layout: mission-control   # 主区布局组件名
  status_color: green            # 状态色(决策 22)
  status_pulse: false            # 是否脉动(仅 ANALYZING=true)

  # ──── 装备(必填 · 1 字段) ────
  default_arming:                # 默认 on-arming 的 Skill 列表(环境决定装备)
    - code-scaffold
    - code-review
    - test-gen
    - commit-message-draft

  # ──── AI 思考条(必填 · 1 字段) ────
  thinking_bar: required         # required | minimal | hidden(A3 全局 + 工位内容)

  # ──── 触发器(可选 · 2 字段) ────
  entry_triggers: []             # 自动进入条件,空 = 用户主动
  exit_triggers: []              # 自动退出条件

  # ──── 备注(可选 · 1 字段) ────
  description: 监督 AI 实施      # 给 AI / 工具看
```

**字段默认值表**(6 工位):

| 工位 | resource_tree | inline_rail | status_color | status_pulse | thinking_bar |
|---|---|---|---|---|---|
| DRAFTING | ✅ true | ✅ true | gray | false | required |
| ANALYZING | ❌ false | ❌ false | blue | true | required |
| CLARIFYING | ❌ false | ❌ false | purple+warn | false | required |
| DESIGNING | ⚠️ false | ❌ false | yellow | false | required |
| EXECUTING | ✅ true | ✅ true | green | false | required |
| WRAP-UP | ✅ true | ❌ false | gray | false | minimal |

**default_arming 双源叠加**(基于第 8 决策子决定 8a):
- 工位默认 on-arming 列表 + Skill 自身 `triggers:` 触发列表
- 系统去重,所有命中的 Skill 都进入 on-arming

**entry_triggers 仅允许非状态机触发**(基于第 8 决策子决定 8b):
- ✅ 允许:"AI 提问 = 触发切到 CLARIFYING"(对应决策 25)
- ❌ 禁止:"ANALYZING 完成 → 自动切到 DESIGNING"(流程方向)

---

## Consequences

### 正面

- **工位 = 独立工作台** —— 每个工位有独立的资源树 / Inline 栏 / AI 思考条内容 / 主区布局
- **Overview 概览页** —— 提供需求全貌视角,作为工位集合的"入口"
- **ZoneBar 7 Tab** —— 顶部 + Cmd+K 双通道导航,符合决策 16 状态可视化 ④
- **AI 思考条全局化** —— 决策 24 "AI 始终在场" 的视觉承诺得到强化
- **工位集合可扩展** —— 声明式注册表,以后加第 7、第 8 工位只是注册 yaml

### 负面 / 代价

- **Shell 层 2 拆掉** —— 文件结构变深 1 层,Router 配置复杂度上升
- **ZoneBar 时有时无** —— Overview 时无,工位时有,UI 跳变(可接受,GitHub PR 等先例验证)
- **6 套工位组件 + 1 套 Overview 组件** —— 工作量是 1 套布局的 7 倍(可分阶段实施)
- **工位注册表必须 v1.0 上线前完成** —— 是基础设施,延迟会导致后续返工
- **`/requirements/[id]/` 重定向有 SSR 开销** —— 需要读 cookie + 检查 zone 存在

### 风险缓解

| 风险 | 缓解 |
|---|---|
| 工位组件工作量翻倍 | 先实现 EXECUTING 一个完整工位作样板,验证后批量复制其他 5 个 + Overview |
| ZoneBar UI 跳变 | 用 100-200ms 淡入淡出过渡(Next.js `useTransition`) |
| 重定向 SSR 性能 | 用 cookie 读取 + zone 存在检查缓存,实测 < 10ms |
| 工位注册表早期变更 | v1.0 锁定字段集,变更需新 ADR |

---

## Alternatives Considered

### A. 维持 ADR-0007 不变,工位作为主区切换

- 优势:不破坏既有 shell,工作量小
- 拒绝:工位 = 独立工作台的语义丢失,Inline 栏下放 / 资源树按工位都无法实现

### B. 废除 ADR-0007 但工位不是独立路由(混合)

- 优势:折中,部分独立
- 拒绝:半独立半共享会导致 shell 拓扑更混乱,失去"工位 = 独立工作台"语义清晰度

### C. (已选) 废除 ADR-0007,工位 = 独立路由,Overview 非工位

- 优势:7 产品形态清晰分离,shell 拓扑干净,可扩展性强
- 代价:7 套组件 + 工位注册表基础设施投入

---

## 相关文档

### 设计文档

- `docs/superpowers/specs/2026-07-12-requirement-detail-page-redesign.md` — 完整调研 + 3 方案(ADR-0011 起源)

### HTML 原型(视觉对照基线)

| 文件 | 用途 | 状态 |
|---|---|---|
| [11a-stage-adaptive-draft.html](../design/pages/11a-stage-adaptive-draft.html) | DRAFTING 工位布局 | 已落盘 |
| [11b-stage-adaptive-clarifying.html](../design/pages/11b-stage-adaptive-clarifying.html) | CLARIFYING 工位布局 | 已落盘 |
| [11c-stage-adaptive-designing.html](../design/pages/11c-stage-adaptive-designing.html) | DESIGNING 工位布局 | 已落盘 |
| [11d-stage-adaptive-implementing.html](../design/pages/11d-stage-adaptive-implementing.html) | EXECUTING 工位布局(原 IMPL) | 已落盘 |
| [11e-stage-adaptive-analyzing.html](../design/pages/11e-stage-adaptive-analyzing.html) | ANALYZING 工位布局 | 已落盘 |
| [11f-stage-adaptive-archive.html](../design/pages/11f-stage-adaptive-archive.html) | WRAP-UP 工位布局(原 Archive) | 已落盘 |
| [11g-zone-tab-navigator.html](../design/pages/11g-zone-tab-navigator.html) | ZoneBar 7 Tab 导航器(本 ADR 新增) | 升级中 |
| [12-requirement-overview.html](../design/pages/12-requirement-overview.html) | Overview 概览页(本 ADR 新增) | 新写中 |

### 关联 ADR

- [ADR-0006](0006-html-prototype-as-source-of-truth.md) — HTML 原型作为视觉单一事实源
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — 需求工作台工位自适应(本 ADR 内容由其驱动)

### 被废除 ADR

- [ADR-0007](0007-workspace-route-group-shell.md) — 状态: SUPERSEDED by ADR-0012

---

## 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-12 | 初稿：基于 11 轮 grilling 会话决策,废除 ADR-0007,新写 ADR-0012 完整 shell 拓扑 | Grilling 会话 |