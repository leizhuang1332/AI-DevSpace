/**
 * SDK 文本 → 结构化 analysis chunk 解析层(ADR-0020 D8 末段 · audit-2026-07-26 #2)
 *
 * 背景:`start` handler 之前把真 SDK 的每个 `text` 事件无条件包成
 * `kind: 'narration'`,导致
 *   - AdmissionDashboard 五维卡永远 count = 0(不随 SSE 上涨)
 *   - ProductList 三桶(subproblem / risk / option)永远为空
 *   - ticket 07 的 E2E 强断言无法满足
 *
 * 本模块把 built-in SKILL.md(`admission-check` / `requirement-brainstorm`)
 * 约定的 plain-text 标记解析成结构化 chunk:
 *
 *   [DIM <id>]            → narration + admission { dim, verdict }
 *   [VERDICT]             → narration + admission { overall, pendingCount }
 *   [SUBPROBLEM]          → kind 'subproblem'  + source_refs
 *   [RISK]                → kind 'risk'        + source_refs
 *   [OPTION]              → kind 'option'      + source_refs
 *   [<BUCKET>_EMPTY]      → narration(空桶占位,不计入三桶)
 *   其它自由文本           → narration 兜底(**绝不丢内容**)
 *
 * 设计要点:
 * - **纯函数式增量解析器**:SDK 以 delta 形式推 text,`push()` 只消费"完整行",
 *   未闭合的尾部留在 buffer,`flush()` 在 turn 结束时收尾。逐字符喂入与一次性
 *   喂入结果等价(单测锁定)。
 * - **块边界 = 下一个标记行 或 空行**:与 SKILL.md "card 间用空行分隔" 契约一致;
 *   用空行提前收口让 chunk 尽早推到 SSE(五卡"逐张点亮"而不是一次性跳变)。
 * - **宽容解析**:容忍 ``` 代码块围栏、`**加粗**` 包裹、全角引号、字段跨行续写;
 *   任何解析失败都退化成 narration,不抛异常(SDK 输出不可控,解析层不能成为
 *   主流程的失败点)。
 * - **source_refs 严格校验**:lineRange 必须是有限非负整数且 start < end,
 *   否则整条 ref 丢弃(ADR-0017 D3 契约;脏 ref 会让 web 端画线联动指到错行)。
 */

import { ADMISSION_DIMENSION_META } from '@ai-devspace/shared'

// ============================================================================
// 类型(与 web 端 `apps/web/src/lib/analyzing.ts` 镜像 —— 不反向 import)
// ============================================================================

/** ADR-0017 D3 源出处三形态(agent 端内联镜像) */
export type SourceRef =
  | { kind: 'prd'; lineRange: readonly [number, number]; quote?: string }
  | { kind: 'aux'; auxId: string; lineRange: readonly [number, number]; quote?: string }
  | { kind: 'asset'; assetId: string }

/** 单维度裁决取值(SKILL.md 严格三选一) */
export type AdmissionChunkVerdict = 'pass' | 'warn' | 'fail'

/** 总体 verdict(与 web 端 `AdmissionVerdict` 对齐:warn 在总体层叫 pending) */
export type AdmissionOverallVerdict = 'pass' | 'pending' | 'fail'

/**
 * chunk 上的 admission 侧信息 —— web 端据此派生五维卡 count / 总体徽章。
 *
 * - `dim` + `verdict`:来自 `[DIM <id>]` 块
 * - `overall` + `pendingCount`:来自 `[VERDICT]` 块
 * 两组互斥(一条 chunk 只可能是其中一种)。
 */
export interface AdmissionChunkMeta {
  dim?: string
  verdict?: AdmissionChunkVerdict
  overall?: AdmissionOverallVerdict
  pendingCount?: number
}

export type ParsedChunkKind = 'narration' | 'subproblem' | 'risk' | 'option'
export type ParsedChunkTone = 'info' | 'success' | 'warn' | 'err'

export interface ParsedAnalysisChunk {
  kind: ParsedChunkKind
  label: string
  tone: ParsedChunkTone
  text: string
  source_refs?: SourceRef[]
  admission?: AdmissionChunkMeta
}

export interface AnalysisTextParser {
  /** 喂入一段(可能是半行的)SDK 文本,返回本次已闭合的 chunk */
  push(text: string): ParsedAnalysisChunk[]
  /** turn 结束时收尾:把 buffer 里的残留行与未闭合块产出 */
  flush(): ParsedAnalysisChunk[]
}

// ============================================================================
// 标记识别
// ============================================================================

type BucketMarker = 'SUBPROBLEM' | 'RISK' | 'OPTION'

