/**
 * DESIGNING 工位 — server-only 数据层(issue: zone-data-fidelity-fixes · 02)
 *
 * 设计动机(对齐 `analyzing.server.ts` 的 .server.ts 命名约定):
 *
 * `designing.ts` 是 client-safe(types + 纯函数 + mock 常量),同时被:
 * - server component(RSC,`app/(workspace)/requirements/[id]/[zone]/page.tsx`)
 * - client component(`components/designing-zone.tsx`)
 *
 * 引入 fs IO 必须放到 server-only 文件,避免 webpack `UnhandledSchemeError`。
 *
 * 数据契约:
 * - `req-001` → 命中硬编码 REFUND_DESIGNING(向后兼容;即便 fs 里有
 *   design/ 也忽略,跟 DRAFTING / ANALYZING 同模式)
 * - 其他 reqId → 读 `<requirementsRoot>/<reqId>/design/`:
 *   - `candidates.yaml` 存在且非空 → 构造非空 `DesigningData`
 *     (字段从 yaml 解析,adapter 做 snake_case → camelCase 转换)
 *   - 否则 → `emptyDesigning(reqId)`
 *
 * 路径解析(对照 PRD N-2 · TODO):
 * - dev: `path.resolve(process.cwd(), '../../requirements/{reqId}/design/')`
 * - production: 留 TODO,后续部署 ticket 解决
 *
 * 产物 schema(PRD D-2 · 跟 REFUND_DESIGNING 内部硬编码逐字段对齐):
 * - `design/stage.yaml`     → stage(badge / title / meta)
 * - `design/candidates.yaml`→ candidates(A / B / C 候选方案)
 * - `design/design_doc.yaml`→ designDoc(title / markdown / toc)
 * - `design/tradeoff.yaml`  → tradeoff(rows + recommendation)
 *
 * 字段命名(yaml 用 snake_case;adapter 转 camelCase):
 * - `detected_count` → `detectedCount`、`is_streaming` → `isStreaming`
 *   (ANALYZING 同模式,沿用之)
 * - `candidate_id` → `candidateId`、`design_doc` → `designDoc`
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  emptyDesigning,
  getDesigningData,
  type DesigningCandidate,
  type DesigningCandidateTag,
  type DesigningCandidateTagVariant,
  type DesigningCandidateMetric,
  type DesigningData,
  type DesigningDesignDoc,
  type DesigningRecommendation,
  type DesigningStage,
  type DesigningTocItem,
  type DesigningTradeoff,
  type DesigningTradeoffRow,
} from './designing'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** req-001 命中硬编码 REFUND_DESIGNING(向后兼容,见本文件 header) */
const HARD_CODED_REQ_ID = 'req-001'

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

/** getDesigningDataFromFs options —— 主要为测试方便注入 fs 路径 */
export interface GetDesigningDataFromFsOptions {
  /**
   * 覆盖 dev 默认的 `<repo-root>/requirements/`。
   * 显式传入 → design 路径按 `<requirementsRoot>/<reqId>/design/` 解析。
   */
  requirementsRoot?: string
}

/** 默认 requirements 根:dev 时 cwd = `<repo-root>/apps/web/`,`../../requirements/` 即仓库根 */
function defaultRequirementsRoot(): string {
  return resolve(process.cwd(), '../../requirements')
}

// ---------------------------------------------------------------------------
// RSC 数据入口
// ---------------------------------------------------------------------------

/**
 * 拉取 DESIGNING 工位数据(SSR 期 mock —— 后续替换为 `await fetch(...)`)。
 *
 * - `req-001` → REFUND_DESIGNING 样例数据(短路在 fs 检查之前)
 * - 其他 id:
 *   - `<requirementsRoot>/<reqId>/design/candidates.yaml` 存在且非空 →
 *     解析四个 yaml(stage / candidates / design_doc / tradeoff)构造非空
 *     `DesigningData`,adapter 把 yaml 字段从 snake_case 转 camelCase
 *   - 否则 → `emptyDesigning(reqId)`
 *
 * 与原 `getDesigningData(reqId)` 的差异:
 * - 原版对所有非 `req-001` id 直接 `emptyDesigning`,丢掉了真实 design 产物;
 *   本版读 fs,真实需求拿到非空数据
 * - 异步语义保持(签名 `Promise<DesigningData>`)→ 调用方切换无感
 */
