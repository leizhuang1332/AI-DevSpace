/**
 * 关联仓库 API wrapper(.scratch/new-requirement-modal/issues/02-worktree-real-creation.md)
 *
 * 调 `POST /api/requirement/:id/repos` 给指定需求创建 git worktree。
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
  ReposResponseSchema,
  type AttachReposRequest,
  type AttachReposResponse,
  type ReposResponse,
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
// issue 06 (ADR-0016):仓库池扫描 — GET /api/repos
// ============================================================================

/**
 * 拉取全局仓库池(Agent 实时 readdir `<workspaceRoot>/repos/` 子目录)。
 *
 * 用途(决策 76 / ADR-0016 D4):
 * - SSR 初始:`getDraftingData()` 调用一次,把结果注入 `DraftingData.repos`
 * - 弹层 refetch 兜底:attach-repos-dialog 打开时由 `drafting-zone` useEffect 再调一次
 * - 失败处理:透传 AgentError / 网络错 / ZodError —— 调用方 try/catch 决定 fallback
 *
 * **不**封装为特定 Error 子类 —— 仓库池是次要数据,失败时静默降级比醒目的 banner 更合适
 * (符合决策 24:不打扰,但陪伴)。
 */
export async function fetchRepoPool(
  opts?: { signal?: AbortSignal },
): Promise<ReposResponse> {
  // 出参 schema 二次校验(防后端契约变更);AgentError / AbortError / 网络错
  // 全部透传,无需包装(Middle Man 避免 —— 与下方 `attachReposToRequirement`
  // 不同,后者需把 AgentError 包成 AttachReposError 让上层按 status 决定 banner 文案)
  const raw = await agentFetch<ReposResponse>('/api/repos', {
    method: 'GET',
    signal: opts?.signal,
  })
  return ReposResponseSchema.parse(raw)
}

// ============================================================================
// Re-export Zod schema + 类型 —— 让 web 端不必再 import @ai-devspace/shared
// ============================================================================

export { AttachReposRequestSchema, AttachReposResponseSchema, ReposResponseSchema }
export type { AttachReposRequest, AttachReposResponse, ReposResponse }

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
