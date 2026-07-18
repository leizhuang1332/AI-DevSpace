/**
 * ANALYZING 工位 — server-only 数据层
 *
 * 设计动机(issue 19a/19b · Webpack `UnhandledSchemeError` 修复):
 *
 * `analyzing.ts` 同时被两类消费者引用:
 * 1. server component(RSC,例如 `app/(workspace)/requirements/[id]/[zone]/page.tsx`)
 *    — 通过 `getAnalyzingData(reqId)` 拉 server 端数据
 * 2. client component(`'use client'`,例如 `components/analyzing-zone.tsx`)
 *    — 通过 `deriveProducts(chunks)` 在客户端实时派生识别产物
 *
 * 当两类代码都从同一个文件 `import` 时,Next.js/webpack 会把整个模块拉进
 * *所有* 引用方的 bundle。`getAnalyzingData` 内部用 `node:fs` 读
 * `analysis/sessions/<id>/chunks.jsonl` 走文件系统 IO —— 这部分代码一旦误入
 * 客户端 bundle,webpack 会抛:
 *   `UnhandledSchemeError: Reading from "node:fs" is not handled by plugins`
 *
 * 修复方案(本文件):
 *
 * - `analyzing.ts` 只留 types + 纯函数 + mock 数据(纯函数可被客户端与 SSR 共用)
 * - 本文件专存 server-only IO + 数据获取,通过 Next.js `.server.ts` 命名约定
 *   标记(项目当前未安装 `server-only` npm 包;若以后装了,把 `import 'server-only'`
 *   放文件顶部即可获得编译期越界保护)
 * - 仅被 RSC(`page.tsx`)和 vitest(同进程 Node.js)引用;client component 不应
 *   import 本文件
 * - 本文件 `import type { ... } from './analyzing'` 仅带类型,TS 编译后是零字节,
 *   不会触发 webpack 模块解析,不会泄露 client 数据
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  AnalysisSession,
  AnalysisSessionAngle,
  AnalyzingChunk,
  AnalyzingData,
  SkillAdmissionFrontmatter,
} from './analyzing'
import {
  ANALYSIS_SESSION_ANGLE_META,
  REFUND_ANALYZING,
  buildAdmissionData,
  emptyAnalyzing,
  resolveAdmissionDimensions,
} from './analyzing'
import { loadTechBrief, loadModules } from './tech-brief.server'
import type { TechBriefModulesFile } from './tech-brief'
import { resolveRequirementsRoot } from './requirements-root.server'
import { stripQuotes } from './yaml.server'

// ---------------------------------------------------------------------------
// analysis/sessions/<session-id>/chunks.jsonl 数据源(issue 19b · 验收 #12)
// ---------------------------------------------------------------------------

/**
 * 从 `analysis/sessions/<session-id>/chunks.jsonl` 加载会话思考流。
 *
 * 文件格式:每行一个 JSON 对象,字段 `{ id, ts, label, tone, text, session_id }`,
 * 按写入顺序追加(新 chunk 写在末尾 → 自然成为打字机下一条)。
 *
 * 设计要点:
 * - 文件不存在 / 解析失败 → 返回 `[]`(容错)
 * - 单行 JSON 解析失败 → 跳过该行,继续读后续(避免 1 行损坏毁全文件)
 * - 与 `getAnalyzingData` 解耦:`getAnalyzingData` 负责顶层数据契约,本函数专注单文件加载
 */
