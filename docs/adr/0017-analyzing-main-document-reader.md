# ADR-0017: ANALYZING 主区文档对照阅读器 + 识别产物画线关联

**Status:** Accepted
**Date:** 2026-07-21
**Deciders:** 项目负责人(经 `/grill-with-docs` 11 轮 grilling 拍板)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 15, 23, 36, 52, 53
**关联 ADR:**
- [ADR-0013](0013-analyzing-zone-rewrite.md) — ANALYZING 工位重设计(D2 ③ 识别产物 / D7 多会话;本 ADR 继承其数据契约)
- [ADR-0015](0015-prd-file-upload-and-editing.md) — PRD 上传(Asset 子目录定义,本 ADR 左栏 PRD 引用之)
- [drafting-redesign/issues/01](../.scratch/drafting-redesign/issues/01-foundation-data-and-zone-metadata.md) — AuxFile 数据模型(本 ADR 左栏 AuxFile 引用之)
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — 工位自适应(本 ADR 兼容其 §5 工位-资源树对应表)

**覆盖/补充:**
- **覆盖** [ADR-0013 §"工位主区布局"](../CONTEXT.md) 中"主区全宽,思考流(左) + 产物(右)"的描述(改为 2:1 左右分栏,删 ThinkingStream)
- **补充** [ADR-0013 D2 ③](../CONTEXT.md) 中"识别产物交互编辑"——本 ADR 新增"产物 ↔ 原文出处"画线关联维度
- **不覆盖** ADR-0013 D1 / D3 / D4 / D5 / D6 / D7-D15 任何决策

---

## Context

### 起点

[ADR-0013 §"工位主区布局"](0013-analyzing-zone-rewrite.md) 拍板 ANALYZING 主区形态为 **"思考流(左,打字机) + 识别产物(右,可编辑)"** 的 1:1 双列结构,删除原 v1 "AI 观察屏" 大屏卡片。

落地 issue 19b/19c/19d 已完成骨架。但用户(2026-07-21 `/grill-with-docs`)提出一个**新维度的痛点**——识别产物与原文出处**没有视觉锚点**:

> "识别出的风险点 Q3 我想确认是 PRD 哪段话导致的,但现在要切到 DRAFTING 工位肉眼找;如果识别出 5 个问题、每个对应 PRD 不同段,来回切很痛苦"

### 真实场景(决定性输入)

产品 PM 在 ANALYZING 工位审视 AI 识别的产物(子问题 / 风险 / 方案方向)时,需要:

1. **一眼看到每个产物的原文出处**(AI 是看了 PRD 哪段、aux file 哪行才得出此结论)
2. **快速在左栏原文与右栏产物之间切换**——点右栏问题 → 左栏原文段高亮
3. **左栏常驻 PRD + 所有辅助材料**(用户改完 PRD 回 ANALYZING 时,左侧应自动同步)

原 ADR-0013 的"主区全宽 + 左思考流"形态承载不了这个交互:
- 思考流是 AI 思考过程(过程性、临时性),不是产物出处(结论性、永久性)
- 用户不需要一直看 AI 思考过程,但**永远需要对照原文**
- 把 PRD/aux 文件塞进资源树违反决策 52(ANALYZING 无资源树);塞进 Inline 栏违反决策 53(仅 DRAFTING/EXECUTING 保留);但塞进主区左侧作为"主区文档阅读器"——既不是 tree 也不是 inline rail,是新形态

### 与现有 ADR-0013 §"工位主区布局"的核心矛盾

| 维度 | 原 ADR-0013 §"工位主区布局" | 用户故事要求 |
|---|---|---|
| 主区结构 | 思考流(左) + 产物(右)1:1 | 文档阅读器(左,2 份) + 产物(右,1 份)2:1 |
| 思考流组件 | 保留(`<ThinkingStream>` 打字机) | **删除**(过程性 UI,与"对照阅读"诉求冲突) |
| 文档呈现 | 不在 ANALYZING 范围(决策 52/53) | 主区左侧 Tab 栏阅读器(PRD + AuxFile + Asset) |
| 产物出处关联 | 无 | `AnalyzingChunk.source_refs?: SourceRef[]`(画线联动) |
| VS4 用户加 product 无源 | 不涉及 | 合成 `synthetic: true` chunk 占位 |

### 与已有术语的边界