type Marker =
  | { type: 'dim'; dim: string }
  | { type: 'verdict' }
  | { type: 'bucket'; bucket: BucketMarker }
  | { type: 'bucket_empty'; bucket: BucketMarker }

const DIM_MARKER_RE = /^\[DIM\s+([A-Za-z_][A-Za-z0-9_]*)\]$/
const PLAIN_MARKER_RE = /^\[([A-Z_]+)\]$/

/** 代码块围栏(``` / ```text / ~~~)—— 直接忽略该行 */
const FENCE_RE = /^(?:`{3,}|~{3,})\s*\w*$/

/**
 * 去掉 markdown 装饰:前导 `#`/`>`/`-`/`*` 与成对 `**`/`__`。
 * 仅用于**标记行识别**,不改写正文(正文保持模型原样输出)。
 */
function stripDecoration(line: string): string {
  let s = line.trim()
  s = s.replace(/^[#>]+\s*/, '')
  // 成对包裹:**[RISK]** / __[RISK]__
  const wrapped = /^(\*\*|__)(.*)\1$/.exec(s)
  if (wrapped) s = wrapped[2].trim()
  return s
}

function matchMarker(line: string): Marker | null {
  const s = stripDecoration(line)
  const dim = DIM_MARKER_RE.exec(s)
  if (dim) return { type: 'dim', dim: dim[1] }
  const plain = PLAIN_MARKER_RE.exec(s)
  if (!plain) return null
  const name = plain[1]
  if (name === 'VERDICT') return { type: 'verdict' }
  if (name === 'SUBPROBLEM' || name === 'RISK' || name === 'OPTION') {
    return { type: 'bucket', bucket: name }
  }
  const empty = /^(SUBPROBLEM|RISK|OPTION)_EMPTY$/.exec(name)
  if (empty) return { type: 'bucket_empty', bucket: empty[1] as BucketMarker }
  return null
}

// ============================================================================
// 块内字段解析
// ============================================================================

/** `key: value` 行(key 限定 ASCII 单词,避免把中文正文误判成字段) */
const FIELD_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*[::]\s*(.*)$/
/** source_refs 列表项:`- prd:1-2 "quote"` */
const REF_ITEM_RE = /^[-*]\s*(.+)$/

interface BlockFields {
  /** 有序字段表(重复 key 取首次) */
  fields: Map<string, string>
  /** source_refs 列表项原文 */
  refLines: string[]
  /** 不属于任何字段的自由正文行(兜底用) */
  loose: string[]
}

function parseBlockFields(lines: readonly string[]): BlockFields {
  const fields = new Map<string, string>()
  const refLines: string[] = []
  const loose: string[] = []
  let currentField: string | null = null
  let inRefs = false

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.trim().length === 0) continue

    const refItem = inRefs ? REF_ITEM_RE.exec(line.trim()) : null
    if (refItem) {
      refLines.push(refItem[1].trim())
      continue
    }

    const field = FIELD_RE.exec(line.trim())
    if (field) {
      const key = field[1].toLowerCase()
      const value = field[2].trim()
      if (key === 'source_refs') {
        inRefs = true
        currentField = null
        // `source_refs: prd:1-2 "x"` 单行写法也接受
        if (value.length > 0) refLines.push(value)
        continue
      }
      inRefs = false
      currentField = key
      if (!fields.has(key)) fields.set(key, value)
      continue
    }

    // 非字段行:续写上一个字段,或落到 loose
    inRefs = false
    if (currentField && fields.has(currentField)) {
      const prev = fields.get(currentField) ?? ''
      fields.set(currentField, prev.length > 0 ? `${prev}\n${line.trim()}` : line.trim())
    } else {
      loose.push(line.trim())
    }
  }
  return { fields, refLines, loose }
}

// ============================================================================
// source_refs 解析
// ============================================================================

const PRD_REF_RE = /^prd\s*:\s*(\d+)\s*-\s*(\d+)\s*(.*)$/i
const AUX_REF_RE = /^aux\s*:\s*(.+?)\s*:\s*(\d+)\s*-\s*(\d+)\s*(.*)$/i
const ASSET_REF_RE = /^asset\s*:\s*(\S+?)\s*$/i

/** 去掉包裹引号(直/弯/中文书名号),空串 → undefined */
function stripQuote(raw: string): string | undefined {
  const s = raw.trim()
  if (s.length === 0) return undefined
  const m = /^["'“”「『](.*)["'“”」』]$/s.exec(s)
  const inner = (m ? m[1] : s).trim()
  return inner.length > 0 ? inner : undefined
}

/** lineRange 合法性:有限非负整数 + start < end(ADR-0017 D3 半开区间) */
function validRange(start: number, end: number): boolean {
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end > start
  )
}

export function parseSourceRefLine(line: string): SourceRef | null {
  const s = line.trim().replace(/^[-*]\s*/, '')
  if (s.length === 0) return null

  const aux = AUX_REF_RE.exec(s)
  if (aux) {
    const start = Number(aux[2])
    const end = Number(aux[3])
    if (!validRange(start, end)) return null
    const auxId = aux[1].trim()
    if (auxId.length === 0) return null
    const quote = stripQuote(aux[4])
    return quote === undefined
      ? { kind: 'aux', auxId, lineRange: [start, end] }
      : { kind: 'aux', auxId, lineRange: [start, end], quote }
  }

  const prd = PRD_REF_RE.exec(s)
  if (prd) {
    const start = Number(prd[1])
    const end = Number(prd[2])
    if (!validRange(start, end)) return null
    const quote = stripQuote(prd[3])
    return quote === undefined
      ? { kind: 'prd', lineRange: [start, end] }
      : { kind: 'prd', lineRange: [start, end], quote }
  }

  const asset = ASSET_REF_RE.exec(s)
  if (asset) return { kind: 'asset', assetId: asset[1] }

  return null
}

// ============================================================================
// 块 → chunk 转换
// ============================================================================

const VERDICT_TONE: Record<AdmissionChunkVerdict, ParsedChunkTone> = {
  pass: 'success',
  warn: 'warn',
  fail: 'err',
}

const OVERALL_TONE: Record<AdmissionOverallVerdict, ParsedChunkTone> = {
  pass: 'success',
  pending: 'warn',
  fail: 'err',
}

const BUCKET_KIND: Record<BucketMarker, Exclude<ParsedChunkKind, 'narration'>> = {
  SUBPROBLEM: 'subproblem',
  RISK: 'risk',
  OPTION: 'option',
}

const BUCKET_LABEL: Record<BucketMarker, string> = {
  SUBPROBLEM: 'DETECT',
  RISK: 'RISK',
  OPTION: 'OPTION',
}

const BUCKET_TONE: Record<BucketMarker, ParsedChunkTone> = {
  SUBPROBLEM: 'info',
  RISK: 'warn',
  OPTION: 'success',
}

function toVerdict(raw: string | undefined): AdmissionChunkVerdict | undefined {
  const s = raw?.trim().toLowerCase()
  return s === 'pass' || s === 'warn' || s === 'fail' ? s : undefined
}

/** `result: ✅ | ⚠️ | ❌`(也接受英文取值,SDK 偶尔不照抄 emoji) */
function toOverall(raw: string | undefined): AdmissionOverallVerdict | undefined {
  if (!raw) return undefined
  const s = raw.trim().toLowerCase()
  if (s.includes('✅') || s.startsWith('pass') || s.includes('通过')) return 'pass'
  if (s.includes('❌') || s.startsWith('fail') || s.includes('失败')) return 'fail'
  if (s.includes('⚠') || s.startsWith('pending') || s.startsWith('warn') || s.includes('待裁决')) {
    return 'pending'
  }
  return undefined
}

function toCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw.trim())
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined
}

