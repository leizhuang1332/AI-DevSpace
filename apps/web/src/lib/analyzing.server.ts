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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  AnalysisSession,
  AnalysisSessionAngle,
  AnalyzingChunk,
  AnalyzingData,
  SkillAdmissionFrontmatter,
  SourceRef,
} from './analyzing'
import {
  ANALYSIS_SESSION_ANGLE_META,
  REFUND_ANALYZING,
  buildAdmissionData,
  emptyAnalyzing,
  isSourceRef,
  resolveAdmissionDimensions,
  summarizeAnalyzingStats,
} from './analyzing'
import { loadTechBrief, loadModules } from './tech-brief.server'
import type { TechBriefModulesFile } from './tech-brief'
import { resolveRequirementsRoot } from './requirements-root.server'
import { stripQuotes } from './yaml.server'
import { extensionToImageMime } from '@ai-devspace/shared'
import type { AssetMeta, AuxFile, UsageTag } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// analysis/sessions/<session-id>/chunks.jsonl 数据源(issue 19b · 验收 #12)
// ---------------------------------------------------------------------------

/**
 * 从 `analysis/sessions/<session-id>/chunks.jsonl` 加载会话思考流。
 *
 * 文件格式:每行一个 JSON 对象,字段 `{ id, ts, label, tone, text, session_id,
 * source_refs?, synthetic? }`,按写入顺序追加(新 chunk 写在末尾 → 自然成为打字机下一条)。
 *
 * 设计要点:
 * - 文件不存在 / 解析失败 → 返回 `[]`(容错)
 * - 单行 JSON 解析失败 → 跳过该行,继续读后续(避免 1 行损坏毁全文件)
 * - 缺关键字段的 chunk → 跳过该行
 * - **JSONL 兼容**(ADR-0017 D3 · ticket 01):历史 chunk 无 `source_refs` /
 *   `synthetic` 字段 → 默认 `undefined`,行为不变;若 `source_refs` 是数组,
 *   用 `isSourceRef` 逐项校验,无效项丢弃(避免脏数据污染下游)
 * - `synthetic` 字段类型必须是 boolean;非 boolean → 视为 false(忽略)
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
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      // 校验最小字段集(避免脏行污染下游)
      if (
        typeof obj.id === 'string' &&
        typeof obj.ts === 'string' &&
        typeof obj.label === 'string' &&
        typeof obj.text === 'string' &&
        typeof obj.kind === 'string' &&
        typeof obj.tone === 'string'
      ) {
        const kind = obj.kind as AnalyzingChunk['kind']
        const chunk: AnalyzingChunk = {
          id: obj.id,
          ts: obj.ts,
          label: obj.label as AnalyzingChunk['label'],
          text: obj.text,
          kind,
          tone: obj.tone as AnalyzingChunk['tone'],
        }
        // source_refs 兼容(ADR-0017 D3):
        // 1. narration chunk 强制不带(契约二次保障,即使磁盘里写了也丢)
        // 2. 非 narration 才接受 source_refs;空数组 [] 保留以表达 "AI 明确不引用源"
        // 3. 用 isSourceRef 逐项校验,无效项丢弃
        if (kind !== 'narration') {
          const refs = obj.source_refs
          if (Array.isArray(refs)) {
            const validated: SourceRef[] = []
            for (const r of refs) {
              if (isSourceRef(r)) validated.push(r)
            }
            chunk.source_refs = validated
          }
        }
        // synthetic 字段:JSONL 显式写 true/false;类型必须是 boolean;非 boolean → 忽略
        if (typeof obj.synthetic === 'boolean') {
          chunk.synthetic = obj.synthetic
        }
        result.push(chunk)
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
// PRD / AuxFiles / Assets SSR 装载(ADR-0017 D5 · issue ticket 01)
// ---------------------------------------------------------------------------

/**
 * SSR 一次性装载主区左栏文档阅读器所需的 3 段数据。
 *
 * - `prdMarkdown`:`requirement.md` 全文。文件不存在 → 空字符串(SSR 容错)
 * - `auxFiles`:扫描 `<reqDir>/aux/<aux-id>/` 子目录,每个子目录视为一个
 *   AuxFile(`<aux-id>/<filename>.md` 作为 body);按 `usage_tag` 6 类排序,
 *   同 tag 按 `filename` 字典序
 * - `assetList`:解析 `requirement.md` 内 `![](assets/<name>)` 引用 + 与磁盘
 *   `<reqDir>/assets/` readdir 比对 → 仅返回实际存在的 asset。孤儿 asset
 *   (磁盘有但 PRD 未引用)忽略;引用了不存在的 asset 静默忽略(不报错)
 *
 * 容错:
 * - 任何一个环节失败(目录不存在 / 文件不存在 / 读 IO 错)→ 该段返回默认值,
 *   其它段不受影响;不抛错(让上层走 emptyAnalyzing 容错路径)
 *
 * Asset 字段对齐 `@ai-devspace/shared` 的 `AssetMeta`(`{name, url, path, size, mime}`):
 * - `name`:磁盘文件名(如 `prd-1.png`)
 * - `url`:`/api/requirement/<id>/assets/<name>`(前端 fetcher 直接用)
 * - `path`:`requirements/<id>/assets/<name>`(agent 内部消费)
 * - `size`:`statSync` 拿实际磁盘字节数
 * - `mime`:从扩展名反查(沿用 `extensionToImageMime` —— 共用契约)
 */
