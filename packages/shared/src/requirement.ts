/**
 * 新建需求契约(.scratch/new-requirement-modal/issues/04-backend-api-file-persist.md)
 *
 * 跨 web/agent 共享:
 * - `CreateRequirementRequestSchema` / `CreateRequirementResponseSchema` —— Zod schema
 * - `slugify()`                            —— ID 派生纯函数(PRD §8.3)
 * - `RequirementErrorCode`                 —— 错误码常量(E_ID_COLLISION / E_DISK_FULL 等)
 * - `REQUIREMENT_TITLE_MIN/MAX`            —— 长度上下界(与前端对齐)
 */

import { z } from 'zod'
import { ParsedUploadImageSchema } from './requirement-upload.js'

// ---------------------------------------------------------------------------
// 常量:title 长度边界(前后端共用,与 PRD §8.1 对齐)
// ---------------------------------------------------------------------------

export const REQUIREMENT_TITLE_MIN = 1
export const REQUIREMENT_TITLE_MAX = 50

/**
 * NNN 自增 ID 编号宽度(3 位 = 000..999;超过 999 会扩展到 4 位)。
 * 也用于 `slug` 截断长度(PRD §8.3)。
 */
export const REQUIREMENT_SLUG_MAX = 50
export const SLUG_FALLBACK = 'untitled'

// ---------------------------------------------------------------------------
// slug 生成(PRD §8.3 锁定的规则)
// ---------------------------------------------------------------------------

/**
 * 路径非法字符(与 `validateBranchName` 的 BRANCH_FORBIDDEN_RE 区别:这里
 * **不**包含空白 —— 空白走 step1 → `-` 转换,而不是直接删除)。
 */
