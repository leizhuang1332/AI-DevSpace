---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017]
Implements: ADR-0017 D6
Slice: 4/5
Priority: P1
---

# 04 — Synthetic Chunk 合成 + 无出处角标(VS4 加 product 路径)

## What to build

把 [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D6 的"synthetic chunk"机制落地:**用户在右栏 ProductList 手动加 product 时,合成一个 `synthetic: true` 占位 chunk 落 chunks.jsonl**(保证 chunks.jsonl 单一真相源);**无 source_refs 的卡片显示角标"⚠️ 无出处"**。

> **本 ticket 不做**:重扫时 AI 不复读 synthetic chunk 的 prompt 工程(留给独立 AI prompt ticket)。

## Blocked by

01(`AnalyzingProductItem.synthetic` 字段已加 + JSONL 兼容读写)+ 02(主区文档阅读器面板)+ 03(画线渲染,本 ticket 复用 `data-citation-missing` 角标 slot)

## Acceptance criteria

### Synthetic chunk 合成逻辑

- [ ] `apps/web/src/lib/analyzing.ts` 新增纯函数 `buildSyntheticChunk(params: { kind: ProductKind; title: string; sourceRefs?: SourceRef[]; ts: string }): AnalyzingChunk`
- [ ] 输出形态:
  ```ts
  {
    id: `user-added-${crypto.randomUUID()}`,
    ts: params.ts,  // ISO 8601 或 'HH:MM:SS'
    label: params.kind === 'subproblems' ? 'DETECT' : params.kind === 'risks' ? 'RISK' : 'OPTION',
    text: params.title,
    kind: params.kind === 'subproblems' ? 'subproblem' : params.kind === 'risks' ? 'risk' : 'option',
    tone: 'info',
    source_refs: params.sourceRefs,  // 可省略
    synthetic: true,  // ← 关键
  }
  ```
- [ ] 同步产出 `AnalyzingProductItem`(透传 id / title / source_refs / synthetic)

### ProductList 集成(用户加 product 路径)

- [ ] `apps/web/src/components/product-list.tsx` 的 `submitAdd()` 回调中,**追加调用 `onAddSyntheticChunk(chunk)`**:
  - 当用户点"+ 新增子问题 / 风险 / 方案"对话框提交时
  - 通过 `onAction({ kind, action: 'add', ... })` 现有路径(已在 VS4 实装)把 product 落盘
  - **同步**:合成 synthetic chunk → 通过**新增 prop** `onAddSyntheticChunk(chunk)` 通知父组件
- [ ] `ProductList` 新增可选 prop `onAddSyntheticChunk?: (chunk: AnalyzingChunk) => void`;若不传 → 不合成(向后兼容旧测试)
- [ ] `<AddDialog>` 增加可选字段"出处"(可关闭):下拉选 PRD / AuxFile 列表 → 二级选 lineRange;若用户不选 → sourceRefs 省略 → UI 角标⚠️

### 父组件 handling(analyzing-zone.tsx)

- [ ] `AnalyzingContent` 新增 callback `handleAddSyntheticChunk(chunk: AnalyzingChunk)`:
  - `setChunksBySessionId(prev => ({ ...prev, [activeSessionId]: [...prev[activeSessionId], chunk] }))`
  - 客户端 SSE 不推送(本地合成)
- [ ] **可选**:通过 server action `/api/requirement/<id>/analysis/synthetic-chunk` 把 chunk 落 chunks.jsonl(本期**先做客户端 memory**,落盘留给 v2;若 server 端不落盘,刷新页面后 synthetic 卡片丢失——这是已知代价,UI 角标说明)

### UI 角标"⚠️ 无出处"

- [ ] `ProductList` 的 `InteractiveItem` 检查 `item.synthetic && (!item.source_refs || item.source_refs.length === 0)` → 卡片右上角加角标
- [ ] 角标 DOM:`<span data-testid="citation-missing" title="该产物未关联原文出处">⚠️ 无出处</span>`
- [ ] 角标样式:小号灰字 / 黄色边
- [ ] 普通 AI 产出的 product(非 synthetic)无角标

### 单元测试

- [ ] `apps/web/src/lib/__tests__/analyzing-synthetic-chunk.test.ts`(新增):
  - `buildSyntheticChunk()` 三种 kind 输出正确 label / kind 映射
  - id 前缀 `user-added-` 正确
  - `synthetic: true` 必带
  - `source_refs` 省略 vs 传入两种情况
- [ ] `apps/web/src/components/__tests__/product-list.test.tsx` 追加:
  - `onAddSyntheticChunk` 回调被正确触发,参数形态正确
  - 卡片 `data-synthetic="true"` 渲染
  - 角标 `citation-missing` 显示条件正确
- [ ] `apps/web/src/__tests__/analyzing-zone.test.tsx` 追加:
  - 加 synthetic chunk → chunksBySessionId 更新
  - 卡片显示角标 → 点击 → toast 提示(同 ticket 03 的无 source_refs 路径)

### 不破坏现有

- [ ] VS4 现有 `updateProduct` server action(增 / 删 / 改 / 合并)逻辑不变;synthetic chunk 仅是**额外**的客户端通知
- [ ] `ProductList` 的 `editable=false` 只读模式(本期不展示交互编辑)不受影响

## 备注 / 提示

- **Synthetic chunk 不持久化的代价**:本期刷新页面后 synthetic 卡片丢失;若需持久化,ticket 04 v2 加 server action `POST /api/requirement/<id>/analysis/synthetic-chunk` → 写 `chunks.jsonl`
- **AI 复读过滤**(独立 ticket):重扫时 AI 应忽略 `synthetic: true` 行,避免用户输入被 AI 覆盖;这是 prompt 工程,本 ticket 不做
- **多会话影响**:`chunksBySessionId` 按 sessionId 分桶,synthetic chunk 落在当前 active 会话;切换 Tab 后再切回 → synthetic 卡片仍在(因 `chunksBySessionId` 持久)
- **product id 冲突**:`buildSyntheticChunk` 的 product id 与现有 chunks 可能有 UUID 冲突;测试需断言 id 唯一性(vitest `expect(ids.size).toBe(ids.length)`)