export async function getDesigningDataFromFs(
  requirementId: string,
  options: GetDesigningDataFromFsOptions = {},
): Promise<DesigningData> {
  // 1) req-001 走硬编码 mock(向后兼容;即便目录里有 design/ 内容也忽略)
  // 通过 `getDesigningData('req-001')` 复用现有 mock 装配 —— 不把私有常量
  // `REFUND_DESIGNING` 提到 client-safe 模块外(对齐 drafting.server.ts 的同模式)
  if (requirementId === HARD_CODED_REQ_ID) {
    return getDesigningData(HARD_CODED_REQ_ID)
  }

  const root = options.requirementsRoot ?? defaultRequirementsRoot()
  const designDir = resolve(root, requirementId, 'design')

  // 2) 读 4 个 yaml;任一缺失 / 解析失败 → emptyDesigning
  const candidatesYamlPath = resolve(designDir, 'candidates.yaml')
  if (!existsSync(candidatesYamlPath)) {
    return emptyDesigning(requirementId)
  }

  const stageYaml = readYamlOrNull(resolve(designDir, 'stage.yaml'))
  const candidatesRaw = readYamlOrNull(candidatesYamlPath)
  const designDocYaml = readYamlOrNull(resolve(designDir, 'design_doc.yaml'))
  const tradeoffYaml = readYamlOrNull(resolve(designDir, 'tradeoff.yaml'))

  // 3) candidates.yaml 是核心必需字段 —— 缺 / 空 / 解析失败 → emptyDesigning
  const candidates = parseCandidatesYaml(candidatesRaw)
  if (candidates.length === 0) {
    return emptyDesigning(requirementId)
  }

  // 4) 构造非空 DesigningData —— stage / designDoc / tradeoff 缺失时用
  //    emptyDesigning 的默认空结构兜底,确保非空状态仍可渲染(候选方案不空即代表
  //    "非空")。
  const empty = emptyDesigning(requirementId)
  return {
    ...empty,
    requirementId,
    empty: false,
    stage: parseStageYaml(stageYaml) ?? empty.stage,
    candidates,
    designDoc: parseDesignDocYaml(designDocYaml) ?? empty.designDoc,
    tradeoff: parseTradeoffYaml(tradeoffYaml) ?? empty.tradeoff,
    // toolbar.crumb: 反映 reqId + 方案评审(current)
    toolbar: {
      crumb: [
        { label: requirementId },
        { label: '/' },
        { label: '方案评审', current: true },
      ],
    },
    selectedCandidateId: null,
  }
}

// ---------------------------------------------------------------------------
// 文件 IO helpers
// ---------------------------------------------------------------------------

/**
 * 读 yaml 文件内容;不存在 / 读取失败 → null(不抛错,让上层走空兜底)。
 *
 * 设计要点:
 * - 文件是目录或损坏 → null
 * - 内容为空字符串 → null(由上层"必需字段非空"判定失败)
 */
