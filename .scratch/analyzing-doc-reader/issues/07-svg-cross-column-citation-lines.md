---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017, ADR-0018]
Implements: ADR-0018 D1, D2, D3
Slice: 7/7
Priority: P1
---

# 07 — 跨列 SVG 画线 + 反向联动(原生 overlay · 双向锚点)

## What to build

把 [ADR-0018](docs/adr/0018-analyzing-svg-cross-column-lines.md) D1 / D2 / D3 落地到代码层:**在 ANALYZING 主区新增 `<CitationOverlay>` SVG overlay 组件**,从右栏 ProductList 卡片 → 一根原生 SVG 贝塞尔曲线 → 连接到左栏 DocumentReaderPane 当前 `<mark>` 高亮 span;**补齐 ADR-0017 D4 当时声明"本期不实现"的反向联动**(点左栏 span → 滚右栏 product 卡片 + pulse)。

> **本 ticket 不做**:线条动画(流入/流出);hover product 高亮对应线;第三方画线库;窄视口适配;AI prompt 改造(留 v2)。

## Blocked by

- ticket 03(`<mark>` data-line-start + pulseRef 状态机已落地)
- ticket 05(窄视口折叠已落地)

## Acceptance criteria

### SVG overlay 组件

- [ ] 新增 `apps/web/src/components/citation-overlay.tsx`(client component)
- [ ] SVG 元素属性:
  - `position: absolute; inset: 0; z-index: 10; pointer-events: none;`
  - `<svg width="100%" height="100%" preserveAspectRatio="none">`
  - `viewBox` 跟随主区视口(0 0 width height),`useEffect` 里 `svgRef.current.getBoundingClientRect()` 计算
- [ ] 每个 `source_ref` 渲染一条 `<path>`:
  - `d="M <productX> <productY> C <cp1X> <cp1Y>, <cp2X> <cp2Y>, <markX> <markY>"`
  - `stroke="hsl(var(--brand-300))"`、`stroke-width="1.5"`、`stroke-opacity="0.6"`、`fill="none"`
  - 端点 clamp 到视口边界(`Math.max(0, Math.min(width, x))`)
- [ ] 颜色统一,不按 product kind 区分(避免视觉过载;ADR-0018 D1)

### 位置 API(D2)

- [ ] ProductList 卡片 DOM 加 `data-product-id={item.id}` 属性(对齐 `AnalyzingProductItem.id`)
- [ ] `CitationOverlay` 持有:
  - `productRefs: Map<string, HTMLElement>`(通过 `data-product-id` 选择器收集)
  - `markRefs: Map<string, HTMLElement>`(通过 `[data-line-start][data-tab-id]` 选择器收集,key = `${tabId}:${start}:${end}`)
- [ ] `useEffect` 监听重算触发:
  - `window.addEventListener('resize', ...)` + `requestAnimationFrame` throttle
  - 主区容器 + 左栏 `bodyRef` + 右栏产品列表容器各自 `scroll` listener(passive: true)+ rAF throttle
  - `MutationObserver` 监听 product 卡片 / mark span 增删(`subtree: true, childList: true, attributes: true`)
- [ ] 坐标计算:统一用 `el.getBoundingClientRect()`,转 SVG viewBox 坐标系(减去 svg 自身的 left/top)

### 跨列联动集成(D1 + D2)

- [ ] `AnalyzingZone` 新增 `<CitationOverlay>` 作为 `<DocumentReaderPane>` + `<ProductList>` 的兄弟节点
- [ ] props 注入:
  - `chunks: AnalyzingChunk[]`(用于派生 source_refs)
  - `productListRef: RefObject<HTMLElement>`(右栏容器 ref)
  - `documentBodyRef: RefObject<HTMLElement>`(左栏阅读区 body ref)
  - `activeTabId: string`(从 DocumentReaderPane 拿当前 Tab)
- [ ] 派生 source_refs → 按"product id → source_ref[]"映射:
  ```ts
  const lines = useMemo(() => {
    const out: Array<{ productId: string; ref: SourceRef }> = []
    for (const c of chunks) {
      if (!c.source_refs || c.kind === 'narration') continue
      for (const ref of c.source_refs) {
        out.push({ productId: c.id, ref })
      }
    }
    return out
  }, [chunks])
  ```

### 反向联动(D3 · ADR-0017 D4 v2 补齐)

