---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017, ADR-0018]
Supersedes: ../analyzing-doc-reader/issues/07-svg-cross-column-citation-lines.md
Implements: ADR-0018 D1/D2/D4 撤回 · D3/D4 保留
Slice: 9/8
Priority: P1
Decision-source: /grill-with-docs 2026-07-24
---

# 09 — 撤回 SVG 跨列画线渲染层(保留反向联动)

## What to build

把 [ADR-0018](docs/adr/0018-analyzing-svg-cross-column-lines.md) 的 D1(主区新增 SVG overlay 层)/ D2(位置 API + 双端坐标计算)/ D4 部分(SSR / 窄视口守卫)全部撤回;**保留 D3(反向联动 ADR-0017 D4 v2 补齐)+ D4 其余(无 v2 增强边界)**。

> **本 ticket 不做**:改 `data-product-id` 属性契约;改 `PulseRefState` 类型 union;改 `<mark>` 的 `onClick` 行为;改右栏 product 卡片 RWD 形态;改 ADR-0017 D3/D4 任何决策;改反向联动 `requestAnimationFrame` scrollIntoView 逻辑;视觉密度阈值优化;hover 联动线条。

## 决策记录(由 /grill-with-docs 2026-07-24 锁定)

11 项决策全部固定,实施时无须重复讨论:

| # | 决策点 | 锁定值 |
|---|---|---|
| Q1 | 删除范围 | **A** — 仅删 SVG 渲染层 |
| Q2 | `data-product-id` 属性 | **A1** — 保留(反向联动 `scrollIntoView` 需要) |
| Q3 | `ProductList.containerRef` prop | 保留(顺延 A1) |
| Q4 | `pulseRef` 类型 union / `onSourceRefClick` 链路 | 全部保留 |
| Q5 | `vitest.setup.ts` ResizeObserver / rAF stub | 删除(仅 CitationOverlay 用);反向联动不用 rAF stub(jsdom 自带) |
| Q6 | ADR-0018 状态 | **C1** — `Status: Deprecated` |
| Q7 | ticket 07 状态 | **D1** — `Status: wontfix` |
| Q8 | 新建跟踪 ticket | **E1** — 新建 ticket 09(本文件) |
| Q9 | git 提交策略 | **F2** — 单个新 commit |
| Q10 | PR 标题 | `feat(analyzing): 撤回 SVG 跨列画线渲染层 (ticket 09 · ADR-0018 Deprecated)` |
| Q11 | 验证清单 | `vitest run` + `tsc --noEmit`,不跑 `next build` |

## Blocked by

无前置依赖(ticket 08 已落地,可独立推进)。

## 为什么撤回

### 现状痛点(2026-07-24 复测)

ticket 07 落地后,SVG 跨列画线在主区视觉上**密度过高**:
- 10 条产物 × 平均 1.5 source_ref ≈ 15 条曲线在 2:1 视口里交织
- 行级 `<mark>` 底色 + SVG 曲线 + product 卡片左边的 🔗 数字角标,三重视觉锚点叠加 → 视觉过载
- 反向联动(点左栏 `<mark>` → 滚右栏 + pulse 1.5s)单独验证非常有用,但 SVG 持续可见曲线反而分散注意力

### 撤回范围 vs 保留范围

| 维度 | 撤回(ticket 09 删) | 保留(代码不动) |
|---|---|---|
| 视觉层 | SVG `<path>` 贝塞尔曲线、`stroke="brand-300"`、stroke-opacity 0.6 | 行级 `<mark>` 底色高亮 + pulse 1.5s |
| 数据层 | `data-product-id` × `data-testid` 选择器 | `AnalyzingChunk.source_refs` 契约(ADR-0017 D3) |
| 状态机 | `paths` 状态 + `useEffect` scroll/resize/MutationObserver 监听 | `PulseRefState` 类型 union、`pulseRef.productId` 分支 |
| 联动 | 无 | 反向联动 `handleSourceRefClick`(点左栏 span → 滚右栏 + pulse)|

### 撤回 ADR 决策

