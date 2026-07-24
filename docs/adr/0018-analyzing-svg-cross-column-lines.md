# ADR-0018: ANALYZING 工位跨列 SVG 画线(原生 overlay + 双向联动)

**Status:** Deprecated
**Date:** 2026-07-22
**Reverted:** 2026-07-24 · Reverted-By: ticket 09 · Reversal-Reason: 视觉密度过载(10 产物 × 1.5 source_ref ≈ 15 条曲线在 2:1 视口交织)
**Deciders:** 项目负责人(经 `/grill-with-docs` 共识)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 15, 23, 36, 52, 53
**关联 ADR:**
- [ADR-0017](0017-analyzing-main-document-reader.md) — D3/D4 行级高亮 + pulse 联动;本 ADR 在其基础上**补充** v2 SVG 跨列视觉连接
- [ADR-0013](0013-analyzing-zone-rewrite.md) — ANALYZING 工位重设计(本 ADR 继承其布局契约)
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — 工位自适应(本 ADR 兼容其 §5 工位-资源树对应表)

**覆盖/补充:**
- **补充** ADR-0017 D3/D4 v2 增强:跨列 SVG overlay + 反向联动(点左栏 span → 滚右栏 product 卡片)
- **不覆盖** ADR-0017 D1 / D2 / D5 / D6 任何决策;ticket 03 行级高亮 + pulse 全部保留
- **不覆盖** ADR-0013 D1 / D3 / D4 / D5 / D6 / D7-D15 任何决策

---

## Context

### 起点

ADR-0017 当初拍板的"画线关联"在 ticket 03 落地形态是**左栏阅读器对 source_refs span 加行级底色高亮 + 点击右栏 product 卡片 → 滚动 + pulse 1.5s**。

落地后用户(2026-07-22 `/grill-with-docs`)反馈痛点:

> "预期都实现了,但是还是没有渲染连线,我想要有一根线把识别产物和目标连接起来,这样看起来更直观"

痛点本质:**行级底色高亮 + 1.5s pulse 是**空间上的**高亮闪烁,不是**空间上的**视觉连线。用户视线在右栏卡片和左栏 PRD 行之间跳转时,缺乏"这俩是一对"的**持续可见**的视觉锚点**。

### 真实场景(决定性输入)

产品 PM 在 ANALYZING 工位审视 10 条 AI 识别产物(子问题 / 风险 / 方案)时:

1. 当前形态:每个产物卡片右边有 🔗 按钮 → 点击后左栏滚到对应行 + 行级高亮闪烁 1.5s
2. 期望形态:**右栏卡片 → 一根可见的曲线 → 连接到左栏对应 PRD 行;持续可见;hover/click 双侧都能联动**

类比:思维导图(mind map)/ 类脑图(spider chart)的视觉连接,不是 hover-only 的 tooltip。

### 与 ADR-0017 D3/D4 的关系

| 维度 | ADR-0017 D3/D4(本期) | 本 ADR v2 增强 |
|---|---|---|
| 视觉锚点 | 左栏行级底色(brand-50) | + 跨列 SVG 曲线(brand-300, stroke-opacity 0.6) |
| 持续可见 | ❌ pulse 1.5s 后变回静态 | ✅ 持续可见 |
| 反向联动 | ❌ 显式声明"本期不实现" | ✅ 左栏 span click → 滚右栏 product 卡片 + pulse |
| 实现技术 | `<mark>` 行级高亮 + CSS pulse | + 原生 `<svg>` overlay(零依赖)+ 位置 API |

**为什么当初 ADR-0017 不做 SVG**:
- 落地复杂度高(DOM 坐标计算 + 滚动/resize 监听 + 窄视口折叠处理)
- 行级高亮 + pulse 已能承载"产物 ↔ 原文"核心诉求
- 用户接受过当时形态(11 轮 grilling 共识)

**为什么现在追加**:
- 用户实际使用后,认为"持续可见"的视觉锚点是必要补充
- ticket 03 已落地稳定,SVG overlay 可在其基础上增量加
- 零依赖(原生 SVG)把工程成本压到最小

---

## Decision

通过 `/grill-with-docs` 共识,沉淀 D1-D4 决策:

### D1 · 主区新增 SVG overlay 层(原生,零依赖) — **Deprecated · ticket 09 撤回**

**原文**:在 ANALYZING 工位**主区**新增一个 SVG overlay 层,作为 `<DocumentReaderPane>` + `<ProductList>` 的兄弟节点,**不嵌入任一栏**。

**2026-07-24 ticket 09 撤回**:SVG overlay 层落地后视觉密度过载(10 产物 × 1.5 source_ref ≈ 15 条曲线在 2:1 视口交织),撤回整文件 `citation-overlay.tsx` + 测试 + vitest stub。本 ADR 降级为 Deprecated,D1 决策保留作为 v2 重启参考(届时可新建 ticket 10 重新讨论视觉密度阈值 / 替代画线方案)。

