/**
 * ANALYZING 工位 — server-only 数据层(issue 08 · ADR-0021 契约收缩)
 *
 * 设计动机:
 * - `analyzing.ts` 只保留 client-safe 内容(types + 纯函数)
 * - 本文件专存 server-only IO + 数据获取,通过 `.server.ts` 命名约定标记
 * - 客户端 component 不应 import 本文件(避免 node:fs / yaml 污染 client bundle)
 *
 * 领域模型(issue 08 之后):
 * - Analysis Skill(workspace 集合 + per-Requirement 选择)
 * - Analysis Run(Run 元数据列表,按 created_at 倒序)
 * - Analysis Issue / Issue Response / Analysis Run Log 由 SSE 事件实时推送,
 *   本文件**不**预加载 —— SSR 仅负责 Run 元数据骨架,Issue / Response / Log
 *   在用户切到具体 Run 后由前端调 GET 详情 + 订阅 SSE 累积
 *
 * 不再加载:
 * - chunks.jsonl(旧 Session 思考流) → 旧 analyzing 域删
 * - analysis/sessions/_index.yaml → 多会话 Tab 已删除
 * - analysis/adjudication.md → Pending Adjudication 已删除
 * - analysis/technical-brief.md / modules.yaml → Technical Brief / Aggregate
 *   Module 已删除
 *
 * 仍保留:
 * - PRD / AuxFile / Asset SSR 装载(供 DocumentReaderPane 渲染画线高亮)
 * - Analysis Skill / selected-skill.yaml SSR 装载
 * - Analysis Run / runs/<run-id>/meta.yaml SSR 装载
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'yaml'
import type { AssetMeta, AuxFile, UsageTag } from '@ai-devspace/shared'
import {
  AnalysisRunMetaSchema,
  AnalysisSkillMetaSchema,
  isReservedAnalysisSkillName,
  parseMinimalFrontmatter,
  splitSkillMarkdown,
  type AnalysisRunMeta,
  type AnalysisSkillMeta,
} from '@ai-devspace/shared'
import { emptyAnalyzing, type AnalyzingData } from './analyzing'
import { resolveRequirementsRoot } from './requirements-root.server'
import { stripQuotes } from './yaml.server'

export { resolveRequirementsRoot } from './requirements-root.server'

// ---------------------------------------------------------------------------
// PRD / AuxFiles / Assets SSR 装载(ADR-0017 D5)
// ---------------------------------------------------------------------------

/**
 * SSR 一次性装载主区左栏文档阅读器所需的 3 段数据。
 *
 * - `prdMarkdown`:`requirement.md` 全文。文件不存在 → 空字符串(SSR 容错)
 * - `auxFiles`:扫描 `<reqDir>/aux/<aux-id>/` 子目录,按 `usage_tag` 6 类排序,
 *   同 tag 按 `filename` 字典序
 * - `assetList`:解析 `requirement.md` 内 `![](assets/<name>)` 引用 + 与磁盘
 *   `<reqDir>/assets/` readdir 比对 → 仅返回实际存在的 asset。
 *
 * 容错:任何一个环节失败(目录不存在 / 文件不存在 / 读 IO 错)→ 该段返回
 * 默认值,其它段不受影响;不抛错(让上层走 emptyAnalyzing 容错路径)。
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

function loadPrdMarkdown(reqDir: string): string {
  const file = join(reqDir, 'requirement.md')
  if (!existsSync(file)) return ''
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

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
    let bodyFile: string | null = null
    let filename = ''
    let usageTag: UsageTag = 'other'
    try {
      const files = readdirSync(subDir)
      for (const f of files) {
        if (f.toLowerCase().endsWith('.md') && bodyFile === null) {
          bodyFile = f
        } else if (f === 'meta.yaml') {
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
  auxFiles.sort((a, b) => {
    if (a.usage_tag !== b.usage_tag) {
      return USAGE_TAG_ORDER.indexOf(a.usage_tag) - USAGE_TAG_ORDER.indexOf(b.usage_tag)
    }
    return a.filename.localeCompare(b.filename)
  })
  return auxFiles
}

const USAGE_TAG_ORDER: UsageTag[] = ['api', 'data', 'research', 'sop', 'ui', 'other']

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

const PRD_ASSET_REF_RE = /!\[[^\]]*\]\(\s*assets\/([^)\s"]+)\s*\)/g

function extractPrdAssetRefs(prdMarkdown: string): Set<string> {
  const refs = new Set<string>()
  if (!prdMarkdown) return refs
  PRD_ASSET_REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PRD_ASSET_REF_RE.exec(prdMarkdown))) {
    refs.add(m[1])
  }
  return refs
}

// Asset mime 反查(共用契约 — 见 packages/shared/src/drafting.ts)
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

function extensionToImageMime(ext: string): string {
  if (!ext) return 'application/octet-stream'
  return IMAGE_EXT_TO_MIME[ext] ?? 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// Analysis Skill SSR 装载(issue 01 · ADR-0021)
// ---------------------------------------------------------------------------

/**
 * SSR 装载可用 Analysis Skill 列表 + 该 Requirement 已选择 Skill。
 *
 * - `availableSkills` 按 name 字典序排序
 * - `selectedSkillName` 解析顺序:
 *   1) 读 `<root>/requirements/<id>/analysis/selected-skill.yaml`
 *   2) 解析出的 `skill_name` 仍在 availableSkills → 沿用
 *   3) 否则 → 回退到 availableSkills 首项
 *   4) 都不可用 → 空字符串(页面走"无可用 Skill"明确状态)
 *
 * 任一 fs 步骤失败(目录不存在 / 解析失败)→ 该步空集合 / 空字符串,
 * 不抛错(SSR 容错优于抛错)。
 */