function readYamlOrNull(file: string): string | null {
  if (!existsSync(file)) return null
  try {
    const text = readFileSync(file, 'utf8')
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// YAML 解析 —— 极简解析器(只为本期受控 yaml 格式,不引第三方依赖)
//
// 解析策略:跟 analyzing.server.ts 的 `parseSessionsIndexYaml` 同模式 ——
// 仅识别本仓库写出的固定 schema,不追求通用 YAML 解析。容错:解析失败 / 字段
// 缺失 → 给默认值或跳过该 entry。
// ---------------------------------------------------------------------------

/**
 * 解析 `stage.yaml` → `DesigningStage`:
 * ```
 * stage:
 *   badge: ④ 设计
 *   title: ...
 *   meta: 等选 3 / 3
 * ```
 *
 * 返回 null 当 stage 顶级 key 缺失或解析失败。
 */
function parseStageYaml(raw: string | null): DesigningStage | null {
  if (!raw) return null
  const map = parseFlatYamlMap(raw, 'stage')
  if (!map) return null
  return {
    badge: typeof map.badge === 'string' ? map.badge : '',
    title: typeof map.title === 'string' ? map.title : '',
    meta: typeof map.meta === 'string' ? map.meta : '',
  }
}

/**
 * 解析 `candidates.yaml` → `DesigningCandidate[]`:
 * ```
 * candidates:
 *   - id: A
 *     title: 同步单阶段
 *     tag_label: 最简
 *     tag_variant: simple
 *     pros:
 *       - 实现简单,链路短
 *     cons:
 *       - 高并发下性能差
 *     metrics:
 *       - label: 微服务调用
 *         value: 3 个
 *     recommended: true
 * ```
 *
 * 单 entry 解析失败 → 跳过(避免一行脏数据毁全文件)。
 * id 缺失 / variant 未知 → 跳过。
 * 返回 [] 表示"解析后无候选"—— 上层据此判定 emptyDesigning。
 */
function parseCandidatesYaml(raw: string | null): DesigningCandidate[] {
  if (!raw) return []
  return parseListYaml<DesigningCandidate>(raw, 'candidates', parseCandidateEntry)
}

function parseCandidateEntry(map: Record<string, unknown>): DesigningCandidate | null {
  const id = map.id
  if (id !== 'A' && id !== 'B' && id !== 'C') return null
  const tag = parseTag(map.tag_label, map.tag_variant)
  if (!tag) return null
  return {
    id,
    title: typeof map.title === 'string' ? map.title : '',
    tag,
    pros: parseStringList(map.pros),
    cons: parseStringList(map.cons),
    metrics: parseMetricsList(map.metrics),
    recommended: parseBool(map.recommended),
  }
}

/**
 * 字符串 `'true'` / `'false'` / 其它 → boolean。yaml 里 boolean 解析后是字符串,
 * 本期没引第三方 yaml parser,需要手动转。
 */
function parseBool(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') return raw === 'true'
  return false
}

/**
 * 解析 candidate tag —— 扁平字段:`tag_label` + `tag_variant`。
 *
 * variant 未知 → null(整条 candidate 跳过)。
 */
function parseTag(labelRaw: unknown, variantRaw: unknown): DesigningCandidateTag | null {
  if (typeof variantRaw !== 'string') return null
  if (
    variantRaw !== 'simple' &&
    variantRaw !== 'recommended' &&
    variantRaw !== 'strict'
  ) {
    return null
  }
  return {
    label: typeof labelRaw === 'string' ? labelRaw : '',
    variant: variantRaw as DesigningCandidateTagVariant,
  }
}

/**
 * 解析 metrics 列表:
 * ```
 * metrics:
 *   - label: 微服务调用
 *     value: 3 个
 *   - label: 预估延迟
 *     value: 80ms
 *     tone: good
 * ```
 *
 * 单项缺 label / value → 跳过。
 */
function parseMetricsList(raw: unknown): DesigningCandidateMetric[] {
  if (!Array.isArray(raw)) return []
  const result: DesigningCandidateMetric[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const map = item as Record<string, unknown>
    if (typeof map.label !== 'string' || typeof map.value !== 'string') continue
    result.push({
      label: map.label,
      value: map.value,
      tone: map.tone === 'good' ? 'good' : undefined,
    })
  }
  return result
}

/**
 * 字符串列表(pros / cons)—— entry 形状是 `{ _: 'string' }`(由 parser 在解析
 * 6 空格的 `- xxx` 时塞的占位 key)。fallback:若 entry 自身是 string 直接用。
 */
function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const result: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      result.push(item)
    } else if (item && typeof item === 'object') {
      const map = item as Record<string, unknown>
      if (typeof map._ === 'string') result.push(map._)
    }
  }
  return result
}