`AuxFile`(辅助文件)是 DRAFTING 工位 [`<AuxFilesPane>`](../apps/web/src/components/aux-files-pane.tsx) 已在使用的一等公民([packages/shared/src/drafting.ts:40](../packages/shared/src/drafting.ts))——本 ADR 把它**提升为 ANALYZING 左栏可读**的文档源,**不引入新概念**。

`Asset`(附件素材)是 [ADR-0015](0015-prd-file-upload-and-editing.md) D5 定义的 `.docx` 解出的图片集合——本 ADR 让 Asset 在 PRD 内联渲染,**不引入独立 Tab**(详见 D2 候选 A)。

`requirement.md`(PRD)是 ADR-0015 / 决策 36 锁的"以 markdown 为唯一真相源"——本 ADR 左栏把它作为主文档呈现。

---

## Decision

通过 11 轮 grilling 会话,沉淀 D1-D6 决策:

### D1 · 主区布局改为 2:1 左右分栏(覆盖 ADR-0013 §"工位主区布局")

**原文**:ANALYZING 主区 = **左栏 2 份**(文档对照阅读器)+ **右栏 1 份**(识别产物,可编辑)。

**对比原 1:1**:
- ❌ **删除** `<ThinkingStream>` 组件(过程性 UI,与"对照阅读"诉求冲突;AI 思考过程作为内部状态保留,但不再有独立 UI 区域)
- ✅ **新增** 主区左侧"文档阅读器"(详见 D2)
- ✅ **保留** `<ProductList>`(右栏,可编辑;ADR-0013 D2 ③ 不变)
- ✅ **保留** 顶部 `StageStrip + Toolbar + AdmissionDashboard + SessionTabs + TechBriefPanel`(均不变)
- ✅ **保留** 底部 `InterjectInput`(不变)
- ✅ **保留** 打字机 phase state machine 内部逻辑(pause / reset / skip)——仅 UI 不再展示

**比例**:
- 左栏 2/3 ≈ 66.67%(用 Tailwind `grid-cols-3` 子列 `col-span-2`,或自定义 `flex-basis: 66.67%`)
- 右栏 1/3 ≈ 33.33%
- **窄视口(<1024px)**:左栏折叠为顶部 Tab 切换 + 全屏阅读器,右栏 ProductList 走抽屉(具体 UX 本 ADR 不锁,落地 issue 决定)

**与原 1:1 决策的关系**:
- 原 ADR-0013 §"工位主区布局"中的 ASCII 图(`🧠 思考流(左) | 🎯 识别产物(右)`)**整体作废**,替换为本 ADR D1 + D2
- ADR-0013 D2 ② "解析过程观察"(打字机 + 插话)仍生效——但 UX 形态从"主区左栏可见"改为"内部状态保留 + StatusBar AI 区显示 + InterjectInput 接收"
- 打字机 phase state machine(analyzing-zone.tsx 第 257-309 行)不删,仅去掉 `<ThinkingStream>` 渲染出口

### D2 · 左栏 = Tab 栏 + 单文档阅读器

**原文**:左栏顶部 = Tab 栏(每个文档一个 Tab),下方 = 单文档阅读器(当前 Tab 的全文渲染)。

**Tab 内容**:从需求根目录派生,顺序如下:
1. **PRD** —— `requirement.md`(必有;若不存在 → 走旧 `EmptyAnalyzing` 引导去 DRAFTING,行为不变)
2. **AuxFile × N** —— 按 `usage_tag` 排序分组(`api / data / research / sop / ui / other`);同组按 `filename` 字典序
3. **Asset 不占独立 Tab**——Asset 在 PRD 内联渲染(`![](assets/prd-1.png)` 由 `<MarkdownPreview>` 自然处理)

**Tab 标签**:
```
┌─────────────────────────────────────┐
│ [PRD · 🔗 3] [aux-api.md · 🔗 2]   │
│ [aux-data.md · 🔗 1]                │
└─────────────────────────────────────┘
```
- 默认选中 PRD(AuxFile 列表折叠显示,后端按需加载)
- "🔗 N 处引用" = 该文档在所有 `AnalyzingChunk.source_refs` 中被引用的次数
- 0 处引用的 Tab 不显示"🔗 0",改为"·"(中性)

