/**
 * 关联仓库 API wrapper(.scratch/repo-registry-clone/issues/06-web-frontend-followup.md)
 *
 * 调 `POST /api/requirement/:id/repos` 给指定需求创建 git worktree
 * (ADR-0030 D5 之后是 per-requirement codebase clone,字段名随 schema
 * 重写:`repoIds` → `repoNames`、`worktreePath` → `codebasePath`)。
 *
 * 设计:
 * - 入参 schema 二次校验(Zod,即使绕过 attach-repos-dialog 也防御)
 * - 响应 schema 二次校验(防后端契约变更)
 * - 错误处理:AgentError → AttachReposError,前端按 status 决定 banner 文案
 *
 * 调用方:drafting-zone.tsx 的 submitAttach
 */

import { z } from 'zod'
import {
  AttachReposRequestSchema,
  AttachReposResponseSchema,
  PostRepoRegistryRequestSchema,
  RepoRegistryEntrySchema,
  RepoRegistryResponseSchema,
  RepoUsageResponseSchema,
  type AttachReposRequest,
  type AttachReposResponse,
  type RepoRegistryEntry,
  type RepoRegistryResponse,
  type RepoUsageResponse,
} from '@ai-devspace/shared'
import { agentFetch, AgentError } from './agent-client'

export class AttachReposError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`AttachRepos ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    this.name = 'AttachReposError'
  }
}

/**
 * 入参类型(由 shared re-export,这里再 alias 便于 web 端 import 一处)
 */
export type AttachReposPayload = AttachReposRequest

/**
 * 调后端 attach repos。
 * - 入参 / 出参 schema 双重校验
 * - 非 2xx 抛 AttachReposError(带 status + body)
 * - 网络错 / 反序列化错 抛原始 Error / ZodError
 */
export async function attachReposToRequirement(
  requirementId: string,
  payload: AttachReposPayload,
  opts?: { signal?: AbortSignal },
): Promise<AttachReposResponse> {
  // 1. 入参校验
  const parsedReq = AttachReposRequestSchema.parse(payload)

  let raw: unknown
  try {
    raw = await agentFetch<AttachReposResponse>(
      `/api/requirement/${encodeURIComponent(requirementId)}/repos`,
      {
        method: 'POST',
        body: JSON.stringify(parsedReq),
        signal: opts?.signal,
      },
    )
  } catch (err) {
    if (err instanceof AgentError) {
      throw new AttachReposError(err.status, err.body)
    }
    throw err
  }

  // 2. 出参校验
  return AttachReposResponseSchema.parse(raw)
}

// ============================================================================
// issue 06 (ADR-0030):仓库注册表 — GET /api/repos
// ============================================================================

/**
 * 拉取全局仓库注册表(Agent 实时读 `~/.aidevspace/repos.yaml`)。
 *
 * 用途(ADR-0030 D3 / D7):
 * - SSR 初始:`getDraftingDataFromFs` 走 fs 直读派生 `data.repos`
 * - 弹层 refetch 兜底:attach-repos-dialog 打开时由 `drafting-zone` useEffect 再调一次
 * - 失败处理:透传 AgentError / 网络错 / ZodError —— 调用方 try/catch 决定 fallback
 *
 * **不**封装为特定 Error 子类 —— 仓库池是次要数据,失败时静默降级比醒目的 banner 更合适
 * (符合决策 24:不打扰,但陪伴)。
 */
export async function fetchRepoRegistry(
  opts?: { signal?: AbortSignal },
): Promise<RepoRegistryResponse> {
  // 出参 schema 二次校验(防后端契约变更);AgentError / AbortError / 网络错
  // 全部透传,无需包装(Middle Man 避免 —— 与下方 `attachReposToRequirement`
  // 不同,后者需把 AgentError 包成 AttachReposError 让上层按 status 决定 banner 文案)
  const raw = await agentFetch<RepoRegistryResponse>('/api/repos', {
    method: 'GET',
    signal: opts?.signal,
  })
  return RepoRegistryResponseSchema.parse(raw)
}

// ============================================================================
// Re-export Zod schema + 类型 —— 让 web 端不必再 import @ai-devspace/shared
// ============================================================================

export {
  AttachReposRequestSchema,
  AttachReposResponseSchema,
  RepoRegistryResponseSchema,
  RepoUsageResponseSchema,
}
export type {
  AttachReposRequest,
  AttachReposResponse,
  RepoRegistryResponse,
  RepoUsageResponse,
}

// ============================================================================
// issue 07 (ADR-0030 D6):GET /api/repos/:name/usage —— 「被 N 个需求使用」派生
// ============================================================================

/**
 * 拉取单个仓库的关联需求列表(ADR-0030 D6)。
 *
 * 用途:
 * - /repos 列表页:每个仓库卡片显示「被 N 个需求使用」徽章
 * - /repos/[name] 详情页:完整关联需求列表(branch + codebasePath)
 *
 * 错误处理:AgentError(404 E_REPO_NOT_FOUND / 401 / 500)透传;
 * 网络错 / ZodError 透传。调用方决定 fallback(列表页一般用 0 兜底)。
 */
export async function fetchRepoUsage(
  repoName: string,
  opts?: { signal?: AbortSignal },
): Promise<RepoUsageResponse> {
  const raw = await agentFetch<RepoUsageResponse>(
    `/api/repos/${encodeURIComponent(repoName)}/usage`,
    {
      method: 'GET',
      signal: opts?.signal,
    },
  )
  return RepoUsageResponseSchema.parse(raw)
}

// ============================================================================
// issue 07 (ADR-0030 D8):POST /api/repos —— 「+ 添加仓库」弹层使用
// ============================================================================

/**
 * 调后端添加仓库条目。
 *
 * - 入参 / 出参 schema 双重校验
 * - 非 2xx 抛 AgentError(带 status + body,前端按 status 决定文案)
 * - 网络错 / ZodError 透传
 *
 * 行为:后端必跑 `git ls-remote` 验证可达 + 凭据可用(决策 Q5),
 * 通常 ~5-10s,所以弹层需要 loading 态。
 */
export interface CreateRepoPayload {
  name: string
  gitUrl: string
  description: string
}

export async function createRepo(
  payload: CreateRepoPayload,
  opts?: { signal?: AbortSignal },
): Promise<RepoRegistryEntry> {
  const parsed = PostRepoRegistryRequestSchema.parse(payload)
  const raw = await agentFetch<RepoRegistryEntry>('/api/repos', {
    method: 'POST',
    body: JSON.stringify(parsed),
    signal: opts?.signal,
  })
  return RepoRegistryEntrySchema.parse(raw)
}

export { PostRepoRegistryRequestSchema, RepoRegistryEntrySchema }
export type { RepoRegistryEntry }

// ============================================================================
// issue 07 (ADR-0030 Q7):DELETE /api/repos/:name —— 卡片 hover「删除」使用
// ============================================================================

/**
 * 删除注册表条目。
 *
 * - 204 No Content → undefined
 * - 409 E_REPO_IN_USE(被 N≥1 需求使用 + 未带 force)→ 抛 AgentError(让前端弹二次确认)
 * - 404 / 其他 → 抛 AgentError
 *
 * `force=true` 时即使被使用也删除,但**不** rm 任何 codebase/(决策 113 沿用)。
 */
export async function deleteRepo(
  repoName: string,
  opts?: { force?: boolean; signal?: AbortSignal },
): Promise<void> {
  const query = opts?.force ? '?force=true' : ''
  await agentFetch<void>(`/api/repos/${encodeURIComponent(repoName)}${query}`, {
    method: 'DELETE',
    signal: opts?.signal,
  })
}

/**
 * 取消某个 repo 与某需求的关联(ADR-0034)。
 *
 * 与 `deleteRepo`(全局仓库池条目删除)严格独立:
 * - 本函数**不**动 `repos.yaml`,只 rm `requirements/<reqId>/codebase/<repoName>/`
 * - N=1→0 时由后端顺带清 `meta.yaml::branchName`(前端无须关心)
 *
 * 错误码(由 agent 路由层定义,见 routes/requirement.ts):
 * - 204 No Content → undefined(成功)
 * - 400 E_INVALID_REPO_NAME(name 含 `/` `\` `..` `\0`) → AgentError
 * - 404 E_REQUIREMENT_NOT_FOUND / E_CODEBASE_NOT_FOUND       → AgentError
 * - 409 E_REQUIREMENT_NOT_DRAFTING(非 DRAFTING 状态门禁)   → AgentError
 * - 500 E_INTERNAL(safeRm 抛错)                              → AgentError
 */
export async function detachCodebase(
  reqId: string,
  repoName: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await agentFetch<void>(
    `/api/requirement/${encodeURIComponent(reqId)}/codebase/${encodeURIComponent(repoName)}`,
    {
      method: 'DELETE',
      signal: opts?.signal,
    },
  )
}

// Zod 的版本断言 schema(简单 typeguard,避免 web 端 import z 重复声明)
export function isAttachReposError(err: unknown): err is AttachReposError {
  return err instanceof AttachReposError
}

// ============================================================================
// 内部使用:zod parse 失败的兜底 —— 转为带 message 的 Error
// ============================================================================

export function safeParseAttachReposResponse(raw: unknown): {
  ok: boolean
  data?: AttachReposResponse
  error?: z.ZodError
} {
  const r = AttachReposResponseSchema.safeParse(raw)
  if (r.success) return { ok: true, data: r.data }
  return { ok: false, error: r.error }
}