/**
 * 解析 `design_doc.yaml` → `DesigningDesignDoc`:
 * ```
 * design_doc:
 *   title: 退款功能 · 设计文档
 *   markdown: |
 *     ## 问题背景
 *     ...
 *   toc:
 *     - id: 问题背景
 *       label: 问题背景
 *       level: 0
 * ```
 *
 * 整体缺失 → null(上层走 emptyDesigning.designDoc 兜底)。
 *
 * 用 `parseNestedBlock`(而不是 `parseFlatYamlMap`)因为 design_doc 同时含
 * 标量字段 + 块字符串 + 嵌套 toc 列表。
 */
function parseDesignDocYaml(raw: string | null): DesigningDesignDoc | null {
  if (!raw) return null
  const map = parseNestedBlock(raw, 'design_doc')
  if (!map) return null
  return {
    title: typeof map.title === 'string' ? map.title : '',
    markdown: typeof map.markdown === 'string' ? map.markdown : '',
    toc: parseTocList(map.toc),
  }
}

/**
 * 解析 toc 列表:
 * ```
 * toc:
 *   - id: 问题背景
 *     label: 问题背景
 *     level: 0
 * ```
 */
function parseTocList(raw: unknown): DesigningTocItem[] {
  if (!Array.isArray(raw)) return []
  const result: DesigningTocItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const map = item as Record<string, unknown>
    if (typeof map.id !== 'string' || typeof map.label !== 'string') continue
    result.push({
      id: map.id,
      label: map.label,
      level: typeof map.level === 'number' ? map.level : 0,
    })
  }
  return result
}

/**
 * 解析 `tradeoff.yaml` → `DesigningTradeoff`:
 * ```
 * tradeoff:
 *   rows:
 *     - candidate_id: A
 *       summary: ...
 *   recommendation_candidate_id: B
 *   recommendation_reason: ...
 * ```
 *
 * 注:`recommendation` 字段在本期 schema 中扁平化为 `recommendation_candidate_id`
 * + `recommendation_reason`(避免嵌套对象解析)。adapter 函数把 snake_case 转
 * camelCase 后构造 `DesigningRecommendation`。
 */
function parseTradeoffYaml(raw: string | null): DesigningTradeoff | null {
  if (!raw) return null
  const map = parseNestedBlock(raw, 'tradeoff')
  if (!map) return null
  const rows = parseTradeoffRows(map.rows)
  const candidateIdRaw = map.recommendation_candidate_id
  const candidateId =
    candidateIdRaw === 'A' || candidateIdRaw === 'B' || candidateIdRaw === 'C'
      ? candidateIdRaw
      : 'B'
  const reason =
    typeof map.recommendation_reason === 'string' ? map.recommendation_reason : ''
  const recommendation: DesigningRecommendation = { candidateId, reason }
  // rows / recommendation 两者皆空 → 视作无产物,返 null 让上层走兜底
  if (rows.length === 0 && !reason) return null
  return {
    rows,
    recommendation,
  }
}

