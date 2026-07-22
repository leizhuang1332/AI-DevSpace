# ADR-0019: `analyzing-grid` 锁高度 + 左右两栏独立滚动(契约显式化 + 死代码清理)

**Status:** Accepted
**Date:** 2026-07-22
**Deciders:** 项目负责人(经 `/grill-with-docs` 共识,8 轮)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 15, 23, 52
**关联 ADR:**
- [ADR-0017](0017-analyzing-main-document-reader.md) — D1 桌面 2:1 主区布局;本 ADR 在其基础上**强化**为"锁高度 + 独立滚动"契约
- [ADR-0018](0018-analyzing-svg-cross-column-lines.md) — D2 跨列 SVG 画线监听器清单第 ② 项"主区整体滚动"在本 ADR 撤销;其余不动
- [ADR-0013](0013-analyzing-zone-rewrite.md) — ANALYZING 工位重设计(本 ADR 继承其布局契约)

**覆盖/补充:**
- **补充** ADR-0017 D1:把"2:1 左右分栏"的隐式滚动行为**显式化为契约**(外层 `overflow-hidden`、列 `overflow-hidden`、内部 body 自滚)
- **撤销** ADR-0018 D2 重算触发清单第 ② 项"主区整体滚动":B 路径下主区不再滚动,这项监听无对象
- **撤销** ADR-0018 props 接口 `mainScrollRef?: RefObject<HTMLElement | null>`:B 路径下 caller 无可传
- **拆** ADR-0017 ticket 03 实现的"主区滚动位置 sessionStorage 持久化":B 路径下 scrollTop 恒为 0,死代码;下游引用全部回退
- **不覆盖** ADR-0017 D2 / D3 / D4 / D5 / D6 任何决策(Tab 栏、Markdown 渲染、行级高亮、pulse 联动、synthetic chunk、窄视口折叠)
- **不覆盖** ADR-0018 D1 / D3 / D4 任何决策(SVG overlay 形态、双端坐标、reverse 联动)

---

## Context

### 起点

ADR-0017 D1 落地后(2026-07, ticket 02),ANALYZING 工位桌面形态采用 **2:1 左右分栏** 布局:
- 左栏 = `<DocumentReaderPane>`(Tab + Markdown body,内部 `overflow-auto`)
- 右栏 = Summary + `<ProductList>`(Summary 顶部固定,ProductList body 内部 `overflow-auto`)
- 外层 `<div data-testid="analyzing-main" className="flex-1 overflow-auto ...">` 套着整个 grid(原本意为"内容超出时外滚")

落地后用户(2026-07-22 `/grill-with-docs`)反馈诉求:

> "analyzing-grid 组件整体要有固定高度,内容超出了支持滚动条滚动查看,左右两栏滚动条独立"

### 痛点:隐式行为没有被契约锁住

从代码层面核对后,**几乎所有用户感知到的诉求今天在隐式行为下已成立** —— 但**没有任何契约标记**这一保障:

| 维度 | 现状(隐式) | 隐患 |
|---|---|---|
| 外层滚动 | `analyzing-main` 的 `overflow-auto` 在 `flex-col flex-1` 组合下 **事实上从不触发**(sibling InterjectInput/alerts 为 auto 高度,总高 = 父容器高度) | 看起来是"外层会滚",**实际几乎无意义**;将来若有人塞大 sibling(例如 alerts 堆到 5 条)外层会突现滚动,破坏"两栏独立"心智 |
| 两栏内部滚动 | DocumentReader.body / ProductList.body 各自 `overflow-auto`,**确实两栏独立** | 列容器本身 `overflow-visible`,**未显式 `overflow-hidden` 兜底** —— 风险是:哪天有人把 DocumentReaderPane 改成不带内部 overflow,左栏内容会溢出列、撞右栏 |
| 死代码 | `mainScrollRef` + `scrollStorageKey` + `handleSwitchSession` 内两条 try 块在跑,scrollTop 始终 0 | **死代码 + 在 JSDoc 撒谎**:第 92 行写"主区滚动位置按 sessionStorage 持久化",实际读不到非零值 |
| 接口漂移 | `<CitationOverlay mainScrollRef={mainScrollRef}>` 在传一个永远不滚的 ref | 接口承诺了一个不会再被消费的能力 |

