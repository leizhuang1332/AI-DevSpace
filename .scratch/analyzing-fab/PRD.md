---
status: ready-for-agent
date: 2026-08-03
source: docs/adr/0022-analyzing-history-floating-action-button.md
covers: ADR-0021 决策 36 的「主区右侧 320px 永久抽屉」描述
---

# PRD · ANALYZING 历史列改为浮动召唤按钮 + 浮动面板

> **TL;DR:** 把 ANALYZING 工位右侧永久占 320px 的历史抽屉折叠为「主区右上角浮动召唤按钮 + 浮动面板」,默认折叠,主区 100% 可用,符合「克制,在场」的 AI 形态 C 心智。鼠标用户走 FAB、键盘用户走 Cmd+K,两条路径平等。

## Problem Statement

PM 在 ANALYZING 工位审视 AI 识别的 Analysis Issue 时,核心交互是「对照 PRD 阅读器 + 识别产物 Issue 卡」的两列对照。历史 Analysis Run 列表只是「偶尔用」的工具——切换 Run / 删除过时 Run / 回顾旧 Run 时才打开,平时并不需要。

但 ADR-0021 决策 36 让历史列表**永久占 320px 抽屉**,主区被恒定吃掉 12-15% 宽度,违反决策 24「不打扰,但陪伴;克制,在场」的「克制」语义。窄视口(< 1024px)下还要再加 `max-h-[200px]` 折叠条,主区布局进一步劣化,成为历史包袱。

用户的核心痛点:

- 平时不需要历史列表时,320px 抽屉仍占着,主区宽度被偷走
- 想看历史时,要么接受抽屉永远占位,要么收起后没视觉召唤(N 计数缺失)
- 删除 Run 后面板 UX 是「切走焦点」(决策 36 旧规则),与「克制在场」语义不符——更合理的语义是「保持面板打开,自动选下一个 Run」,让用户继续在「历史语境」里
- 窄视口要靠 `max-h-[200px]` 折叠条应付,体验劣化

## Solution

把历史列表从「永久 320px 抽屉」改为「**默认折叠的浮动召唤按钮(FAB)+ 浮动面板**」:

- **FAB** 浮动在主区右上角(`top: 12px; right: 12px`),显示 `🗂️ 历史分析 [N]`,N 是历史 Run 总数;默认折叠,主区 100% 可用
- **浮动面板** 在 FAB 点开后弹出,absolute 定位(`top: 48px; right: 12px`),宽度 `min(320px, calc(100vw - 24px))`,高度与 [识别产物] 列等高,内部滚动
- **面板覆盖 [识别产物] 列之上**(不挤压列宽),该列加 4% 黑色 dim 蒙层作为视觉提示,不阻断交互(non-modal popover)
- **Cmd+K 新增「🗂️ 历史分析」命令**,键盘用户走命令面板召回(决策 23 形态 C 的键盘通道)
- **关闭方式**:点外部 + Esc + ✕ + 选中 Run 自动关(四选其一都关,符合 Linear popover 心智)
- **状态不持久化**:永远默认折叠;切需求 / 切工位 / 启动新 Run 时强制收起
- **删除 UX 重新设计**:删除 Run 后留面板打开,currentRun 自动切到列表中下一个 Run(按 `created_at` 倒序的第一个非删除 Run)
- **窄视口天然兼容**:FAB 始终渲染,面板宽度自适应,无需 `max-h-[200px]` 折叠条逻辑(可删除)

FAB / Cmd+K 双通道覆盖鼠标 / 键盘两类用户,符合决策 23「形态 C:克制在场 + Cmd+K + 窄主动推送」的「克制在场」召唤范式;面板 non-modal 符合决策 24「不打扰」的「不打扰」语义。

## User Stories

### 默认折叠 + FAB 召唤

