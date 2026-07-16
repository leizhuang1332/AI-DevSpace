import type { FastifyInstance } from 'fastify'
import {
  AttachReposRequestSchema,
  validateBranchName,
  type AttachReposResponse,
} from '@ai-devspace/shared'
import type { RequirementService } from '../services/RequirementService.js'

function notImplemented(feature: string, issue: string): {
  error: 'not_implemented'
  feature: string
  message: string
  issue: string
} {
  return {
    error: 'not_implemented',
    feature,
    message: `本期骨架仅占位；真实实装见 issue ${issue}`,
    issue,
  }
}

/**
 * requirementRoutes —— Requirement 工作台相关 REST endpoints
 *
 * 历史背景(决策 / issue tracker):
 * - issue 04(POST /api/requirements 文件落盘):本期仍未实装 → 保留 501 占位
 * - issue 02 ticket(POST /api/requirement/:id/repos):本 slice 实装
 *   - 真实 git worktree 创建 + base 分支 fallback + 网络错重试
 *   - 部分成功语义:每个 repo 独立 Ok/Err,前端按结果分类
 *   - 鉴权:由 authPlugin 全局 onRequest hook 拦截 401/403,
 *     无需在此路由内重复校验
 *
 * 后续 slice 替换剩余 4 个 501 stub(逐 ticket 推进)。
 */
export interface RequirementRoutesDeps {
  /**
   * 实装 POST /api/requirement/:id/repos 的服务。
   * - 未注入时新路由返回 503 `service_not_ready`(兼容旧测试)
   * - 注入但缺少 repo pool 时,route 仍会返回 per-repo `E_REPO_NOT_FOUND`
   */
  requirementService?: RequirementService
}

export async function requirementRoutes(
  app: FastifyInstance,
  deps: RequirementRoutesDeps = {},
): Promise<void> {
  // ============================================================================
  // 5 个 501 stub(后续 ticket 逐个替换)
  // ============================================================================

  app.post('/api/requirement', async (_req, reply) => {
    return reply.code(501).send(notImplemented('requirement.create', '05'))
  })

  app.get('/api/requirements', async (_req, reply) => {
    return reply.code(501).send(notImplemented('requirement.list', '05'))
  })

  app.get<{ Params: { id: string } }>('/api/requirement/:id', async (req, reply) => {
    return reply.code(501).send(notImplemented('requirement.detail', '05'))
  })

  app.patch<{ Params: { id: string } }>('/api/requirement/:id', async (req, reply) => {
    return reply.code(501).send(notImplemented('requirement.update', '05'))
  })

  app.post<{ Params: { id: string } }>(
    '/api/requirement/:id/skill',
    async (req, reply) => {
      return reply.code(501).send(notImplemented('requirement.run_skill', '08'))
    },
  )

  // ============================================================================
  // POST /api/requirement/:id/repos —— issue 02 ticket(worktree 真实创建)
  // ============================================================================

  app.post<{
    Params: { id: string }
    Body: unknown
  }>('/api/requirement/:id/repos', async (req, reply) => {
    const { id } = req.params
    const { requirementService: service } = deps

    if (!service) {
      return reply.code(503).send({ error: 'service_not_ready' })
    }

    // 1. body schema 校验(repoIds 非空 + 长度上限;branchName 长度 ≤ 100)
    const parsed = AttachReposRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_body',
        details: parsed.error.issues,
      })
    }
    const { repoIds, branchName } = parsed.data

    // 2. 分支名 strip 非法字符(后端兜底 —— 前端 attach-repos-dialog 已实时过滤)
    const branchCheck = validateBranchName(branchName)
    if (!branchCheck.ok) {
      return reply.code(400).send({
        error: 'E_INVALID_BRANCH_NAME',
        message: branchCheck.error ?? 'invalid branch name',
      })
    }
    const sanitizedBranch = branchCheck.sanitized

    // 3. 校验 req 目录是否存在
    if (!(await service.checkRequirementExists(id))) {
      return reply.code(404).send({
        error: 'E_REQUIREMENT_NOT_FOUND',
        requirementId: id,
      })
    }

    // 4. 逐 repo 创建,收集 results(部分失败不中断)
    const results = await service.attachRepos(id, repoIds, sanitizedBranch)
    const succeeded = results.filter((r) => r.ok).length
    const failed = results.length - succeeded

    const body: AttachReposResponse = {
      requirementId: id,
      branchName: sanitizedBranch,
      succeeded,
      failed,
      results,
    }
    return reply.code(200).send(body)
  })
}