### 真实场景(决定性输入)

产品 PM / 工程师 / 设计,在 ANALYZING 工位遇到以下任一情况时,会暴露契约薄弱:

1. **多 alert 触发**:某次后端返回了 `interjectError + productError` 同时存在,sibling 高度叠加 → 网格高度被压扁,而非预期"网格保持满高 + InterjectInput 跟随"
2. **窄视口切 Tab 时**:NarrowLayout 在产品 PRD 超长场景下,Tab 栏与 body 之间的视觉隔离不显式,依赖 JSX 顺序偶然不出滚动条
3. **接手人改 CSS 时**:`analyzing-main` 的 `overflow-auto` 看似"主滚动器",有人会基于它做"滚到产物"等联动,实际上主滚动永不触发,逻辑陷阱

用户的诉求:把这些"碰巧成立"显式化为契约 —— **grid 锁高度 / 左右独立滚动明确无误**,同时把相关死代码清理。

### 与 ADR-0017 / ADR-0018 的关系

| ADR-0017 / 0018 决策 | 本 ADR 处理 |
|---|---|
| ADR-0017 D1 "2:1 桌面布局" | **承接并加固**:在原 2:1 基础上加锁高度 + 列级 `overflow-hidden` |
| ADR-0017 "主区滚动位置按 sessionStorage 持久化"(ticket 03 验收 #5) | **撤销**:持久化 read/write 一并删除,因为 B 路径下 scrollTop 恒为 0 |
| ADR-0018 D2 "重算触发清单第 ② 项主区整体滚动" | **撤销该项**:B 路径下无对象可监听;其余(resize / left&right body scroll / MutationObserver)保留 |
| ADR-0018 props `mainScrollRef?: RefObject<HTMLElement \| null>` | **删字段 + 删监听器 + 删 caller 调用**:B 路径下 caller 无对象可传 |
| ADR-0018 D1 SVG overlay 形态 | 不动 |
| ADR-0018 D3 反向联动 | 不动 |

**为什么是独立 ADR 而不是补 ADR-0017 D7**:

- ADR-0017 是 ticket 02 当初立项时拍的 6 决策(D1~D6);**本 ADR 是另一个时间点的独立决策**(锁外层 + 删死接口),与原 D1~D6 在"决策时间点"上并列,**不属于"补 D7 范畴"**
- 与 ADR-0018 的"补充 / 撤销" 模式同族,文件级 diff 看得出"它是从哪个时间点立项的"
- ticket 08 frontmatter `Related-ADRs: [ADR-0017, ADR-0018, ADR-0019]` 一行把契约出处说清

---

## Decision

通过 `/grill-with-docs` 8 轮共识,沉淀 D1-D5 决策:

### D1 · 主区外层锁外(`analyzing-main` 改为 `overflow-hidden`)

**原文**:`analyzing-main` 外层节点 className 从 `flex-1 overflow-auto px-6 py-6 flex flex-col gap-5` 改为 `flex-1 min-h-0 overflow-hidden px-6 py-6 flex flex-col gap-5`。

- 含义:**主区整体不再滚动** —— 这个层级的高度由 `<main>` 的 `h-full` 减去上方固定条(StageStrip + Toolbar + AdmissionDashboard + SessionTabs = ~280px)减去下方 InterjectInput(~50px)决定,**结果就是 analyzing-grid 的锁高度上限**
- **不滚动**的好处:
  - 用户的"阅读位置"心智模型简化(不需考虑主区会把我带到哪里)
  - sibling alert 堆叠时不再侵蚀网格(因为 sibling 在 flex-col 里本来就被 InterjectInput 顶在底部,谁都不滚)
- 行为:**今日现状下外层从不滚**,这条 change 是把**事实上不存在的能力从接口语义中撤掉**,不是新增约束

### D2 · 两列分别 `overflow-hidden`(列内 body 自滚)

**原文**:`analyzing-grid` 的两列容器 `<div data-testid="analyzing-left-col">`、`<div data-testid="analyzing-right-col">` 各加 `overflow-hidden`。

**形态**:
```
[analyzing-main overflow-hidden flex flex-col]
  ├ [analyzing-grid flex-1 min-h-0 overflow-hidden grid grid-cols-3]
  │   ├ [analyzing-left-col col-span-2 overflow-hidden flex flex-col min-h-0]
  │   │   └ <DocumentReaderPane>
  │   │       ├ Tab 栏(flex-shrink-0,顶部)
  │   │       └ body (flex-1 overflow-auto ← 这里滚)
  │   └ [analyzing-right-col col-span-1 overflow-hidden flex flex-col gap-5 min-h-0]
  │       ├ <Summary>      ← 顶部固定
  │       └ ProductList wrapper (flex-1 min-h-0)
  │           └ body (overflow-auto ← 这里滚)
  ├ [interjectError alert](conditional)
  ├ [productError alert](conditional)
  └ <InterjectInput>
```

**关键约束**:
- **Tab 栏 / Summary 卡片不随 body 滚动消失**(保持顶部吸顶)
- 左右两栏**互不影响**,一根手指拖左,右栏不动
- 列容器加 `overflow-hidden` 不是为了让它自己滚,而是**兜底**:如果某天 DocumentReader / ProductList 内部 `overflow-auto` 失效,内容溢出也不会突破列边界污染右栏

### D3 · 窄视口形态同契约(`NarrowLayout` + body)

**原文**:窄视口形态(已 ticket 05 落地的 `<NarrowLayout>`)—— 单栏 Tab 切换形态,同样要把"锁高度 + 内部 body 自滚"显式化:

- `<div data-testid="analyzing-narrow" className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">`
- `<div data-testid="analyzing-narrow-body" className="flex-1 min-h-0 overflow-hidden">`
- `<DocumentReaderPane>` / `<Summary> + ProductList` 内部 `overflow-auto` 不变

窄视口下"左右两栏独立"不适用(单视图),但"锁高度 + 内部滚动"**与 D1/D2 同构**。

### D4 · 拆死代码:删 `mainScrollRef` + sessionStorage 滚动持久化

**原文**:把现在事实上永远 `scrollTop === 0` 的 `mainScrollRef` 及其周边引用一并删除:

- 删 `const mainScrollRef = useRef<HTMLDivElement>(null)`(在 `AnalyzingContent` 函数体里)
- 删 helper `function scrollStorageKey(sessionId)`,返回 `analysis-scroll-<sid>`
- 删 `handleSwitchSession` 中两段 `sessionStorage.setItem` / `getItem` + `queueMicrotask` 包裹的保存/恢复 try 块
- 删 `analyzing-zone.tsx` 顶层 JSDoc 第 92 行 `"主区滚动位置按 sessionStorage analysis-scroll-<sid> 持久化"`(契约附文,已不诚实)
- 删 caller 处 `<CitationOverlay mainScrollRef={mainScrollRef}>`(行 831)

**理由**:D1 路径下 `el.scrollTop === 0` 恒成立 —— **这段代码是死代码**,留着会在将来误导接手人以为主区会滚、值得持久化。

### D5 · `<CitationOverlay>` 删 `mainScrollRef?` 字段

**原文**:`CitationOverlayProps.mainScrollRef?: RefObject<HTMLElement | null>` 字段、对应 useEffect 里 `addEventListener('scroll', ...)` 监听块、JSDoc 描述段一并删除。

**理由**:
- ADR-0018 D2 "重算触发清单"第 ② 项"主区整体滚动"由本 ADR 撤销
- 监听器无对象后 `mainScrollRef?.current?.addEventListener('scroll', ...)` 一段也是不可达代码,删之
- 接口**变干净**:不留 optional 字段让接手人翻 caller 找出处

**保留**:resize 监听、左右 body 各自 scroll 监听、MutationObserver、rAF throttle —— 全部不动,因为 SVG 跨列画线在 D1/D2 路径下仍需重算端点。

---

## 视觉契约验收

- 桌面形态(≥1024px):手工 Chromium + 设计稿截图对比,**主区两根列级滚动条独立、Tab 栏 / Summary 顶部吸顶、外层主区不滚** —— 2026-07-22 完成
- 窄视口(<1024px):手工 Chromium devtools 切到 800×600,**NarrowLayout 锁高度 + 切 Tab 时内部 body 自滚** —— 2026-07-22 完成
- jsdom 单元测试仅断言 className 契约(见 ticket 08 §7),**不**覆盖真滚动行为(避免 jsdom layout 漂移);e2e 留 ticket 09 后续基建