export function loadAnalyzingDocs(
  requirementsRoot: string,
  requirementId: string,
): { prdMarkdown: string; auxFiles: AuxFile[]; assetList: AssetMeta[] } {
  const reqDir = resolve(requirementsRoot, 'requirements', requirementId)
  return {
    prdMarkdown: loadPrdMarkdown(reqDir),
    auxFiles: loadAuxFiles(reqDir),
    assetList: loadAssetList(reqDir, requirementId),
  }
}

/**
 * 读 `requirement.md` 全文;文件不存在 / 读 IO 错 → 空字符串(SSR 容错)。
 *
 * 容错优于抛错:本函数被 `loadAnalyzingDocs` 高频调用,任何 fs 异常不应阻断
 * SSR(上层 `emptyAnalyzing()` 已经能兜住数据形状)。
 */
function loadPrdMarkdown(reqDir: string): string {
  const file = join(reqDir, 'requirement.md')
  if (!existsSync(file)) return ''
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 扫描 `<reqDir>/aux/` 子目录,每个子目录视为一个 AuxFile。
 *
 * 目录 layout:
 * ```
 * requirements/<id>/aux/
 *   <aux-id>/        ← 子目录名 = auxId(直接当 AuxFile.id)
 *     任何 .md 文件  ← 首个 .md 作为 body;多文件场景本期取首个
 *     meta.yaml      ← 可选:含 usage_tag;缺失 → 落到 'other'
 * ```
 *
 * 排序:`usage_tag` 6 类固定顺序(api / data / research / sop / ui / other);
 * 同 tag 按 `filename` 字典序。
 *
 * 容错:
 * - `aux/` 目录不存在 → `[]`(不抛错)
 * - 子目录无 .md 文件 → 跳过该子目录
 * - 子目录无 meta.yaml → usage_tag 落到 'other'(保守)
 *
 * 不做的事:
 * - 不解析 source_format / converted_to_md(本期 SSR 直接给 'md' / false,
 *   由 drafting 子系统维护);后续 ticket 02 + SSR 注入时再补
 */
function loadAuxFiles(reqDir: string): AuxFile[] {
  const auxDir = join(reqDir, 'aux')
  if (!existsSync(auxDir)) return []
  let entries: string[]
  try {
    entries = readdirSync(auxDir)
  } catch {
    return []
  }
  const auxFiles: AuxFile[] = []
  for (const auxId of entries) {
    const subDir = join(auxDir, auxId)
    try {
      if (!statSync(subDir).isDirectory()) continue
    } catch {
      continue
    }
    // 收集子目录下的 .md(首个非 YAML 的当作 body)
    let bodyFile: string | null = null
    let filename = ''
    let usageTag: UsageTag = 'other'
    try {
      const files = readdirSync(subDir)
      for (const f of files) {
        if (f.toLowerCase().endsWith('.md') && bodyFile === null) {
          bodyFile = f
        } else if (f === 'meta.yaml') {
          // 尝试解析 usage_tag
          usageTag = parseUsageTagFromMeta(join(subDir, f)) ?? 'other'
        }
      }
    } catch {
      continue
    }
    if (bodyFile === null) continue
    filename = bodyFile
    let body: string
    try {
      body = readFileSync(join(subDir, bodyFile), 'utf8')
    } catch {
      continue
    }
    auxFiles.push({
      id: auxId,
      filename,
      body,
      usage_tag: usageTag,
      source_format: 'md',
      converted_to_md: false,
    })
  }
  // 排序:usage_tag → filename
  auxFiles.sort((a, b) => {
    if (a.usage_tag !== b.usage_tag) {
      return USAGE_TAG_ORDER.indexOf(a.usage_tag) - USAGE_TAG_ORDER.indexOf(b.usage_tag)
    }
    return a.filename.localeCompare(b.filename)
  })
  return auxFiles
}

/** `UsageTag` 的固定展示顺序(对齐 drafting 子系统约定) */
const USAGE_TAG_ORDER: UsageTag[] = ['api', 'data', 'research', 'sop', 'ui', 'other']

/**
 * 从 aux 子目录的 `meta.yaml` 里尝试解析 `usage_tag` 字段。
 * 解析失败(文件不存在 / 格式错 / 字段缺失 / 值不在 union 内)→ 返 null,
 * 调用方落到 'other'。
 *
 * 极简解析:仅匹配 `usage_tag: api` 形式的单行,值经 stripQuotes 去引号。
 * 与 `_index.yaml` 解析策略保持一致 —— 都是受控极简格式,不引第三方依赖。
 */
function parseUsageTagFromMeta(metaPath: string): UsageTag | null {
  let raw: string
  try {
    raw = readFileSync(metaPath, 'utf8')
  } catch {
    return null
  }
  const m = /^\s*usage_tag\s*:\s*([^\n#]+)/m.exec(raw)
  if (!m) return null
  const value = stripQuotes(m[1].trim())
  const allowed: UsageTag[] = ['api', 'data', 'research', 'sop', 'ui', 'other']
  return (allowed as string[]).includes(value) ? (value as UsageTag) : null
}

/**
 * Asset 列表装载(对齐 ADR-0015 D5):
 * 1. 解析 prdMarkdown 内 `![](assets/<name>)` 引用 → 收集 name 集合
 * 2. 与磁盘 `<reqDir>/assets/` readdir 比对 → 仅保留实际命中的
 * 3. 用 `statSync` 拿 size + 用扩展名反查 mime(extensionToImageMime)
 *
 * 孤儿 asset(磁盘有但 PRD 未引用)忽略;
 * 引用了不存在的 asset 静默忽略(不报错;后者通过 PRD 引用直接说"被引用但没了"
 * —— UI 给"图片丢失"占位,本期不做)。
 */
function loadAssetList(reqDir: string, requirementId: string): AssetMeta[] {
  const assetsDir = join(reqDir, 'assets')
  if (!existsSync(assetsDir)) return []
  const referenced = extractPrdAssetRefs(loadPrdMarkdown(reqDir))
  if (referenced.size === 0) return []
  let files: string[]
  try {
    files = readdirSync(assetsDir)
  } catch {
    return []
  }
  // 防御性:命中集合里的扩展名(mime 反查)
  const out: AssetMeta[] = []
  for (const name of files) {
    if (!referenced.has(name)) continue
    const fullPath = join(assetsDir, name)
    try {
      const st = statSync(fullPath)
      if (!st.isFile()) continue
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
      const mime = extensionToImageMime(ext)
      out.push({
        name,
        url: `/api/requirement/${encodeURIComponent(requirementId)}/assets/${encodeURIComponent(name)}`,
        path: `requirements/${requirementId}/assets/${name}`,
        size: st.size,
        mime,
      })
    } catch {
      /* 单文件 stat 失败,跳过 */
    }
  }
  return out
}

/** 匹配 `![](assets/<name>)` 形态:`name` 不含 `)` / 引号 / 空白 / `#`(防 markdown 链接变体) */
const PRD_ASSET_REF_RE = /!\[[^\]]*\]\(\s*assets\/([^)\s"]+)\s*\)/g

/**
 * 从 PRD Markdown 文本提取 `![](assets/<name>)` 引用集合。
 *
 * 简化 parser(仅做行扫描 + regex,不支持嵌套或转义边缘场景):
 * - 匹配 `![any](assets/<name>)` 形态
 * - `name` 不含 `)` / 引号 / 空白 / `#`(防 markdown 链接变体)
 * - 同一 name 出现多次 → 去重
 *
 * 复杂度:O(n) 行数;空输入 → 空集合。
 *
 * 注意:regex 在模块顶层 hoisted(避免热路径重复编译)。
 */
function extractPrdAssetRefs(prdMarkdown: string): Set<string> {
  const refs = new Set<string>()
  if (!prdMarkdown) return refs
  // `g` flag + exec:利用 lastIndex 自然推进循环
  PRD_ASSET_REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PRD_ASSET_REF_RE.exec(prdMarkdown))) {
    refs.add(m[1])
  }
  return refs
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

/**
 * 判定 `<requirementsRoot>/requirements/<id>/requirement.md` 是否存在。
 * SSR 期间决定 phase 是 'empty'(无 requirement.md)还是 'not_started' / 'active'。
 *
 * - 不存在 → 'empty'(引导去 DRAFTING)
 * - 存在 → 进一步看 fs 上是否有 sessions → 'not_started' / 'active'
 *
 * 注:拼接路径时使用 `requirementsRoot + requirements + <id>` 对齐后端
 * `RequirementService.root` 的目录结构(root 之外仍有一层 `requirements/`)。
 */
function existsRequirementMd(
  requirementsRoot: string,
  requirementId: string,
): boolean {
  return existsSync(
    resolve(requirementsRoot, 'requirements', requirementId, 'requirement.md'),
  )
}
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
 * **二态 phase 判定(顺序敏感)**(issue 重构 · 直接进入主区):
 * 1. **phase === 'empty'**: `requirement.md` 不存在 → 引导去 DRAFTING。
 *    (空态 → 旧契约 `empty: true` 仍保持,行为不变)
 * 2. **phase === 'active'**: requirement.md 存在 → 走主区;fs 上是否有 sessions
 *    都直接进(主区对 chunks=[] / sessions=[] 已做容错,显示"暂无思考流"等)。
 *
 * 字段等价关系:
 * - `phase === 'empty'` ⟺ `empty === true`
 * - `phase === 'active'` ⟺ `empty === false`
 *
 * admission / sessions / techBrief 等"非空字段"按需装配 —— 即使 phase 是 'empty'
 * 也走 resolveAdmissionDimensions(渲染时 admission 可能仍展示"待裁决"提示)。
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
  // SSR 装载 active session 的 chunks(zone-data-fidelity-fixes/04 — 修复 ticket 阶段
  // 遗漏的 wiring:fs 路径下 ANALYZING 工位 chunks 永远是 [],真 AI 重启后查看历史 /
  // mock 数据都无法进入 UI。本函数之前未调 `loadSessionChunks`,active session 的
  // chunks 完全丢失,UI 渲染"暂无思考流"。补这一行后,active session 的 chunks
  // 走 fs 真实装载;切到非 active Tab 仍由 SSR 简化版决定(ticket 后续补 client
  // 切 Tab 重发请求,本期不修)。
  const activeChunks = options?.analysisSessionsDir
    ? loadSessionChunks(options.analysisSessionsDir, sessionsBundle.activeSessionId)
    : []
  const techBrief = options?.analysisDir ? loadTechBriefFromAnalysisDir(options.analysisDir) : null
  const requirementsRoot = options?.requirementsRoot ?? defaultRequirementsRoot()
  const hasRequirementMd = existsRequirementMd(requirementsRoot, requirementId)
  // ADR-0017 D5 · SSR 注入 PRD / AuxFile / Asset —— 容错读 fs,任何环节异常返回空
  const docs = loadAnalyzingDocs(requirementsRoot, requirementId)

  // 二路分支(顺序敏感)
  // 1. requirement.md 不存在 → 引导去 DRAFTING(老 empty 路径)
  if (!hasRequirementMd) {
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
      // SSR 注入字段(ADR-0017 D5)—— 即使空态也试着读,fs 缺文件时落到空字符串/[]
      prdMarkdown: docs.prdMarkdown,
      auxFiles: docs.auxFiles,
      assetList: docs.assetList,
      empty: true,
      phase: 'empty',
    }
  }

  // 2. requirement.md 存在 → 直接进主区(主区容错空 chunks / 空 sessions)
  return {
    ...emptyAnalyzing(requirementId),
    empty: false,
    phase: 'active',
    admission: buildAdmissionData({
      dimensions: dims,
      pendingAdjudicationCount: pending,
      verdict: 'pending',
    }),
    sessions: sessionsBundle.sessions,
    activeSessionId: sessionsBundle.activeSessionId,
    // active session 的 chunks(zone-data-fidelity-fixes/04 修复;ticket 阶段
    // 遗漏的 wiring,fs 路径下 chunks 永远是 [] → 真 AI 历史回看 / mock 数据
    // 无法进入 UI)。empty 分支不显式注入,沿用 emptyAnalyzing() 默认 [],
    // 符合"主区引导去 DRAFTING,不渲染思考流"的语义。
    chunks: activeChunks,
    // stats 联动(zone-data-fidelity-fixes/04 修复):顶部 stats 卡片读 data.stats,
    // 之前 spread emptyAnalyzing() 默认 {0,0,0,0} → 即使 chunks 有产物,顶部
    // stats 也显示 0,与右栏 deriveProducts(chunks) 派生列表不一致(列表算对,
    // stats 卡片算错)。用 summarizeAnalyzingStats(activeChunks) 派生。
    stats: summarizeAnalyzingStats(activeChunks),
    ...techBrief,
    // SSR 注入字段(ADR-0017 D5)
    prdMarkdown: docs.prdMarkdown,
    auxFiles: docs.auxFiles,
    assetList: docs.assetList,
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
