/**
 * ANALYZING 工位数据层 — client-safe 部分(ADR-0011 §6 ANALYZING 布局 ·
 *   ADR-0013 工位重写 · issue 19)
 *
 * 形态从"旁观 AI 解析"重写为"PRD 准入 + 技术概要协作工作台"。
 *
 * 顶层数据布局(issue 19a VS1):
 * - admission: 准入仪表板(5 维度 + verdict + 待裁决 N)
 * - sessions / session: 多会话(后续 slice 填充)
 * - techBriefPath / modulesYamlPath / adjudicationPath: 产物路径(后续 slice 填充)
 * - chunks / stats / summary / toolbar: 兼容原"观察屏"接口,本期不破坏
 *
 * 数据形态(对应 SSE chunk):
 * - 每个 chunk = 一行思考产物(label + text + ts + tone)
 * - chunks 中含 kind: 'subproblem' | 'risk' | 'option' 的项目被计入顶部 stats
 * - isComplete = true 时,UI 弹"AI 分析完成,切到 CLARIFYING 吗?"提示
 *
 * 设计原则(沿用 EXECUTING/DRAFTING 工位):
 * - 纯函数 + 类型化,便于单元测试
 * - 显式标注 async 为后续接 agent API 时的接口稳定
 * - 数据由 server 注入,组件只关心渲染 + 客户端打字机控制
 *
 * 模块拆分说明(issue 19a/19b · Webpack `UnhandledSchemeError` 修复):
 * 本文件只保留 client-safe 内容(types / 纯函数 / mock 常量)。RSC 端的数据获取与
 * 文件 IO 已搬到 `./analyzing.server.ts`(详见该文件顶注)。client component
 * 只能引用本文件;引用 `./analyzing.server.ts` 会失败或越界到服务端代码。
 */

import {
  ADMISSION_DIMENSION_META,
  DEFAULT_ADMISSION_DIMENSIONS,
  type AdmissionDimensionId,
  type AssetMeta,
  type AuxFile,
} from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 思考流单 chunk 标签:对应 SSE 推送事件类型 */
export type AnalyzingChunkLabel =
  | 'START'
  | 'READ'
  | 'SCAN'
  | 'MATCH'
  | 'DETECT'
  | 'RISK'
  | 'INFER'
  | 'THINK'
  | 'OPTION'
  | 'COMPLETE'

/** chunk 语义分类:决定被顶部 stats 计入哪一类 */
export type AnalyzingChunkKind = 'narration' | 'subproblem' | 'risk' | 'option'

/** chunk 视觉调色(info=brand 蓝,success=绿,warn=黄,err=红) */
export type AnalyzingChunkTone = 'info' | 'success' | 'warn' | 'err'

/**
 * AI 思考流单 chunk —— 一次 SSE 推送对应一条 chunk。
 *
 * - label: 步骤标签(START/READ/DETECT 等),UI 渲染为彩色徽章
 * - text:  这一步骤的描述文字
 * - ts:    时间戳(形如 "14:23:01")
 * - kind:  决定是否计入顶部 stats(subproblem/risk/option 三类计数)
 * - tone:  决定 label 徽章背景色与左侧 border 颜色
 * - source_refs: chunk 关联的源出处(ADR-0017 D3);**narration chunk 一律省略**,
 *   仅 `subproblem` / `risk` / `option` 类型的 chunk 可能携带。SSR / 持久化
 *   层写入前用 `isSourceRef` 校验,运行时通过 type guard 容错历史数据。
 * - synthetic:是否为 VS4 "用户手加 product" 合成的 chunk(ADR-0017 D6);落到
 *   chunks.jsonl 保留用户输入,重扫时 AI prompt 层过滤;本 ticket 01 仅声明
 *   字段,落地逻辑见 ticket 04
 */
export interface AnalyzingChunk {
  id: string
  ts: string
  label: AnalyzingChunkLabel
  text: string
  kind: AnalyzingChunkKind
  tone: AnalyzingChunkTone
  /** 可选:仅 kind !== 'narration' 时存在;JSONL 落盘时显式包含或省略,不写 null */
  source_refs?: SourceRef[]
  /** 可选:是否为合成的用户添加项(ADR-0017 D6 — 落地逻辑见 ticket 04) */
  synthetic?: boolean
}

/** 顶部 stats 三档计数(对应原型 .summary-stat 三块) */
export interface AnalyzingStats {
  subproblems: number
  risks: number
  options: number
  /** 三个数字之和(便于渲染 "5 + 3 + 2" 类提示) */
  total: number
}

/** 思考流元数据 */
export interface AnalyzingStreamMeta {
  /** chunk 总数;UI 渲染 "X / Y" 进度 */
  totalChunks: number
  /** 流式是否仍在进行(false = 已全部到达,可弹完成提示) */
  isStreaming: boolean
  /** 流式开始时间(ISO);UI 渲染 "已运行 14s" */
  startedAt: string
  /** 流式结束时间(ISO);isStreaming=false 时存在 */
  endedAt: string | null
}

/** Toolbar(面包屑 + 动作按钮) */
export interface AnalyzingToolbarCrumb {
  label: string
  current?: boolean
}

