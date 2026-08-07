/**
 * PRD 拆解 Run 共享契约 — issue 05 / ADR-0027 D4
 *
 * PRD → 候选 TaskCard 拆解 Run 的产物形态。Run 跑在父 analyzing transcript
 * 内(ADR-0027 D4),产物落 `<root>/requirements/<req-id>/analysis/proposals/<run-id>/`
 * (决策 2「目录即真相」,与 `analysis/runs/<run-id>/` 平级)。
 *
 * 关键约束:
 * - `suggested_status` 固定 `'backlog'`(spec 验收:用户在 board 确认载入时再推进)
 * - `propose_card` 业务工具单卡单调(镜像 `report_analysis_issue`),partial-progress
 *   友好 + 单 call 幂等(用 `tool_use_id` 去重)
 * - 不挂 `complete_analysis` 门禁 —— 生成式 Run,模型发完所有卡正常 end turn
 *   即完成(SDK `result subtype=success` 即完成信号)
 *
 * 物理路径:
 *   <root>/requirements/<req-id>/analysis/proposals/<run-id>/
 *     ├── meta.yaml     Run 状态(running / succeeded / failed)
 *     └── cards.yaml    候选卡片数组(artifact)
 *
 * 与 TaskCard 主 JSON(`board/tasks/<ulid>.json`)的关系:cards.yaml 是 AI
 * 候选草稿,落盘为 TaskCard 留 web 08 处理(source='prd_split')。
 */

import { z } from 'zod'
import { TaskCardPrioritySchema } from './task-card.js'

// ---------------------------------------------------------------------------
// schema 版本
// ---------------------------------------------------------------------------

export const PRD_SPLIT_CARDS_SCHEMA_VERSION = 1 as const

// ---------------------------------------------------------------------------
// 拆分粒度
// ---------------------------------------------------------------------------

/**
 * 拆分粒度 —— 与 modal payload 字面一致(中文 literal)。
 *
 * `粗` = 粗卡片(每张覆盖大模块);`中` = 中粒度;`细` = 细粒度(每张覆盖单功能点)。
 */
export const PRD_SPLIT_GRANULARITY = {
  COARSE: '粗',
  MEDIUM: '中',
  FINE: '细',
} as const

export type PrdSplitGranularityT =
  (typeof PRD_SPLIT_GRANULARITY)[keyof typeof PRD_SPLIT_GRANULARITY]

export const PrdSplitGranularitySchema = z.enum(
  Object.values(PRD_SPLIT_GRANULARITY) as [
    PrdSplitGranularityT,
    ...PrdSplitGranularityT[],
  ],
)

// ---------------------------------------------------------------------------
// 单条候选卡片(proposal)
// ---------------------------------------------------------------------------

/**
 * 单条候选卡片 —— 模型通过 `propose_card` 业务工具逐条提交。
 *
 * 设计要点:
 * - `ordinal` / `tool_use_id` 由 handler 派生(1-based ordinal + wrapper 透传
 *   的 tool_use_id 作幂等键),模型不传
 * - `suggested_status` 固定 `'backlog'`(spec)—— 不在工具入参,handler 写死,
 *   避免模型瞎填状态
 * - `content` 是 Markdown 草稿;完整 XSS 防御在 web 08 落盘为 TaskCard 时执行
 *   (`TaskCardContentSchema` 的 `UNSAFE_MARKDOWN_RE`),proposal 层只做最浅校验
 */
export const PrdSplitProposalSchema = z.object({
  /** handler 派发的顺序号(1-based,镜像 AnalysisIssue.ordinal) */
  ordinal: z.number().int().min(1),
  /** wrapper 透传的 tool_use_id(mcp-propose_card-<n>),幂等去重键 */
  tool_use_id: z.string().min(1),
  title: z.string().trim().min(1, 'title must not be empty'),
  content: z.string().default(''),
  /** 固定 backlog(spec 验收) */
  suggested_status: z.literal('backlog'),
  suggested_priority: TaskCardPrioritySchema.nullable().default(null),
  labels: z.array(z.string()).default([]),
})
export type PrdSplitProposal = z.infer<typeof PrdSplitProposalSchema>

/**
 * `propose_card` 工具入参形态(模型传)。
 *
 * 与 `PrdSplitProposalSchema` 的差异:
 * - 无 `ordinal` / `tool_use_id`(handler 派生)
 * - 无 `suggested_status`(handler 写死 backlog)
 * - `suggested_priority` 缺省 `medium`(模型不传时给中位优先级)
 *
 * wrapper(`ClaudeCodeProvider.ts:518`)对非 `report_analysis_issue` 工具走
 * `z.object({}).passthrough()`,不在 SDK 侧过滤 args —— handler 负责严格校验。
 */