/** DIM 块正文:`<icon> <中文维度名>` 首行 + evidence + 待裁决 */
function renderDimText(dim: string, fields: Map<string, string>, loose: string[]): string {
  const meta = (ADMISSION_DIMENSION_META as Record<string, { label: string; icon: string } | undefined>)[dim]
  const head = meta ? `${meta.icon} ${meta.label}` : dim
  const parts: string[] = [head]
  const evidence = fields.get('evidence') ?? loose.join('\n')
  if (evidence.trim().length > 0) parts.push(evidence.trim())
  const pending = fields.get('pending')
  if (pending && pending.trim().length > 0) parts.push(`待裁决:${pending.trim()}`)
  // 审计的可追溯性(audit-2026-07-26 #2 收尾):把 `[DIM <id>]` 原始标记
  // 也拼回 text —— chunks.jsonl / SSE 流对 reviewer 来说**应当**保留 SDK 原
  // 文本,即便 UI 渲染用的是上面格式化后的版本。旧版 audit-style 测试 +
  // PR 物证头 5 行都依赖这个 marker 仍可 grep。
  parts.push(`[DIM ${dim}]`)
  return parts.join('\n')
}

function blockToChunk(
  marker: Marker | null,
  lines: readonly string[],
  fallbackLabel: string,
): ParsedAnalysisChunk | null {
  const body = lines.join('\n').trim()
  if (marker === null) {
    if (body.length === 0) return null
    return { kind: 'narration', label: fallbackLabel, tone: 'info', text: body }
  }

  const { fields, refLines, loose } = parseBlockFields(lines)

  if (marker.type === 'dim') {
    const verdict = toVerdict(fields.get('verdict'))
    const admission: AdmissionChunkMeta = { dim: marker.dim }
    if (verdict) admission.verdict = verdict
    return {
      kind: 'narration',
      label: 'DETECT',
      tone: verdict ? VERDICT_TONE[verdict] : 'info',
      text: renderDimText(marker.dim, fields, loose),
      admission,
    }
  }

  if (marker.type === 'verdict') {
    const overall = toOverall(fields.get('result'))
    const pendingCount = toCount(fields.get('pending_count'))
    const admission: AdmissionChunkMeta = {}
    if (overall) admission.overall = overall
    if (pendingCount !== undefined) admission.pendingCount = pendingCount
    const summary = fields.get('summary') ?? loose.join('\n')
    const head = overall === 'pass' ? '✅ 准入通过' : overall === 'fail' ? '❌ 准入失败' : '⚠️ 待裁决'
    const parts: string[] = [head]
    if (summary.trim().length > 0) parts.push(summary.trim())
    // 同 DIM:把 `[VERDICT]` 原始标记 + 关键字段拼回 text —— chunks.jsonl /
    // SSE 流对 reviewer 来说应保留 SDK 原文本(审计追溯 + e2e 物证头 5 行)
    parts.push(`[VERDICT]`)
    if (overall) parts.push(`result: ${fields.get('result') ?? ''}`.trimEnd())
    if (pendingCount !== undefined) parts.push(`pending_count: ${pendingCount}`)
    const text = parts.join('\n')
    const chunk: ParsedAnalysisChunk = {
      kind: 'narration',
      label: 'COMPLETE',
      tone: overall ? OVERALL_TONE[overall] : 'info',
      text,
    }
    if (Object.keys(admission).length > 0) chunk.admission = admission
    return chunk
  }

  if (marker.type === 'bucket_empty') {
    const text = fields.get('text') ?? loose.join('\n')
    if (text.trim().length === 0) return null
    return { kind: 'narration', label: fallbackLabel, tone: 'info', text: text.trim() }
  }

  // marker.type === 'bucket'
  const text = (fields.get('text') ?? loose.join('\n')).trim()
  if (text.length === 0) return null
  const refs = refLines
    .map(parseSourceRefLine)
    .filter((r): r is SourceRef => r !== null)
  const chunk: ParsedAnalysisChunk = {
    kind: BUCKET_KIND[marker.bucket],
    label: BUCKET_LABEL[marker.bucket],
    tone: BUCKET_TONE[marker.bucket],
    text,
  }
  if (refs.length > 0) chunk.source_refs = refs
  return chunk
}