/** Toolbar 按钮 —— 仅含 UI 决策(文案 + 样式),不绑定 ID。
 *  对齐 EXECUTING 样板的 `ToolbarAction` 设计;业务特定动作(如"复制思考产物")
 *  通过 variant 区分,本期不区分 ID。 */
export interface AnalyzingToolbarAction {
  label: string
  variant: 'primary' | 'secondary' | 'danger' | 'ghost'
}

export interface AnalyzingToolbar {
  crumb: AnalyzingToolbarCrumb[]
  actions: AnalyzingToolbarAction[]
}

/** 顶部摘要(原型 .thinking-summary:大图标 + 标题 + 描述 + 三 stats) */
export interface AnalyzingSummary {
  icon: string
  title: string
  description: string
}

// ---------------------------------------------------------------------------
// 源出处引用(ADR-0017 D3 · 本 ticket 01 落地)
// ---------------------------------------------------------------------------

/**
 * SourceRef 3 种子类型的 **brand 标记**(ADR-0017 D3 · ticket 01 验收)。
 *
 * 三种 kind 各自带 nominal brand:`PrdSourceRefBrand` / `AuxSourceRefBrand` /
 * `AssetSourceRefBrand`。TS 结构化类型默认不能区分三者(都是 `{kind: 'prd'|'aux'|'asset'}`),
 * 通过 brand 字段让它们在类型层不可互换 —— 调用方必须先经过 `isSourceRef`
 * narrow 出 kind 才能访问对应字段,杜绝把 `prd` 当 `aux` 之类混淆。
 *
 * 实现形式:`unique symbol` 索引签名;brand 字段**可选**,允许外部字面量构造
 * (literal `{kind:'prd',...}` 不必写 brand;经过 `isSourceRef` 后的对象在 TS 视角
 * 等同已带 brand)。runtime 校验完全由 `isSourceRef` 按 kind 完成(symbol 在编译
 * 后被擦除,不影响 JSONL 序列化)。
 */
declare const PrdSourceRefBrand: unique symbol
declare const AuxSourceRefBrand: unique symbol
declare const AssetSourceRefBrand: unique symbol

/**
 * PRD 源出处:指名 `requirement.md` 的 `[startLine, endLine)` 行范围
 * (lineRange 0-based 半开,对齐 `extractPrdAnchors` 的 `line` 约定);
 * `quote?` 可选存原文片段(SSR 兜底渲染 / lineRange 漂移时 sanity check)。
 */
export type PrdSourceRef = {
  readonly kind: 'prd'
  readonly lineRange: readonly [number, number]
  readonly quote?: string
  readonly [PrdSourceRefBrand]?: 'prd'
}

/**
 * AuxFile 源出处:指名某个 AuxFile(`auxId` 严格等于 `AuxFile.id`);
 * 行范围语义同 prd。
 */
export type AuxSourceRef = {
  readonly kind: 'aux'
  readonly auxId: string
  readonly lineRange: readonly [number, number]
  readonly quote?: string
  readonly [AuxSourceRefBrand]?: 'aux'
}

/**
 * Asset 源出处:指名某张 Asset(`assetId` 等于 `AssetMeta.name`);不带行范围
 * (资产无行概念)。
 */
export type AssetSourceRef = {
  readonly kind: 'asset'
  readonly assetId: string
  readonly [AssetSourceRefBrand]?: 'asset'
}

/**
 * `SourceRef` discriminated union(ADR-0017 D3)—— 三种 brand 子类型并集。
 *
 * 字段约束:
 * - kind ∈ {'prd'|'aux'|'asset'} 必填;`quote?` 可选存原文片段
 * - 仅出现在 `AnalyzingChunk.kind` 为 `subproblem` | `risk` | `option` 的 chunk 上,
 *   narration chunk 一律省略(由 SSE 推送层 + `loadSessionChunks` 运行时校验双重保证;
 *   若 narration chunk 在 JSONL 中带 source_refs,loader 会**丢弃** source_refs,
 *   不让"narration 不引用源"的契约被破坏)
 * - JSONL 持久化时显式包含数组(即使是空 `[]`)或省略字段;绝**不**写 `null`
 *   (体积优化,见 `serializeAnalyzingChunk`)
 */
export type SourceRef = PrdSourceRef | AuxSourceRef | AssetSourceRef

/**
 * 类型守卫:校验一个 `unknown` 是否符合 `SourceRef` 形态。
 *
 * 设计要点:
 * - 单一入口:JSONL 解析 / SSE 推送 / 任意来源数据都用此函数做窄化,
 *   避免每个调用点重复写结构校验
 * - 校验粒度遵循 **ADR D3 契约**(不私自收紧):
 *   - `lineRange`:必须是恰好 2 元素的有限数字元组(NaN/Infinity/倒置区间 → 拒绝)
 *   - `quote`:可选 string,允许空串/纯空白;非 string 拒绝
 *   - `auxId` / `assetId`:必填**非空** string(downstream 用作 AuxFile.id / AssetMeta.name
 *     查找;空字符串会破坏匹配,故拒绝)
 * - 不可信输入(`unknown`)→ `false`,而不是抛错
 *
 * @example
 * isSourceRef({ kind: 'prd', lineRange: [10, 20] }) // → true
 * isSourceRef({ kind: 'asset', assetId: 'prd-1.png' }) // → true
 * isSourceRef({ kind: 'prd', lineRange: [10] }) // → false(lineRange 缺位)
 * isSourceRef(null) // → false
 */