1. 作为 PM,我在 ANALYZING 工位审 Issue 时,**希望主区 100% 可用**,不被历史抽屉偷走 320px 宽度,这样 PRD 阅读器与 Issue 卡有更宽的对照视野
2. 作为 PM,我想随时知道历史上发起过几次 Analysis Run,**希望 FAB 始终显示 N 计数**,即使默认折叠也能瞥见进度
3. 作为 PM,我希望 N=0 时 FAB 仍可见(灰色 0),**不希望 FAB 消失导致忘记历史入口存在**
4. 作为 PM,我希望 N>99 时 FAB 显示 `99+`,**不希望 N 数字撑爆 FAB 宽度**
5. 作为 PM,我想点 FAB 召唤历史面板,**希望面板从 FAB 正下方弹出,清晰表达「这是 FAB 召唤的浮层」**
6. 作为 PM,我在面板里选完 Run 后想继续看 Issue,**希望面板自动关闭,主区立刻恢复全宽**
7. 作为 PM,我在面板里改主意不想看了,**希望点 FAB 外面任意位置关闭面板**
8. 作为 PM,我习惯用键盘,**希望按 Esc 关闭面板**
9. 作为 PM,我想精确关闭,**希望点面板头部右上角的 ✕ 按钮关闭**
10. 作为 PM,我想 FAB 折叠时**不显示运行中 dot**,因为「在跑」的状态由底部 AI 思考条 4 指示器统一表达,FAB 再加 dot 是重复信号

### Cmd+K 键盘通道

11. 作为键盘用户,我想用 Cmd+K 召回历史面板,**希望在命令面板搜「历史」找到「🗂️ 历史分析」命令**
12. 作为键盘用户,我希望在「🗂️ 历史分析」命令的描述里看到**当前 req id + Run 总数**,实时跟随当前 Requirement
13. 作为键盘用户,我希望点选「🗂️ 历史分析」命令后**直接打开浮动面板**(等同点 FAB),不需要再按 Enter 召唤
14. 作为键盘用户,我在 Overview 概览页也想打开面板,**希望命令在无 req 上下文时 disabled 而非乱跳**

### 删除 UX 重新设计

15. 作为 PM,我在面板里删了一个 Run,**希望面板保持打开**,继续在其他 Run 上操作
16. 作为 PM,我删除当前选中 Run,**希望焦点自动切到列表中下一个 Run(按 created_at 倒序的第一个非删除 Run)**
17. 作为 PM,我删除了最后一个 Run,**希望面板仍打开,显示 N=0 空态**
18. 作为 PM,我删除一个非选中 Run,**希望 currentRun 不变**(只更新 N 计数)
19. 作为 PM,我想删除 Run 时**仍走二次确认对话框**(避免误删)
20. 作为 PM,我删除的是运行中 Run,**希望被服务端 + UI 同时拒绝**(沿用决策 36)

### 切上下文强制收起

21. 作为 PM,我切到其他 Requirement,**希望 FAB 面板强制收起**(避免上下文混乱)
22. 作为 PM,我切到其他工位再切回 ANALYZING,**希望 FAB 永远默认折叠**(不持久化)
23. 作为 PM,我启动一次新 Analysis Run,**希望 FAB 面板强制收起**(避免与新 Run focus 抢戏)

### 窄视口响应式

24. 作为窄视口用户(< 1024px),**希望 FAB 始终渲染,不因视口窄而隐藏**
25. 作为窄视口用户,**希望面板宽度自适应 `min(320px, calc(100vw - 24px))`,不溢出视口**
26. 作为窄视口用户,**希望面板高度自适应主区高度,不强行撑高**

### a11y

27. 作为屏幕阅读器用户,我希望 FAB **通过 `aria-expanded` 同步开合状态**,而不是只有视觉变化
28. 作为屏幕阅读器用户,我希望 FAB 有清晰的 **aria-label**,告诉我「历史分析 共 N 个 Run」
29. 作为屏幕阅读器用户,我希望面板是 **non-modal region(`role="region"`)**,不是 `role="dialog"`——后者暗示模态会困焦点
30. 作为屏幕阅读器用户,我希望 Tab 焦点**可在面板与主区之间自由切换**,不阻断主区交互
31. 作为屏幕阅读器用户,我在面板里**通过 `aria-current="true"` 知道当前选中 Run**
32. 作为屏幕阅读器用户,我删除 Run 时**通过 `aria-label` 知道是删除哪个 Run**

### 视觉与互动细节

