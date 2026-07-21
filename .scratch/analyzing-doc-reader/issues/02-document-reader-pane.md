---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017]
Implements: ADR-0017 D1, D2
Slice: 2/5
Priority: P0
---

# 02 — 主区文档阅读器面板(2:1 布局 + Tab 栏 + 删 ThinkingStream)

## What to build

把 [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D1 / D2 的 UI 形态落地:**重塑 `<AnalyzingContent>` 主区**为 2:1 左右分栏,左栏 = 新建 `<DocumentReaderPane>` 组件(Tab 栏 + Markdown 阅读器),右栏 = 现有 `<ProductList>`(不动),**删除 `<ThinkingStream>` 渲染出口**(state machine 内部保留)。

> **本 ticket 不做**:高亮渲染(留给 ticket 03);click 联动(留给 ticket 03);synthetic chunk 处理(留给 ticket 04);窄视口折叠(留给 ticket 05)。
>
> 本 ticket 完成后,用户看到的是:左栏 Tab 栏(PRD / AuxFiles,标 "🔗 N 处引用" 但**暂时都是 0**) + Markdown 阅读器;右栏 ProductList 不变。

## Blocked by

01(数据契约 + SSR loader 注入 `prdMarkdown` / `auxFiles` / `assetList`)

## Acceptance criteria

### 布局改造(analyzing-zone.tsx)

- [ ] `<AnalyzingContent>` 的 `analyzing-main` 内,删除 `<ThinkingStream chunks={chunks} phase={phase} paused={paused} onSkip={skipTypewriter} />` 及其调用
- [ ] `<AnalyzingContent>` 的 `analyzing-grid` 容器类从 `grid grid-cols-1 lg:grid-cols-2 gap-5` 改为 `grid grid-cols-1 lg:grid-cols-3 gap-5`(左 col-span-2,右 col-span-1)
- [ ] 左列容器:`<div data-testid="analyzing-left-col" className="col-span-1 lg:col-span-2 ...">` 包住 `<DocumentReaderPane>`
- [ ] 右列容器:沿用 `data-testid="analyzing-right-col"`,内含 `<Summary>` + `<ProductList>`,**不变**
- [ ] 窄视口(`<lg`):左右两栏**垂直堆叠**,顺序 = 左在上 / 右在下;**本期不实现折叠 / 抽屉**(留给 ticket 05)

### DocumentReaderPane 组件

- [ ] 新文件 `apps/web/src/components/document-reader-pane.tsx`(`'use client'`)
- [ ] Props 接口:
  ```ts
  interface DocumentReaderPaneProps {
    prdMarkdown: string
    auxFiles: AuxFile[]  // 已按 usage_tag 排序
    assetList: Asset[]
    citationCounts: {
      prd: number      // = 所有 chunks 中 source_refs 中 kind==='prd' 的总数
      aux: Record<string, number>  // auxId → count
      asset: number    // = 所有 chunks 中 source_refs 中 kind==='asset' 的总数
    }
    activeSourceRef?: SourceRef | null  // 暂不消费,ticket 03 接入
    onSourceRefClick?: (ref: SourceRef | null) => void  // 暂不消费
  }
  ```
- [ ] 内部 state:`activeTabId: string`(默认 `'prd'`)
- [ ] 顶部 Tab 栏(`<div data-testid="doc-reader-tabs" role="tablist">`):
  - Tab 列表 = `['prd', ...auxFiles.map(a => a.id)]`
  - 每个 Tab:`<button data-testid="doc-reader-tab" data-tab-id={...} data-active="...">`
  - 标签文本:
    - PRD → "PRD · 🔗 {citationCounts.prd}"
    - AuxFile → `{filename} · 🔗 {citationCounts.aux[aux.id] ?? 0}"
    - **0 处引用显示中性"·"(不带 🔗 数字)**
- [ ] 主体阅读区(`<div data-testid="doc-reader-body">`):
  - 当前 Tab = `'prd'` → 渲染 `prdMarkdown`(沿用 `<MarkdownPreview>` 或简化版 inline;**本期 ticket 03 才加高亮**,本期就纯渲染)
  - 当前 Tab = `aux-id` → 渲染 `auxFiles.find(a => a.id === activeTabId)?.body`
  - 空态:`prdMarkdown === '' && auxFiles.length === 0` → 显示"📭 暂无需求文档与辅助材料,请去 DRAFTING 工位创建"

### 删除 ThinkingStream 渲染出口

- [ ] `analyzing-zone.tsx` 删除 `<ThinkingStream>` import
- [ ] `analyzing-zone.tsx` 删除 `analyzing-stream` / `analyzing-stream-body` / `analyzing-chunk-future` / `analyzing-chunk-current` / `analyzing-chunk-done` 等 data-testid(若仍有引用则保留)
- [ ] `phase` / `paused` / `skipTypewriter` 等 state machine 内部状态**保留**(供 future use);`Toolbar` 的 ⏸ 暂停 / ↶ 重置按钮**保留可点**(状态变化不影响 UI 显示)
- [ ] **不动** `apps/web/src/components/thinking-stream.tsx` 文件本身(留作 archive,后续若确认无用再删)
- [ ] **不动** `analyzing-zone.tsx` 的打字机 phase useEffect(第 257-309 行),仅删除 `<ThinkingStream>` JSX 调用

### Toolbar 调整(可选)

- [ ] Toolbar 的"⏸ 暂停 / ↶ 重置"按钮可改为"🤖 AI 状态(运行中 / 已暂停)"只读徽章(本期**不改**,留 v2 决定)
- [ ] 或:Toolbar 的 actions 在 ANALYZING 工位隐藏"⏸ / ↶"(仅展示其他 action);本期**不改**,留 v2 决定

### data-testid 与 a11y

- [ ] `analyzing-zone.tsx` 根 `<main>` 的 `data-empty="false"` 不变
- [ ] 新增 `data-layout="doc-reader-2-1"` 属性(标识当前布局版本,供后续兼容测试)
- [ ] Tab 栏 `role="tablist"`,Tab `role="tab"`,阅读区 `role="tabpanel"`;键盘 ← → 可切换 Tab

### 单元测试

- [ ] `apps/web/src/components/__tests__/document-reader-pane.test.tsx`(新增):覆盖
  - 空态渲染(`prdMarkdown === '' && auxFiles.length === 0`)
  - 单 PRD 渲染(只有 prdMarkdown,无 auxFiles)
  - PRD + AuxFile 渲染,默认 Tab = PRD
  - 点 AuxFile Tab → 切换阅读区内容
  - 引用计数正确渲染(`🔗 N`, 0 时只显示 `·`)
- [ ] `apps/web/src/__tests__/analyzing-zone.test.tsx` 更新:
  - 删除 `analyzing-stream` / `analyzing-chunk-*` 相关 assertion
  - 新增 `analyzing-left-col` / `doc-reader-tabs` / `doc-reader-body` 相关 assertion
  - 现有 typewriter / pause / reset 测试若依赖 ThinkingStream UI → 改为测 state 变量(从 useState hook 暴露或加 data-attribute)

## 备注 / 提示

- **`MarkdownPreview` 复用**:沿用 `apps/web/src/components/markdown-preview.tsx` 即可,无需新增 markdown 渲染器;若 `MarkdownPreview` 仅适配 DRAFTING 的窄列宽,可能需要给一个 `data-full-width="true"` 开关
- **Asset 引用**:`requirement.md` 中 `![](assets/prd-1.png)` 在阅读器里走 `MarkdownPreview` 自然渲染(已在 DRAFTING 实装);本期**不**做"Asset 被引用时加描边"(留给 ticket 03)
- **typing 流关闭的副作用**:`ToolBar` 的"📋 复制思考产物"按钮仍可点(复制 chunks 内容),即便 UI 不展示思考流;本期行为不变
- **删除 ThinkingStream 后**:`useEffect` 内的 typewriter 计时器仍在跑(若 chunks 列表变化,phase 会推进);只是 phase 不再有 UI 渲染出口。可考虑在删除时一并 `setPhase({ kind: 'done' })`,避免无意义计时器跑——**这是 ticket 落地时的实现选择**,ADR 不锁