# ADR-0007: workspace shell 三层 route group + 键盘监听归属

> ⚠️ **SUPERSEDED by [ADR-0012](0012-requirement-workbench-shell-topology.md) · 2026-07-12**
>
> 本 ADR 的核心拓扑(`(workspace)/requirements/[id]/layout.tsx` shell 层 2 = 资源树 + Inline 栏)被 11 轮 grilling 会话推翻。资源树 / Inline 栏下放到工位专属 shell,新增 Overview 概览页,ZoneBar 7 Tab 接管详情路由导航。
>
> **保留本 ADR 作 v1.0 探索存档**,新模型见 [ADR-0012](0012-requirement-workbench-shell-topology.md) + [ADR-0011](0011-requirement-workbench-zone-adaptive.md)。

**Status:** Superseded by [ADR-0012](0012-requirement-workbench-shell-topology.md)
**Date:** 2026-07-09 (original) · 2026-07-12 (superseded)
**Deciders:** 项目负责人

## Context

仓库 12 个 HTML 视觉稿已经定稿（[`docs/design/pages/01..12-*.html`](docs/design/README.md) + 3 个 overlay）。它们的 chrome 共享规律是：

- **StatusBar（sticky 顶部，40+32=72px）**：跨全部 12 页常驻
- **Sidebar（56px 宽，6 入口）**：跨全部 12 页常驻
- **Cmd+K overlay（backdrop + palette）**：跨全部 12 页常驻，且键盘 `Cmd+K` 触发；同样常驻的还有 `Cmd+N`（新建需求）、`Cmd+/`（快捷键速查）
- **资源树（240px，左侧）**：只出现在 `03–07` 需求详情组
- **Inline 提示栏（120px，右侧，默认折叠）**：只出现在 `03–07` 需求详情组
- **`/dev/*`**：现状已是 dev 自检 group（[apps/web/src/app/dev/tokens/layout.tsx:7](apps/web/src/app/dev/tokens/layout.tsx#L7) 在 prod `notFound()`）

而 [apps/web/src/app/layout.tsx](apps/web/src/app/layout.tsx) 是单裸 `<html><body>` + ThemeProvider 结构，没有任何 chrome 复用机制。

约束：

1. **不能复 12 份 chrome**——StatusBar / Sidebar / Cmd+K overlay 重复 12 次工程上灾难，且 Cmd+K listener 重挂会反复消耗。
2. **不能污染 dev 页面**——`/dev/tokens` 是开发者自检页，必须完全没有 StatusBar/Sidebar 与 Cmd+K 触发。
3. **不能丢失 Next.js 静态嵌套优化**——`grid-template-columns: 240px 1fr 120px` 三栏壳 + 资源树 React state（Scroll/cursor）需要在子路由切换（03→04）保留。
4. **Cmd+K 监听器归属有真选择**：放根 layout 误触发 dev / 放 (workspace) layout 精确 / 拆到每个产品页反人类。

## Decision

**三层 route group / layout 嵌套结构**：

```
app/
├── layout.tsx                              # 根：<html><body> + ThemeProvider + global error boundary
│                                          # （不挂任何 chrome，只为 Nesting 提供平台）
├── (workspace)/                            # 产品 group（不占 URL）
│   ├── layout.tsx                          # ① StatusBar + Sidebar
│   │                                      # ② Cmd+K / Cmd+N / Cmd+/ 键盘监听（useEffect 装拆）
│   │                                      # ③ 三个 overlay portal（命令面板/新建弹窗/快捷键速查）
│   ├── page.tsx                            # /  → 01 Dashboard
│   ├── requirements/
│   │   ├── page.tsx                        # /requirements  → 02 列表
│   │   └── [id]/
│   │       ├── layout.tsx                  # ① 资源树（左 240px）
│   │       │                               # ② Inline 提示栏（右 120px，默认折叠）
│   │       ├── page.tsx                    # /requirements/:id            → 03 workspace
│   │       ├── repos/page.tsx              # /requirements/:id/repos      → 04
│   │       ├── artifacts/page.tsx          # /requirements/:id/artifacts  → 05
│   │       ├── history/page.tsx            # /requirements/:id/history    → 06
│   │       └── settings/page.tsx           # /requirements/:id/settings   → 07
│   ├── repos/{page.tsx,[name]/page.tsx}    # 08–09
│   ├── knowledge/page.tsx                  # 10
│   ├── skills/page.tsx                     # 11
│   └── settings/page.tsx                   # 12
└── dev/                                    # dev 自检 group（现状保留，prod notFound）
    ├── layout.tsx
    └── tokens/page.tsx                     # 现有 + 后续 /dev/health 等可加
```

**键盘监听器归属** = `(workspace)/layout.tsx`：

- 用 `'use client'` 的事件桥组件（如 `<KeyboardBridge />`）挂在 `(workspace)/layout.tsx` 内
- 进入产品页自动装 / 离开产品页（导航去 dev/）自动拆
- `Cmd+K` → 触发命令面板 state / `Cmd+N` → 新建需求弹窗 / `Cmd+/` → 快捷键速查
- overlay 用 React Portal 挂到 `<body>`，避免被 (workspace) 的 overflow 影响

**子路由切换 state 保留 = 第二层 (workspace)/requirements/[id]/layout.tsx**：

- 资源树 + Inline 提示栏 React state 写在第二层 layout
- 03 ↔ 04 切换不会重新 mount 这一层，scroll / cursor / 折叠态等保留
- 离开详情组（02 → 列表）才卸载

**实施同步规则**：路径与 HTML 视觉稿 1:1，命名一致（如 `apps/web/src/app/requirements/[id]/artifacts/page.tsx` 对应 `docs/design/pages/05-requirement-artifacts.html`）。

## Consequences

### 正面

- 共享 chrome 写一次（StatusBar / Sidebar / 键盘监听 / overlay）= 12 页不再重复。
- dev 自检组完全不受产品 chrome 污染，prod 构建被现有 notFound 排除。
- Next.js 路由组允许共享 layout 而不污染 URL（(workspace) 不出现在 URL），符合 docs/design/README 路由映射。
- 子路由切换（03 → 04）保留资源树 + Inline 提示栏 state，符合 Linear / VSCode Explorer 类的"切换不丢状态"期望。
- 静态嵌套优化与 route prefetch 完整保留（Next.js 14 App Router 一等公民用法）。

### 负面 / 代价

- 三层 layout 抽象学习成本：新进 agent 必须理解 `(workspace)` 不在 URL 内、与 dev group 是平级隔离。
- StatusBar / Sidebar 内容需要数据源（当前活跃需求集合、当前路径）—— 这是数据流抽象的引入点（`useWorkspaceTabs()`、`useCurrentPath()` 等 hooks 抽象时机需后续 spec）。
- (workspace)/layout.tsx 是 `'use client'`（因键盘监听），但其内部可继续 RSC 子树包裹。

### 拒绝方案的理由

- **不分 group，每个 page.tsx 写 StatusBar**：12 份重复，listener 重复重挂。
- **单 (workspace) layout 用 pathname 条件渲染资源树**：失去 layout 静态嵌套优化；React state 在子路由切换全重 mount，scroll / cursor 丢失。
- **Cmd+K 监听放根 layout**：dev 页面按 Cmd+K 应不响应，但放根 layout 必须写脏分支检查；放 (workspace) 自动正确。
- **不分层，全挂 (workspace) 三栏**：列表 / Dashboard / 仓库 / 知识库等不需要资源树，layout 全挂会强制多出空 div。
- **每个一级入口独立 group**：除重复 chrome 无收益。

## Alternatives Considered

- **Context Provider 替代 layout 嵌套**：不合 React 根组件契约，且放弃 RSC。
- **把 StatusBar / Sidebar 抽成 `<Chrome>` 组件、各 page.tsx 自行挂**：跟不分 group 是同一类痛；listener 与 overlay 还需自己组织。
- **`(workspace)` 命名换成 `(app)` 或 `(site)`**：仅命名差异，本 ADR 锁 `workspace` 跟 CONTEXT.md "Workspace" 术语对齐。
