/**
 * ANALYZING 工位数据层 — client-safe 部分(ADR-0021 · issue 08 契约收缩)
 *
 * issue 08 之后,ANALYZING 工位的领域模型只剩:
 * - Analysis Skill(workspace 集合 + per-Requirement 选择)
 * - Analysis Run(每次"开始分析"的独立识别任务)
 * - Analysis Issue(Run 内由模型报告的问题)
 * - Issue Response(用户对 Issue 的 Markdown 答复)
 * - Analysis Run Log(Run 期间的持久化运行记录)
 *
 * 旧领域模型 **全部删除**:
 * - Admission Dimension / Verdict / Pending Adjudication
 * - subproblem / risk / option 三桶 Product
 * - AnalysisSession + angle + Session Tabs + 创建对话框
 * - Technical Brief + Aggregate Module(双产物)
 * - 固定 admission-check / requirement-brainstorm 双 turn
 * - 运行中 interject
 *
 * 本文件仅保留支持文档阅读器联动所需的最小客户端辅助:
 * - `SourceRef`(prd / aux / asset 三形态 —— 文档阅读器画线高亮所需)
 * - `CitationSpan` / `CitationRefsByDoc` + 派生的 build / collect 函数
 *
 * SSR 数据契约 `AnalyzingData` 是顶层类型,字段全部对齐新的 Analysis Skill /
 * Run / Issue / Response 链路。
 */

import type { AssetMeta, AuxFile } from '@ai-devspace/shared'
import type { AnalysisRunMeta } from '@ai-devspace/shared'
import type { AnalysisSkillMeta } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// SourceRef(本地视图类型 —— 与 shared SourceRef 镜像对齐)
// ---------------------------------------------------------------------------

/**
 * 文档阅读器可定位的 SourceRef 子类型。
 *
 * 本地视图类型 = `@ai-devspace/shared` `SourceRef` 的子集(去掉 `repository`,
 * 它不在阅读器内)。`kind === 'prd'` 在本地视图里映射到 `requirement` 来源,
 * 渲染时按 PRD 处理。
 *
 * `lineRange` = `[start, end)` 0-based 半开区间;asset 没有行概念。
 */

export interface PrdSourceRef {
  readonly kind: 'prd'
  readonly lineRange: readonly [number, number]
  readonly quote?: string
}

export interface AuxSourceRef {
  readonly kind: 'aux'
  readonly auxId: string
  readonly lineRange: readonly [number, number]
  readonly quote?: string
}

export interface AssetSourceRef {
  readonly kind: 'asset'
  readonly assetId: string
}

export type SourceRef = PrdSourceRef | AuxSourceRef | AssetSourceRef

/**
 * 校验 `unknown` 是否符合本地 SourceRef 形态。
 *
 * - lineRange 必须是恰好 2 元素的有限数字元组(NaN / Infinity / 倒置 → 拒绝)
 * - auxId / assetId 必须是非空字符串
 * - quote 可选 string;非 string 拒绝
 * - 不可信输入(unknown)→ false,不抛错
 */
export function isSourceRef(value: unknown): value is SourceRef {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const kind = v.kind
  if (kind === 'prd' || kind === 'aux') {
    if (!isLineRangePair(v.lineRange)) return false
    if (
      kind === 'aux' &&
      (typeof v.auxId !== 'string' || v.auxId.length === 0)
    ) {
      return false
    }
    if (v.quote !== undefined && typeof v.quote !== 'string') return false
    return true
  }
  if (kind === 'asset') {
    return typeof v.assetId === 'string' && v.assetId.length > 0
  }
  return false
}

function isLineRangePair(value: unknown): value is readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false
  const a = value[0]
  const b = value[1]
  if (typeof a !== 'number' || !Number.isFinite(a)) return false
  if (typeof b !== 'number' || !Number.isFinite(b)) return false
  if (a > b) return false
  return true
}