export function loadSessionChunks(
  analysisSessionsDir: string,
  sessionId: string,
): AnalyzingChunk[] {
  const file = join(analysisSessionsDir, sessionId, 'chunks.jsonl')
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const result: AnalyzingChunk[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as Partial<AnalyzingChunk>
      // 校验最小字段集(避免脏行污染下游)
      if (
        typeof obj.id === 'string' &&
        typeof obj.ts === 'string' &&
        typeof obj.label === 'string' &&
        typeof obj.text === 'string' &&
        typeof obj.kind === 'string' &&
        typeof obj.tone === 'string'
      ) {
        result.push(obj as AnalyzingChunk)
      }
    } catch {
      /* 单行损坏,跳过;继续读后续行 */
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// analysis/adjudication.md 计数(SSR 期 mock 路径由调用方注入)
// ---------------------------------------------------------------------------

/**
 * 从 analysisDir 读 adjudication.md,计数未裁决项(`applied: false` 或未标 applied)。
 * 文件不存在 / 解析失败 → 0(容错)。
 */
export function countPendingAdjudications(analysisDir: string): number {
  try {
    const file = join(analysisDir, 'adjudication.md')
    if (!existsSync(file)) return 0
    const text = readFileSync(file, 'utf8')
    return countUnresolvedItems(text)
  } catch {
    return 0
  }
}

/**
 * 纯函数:从 Markdown 文本里统计 `- item_id:` 起的 bullet,
 * 若该 bullet 内 `applied: false` 或无 `applied:` 字段 → 计 1(视为待裁决)。
 */
export function countUnresolvedItems(text: string): number {
  if (!text.trim()) return 0
  let count = 0
  // 按 bullet 行分割(- 开头,可能含 2 空格缩进)
  const lines = text.split('\n')
  let inItem = false
  let hasAppliedFalse = false
  let hasAppliedTrue = false
  let hasAppliedField = false

  const flush = () => {
    if (inItem) {
      // 保守策略:有 applied:true → 不计;其余(applied:false 或无 applied)→ 计
      if (!hasAppliedTrue || hasAppliedFalse) {
        count++
      }
    }
    inItem = false
    hasAppliedFalse = false
    hasAppliedTrue = false
    hasAppliedField = false
  }

  for (const line of lines) {
    // bullet 起点
    if (/^\s*-\s+item_id\s*:/.test(line)) {
      flush()
      inItem = true
      hasAppliedFalse = false
      hasAppliedTrue = false
      hasAppliedField = false
      continue
    }
    if (!inItem) continue

    // bullet 内行
    if (/^\s+applied\s*:\s*true\b/.test(line)) {
      hasAppliedField = true
      hasAppliedTrue = true
    } else if (/^\s+applied\s*:\s*false\b/.test(line)) {
      hasAppliedField = true
      hasAppliedFalse = true
    }
  }
  flush()
  return count
}

// ---------------------------------------------------------------------------
// RSC 数据入口
//
// Mock 数据源常量 `REFUND_ANALYZING` 在 `analyzing.ts`(client-safe)里声明,
// 原因:它的 `chunks` + `stats` 也被客户端组件(analyzing-zone.test.tsx 等)测试
// 使用;server 文件仅在运行时按 id 命中时浅拷贝它,不在此重复定义。
// ---------------------------------------------------------------------------

/**
 * 拉取 ANALYZING 工位数据(SSR 期 mock —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001)→ REFUND_ANALYZING 样例数据(短路在 default options
 *   注入**之前**;即便 fs 里有 _index.yaml 也用硬编码 mock)
 * - 其他 id:若 caller 没传 `analysisDir` / `analysisSessionsDir`,自动按
 *   `<requirementsRoot>/<reqId>/analysis[/sessions]` 注入;fs 缺产物时
 *   走 fallback(default 单会话 / 0 待裁决 / 5 维度 + pending verdict)
 *
 * options 用于接入真实数据源(后续 VS 接 server action):
 * - `skillFrontmatter`: Skill SKILL.md frontmatter(读 admission_dimensions + admission_override)
 * - `analysisDir`: 需求 analysis 目录(读 adjudication.md 计数);
 *   **缺省时**按 `requirementsRoot + reqId + analysis` 自动注入
 * - `analysisSessionsDir`: 读 _index.yaml + 各会话 chunks.jsonl;**缺省时**按
 *   `analysisDir + sessions` 自动注入
 * - `lastSessionId`: cookie 注入的 active session;**透传逻辑不变**
 * - `requirementsRoot`: 覆盖 dev 默认的 `<repo-root>/requirements/`(主要给
 *   测试用)
 */
export async function getAnalyzingData(
  requirementId: string,
  options?: GetAnalyzingDataOptions,
): Promise<AnalyzingData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_ANALYZING, requirementId }
  }
  // 未知 id / 新建需求 → 走 emptyAnalyzing + fs 装配(wiring 保留)
  const resolved = resolveAnalysisPaths(requirementId, options)
  return emptyAnalyzingWithOptions(requirementId, resolved)
}

/**
 * 把 options 中缺省的 `analysisDir` / `analysisSessionsDir` 解析为绝对路径。
 *
 * - caller 显式传入的字段保留原值(后续 agent API 仍可接管)
 * - 缺省字段按 `requirementsRoot + reqId + analysis[/sessions]` 拼:
 *   - `requirementsRoot` 缺省 → dev 默认 `<repo-root>/requirements/`
 *   - `analysisSessionsDir` 缺省且 `analysisDir` 已解析 → 拼 `<analysisDir>/sessions`
 *
 * 返回新对象,不动原 options(避免污染调用方)。
 */
