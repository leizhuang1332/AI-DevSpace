/**
 * Analysis Skill 契约(issue 01 · ADR-0021)
 *
 * Analysis Skill 是 Workspace 级共享的只读分析规则集,与全局/个人/项目
 * Skill 分属不同物理集合(decision 6)。每个 Skill 由一个独立目录承载
 * `SKILL.md`,frontmatter 声明名称、功能简介与语义版本。
 *
 * - 独立物理集合:`<workspaceRoot>/analysis-skills/<name>/SKILL.md`
 *   —— 不与 `~/.aidevspace/skills/`(user Skill)或 agent 内置 `skills/built-in/`
 *   共享扫描路径
 * - 平台保留名称:`prd-completeness` / `implementation-readiness`
 *   —— 应用升级时由 Agent 用系统版本强制覆盖;其他名称由 Workspace 保留
 * - 每次 list 实时 readdir,无缓存(沿用 decision 74 repos 模式)
 * - 非法 Skill(frontmatter 字段缺失或类型错)→ 跳过,不入列表(沿用
 *   `splitSkillMarkdown` + `parseMinimalFrontmatter` 容错规则)
 * - 客户端 + 服务端均做 Zod 二次校验,防契约漂移
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// SemVer —— 极简语义版本(只校验 3 段数字,允许可选 pre-release / build)
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export const SemVerSchema = z
  .string()
  .regex(SEMVER_RE, 'version must be a semver string, e.g. 1.0.0')

export type SemVer = z.infer<typeof SemVerSchema>

// ---------------------------------------------------------------------------
// AnalysisSkillMeta —— 列表接口单条契约
// ---------------------------------------------------------------------------

/**
 * Agent 端 `/api/analysis-skills` 与 Web 端 `AnalyzingData.availableSkills`
 * 共用的列表项。
 *
 * 字段最小集(issue 01 acceptance 4):
 * - `name`:Skill 唯一名称(与目录名一致,已被平台层校验)
 * - `description`:非空功能简介(进 On-arming system prompt 的 1 句描述)
 * - `version`:语义版本,字符串字面形式
 * - `is_reserved`:是否为平台保留名称(决定 UI 是否有"系统"徽章 + 升级覆盖行为)
 */
export const AnalysisSkillMetaSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: SemVerSchema,
  is_reserved: z.boolean(),
})
export type AnalysisSkillMeta = z.infer<typeof AnalysisSkillMetaSchema>

// ---------------------------------------------------------------------------
// AnalysisSkillListResponse —— `GET /api/analysis-skills` 响应
// ---------------------------------------------------------------------------

/**
 * Agent `GET /api/analysis-skills` 响应 schema。
 *
 * 形态:
 * - `skills` 数组,按 name 字典序排序(展示稳定)
 * - 目录不存在 / 扫描失败 → `{ skills: [] }` 200,与 repos 端点行为一致
 *
 * 平台保留名称由 Agent 端按 `RESERVED_ANALYSIS_SKILL_NAMES` 常量决定,
 * 这里 schema 不知道具体名单,只做类型校验。
 */
export const AnalysisSkillListResponseSchema = z.object({
  skills: z.array(AnalysisSkillMetaSchema),
})
export type AnalysisSkillListResponse = z.infer<typeof AnalysisSkillListResponseSchema>

// ---------------------------------------------------------------------------
// AnalysisSkillSelection —— `GET/PUT /api/requirements/:id/analysis/skill-selection` 契约
// ---------------------------------------------------------------------------

/**
 * Per-Requirement 已选择 Skill 的请求/响应最小形态。
 *
 * - `selected_skill_name`:当前选中的 Skill 名;无 selection / 已记住名
 *   不存在时为空字符串(由调用方根据 available_skills 自行回退)
 * - `available_skills`:与 `AnalysisSkillListResponse.skills` 同形态
 */
