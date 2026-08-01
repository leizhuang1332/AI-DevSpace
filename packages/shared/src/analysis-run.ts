/**
 * Analysis Run 契约(issue 02 · ADR-0021)
 *
 * 一个 Analysis Run = 用户一次"开始分析"点击产生的独立识别任务。
 * 每个 Run 只记录所选 Analysis Skill 名称 + 状态 + Issue / Log / Response;
 * 不保存 Skill 版本 / 哈希 / 正文 / prompt 快照(每次启动按名称读取当前最新内容)。
 *
 * 持久化路径:`<workspaceRoot>/requirements/<req-id>/analysis/runs/<run-id>/`
 *   ├── meta.yaml         Run 元数据(状态 / Skill 名 / 时间 / issue_count)
 *   ├── issues.jsonl      Issue 追加日志(每行一条,顺序由平台决定)
 *   ├── log.jsonl         Run Log(模型普通文本 / 工具输入输出 / 工具活动)
 *   └── responses/<issue-id>.md   单 Issue Response Markdown
 *
 * 状态机:`running` → (`succeeded` | `failed`);删除是物理级联,无 `deleted` 状态。
 */

import { z } from 'zod'
import { AnalysisSkillMetaSchema } from './analysis-skill.js'

// ---------------------------------------------------------------------------
// Run 状态 / Issue / Run Log 形态
// ---------------------------------------------------------------------------

/** Run 生命周期状态(decision 2) */
export const AnalysisRunStatusSchema = z.enum(['running', 'succeeded', 'failed'])
export type AnalysisRunStatus = z.infer<typeof AnalysisRunStatusSchema>

/** Run 元数据 —— SSR / REST / SSE 共享 */
export const AnalysisRunMetaSchema = z.object({
  /** Run 唯一 id(平台生成:`run-<base36 timestamp>-<random>`) */
  run_id: z.string().min(1),
  requirement_id: z.string().min(1),
  /** 所选 Analysis Skill 名称(Run 不保存 Skill 版本/正文,只记名) */
  skill_name: z.string().min(1),
  /** 当前状态 */
  status: AnalysisRunStatusSchema,
  /** 创建时间(ISO 8601) */
  created_at: z.string().min(1),
  /** 终态时间(ISO 8601;running 时为 null) */
  finished_at: z.string().nullable(),
  /** 已成功持久化的 Issue 数 */
  issue_count: z.number().int().min(0),
  /** 终态错误原因(failed 时为字符串;succeeded / running 时为 null) */
  error: z.string().nullable(),
})
export type AnalysisRunMeta = z.infer<typeof AnalysisRunMetaSchema>

/** SourceRef 形态(ADR-0021 决策 26)
 *
 * - Requirement 来源:`{ kind: 'requirement', relative_path, line_range? }`
 * - Repository 来源:`{ kind: 'repository', repo_name, relative_path, line_range? }`
 * - AuxFile 来源:`{ kind: 'aux', aux_id, line_range? }`
 * - Asset 来源:`{ kind: 'asset', asset_id }`
 *
 * `line_range` = `[start, end)` 0-based 半开区间(决策 26)。缺失类问题可省略。
 */
export const SourceRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('requirement'),
    relative_path: z.string().min(1),
    line_range: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  }),
  z.object({
    kind: z.literal('repository'),
    repo_name: z.string().min(1),
    relative_path: z.string().min(1),
    line_range: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  }),
  z.object({
    kind: z.literal('aux'),
    aux_id: z.string().min(1),
    line_range: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  }),
  z.object({
    kind: z.literal('asset'),
    asset_id: z.string().min(1),
  }),
])
export type SourceRef = z.infer<typeof SourceRefSchema>

/** Issue metadata(决策 25 / ADR-0021) —— Skill 表达的严重度 / 分类 / 置信度等。
 *
 * - 字符串键
 * - 值为 JSON 基础值(string / number / boolean / null)或基础值数组
 * - 不接受任意嵌套对象(避免 Skill 借此逃避 contract) */
export const IssueMetadataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])
export const IssueMetadataEntrySchema = z.tuple([
  z.string().min(1),
  z.union([
    IssueMetadataValueSchema,
    z.array(IssueMetadataValueSchema),
  ]),
])
export const IssueMetadataSchema = z.array(IssueMetadataEntrySchema)
export type IssueMetadata = z.infer<typeof IssueMetadataSchema>

