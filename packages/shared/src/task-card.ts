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

/**
 * Crockford Base32 字母表(无 I / L / O / U)。与 `TASK_CARD_ID_RE` 对齐。
 *
 * 暴露给测试用(`__test_ulidInternals.CROCKFORD_ALPHABET`),生产代码请走
 * `generateTaskCardUlid` 入口,不要直接拼字符串。
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' as const

/**
 * 生成一个 26 字符的 Crockford Base32 ULID(10 字符时间戳 + 16 字符随机段)。
 *
 * 设计要点:
 * - 时间戳部分截到 48 bit(`now & 0xffffffffffff`),保证到 10889 年不溢出
 * - 随机段用 `crypto.getRandomValues` 拿 10 字节(80 bit),Node 19+ 全局可用,
 *   vitest jsdom 也提供;失败 fallback `Math.random`(不推荐用于安全场景)
 * - 不依赖外部 `ulid` / `ulidx` 库,避免给 shared / agent / web 增依赖
 *
 * 用途:
 * - `TaskCardStore.create()` 默认 `ulidFactory`
 * - 测试可注入 `now` + `randomBytes`(确定性)
 *
 * 返回值永远匹配 `TASK_CARD_ID_RE`。
 */
export function generateTaskCardUlid(
  now: number = Date.now(),
  randomBytes?: Uint8Array,
): string {
  // 1) 10 字符时间戳:48-bit 毫秒数 → 10 个 5-bit 字符
  let ts = now & 0xffffffffffff
  const timeChars: string[] = new Array(10)
  for (let i = 9; i >= 0; i--) {
    timeChars[i] = CROCKFORD_ALPHABET[ts & 0x1f]!
    ts = Math.floor(ts / 32)
  }
  const timePart = timeChars.join('')

  // 2) 16 字符随机段:80 bit → 16 个 5-bit 字符(BigInt 防 32-bit 截断)
  const rand = randomBytes ?? defaultRandomBytes()
  const randChars: string[] = new Array(16)
  let bits = 0n
  for (let i = 0; i < rand.length; i++) {
    bits = (bits << 8n) | BigInt(rand[i]!)
  }
  for (let i = 15; i >= 0; i--) {
    const idx = Number(bits & 0x1fn)
    randChars[i] = CROCKFORD_ALPHABET[idx]!
    bits = bits >> 5n
  }
  const randPart = randChars.join('')

  return timePart + randPart
}

function defaultRandomBytes(): Uint8Array {
  const buf = new Uint8Array(10)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf)
  } else {
    // 极罕见 fallback:Math.random 32 bit → 不安全但保证代码不崩
    for (let i = 0; i < buf.length; i++) {
      buf[i] = Math.floor(Math.random() * 256)
    }
  }
  return buf
}

/** 暴露给测试:允许注入时间 + 随机源。 */
export const __test_ulidInternals = {
  CROCKFORD_ALPHABET,
} as const

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
