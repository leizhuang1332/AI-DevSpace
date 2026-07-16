/**
 * Worktree 关联契约(.scratch/new-requirement-modal/issues/02-worktree-real-creation.md)
 *
 * 跨 web/agent 共享:Zod schema + 纯函数 validateBranchName。
 * 命名风格沿用 packages/shared/src/api.ts(ApiError / NotImplementedError)。
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// 分支名校验常量与纯函数
// ---------------------------------------------------------------------------

/**
 * 路径非法字符 + 空白。注:git 分支名允许 `/`(feat/xxx namespace 风格),
 * 所以从禁列去除 —— 详见 attach-repos-dialog.tsx 同款实现。
 * `\` 是文件系统反斜杠,需要禁。
 */
export const BRANCH_FORBIDDEN_RE = /[\\:*?"<>|\s]/g

/** 分支名最大长度(后端兜底,与前端 attach-repos-dialog 保持一致) */
export const BRANCH_MAX_LENGTH = 100

/**
 * 校验统一分支名:trim + strip 非法字符 + 长度检查
 * - 前端 attach-repos-dialog 已有 BRANCH_FORBIDDEN_RE 实时过滤;后端再做一次兜底
 * - 返回 `sanitized` 字段:无论 ok 与否都给调用方一个可用字符串,便于直接落库
 */
export function validateBranchName(raw: string): {
  ok: boolean
  error?: string
  sanitized: string
} {
  const sanitized = raw.replace(BRANCH_FORBIDDEN_RE, '')
  const trimmed = sanitized.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: '请填写分支名', sanitized }
  }
  if (trimmed.length > BRANCH_MAX_LENGTH) {
    return {
      ok: false,
      error: `分支名不能超过 ${BRANCH_MAX_LENGTH} 字`,
      sanitized,
    }
  }
  return { ok: true, sanitized: trimmed }
}

// ---------------------------------------------------------------------------
// 错误码常量(per-repo 结果 + 顶层 catch 共享)
// ---------------------------------------------------------------------------

/**
 * RepoAttach 错误码。
 *
 * 注意:
 * - E_AUTH **不**进 per-repo 结果 —— authPlugin 在路由前已拦截 401/403;
 *   前端 agentFetch 收到非 2xx 抛 AgentError,在 catch 层处理。
 * - 这里保留 E_AUTH 为"参考性"枚举值,顶层 catch 兜底会用。
 */
export const RepoAttachErrorCode = {
  E_BASE_BRANCH_NOT_FOUND: 'E_BASE_BRANCH_NOT_FOUND',
  E_DISK_FULL: 'E_DISK_FULL',
  E_NETWORK: 'E_NETWORK',
  E_INVALID_BRANCH_NAME: 'E_INVALID_BRANCH_NAME',
  E_REPO_NOT_FOUND: 'E_REPO_NOT_FOUND',
  E_REQUIREMENT_NOT_FOUND: 'E_REQUIREMENT_NOT_FOUND',
  E_BRANCH_EXISTS: 'E_BRANCH_EXISTS',
  E_INTERNAL: 'E_INTERNAL',
} as const

export type RepoAttachErrorCodeT =
  (typeof RepoAttachErrorCode)[keyof typeof RepoAttachErrorCode]

/** per-repo 失败时使用的错误码(排除了只用于顶层 catch 的 E_REQUIREMENT_NOT_FOUND / E_INVALID_BRANCH_NAME / E_NETWORK[全局]) */
export const PER_REPO_ERROR_CODES = [
  RepoAttachErrorCode.E_BASE_BRANCH_NOT_FOUND,
  RepoAttachErrorCode.E_DISK_FULL,
  RepoAttachErrorCode.E_NETWORK,
  RepoAttachErrorCode.E_REPO_NOT_FOUND,
  RepoAttachErrorCode.E_BRANCH_EXISTS,
  RepoAttachErrorCode.E_INTERNAL,
] as const

// ---------------------------------------------------------------------------
// Zod schema —— request / response(前后端共用契约)
// ---------------------------------------------------------------------------

export const AttachReposRequestSchema = z.object({
  repoIds: z
    .array(z.string().min(1))
    .min(1, 'at least one repo required')
    .max(50, 'at most 50 repos per request'),
  branchName: z.string().min(1).max(BRANCH_MAX_LENGTH),
})
export type AttachReposRequest = z.infer<typeof AttachReposRequestSchema>

export const AttachRepoResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    repoId: z.string(),
    branch: z.string(),
    worktreePath: z.string(),
    base: z.enum(['main', 'master']),
  }),
  z.object({
    ok: z.literal(false),
    repoId: z.string(),
    code: z.enum(PER_REPO_ERROR_CODES),
    message: z.string(),
  }),
])
export type AttachRepoResult = z.infer<typeof AttachRepoResultSchema>

export const AttachReposResponseSchema = z.object({
  requirementId: z.string(),
  branchName: z.string(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(AttachRepoResultSchema),
})
export type AttachReposResponse = z.infer<typeof AttachReposResponseSchema>