[D1] 主区新增 SVG overlay 层:撤回(D1 决策本身保留供 v2 重启参考)
[D2] 位置 API + 双端坐标计算:撤回
[D3] 反向联动(ADR-0017 D4 v2 补齐):**保留**(代码 + 决策)
[D4] 不做什么(本期边界):保留(本期边界全部成立;线条动画 / hover 联动 / 第三方库 / 触控适配 / 视觉分组 / AI prompt 改造全部仍未做)

## Acceptance criteria

### 1. 删除 `CitationOverlay` 组件

- [ ] **整文件删除** `apps/web/src/components/citation-overlay.tsx`(~447 行)
  - 验证:`git rm apps/web/src/components/citation-overlay.tsx` 后文件不存在
  - 不再被任何 import 引用(只剩 `analyzing-zone.tsx:34` import,§3 一并删除)

### 2. 删除 `CitationOverlay` 单测

- [ ] **整文件删除** `apps/web/src/components/__tests__/citation-overlay.test.tsx`(~470 行)
  - 验证:文件不存在
  - 覆盖用例自然由 ticket 03 / ticket 07 既存用例替代(行级 mark 高亮 + 反向联动各有独立测试)

### 3. 清理 `analyzing-zone.tsx` 引用

- [ ] 删除 `apps/web/src/components/analyzing-zone.tsx:34` 的 `import { CitationOverlay } from './citation-overlay'`
- [ ] 删除 `apps/web/src/components/analyzing-zone.tsx:716-721` 的 `<CitationOverlay>` JSX 渲染块
  - 同步删除包裹它的注释块(line 714-715)
- [ ] 清理 `apps/web/src/components/analyzing-zone.tsx:290` 注释中"传给 CitationOverlay 用于 SVG 端点定位"字样
  - **保留** `docPaneRef` / `productListRef` 声明本身(反向联动 `handleSourceRefClick` + `ProductList.containerRef` 仍消费)
- [ ] 验证:`grep -rn "CitationOverlay" apps/web/src` 仅命中 `<mark>` 处理和反向联动相关注释,不再出现 `import` / JSX 引用

### 4. 清理 `document-reader-pane.tsx` 注释

- [ ] `apps/web/src/components/document-reader-pane.tsx:105` 注释"CitationOverlay 据此拿到左栏容器,内部 querySelector 找 ..."改为"反向联动(ADR-0018 D3)用此 ref 查 `data-testid=\"citation-highlight\"`"
- [ ] **保留** `onSourceRefClick` prop(line 102)+ 内部实现(line 280-307)

### 5. 清理 `product-list.tsx` 注释

- [ ] `apps/web/src/components/product-list.tsx:98` 注释"CitationOverlay 据此拿到 product 卡片容器,内部 querySelector 找 `[data-product-id]`(SVG 源点定位)"改为"反向联动 `handleSourceRefClick` 用此 ref 调 `requestAnimationFrame` + `querySelector('[data-product-id]')` 滚到视野中央"
- [ ] **保留** `containerRef` prop(line 102)+ 内部 `<div ref={containerRef}>` 绑定

### 6. 清理 `vitest.setup.ts` stub

- [ ] 删除 `apps/web/vitest.setup.ts:84-101` 的 `ResizeObserver` 桩
  - 理由:仅 ticket 07 / CitationOverlay `useEffect` 间接使用;`drafting-zone.test.tsx` 在测试内独立注入 Polyfill(见 `apps/web/src/__tests__/drafting-zone.test.tsx:36-50`),不依赖全局桩
- [ ] 删除 `apps/web/vitest.setup.ts:103-119` 的 `requestAnimationFrame` 桩
  - 理由:仅 ticket 07 / CitationOverlay 的 rAF throttle 重排使用;反向联动 `handleSourceRefClick` 仍用 rAF 但 jsdom 自带 `requestAnimationFrame`(自 Node 16 / jsdom 16+),无需桩
- [ ] 验证:`grep -n "ResizeObserver\|RequestAnimationFrame" apps/web/vitest.setup.ts` 无输出

### 7. ADR-0018 状态变更

- [ ] `docs/adr/0018-analyzing-svg-cross-column-lines.md` line 3:
  - `Status: Accepted` → `Status: Deprecated`