**v2 重启时的形态参考**(本期未实现):
```
<AnalyzingZone>
  ├ <DocumentReaderPane>      ← 左栏(已有,ADR-0017 D2)
  ├ <ProductList>             ← 右栏(已有,ADR-0013 D2 ③)
  └ <CitationOverlay>         ← v2 重启时再引入,SVG 覆盖层
     └ <path d="M ... C ..." />
</AnalyzingZone>
```

**SVG overlay 关键属性**:
- 绝对定位:`position: absolute; inset: 0;`(覆盖主区视口)
- `pointer-events: none`(线条本身不响应点击,事件穿透到下层卡片/span)
- `<svg>` 元素 `width: 100%; height: 100%`,`viewBox` 跟随主区视口
- 每个 `source_ref` 对应一条 `<path>`(SVG 三次贝塞尔曲线,从 product 卡片中心 → `<mark>` 高亮 span 中心)
- 样式:stroke `brand-300`,`stroke-width: 1.5`,`stroke-opacity: 0.6`,`fill: none`
- 颜色统一:不区分 product 类型(subproblem/risk/option)—— 一律同色,避免视觉过载

**多重 source_ref 行为**:
- 同一 product 卡片有 N 个 source_ref → N 条独立 SVG path,共享源点(product 卡片中心),不同终点(各自 `<mark>`)
- 同一 source_ref 被 N 个 product 引用 → 当前实现一个 chunk 一条 source_ref,不出现"共享终点"场景

### D2 · 位置 API(双端坐标计算)

两端坐标通过 `getBoundingClientRect()` 在 `useEffect` 里计算。

**product 卡片端**:
- `<ProductList>` 卡片 DOM 加 `data-product-id="<chunk.id>"`(对齐 SSR 注入的 `AnalyzingProductItem.id`)
- ProductList 用 ref 回调或 `useRef` 收集所有 product DOM 节点
- 在 SVG overlay 父组件统一持有 `Map<productId, DOMRect>` 状态

**PRD 行 span 端**:
- `<mark>` 已有 `data-line-start` / `data-line-end` / `data-tab-id`(ticket 03 落地)
- SVG overlay 用 `document.querySelector` 在 SVG 父组件中按当前 active Tab 拿 spans
- 持有 `Map<tabId:lineRange, DOMRect>`

**重算触发**(避免手动同步坐标):
- `resize` 事件(window resize + 浏览器 devtools 切换)
- `scroll` 事件(主区整体 + 左栏阅读区 body + 右栏产品列表 body,各自滚动独立监听)
- `MutationObserver` 监听 product 卡片 / mark span 增删(切 Tab / 联动 pulse / synthetic chunk 加减)
- `requestAnimationFrame` throttle:scroll/resize 高频时合并到下一帧

**降级**:
- 主区视口外(spans 在阅读区折叠下方) → SVG path 端点 clamp 到视口边界(避免线条飞出)
- product 卡片被右栏折叠/隐藏 → SVG path 跳过(不画)

### D3 · 反向联动(ADR-0017 D4 v2 补齐)

**原文**:补齐 ADR-0017 D4 当时显式声明"本期不实现"的反向联动。

**左栏 `<mark>` 行为扩展**(tickets 03 hover-only → ticket 07 + click):
- 保留 ticket 03 已有 hover tooltip(N 个产物引用此段)
- **新增** click 行为:点 `<mark>` → 找到对应 source_ref → 找到对应 product 卡片 → `scrollIntoView({block: 'center'})` + 右栏 product 卡片 pulse 1.5s
- 实现复用 ticket 03 已有 `pulseRef` 状态机 + `animate-pulse-brand` class

**右栏 product 卡片行为扩展**(tickets 03 click → ticket 07 双向):
- 保留 ticket 03 已有"click → 切左栏 Tab + scroll + pulse"行为
- **新增** "被左栏 span click 触发" 路径,通过 props 传 `pulseRef.productId` 进入 ProductList

**多 source_ref 卡片**:
- 点 `<mark>` → 定位到该 source_ref 对应的 product 卡片(scroll + pulse),不是"循环所有 source_ref"
- 一条 `<mark>` 对应一个 source_ref(ADR-0017 D3 的 lineRange 指向唯一性),所以 1:1 映射

### D4 · 不做什么(本期边界)

- ❌ **线条动画**(流入/流出/hover 闪烁)
- ❌ **hover product 卡片高亮对应线条**(留 v2 增强)
- ❌ **第三方画线库**(leader-line / react-flow;原生 SVG,零依赖)
- ❌ **触控/移动端适配**(桌面优先;窄视口 ticket 05 已折叠为顶部 Tab 切换,SVG overlay 在窄视口下**不渲染**)
- ❌ **多 ref 共享源点的视觉分组**(N 条独立线即可,不分组配色)
- ❌ **AI prompt 改造**(ticket 06 已落地 `source_refs` 输出,本 ticket 不再动 agent 端)