33. 作为 PM,我打开面板时**希望 [识别产物] 列加 4% dim 蒙层**,提示「现在焦点在浮层」但不阻断交互
34. 作为 PM,我看面板头部**希望标题固定,只滚动 Run 行列表**
35. 作为 PM,我看 N=0 空态**希望有 CTA 「▶ 开始分析」按钮**,引导去发起首次分析
36. 作为 PM,我看 FAB 选中态**希望背景变 brand 色**,与未选中态有视觉差

## Implementation Decisions

> 本节沉淀 ADR-0022 D1-D7 的关键决策,并标注模块边界与落地拆分。**不重复 ADR 全文,只列契约级关键点**。

### 模块改造

1. **删除** 当前 `<AnalysisHistoryDrawer>` 在 `analyzing-zone.tsx` 桌面布局里的 320px 永久挂载(`analyzing-history-col` div)
2. **删除** 当前窄视口布局里的 `max-h-[200px]` 折叠条(`analyzing-narrow-history` div 包裹)
3. **保留** `<AnalysisHistoryDrawer>` 组件本体(展开态的面板内部复用其 `HistoryRow` 渲染逻辑,不重写列表组件)
4. **新增** `<HistoryFab>` 浮动召唤按钮组件——absolute top-12 right-12,z-30,显示 `🗂️ 历史分析 [N]`
5. **新增** `<HistoryPanel>` 浮动面板组件——absolute top-48 right-12,z-40,宽度 320px(窄视口自适应),头部固定 + 列表内滚
6. **改造** `analyzing-zone.tsx` ——把 `<AnalysisHistoryDrawer>` 永久挂载改为 `<HistoryFab>` + `<HistoryPanel>` 配套,面板开关 state 留在父组件 `AnalyzingZone`
7. **改造** `command-palette.tsx` ——在 `buildAllCommands()`(或等价的「ANALYZING 上下文命令」生成器)新增「🗂️ 历史分析」命令,描述实时跟随当前 reqId 与 N 计数,action 回调触发 `AnalyzingZone` 的「开面板」接口
8. **改造** Cmd+K 的命令注册与渲染层——新增 `data-testid="cmd-history-fab"`,命令渲染为可交互 button(沿用「新建需求」的 `action` 闭包模式)

### 接口契约

9. **FAB 暴露的属性**(顶层 `AnalyzingZone` 通过 props 传入):
   - `runCount: number` —— 历史 Run 总数
   - `activeRunId: string` —— 当前选中 Run id(用于 active 视觉态)
   - `isOpen: boolean` —— 面板是否打开(用于 `aria-expanded` 同步)
   - `onToggle: () => void` —— 点 FAB 切换开合
10. **面板暴露的属性**:
    - 同 FAB 的前 3 项
    - `runs: AnalysisRunMeta[]` —— Run 列表(按 created_at 倒序,父组件已排好)
    - `skillDescriptions?: ReadonlyMap<string, string>` —— Skill 简介映射
    - `onSelect: (runId: string) => void` —— 选 Run 回调(内部调用后由父组件关闭面板)
    - `onRequestDelete: (runId: string) => void` —— 删 Run 回调(父组件弹二次确认)
    - `onClose: () => void` —— 显式关闭(FAB 外部点击 / Esc / ✕)
11. **Cmd+K「历史分析」命令的 action 契约**:
    - action 闭包接受 `(open: (panel: 'historyFab') => void, closeKey: () => void)`
    - 调用 `open('historyFab')` → 触发 `AnalyzingZone` 内部 `setPanelOpen(true)`
    - 调用 `closeKey('cmdK')` → 关闭 Cmd+K 自身(沿用「新建需求」的双调用范式,避免 React 18 batching 覆盖)