- [ ] 同文件 line 4:
  - `Date: 2026-07-22` 保留
  - 新增 `Reverted: 2026-07-24 · Reverted-By: ticket 09` 行
- [ ] 同文件末尾"变更记录"表格新增一行:
  ```
  | 2026-07-24 | 撤回 D1/D2/D4(部分)实现;保留 D3(反向联动);详见 ticket 09 | ticket 09 (leizhuang) |
  ```
- [ ] 同文件 line 74 SVG 覆盖层示意图(`└ <CitationOverlay>`)删除该子节点;SVG overlay 段落(line 68-92)从"在本 ADR 落地"降级为"v2 重启参考"
- [ ] 同文件 §"与现有决策的关系"段:已经声明 D1/D2/D4 是 ADR-0018 独有,D3 依赖 ADR-0017 D4 — 状态变更不影响既有引用

### 8. ticket 07 状态变更

- [ ] `.scratch/analyzing-doc-reader/issues/07-svg-cross-column-citation-lines.md` frontmatter:
  - `Status: ready-for-agent` → `Status: wontfix`
  - 保留其他字段(`Type: ticket` / `Parent: ...` / `Slice: 7/7` 等)
- [ ] 同文件末尾新增"撤回说明"段落:
  ```
  ## 撤回说明(2026-07-24)

  本 ticket 在 ticket 09 中部分撤回:
  - **D1/D2/D4(部分)实现**:撤回(整文件删 citation-overlay.tsx + vitest stub 清理)
  - **D3 反向联动**:从 `analyzing-zone.tsx` 继承保留(详见 ticket 09 §"保留范围")
  - **本 ticket 状态**:改为 wontfix,作为历史决策记录保留

  若 v2 重启 SVG 跨列画线(ticket 09 §"为什么撤回"段描述的视觉密度问题解决方案),可新建 ticket 10 引用本 ticket + ADR-0018 Deprecated 状态重新讨论。
  ```

### 9. ticket 08 文档合并清理(可选)

- [ ] `.scratch/analyzing-doc-reader/issues/08-analyzing-grid-locked-height-and-independent-scroll.md`:
  - §5(line 55-59)三个 `<CitationOverlay>` 相关子任务标记 `[x]` 已完成(由 ticket 09 删除整组件顺带完成)
  - acceptance criteria 加一行 `- [x] §5 部分子任务由 ticket 09 撤回 CitationOverlay 整组件顺带完成;详见 ticket 09 §7`
- [ ] `docs/adr/0019-analyzing-grid-locked-height-independent-scroll.md`:
  - D5(line 137-139)撤回(原意是 cite-overlay 删 `mainScrollRef?` 字段;ticket 09 删整组件后 D5 自动完成)
  - §"接口漂移"表格(line 44)该行移除
  - 状态不需变更(ADR-0019 仍是 Accepted,只是 D5 子决策被外部撤回)

### 10. 验证清单

- [ ] `pnpm --filter web tsc --noEmit` 通过(无 type error)
- [ ] `pnpm --filter web vitest run` 全绿
  - 重点:行级 mark 高亮(ticket 03 ~20 用例)+ 反向联动(ticket 07 ~10 用例)+ 窄视口折叠(ticket 05 ~10 用例)全部通过
- [ ] `apps/web/src/components/__tests__/analyzing-zone.test.tsx` 现有用例无引用 `data-testid="citation-overlay"` / `data-testid="citation-overlay-line"` 残留
- [ ] `apps/web/src/__tests__/analyzing-zone-narrow.test.tsx` 现有用例无引用残留
- [ ] `apps/web/src/components/__tests__/document-reader-pane.test.tsx` 现有用例全部通过
- [ ] `apps/web/src/components/__tests__/product-list.test.tsx` 现有用例全部通过
- [ ] **不跑** `pnpm --filter web build`(避免覆盖 `apps/web/.next/` dev 缓存,见 `CLAUDE.md` Next.js dev↔build 隔离规则)
- [ ] dev server 目测:
  - 主区 2:1 布局 → 行级 mark 高亮 + 点击右栏卡片 → 切左栏 Tab + 滚 + pulse 1.5s 仍工作
  - 主区 2:1 布局 → 点击左栏 `<mark>` → 滚右栏 product 卡片 + pulse 1.5s 仍工作
  - 主区不再出现 SVG 跨列曲线
  - 窄视口(<1024px)切换不变

