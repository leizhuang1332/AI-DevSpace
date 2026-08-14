/**
 * Codebase 关联契约(.scratch/repo-registry-clone/issues/01-shared-schema.md 1.3)
 *
 * 跨 web/agent 共享:Zod schema + 纯函数 validateBranchName。
 * 命名风格沿用 packages/shared/src/api.ts(ApiError / NotImplementedError)。
 *
 * **vs 旧 worktree 形态(ADR-0003 / ADR-0016)**:
 * - 字段名 `repoIds` → `repoNames`(name 全局唯一即标识,决策 105)
 * - 字段名 `worktreePath` → `codebasePath`(路径 `requirements/<req-id>/codebase/<name>/`,决策 106)
 * - 删除 `E_BASE_BRANCH_NOT_FOUND` / `E_BRANCH_EXISTS`(clone 必然有 HEAD;全新 clone 不可能撞本地分支 —— 决策 111)
 * - 新增 `E_REPO_ALREADY_ATTACHED` / `E_REPO_NAME_EXISTS`(决策 111)
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
 * 校验统一分支名
 *
 * 两种模式:
 * - 默认(silent strip):用于前端 attach-repos-dialog 的 input 过滤链;
 *   含非法字符 → strip 后再判断,trim 后合法即视为合法。
 * - `{ strict: true }`:用于后端兜底(ticket 02 验收 #11);
 *   原始输入含任何非法字符即 reject,即使 strip 后仍合法也不算通过。
 *
 * 返回 `sanitized` 字段:无论 ok 与否都给调用方一个可用字符串,便于直接落库。
 */
export function validateBranchName(
  raw: string,
  opts?: { strict?: boolean },
): {
  ok: boolean
  error?: string
  sanitized: string
} {
  const sanitized = raw.replace(BRANCH_FORBIDDEN_RE, '')
  const trimmed = sanitized.trim()
  if (opts?.strict && sanitized !== raw) {
    return {
      ok: false,
      error: '分支名包含路径非法字符(后端兜底拒绝)',
      sanitized,
    }
  }
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
 * RepoAttach / Codebase 错误码 —— ADR-0030 D5 调整后:
 *
 * - `E_AUTH` 不进 per-repo 结果 —— authPlugin 在路由前已拦截 401/403;
 *   前端 agentFetch 收到非 2xx 抛 AgentError,在 catch 层根据 status === 401
 *   映射为 `code: 'E_AUTH'`,banner 渲染红色 + [查看] 按钮跳设置页
 * - `E_REPO_NAME_EXISTS`:POST /api/repos 时 yaml 已有同名条目
 * - `E_REPO_ALREADY_ATTACHED`:`codebase/<name>/` 已存在(幂等校验,决策 109)
 *
 * 删除(决策 111):
 * - `E_BASE_BRANCH_NOT_FOUND`:clone 下来必然有 HEAD
 * - `E_BRANCH_EXISTS`:全新 clone 不可能撞本地分支
 */
export const RepoAttachErrorCode = {
  E_AUTH: 'E_AUTH',
  E_DISK_FULL: 'E_DISK_FULL',
  E_INVALID_BRANCH_NAME: 'E_INVALID_BRANCH_NAME',
  E_REPO_NOT_FOUND: 'E_REPO_NOT_FOUND', // 语义改:注册表无此条目(决策 111)
  E_REPO_NAME_EXISTS: 'E_REPO_NAME_EXISTS', // 新增:POST /api/repos 时 name 重复
  E_REPO_ALREADY_ATTACHED: 'E_REPO_ALREADY_ATTACHED', // 新增:codebase/<name>/ 已存在
  E_REQUIREMENT_NOT_FOUND: 'E_REQUIREMENT_NOT_FOUND',
  E_NETWORK: 'E_NETWORK',
  E_INTERNAL: 'E_INTERNAL',
} as const

export type RepoAttachErrorCodeT =
  (typeof RepoAttachErrorCode)[keyof typeof RepoAttachErrorCode]

/** per-repo 失败时使用的错误码(排除 E_REQUIREMENT_NOT_FOUND / E_INVALID_BRANCH_NAME / E_AUTH / E_REPO_NAME_EXISTS 这些只用于顶层 catch / POST 注册表校验) */
export const PER_REPO_ERROR_CODES = [
  RepoAttachErrorCode.E_DISK_FULL,
  RepoAttachErrorCode.E_NETWORK,
  RepoAttachErrorCode.E_AUTH,
  RepoAttachErrorCode.E_REPO_NOT_FOUND,
  RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED,
  RepoAttachErrorCode.E_INTERNAL,
] as const

// ---------------------------------------------------------------------------
// Zod schema —— request / response(前后端共用契约)
// ---------------------------------------------------------------------------

export const AttachReposRequestSchema = z.object({
  repoNames: z
    .array(z.string().min(1).max(100))
    .min(1, 'at least one repo required')
    .max(50, 'at most 50 repos per request'),
  branchName: z.string().min(1).max(BRANCH_MAX_LENGTH),
})
export type AttachReposRequest = z.infer<typeof AttachReposRequestSchema>

export const AttachRepoResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    repoName: z.string(),
    branch: z.string(),
    codebasePath: z.string(),
    base: z.enum(['main', 'master']),
  }),
  z.object({
    ok: z.literal(false),
    repoName: z.string(),
    code: z.enum(PER_REPO_ERROR_CODES),
    message: z.string(),
  }),
])
export type AttachRepoResult = z.infer<typeof AttachRepoResultSchema>

export const AttachReposResponseSchema = z.object({
  requirementId: z.string(),
  branchName: z.string(),
  succeeded: z.number().int().min(0),
  failed: z.number().int().min(0),
  results: z.array(AttachRepoResultSchema),
})
export type AttachReposResponse = z.infer<typeof AttachReposResponseSchema>