export function isSourceRef(value: unknown): value is SourceRef {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const kind = v.kind
  if (kind === 'prd' || kind === 'aux') {
    // 校验 lineRange:[number, number] 恰好两元素 + 有限 + 非倒置
    if (!isLineRangePair(v.lineRange)) return false
    // aux 必须有非空 auxId(downstream 用作 AuxFile.id 查找)
    if (
      kind === 'aux' &&
      (typeof v.auxId !== 'string' || v.auxId.length === 0)
    ) {
      return false
    }
    // quote 允许省略或任意 string;非 string 拒绝
    if (v.quote !== undefined && typeof v.quote !== 'string') return false
    return true
  }
  if (kind === 'asset') {
    // assetId 是非空 string(downstream 用作 AssetMeta.name 查找)
    return typeof v.assetId === 'string' && v.assetId.length > 0
  }
  return false
}

/**
 * 校验 `unknown` 是否为 `[number, number]` 形态(lineRange 半开区间)。
 *
 * - 数组长度恰好为 2;两元素必须是有限数字(`Number.isFinite` 拒绝 NaN/Infinity)
 * - 起点必须 ≤ 终点(若倒置则区间无意义,本期保守拒绝)
 *
 * 不导出(预留为 internal helper;若以后要给 SSE 层复用再 `export`)。
 */
function isLineRangePair(value: unknown): value is readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false
  const a = value[0]
  const b = value[1]
  if (typeof a !== 'number' || !Number.isFinite(a)) return false
  if (typeof b !== 'number' || !Number.isFinite(b)) return false
  if (a > b) return false
  return true
}

/**
 * chunk → SSE / JSONL 序列化(ADR-0017 D3 · 体积优化约束):
 * - `source_refs`:**显式包含数组(即使是空 `[]`)或省略字段**;绝不写 `null`
 * - narration chunk 与 `source_refs` 不兼容:无论源数据是否含字段,
 *   输出里 narration chunk 一律不带 `source_refs`(契约的二次保障;`loadSessionChunks`
 *   在 JSONL 装载侧也做同样处理,防止历史脏数据漏出)
 * - `synthetic`:显式写 `true` / `false`;缺省时省略 —— `false` 不是"缺省"的别名
 *
 * 输出是 plain object,直接 `JSON.stringify(...)` 或经 SSE 编码层送线。
 *
 * @example
 * serializeAnalyzingChunk({id:'c-1', ..., kind:'subproblem', source_refs: []})
 *   // → {..., kind:'subproblem', source_refs: []}  // 空数组显式保留
 * serializeAnalyzingChunk({id:'n-1', ..., kind:'narration', source_refs: [...]})
 *   // → {..., kind:'narration'}  // 强制省略
 */
export function serializeAnalyzingChunk(
  chunk: AnalyzingChunk,
): Record<string, unknown> {
  // base 字段:始终写
  const out: Record<string, unknown> = {
    id: chunk.id,
    ts: chunk.ts,
    label: chunk.label,
    text: chunk.text,
    kind: chunk.kind,
    tone: chunk.tone,
  }
  // narration 不写 source_refs(契约二次保障)
  if (chunk.kind !== 'narration' && chunk.source_refs !== undefined) {
    out.source_refs = chunk.source_refs
  }
  // synthetic:false 也写(显式声明非合成)
  if (chunk.synthetic !== undefined) {
    out.synthetic = chunk.synthetic
  }
  return out
}

// ---------------------------------------------------------------------------
// 识别产物(ADR-0013 D2 ③ · issue 19b VS2 只读视图)
// ---------------------------------------------------------------------------

/**
 * 识别产物单条 — 由 chunk.kind 派生
 *
 * - title:chunk.text 第一行(行首是 Q1· / A · 之类前缀,UI 显示时保留)
 * - description:余下文字(若 text 含多行)
 * - severity:从 chunk.tone 反查
 * - source_refs:从源 chunk 透传(ADR-0017 D3);UI 据此显示 "🔗 N 处" 与联动高亮
 * - synthetic:是否为 VS4 "用户手加 product" 合成的 chunk(ADR-0017 D6);
 *   `true` 时 UI 显示 "⚠️ 无出处" 角标(若 source_refs 缺失)
 */
export interface AnalyzingProductItem {
  id: string
  title: string
  description?: string
  severity: 'red' | 'orange' | 'yellow' | 'green' | 'blue'
  /** 可选:从 chunk.source_refs 透传;UI 据此联动左栏阅读器 */
  source_refs?: SourceRef[]
  /** 可选:是否为合成的用户添加项(ADR-0017 D6 — 落地逻辑见 ticket 04) */
  synthetic?: boolean
}