export const AnalysisSkillSelectionResponseSchema = z.object({
  selected_skill_name: z.string(),
  available_skills: z.array(AnalysisSkillMetaSchema),
})
export type AnalysisSkillSelectionResponse = z.infer<
  typeof AnalysisSkillSelectionResponseSchema
>

/** PUT 请求 body:`{ skill_name: <name> }` */
export const AnalysisSkillSelectionPutBodySchema = z.object({
  skill_name: z.string().min(1),
})
export type AnalysisSkillSelectionPutBody = z.infer<
  typeof AnalysisSkillSelectionPutBodySchema
>

// ---------------------------------------------------------------------------
// 平台保留名称常量 —— Agent 端在 default skill 初始化 / 升级覆盖 / 列表
// `is_reserved` 标注时使用
// ---------------------------------------------------------------------------

/**
 * 平台保留的 Analysis Skill 名称清单。
 *
 * - 应用启动时,这些名称对应的 `<workspaceRoot>/analysis-skills/<name>/`
 *   必须存在(SKILL.md 由 Agent 用内置默认文本覆盖写入)
 * - 升级时强制用系统版本覆盖同名 Skill(issue 01 acceptance 2)
 * - 其他名称(用户上传的)由 Workspace 保留,不参与覆盖
 *
 * 当前清单(issue 01 锁定):
 * - `prd-completeness`:检查 PRD 的完整性与清晰度
 * - `implementation-readiness`:检查实施准备度(技术风险 / 依赖 / 可行性)
 */
export const RESERVED_ANALYSIS_SKILL_NAMES: readonly string[] = [
  'prd-completeness',
  'implementation-readiness',
] as const

export function isReservedAnalysisSkillName(name: string): boolean {
  return RESERVED_ANALYSIS_SKILL_NAMES.includes(name)
}

// ---------------------------------------------------------------------------
// SKILL.md 极简 frontmatter 解析(共享 helper)
// ---------------------------------------------------------------------------

/**
 * 把一段 `SKILL.md` 文本切成 frontmatter 段 + body 段。
 *
 * 形态 = `---` 包围的 YAML 块 + 后跟 markdown body。容错:
 * - 无 frontmatter 闭合标记 → 返 null(由 caller 决定 skip)
 * - 文件首行无 `---` → 返 null
 *
 * 复用面:Agent `AnalysisSkillService`、Web SSR `loadAnalysisSkillsBundle`、
 * 内置默认 SKILL.md 的解析 —— 全部走同一份 frontmatter split 规则。
 * 与 agent `prompt/SkillLoader.ts` 的 `parseSkillMarkdown` 同形态但更轻量
 * (本文件不引入 `yaml` 依赖,只支持 `key: value` 单行键值对,因为
 * Analysis Skill frontmatter 形态固定)。
 */
export function splitSkillMarkdown(
  text: string,
): { frontmatterText: string; body: string } | null {
  const withoutBom = text.replace(/^﻿/, '')
  const trimmed = withoutBom.replace(/\r\n/g, '\n')
  if (!trimmed.startsWith('---\n') && trimmed !== '---') return null
  const rest = trimmed.slice(4)
  const endIdx = rest.search(/\n---\s*(?:\n|$)/)
  if (endIdx < 0) return null
  const frontmatterText = rest.slice(0, endIdx)
  const body = rest
    .slice(endIdx)
    .replace(/^\n---\s*/, '')
    .replace(/^\n+/, '')
  return { frontmatterText, body }
}

/**
 * 极简 YAML 单行 `key: value` 解析,够 Analysis Skill frontmatter 使用。
 * 不引号包裹 / 注释剥离 / 嵌套对象一律不支持 —— 与
 * `splitSkillMarkdown` 配套。
 */
export function parseMinimalFrontmatter(
  frontmatterText: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of frontmatterText.split('\n')) {
    const cleaned = line.replace(/#.*$/, '').trim()
    if (!cleaned) continue
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (!m) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[m[1]] = value
  }
  return out
}
