/**
 * TaskCard transcript 共享契约 — issue 04 / ADR-0028
 *
 * TaskCard 详情页右抽屉(toggle 展开态)所看到的 AI 协作对话流。
 *
 * 关键约束(ADR-0028):
 * - 物理独立于父 analyzing transcript(`board/tasks/<ulid>/transcript.yaml`)
 * - 仅描述 / 不挂 Run —— assistant 消息永远 `tool_calls: []`
 * - 派生父 analyzing transcript 末尾 K=10 条作为初始上下文快照,
 *   用 `schema_version + snapshot_hash` 标识稳定性,
 *   后续 schema 升级时可识别老文件
 *
 * 与 TaskCard 主 JSON(`<ulid>.json`)的关系:主 JSON 是字段型契约,
 * transcript 是流式对话契约,二者物理独立 + 互不引用字段。
 */

import { z } from 'zod'
import { TASK_CARD_ID_RE } from './task-card.js'

// ---------------------------------------------------------------------------
// 引用形态(ADR-0028 D6 messages[].refs)
// ---------------------------------------------------------------------------

/** TaskCard transcript 消息可携带的引用种类。 */
export const TranscriptRefKind = {
  /** 引用父 PRD(`requirement.md`)段落 */
  PRD_SECTION: 'prd_section',
  /** 引用父 analyzing Run(`analysis/runs/<run-id>`) */
  RUN_ID: 'run_id',
  /** 引用 Requirement 内 asset(`assets/<name>`) */
  ASSET: 'asset',
} as const

export type TranscriptRefKindT =
  (typeof TranscriptRefKind)[keyof typeof TranscriptRefKind]

/** `prd_section` —— 引用父 PRD 某段;`line_range` = [start, end) 0-based 半开区间
 *
 * `end >= start` 是 schema 层硬约束(防御非法 / 倒序值),
 * 解析层 `parsePrdRefToken` 也校验一致 —— 两层守门。
 */
const PrdSectionRefSchema = z.object({
  kind: z.literal('prd_section'),
  path: z.string().min(1),
  line_range: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .refine(([start, end]) => end >= start, {
      message: 'line_range end must be >= start',
    })
    .optional(),
})

/** `run_id` —— 引用父 analyzing Run 产物(只读 link) */
const RunIdRefSchema = z.object({
  kind: z.literal('run_id'),
  run_id: z.string().min(1),
})

/** `asset` —— 引用 Requirement 内上传素材 */
const AssetRefSchema = z.object({
  kind: z.literal('asset'),
  name: z.string().min(1),
})

export const TranscriptRefSchema = z.discriminatedUnion('kind', [
  PrdSectionRefSchema,
  RunIdRefSchema,
  AssetRefSchema,
])
export type TranscriptRef = z.infer<typeof TranscriptRefSchema>

// ---------------------------------------------------------------------------
// 单条消息
// ---------------------------------------------------------------------------

/** 角色枚举 —— TaskCard transcript 只支持 user 与 assistant,不发 Run 故无 tool 角色 */
export const TranscriptRole = {
  USER: 'user',
  ASSISTANT: 'assistant',
} as const

export type TranscriptRoleT = (typeof TranscriptRole)[keyof typeof TranscriptRole]

export const TranscriptRoleSchema = z.enum(
  Object.values(TranscriptRole) as [TranscriptRoleT, ...TranscriptRoleT[]],
)

const IsoDateTimeSchema = z.string().datetime({ offset: true })

/**
 * 单条 transcript 消息。
 *
 * 守门:assistant 消息的 `tool_calls` 永远 `[]`(ADR-0028 D2:TaskCard
 * transcript 仅描述,不挂 Run;即使 schema 允许任意 array,服务层
 * 写入时强制覆盖为空)。
 */
export const TranscriptMessageSchema = z.object({
  /** 消息时间戳(ISO 8601) */
  ts: IsoDateTimeSchema,
  /** 角色 —— user / assistant */
  role: TranscriptRoleSchema,
  /** 消息正文(Markdown 文本;不含危险 HTML —— 与 TaskCard content 共用 UNSAFE_MARKDOWN_RE 思路,渲染层兜底) */
  content: z.string(),
  /** 消息携带的引用(可空) */
  refs: z.array(TranscriptRefSchema).default([]),
  /** 工具调用 —— TaskCard transcript 永远 `[]` */
  tool_calls: z.array(z.unknown()).default([]),
})
export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>