12. **`AnalyzingZone` 暴露给 Cmd+K 的接口**:通过 React context(新增 `useAnalyzingHistoryFab()`)或在 `(workspace)/requirements/[id]/analyzing/layout.tsx` 提供 `historyFabController` 实例。命令面板渲染层从这个 controller 读 `isOpen` / `open()` / `close()`。
13. **面板开合 state 的归属**:留在 `AnalyzingZone`(`useState<boolean>(false)`);切需求 / 切工位 / 启动新 Run 时父组件 unmount → state 自然重置(不持久化)
14. **删除后切下一个 Run 的判定**:放在 `AnalyzingZone` 的 `handleConfirmDelete` 内,删除成功后:
    - 关闭二次确认对话框(`setPendingDeleteRunId(null)`)
    - **不关面板**(让用户继续在面板里操作)
    - 重新计算 `currentRunId`:
      - 若被删的是当前选中 Run → 按 `created_at` 倒序取第一个非删除 Run(用 `remainingRuns[0]?.run_id ?? ''`)
      - 若被删的不是当前选中 Run → currentRun 不变,只更新 N 计数
    - 复用现有的 `userManuallySwitchedRef` 重置逻辑

### 视觉与无障碍契约

15. **FAB z-index** = 30;**面板 z-index** = 40;**Cmd+K overlay z-index** = 100(沿用现有约定)。三者由 `tailwind.config.ts` 命名约定(`z-fab` / `z-panel`),不散落魔数
16. **FAB 样式**:图标 14px + 文字 13px + N 数字 11px mono;bg-elevated 默认,bg-brand/10 active
17. **面板样式**:`width: min(320px, calc(100vw - 24px))`;高度由父 `AnalyzingZone` 容器高度减去 48px(FAB 占位);头部固定(`flex-shrink-0`)、列表 `overflow-auto`
18. **dim 蒙层**:`<识别产物>` 列加 `data-dimmed="true"` 时切到 dim 样式(`bg-black/4` ≈ 4% 黑色蒙层);`pointer-events: none` 不阻断交互
19. **a11y 属性**(详细见 ADR-0022 D6):
    - FAB:`role="button"` `aria-label="历史分析 共 N 个 Run"` `aria-expanded` `aria-haspopup="region"`
    - 面板:`role="region"` `aria-label="历史分析列表"`
    - 当前 Run 行:`aria-current="true"`
    - 删除按钮 / 锁图标:`aria-label` 描述具体 Run

### 不覆盖既有契约

20. **不重写** `<AnalysisHistoryDrawer>` 的 `HistoryRow` 内部组件——展开态的面板复用之,避免双份维护
21. **不重写** `<AnalysisDeleteRunDialog>`——仍走二次确认;只是「删除后不切走焦点」改为「删除后切到下一个 Run」
22. **不重写** SSE 事件订阅逻辑——`onRunDeleted` 已有切下一个 Run 的实现,本 ADR 不修改 SSE 契约
23. **不引入** 新组件 mount seam——所有测试沿用 `<AnalyzingZone>` 顶层 seam + `<CommandPalette>` 顶层 seam(见 Testing Decisions)

### 落地拆分(交给后续 ticket 系统)

24. **P0 核心闭环**:
    - ticket 01:`<HistoryFab>` 组件实现 + 父组件 `AnalyzingZone` 替换永久列为 FAB/面板,删除 `analyzing-history-col` 与窄视口 `max-h-[200px]` 折叠条
    - ticket 02:`<HistoryPanel>` 组件实现 + 复用 `<AnalysisHistoryDrawer>` 的 `HistoryRow` + dim 蒙层
    - ticket 03:删除 Run 后自动切下一个 Run 的 `findNextRunId` helper + 父组件改造(不关面板)
25. **P1 可发现性 + 可访问性**:
    - ticket 04:Cmd+K 命令面板新增「🗂️ 历史分析」命令(描述跟随 reqId 与 N 计数)
    - ticket 05:a11y 属性全套 + `aria-expanded` 同步 + Tab 焦点自由验证(vitest 单测)
26. **P2 兜底**:
    - ticket 06:窄视口 CSS 自适应 + 删除旧 `max-h-[200px]` 折叠条 + E2E 验证

## Testing Decisions

### 什么是好的测试

- 只测**外部行为**(用户视角:DOM 渲染、`data-testid`、`aria-*` 属性、键盘事件、点击事件),不测内部 state 名 / useEffect 顺序 / 私有闭包
- 优先通过现有顶层 mount seam 测试,不引入新 mount 点
- 数据-行为-断言三段式,失败信息能直接定位到「哪个 FAB 行为没生效」