function parseTradeoffRows(raw: unknown): DesigningTradeoffRow[] {
  if (!Array.isArray(raw)) return []
  const result: DesigningTradeoffRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const map = item as Record<string, unknown>
    const candidateId = map.candidate_id
    if (candidateId !== 'A' && candidateId !== 'B' && candidateId !== 'C') continue
    result.push({
      candidateId,
      summary: typeof map.summary === 'string' ? map.summary : '',
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// YAML 底层解析(flat map + list)
// ---------------------------------------------------------------------------

/**
 * 解析 yaml 的 "顶层 key: 字段们" 形式,返回顶层字段映射。
 *
 * 例:
 * ```
 * stage:
 *   badge: ④ 设计
 *   title: ...
 *   meta: ...
 * ```
 *
 * → `{ badge: '④ 设计', title: '...', meta: '...' }`
 *
 * 不解析嵌套对象 —— 嵌套由各 `parseXxx` 子函数负责(用 `parseNestedBlock` /
 * `parseListYaml` 显式拉取)。
 *
 * 字段值都是字符串(去除引号);数字 / 布尔不在此函数识别(场景里没用到)。
 * `topKey` 缺失 → null(让上层走兜底)。
 */
function parseFlatYamlMap(raw: string, topKey: string): Record<string, string> | null {
  const lines = raw.split('\n')
  let inTop = false
  const result: Record<string, string> = {}

  for (const line of lines) {
    const cleaned = line.replace(/^\s*#(?=\s|$).*$/, '')
    if (!cleaned.trim()) continue

    const topMatch = /^([A-Za-z_][\w-]*)\s*:\s*$/.exec(cleaned)
    if (topMatch) {
      if (inTop) break // 顶层 block 结束(遇到下一个顶层 key)
      inTop = topMatch[1] === topKey
      continue
    }

    if (!inTop) continue

    const kv = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (kv) {
      result[kv[1]] = stripQuotes(kv[2].trim())
    }
  }

  return inTop ? result : null
}

/**
 * 解析 yaml 的"顶层 key → 字段们"结构,返回字段 map。
 *
 * 支持的形式:
 * - 顶层 scalar:`stage:` / `design_doc:` 后跟 2 空格缩进的标量字段
 * - 顶层 list:`candidates:` 后跟 2 空格缩进的 `- id: A ...` 列表
 *   - 每个 entry 内的字段(4 空格缩进)递归可嵌套 scalar list(pros / cons / metrics)
 *   - 嵌套 scalar list 的 entry(6 空格缩进)只支持 scalar / 简单 k:v map
 * - 块字符串:`markdown: |` 后跟 4+ 空格缩进的行 → 拼成多行字符串
 *
 * 不支持(本期 schema 不会用到):
 * - 嵌套对象(已扁平化为 `tag_label` / `tag_variant` 等独立字段)
 * - 锚点 / 引用 / 折叠块 / flow style( `{a: b}` / `[a, b]` )
 *
 * 设计要点:
 * - 顶层 list 的 entries 数组**直接挂在 result[key]** 上,避免后续
 *   `result[key] = newEntries` 覆盖旧引用导致前序 entry 丢失
 * - 任意行解析失败 → 跳过该行(避免一行脏数据毁全文件)
 */
function parseNestedBlock(raw: string, topKey: string): Record<string, unknown> | null {
  const lines = raw.split('\n')
  let inTop = false
  const result: Record<string, unknown> = {}

  // 顶层字段状态
  type TopFieldState =
    | { kind: 'scalar'; key: string }
    | { kind: 'block'; key: string; lines: string[] }
    | {
        kind: 'list'
        key: string
        /** 引用 result[key](已挂在 result 上的同一数组);不再新建 */
        entries: Record<string, unknown>[]
        entry: Record<string, unknown> | null
      }
  let top: TopFieldState | null = null

  /**
   * 收尾顶层 block;list 类型不需要收尾(直接挂在 result 上);scalar 字段
   * 在遇到时已经写入 result,无需再 flush。
   */
  const topFlushScalarOrBlock = () => {
    if (!top) return
    if (top.kind === 'block') {
      result[top.key] = top.lines.join('\n')
    }
    if (top.kind !== 'list') top = null
  }

  // 嵌套 list(pros / cons / metrics)直接挂到 top.entry 上
  let nestedListKey: string | null = null
  let nestedListEntries: Record<string, unknown>[] = []
  let nestedListCurrent: Record<string, unknown> | null = null

  const nestedFlush = () => {
    if (nestedListKey && top && top.kind === 'list' && top.entry) {
      if (nestedListCurrent) nestedListEntries.push(nestedListCurrent)
      top.entry[nestedListKey] = nestedListEntries
    }
    nestedListKey = null
    nestedListEntries = []
    nestedListCurrent = null
  }

  for (const line of lines) {
    const cleaned = line.replace(/^\s*#(?=\s|$).*$/, '')
    if (!cleaned.trim()) continue

    const indentMatch = /^(\s*)/.exec(cleaned)!
    const indent = indentMatch[1].length

    // 顶层 key(0 缩进 + `key:`)
    if (indent === 0) {
      const topMatch = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
      if (topMatch) {
        if (inTop) break
        inTop = topMatch[1] === topKey
        continue
      }
    }

    if (!inTop) continue

    // 块字符串延续(必须 ≥ 4 空格,且 current 顶层字段是 block)
    if (top && top.kind === 'block' && indent >= 4) {
      const kv = /^\s+([A-Za-z_][\w-]*)\s*:/.exec(cleaned)
      if (!kv) {
        top.lines.push(cleaned.slice(4))
        continue
      }
    }

    // 嵌套 list 的 entry 起点(6 空格缩进 + `- key: val`)
    // 仅当 afterDash 含 `:`(k:v 形式,如 `- label: 微服务调用`)时走 k:v;
    // 否则(纯字符串,如 `- 实现简单,链路短`)fallback 到 string entry。
    const nestedListStart = /^\s{6}-\s+/.exec(cleaned)
    if (nestedListStart && nestedListKey) {
      const afterDash = cleaned.slice(nestedListStart[0].length).trim()
      const isKV = /^([A-Za-z_][\w-]*)\s*:/.test(afterDash)
      if (isKV) {
        // 收尾上一个 entry
        if (nestedListCurrent) nestedListEntries.push(nestedListCurrent)
        const entry: Record<string, unknown> = {}
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
        if (kv) entry[kv[1]] = stripQuotes(kv[2].trim())
        nestedListCurrent = entry
        continue
      }
      // fallback:字符串 entry,落到下面的 nestedListStrItem 处理
    }

    // 嵌套 list 的 entry 内字段(8+ 空格缩进的 k:v)
    const nestedListItemKv = /^\s{8,}([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (nestedListItemKv && nestedListKey && nestedListCurrent) {
      nestedListCurrent[nestedListItemKv[1]] = stripQuotes(nestedListItemKv[2].trim())
      continue
    }

    // 嵌套 list 的字符串 entry(6 空格 `- xxx` 无 k:v,如 pros: - xxx)
    const nestedListStrItem = /^\s{6}-\s+([^:]+)$/.exec(cleaned)
    if (nestedListStrItem && nestedListKey) {
      if (nestedListCurrent) nestedListEntries.push(nestedListCurrent)
      nestedListCurrent = { _: stripQuotes(nestedListStrItem[1].trim()) }
      continue
    }

    // 顶层 list 的 entry 起点(2-4 空格缩进 + `- key: val`)
    // 例:`  - id: A`(candidates 内的 candidate entry,2 空格)
    // 例:`    - id: xxx`(design_doc.toc 内的 toc item,4 空格 —— 在 nested block 的 field 下)
    const topListStart = /^\s{2,4}-\s+/.exec(cleaned)
    if (topListStart) {
      // 收尾前一个顶层 scalar / block(list 不收尾,因为 entries 直接挂在 result 上)
      topFlushScalarOrBlock()
      nestedFlush()
      const key = extractTopListKey(raw, cleaned, indent)
      if (!key) continue
      // 关键:复用 result[key] 已有的数组(若已有),否则新建并挂上
      let entries: Record<string, unknown>[]
      if (Array.isArray(result[key])) {
        entries = result[key] as Record<string, unknown>[]
      } else {
        entries = []
        result[key] = entries
      }
      const entry: Record<string, unknown> = {}
      const afterDash = cleaned.slice(topListStart[0].length).trim()
      if (afterDash) {
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
        if (kv) entry[kv[1]] = stripQuotes(kv[2].trim())
      }
      // 把 entry push 到 entries(已挂在 result 上)
      entries.push(entry)
      top = { kind: 'list', key, entries, entry }
      continue
    }

    // 顶层 list 的 entry 内 nested object 字段(6 空格缩进 k:v,且当前 top 是 list)
    // 例:`      label: 问题背景`(toc item 的字段,在 toc 列表内)
    const entryNestedFieldKv = /^\s{6}([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (entryNestedFieldKv && top && top.kind === 'list' && top.entry) {
      top.entry[entryNestedFieldKv[1]] = stripQuotes(
        entryNestedFieldKv[2].trim(),
      )
      continue
    }

    // 顶层 list 的 entry 内字段(4 空格缩进 k:v,且当前 top 是 list)
    const entryFieldKv = /^\s{4}([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (entryFieldKv && top && top.kind === 'list' && top.entry) {
      const key = entryFieldKv[1]
      const value = entryFieldKv[2].trim()

      if (value === '') {
        // 嵌套 scalar list 起点(pros / cons / metrics)
        nestedFlush()
        nestedListKey = key
        // 复用 top.entry[key] 已有数组
        if (Array.isArray(top.entry[key])) {
          nestedListEntries = top.entry[key] as Record<string, unknown>[]
        } else {
          nestedListEntries = []
        }
        nestedListCurrent = null
        continue
      }

      // 普通标量
      top.entry[key] = stripQuotes(value)
      continue
    }

    // 顶层 scalar 字段(2 空格缩进 k:v,value 非空)
    // 例:`  title: 退款功能`(顶层字段)
    // 例:`  recommendation_candidate_id: B`(list 后跟的顶层字段)
    const topFieldKv = /^\s{2}([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (topFieldKv) {
      topFlushScalarOrBlock()
      nestedFlush()
      const key = topFieldKv[1]
      const value = topFieldKv[2].trim()

      if (value === '|') {
        top = { kind: 'block', key, lines: [] }
        continue
      }

      result[key] = stripQuotes(value)
      top = { kind: 'scalar', key }
      continue
    }
  }

  topFlushScalarOrBlock()
  nestedFlush()
  return inTop ? result : null
}

/**
 * 提取顶层 list 的归属 key —— 找到当前行之前最近的"indent < currentIndent 的 key:" 字段。
 *
 * 因为 parseNestedBlock 顺序处理行,遇到 `- xxx` 时,需要知道这是哪个 list key。
 * 算法:从前一行往上回溯,直到找到 indent < currentIndent 的 `key:`(归属 key)。
 *
 * - currentIndent = 2 时找 indent = 0 的 key(顶层 list,例 candidates)
 * - currentIndent = 4 时找 indent = 2 的 key(entry 内嵌套 list,例 design_doc.toc)
 */
function extractTopListKey(
  raw: string,
  currentLine: string,
  currentIndent: number,
): string | null {
  const lines = raw.split('\n')
  const idx = lines.indexOf(currentLine)
  if (idx <= 0) return null
  for (let i = idx - 1; i >= 0; i--) {
    const cleaned = lines[i].replace(/^\s*#(?=\s|$).*$/, '').trim()
    if (!cleaned) continue
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (!m) continue
    const indent = lines[i].length - lines[i].trimStart().length
    if (indent < currentIndent) return m[1]
  }
  return null
}

/**
 * 通用 list 解析:`topKey:` 下的 `- id: ...` 列表,每条 entry 通过 `entryParser`
 * 转成目标类型。entry 解析失败 → 跳过(不污染其他 entry)。
 */
function parseListYaml<T>(
  raw: string,
  topKey: string,
  entryParser: (map: Record<string, unknown>) => T | null,
): T[] {
  const block = parseNestedBlock(raw, topKey)
  if (!block) return []
  const list = block[topKey]
  if (!Array.isArray(list)) return []
  const result: T[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const parsed = entryParser(item as Record<string, unknown>)
    if (parsed !== null) result.push(parsed)
  }
  return result
}

/** 去除字符串两端单/双引号(用于 `"foo"` / `'foo'` 形式) */
function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1)
    }
  }
  return s
}
