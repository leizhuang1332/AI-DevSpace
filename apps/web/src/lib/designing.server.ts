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
 * 路径解析(对照 PRD D-6 · ticket 05):
 * - 默认 `<requirementsRoot>` 由 `resolveRequirementsRoot()` 解析
 *   (config.yaml.workspaceRoot → AIDEVSPACE_HOME → cwd + ../.. 三层 fallback)
 * - 与后端 `RequirementService.root` 在 dev/production 都对齐到
 *   `~/.aidevspace`(dev)或 `AIDEVSPACE_HOME`(production),前端 loader 不再
 *   硬编码 `cwd + ../../requirements`
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
 *
 * yaml 解析: 复用了 `apps/web/src/lib/yaml.server.ts` 的
 * `parseNestedBlock` / `parseListYaml` / `stripQuotes` /
 * `readYamlFileOrNull`(ticket 05 抽出,设计 / drafting loader 共用)
 */

import { existsSync } from 'node:fs'
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
import { resolveRequirementsRoot } from './requirements-root.server'
import {
  parseNestedBlock,
  parseListYaml,
  readYamlFileOrNull as readYamlOrNull,
  stripQuotes,
} from './yaml.server'

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

/** 默认 requirements 根:走 `resolveRequirementsRoot()` 三层 fallback
 *  (config.yaml.workspaceRoot → AIDEVSPACE_HOME → cwd + ../..),
 *  与后端 `RequirementService.root` 完全对齐(见 PRD D-6) */
function defaultRequirementsRoot(): string {
  return resolveRequirementsRoot()
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
  // 路径:`<root>/requirements/<reqId>/design/`(对齐 ADR-0002 文件系统结构)
  // root = workspace 根(由 `resolveRequirementsRoot()` 解析),所有 loader 统一
  // 拼接 `requirements/<id>/...` 以跟后端 `RequirementService.root` 对齐。
  const designDir = resolve(root, 'requirements', requirementId, 'design')

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
// YAML 适配层 —— 设计/业务字段的 adapter(从 yaml map → DesigningData 字段)
//
// 通用 yaml 解析原语(parseFlatMap / parseNestedBlock / parseListYaml /
// stripQuotes / readYamlOrNull)在 `yaml.server.ts` 里,本文件只负责:
// - 字段命名 snake_case → camelCase 转换
// - 业务校验(id ∈ {A,B,C} / tag_variant 枚举等)
// ---------------------------------------------------------------------------
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
  const map = parseNestedBlock(raw, 'stage')
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
