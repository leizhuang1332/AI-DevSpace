---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017]
Implements: ADR-0017 D3, D5, D6
Slice: 1/5
Priority: P0
---

# 01 — 数据契约 + SSR 装载(AnalyzingChunk.source_refs / AnalyzingData 三字段)

## What to build

把 [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D3 / D5 / D6 的数据契约落地到代码层。**纯类型 + SSR loader 改造,无 UI 改动**:

1. **`AnalyzingChunk` 接口加 `source_refs?: SourceRef[]` 字段**(D3)
2. **`AnalyzingProductItem` 接口同步加 `source_refs?: SourceRef[]`**(供 UI 透传 / 显示"🔗 N 处")
3. **`AnalyzingData` 接口加 3 个字段**:`prdMarkdown` / `auxFiles` / `assetList`(D5)
4. **新增 `SourceRef` discriminated union 类型** + 3 个 brand 子类型 + JSONL 持久化测试
5. **`AnalyzingProductItem` 加 `synthetic?: boolean`** 字段(D6,本期先加字段,ticket 04 落地合成逻辑)
6. **SSR loader `getAnalyzingData()` 改造**:读 PRD 全文 + 读 aux 目录 + 解析 Asset 引用 → 注入 3 个字段

> **本 ticket 不做**:UI 改造(无左栏 / 无 Tab / 无高亮)—— 纯数据层。ticket 02 + 03 消费本 ticket 注入的字段。

## Blocked by

None —— 可立即开始

## Acceptance criteria

### 数据类型

- [ ] `apps/web/src/lib/analyzing.ts` 新增 `SourceRef` 类型定义,形态如下:
  ```ts
  export type SourceRef =
    | { kind: 'prd'; lineRange: [number, number]; quote?: string }
    | { kind: 'aux'; auxId: string; lineRange: [number, number]; quote?: string }
    | { kind: 'asset'; assetId: string }
  ```
- [ ] `AnalyzingChunk` 接口加 `source_refs?: SourceRef[]`(可选字段,narration chunk 一律省略)
- [ ] `AnalyzingProductItem` 接口加 `source_refs?: SourceRef[]` + `synthetic?: boolean`(两个字段)
- [ ] `AnalyzingData` 接口加 3 个字段:
  ```ts
  prdMarkdown: string  // SSR 读 requirement.md 全文
  auxFiles: AuxFile[]  // SSR 读 requirements/<id>/aux/ 目录
  assetList: Asset[]   // SSR 解析 requirement.md 的 ![](assets/...) 引用 + 比对磁盘
  ```

### SSR 装载

- [ ] `analyzing.server.ts` 的 `getAnalyzingData()` 末尾追加 3 段读取:
  - **PRD 全文**:走 `requirementsRoot/requirements/<reqId>/requirement.md`,`readFileSync` + `existsSync` 容错(文件不存在 → 空字符串)
  - **auxFiles**:扫描 `requirementsRoot/requirements/<reqReq>/aux/` 子目录,每个子目录视为一个 aux file,读 `<aux-id>/<filename>.md` 作为 body;按 `usage_tag` 6 类排序分组
  - **assetList**:解析 `requirement.md` 中所有 `![](assets/<name>)` 引用 + 与 `requirementsRoot/requirements/<reqId>/assets/` 目录 readdir 比对 → 仅返回实际存在的 asset
- [ ] `emptyAnalyzing()` 同步加 3 个字段的默认值(空字符串 / `[]` / `[]`)
- [ ] `REFUND_ANALYZING` mock 数据加 3 个字段(用真实 `requirement.md` 路径读出来,或 mock 字符串)

### JSONL 持久化兼容

- [ ] `loadSessionChunks()` 函数读取 chunks.jsonl 时,对历史 chunk(无 `source_refs` 字段)用 type guard 兼容:`obj.source_refs` 是数组则读入,否则视为 `undefined`
- [ ] 单元测试:写入含 `source_refs` 的 chunk → 读回字段完整;写入历史 chunk(无字段)→ 读回 `undefined` 不报错

### SourceRef 类型守卫

- [ ] 导出 `isSourceRef(value: unknown): value is SourceRef` 工具函数,供 SSE 推送 / JSONL 解析时验证
- [ ] 单元测试覆盖 3 种子类型 + 无效输入(false / 缺失字段 / 错类型)返回 false

### chunk 写出约束

- [ ] `AnalyzingChunkLabel` / `AnalyzingChunkKind` 联合类型约束:narration 类 chunk(START / READ / SCAN / MATCH / INFER / THINK / COMPLETE)与 `source_refs` 不兼容(类型层 union 限定 / 运行时校验任选其一)
- [ ] SSE 推送层 `analysis_chunk` 事件序列化时,`source_refs` 字段**显式包含或省略**,不写 `null`(JSONL 体积优化)

### 单元测试

- [ ] `apps/web/src/lib/__tests__/analyzing-source-refs.test.ts`(新增):覆盖
  - `SourceRef` 三形态的类型守卫
  - `AnalyzingChunk` 含 / 不含 `source_refs` 的 JSONL 读写
  - `deriveProducts()` 透传 `source_refs` 到 `AnalyzingProductItem`
  - `deriveProducts()` 透传 `synthetic: true` 标记
- [ ] `apps/web/src/lib/__tests__/analyzing-data-fields.test.ts`(新增):覆盖
  - `getAnalyzingData()` 注入 `prdMarkdown` / `auxFiles` / `assetList` 三个字段
  - aux 目录不存在 / requirement.md 不存在 的容错路径
  - assetList 解析:孤儿 asset 忽略 / 引用了不存在的 asset 不报错

### 不破坏现有

- [ ] `analyzing.ts` 现有 `summarizeAnalyzingStats` / `deriveProducts` / `emptyAnalyzing` / `REFUND_ANALYZING` 等导出**签名不变**;仅内部加字段
- [ ] `analyzing.server.ts` `getAnalyzingData()` 返回结构向后兼容;老调用方读不到 3 个新字段时不影响运行
- [ ] `apps/web/src/__tests__/analyzing-zone.test.tsx` 现有测试**全部通过**(可能需少量 mock 字段补全,但不能改业务逻辑)

## 备注 / 提示

- **synthetic chunk 写入逻辑**留到 ticket 04;本 ticket 只在 `AnalyzingProductItem` 加 `synthetic?: boolean` 字段 + `deriveProducts` 透传(目前所有 chunk 都是非 synthetic,值始终 `undefined`)
- **Asset 类型**已存在于 `RequirementService.get()` 返回值(ADR-0015 D5 落地),字段形态确认下:`{name, url, size, mime}`;若不一致需先对齐
- **chunks.jsonl 体积**:平均每条 subproblem/risk/option chunk 多 50 字节,100 条估算 +5KB,可忽略;若未来瓶颈再考虑 columnar
- **Agent 端 AI prompt 模板更新**:不在本 ticket 范围(让 AI 输出 `source_refs` 是 prompt 工程);ticket 03 落地联动后,issue tracker 单独立 ticket "AI prompt: emit source_refs"