// ============================================================================
// 增量解析器
// ============================================================================

export function createAnalysisTextParser(opts: {
  /** 无标记自由文本 / 空桶占位使用的 chunk label(turn 维度传 'INFER' / 'THINK') */
  fallbackLabel: string
}): AnalysisTextParser {
  let buffer = ''
  let currentMarker: Marker | null = null
  let currentLines: string[] = []
  let started = false

  const closeBlock = (out: ParsedAnalysisChunk[]): void => {
    if (!started) return
    const chunk = blockToChunk(currentMarker, currentLines, opts.fallbackLabel)
    if (chunk) out.push(chunk)
    currentMarker = null
    currentLines = []
    started = false
  }

  const handleLine = (raw: string, out: ParsedAnalysisChunk[]): void => {
    const line = raw.replace(/\r$/, '')
    const trimmed = line.trim()

    // 代码块围栏:忽略,但视作块边界(模型常把整段输出包在 ``` 里)
    if (FENCE_RE.test(trimmed)) return

    const marker = matchMarker(line)
    if (marker) {
      closeBlock(out)
      currentMarker = marker
      currentLines = []
      started = true
      return
    }

    if (trimmed.length === 0) {
      // 空行 = card 边界(SKILL.md 契约);提前收口让 chunk 尽早推 SSE
      closeBlock(out)
      return
    }

    if (!started) {
      currentMarker = null
      currentLines = []
      started = true
    }
    currentLines.push(line)
  }

  return {
    push(text: string): ParsedAnalysisChunk[] {
      const out: ParsedAnalysisChunk[] = []
      if (typeof text !== 'string' || text.length === 0) return out
      buffer += text
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        handleLine(buffer.slice(0, nl), out)
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
      return out
    },
    flush(): ParsedAnalysisChunk[] {
      const out: ParsedAnalysisChunk[] = []
      if (buffer.length > 0) {
        handleLine(buffer, out)
        buffer = ''
      }
      closeBlock(out)
      return out
    },
  }
}