/** 三类产物的分组(对应原型 .identified-item 三类) */
export interface AnalyzingProductGroup {
  /** 📌 子问题(Q1 · 退款金额上限?...)*/
  subproblems: AnalyzingProductItem[]
  /** ⚠️ 风险点(高并发退款重复创建...)*/
  risks: AnalyzingProductItem[]
  /** 🎨 方案方向(A · 同步单阶段...)*/
  options: AnalyzingProductItem[]
}

/** chunk.tone → 产品 severity 映射(issue 19b · 与 admission 维度同色系) */
const TONE_TO_SEVERITY: Record<AnalyzingChunkTone, AnalyzingProductItem['severity']> = {
  info: 'blue',
  success: 'green',
  warn: 'orange',
  err: 'red',
}

/**
 * 派生识别产物:扫描 chunks 按 kind 分类,生成 ProductList 只读视图。
 *
 * 设计要点:
 * - 纯函数,便于单测
 * - text 第一行作为 title;剩余行(若有)作为 description
 * - severity 从 chunk.tone 反查,保证视觉一致
 * - **透传 source_refs / synthetic**(ADR-0017 D3 / D6):派生不修改这两个字段,
 *   由 chunk 落到 product;UI 据此渲染 "🔗 N 处" 角标与联动左栏高亮
 */
export function deriveProducts(chunks: readonly AnalyzingChunk[]): AnalyzingProductGroup {
  const subproblems: AnalyzingProductItem[] = []
  const risks: AnalyzingProductItem[] = []
  const options: AnalyzingProductItem[] = []

  for (const c of chunks) {
    if (c.kind === 'subproblem' || c.kind === 'risk' || c.kind === 'option') {
      const item = chunkToProduct(c)
      if (c.kind === 'subproblem') subproblems.push(item)
      else if (c.kind === 'risk') risks.push(item)
      else options.push(item)
    }
  }
  return { subproblems, risks, options }
}

/** 单 chunk → product item 转换(text 第一行作为 title) */
function chunkToProduct(chunk: AnalyzingChunk): AnalyzingProductItem {
  const lines = chunk.text.split('\n')
  const title = lines[0] ?? chunk.text
  const description = lines.length > 1 ? lines.slice(1).join('\n').trim() : undefined
  const item: AnalyzingProductItem = {
    id: chunk.id,
    title,
    description: description && description.length > 0 ? description : undefined,
    severity: TONE_TO_SEVERITY[chunk.tone],
  }
  // 透传 source_refs:undefined 不写字段(保持 JSONL 一致性 + UI 简化空值判断)
  if (chunk.source_refs !== undefined) {
    item.source_refs = chunk.source_refs
  }
  // 透传 synthetic:undefined 不写字段
  if (chunk.synthetic !== undefined) {
    item.synthetic = chunk.synthetic
  }
  return item
}

// ---------------------------------------------------------------------------
// 准入仪表板(ADR-0013 D4 / D10 · issue 19a VS1)
// ---------------------------------------------------------------------------

/** 准入维度(SSR 数据 — 由 Skill frontmatter 装配) */
export interface AdmissionDimension {
  /** 维度 id;默认 5 维度来自 AdmissionDimensionIdSchema,Skill add 的可自由 string */
  id: string
  /** 中文标签(资损安全 / 性能 / ...) */
  label: string
  /** 维度图标 emoji(🔴 🟠 🟡 🟢 💬 等) */
  icon: string
  /** 严重度(决定卡片左侧 border 颜色) */
  severity: 'red' | 'orange' | 'yellow' | 'green' | 'blue'
  /** 当前激活项数(由 AI 识别产物聚合) */
  count: number
}

/** 总体结论(仪表板右端徽章) */
export type AdmissionVerdict = 'pass' | 'pending' | 'fail'

/** 准入仪表板数据段 */
export interface AdmissionData {
  /** 当前激活的维度列表(顺序由 Skill 装配决定) */
  dimensions: AdmissionDimension[]
  /** 总体结论 */
  verdict: AdmissionVerdict
  /** 待裁决项数(由 analysis/adjudication.md 解析,applied: false 计数) */
  pendingAdjudicationCount: number
}

/** Skill frontmatter 的 admission 段(SSR 解析结果,可选) */
export interface SkillAdmissionFrontmatter {
  admission_dimensions?: string[]
  admission_override?: {
    add?: string[]
    skip?: string[]
  }
}

// ---------------------------------------------------------------------------
// 多会话(ADR-0013 D7 · issue 19c VS3)
// ---------------------------------------------------------------------------

/** 会话分析角度(决定 SessionTabs 默认标签 / icon) */
export type AnalysisSessionAngle = 'architecture' | 'data' | 'interface' | 'custom'

/**
 * ANALYZING 工位二态阶段(issue 重构 · 直接进入主区)。
 *
 * - 'empty':  requirement.md 不存在 → 走 <EmptyAnalyzing> 引导去 DRAFTING
 * - 'active': requirement.md 存在 → 走主区(SessionTabs + 打字机 / 思考流 / 插话),
 *             即使 fs 上还没有 sessions 也走主区(主区容错空 chunks / sessions)
 *
 * 与 `empty` 字段保持等价关系:`empty === true ⟺ phase === 'empty'`。
 */