function resolveAnalysisPaths(
  requirementId: string,
  options: GetAnalyzingDataOptions | undefined,
): GetAnalyzingDataOptions {
  const requirementsRoot =
    options?.requirementsRoot ?? defaultRequirementsRoot()
  // 路径:`<root>/requirements/<reqId>/analysis`(对齐 ADR-0002 文件系统结构)
  // root = workspace 根(由 `resolveRequirementsRoot()` 解析),所有 loader 统一
  // 拼接 `requirements/<id>/...` 以跟后端 `RequirementService.root` 对齐。
  const defaultAnalysisDir = resolve(
    requirementsRoot,
    'requirements',
    requirementId,
    'analysis',
  )
  const analysisDir = options?.analysisDir ?? defaultAnalysisDir
  const analysisSessionsDir =
    options?.analysisSessionsDir ?? resolve(analysisDir, 'sessions')
  return {
    ...options,
    analysisDir,
    analysisSessionsDir,
  }
}

/** getAnalyzingData options —— 后续切 server action 时注入真实数据源 */
export interface GetAnalyzingDataOptions {
  skillFrontmatter?: SkillAdmissionFrontmatter
  analysisDir?: string
  /**
   * 需求 analysis/sessions/ 目录(读 _index.yaml + 各会话 chunks.jsonl)。
   * 不传 → 走 mock(默认 1 个"架构"会话)。
   */
  analysisSessionsDir?: string
  /**
   * 上次访问的 active session id(cookie 注入)—— 优先级高于 sessions[0].id。
   * 不存在或不在 sessions 列表中 → 退回到 sessions[0].id。
   */
  lastSessionId?: string
  /**
   * requirements 根目录覆盖(主要为测试方便注入 fs 路径)。
   * - 默认:dev 时 cwd = `<repo-root>/apps/web/`,即 `<repo-root>/requirements/`
   * - 显式传入 → `analysisDir` / `analysisSessionsDir` 缺省时按
   *   `<requirementsRoot>/<reqId>/analysis[/sessions]` 解析
   * - 同时显式传 `analysisDir` / `analysisSessionsDir` 时,这两项优先生效
   *   (本字段只影响未显式传入的字段)
   */
  requirementsRoot?: string
}

// ---------------------------------------------------------------------------
// 默认路径解析(issue: zone-data-fidelity-fixes · 02 / ANALYZING 部分 · ticket 05 / D-6)
//
// 走 `resolveRequirementsRoot()` 三层 fallback
// (config.yaml.workspaceRoot → AIDEVSPACE_HOME → cwd + ../..),与后端
// `RequirementService.root` 在 dev/production 都对齐到 `~/.aidevspace`
// (dev) 或 `AIDEVSPACE_HOME`(production)。前端 loader 不再硬编码
// `cwd + ../../requirements`(PRD N-2 已废止)。
// ---------------------------------------------------------------------------

/** 默认 requirements 根:走 `resolveRequirementsRoot()` 三层 fallback(见 PRD D-6) */
function defaultRequirementsRoot(): string {
  return resolveRequirementsRoot()
}

/**
 * emptyAnalyzing 的"接装配"版本 —— 即使是空需求,维度也走 resolveAdmissionDimensions,
 * pendingAdjudicationCount 也走 countPendingAdjudications(容错返回 0)。
 *
 * 拆分函数而非 inline:让 getAnalyzingData 主线保持直白,装配逻辑单测容易。
 *
 * empty 字段判定:
 * - fs 里有真实 sessions 内容(非 default 单会话兜底)+ 至少 1 个 chunks.jsonl 有内容
 *   → `empty: false`(满足 PRD 验收:"_index.yaml 存在 + 至少 1 个会话 chunks 有内容 → 构造非空")
 * - 否则 → `empty: true`(沿用 emptyAnalyzing 默认)
 */