---

## 工位主区布局(增量,叠加 ADR-0017)

```
ANALYZING 工位主区(顶到底,SVG overlay 增量):
┌──────────────────────────────────────────────────────────┐
│ Stage strip / Toolbar / Admission / SessionTabs / TechBrief  保留
├──────────────── 2 份 ──────────────┬─── 1 份 ────────────┤
│ 📑 DocumentReaderPane              │ 🎯 ProductList       │
│ [PRD · 🔗 3] [aux-api · 🔗 2]      │                      │
│                                    │ 📌 子问题            │
│ ## 退款功能优化                    │  [Q1 ⚠️ 无出处]      │
│                                    │  [Q2 🔗 1]   ←───────┐
│ 退款单笔金额上限 ≤ 1000 元 ▓▓      │                      │\
│       ↑ <mark> 高亮 span           │ ⚠️ 风险点            │ \
│       │                            │  [R1 🔗 1]   ←───────┐ \
│       └──── SVG path (右栏→左栏)   │                      │  ├─ SVG overlay
│                                    │ 🎨 方案方向          │  │  跨列连线
│ [...]                              │  [A 🔗 1]   ←───────┐ │  │  (D1)
│                                    │                      │ │ │
│                                    │ [B 🔗 1]   ←───────┐ │ │ │
│                                    │                      │ │ │ │
├────────────────────────────────────┴──────────────────────┴─┴─┤
│ 💬 插话输入条 / AI 思考条                              保留  │
└──────────────────────────────────────────────────────────┘
```

**关键视觉差异**:
- ADR-0017(本期):左栏 `<mark>` 行级底色;🔗 按钮点击触发 scroll + pulse
- ADR-0018 v2(本 ADR):**右栏 product 卡片 → 一根 SVG 曲线持续连接到左栏 `<mark>`**;hover/click 双侧联动

---

## 与现有决策的关系

### 补充 ADR-0017 D3 / D4

| 原 ADR-0017 D3/D4 | 本 ADR 增强 |
|---|---|
| D3 `source_refs` 数据契约 | 不变(本 ADR 复用 `SourceRef` discriminated union) |
| D3 行级底色高亮 | 不变(本 ADR **不替换**,在 ticket 03 `<mark>` 之上加 SVG overlay) |
| D4 click product → 左栏联动 | 不变 |
| D4 "点左栏 span → 不联动右栏"(本期不实现) | **本 ADR D3 补齐:点左栏 span → 滚右栏 product 卡片 + pulse** |

### 兼容 ADR-0013 D1 / D2 / D7

- 主区布局 2:1 不变(ADR-0017 D1 已覆盖 ADR-0013 §工位主区布局)
- ProductList 在右栏 1 列形态不变
- D7 多会话切 Tab → SVG overlay 在新 active session 的 chunks 上重画(已覆盖)

### 兼容决策 23 / 36 / 52 / 53

- 决策 23(取消右栏常驻):✅ 兼容(SVG overlay 是主区内覆盖层,非常驻)
- 决策 36(markdown 为唯一真相源):✅ 兼容(SVG overlay 不引入新数据源,纯渲染层)
- 决策 52(资源树按工位):✅ 兼容
- 决策 53(Inline 栏仅 DRAFTING/EXECUTING):✅ 兼容

---

## Consequences

### 正面

- **跨列视觉锚点** —— 一眼看到产物 → 出处的物理连线,UX 直观度大幅↑
- **零依赖** —— 原生 SVG,无第三方包负担(bundle 体积 +0)
- **可降级** —— SVG overlay 渲染失败时(SSR / hydration mismatch / 浏览器旧版本 / 单元测试环境)产品功能不受影响(行级高亮 + scroll 联动仍在)
- **复用 ticket 03** —— `<mark>` 的 `data-line-start` / pulse 机制不重写,反向联动复用 `pulseRef` 状态机
- **可演进** —— v2 加 hover 高亮对应线 / 线条流入动画都不破坏本期结构

### 负面 / 代价

- **DOM 坐标计算开销** —— `getBoundingClientRect` 在 scroll/resize 高频触发,需要 `requestAnimationFrame` throttle
- **测试复杂度↑** —— 需要 mock `ResizeObserver` / `IntersectionObserver`;vitest jsdom 限制要单独处理(只在 `useEffect` 里访问 DOM)
- **窄视口(<1024px)** —— 当前 ticket 05 已折叠为顶部 Tab 切换;SVG overlay 在窄视口下**不渲染**(避免视觉错乱;窄屏本来就没 2 列布局)
- **视觉密度风险** —— 10 条产物 × 平均 1.5 source_ref = 15 条线;视觉可能拥挤;D4 加密度阈值(> N 条时仅显示 active ref),留 v2 优化
- **Z-index 管理** —— SVG overlay 必须在所有主区元素之上,但 `pointer-events: none` 不能挡 click —— 需正确设置 z-index + pointer-events 组合