// ---------------------------------------------------------------------------
// 父 transcript 快照(ADR-0028 D6 parent_transcript_snapshot)
// ---------------------------------------------------------------------------

/**
 * 父 analyzing transcript 的派生快照。
 *
 * - `snapshot_at` —— 派生时刻(ISO 8601)
 * - `messages_count` —— 父 transcript 实际被纳入快照的消息条数(可能 < K)
 * - `snapshot_hash` —— sha256(规范化后父 messages 序列化);检测父 transcript 后续变化
 *
 * 父 transcript 不存在 / 为空 → `messages_count=0`,`snapshot_hash=sha256:` 空串哈希。
 */
export const ParentTranscriptSnapshotSchema = z.object({
  snapshot_at: IsoDateTimeSchema,
  messages_count: z.number().int().min(0),
  snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/, 'snapshot_hash must be sha256:<64hex>'),
})
export type ParentTranscriptSnapshot = z.infer<typeof ParentTranscriptSnapshotSchema>

// ---------------------------------------------------------------------------
// 顶层 schema
// ---------------------------------------------------------------------------

export const TASK_CARD_TRANSCRIPT_SCHEMA_VERSION = 1 as const

/**
 * TaskCard transcript 文件形态。
 *
 * 物理路径:`~/.aidevspace/requirements/<req-id>/board/tasks/<ulid>/transcript.yaml`
 */
export const TaskCardTranscriptSchema = z.object({
  /** schema 版本号(便于未来升级) */
  schema_version: z.literal(TASK_CARD_TRANSCRIPT_SCHEMA_VERSION),
  /** 反向引用 TaskCard 主 JSON 的 ULID */
  task_card_id: z.string().regex(TASK_CARD_ID_RE, 'task_card_id must be a 26-character ULID'),
  /** 父 analyzing transcript 派生快照 */
  parent_transcript_snapshot: ParentTranscriptSnapshotSchema,
  /** 消息流(按 ts 升序) */
  messages: z.array(TranscriptMessageSchema).default([]),
})
export type TaskCardTranscript = z.infer<typeof TaskCardTranscriptSchema>

// ---------------------------------------------------------------------------
// HTTP 路由契约(issue 08 / ADR-0028 D5)— agent 端 board-transcript route 用
// ---------------------------------------------------------------------------

/**
 * POST `/api/requirement/:id/board/cards/:cardId/transcript/messages` body。
 *
 * 守门(ADR-0028 D2):
 * - **不含 `role` 字段** —— 路由层强制 `role='user'`,caller 传 role 也会被忽略。
 *   TaskCard transcript 仅描述 / 不挂 Run;assistant 消息只能由 Run 路径写入,
 *   而本路由是 web 详情页用户输入入口,永远是 user 消息。
 * - `content` 必填非空(空消息无意义)
 * - `refs` 可选(`#[id]` 引用解析产物,如 prd_section / run_id / asset)
 */
export const TranscriptMessageCreateBodySchema = z.object({
  content: z.string().trim().min(1, 'content must not be empty'),
  refs: z.array(TranscriptRefSchema).optional().default([]),
})
export type TranscriptMessageCreateBody = z.infer<
  typeof TranscriptMessageCreateBodySchema
>

/**
 * GET `/api/requirement/:id/board/cards/:cardId/transcript` 响应。
 *
 * transcript 文件不存在 → `transcript: null`(UI 走空态,不阻塞渲染)。
 * 文件存在但解析失败 → 同样 null(给前端脏数据不如给空态)。
 */
export const TaskCardTranscriptResponseSchema = z.object({
  transcript: TaskCardTranscriptSchema.nullable(),
})
export type TaskCardTranscriptResponse = z.infer<
  typeof TaskCardTranscriptResponseSchema
>

/** POST .../transcript/messages 200 响应 —— 追加后的完整 transcript */
export const TranscriptMessageCreateResponseSchema = z.object({
  transcript: TaskCardTranscriptSchema,
})
export type TranscriptMessageCreateResponse = z.infer<
  typeof TranscriptMessageCreateResponseSchema
>