---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017]
Implements: ADR-0017 D3, D4
Slice: 3/5
Priority: P0
---

# 03 — 画线渲染 + 点击联动(高亮 span + 切 Tab + 滚 + pulse)

## What to build

把 [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D3 / D4 的"画线关联"机制落地:**左栏阅读器对 `source_refs` 指向的 span 加底色高亮**;**点击右栏 product 卡片 → 左栏切到对应 Tab + 滚到 lineRange + 高亮 pulse 1.5s**。

> **本 ticket 不做**:synthetic chunk 处理(留给 ticket 04);反向联动(点左栏 span → 滚右栏卡片,本期不做);AI prompt 工程让 AI 输出 source_refs(留给独立 ticket)。

## Blocked by

01(数据契约)+ 02(主区文档阅读器面板)

## Acceptance criteria

### 引用计数派生

- [ ] `apps/web/src/lib/analyzing.ts` 新增纯函数 `countCitationsByDoc(chunks: readonly AnalyzingChunk[]): { prd: number; aux: Record<string, number>; asset: number }`
- [ ] 遍历所有 chunk 的 `source_refs`,按 kind 分桶计数;`kind: 'aux'` 用 `auxId` 分键
- [ ] `AnalyzingData.citationCounts` 字段(在 ticket 01 已有 SSR loader 计算)传入 `<DocumentReaderPane>`
- [ ] 单测:空数组 → 全 0;混合多 source_refs → 正确分桶

### 阅读器高亮渲染

- [ ] `<DocumentReaderPane>` 阅读区对**当前 Tab 对应文档**的 `source_refs` span 加底色:
  - PRD → 扫描 `chunks.filter(c => c.source_refs?.some(r => r.kind === 'prd'))`,按 `lineRange` 渲染高亮 `<mark>` 或自定义 `<span>`
  - AuxFile → 同上,按 `auxId === activeTabId` 过滤
- [ ] 高亮样式:`<mark data-testid="citation-highlight" data-refs-count={N} className="bg-brand-50 hover:bg-brand-100/60 cursor-pointer transition-colors">`
- [ ] 多产物引用同一 span → **同一高亮**,`data-refs-count={N}` 显示总数;**不堆叠颜色**
- [ ] hover 高亮 → 浮 tooltip(`<div role="tooltip" data-testid="citation-tooltip">`):"被 N 个产物引用 · 点击跳到产物列表"(本期点击高亮不联动右栏,只显示 tooltip)
- [ ] Asset 高亮:扫描 `kind: 'asset'` 的 source_refs,匹配 `assetList` 中的图片 → 给 `<img>` 加 `className="ring-2 ring-brand-300"` + 角标"🔗 N"
- [ ] 高亮渲染容错:`lineRange` 超出文档行数 → 该 source_ref 跳过(不报错);`quote` 与 lineRange 处文本不一致 → 仍按 lineRange 高亮(tooltip 显示⚠️符号,留给 v2 修复)

### 点击右栏卡片 → 联动左栏

- [ ] `AnalyzingContent` 新增 state:`activeSourceRef: SourceRef | null` + `pulseRef: {tabId: string, lineRange: [number, number]} | null`
- [ ] `<ProductList>` 新增 `onItemClick?: (itemId: string) => void` 回调(本期新加,不影响现有 `onAction`)
- [ ] 点击 product 卡片 → 计算首个 `source_ref`(若 `item.source_refs?.[0]` 存在):
  - 设 `activeSourceRef = ref`
  - 设 `pulseRef = { tabId: ..., lineRange: ref.lineRange }`(AuxFile → tabId = ref.auxId;PRD → tabId = 'prd')
  - 1.5s 后 `setPulseRef(null)`
- [ ] `<DocumentReaderPane>` 接 `activeSourceRef` + `pulseRef` props:
  - `pulseRef.tabId !== activeTabId` → 切换 Tab
  - `pulseRef` 变化 → 阅读区滚到对应行 + 加 `animate-pulse-brand` class 1.5s 后移除
- [ ] 无 source_ref 的卡片点击 → toast 提示"⚠️ 该产物未关联原文出处"(用 `InterjectInput` 上方已有的 error 区,或新建 toast 组件)
- [ ] 多 source_ref 的卡片:点 → 跳到第一个;**本期不实现"+ N 处"循环**(留 v2)

### Pulse 动画

- [ ] CSS class `animate-pulse-brand`(在 `tailwind.config.ts` / `globals.css` 中定义):1.5s 动画,scale + shadow
- [ ] 或:用 framer-motion(若项目已用);若无,用 CSS `@keyframes` 简单实现
- [ ] 测试:点击后 `<mark>` 有 `animate-pulse-brand` 类;1.5s 后类移除

### 单元测试

- [ ] `apps/web/src/lib/__tests__/analyzing-source-refs.test.ts` 追加:
  - `countCitationsByDoc` 边界:空 / 单源 / 多源混合
- [ ] `apps/web/src/components/__tests__/document-reader-pane.test.tsx` 追加:
  - 渲染 `citation-highlight` data-testid,数量与 source_refs 一致
  - hover 高亮 → tooltip 出现
  - `pulseRef` prop 变化 → 切 Tab + 滚 + 加 pulse class
  - lineRange 越界 → 该 source_ref 不渲染(不报错)
- [ ] `apps/web/src/__tests__/analyzing-zone.test.tsx` 追加:
  - mock chunks 含 source_refs → ProductList 卡片可点 → 左栏 Tab 切换
  - mock product 无 source_refs → 卡片点击 → 弹 toast 提示
- [ ] E2E(可选,Playwright):点击右栏卡片 → 验证左栏对应高亮 pulse

### 不破坏现有

- [ ] `ProductList` 现有 `onAction` 行为不变;`onItemClick` 是新增可选回调
- [ ] 现有 `apps/web/src/__tests__/analyzing-zone.test.tsx` 不依赖 source_refs 的测试**全部通过**

## 备注 / 提示

- **高亮组件复用**:`MarkdownPreview` 当前是单一 `<div>`,需要给一个"行级高亮"slot;若改动成本高,可考虑**绕过 MarkdownPreview**,直接用 `marked` / `markdown-it` 把 markdown 解析成 token,在 reading 阶段按行号加 `<mark>` 包裹
- **滚动定位精度**:markdown 渲染后**真实 DOM 行**与 source 0-based 行号可能不完全对齐(因列表项、表格等有嵌套);本期用"近似滚到 lineRange 对应 `<p>` / `<li>` 元素"足够,v2 引入"行号锚点"机制(<h2 id="l-12">) 再精确化
- **Pulse 不打断打字机**:`animate-pulse-brand` 与潜在的 typewriter phase 动画不冲突(本 ticket 后 typewriter 不再有 UI 出口,所以更无冲突)
- **AI prompt ticket**(独立):让 AI 在 emit chunk 时输出 `source_refs` 是 prompt 工程,不在本 ticket 范围;落一个独立 ticket "AI prompt: emit source_refs at chunk emit time",阻塞 ticket 03 端到端联动 demo