**阅读器**:
- 当前 Tab 的 Markdown 全文渲染(沿用 [`<MarkdownPreview>`](../apps/web/src/components/markdown-preview.tsx) 实现,Asset 图片同款渲染)
- 对当前文档的 `source_refs` span(PRD 行范围 / AuxFile 行范围)加**底色高亮**:
  - 默认色:`bg-brand-50`(蓝色 0.1 透明度)
  - hover 时:`bg-brand-100 / 60`(更深)
  - 多个产物引用同一 span → 同一高亮,无堆叠色差
- 鼠标 hover 高亮 span → 浮 tooltip 显示"被 X 个产物引用"+ "点击跳到产物列表"
- Asset 图片若被引用(`source_ref: {kind: 'asset', assetId}`)→ 图加 2px brand-300 描边 + 角标小图标

**Tab 切换**:纯客户端 state,切换不触发网络请求(所有文档已在 SSR 注入 props,见 D5 数据流)。

### D3 · `AnalyzingChunk` 加 `source_refs?: SourceRef[]`(覆盖"识别产物视角"假设)

**原文**:在 [`AnalyzingChunk`](../apps/web/src/lib/analyzing.ts#L67-L74) 接口新增 **可选** 字段 `source_refs: SourceRef[]`,与 `id / ts / label / text / kind / tone` 平级。

```ts
/** chunk 关联的源出处;narration chunk 一律省略,subproblem/risk/option chunk 可选 */
export type SourceRef =
  | { kind: 'prd'; lineRange: [number, number]; quote?: string }
  | { kind: 'aux'; auxId: string; lineRange: [number, number]; quote?: string }
  | { kind: 'asset'; assetId: string }

export interface AnalyzingChunk {
  id: string
  ts: string
  label: AnalyzingChunkLabel
  text: string
  kind: AnalyzingChunkKind
  tone: AnalyzingChunkTone
  source_refs?: SourceRef[]  // ← NEW;narration(START/READ/SCAN/MATCH/INFER/THINK/COMPLETE)省略
}
```

**字段约束**:
- `source_refs` 仅出现在 `kind: 'subproblem' | 'risk' | 'option'` 的 chunk 上
- `narration` chunk 一律不写该字段(SSE chunk 生成层保证)
- 数组可空数组(`[]`)表示"AI 明确不引用源",也可省略(语义相同)
- `quote?` 可选存原文片段(用于 SSR 兜底渲染 + lineRange 漂移时 sanity check)
- `lineRange: [number, number]` 是 0-based 半开区间 `[start, end)`,对齐 `extractPrdAnchors`([packages/shared/src/drafting.ts:143](../packages/shared/src/drafting.ts)) 已有约定

**数据流**:
- AI 在 `chunk.text` 生成**同一时刻**写 `source_refs`(AI 此时才知道"看了哪段才得此结论")
- chunks.jsonl(`analysis/sessions/<sid>/chunks.jsonl`)持久化时**全字段落盘**(包括 `source_refs`)
- `deriveProducts(chunks)` 派生 product 时**透传** `source_refs`(`AnalyzingProductItem` 同步加 `source_refs?: SourceRef[]` 字段)
- 重扫(ADR-0013 D11)→ AI 重新写 chunks → `source_refs` 一起刷新

### D4 · 点击 issue → 联动左栏

**原文**:右栏 `ProductList` 卡片可点击 → 触发左栏联动:

| 用户操作 | 左栏反应 | 右栏反应 |
|---|---|---|
| 点右栏 product 卡片(普通态) | 切到该卡片**第一个** `source_ref` 对应的 Tab + 滚到 lineRange + 高亮 pulse 1.5s | 该卡片短暂高亮 1.5s |
| 点右栏 product 卡片(无 source_ref) | 提示 toast"该产物未关联原文出处" | 无变化 |
| 点右栏 product 卡片(多 source_ref) | 切到第一个 Tab + 滚到第一个 source;卡片右上显示"🔗 N 处",可循环点 | 同上 |
| hover 左栏高亮 span | 显示 tooltip"N 个产物引用此段" | 不动 |
| click 左栏高亮 span | (本期不联动右栏;D4 v2 候选) | (本期不联动) |

**实现要点**:
- 左栏阅读器维护 `pulseRef: React.RefObject<HTMLElement>`,接受外部 trigger 时调 `el.scrollIntoView({behavior: 'smooth', block: 'center'})` + 添加 `animate-pulse-brand` class 1.5s 后移除
- 父子通信:右栏 ProductList 加 `onClick?: (itemId: string) => void` 回调,父 `AnalyzingContent` 维护 `activeSourceRef: SourceRef | null` state,传给左栏阅读器
- 多 source 循环:卡片右上角"+ N"按钮可展开,显示所有 source_refs 列表

**本期不实现**:
- ❌ 点左栏 span → 滚动右栏卡片(留 v2 候选,理由:右栏 ProductList 是长列表,滚动目标可能不在视口内,UX 容易翻车)

### D5 · 数据流 + 加载机制

**原文**:SSR 一次性注入 PRD + AuxFile + Asset 全文到 `AnalyzingData`,客户端切换 Tab 不触发网络。

**`AnalyzingData` 扩展**(覆盖 [analyzing.ts:293](../apps/web/src/lib/analyzing.ts#L293)):
```ts
export interface AnalyzingData {
  // ...existing fields...
  /** PRD 全文(必传,SSR 已读 requirement.md) */
  prdMarkdown: string
  /** 辅助文件列表(可能为空;SSR 按 usage_tag 排序) */
  auxFiles: AuxFile[]
  /** PRD 引用的 Asset 列表(来自 analysis of requirement.md 的 image refs + 落盘 assets/) */
  assetList: Asset[]
}
```

**SSR 加载逻辑**(在 [`analyzing.server.ts`](../apps/web/src/lib/analyzing.server.ts) `getAnalyzingData()` 末尾追加):
1. 读 `requirement.md` → 注入 `prdMarkdown`
2. 扫描 `requirements/<id>/aux/` 子目录(实际目录 layout 由 drafting-redesign ticket 决定;本期假定 `<reqDir>/aux/<aux-id>/<file>.md`,body 直接读出)→ 注入 `auxFiles`
3. 解析 `requirement.md` 的 `![](assets/...)` 引用 → 与 `requirements/<id>/assets/` 目录 readdir 比对 → 注入 `assetList`(孤儿 asset 忽略)

**客户端**:
- 左栏 `<DocumentReaderPane>` 接 `prdMarkdown / auxFiles / assetList` props,内部维护 `activeTabId: string` state
- Tab 切换 = 切换 activeTabId,纯前端,**不发请求**
- 阅读器在 `prdMarkdown` 改动(SSR re-render / 路由切换)时自动同步

**与决策 36 / ADR-0006 的关系**:
- PRD 全文走文件系统读(`requirement.md`)→ markdown 是真相源 ✓
- AuxFile 全文走文件系统读(`aux/<id>/<file>.md`)→ 仍 markdown ✓
- Asset 走文件系统读(`assets/prd-N.<ext>`)→ 决策 36 / ADR-0015 D5 已落 ✓

### D6 · synthetic chunk(覆盖 ADR-0013 D2 ③ VS4 的"用户加 product"路径)

**原文**:VS4 用户在右栏手动加 product(ADR-0013 D2 ③ 增/删/改/合并的"+ 新增子问题"路径) → 不发 SSE chunk → 必须**合成**一个 placeholder chunk 落到 chunks.jsonl,保持 chunks.jsonl 是唯一真相源。

**合成形态**:
```ts
{
  id: `user-added-${crypto.randomUUID()}`,  // id 前缀 sentinel 一眼区分
  ts: '<添加时刻>',
  label: 'DETECT' | 'RISK' | 'OPTION',     // 与 kind 镜像
  text: '<用户填的 title> 或空',
  kind: 'subproblem' | 'risk' | 'option',
  tone: 'info',
  source_refs?: SourceRef[],                 // 用户在 add dialog 里选;未选 = 省略
  synthetic: true,                           // ← 显式标记
}
```

**规则**:
- `source_refs` 可省略 → UI 卡片显示角标"⚠️ 无出处"(视觉区分)
- 不强制要求"用户加 product 必须带源"——保留"先记草稿"灵活性
- `synthetic: true` 在 chunks.jsonl 持久化,与 AI 输出的 chunk 同格式落盘
- 重扫(ADR-0013 D11)→ AI 不复读 `synthetic: true` 的 chunk(AI prompt 层过滤);但 chunks.jsonl 中的 synthetic 行**保留**(用户输入不丢)

**deriveProducts 行为**:
- 透传 `synthetic` 标记到 `AnalyzingProductItem.synthetic?: boolean`
- UI 层根据 `synthetic` 决定:
  - 是否显示"⚠️ 无出处"角标(若 source_refs 缺失)
  - 是否允许 [🔄 重扫] 时覆盖(默认 false,保留用户输入)

---

## 工位主区布局(替代 ADR-0013 §"工位主区布局")

```
ANALYZING 工位主区(顶到底):
┌──────────────────────────────────────────────────────────┐
│ Stage strip(② 分析徽章 + 进度 + 状态)                    │ 保留
├──────────────────────────────────────────────────────────┤
│ Toolbar(面包屑 + 复制/暂停/重置)                          │ 保留
├──────────────────────────────────────────────────────────┤
│ 准入仪表板(5 维度卡 + verdict 徽章 + 待裁决 N)            │ 保留
├──────────────────────────────────────────────────────────┤
│ SessionTabs(多会话 Tab)+ TechBriefPanel(右对齐)          │ 保留
├──────────────────────────────────────────────────────────┤
│ ⚙️ 启动前解析参数配置面板(折叠为 ⚙️ 入口)                 │ D2 ① 保留
├──────────────────── 2 份 ──────────────┬─── 1 份 ────────┤
│ 📑 文档阅读器                          │ 🎯 识别产物     │ D1 · D2
│ [PRD · 🔗 3] [aux-api · 🔗 2] [...]    │ 📌 子问题 N    │ D3 · D4
│                                       │ ⚠️ 风险点 N    │
│ ## 退款功能优化                        │ 🎨 方案方向 N   │
│                                       │                 │
│ 退款单笔金额上限 ≤ 1000 元 ▓▓ ← 高亮  │ [各卡片 + 角标] │
│ [配图 1]                              │ "⚠️ 无出处"     │
│ 退款审核流由财务人工审核                │ (无 source 时)  │
│ [...]                                  │                 │
├──────────────────────────────────────────────────────────┤
│ 💬 插话输入条(用户随时补充上下文 / 反向提问)              │ D2 ② 保留
├──────────────────────────────────────────────────────────┤
│ AI 思考条(全局,内容由工位注入) 🟣 AI 思考中 · 评估方案 B  │ 保留
└──────────────────────────────────────────────────────────┘
```

**与原 ADR-0013 ASCII 图的核心区别**:
- ❌ 删除左栏"🧠 思考流"打字机卡片
- ✅ 左栏改为"📑 文档阅读器"(Tab + Markdown 渲染 + 高亮)
- ✅ 左栏:右栏 = 2:1(原 1:1)
- ✅ 右栏卡片支持点击 → 左栏联动

---

## 与现有决策的关系

### 覆盖 ADR-0013 §"工位主区布局"

| 原 ADR-0013 §"工位主区布局" | 本 ADR 改写后 |
|---|---|
| 主区 = 思考流(左) + 产物(右)1:1 | 主区 = 文档阅读器(左,2 份) + 产物(右,1 份)2:1 |
| 保留 `<ThinkingStream>` 打字机 | **删除** 渲染;phase state machine 内部保留供 StatusBar / 插话使用 |
| 决策产物出处无视觉锚点 | `AnalyzingChunk.source_refs` + `<DocumentReaderPane>` 高亮 + D4 联动 |

### 补充 ADR-0013 D2 ③

| 原 ADR-0013 D2 ③ | 本 ADR 补充 |
|---|---|
| 识别产物交互编辑(增 / 删 / 改 / 合并) | **+ 与原文出处画线关联**:D3 source_refs + D4 联动 + D6 synthetic chunk |
| VS4 用户加 product 无源 | D6 合成 synthetic chunk 落 chunks.jsonl,UI 角标提示 |

### 与决策 52 / 53 / 23 的兼容性

| 决策 | 内容 | 本 ADR 兼容性 |
|---|---|---|
| 决策 23 | 取消右栏常驻 | ✅ 保留(右栏 ProductList 是主区内 1 列,不是常驻右栏) |
| 决策 52 | 资源树按工位 = 仅 DRAFTING/EXECUTING/WRAP-UP | ✅ 保留(本 ADR 左栏是主区"文档阅读器",非 tree 形态) |
| 决策 53 | Inline 栏仅 DRAFTING/EXECUTING | ✅ 保留(本 ADR 左栏是主区内 1 列,非右栏 inline rail) |
| 决策 36 | markdown 为唯一真相源 | ✅ 保留(PRD + AuxFile 全是 md;Asset 是用户原始输入,沿 ADR-0015 D5) |

### 强化决策 24(陪伴哲学)

- 用户在 ANALYZING 的核心诉求从"看 AI 思考"转向"对照原文审视 AI 产物"
- 这与决策 24 "不打扰,但陪伴" 不冲突:AI 思考过程**仍在跑**(内部 phase state machine 保留),只是不在主区左栏可见——避免"用户想看产物出处时被 AI 思考过程刷屏"
- 思考过程的可视化降级到 StatusBar AI 区(决策 49)+ InterjectInput 接收互动——保持"可见但不抢焦"(决策 43 a)

### 与 ADR-0011 §5 工位-资源树对应表

**不需修改** —— 该表"ANALYZING = 无资源树 / 无 Inline 栏" 仍正确;本 ADR 新增的"主区文档阅读器"是**第三种形态**,在该表没有对应列(待 v2 扩展时再加)。

---

## Consequences

### 正面

- **AI 识别可追溯**——每个产物都能看到 AI 是从原文哪段得出的,信任度↑
- **PRD 修改闭环**——用户在 DRAFTING 改完 PRD,切回 ANALYZING 左侧自动同步(SSR 重新拉取),右侧产物 source_refs 落空时 AI 自动重扫
- **画线联动**——点右栏产物 → 左栏秒切 / 高亮,UX 无需跨工位跳转
- **左栏常驻 3 类源**——PRD + Asset + AuxFile 都是用户原始输入的天然聚合,符合"对照阅读"心智模型
- **决策 52 / 53 兼容**——不引入新概念(都是已有术语的新组合),决策表无回归
- **多源引用真实场景**——`source_refs[]` 数组支持"PRD 没写 X + aux 显示 Y → 风险"这类复合判断
- **synthetic chunk 保真**——用户输入的产物永不丢,重扫不覆盖

### 负面 / 代价

- **chunks.jsonl 体积增加**——每个 subproblem/risk/option chunk 多带 `source_refs` 字段(JSON 平均 +50 字节/条);按 100 条估算 +5KB,可忽略
- **AI prompt 工程量↑**——AI 在 emit chunk 时需多输出"我看了哪段";prompt 模板要更新
- **`AnalyzingData` 字段膨胀**——新增 `prdMarkdown` / `auxFiles` / `assetList`(合计可能 +几十 KB per SSR);需评估 RSC 序列化大小
- **窄视口未锁**——`<1024px` 时左栏折叠形态本 ADR 不锁,落地 issue 决定
- **DRAFTING → ANALYZING 数据耦合**——AuxFile 数据源从 DRAFTING 复用,需要确保两个工位的 fs 路径布局一致;违反时需 fix 路径而非改本 ADR
- **synthetic chunk 复杂度**——重扫时 AI 不复读 synthetic 行的 prompt 过滤逻辑需要测试覆盖;若漏过滤会复读用户输入

### 风险缓解

| 风险 | 缓解措施 |
|---|---|
| AI 输出的 `source_refs` 错位(lineRange 漂移) | `quote?` 字段存原文片段做 sanity check;SSR 渲染时若 quote 与 lineRange 处文本不一致 → 走 quote 兜底定位 |
| AuxFile 路径布局漂移 | 落盘路径由 drafting-redesign ticket 01 锁定 `<reqDir>/aux/<aux-id>/<file>.md`;本 ADR 引用之,不重复定义 |
| chunks.jsonl 性能 | SSE re-emit 时已是大批量;`source_refs` 增量可忽略;若未来瓶颈再考虑 columnar 存储 |
| AI 复读 synthetic chunk | ADR-0013 D11 重扫 prompt 模板明确"忽略 synthetic: true";ticket 落地时写单测 |
| 用户加 product 漏标源 | D6 不强制;UI 角标"⚠️ 无出处"主动提示;落 issue 加"批量补源"工具(本期不做) |

---

## Alternatives Considered

### A · 维持 ADR-0013 §"主区 1:1" 不变

- 优势:零返工,issue 19b/19c/19d 继续推进
- 拒绝:用户故事"产物出处可视化"无法承载;产物 ↔ 原文仍需跨工位跳转

### B · 走"Inline 栏"路径(右栏)

- 优势:符合决策 53 现有形态
- 拒绝:决策 53 明确"仅 DRAFTING/EXECUTING 保留 Inline 栏";ANALYZING 加 Inline 栏是直接违反;且右栏 ProductList 已是主区右列,叠加会冲突

### C · 走"资源树"路径(决策 52 改写)

- 优势:沿用 DRAFTING 资源树 UI 风格
- 拒绝:PRD/AuxFile 在 ANALYZING 不需要层级导航;资源树需要 expand/collapse,UX 太重;且决策 52 的本意"避免在 ANALYZING 引入浏览态"是对的,本 ADR 不破

### D · source_refs 挂 `AnalyzingProductItem`(grilling Q3 第一次选择)

- 优势:产品视角独立;VS4 加 product 自然
- 拒绝:需引入 `products.yaml` 或 `citations.yaml` 新文件,破坏决策 36"markdown/jsonl 为唯一真相源";deriveProducts 不再是纯函数

### E · (已选) 2:1 主区分割 + source_refs 挂 chunk + Tab 阅读器 + synthetic chunk

- 优势:完整承载"产物 ↔ 原文"诉求;决策 36/52/53 全部兼容;chunks.jsonl 单一真相源
- 代价:chunks.jsonl 体积微增;AI prompt 工程量↑

---

## 落地 Issue(待拆分)

将本 ADR 拆分为以下 ticket,落到 `.scratch/analyzing-doc-reader/issues/`(新建):

1. **`01-foundation-data-model.md`** —— `AnalyzingChunk` / `AnalyzingProductItem` 加 `source_refs` 字段;`AnalyzingData` 加 `prdMarkdown` / `auxFiles` / `assetList`;SSR loader 改造
2. **`02-document-reader-pane.md`** —— 新建 `<DocumentReaderPane>` 组件(Tab 栏 + 单文档阅读器 + 高亮渲染);删除 `<ThinkingStream>` 渲染出口
3. **`03-source-citation-rendering.md`** —— 阅读器高亮 span 实现 + hover tooltip;产物卡片 click → 联动阅读器(切 Tab + 滚 + pulse)
4. **`04-synthetic-chunk-handling.md`** —— VS4 add product 路径合成 `synthetic: true` chunk;UI 角标"⚠️ 无出处"显示
5. **`05-narrow-viewport-and-tests.md`** —— 窄视口折叠 + 全量单元测试 + E2E 验证

**优先级**:
- P0:01(数据契约)+ 02(主 UI)+ 03(联动)——核心闭环
- P1:04(synthetic chunk)——VS4 已实装的延续
- P2:05(窄视口)——可用性问题

---

## 相关文档

### 用户故事与决策

- 本 ADR 由 11 轮 `/grill-with-docs` grilling 会话沉淀(2026-07-21)
- 用户原始痛点:"识别出的风险点 Q3 我想确认是 PRD 哪段话导致的"

### 关联 ADR / Issue

- [ADR-0013](0013-analyzing-zone-rewrite.md) D2 ③ / D7 / D11 —— 本 ADR 父 ADR
- [ADR-0015](0015-prd-file-upload-and-editing.md) D5 —— Asset 定义
- [drafting-redesign/issues/01](../.scratch/drafting-redesign/issues/01-foundation-data-and-zone-metadata.md) —— AuxFile 数据模型
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) —— 工位自适应 / 决策 52 兼容性
- [CONTEXT.md](../CONTEXT.md) 决策 23 / 36 / 52 / 53 —— 全部保留

### 现有 ADR-0013 issue 文件延续

| 原 issue | 本 ADR 范围 |
|---|---|
| 19b-analyzing-thinking-stream-interject | 思考流组件**删除**(D1),interject 输入条保留 |
| 19c-analyzing-session-tabs | 不变(多会话 Tab 保留) |
| 19d-analyzing-product-edit | 保留 VS4 + 加 synthetic chunk(D6) |
| 19e-analyzing-tech-brief-generation | 不变 |
| 19f-analyzing-adjudication-crosszone-clarifying-handoff | 不变 |

---

## 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-21 | 初稿:基于 11 轮 grilling 会话,沉淀 D1-D6,新增主区文档阅读器与画线关联机制 | Grilling 会话 |