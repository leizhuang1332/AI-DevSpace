/**
 * 共享 TaskCard 契约 — issue 01 / ADR-0024
 *
 * TaskCard 是 board section 中可独立推进的工作项，与 EXECUTING-zone 的
 * `plan/tasks.md` Task 概念并存且不互通。该模块提供 web / agent 共用的
 * 字段类型、枚举和 Zod 校验。
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// ULID
// ---------------------------------------------------------------------------

/** Crockford Base32 ULID（26 位；排除 I、L、O、U 以避免视觉歧义）。 */
export const TASK_CARD_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

const TaskCardIdSchema = z
  .string()
  .regex(TASK_CARD_ID_RE, 'id must be a 26-character ULID')

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** TaskCard 看板的 5 个状态。 */
export const TaskCardStatus = {
  BACKLOG: 'backlog',
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  DONE: 'done',
} as const

export type TaskCardStatusT = (typeof TaskCardStatus)[keyof typeof TaskCardStatus]

export const TaskCardStatusSchema = z.enum(
  Object.values(TaskCardStatus) as [TaskCardStatusT, ...TaskCardStatusT[]],
)

/** TaskCard 的创建来源。 */
export const TaskCardSource = {
  PRD_SPLIT: 'prd_split',
  SUB_SPLIT: 'sub_split',
  MANUAL: 'manual',
} as const

export type TaskCardSourceT = (typeof TaskCardSource)[keyof typeof TaskCardSource]

export const TaskCardSourceSchema = z.enum(
  Object.values(TaskCardSource) as [TaskCardSourceT, ...TaskCardSourceT[]],
)

/** TaskCard 的优先级。 */
export const TaskCardPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
} as const

export type TaskCardPriorityT = (typeof TaskCardPriority)[keyof typeof TaskCardPriority]

export const TaskCardPrioritySchema = z.enum(
  Object.values(TaskCardPriority) as [TaskCardPriorityT, ...TaskCardPriorityT[]],
)

// ---------------------------------------------------------------------------
// 字段校验
// ---------------------------------------------------------------------------

const IsoDateTimeSchema = z.string().datetime({ offset: true })

/**
 * Markdown 中不允许执行脚本或事件处理器。
 *
 * TaskCard content 会直接进入 web 端详情渲染，因此在共享 schema 层拒绝
 * 常见的危险 HTML、事件属性和脚本协议；普通 Markdown / HTML 文本仍可使用。
 *
 * 注意：这是 **粗筛**层。完整 XSS 防御仍依赖渲染层 escape（react-markdown /
 * DOMPurify 等）；schema 端 regex 已知漏掉 SVG 嵌套、` javascript:` 前导空白
 * 等攻击面，只是把最常见 payload 在写盘前挡掉。
 */
const UNSAFE_MARKDOWN_RE =
  /<\s*\/?\s*(?:script|iframe|object|embed|style|form)\b[^>]*>|(?:javascript|vbscript|data)\s*:|on[a-z]+\s*=/i

const TaskCardContentSchema = z
  .string()
  .refine((content) => !UNSAFE_MARKDOWN_RE.test(content), {
    message: 'content contains unsafe script or HTML',
  })
  .default('')

// ---------------------------------------------------------------------------
// TaskCard schema
// ---------------------------------------------------------------------------

export const TaskCardSchema = z.object({
  /** ULID；父 Requirement 或 TaskCard 的引用由服务层校验。 */
  id: TaskCardIdSchema,
  parent_id: z.string().nullable().default(null),
  status: TaskCardStatusSchema.default(TaskCardStatus.BACKLOG),
  title: z.string().trim().min(1, 'title must not be empty'),
  content: TaskCardContentSchema,
  priority: TaskCardPrioritySchema.nullable().default(null),
  assignee: z.string().nullable().default(null),
  labels: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  order_index: z.number().nullable().default(null),
  source: TaskCardSourceSchema.default(TaskCardSource.MANUAL),
  is_archived: z.boolean().default(false),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  completed_at: IsoDateTimeSchema.nullable().default(null),
})

export type TaskCard = z.infer<typeof TaskCardSchema>