export type AnalyzingPhase = 'empty' | 'active'

/**
 * ANALYZING 单个会话(对应 SessionTabs 的一个 Tab)
 *
 * - id:会话唯一标识(对应 `analysis/sessions/<id>/chunks.jsonl`)
 * - label:用户可见的会话名(默认按 angle 给出:"架构" / "数据" / "接口";自定义会话 = 用户输入)
 * - angle:分析角度,影响默认 icon 与排序
 * - detectedCount:已识别子问题数(Tab 数字徽章)
 * - isStreaming:会话是否仍在流式生成(决定徽章上的 "运行中" 标识)
 */
export interface AnalysisSession {
  id: string
  label: string
  angle: AnalysisSessionAngle
  detectedCount: number
  isStreaming: boolean
}

/** 会话角度默认元数据(issue 19c · 给 SessionTabs 用作 icon) */
export const ANALYSIS_SESSION_ANGLE_META: Record<
  AnalysisSessionAngle,
  { label: string; icon: string }
> = {
  architecture: { label: '架构', icon: '📐' },
  data: { label: '数据', icon: '💾' },
  interface: { label: '接口', icon: '🔌' },
  custom: { label: '自定义', icon: '✨' },
}

/**
 * ANALYZING 工位顶层数据
 *
 * ADR-0013 D2 ① / D4 / D7 对齐:
 * - admission(19a VS1 准入仪表板 5 维度)
 * - sessions / activeSessionId(19c VS3 多会话 Tab)
 * - chunks(当前 active 会话思考流,VS2 打字机)
 *
 * ADR-0017 D5 落地:prdMarkdown / auxFiles / assetList 由 SSR 一次性读 + 注入,
 * 客户端切换 Tab 不触发网络。
 *
 * 不破坏原"观察屏"接口(chunks / stats / summary / toolbar)——下游组件改造
 * 内部实现即可,数据契约向后兼容。
 */
export interface AnalyzingData {
  requirementId: string
  toolbar: AnalyzingToolbar
  summary: AnalyzingSummary
  chunks: AnalyzingChunk[]
  streamMeta: AnalyzingStreamMeta
  /** 顶部 stats(chunks 派生 —— 也可由调用方预聚合) */
  stats: AnalyzingStats
  /** 空数据(无需求 / 新建需求);UI 渲染引导去 DRAFTING */
  empty: boolean
  /**
   * 二态阶段(issue 重构 · 直接进入主区):
   * - 'empty':  requirement.md 不存在 → 走 <EmptyAnalyzing> 引导去 DRAFTING
   * - 'active': requirement.md 存在 → 走主区;fs 上是否有 sessions 都直接进,
   *             主区组件对 chunks=[] / sessions=[] 已做容错(显示"暂无思考流"等)
   *
   * 与 `empty` 字段保持等价关系:`empty === true ⟺ phase === 'empty'`。
   */
  phase: AnalyzingPhase
  /** 准入仪表板(issue 19a VS1 新增) */
  admission: AdmissionData
  /** 多会话列表(issue 19c VS3 新增,Tab 切换的数据源) */
  sessions: AnalysisSession[]
  /** 当前 active 会话 id(issue 19c VS3 新增,主区按此过滤) */
  activeSessionId: string
  /** 是否可生成技术概要(issue 19e VS5 · ADR-0013 D8 · 始终 true,verdict 不限制) */
  canGenerateBrief: boolean
  /** 技术概要 markdown 全文(双产物都不存在 → null) */
  techBriefPreview: string | null
  /** modules.yaml 解析后的结构(双产物都不存在 → null) */
  modulesPreview: import('./tech-brief').TechBriefModulesFile | null
  /** 最近生成时间 ISO 8601(由 mtime 派生;无产物 → null) */
  briefGeneratedAt: string | null
  /**
   * PRD Markdown 全文(ADR-0017 D5)。
   *
   * SSR 期由 `getAnalyzingData()` 从 `<requirementsRoot>/requirements/<id>/requirement.md`
   * 读出;requirement.md 不存在 → 空字符串。客户端左栏阅读器渲染与"🔗 N 处"高亮都据此字段。
   * 资产内联 `![](assets/<name>)` 由 `<MarkdownPreview>` 自然渲染(不需独立 Tab)。
   */
  prdMarkdown: string
  /**
   * 辅助文件列表(ADR-0017 D5)。
   *
   * SSR 期扫描 `<requirementsRoot>/requirements/<id>/aux/` 子目录(每个子目录 = 一个
   * AuxFile),按 `usage_tag` 6 类排序;空目录 / 不存在 → `[]`。本 ticket 01 不解析
   * `meta.yaml`(由 drafting 子系统维护),只读最简字段:`id / filename / body / usage_tag`
   * (其他字段 usage_detail 等在 ticket 02 + 后续 SSR 注入时再补)。
   */
  auxFiles: AuxFile[]
  /**
   * PRD 引用的 Asset 列表(ADR-0017 D5)。
   *
   * SSR 期两步:
   * 1) 解析 `requirement.md` 内 `![](assets/<name>)` 引用 → 收集 name 集合
   * 2) 与磁盘 `requirements/<id>/assets/` readdir 比对 → 仅返回实际存在的 asset
   * 孤儿 asset(磁盘有但 PRD 未引用)忽略;引用了不存在的 asset 不报错(忽略)。
   *
   * 字段对齐 `@ai-devspace/shared` 的 `AssetMeta` —— ADR-0015 D5 落地形态
   * (`{name, url, path, size, mime}`),`url` 可直接给前端 fetcher 使用。
   */
  assetList: AssetMeta[]
}