/** Analysis Issue(决策 25) —— Run 内一条识别问题 */
export const AnalysisIssueSchema = z.object({
  /** Issue 唯一 id(平台生成,顺序递增) */
  issue_id: z.string().min(1),
  /** Run 归属 */
  run_id: z.string().min(1),
  /** 顺序(从 1 开始,平台决定) */
  ordinal: z.number().int().min(1),
  /** Issue 标题 —— 非空 */
  title: z.string().min(1),
  /** Issue 描述 —— 非空 */
  description: z.string().min(1),
  /** 来源引用 —— 至少一个 */
  source_refs: z.array(SourceRefSchema).min(1),
  /** Skill 表达的非通用信息 */
  metadata: IssueMetadataSchema,
  /** 报告时间(ISO 8601) */
  reported_at: z.string().min(1),
})
export type AnalysisIssue = z.infer<typeof AnalysisIssueSchema>

/** Run Log 单条 —— SDK 可获得的普通文本 / 工具活动 / 工具输入输出。
 *
 * - `text` —— 模型普通文本(可流式)
 * - `tool_use` —— 工具调用(名称 + 输入)
 * - `tool_result` —— 工具结果(名称 + 输出,已脱敏)
 *
 * 不持久化 system prompt / 模型原始思维链(决策 37)。
 */
export const AnalysisLogEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    /** 时间戳(ISO 8601) */
    ts: z.string().min(1),
    /** 文本(已脱敏) */
    text: z.string(),
  }),
  z.object({
    kind: z.literal('tool_use'),
    ts: z.string().min(1),
    /** SDK tool_use.id —— Issue / Complete 等业务工具的幂等键 */
    tool_use_id: z.string().min(1),
    name: z.string().min(1),
    /** 工具输入(已脱敏) */
    input: z.unknown(),
  }),
  z.object({
    kind: z.literal('tool_result'),
    ts: z.string().min(1),
    tool_use_id: z.string().min(1),
    name: z.string().min(1),
    /** 工具结果(已脱敏) */
    output: z.unknown(),
  }),
])
export type AnalysisLogEntry = z.infer<typeof AnalysisLogEntrySchema>

// ---------------------------------------------------------------------------
// 启动契约(决策 9):`POST /api/requirements/:id/analysis/start`
// ---------------------------------------------------------------------------

export const AnalysisRunStartBodySchema = z.object({
  /** 所选 Analysis Skill 名称(必填) */
  skill_name: z.string().min(1),
})
export type AnalysisRunStartBody = z.infer<typeof AnalysisRunStartBodySchema>

export const AnalysisRunStartResponseSchema = z.object({
  /** Run 标识 */
  run_id: z.string().min(1),
  /** Run 归属 Requirement */
  requirement_id: z.string().min(1),
  /** 所选 Analysis Skill 名称 */
  skill_name: z.string().min(1),
  /** 创建时间(ISO 8601) */
  created_at: z.string().min(1),
  /** 启动状态(始终为 'running') */
  status: z.literal('running'),
})
export type AnalysisRunStartResponse = z.infer<
  typeof AnalysisRunStartResponseSchema
>

// ---------------------------------------------------------------------------
// 列表契约:`GET /api/requirements/:id/analysis/runs`
// ---------------------------------------------------------------------------

export const AnalysisRunListResponseSchema = z.object({
  /** 按 created_at 倒序(最新在前;SSR 沿用同一排序) */
  runs: z.array(AnalysisRunMetaSchema),
})
export type AnalysisRunListResponse = z.infer<
  typeof AnalysisRunListResponseSchema
>

// ---------------------------------------------------------------------------
// 详情契约:`GET /api/requirements/:id/analysis/runs/:runId`
// ---------------------------------------------------------------------------

export const AnalysisRunDetailResponseSchema = z.object({
  run: AnalysisRunMetaSchema,
  issues: z.array(AnalysisIssueSchema),
  log: z.array(AnalysisLogEntrySchema),
})
export type AnalysisRunDetailResponse = z.infer<
  typeof AnalysisRunDetailResponseSchema
>

// ---------------------------------------------------------------------------
// SSR bundle:`GET /api/requirements/:id/analysis` 增字段
// ---------------------------------------------------------------------------

/** 单 Run 详细列表(SSR / REST 共享) */
export interface AnalysisRunBundle {
  /** 按 created_at 倒序的 Run 列表 */
  runs: AnalysisRunMeta[]
  /** 当前 Requirement 是否有正在运行的 Run(单运行约束 UI 提示) */
  hasRunningRun: boolean
}

// re-export Skill meta 便于上层单独 import analysis-run 类型时拿到全部契约
export { AnalysisSkillMetaSchema }