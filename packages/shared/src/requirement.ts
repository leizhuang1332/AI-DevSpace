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
 * 字段冻结规则(决策 15 + 57):
 * - 不写 `status`(决策 15 反对状态机;决策 57 默认 redirect 不基于 status)
 * - 不写 `current_focus`(由用户后续在工位设置)
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