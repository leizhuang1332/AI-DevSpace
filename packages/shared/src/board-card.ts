/**
 * 共享 Board Card 契约 —— issue 02 / ADR-0024
 *
 * 本模块提供 TaskCard 配套的:
 * - `generateTaskCardUlid` 与 `TASK_CARD_ID_RE` re-export(由 `task-card.ts` 提供,
 *   这里仅 barrel 出口,避免上层 module 引用双源)
 * - create / patch / list filter 的 Zod schema(给 Fastify route 用)
 * - 错误码常量 + reason → HTTP 状态映射
 *
 * 数据基线:TaskCard 字段集与 Zod schema 见 `task-card.ts`;本文件不重复定义。
 *
 * 命名约定:
 * - "card" 在 URL 路径里出现(`/board/cards/:cardId`),与 schema 类型名
 *   `TaskCard` 解耦 —— web 端叫 "card",schema 类型叫 "TaskCard"。
 * - "board" 在 `board/tasks/<ulid>.json` 路径里出现,代表 board section。
 */

import { z } from 'zod'
import {
  TASK_CARD_ID_RE,
  TaskCardPrioritySchema,
  TaskCardSourceSchema,
  TaskCardStatusSchema,
  type TaskCard,
} from './task-card.js'

// 强制类型:返回值必满足正则(给下游 TS 推断用;运行时由 `generateTaskCardUlid` 自身保证)
export const TaskCardIdSchema = z.string().regex(TASK_CARD_ID_RE)

// ---------------------------------------------------------------------------
// 错误码(reason → { code, status } 单一来源)
// ---------------------------------------------------------------------------

/**
 * Board card 业务错误 reason 字面量。
 *
 * - `invalid-id` / `invalid-body` —— 路由层 400
 * - `requirement-not-found` / `card-not-found` —— 404
 * - `internal` —— 500
 *
 * 单一来源 → `REASON_TO_HTTP_STATUS`,route 层不另写映射。
 */
export type BoardCardFailReason =
  | 'invalid-id'
  | 'invalid-body'
  | 'requirement-not-found'
  | 'card-not-found'
  | 'internal'

export const REASON_TO_HTTP_STATUS_BOARD: Record<
  BoardCardFailReason,
  { code: string; status: number }
> = {
  'invalid-id': { code: 'E_INVALID_CARD_ID', status: 400 },
  'invalid-body': { code: 'E_INVALID_BODY', status: 400 },
  'requirement-not-found': {
    code: 'E_REQUIREMENT_NOT_FOUND',
    status: 404,
  },
  'card-not-found': { code: 'E_CARD_NOT_FOUND', status: 404 },
  'internal': { code: 'E_INTERNAL', status: 500 },
}

// ---------------------------------------------------------------------------
// 列表过滤
// ---------------------------------------------------------------------------

/**
 * GET /api/requirement/:id/board/cards 列表过滤参数。
 *
 * - `status` / `priority` / `source` 各自只允许一个值(与 ticket 02 验收对齐;
 *   多选本期不做,留作 v1.0.7+ 拓展)
 * - `label` 是单字符串前缀包含(`labels` 数组里有任一 === label 即命中)
 * - `include_archived` 默认 false(列表语义为活跃卡,archived 默认隐藏)
 */
export const BoardCardListFilterSchema = z.object({
  status: TaskCardStatusSchema.optional(),
  priority: TaskCardPrioritySchema.optional(),
  source: TaskCardSourceSchema.optional(),
  label: z.string().min(1).max(64).optional(),
  include_archived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
})
export type BoardCardListFilter = z.infer<typeof BoardCardListFilterSchema>

// ---------------------------------------------------------------------------
// 创建 / 改写
// ---------------------------------------------------------------------------

/**
 * POST /api/requirement/:id/board/cards body 形态。
 *
 * manual 创建语义:
 * - `parent_id` 由服务端强制写为 `reqId`(`boardRoutes` 写入前覆盖)
 * - `source` 由服务端透传(默认 `manual`);issue 08 PRD 拆候选落地时
 *   web 端传 `source='prd_split'`,落盘为 PRD 拆卡片(与 manual 区分,
 *   便于 board 过滤 + 审计)。服务端不强制覆盖为 manual —— 信任调用方,
 *   与 issue 05 PrdSplitProposal 注释「web 08 处理 source=prd_split」对齐。
 * - 其余字段允许覆盖
 */
export const BoardCardCreateRequestSchema = z.object({
  title: z.string().trim().min(1, 'title must not be empty'),
  content: z.string().default(''),
  status: TaskCardStatusSchema.optional(),
  priority: TaskCardPrioritySchema.nullable().optional(),
  assignee: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  order_index: z.number().nullable().optional(),
  source: TaskCardSourceSchema.optional(),
})
export type BoardCardCreateRequest = z.infer<typeof BoardCardCreateRequestSchema>

/**
 * PATCH /api/requirement/:id/board/cards/:cardId body 形态。
 *
 * 严格按 ticket 02 验收白名单:
 * - id / parent_id / status / title / content / priority / assignee /
 *   labels / depends_on / order_index / source / is_archived
 * - 不接受 created_at / updated_at / completed_at(由服务端自动维护)
 *
 * 至少需要传一个字段(`refine`);否则 400。
 */
export const BoardCardPatchSchema = z
  .object({
    parent_id: z.string().nullable().optional(),
    status: TaskCardStatusSchema.optional(),
    title: z
      .string()
      .trim()
      .min(1, 'title must not be empty')
      .optional(),
    content: z.string().optional(),
    priority: TaskCardPrioritySchema.nullable().optional(),
    assignee: z.string().nullable().optional(),
    labels: z.array(z.string()).optional(),
    depends_on: z.array(z.string()).optional(),
    order_index: z.number().nullable().optional(),
    source: TaskCardSourceSchema.optional(),
    is_archived: z.boolean().optional(),
  })
  .refine(
    (obj) => Object.keys(obj).length > 0,
    'at least one field must be provided',
  )
export type BoardCardPatch = z.infer<typeof BoardCardPatchSchema>

// ---------------------------------------------------------------------------
// 列表 / 单卡 响应
// ---------------------------------------------------------------------------

/** GET /board/cards 200 响应体 */
export const BoardCardListResponseSchema = z.object({
  requirementId: z.string().min(1),
  cards: z.array(z.custom<TaskCard>()),
  total: z.number().int().nonnegative(),
})
export type BoardCardListResponse = z.infer<typeof BoardCardListResponseSchema>

/** GET /board/cards/:cardId 200 响应体 */
export const BoardCardDetailResponseSchema = z.object({
  card: z.custom<TaskCard>(),
})
export type BoardCardDetailResponse = z.infer<typeof BoardCardDetailResponseSchema>

/** POST /board/cards 201 响应体 */
export const BoardCardCreateResponseSchema = z.object({
  card: z.custom<TaskCard>(),
})
export type BoardCardCreateResponse = z.infer<typeof BoardCardCreateResponseSchema>