export function loadAnalysisSkillsBundle(
  workspaceRoot: string,
  requirementId: string,
): { availableSkills: AnalysisSkillMeta[]; selectedSkillName: string } {
  const skillsDir = join(workspaceRoot, 'analysis-skills')
  const availableSkills = readAnalysisSkillsDir(skillsDir)
  const selectionFile = join(
    workspaceRoot,
    'requirements',
    requirementId,
    'analysis',
    'selected-skill.yaml',
  )
  const persistedName = readSelectedSkillName(selectionFile)
  let selectedSkillName: string
  if (
    persistedName &&
    availableSkills.some((s) => s.name === persistedName)
  ) {
    selectedSkillName = persistedName
  } else if (availableSkills.length > 0) {
    selectedSkillName = availableSkills[0].name
  } else {
    selectedSkillName = ''
  }
  return { availableSkills, selectedSkillName }
}

function readAnalysisSkillsDir(dir: string): AnalysisSkillMeta[] {
  if (!existsSync(dir)) return []
  let entries: { name: string; isDir: boolean }[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, isDir: true }))
  } catch {
    return []
  }
  const out: AnalysisSkillMeta[] = []
  for (const entry of entries) {
    const meta = readOneAnalysisSkill(join(dir, entry.name), entry.name)
    if (meta) out.push(meta)
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function readOneAnalysisSkill(
  skillDir: string,
  dirName: string,
): AnalysisSkillMeta | null {
  const file = join(skillDir, 'SKILL.md')
  if (!existsSync(file)) return null
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const split = splitSkillMarkdown(raw)
  if (!split) return null
  const fm = parseMinimalFrontmatter(split.frontmatterText)
  const candidate = {
    name: fm.name ?? dirName,
    description: fm.description ?? '',
    version: fm.version ?? '',
    is_reserved: isReservedAnalysisSkillName(fm.name ?? dirName),
  }
  const parsed = AnalysisSkillMetaSchema.safeParse(candidate)
  if (!parsed.success) return null
  if (split.body.trim().length === 0) return null
  return parsed.data
}

function readSelectedSkillName(file: string): string {
  if (!existsSync(file)) return ''
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = yaml.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as { skill_name?: unknown }).skill_name === 'string'
    ) {
      const name = (parsed as { skill_name: string }).skill_name.trim()
      if (name.length > 0) return name
    }
  } catch {
    /* fall through */
  }
  return ''
}