// ---------------------------------------------------------------------------
// 文档阅读器画线高亮(ADR-0017 D4)
// ---------------------------------------------------------------------------

export interface CitationSpan {
  /** 0-based 半开行区间 [start, end) */
  readonly lineRange: readonly [number, number]
  /** 引用此 span 的 Issue 数(≥ 1) */
  readonly refsCount: number
  /** quote 与 lineRange 处文本不一致(tooltip 显示 ⚠️,issue 03 留 v2 修复) */
  readonly quoteMismatch: boolean
}

export interface CitationRefsByDoc {
  prd: PrdSourceRef[]
  aux: Record<string, AuxSourceRef[]>
  asset: AssetSourceRef[]
}

/**
 * 收集 SourceRef 并按文档分桶。
 *
 * 入参 `sourceRefs` 允许任意带 source_refs 的形状 —— 我们只读 `kind` 与必要字段,
 * 不强制形状是本地 SourceRef(也接受 shared SourceRef 的 subset)。
 */
export function collectCitationRefs(
  sourceRefs: ReadonlyArray<{
    kind?: unknown
    lineRange?: unknown
    auxId?: unknown
    assetId?: unknown
    quote?: unknown
  }>,
): CitationRefsByDoc {
  const prd: PrdSourceRef[] = []
  const aux: Record<string, AuxSourceRef[]> = {}
  const asset: AssetSourceRef[] = []
  for (const ref of sourceRefs) {
    if (!ref || typeof ref !== 'object') continue
    if (ref.kind === 'prd' && isLineRangePair(ref.lineRange)) {
      const out: PrdSourceRef = { kind: 'prd', lineRange: ref.lineRange }
      if (typeof ref.quote === 'string') (out as { quote?: string }).quote = ref.quote
      prd.push(out)
    } else if (ref.kind === 'asset' && typeof ref.assetId === 'string' && ref.assetId.length > 0) {
      asset.push({ kind: 'asset', assetId: ref.assetId })
    } else if (
      ref.kind === 'aux' &&
      typeof ref.auxId === 'string' &&
      ref.auxId.length > 0 &&
      isLineRangePair(ref.lineRange)
    ) {
      const out: AuxSourceRef = { kind: 'aux', auxId: ref.auxId, lineRange: ref.lineRange }
      if (typeof ref.quote === 'string') (out as { quote?: string }).quote = ref.quote
      ;(aux[ref.auxId] ??= []).push(out)
    }
  }
  return { prd, aux, asset }
}

/**
 * 文档引用计数(Issue → 文档联动 Tab 标签 "🔗 N")。
 *
 * `prd` = PRD 引用总次数;`asset` = Asset 引用总次数;`aux` = 每个 AuxFile 的
 * 引用次数(以 auxId 为键)。
 */
export function countCitationsByDoc(sourceRefs: CitationRefsByDoc): {
  prd: number
  aux: Record<string, number>
  asset: number
} {
  const aux: Record<string, number> = {}
  for (const auxId of Object.keys(sourceRefs.aux)) {
    aux[auxId] = sourceRefs.aux[auxId].length
  }
  return { prd: sourceRefs.prd.length, aux, asset: sourceRefs.asset.length }
}

/** 统计每张 asset 被引用的次数(供图片角标 "🔗 N" 使用)。 */
export function countAssetCitations(
  refs: readonly AssetSourceRef[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const ref of refs) {
    out[ref.assetId] = (out[ref.assetId] ?? 0) + 1
  }
  return out
}

/**
 * 从文档全文 + 该文档的 SourceRef 派生**去重后的高亮 span**。
 *
 * - 同一 `lineRange`(start:end 相同)的多个 ref → 合并成一条 span,`refsCount` 累加
 * - `lineRange` 越界(start >= 文档行数 或 start < 0)→ 跳过该 ref(不报错)
 * - `quote` 与 `[start, end)` 处文本不一致 → `quoteMismatch = true`(tooltip ⚠️)
 * - 返回按 `start` 升序排序
 *
 * 纯函数,便于单测;空文档 / 空 refs → `[]`。
 */