// ---------------------------------------------------------------------------
// 纯函数:从 chunks 聚合 stats
// ---------------------------------------------------------------------------

/**
 * 聚合 stats:扫描 chunks 计数 kind === 'subproblem' / 'risk' / 'option'。
 * 纯函数,组件渲染前预计算 + 测试可独立验证。
 */
export function summarizeAnalyzingStats(
  chunks: readonly AnalyzingChunk[],
): AnalyzingStats {
  let subproblems = 0
  let risks = 0
  let options = 0
  for (const c of chunks) {
    if (c.kind === 'subproblem') subproblems++
    else if (c.kind === 'risk') risks++
    else if (c.kind === 'option') options++
  }
  return {
    subproblems,
    risks,
    options,
    total: subproblems + risks + options,
  }
}

// ---------------------------------------------------------------------------
// 空数据(新建需求 / 未知 id)
// ---------------------------------------------------------------------------

/**
 * 空状态 ANALYZING 工位数据。
 * UI 渲染时若 data.empty === true → 走空态引导(去 DRAFTING 写 PRD)。
 *
 * ADR-0017 D5:SSR 注入 `prdMarkdown` / `auxFiles` / `assetList` 三字段,
 * 空态时给到容错默认值(空字符串 / `[]` / `[]`)。左栏阅读器对空态显示"暂无文档"占位。
 */
export function emptyAnalyzing(requirementId: string): AnalyzingData {
  return {
    requirementId,
    toolbar: { crumb: [], actions: [] },
    summary: { icon: '', title: '', description: '' },
    chunks: [],
    streamMeta: {
      totalChunks: 0,
      isStreaming: false,
      startedAt: '',
      endedAt: null,
    },
    stats: { subproblems: 0, risks: 0, options: 0, total: 0 },
    admission: buildAdmissionData({}),
    empty: true,
    phase: 'empty',
    sessions: [],
    activeSessionId: '',
    canGenerateBrief: true,
    techBriefPreview: null,
    modulesPreview: null,
    briefGeneratedAt: null,
    // ADR-0017 D5 SSR 注入字段 —— 空态默认值
    prdMarkdown: '',
    auxFiles: [],
    assetList: [],
  }
}

/**
 * admission 段构造器。
 *
 * - `dimensions`: 维度 id 列表(顺序固定,缺省时取默认 5 维度)
 * - `counts`: 每维度 count,缺省视为 0(可只传部分维度,未传维度按 0 处理)
 * - `pendingAdjudicationCount`: 仪表板右端徽章数(由 adjudication.md 计数)
 * - `verdict`: pass / pending / fail(根据维度 severity 与 counts 派生)
 */