function emptyAnalyzingWithOptions(
  requirementId: string,
  options?: GetAnalyzingDataOptions,
): AnalyzingData {
  const dims = resolveAdmissionDimensions(options?.skillFrontmatter)
  const pending = options?.analysisDir
    ? countPendingAdjudications(options.analysisDir)
    : 0
  const sessionsBundle = loadSessionsBundle(options?.analysisSessionsDir, options?.lastSessionId)
  const techBrief = options?.analysisDir ? loadTechBriefFromAnalysisDir(options.analysisDir) : null
  // empty 判定:fs 有真实 sessions(非 fallback)→ 非空
  const hasFsSessions = hasFsSessionContent(options?.analysisSessionsDir)
  return {
    ...emptyAnalyzing(requirementId),
    admission: buildAdmissionData({
      dimensions: dims,
      pendingAdjudicationCount: pending,
      verdict: 'pending',
    }),
    sessions: sessionsBundle.sessions,
    activeSessionId: sessionsBundle.activeSessionId,
    ...techBrief,
    empty: !hasFsSessions,
  }
}

/**
 * 判定 fs 是否真的有 sessions 内容(非默认单会话兜底):
 * - analysisSessionsDir 缺省 / `_index.yaml` 不存在 / 解析失败 → false
 * - 至少 1 个会话的 `chunks.jsonl` 非空 → true
 * - 否则 → false(仅有 sessions 元数据但没真实内容,仍算空)
 */
function hasFsSessionContent(analysisSessionsDir: string | undefined): boolean {
  if (!analysisSessionsDir) return false
  const bundle = loadSessionsBundle(analysisSessionsDir, undefined)
  // sessions 来自 fallback(id='default')说明 fs 没内容
  if (bundle.sessions.length === 1 && bundle.sessions[0].id === 'default') {
    return false
  }
  // 检查每个会话是否有 chunks.jsonl 内容
  for (const session of bundle.sessions) {
    const chunks = loadSessionChunks(analysisSessionsDir, session.id)
    if (chunks.length > 0) return true
  }
  return false
}

/**
 * 从 analysisDir 加载技术概要产物(issue 19e VS5)。
 * - 双产物都存在 → 返回 { brief, modules, generatedAt }
 * - 缺一 → 返回 null(让顶层字段保持默认 null)
 */