- [ ] `<DocumentReaderPane>` 新增 `onSourceRefClick?: (ref: SourceRef) => void` 回调实现
- [ ] `<mark>` 加 `onClick` 处理:点击 → 找到对应 `SourceRef` → 调 `onSourceRefClick(ref)`
- [ ] `AnalyzingZone` 接 `handleSourceRefClick(ref)`:
  - 通过 `source_refs` 反查到 `chunk.id`(product id)
  - 设 `pulseRef = { productId: chunk.id }`(扩展现有 `pulseRef` 类型)
  - ProductList 接 `pulseRef.productId`,对应卡片加 `animate-pulse-brand` 1.5s 后移除
  - 对应 product 卡片 `scrollIntoView({ block: 'center', behavior: 'smooth' })`
- [ ] `pulseRef` 类型扩展(在 analyzing-zone.tsx):
  ```ts
  pulseRef?: { tabId: string; lineRange: readonly [number, number] }
          | { productId: string }
          | null
  ```
- [ ] DocumentReaderPane 的 `pulseRef` 类型过滤:`if ('tabId' in pulseRef) { ... } else return`
- [ ] ProductList 接 `pulseRef: { productId: string } | null`,1.5s 后清空

### SSR / 窄视口容错

- [ ] `CitationOverlay` SSR 期 `return null`(无 svg 渲染,避免 hydration mismatch)
- [ ] 窄视口(<1024px):`isDesktop === false` 时不渲染 `<CitationOverlay>`(对齐 ADR-0018 D4)
- [ ] vitest setup 桩 `ResizeObserver` / `IntersectionObserver`(参考 ticket 05 已有 matchMedia 桩):
  ```ts
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as any
  ```

### 单元测试(`apps/web/src/components/__tests__/citation-overlay.test.tsx` 新增)

- [ ] 渲染空 chunks → 0 条 `<path>`
- [ ] 渲染含 1 个 subproblem + 1 source_ref → 1 条 `<path>`
- [ ] 渲染含 1 个 subproblem + 2 source_refs → 2 条 `<path>`(共享源点)
- [ ] 渲染 narration chunk → 0 条 `<path>`(source_refs 契约丢弃)
- [ ] `data-product-id` 在 ProductList 卡片上存在
- [ ] `data-line-start` / `data-tab-id` 在 `<mark>` 上存在(对齐 ticket 03)
- [ ] click `<mark>` → `onSourceRefClick` 被调一次 + 传 `SourceRef`
- [ ] 窄视口下 `<CitationOverlay>` 不渲染
- [ ] SSR 期 `<CitationOverlay>` 返回 `null`(可在分析测试 mock React 渲染环境)

### 不破坏现有

- [ ] ticket 03 `<mark>` 行级底色 + pulse 1.5s 全部保留
- [ ] ticket 04 synthetic chunk 无 source_ref 时**不画线**(自然容错:out 数组里没有对应条目)
- [ ] ticket 05 窄视口折叠形态不变
- [ ] `apps/web/src/__tests__/analyzing-zone.test.tsx` 现有 23 用例全部通过
- [ ] `apps/web/src/components/__tests__/document-reader-pane.test.tsx` 现有用例全部通过(新增 onSourceRefClick 是可选 prop,旧用法不传仍正常)

## 备注 / 提示

- **零依赖**:原生 SVG + `getBoundingClientRect`,不引第三方画线库(对齐 ADR-0018 D4)
- **数据流**:`AnalyzingChunk.source_refs`(ADR-0017 D3)→ CitationOverlay 派生 `lines` → 每条 line = SVG `<path>`。narration chunk 一律不画线(契约:`source_refs` 在 narration 上省略)
- **复用 ticket 03**:`<mark>` data-line-start / data-tab-id 是 SVG overlay 端点定位的唯一锚点;不动 ticket 03 任何代码
- **反向联动冲突**:tickets 03 的 `pulseRef` 类型扩展(`| { productId: string }`),DocumentReaderPane / ProductList 各自按类型守卫分发处理
- **滚动监听**:左栏 bodyRef + 右栏 product list 容器 + window resize 三处独立监听;`passive: true` 避免阻塞 scroll;`requestAnimationFrame` throttle 合并到下一帧
- **MutationObserver**:监听 product 卡片 / mark span 增删;切 Tab / 联动 pulse / synthetic chunk 加减都会触发
- **视觉密度阈值**:本期不做(留 v2);10 条产物 × 1.5 source_ref ≈ 15 条线,在主区视口下视觉仍清晰
- **测试 mock**:`ResizeObserver` / `IntersectionObserver` / `getBoundingClientRect` 都需要在 vitest 桩(jsdom 不实现);参考 ticket 05 matchMedia 桩模式
- **PR review 必查项**:
  - SVG overlay SSR 期 `return null`(避免 hydration 警告)
  - 窄视口 `isDesktop === false` 时不渲染
  - 滚动监听 passive + rAF throttle
  - pulseRef 类型守卫不漏分支
  - 单元测试覆盖 SSR/窄视口/无 source_ref/narration 4 个边界