export function buildAdmissionData(params: {
  dimensions?: readonly string[]
  counts?: Record<string, number>
  pendingAdjudicationCount?: number
  verdict?: AdmissionVerdict
}): AdmissionData {
  const ids =
    params.dimensions && params.dimensions.length > 0
      ? params.dimensions
      : DEFAULT_ADMISSION_DIMENSIONS
  const counts = params.counts ?? {}
  const dimensions = ids.map((id) => {
    const meta = ADMISSION_DIMENSION_META[id as AdmissionDimensionId]
    if (meta) {
      return {
        id,
        label: meta.label,
        icon: meta.icon,
        severity: meta.severity,
        count: counts[id] ?? 0,
      }
    }
    // Skill add 的自定义维度(没有 meta)→ 用占位
    return { id, label: id, icon: '🔵', severity: 'blue' as const, count: counts[id] ?? 0 }
  })
  return {
    dimensions,
    verdict: params.verdict ?? 'pending',
    pendingAdjudicationCount: params.pendingAdjudicationCount ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Skill frontmatter 维度装配(ADR-0013 D10)
// ---------------------------------------------------------------------------

/**
 * 装配准入维度集合:
 * 1. 若 Skill 提供 admission_dimensions → 用它作为基底(子集化)
 * 2. 否则 → 默认 5 维度
 * 3. 应用 admission_override.add / .skip
 * 4. add 中重复项去重(保留首次出现位置)
 *
 * 返回最终维度 id 列表(顺序固定),与 ADMISSION_DIMENSION_META 配合使用。
 */
export function resolveAdmissionDimensions(
  frontmatter: SkillAdmissionFrontmatter | undefined,
): string[] {
  const base: readonly string[] =
    frontmatter?.admission_dimensions && frontmatter.admission_dimensions.length > 0
      ? frontmatter.admission_dimensions
      : DEFAULT_ADMISSION_DIMENSIONS

  const skip = new Set(frontmatter?.admission_override?.skip ?? [])
  const filtered = base.filter((d) => !skip.has(d))

  const adds = frontmatter?.admission_override?.add ?? []
  const seen = new Set(filtered)
  const dedupAdds: string[] = []
  for (const id of adds) {
    if (!seen.has(id)) {
      seen.add(id)
      dedupAdds.push(id)
    }
  }
  return [...filtered, ...dedupAdds]
}

// ---------------------------------------------------------------------------
// analysis/adjudication.md 计数(SSR 期 mock 路径由调用方注入)
// 注:`countPendingAdjudications` 与 `countUnresolvedItems` 已搬到
// `analyzing.server.ts`(本文件不再做文件 IO)。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock 数据源 — 对应原型 11e ANALYZING(退款功能优化)
// ---------------------------------------------------------------------------

/**
 * 退款功能优化样例 —— 11 行思考流(其中 5 子问题 + 2 风险 + 2 方案方向)。
 * 对应原型 .thinking-stream 中的全部行;最后一行(THINK)是打字机当前正在打字的"活动行"。
 */
const REFUND_ANALYZING_CHUNKS: AnalyzingChunk[] = [
  {
    id: 'c-1',
    ts: '14:23:01',
    label: 'START',
    text: '接收需求文档(847 字)+ 2 个仓库路径',
    kind: 'narration',
    tone: 'info',
  },
  {
    id: 'c-2',
    ts: '14:23:02',
    label: 'READ',
    text: 'requirement.md · 抽取 5 个业务目标',
    kind: 'narration',
    tone: 'info',
  },
  {
    id: 'c-3',
    ts: '14:23:04',
    label: 'SCAN',
    text: 'refund-service · 识别 3 个相关模块',
    kind: 'narration',
    tone: 'info',
  },
  {
    id: 'c-4',
    ts: '14:23:05',
    label: 'MATCH',
    text: '知识库命中:退款业务 v2 · 退款幂等 pattern · bug history',
    kind: 'narration',
    tone: 'info',
  },
  // 5 个 subproblem(对应原型 .identified-item.subproblem × 5)
  {
    id: 'c-5',
    ts: '14:23:07',
    label: 'DETECT',
    text: 'Q1 · 退款单笔金额上限?PRD 未明确',
    kind: 'subproblem',
    tone: 'success',
  },
  {
    id: 'c-6',
    ts: '14:23:08',
    label: 'DETECT',
    text: 'Q2 · 退款审核流?自动 / 人工 / 阈值',
    kind: 'subproblem',
    tone: 'success',
  },
  {
    id: 'c-7',
    ts: '14:23:08',
    label: 'DETECT',
    text: 'Q3 · 退款失败时回滚策略?',
    kind: 'subproblem',
    tone: 'success',
  },
  {
    id: 'c-8',
    ts: '14:23:09',
    label: 'DETECT',
    text: 'Q4 · 退款幂等实现?幂等键 + 重试窗口',
    kind: 'subproblem',
    tone: 'success',
  },
  {
    id: 'c-9',
    ts: '14:23:09',
    label: 'DETECT',
    text: 'Q5 · 部分退款规则?单笔次数 + 累计上限',
    kind: 'subproblem',
    tone: 'success',
  },
  // 3 个 risk(对应原型 .identified-item.risk × 3)
  {
    id: 'c-10',
    ts: '14:23:10',
    label: 'RISK',
    text: '高并发退款重复创建(bug #247 · 相关度 0.82)',
    kind: 'risk',
    tone: 'warn',
  },
  {
    id: 'c-11',
    ts: '14:23:11',
    label: 'RISK',
    text: '退款失败优惠券未回滚(bug #312 · 相关度 0.91)',
    kind: 'risk',
    tone: 'warn',
  },
  {
    id: 'c-12',
    ts: '14:23:12',
    label: 'RISK',
    text: '微服务调用链路过长(5 跳)',
    kind: 'risk',
    tone: 'warn',
  },
  {
    id: 'c-13',
    ts: '14:23:13',
    label: 'INFER',
    text: '从退款幂等 pattern 推断:本需求必须包含幂等设计',
    kind: 'narration',
    tone: 'info',
  },
  // 2 个 option(对应原型 .identified-item.option × 2)
  {
    id: 'c-14',
    ts: '14:23:14',
    label: 'OPTION',
    text: 'A · 同步单阶段 · 单事务 · 250ms',
    kind: 'option',
    tone: 'success',
  },
  {
    id: 'c-15',
    ts: '14:23:14',
    label: 'OPTION',
    text: 'B · 异步多阶段 · 事件驱动 · 80ms',
    kind: 'option',
    tone: 'success',
  },
  {
    id: 'c-16',
    ts: '14:23:15',
    label: 'THINK',
    text: '正在评估方案 B 异步多阶段的失败回滚边界...',
    kind: 'narration',
    tone: 'info',
  },
  {
    id: 'c-17',
    ts: '14:23:18',
    label: 'COMPLETE',
    text: '分析完成 · 识别 5 子问题 + 3 风险 + 2 方案方向',
    kind: 'narration',
    tone: 'success',
  },
]

export const REFUND_ANALYZING: Omit<AnalyzingData, 'requirementId'> = {
  empty: false,
  phase: 'active',
  toolbar: {
    crumb: [
      { label: '退款功能优化' },
      { label: '/' },
      { label: '分析' },
      { label: '/' },
      { label: 'AI 思考过程', current: true },
    ],
    actions: [
      { label: '📋 复制思考产物', variant: 'secondary' },
      { label: '⏸ 暂停', variant: 'danger' },
      { label: '↶ 重置', variant: 'danger' },
    ],
  },
  summary: {
    icon: '🧠',
    title: 'AI 正在解析需求:退款功能优化',
    description:
      '正在扫描 2 个关联仓库 · 引用 3 条知识库记录 · 已识别子问题 / 风险点 / 候选方案方向',
  },
  chunks: REFUND_ANALYZING_CHUNKS,
  streamMeta: {
    totalChunks: REFUND_ANALYZING_CHUNKS.length,
    isStreaming: true,
    startedAt: '2026-07-12T14:23:01.000Z',
    endedAt: null,
  },
  stats: summarizeAnalyzingStats(REFUND_ANALYZING_CHUNKS),
  // issue 19a VS1 — admission 仪表板样例(2 资损 + 3 性能 + 1 架构 + 0 业务 + 4 上下文,
  // 因有 🔴 资损 → 默认 verdict='fail';pendingAdjudicationCount=10 模拟"待裁决 10")
  admission: buildAdmissionData({
    counts: {
      loss_prevention: 2,
      performance: 3,
      arch_conflict: 1,
      business_reasonable: 0,
      context_query: 4,
    },
    pendingAdjudicationCount: 10,
    verdict: 'fail',
  }),
  // issue 19e VS5 — tech brief preview 占位(实际数据由 server 端按需加载)
  canGenerateBrief: true,
  techBriefPreview: null,
  modulesPreview: null,
  briefGeneratedAt: null,
  // issue 19c VS3 — 多会话样例(架构 / 数据 / 接口 3 个 Tab,主区显示"数据"会话)
  sessions: [
    {
      id: 'sess-arch',
      label: '架构',
      angle: 'architecture',
      detectedCount: 3,
      isStreaming: false,
    },
    {
      id: 'sess-data',
      label: '数据',
      angle: 'data',
      detectedCount: 5,
      isStreaming: true,
    },
    {
      id: 'sess-interface',
      label: '接口',
      angle: 'interface',
      detectedCount: 8,
      isStreaming: false,
    },
  ],
  activeSessionId: 'sess-data',
  // ADR-0017 D5 — SSR 注入 PRD / AuxFile / Asset(mock 样例:退款功能优化的代表性内容)
  prdMarkdown: [
    '# 退款功能优化',
    '',
    '## 背景',
    '',
    '退款业务是电商核心链路之一,当前实现存在幂等问题导致重复退款;此外高并发场景下',
    '微服务调用链路过长(5 跳),失败时优惠券未回滚会导致资损。',
    '',
    '## 目标',
    '',
    '- 退款单笔金额 ≤ 1000 元',
    '- 退款审核流:自动 / 人工阈值 5000 元',
    '- 幂等键 + 7 天重试窗口',
    '',
    '![退款流程图](assets/refund-flow.png)',
    '',
    '## 验收标准',
    '',
    '- [ ] 高并发退款不重复创建(bug #247 复现)',
    '- [ ] 退款失败时优惠券回滚',
    '',
  ].join('\n'),
  auxFiles: [
    {
      id: 'aux-api-refund',
      filename: 'api-refund.md',
      usage_tag: 'api',
      source_format: 'md',
      converted_to_md: false,
      body: [
        '# 退款 API 文档',
        '',
        '## POST /api/refunds',
        '',
        '请求参数:`orderId`, `amount`, `reason`。',
        '幂等键:`Idempotency-Key` 头,7 天窗口。',
        '',
      ].join('\n'),
    },
    {
      id: 'aux-data-orders',
      filename: 'data-orders.md',
      usage_tag: 'data',
      source_format: 'md',
      converted_to_md: false,
      body: [
        '# 订单表设计',
        '',
        '`orders(id, amount, status, refund_status, created_at)`。',
        '',
      ].join('\n'),
    },
  ],
  assetList: [
    {
      name: 'refund-flow.png',
      url: '/api/requirement/req-001/assets/refund-flow.png',
      path: 'requirements/req-001/assets/refund-flow.png',
      size: 102400,
      mime: 'image/png',
    },
  ],
}

// 注:`getAnalyzingData` 与 `GetAnalyzingDataOptions` 已搬到 `analyzing.server.ts`。
// 本文件只保留 client-safe 的纯函数与 mock 常量 —— 任何 client component
// 不应触发 `getAnalyzingData`(数据应经由 RSC 注入 props)。