### 模块测试范围

27. **FAB 行为**(沿用 `<AnalyzingZone>` 顶层 seam,在 `analyzing-zone-focus.test.tsx` 新增 describe):
    - 默认渲染:折叠态下 FAB 在 DOM 中(N=0 / N>0 / N>99)
    - `aria-expanded` 同步:折叠 `false` / 展开 `true`
    - `aria-label` 包含 N:`历史分析 共 N 个 Run`
    - 不显示运行中 dot
28. **面板行为**(同上):
    - 点 FAB → 面板出现 + `aria-expanded="true"`
    - 点 FAB 再点 → 面板关闭 + `aria-expanded="false"`
    - 点 FAB 外面(`document.body`)→ 面板关闭
    - 按 Esc(全局 `keydown`)→ 面板关闭
    - 点面板头部 ✕ → 面板关闭
    - 点 Run 行 → 面板关闭 + `data-active-run-id` 切到该 Run
    - 头部固定 + 列表内滚(用 jsdom 测 max-height + overflow-auto 即可,不真滚)
    - dim 蒙层:`data-dimmed="true"` 在面板展开时出现在 [识别产物] 列
    - N=0 空态:`analysis-history-empty` 文案 + 「▶ 开始分析」CTA 按钮可见
29. **删除 UX**(沿用既有 `analyzing-zone-focus.test.tsx` 的删除测试,扩展断言):
    - 删除当前选中 Run → 面板仍打开 + `data-active-run-id` 切到下一个 Run(按 created_at 倒序)
    - 删除非选中 Run → 面板仍打开 + currentRun 不变 + N 计数 -1
    - 删除最后一个 Run → 面板仍打开 + 显示 N=0 空态
    - 删除运行中 Run → 仍被拒绝(沿用现有 toast「运行中的 Run 不可删除」)
30. **切上下文强制收起**(同上):
    - 切到其他 Requirement(重新 render `AnalyzingZone` with 新 `data.requirementId`)→ 面板默认折叠
    - 启动新 Analysis Run(`handleStart` 成功)→ 面板折叠 + 焦点切到新 Run
31. **窄视口 CSS 自适应**(沿用既有 `useMediaQuery` mock):
    - 桌面 (`>= 1024px`)FAB 显示 + 面板 320px
    - 窄视口 (`< 1024px`)FAB 仍显示 + 面板宽度 = `min(320px, calc(100vw - 24px))`(可断言计算样式或截图)
32. **a11y**(沿用既有):
    - `role="region"` 而非 `role="dialog"` 在面板上
    - Tab 焦点可从面板跳到主区(用 jsdom focus 顺序断言或 Playwright 真测)
33. **Cmd+K「历史分析」命令**(沿用 `<CommandPalette>` 顶层 seam,在 `command-palette-zones.test.tsx` 新增 describe):
    - 搜「历史」→ `data-testid="cmd-history-fab"` 出现
    - 描述包含当前 reqId + N 计数(用 mockAnalyzing 上下文 mock)
    - 点选 → action 闭包触发 `open('historyFab')` + `closeKey('cmdK')`
    - 无 req 上下文(Overview 页)→ 命令 disabled(不强渲 click handler)

### 测试夹具复用

34. **沿用** `analyzing-zone-focus.test.tsx` 的 `MockEventSource` + `mockFetch` + `hasAuthCookie` mock
35. **沿用** `command-palette-zones.test.tsx` 的 `next/navigation` + `useUIOverlay` mock,扩展加入 ANALYZING 上下文 mock(controller 实例 mock)
36. **新增** 1-2 个 fixture helper(`buildHistoryFabProps({ runs, activeRunId })` + `mockAnalyzingHistoryFabController()`),降低重复样板

### 优先覆盖矩阵(P0/P1)

37. P0 ticket(01/02/03)落地时,新增的 describe 块必须 100% 覆盖对应验收项(对应用户故事 1-20 / 33-36)
38. P1 ticket(04/05)落地时,Cmd+K describe + a11y describe 必须 100% 覆盖验收项(对应用户故事 11-14 / 27-32)