export const ProposeCardToolInputSchema = z.object({
  title: z.string().trim().min(1, 'title must not be empty'),
  content: z.string().default(''),
  suggested_priority: TaskCardPrioritySchema.nullable().optional(),
  labels: z.array(z.string()).optional(),
})
export type ProposeCardToolInput = z.infer<typeof ProposeCardToolInputSchema>

// ---------------------------------------------------------------------------
// Run 元数据(meta.yaml)
// ---------------------------------------------------------------------------

const IsoDateTimeSchema = z.string().datetime({ offset: true })

/**
 * PRD 拆解 Run 元数据 —— `<run-id>/meta.yaml` 形态。
 *
 * 状态机:`running` → (`succeeded` | `failed`);删除是物理级联,无 `deleted`。
 * 镜像 `AnalysisRunMeta`(简化:无 skill_name / issue_count,改 granularity /
 * expected_count / actual_count)。
 */
export const PrdSplitRunMetaSchema = z.object({
  schema_version: z.literal(PRD_SPLIT_CARDS_SCHEMA_VERSION),
  run_id: z.string().min(1),
  requirement_id: z.string().min(1),
  status: z.enum(['running', 'succeeded', 'failed']),
  created_at: IsoDateTimeSchema,
  finished_at: IsoDateTimeSchema.nullable().default(null),
  error: z.string().nullable().default(null),
  granularity: PrdSplitGranularitySchema,
  expected_count: z.number().int().min(1),
  actual_count: z.number().int().min(0).default(0),
})
export type PrdSplitRunMeta = z.infer<typeof PrdSplitRunMetaSchema>

// ---------------------------------------------------------------------------
// cards.yaml artifact
// ---------------------------------------------------------------------------

/**
 * `cards.yaml` 形态 —— Run 的候选卡片数组 artifact。
 *
 * `candidates` 由 `propose_card` 调用累积(handler 写入);Run 终态时
 * `actual_count` = candidates.length(写进 meta.yaml)。
 */
export const PrdSplitCardsFileSchema = z.object({
  schema_version: z.literal(PRD_SPLIT_CARDS_SCHEMA_VERSION),
  run_id: z.string().min(1),
  requirement_id: z.string().min(1),
  created_at: IsoDateTimeSchema,
  granularity: PrdSplitGranularitySchema,
  expected_count: z.number().int().min(1),
  candidates: z.array(PrdSplitProposalSchema).default([]),
})
export type PrdSplitCardsFile = z.infer<typeof PrdSplitCardsFileSchema>

// ---------------------------------------------------------------------------
// 路由请求 / 响应
// ---------------------------------------------------------------------------

/**
 * POST `/api/requirement/:id/board/split-from-prd` body。
 *
 * - `granularity` —— 拆分粒度(粗 / 中 / 细)
 * - `expected_count` —— 期望卡片数(1-50,防模型无限生成)
 * - `use_context` —— 上下文勾选(本期透传到 prompt,不解读语义)
 */
export const PrdSplitStartBodySchema = z.object({
  granularity: PrdSplitGranularitySchema,
  expected_count: z.number().int().min(1).max(50),
  use_context: z.array(z.string()).default([]),
})
export type PrdSplitStartBody = z.infer<typeof PrdSplitStartBodySchema>

/** POST /split-from-prd 201 响应(fire-and-forget:立返 run_id + running) */
export const PrdSplitStartResponseSchema = z.object({
  run_id: z.string().min(1),
  requirement_id: z.string().min(1),
  status: z.literal('running'),
  created_at: IsoDateTimeSchema,
})
export type PrdSplitStartResponse = z.infer<typeof PrdSplitStartResponseSchema>

/** GET /runs/:runId 200 响应(Run meta + 候选卡片数组) */
export const PrdSplitRunDetailResponseSchema = z.object({
  run: PrdSplitRunMetaSchema,
  cards: z.array(PrdSplitProposalSchema),
})
export type PrdSplitRunDetailResponse = z.infer<
  typeof PrdSplitRunDetailResponseSchema
>

/** GET /runs 200 响应(Run 列表,按 created_at 倒序) */
export const PrdSplitRunListResponseSchema = z.object({
  runs: z.array(PrdSplitRunMetaSchema),
})
export type PrdSplitRunListResponse = z.infer<typeof PrdSplitRunListResponseSchema>