// ---------------------------------------------------------------------------
// Analysis Run SSR 装载(issue 02 · ADR-0021)
// ---------------------------------------------------------------------------

/**
 * 扫描 `<root>/requirements/<req-id>/analysis/runs/<run-id>/` 子目录,
 * 读取每个子目录的 `meta.yaml`,校验通过 `AnalysisRunMetaSchema` 的入列表;
 * 非法 Run 跳过;按 created_at 倒序(最新在前)。
 *
 * 与 Agent 端 `AnalysisRunService.listRuns()` 行为一致 —— SSR 直接读 fs,
 * 绕过 HTTP;Zod 二次校验防契约漂移。
 */
export function loadAnalysisRuns(
  workspaceRoot: string,
  requirementId: string,
): AnalysisRunMeta[] {
  const runsDir = join(workspaceRoot, 'requirements', requirementId, 'analysis', 'runs')
  if (!existsSync(runsDir)) return []
  let entries: { name: string; isDir: boolean }[]
  try {
    entries = readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, isDir: true }))
  } catch {
    return []
  }
  const out: AnalysisRunMeta[] = []
  for (const entry of entries) {
    const metaPath = join(runsDir, entry.name, 'meta.yaml')
    if (!existsSync(metaPath)) continue
    let raw: string
    try {
      raw = readFileSync(metaPath, 'utf8')
    } catch {
      continue
    }
    let parsed: unknown
    try {
      parsed = yaml.parse(raw)
    } catch {
      continue
    }
    const validated = AnalysisRunMetaSchema.safeParse(parsed)
    if (validated.success) out.push(validated.data)
  }
  out.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return out
}

// ---------------------------------------------------------------------------
// RSC 数据入口
// ---------------------------------------------------------------------------

/**
 * 拉取 ANALYZING 工位数据(SSR 装载文档 + Skill + Run 骨架)。
 *
 * Phase 判定:
 * - `requirement.md` 不存在 → `empty: true`,UI 引导去 DRAFTING
 * - `requirement.md` 存在 → `empty: false`,主区渲染
 *
 * 不读旧领域文件:`analysis/sessions/_index.yaml` / `chunks.jsonl` /
 * `analysis/adjudication.md` / `technical-brief.md` / `modules.yaml` 全部
 * 忽略,即便磁盘上仍有历史遗留。
 *
 * options 仅为测试方便注入 `requirementsRoot`;生产路径不传 option,内部走
 * `resolveRequirementsRoot()`(config.yaml / AIDEVSPACE_HOME / cwd 三层 fallback)。
 */
export async function getAnalyzingData(
  requirementId: string,
  options?: { requirementsRoot?: string },
): Promise<AnalyzingData> {
  const requirementsRoot = options?.requirementsRoot ?? resolveRequirementsRoot()
  const reqDir = resolve(requirementsRoot, 'requirements', requirementId)
  const hasRequirementMd = existsSync(join(reqDir, 'requirement.md'))
  const docs = loadAnalyzingDocs(requirementsRoot, requirementId)
  const analysisSkills = loadAnalysisSkillsBundle(requirementsRoot, requirementId)
  const analysisRuns = loadAnalysisRuns(requirementsRoot, requirementId)
  return {
    ...emptyAnalyzing(requirementId),
    empty: !hasRequirementMd,
    prdMarkdown: docs.prdMarkdown,
    auxFiles: docs.auxFiles,
    assetList: docs.assetList,
    availableSkills: analysisSkills.availableSkills,
    selectedSkillName: analysisSkills.selectedSkillName,
    runs: analysisRuns,
  }
}