### 风险缓解

| 风险 | 缓解措施 |
|---|---|
| `getBoundingClientRect` 高频调用性能 | `requestAnimationFrame` throttle;scroll listener `passive: true` |
| SSR/hydration mismatch | SVG overlay 仅 client component;SSR 期 `return null`(占位) |
| 浏览器旧版本不支持 `ResizeObserver` | 项目早就是 ES2020+,主流浏览器都支持;vitest jsdom 桩 mock |
| 视觉密度过载 | 引入密度阈值:同一 `<mark>` 被引用次数 ≥ N 时线条变细 + 透明度↓ |
| Z-index 错乱 | SVG overlay `z-index: 10`(高过 product 卡片 box-shadow,但 `pointer-events: none` 不挡 click) |
| 反向联动冲突 ticket 03 | 复用 `pulseRef` 状态机,ProductList 接 `pulseRef.productId`(D3);单测覆盖 |

---

## Alternatives Considered

### A · 维持行级高亮 + pulse(不新增 SVG)

- 优势:零返工
- 拒绝:用户明确要求"一根线",纯行级高亮 + pulse 不够直观

### B · Canvas overlay

- 优势:性能略优(尤其大量线条)
- 拒绝:点击 hit-test 难做、API 比 SVG 复杂;本期线条数量 < 30,SVG 完全够用

### C · 第三方库 leader-line / react-flow

- 优势:开箱即用
- 拒绝:依赖包 + 主题难对齐 + bundle 体积 +20~50KB;原生 SVG 可控性最高

### D · hover-only 浮动 tooltip 替代 SVG

- 优势:零坐标计算
- 拒绝:用户要求"持续可见",hover-only 仍不直观

### E · (已选) 原生 SVG overlay + 双向联动

- 优势:零依赖 / 持续可见 / 反向联动补齐 ADR-0017 D4 v2
- 代价:DOM 坐标计算 + 滚动/resize 监听 + 测试 mock 复杂度↑

---

## 落地 Issue

落到 `.scratch/analyzing-doc-reader/issues/07-svg-cross-column-citation-lines.md`(新建 ticket 07),引用本 ADR。

**优先级**:
- P1(增强型):核心闭环已由 ticket 03 行级高亮 + pulse 承载,本 ADR 是 UX 增强

**前置依赖**:
- ticket 03 落地完成(`<mark>` data-line-start / pulseRef 状态机)
- ticket 05 落地完成(窄视口折叠)

**后续 v2 候选**(本期不做):
- 线条 hover 闪烁
- 线条流入/流出动画
- 密度阈值(< N 条时变细 + 透明度↓)
- 触控/移动端适配

---

## 相关文档

### 用户故事与决策

- 本 ADR 由 `/grill-with-docs` 共识沉淀(2026-07-22)
- 用户原始痛点:"识别出的风险点 Q3 我想确认是 PRD 哪段话导致的" → ADR-0017 落地 → 用户复测:"预期都实现了,但是还是没有渲染连线,我想要有一根线把识别产物和目标连接起来,这样看起来更直观"

### 关联 ADR / Issue

- [ADR-0017](0017-analyzing-main-document-reader.md) D3/D4 — 本 ADR 父 ADR
- [ADR-0013](0013-analyzing-zone-rewrite.md) D2 ③ / D7 — 工位重设计
- [CONTEXT.md](../CONTEXT.md) 决策 23 / 36 / 52 / 53 — 全部保留

### 现有 ticket 延续

| ticket | 本 ADR 范围 |
|---|---|
| 01-foundation-data-model | 不变(数据契约) |
| 02-document-reader-pane | 不变(主 UI) |
| 03-source-citation-rendering | **复用** `<mark>` data-line-start + pulseRef 状态机 |
| 04-synthetic-chunk-handling | 不变(synthetic chunk 也走 SVG 线条;无 source_ref 时不画线) |
| 05-narrow-viewport-and-tests | 兼容(窄视口下 SVG overlay 不渲染) |
| 06-ai-prompt-emit-source-refs | 不变 |

---

## 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-22 | 初稿:基于 `/grill-with-docs` 共识,新增 SVG 跨列 overlay + 反向联动,补充 ADR-0017 D3/D4 v2 | Grilling 会话 |
| 2026-07-24 | 撤回 D1/D2/D4(部分)实现;保留 D3(反向联动);视觉密度过载 → ticket 09 删除 CitationOverlay 整组件;ADR 降级为 Deprecated,保留供 v2 重启参考 | ticket 09 (leizhuang) |