### 11. 提交与 PR

- [ ] **单 commit**:
  ```
  feat(analyzing): 撤回 SVG 跨列画线渲染层 (ticket 09 · ADR-0018 Deprecated)
  ```
- [ ] commit 包含(按本 ticket 顺序):
  - §1-2:删除 `citation-overlay.tsx` + `citation-overlay.test.tsx`
  - §3-5:清理 `analyzing-zone.tsx` / `document-reader-pane.tsx` / `product-list.tsx` 引用 + 注释
  - §6:清理 `vitest.setup.ts` stub
  - §7-8:ADR-0018 + ticket 07 状态变更
  - §9:ticket 08 + ADR-0019 文档合并清理
- [ ] **PR 标题**:同 commit 标题
- [ ] **PR 描述**:
  - 引用 `ticket 09` + `ADR-0018 Deprecated`
  - 简述"撤回 ticket 07 D1/D2/D4(部分)实现;保留 D3 反向联动"
  - 列出"用户影响":主区不再有 SVG 跨列视觉连线;行级 mark 高亮 + 反向联动 + 全部 ticket 03/05/07 旧测试继续通过
  - 验收清单勾选确认

## 备注 / 提示

- **vitest.setup.ts stub 清理后回归风险**:
  - ResizeObserver stub 删除 → drafting-zone.test.tsx 已经在测试内部独立注入 Polyfill(line 36-50),不依赖全局
  - rAF stub 删除 → jsdom 16+ 自带 `window.requestAnimationFrame`;反向联动 `handleSourceRefClick` 的 rAF 调用自测通过
  - 若 vitest 全量测试有失败案例,优先尝试在测试文件内部局部桩,不恢复全局 stub
- **反向联动冲突 ticket 03**:`pulseRef` 类型 union(`{ tabId, lineRange } | { productId }`)保持原状;DocumentReaderPane 用 `'tabId' in pulseRef` 守卫过滤;ProductList 用 `'productId' in pulseRef` 守卫过滤 — 不需改动
- **`data-product-id` 锚点复用**:保留在 ProductList 卡片 DOM,仅服务反向联动 `scrollIntoView`;若 v2 重启 SVG,无需新增 DOM 锚点
- **窄视口 / SSR 安全**:本期不再有 SVG overlay,无需 SSR `return null` 守卫;窄视口折叠形态(ticket 05)全部不变
- **PR review 必查项**:
  - 反向联动"点左栏 span → 滚右栏 + pulse"目测通过
  - 行级 mark 高亮目测通过
  - ticket 03 / ticket 07 旧测试 100% 通过
  - ADR-0018 状态变更 + 变更记录正确
  - ticket 07 状态变更 + 撤回说明段落正确
- **Linked tickets**:
  - ticket 03(行级 mark 高亮 + pulse)— 不变
  - ticket 04(synthetic chunk + 无出处角标)— 不变
  - ticket 05(窄视口折叠 + 全量回归)— 不变
  - ticket 06(agent emit source_refs)— 不变
  - ticket 07(跨列 SVG 画线 + 反向联动)— **wontfix**(本 ticket 改为)
  - ticket 08(grid 锁高度 + 独立滚动)— §5 子任务由本 ticket 合并完成
  - ticket 09(本文件)— **ready-for-agent**
- **Linked ADRs**:
  - ADR-0017(主区文档对照阅读器 + 6 ticket)— 不变
  - ADR-0018(跨列 SVG 画线)— **Deprecated**(由本 ticket 改)
  - ADR-0019(grid 锁高度)— 不变;D5 子决策由外部撤回
- **v2 重启路径(本期不做)**:若未来用户复测认为"持续可见的视觉锚点"是必要 UX,新建 ticket 10 引用本 ticket + ADR-0018 Deprecated,讨论视觉密度阈值(< N 条线条变细 + 透明度↓)或换画线方案(canvas / leader-line)