## Out of Scope

- **不引入** 新 React state 库(继续用 React `useState` + `useRef`)
- **不引入** 新 UI 库(继续用 Tailwind + 项目现有 CSS 约定)
- **不重写** `<AnalysisHistoryDrawer>` 内部的 `HistoryRow` 渲染逻辑(只复用)
- **不重写** `<AnalysisDeleteRunDialog>`(沿用)
- **不修改** SSE 事件契约(`analysis_run_deleted` 已有切下一个 Run 的逻辑,本 ADR 不动)
- **不绑** `⌘⇧H` 全局快捷键(决策 29:90% 走 Cmd+K)
- **不持久化** FAB 面板开合 state(符合「克制在场」语义)
- **不动** `<CommandPalette>` 的工位搜索 / AI 提问 / 历史三个 mode(只在 `command` mode 里多挂 1 条命令)
- **不引入** 资源树形态的历史列表入口(决策 52:ANALYZING 工位无资源树)
- **不引入** Inline 栏形态(决策 53:ANALYZING 工位无 Inline 栏)
- **不展示** AI 思考条运行态(决策 91:FAB 不重复运行中 dot,运行态走思考条)

## Further Notes

### 与已有决策的兼容性

本 ADR 决策 88-98 与决策 23(AI 形态 C)/ 24(克制在场)/ 26(Cmd+K 命令面板)/ 29(快捷键 = Cmd+K)/ 43(AI 状态可见不抢焦)/ 49(StatusBar AI 区 4 指示器)/ 52(资源树按工位)/ 53(Inline 栏仅 DRAFTING/EXECUTING)全部兼容,无冲突。

### 不覆盖的既有决策

- ADR-0021 决策 36 的 **Analysis Skill / Analysis Run / Analysis Issue / Issue Response 模型** 不变
- ADR-0021 决策 36 的 **删除 Run 级联清理** 不变
- ADR-0017 决策 80-87 的 **ANALYZING 主区 2:1 左右分栏** 不变(主区结构不变,只是右侧 320px 永久抽屉改为浮动召唤)

### 关联 ADR

- [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) —— ANALYZING 主区布局(本 ADR FAB 在其主区右侧)
- [ADR-0021](docs/adr/0021-analyzing-skill-driven-analysis-runs.md) —— Analysis Run 模型(本 ADR 覆盖其决策 36 的抽屉形态)
- [CONTEXT.md](../CONTEXT.md) 决策 23 / 24 / 26 / 29 / 43 / 49 / 52 / 53 —— 全部兼容

### 原型与决策来源

- [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) —— 本 ADR 的完整 11 轮 `/grill-with-docs` 沉淀(决策 88-98)
- HTML 原型:
  - [13-analyzing-history-fold-compare.html](docs/design/pages/13-analyzing-history-fold-compare.html) —— 4 候选对比(A 永久 / B FAB+面板 / C 完全隐藏 / D 窄把手)
  - [13-B-analyzing-history-button-position.html](docs/design/pages/13-B-analyzing-history-button-position.html) —— FAB 4 位置变体对比(① ② ③ ④)

### 关键引用文件(供后续 ticket 落地时查阅,不写到决策正文)

- `apps/web/src/components/analysis-history-drawer.tsx` —— 保留复用的 `<AnalysisHistoryDrawer>` + `<AnalysisDeleteRunDialog>`
- `apps/web/src/components/analyzing-zone.tsx` —— 父组件,改造点(删 `analyzing-history-col` 永久列 + 删窄视口 `max-h-[200px]` 折叠条 + 新增 FAB/面板挂载 + 删除 UX 重设)
- `apps/web/src/components/command-palette.tsx` —— Cmd+K 命令面板,改造点(新增 `cmd-history-fab` 命令 + action 闭包接入 `historyFabController`)
- `apps/web/src/__tests__/analyzing-zone-focus.test.tsx` —— 顶层 FAB/面板/删除 UX 测试 seam
- `apps/web/src/__tests__/command-palette-zones.test.tsx` —— 顶层 Cmd+K 命令测试 seam