const SLUG_PATH_FORBIDDEN_RE = /[\\\/:*?"<>|]/g

/**
 * 仅保留字母 / 数字 / `-` / `_` / `.`。Unicode 字母/数字通过 \p{L} / \p{N}
 * 支持(`退款功能优化` 中的中文会保留)。
 */
const SLUG_NON_ALLOWED_RE = /[^\p{L}\p{N}\-_.]/gu

/**
 * 把 title 转成 kebab-case slug。规则:
 * 1. 全小写
 * 2. 空白(含全角空格)→ `-`
 * 3. 路径非法字符 → 删除
 * 4. 非字母/数字/-_. → 删除
 * 5. 多个 `-` 合并
 * 6. 去首尾 `-`
 * 7. 截断 50 字
 * 8. 空 fallback → 'untitled'
 */
export function slugify(title: string): string {
  const lowered = title.toLowerCase()
  const noWhitespace = lowered.replace(/[\s　]+/g, '-')
  const noPath = noWhitespace.replace(SLUG_PATH_FORBIDDEN_RE, '')
  const onlyAllowed = noPath.replace(SLUG_NON_ALLOWED_RE, '')
  const merged = onlyAllowed.replace(/-+/g, '-')
  const trimmed = merged.replace(/^-+|-+$/g, '')
  return trimmed.slice(0, REQUIREMENT_SLUG_MAX) || SLUG_FALLBACK
}

/**
 * ID 格式正则:`req-NNN-<slug>`,NNN = 1+ 位数字,slug = kebab-case + Unicode。
 *
 * slug 字符集:ASCII 字母数字 (`a-z0-9`)、Unicode 字母 (`\p{L}`)、
 *             Unicode 数字 (`\p{N}`)、`-` / `_` / `.`。
 *
 * 前后端都用此正则校验返回值,避免下游字符串处理路径里出现非预期字符。
 *
 * 注:Slug **不会以 `-`/`_`/`.` 开头**(由 `slugify()` 去首尾 dash 规则保证),
 * 但正则不强制首字符约束 —— 即使误传,也能被 `parseRequirementSeq/slug` 提取 NNN
 * 部分。这里只做格式校验,不做语义约束。
 */
export const REQUIREMENT_ID_RE =
  /^req-(\d+)-([\p{L}\p{N}a-z0-9][\p{L}\p{N}a-z0-9\-_.]*)$/u

/**
 * 解析 req id 里的数字部分。非法格式返回 null —— 调用方决定 fallback
 * (一般 → E_INTERNAL)。
 */
export function parseRequirementSeq(id: string): number | null {
  const m = id.match(REQUIREMENT_ID_RE)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * 解析 req id 里的 slug 部分(去掉 `req-NNN-` 前缀)。
 * 非法格式返回 null。
 */
export function parseRequirementSlug(id: string): string | null {
  const m = id.match(REQUIREMENT_ID_RE)
  if (!m) return null
  return m[2]
}

// ---------------------------------------------------------------------------
// 错误码(决策 b2 + E6-E9 前端 banner 消费)
// ---------------------------------------------------------------------------

/**
 * 与 ticket 02 的 `RepoAttachErrorCode` 同源风格。
 *
 * - `E_AUTH` / `E_INVALID_TITLE` / `E_INTERNAL` / `E_DISK_FULL` / `E_NETWORK`
 *   路由层(顶层 catch)返回,与 PRD §9 错误码 E1-E9 一一对应。
 * - `E_ID_COLLISION` 是服务端内部异常 —— 3 次自动重试后仍冲突时上报;
 *   前端 banner 视为 E_INTERNAL。
 */
export const RequirementErrorCode = {
  E_AUTH: 'E_AUTH',
  E_INVALID_TITLE: 'E_INVALID_TITLE',
  E_ID_COLLISION: 'E_ID_COLLISION',
  E_DISK_FULL: 'E_DISK_FULL',
  E_NETWORK: 'E_NETWORK',
  E_INTERNAL: 'E_INTERNAL',
} as const

export type RequirementErrorCodeT =
  (typeof RequirementErrorCode)[keyof typeof RequirementErrorCode]

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

/**
 * POST /api/requirements body
 *
 * 长度限制是后端兜底(决策 b2 + ticket 04 验收 #2):
 * - 前端 input maxLength=50 已经在 UI 层拦截;
 * - 后端再用 Zod trim+length 校验一次,过滤直接打 API 的请求。
 *
 * ticket 03 (ADR-0015 D3) —— Dialog 预填:
 * - `prdMarkdown` 可选字段;缺省 / 空 → 服务端走 `buildRequirementMdTemplate(title)`
 *   默认模板(兼容 ticket 04 既有行为)
 * - 用户上传 .md / .txt / .docx 后,前端 `parseForDialog()` 把解析结果 + 图片
 *   一并发过来,服务端在创建时调 `landAssets` + `replaceDataUriWithAssetPath`,
 *   与 DRAFTING "上传新版本" 行为对齐(都生成 `assets/prd-N.<ext>`)
 *
 * 注:不在 schema 上加 prdMarkdown 长度上限 —— 大小闸门由 Fastify bodyLimit +
 * `MAX_UPLOAD_BYTES` (ticket 01) 负责,本 schema 只做字段存在性 / 类型校验,
 * 避免 Zod 字符级 max() 与 ADR 没要求的边界混淆。
 */
export const CreateRequirementRequestSchema = z.object({
  title: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(REQUIREMENT_TITLE_MIN, 'title is empty after trim')
        .max(REQUIREMENT_TITLE_MAX, `title exceeds ${REQUIREMENT_TITLE_MAX} chars`),
    ),
  /** ticket 03 —— 可选 PRD markdown 正文(Dialog 预填路径携带) */
  prdMarkdown: z.string().optional(),
  /**
   * ticket 03 (ADR-0015 D3 / D5) —— Dialog 预填路径下,docx 解出的图片列表
   * (在 `parseForDialog()` 阶段就由前端拿到,等用户点"创建"时随 POST 一并提交)。
   * 服务端在 `createRequirement` 内调 `landAssets` + 替换 markdown data URI,
   * 让 DRAFTING 打开就能看到完整 PRD(含图片),无需用户再走 DRAFTING 上传。
   */
  images: z.array(ParsedUploadImageSchema).optional(),
})
export type CreateRequirementRequest = z.infer<typeof CreateRequirementRequestSchema>

/** POST /api/requirements 201 响应体 */
export const CreateRequirementResponseSchema = z.object({
  id: z.string().regex(REQUIREMENT_ID_RE, 'id must match req-NNN-slug pattern'),
  title: z.string().min(1),
  createdAt: z.string(),
})
export type CreateRequirementResponse = z.infer<typeof CreateRequirementResponseSchema>

// ---------------------------------------------------------------------------
// meta.yaml / requirement.md 模板(决策 2 + PRD §8.2)
// ---------------------------------------------------------------------------

/**
 * `~/.aidevspace/requirements/<id>/meta.yaml` 顶层结构(写盘 + 解析共用)。
 *
 * 字段冻结规则(决策 15-v2 / ADR-0014):
 * - 不写 `status`(派生机制 — ADR-0014 D4);status 由文件系统产物目录派生
 * - 不写 `current_focus`(由用户后续在工位设置)
 *
 * 注:状态机启用(ADR-0014 D1)用于 UI 信号(分组色 / 进度条 / 过滤),
 * 但 AI 仍不推动流程(决策 15 后半段保留 / ADR-0014 D5)。
 */
export interface RequirementMeta {
  id: string
  title: string
  createdAt: string
}

/**
 * `requirement.md` 空模板:
 *   ```
 *   # <title>
 *
 *   <!-- 在 DRAFTING 工位编写需求背景、目标、AC -->
 *   ```
 *
 * 注意:这里 `<!-- ... -->` 是 HTML 注释风格,Markdown 也支持渲染为隐藏注释。
 * 调用方可以直接覆盖(下一行接 DRAFTING 编辑产物)。
 */
export function buildRequirementMdTemplate(title: string): string {
  const safe = title.trim() || '未命名需求'
  return [
    `# ${safe}`,
    '',
    '<!-- 在 DRAFTING 工位编写需求背景、目标、AC -->',
    '',
  ].join('\n')
}

// ============================================================================
// ticket 07a — ADR-0014 状态软标签 + progress 派生(决策 15-v2)
// ============================================================================

/** 10 状态枚举(决策 15-v2 / ADR-0014 D6:跨端契约)
 *  - 比 web 端 mock 期 9 状态多 1 个 'drafting',表示"已建目录但 requirement.md 仍空白"
 *  - 'implementing' / 'submitting' 本期 P1+ 不实装派生(ADR-0014 D7)
 *
 * 单一真相源:`RequirementStatusSchema` 与 `STATUS_PROGRESS_MAP` 都从这里派生,
 * 新增/删除 status 必须改本表(`satisfies` 会强制 STATUS_PROGRESS_MAP 覆盖所有 key)。
 */
export const RequirementStatus = {
  DRAFT: 'draft',
  DRAFTING: 'drafting',
  ANALYZING: 'analyzing',
  CLARIFYING: 'clarifying',
  DESIGNING: 'designing',
  PLANNING: 'planning',
  IMPLEMENTING: 'implementing',
  SUBMITTING: 'submitting',
  DONE: 'done',
  ARCHIVED: 'archived',
} as const

export type RequirementStatusT = (typeof RequirementStatus)[keyof typeof RequirementStatus]

// z.enum 派生自常量对象,避免三处枚举重复(Shotgun Surgery):
// 单测已覆盖 accepts all 10 valid statuses / rejects unknown(见 requirement.test.ts)
export const RequirementStatusSchema = z.enum(
  Object.values(RequirementStatus) as [RequirementStatusT, ...RequirementStatusT[]],
)

/** status → progress 派生映射(ADR-0014 D3)
 *  - 跨端契约,改一处生效
 *  - monotonic non-decreasing(单测覆盖)
 *  - draft/drafting 同为 0;done/archived 同为 100
 *
 *  `satisfies` 在编译期保证:新增 RequirementStatus 但忘了在本表加映射 → TS 报错。
 */
export const STATUS_PROGRESS_MAP = {
  draft: 0,
  drafting: 0,
  analyzing: 20,
  clarifying: 30,
  designing: 40,
  planning: 50,
  implementing: 70,
  submitting: 90,
  done: 100,
  archived: 100,
} as const satisfies Record<RequirementStatusT, number>

/** 列表项 schema — GET /api/requirements 响应元素 */
export const RequirementSummarySchema = z.object({
  id: z.string().regex(REQUIREMENT_ID_RE, 'id must match req-NNN-slug pattern'),
  title: z.string().min(1),
  status: RequirementStatusSchema,
  progress: z.number().int().min(0).max(100),
  repos: z.array(z.string()),
  createdAt: z.string(), // ISO 8601
  updatedAt: z.string(), // ISO 8601
})
export type RequirementSummary = z.infer<typeof RequirementSummarySchema>

/** GET /api/requirements 200 响应体 */
export const RequirementListResponseSchema = z.object({
  requirements: z.array(RequirementSummarySchema),
})
export type RequirementListResponse = z.infer<typeof RequirementListResponseSchema>