export function buildCitationSpans(
  docText: string,
  refs: ReadonlyArray<{
    readonly lineRange: readonly [number, number]
    readonly quote?: string
  }>,
): CitationSpan[] {
  if (docText.length === 0) return []
  const lines = docText.split(/\r?\n/)
  const lineCount = lines.length
  const map = new Map<
    string,
    { start: number; end: number; count: number; quoteMismatch: boolean }
  >()
  const order: string[] = []
  for (const ref of refs) {
    const [start, end] = ref.lineRange
    if (start < 0 || start >= lineCount) continue
    const key = `${start}:${end}`
    let entry = map.get(key)
    if (!entry) {
      entry = { start, end, count: 0, quoteMismatch: false }
      map.set(key, entry)
      order.push(key)
    }
    entry.count += 1
    const quote = ref.quote?.trim()
    if (quote && quote.length > 0) {
      const clampedEnd = Math.min(end, lineCount)
      const slice = lines.slice(start, clampedEnd).join('\n')
      if (!slice.includes(quote)) entry.quoteMismatch = true
    }
  }
  return order
    .map((k) => {
      const e = map.get(k)!
      return {
        lineRange: [e.start, e.end] as const,
        refsCount: e.count,
        quoteMismatch: e.quoteMismatch,
      }
    })
    .sort((a, b) => a.lineRange[0] - b.lineRange[0])
}

// ---------------------------------------------------------------------------
// AnalyzingData(SSR 数据契约)
// ---------------------------------------------------------------------------

/**
 * ANALYZING 工位顶层数据(issue 08 收敛形态)。
 *
 * 字段全部围绕 Analysis Skill / Run / Issue / Response 链路:
 * - `requirementId`:`req-NNN-<slug>`
 * - `prdMarkdown` / `auxFiles` / `assetList`:文档阅读器依赖的当前 Requirement 内容
 * - `availableSkills` / `selectedSkillName`:Analysis Skill 单选器
 * - `runs`:该 Requirement 已有 Analysis Run 元数据(按 created_at 倒序)
 * - `empty`:老契约空态标志(requirement.md 不存在 → 引导去 DRAFTING)
 *
 * 不再包含:admission / sessions / activeSessionId / techBriefPreview /
 * modulesPreview / briefGeneratedAt / canGenerateBrief / stats / summary /
 * toolbar / streamMeta / chunks。
 */
export interface AnalyzingData {
  requirementId: string
  /** 空数据(无 PRD / 新建需求);UI 渲染引导去 DRAFTING */
  empty: boolean
  /** PRD Markdown 全文;requirement.md 不存在 → 空字符串 */
  prdMarkdown: string
  /** 辅助文件列表(已按 usage_tag 排序) */
  auxFiles: AuxFile[]
  /** PRD 引用的 Asset 列表(已比对磁盘 + 引用集合) */
  assetList: AssetMeta[]
  /** 可用 Analysis Skill 列表(workspace 集合) */
  availableSkills: ReadonlyArray<AnalysisSkillMeta>
  /** 当前 Requirement 已选择 Skill 名称;无选择 → 回退首项;都不可用 → '' */
  selectedSkillName: string
  /** 该 Requirement 已有 Analysis Run 列表(按 created_at 倒序) */
  runs: ReadonlyArray<AnalysisRunMeta>
}

/**
 * 空状态 ANALYZING 工位数据(未知 id / 新建需求)。
 *
 * UI 渲染时若 `data.empty === true` → 走空态引导(去 DRAFTING 写 PRD)。
 */
export function emptyAnalyzing(requirementId: string): AnalyzingData {
  return {
    requirementId,
    empty: true,
    prdMarkdown: '',
    auxFiles: [],
    assetList: [],
    availableSkills: [],
    selectedSkillName: '',
    runs: [],
  }
}