function loadTechBriefFromAnalysisDir(analysisDir: string): {
  techBriefPreview: string
  modulesPreview: TechBriefModulesFile
  briefGeneratedAt: string
} | null {
  const brief = loadTechBrief(analysisDir)
  if (brief === null) return null
  const modules = loadModules(analysisDir)
  // 派生 generatedAt:取两个文件 mtime 的较新者
  let mtimeMs = 0
  for (const name of ['technical-brief.md', 'modules.yaml']) {
    const p = join(analysisDir, name)
    if (existsSync(p)) {
      try {
        const st = statSync(p)
        if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs
      } catch {
        /* ignore */
      }
    }
  }
  return {
    techBriefPreview: brief,
    modulesPreview: modules,
    briefGeneratedAt: mtimeMs > 0 ? new Date(mtimeMs).toISOString() : new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 多会话(ADR-0013 D7 · issue 19c VS3)
// ---------------------------------------------------------------------------

/**
 * 多会话加载结果:包含 sessions 列表 + 默认 activeSessionId。
 *
 * - 文件不存在 → 返回默认单会话 `{ id: 'default', label: '架构', angle: 'architecture', detectedCount: 0, isStreaming: false }`
 * - 解析失败 → 同上(容错)
 * - lastSessionId 命中 → activeSessionId = lastSessionId,否则 sessions[0].id
 */
export interface SessionsBundle {
  sessions: AnalysisSession[]
  activeSessionId: string
}

/**
 * 默认单会话(issue 19c 验收 #13:文件不存在时返回 `{ id: 'default', label: '架构', ... }`)。
 */
export function defaultSessionsBundle(): SessionsBundle {
  return {
    sessions: [
      {
        id: 'default',
        label: '架构',
        angle: 'architecture',
        detectedCount: 0,
        isStreaming: false,
      },
    ],
    activeSessionId: 'default',
  }
}

/**
 * 加载多会话数据:从 analysisSessionsDir/_index.yaml 读会话列表 + 解析默认 active。
 *
 * - sessionsDir 不存在 / _index.yaml 不存在 → 返回 defaultSessionsBundle()
 * - _index.yaml 解析失败 → 返回 defaultSessionsBundle()(容错)
 * - sessions 解析成功但数组为空 → 返回 defaultSessionsBundle()
 * - lastSessionId 命中 sessions 中某项 → activeSessionId = lastSessionId
 * - 否则 → activeSessionId = sessions[0].id
 */
export function loadSessionsBundle(
  sessionsDir: string | undefined,
  lastSessionId: string | undefined,
): SessionsBundle {
  const fallback = defaultSessionsBundle()
  if (!sessionsDir) return fallback

  const indexFile = join(sessionsDir, '_index.yaml')
  if (!existsSync(indexFile)) return fallback

  let raw: string
  try {
    raw = readFileSync(indexFile, 'utf8')
  } catch {
    return fallback
  }
  const sessions = parseSessionsIndexYaml(raw)
  if (sessions.length === 0) return fallback

  const active =
    (lastSessionId && sessions.some((s) => s.id === lastSessionId)
      ? sessions.find((s) => s.id === lastSessionId)
      : null) ?? sessions[0]

  return { sessions, activeSessionId: active.id }
}

/**
 * 解析 analysis/sessions/_index.yaml —— 受限格式:
 *
 * ```yaml
 * sessions:
 *   - id: sess-default
 *     label: 架构
 *     angle: architecture
 *     detected_count: 3
 *     is_streaming: false
 *     created_at: 2026-07-12T14:00:00+08:00
 * ```
 *
 * 设计要点:
 * - 极简解析器(只为这个受控格式):不引第三方依赖,解析失败返回 []
 * - 字段缺失时给默认值(id 缺失 → 跳过该 entry;其他字段缺失 → 默认值)
 * - angle 受 ANALYSIS_SESSION_ANGLE_META 约束,未知值回落到 'custom'
 * - 单行解析失败 → 跳过该 entry,继续(避免一行脏数据毁全文件)
 *
 * 这是 constrcutive 的格式定义(由本仓库写入),不追求通用 YAML。
 */
export function parseSessionsIndexYaml(text: string): AnalysisSession[] {
  if (!text.trim()) return []
  const lines = text.split('\n')
  const result: AnalysisSession[] = []
  let inSessions = false
  let current: Partial<AnalysisSession> | null = null

  const flush = () => {
    if (current && typeof current.id === 'string') {
      result.push({
        id: current.id,
        label: typeof current.label === 'string' ? current.label : current.id,
        angle:
          typeof current.angle === 'string' &&
          current.angle in ANALYSIS_SESSION_ANGLE_META
            ? (current.angle as AnalysisSessionAngle)
            : 'custom',
        detectedCount:
          typeof current.detectedCount === 'number' ? current.detectedCount : 0,
        isStreaming: Boolean(current.isStreaming),
      })
    }
    current = null
  }

  for (const line of lines) {
    // 去除尾注 + 注释
    const cleaned = line.replace(/#.*$/, '')
    if (!cleaned.trim()) continue

    // top-level key: "sessions:"
    const topMatch = /^([A-Za-z_][\w-]*)\s*:\s*$/.exec(cleaned)
    if (topMatch) {
      flush()
      inSessions = topMatch[1] === 'sessions'
      continue
    }

    // list 起点:"  - key: val" 或 "  - key: val"
    const listStart = /^\s*-\s+/.exec(cleaned)
    if (listStart && inSessions) {
      flush()
      // 可能同一行有首个 key
      const afterDash = cleaned.slice(listStart[0].length).trim()
      current = {}
      if (afterDash) {
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
        if (kv) assignField(current, kv[1], kv[2])
      }
      continue
    }

    // list 项内字段:"    key: val"
    if (current && inSessions) {
      const kv = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
      if (kv) {
        assignField(current, kv[1], kv[2])
        continue
      }
    }
  }
  flush()
  return result
}

/**
 * 解析 `_index.yaml` 单字段 → 写入 current 对象。
 *
 * - `id` / `label` / `angle` → 字符串(去除引号)
 * - `detected_count` / `is_streaming` → 推断类型(detectedCount: number,isStreaming: bool)
 * - 其他字段(例如 `created_at`)→ 忽略(本 slice 不用)
 */
function assignField(
  current: Partial<AnalysisSession>,
  key: string,
  rawValue: string,
): void {
  const value = stripQuotes(rawValue.trim())
  switch (key) {
    case 'id':
      current.id = value
      return
    case 'label':
      current.label = value
      return
    case 'angle':
      current.angle = value as AnalysisSessionAngle
      return
    case 'detected_count':
      current.detectedCount = parseIntOr(value, 0)
      return
    case 'is_streaming':
      current.isStreaming = value === 'true'
      return
    default:
      return
  }
}

/** 解析整数,失败 → fallback */
function parseIntOr(s: string, fallback: number): number {
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}
