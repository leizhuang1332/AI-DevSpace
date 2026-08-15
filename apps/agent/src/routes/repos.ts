/**
 * `/api/repos` CRUD routes —— issue 02-repos-route-crud.md / ADR-0030 D1 / D6 / D8
 *
 * 真相源 = `<root>/repos.yaml`(独立单文件,顶层 {version: 1, repos: []})。
 * route 层不直接 fs —— 所有读写通过 WorkspaceService 收敛,避免并发
 * read-modify-write 漂移(issue 02 风险"macOS / Windows 文件锁语义差异")。
 *
 * 端点矩阵:
 * - GET    /api/repos           读 yaml → {repos: [{name, gitUrl, description}]}
 * - POST   /api/repos           ls-remote 验证 + 写 yaml;name 重复 → 409
 * - PUT    /api/repos/:name     改 gitUrl 必跑 ls-remote;不改 gitUrl 不跑
 * - DELETE /api/repos/:name     检查 codebase 复用;被使用 + force=false → 409;
 *                              force=true 直接删(保留 codebase/ 目录,决策 113)
 *
 * 命名空间:workspace 顶层资源,与 `POST /api/requirement/:id/repos`(issue 03
 * 待改造) 形成"全局池 vs 需求关联"对照(决策 77 沿用)。
 *
 * 历史背景:
 * - issue 06 ticket(ADR-0016):本期 GET /api/repos 读 `<root>/repos/` 物理目录
 * - issue 02 ticket(ADR-0030):整体切到 yaml 注册表 + 加 POST/PUT/DELETE 三端点
 */

import type { FastifyInstance } from 'fastify'
import {
  PostRepoRegistryRequestSchema,
  PutRepoRegistryRequestSchema,
  RepoRegistryResponseSchema,
  RepoUsageResponseSchema,
  type RepoRegistryEntry,
} from '@ai-devspace/shared'
import type { WorkspaceService } from '../services/WorkspaceService.js'
import {
  RegistryConflictError,
  RegistryNotFoundError,
  RegistryWriteError,
} from '../services/WorkspaceService.js'
import type { GitExec } from '../codebase/CodebaseManager.js'

export interface ReposRouteDeps {
  /** Workspace service —— 所有 yaml CRUD 走这里(避免并发漂移) */
  workspace: WorkspaceService
  /** git exec 抽象 —— POST/PUT 必跑 ls-remote 验证可达 + 凭据可用(决策 Q5) */
  git: GitExec
}

/**
 * 跑 `git ls-remote --heads <gitUrl>` —— 通过抽象层调,便于测试注入 fake。
 *
 * 返回 `{ code, stdout, stderr }` 与 `createDefaultGitExec()` 一致;
 * 超时由 caller 控制(本实装未注入 timeout,但未来 issue 05 强制 env 后可在此加)。
 */
async function lsRemote(
  git: GitExec,
  gitUrl: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return git(['ls-remote', '--heads', gitUrl])
}

/**
 * 把 ls-remote 的 stderr 文本映射成错误码。
 *
 * 启发式匹配(精确枚举真实 git 1.x / 2.x 输出):
 * - 含 `Permission denied` / `publickey` / `Authentication failed` → E_AUTH
 * - 含 `Could not resolve host` / `Network is unreachable` → E_NETWORK
 * - 含 `Connection timed out` / `Operation timed out` → E_TIMEOUT
 * - 其他(stderr 非空)→ E_NETWORK(保守:网络类优先)
 * - stderr 空(不应发生,ls-remote 失败必有错)→ E_INTERNAL
 */
function mapLsRemoteError(stderr: string): {
  code: 'E_AUTH' | 'E_NETWORK' | 'E_TIMEOUT' | 'E_INTERNAL'
  httpStatus: 401 | 502 | 408 | 500
} {
  const s = stderr.toLowerCase()
  if (
    s.includes('permission denied') ||
    s.includes('publickey') ||
    s.includes('authentication failed')
  ) {
    return { code: 'E_AUTH', httpStatus: 401 }
  }
  if (s.includes('timed out') || s.includes('timeout')) {
    return { code: 'E_TIMEOUT', httpStatus: 408 }
  }
  if (
    s.includes('could not resolve host') ||
    s.includes('network is unreachable') ||
    s.includes('connection refused') ||
    s.includes('unable to access')
  ) {
    return { code: 'E_NETWORK', httpStatus: 502 }
  }
  if (stderr.trim().length === 0) {
    return { code: 'E_INTERNAL', httpStatus: 500 }
  }
  return { code: 'E_NETWORK', httpStatus: 502 }
}

/** ls-remote 错误 → 固定对外文案(不暴露 stderr,可能含凭据片段) */
function lsRemoteErrorMessage(code: string): string {
  switch (code) {
    case 'E_AUTH':
      return 'git ls-remote 鉴权失败'
    case 'E_NETWORK':
      return 'git ls-remote 网络不可达'
    case 'E_TIMEOUT':
      return 'git ls-remote 超时'
    case 'E_INTERNAL':
    default:
      return 'git ls-remote 失败'
  }
}

/** 校验 `git ls-remote` 是否成功,失败时返对应的 HTTP reply;成功返 null。 */
async function verifyGitUrl(
  git: GitExec,
  gitUrl: string,
  log: { error: (...args: unknown[]) => void } | undefined,
): Promise<
  | null
  | {
      httpStatus: 401 | 408 | 500 | 502
      body: { error: string; message: string }
    }
> {
  const result = await lsRemote(git, gitUrl)
  if (result.code === 0) return null
  const { code, httpStatus } = mapLsRemoteError(result.stderr)
  // stderr 仅进 server log(可能含 user:token@host / ssh key 路径等敏感片段);
  // 响应 body 用固定文案,避免把凭据泄漏给前端
  log?.error({ stderr: result.stderr, code, gitUrl }, 'git ls-remote failed')
  return {
    httpStatus,
    body: { error: code, message: lsRemoteErrorMessage(code) },
  }
}

export async function reposRoutes(
  app: FastifyInstance,
  deps: ReposRouteDeps,
): Promise<void> {
  const { workspace, git } = deps

  // ==========================================================================
  // GET /api/repos —— 读 yaml 注册表
  // ==========================================================================
  app.get('/api/repos', async (_req, reply) => {
    try {
      const reg = await workspace.readRepoRegistry()
      const body = RepoRegistryResponseSchema.parse({ repos: reg.repos })
      return reply.code(200).send(body)
    } catch (err) {
      // yaml 解析 / Zod 校验失败 → 500(用户可手动修复 yaml 文件)
      _req.log.error(
        { err, path: workspace.repoRegistryPath },
        'read repos.yaml failed',
      )
      return reply.code(500).send({
        error: 'E_REPO_REGISTRY_READ_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
  })

  // ==========================================================================
  // POST /api/repos —— 创建仓库条目
  // ==========================================================================
  app.post<{ Body: unknown }>('/api/repos', async (req, reply) => {
    // 1. body schema 校验
    const parsed = PostRepoRegistryRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_body',
        details: parsed.error.issues,
      })
    }
    const { name, gitUrl, description } = parsed.data

    // 2. 先跑 ls-remote(决策 Q5 + 防 SSRF):
    //    - 先做网络验证再查唯一性,避免攻击者用别人已有的 name 反复 POST
    //      第三方 git URL 触发服务端对任意主机做端口扫描 / 探测
    //    - 鉴权失败 stderr 也不直接回给客户端(M1 净化)
    const fail = await verifyGitUrl(git, gitUrl, req.log)
    if (fail) {
      return reply.code(fail.httpStatus).send(fail.body)
    }

    // 3. name 唯一性(在 ls-remote 通过后做,失败可放心返 409)
    const existing = await workspace.findRepoByName(name)
    if (existing) {
      return reply.code(409).send({
        error: 'E_REPO_NAME_EXISTS',
        message: `仓库名 ${name} 已存在`,
      })
    }

    // 4. 原子写入 yaml
    try {
      await workspace.addRepo({ name, gitUrl, description })
    } catch (err) {
      // 唯一可能:并发 race 撞 name(理论上 findRepoByName 已经查过,
      // 但服务层 mutateRegistry 兜底抛 RegistryConflictError)
      if (err instanceof RegistryConflictError) {
        return reply.code(409).send({
          error: err.code,
          message: err.message,
        })
      }
      req.log.error({ err, name, gitUrl }, 'addRepo failed')
      return reply.code(500).send({
        error: 'E_REGISTRY_WRITE_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }

    return reply.code(201).send({ name, gitUrl, description })
  })

  // ==========================================================================
  // PUT /api/repos/:name —— 改 gitUrl / description
  // ==========================================================================
  app.put<{ Params: { name: string }; Body: unknown }>(
    '/api/repos/:name',
    async (req, reply) => {
      const { name } = req.params

      // 1. body schema 校验(gitUrl / description 至少传一个)
      const parsed = PutRepoRegistryRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_body',
          details: parsed.error.issues,
        })
      }
      const { gitUrl: newGitUrl, description: newDescription } = parsed.data

      // 2. 查存在性(404 提前于 ls-remote)
      const existing = await workspace.findRepoByName(name)
      if (!existing) {
        return reply.code(404).send({
          error: 'E_REPO_NOT_FOUND',
          message: `仓库 ${name} 不存在`,
        })
      }

      // 3. 改了 gitUrl 才跑 ls-remote(不改 gitUrl 不触发网络 IO,Q5 验证只在变化时跑)
      if (newGitUrl !== undefined && newGitUrl !== existing.gitUrl) {
        const fail = await verifyGitUrl(git, newGitUrl, req.log)
        if (fail) {
          return reply.code(fail.httpStatus).send(fail.body)
        }
      }

      // 4. 写盘(name 是 URL path 唯一标识,body 里的 name 字段被忽略,
      //    Zod schema 已经不让传 name,这里只是兜底)
      let updated: RepoRegistryEntry
      try {
        const patch: {
          gitUrl?: string
          description?: string
        } = {}
        if (newGitUrl !== undefined) patch.gitUrl = newGitUrl
        if (newDescription !== undefined) patch.description = newDescription
        updated = await workspace.updateRepo(name, patch)
      } catch (err) {
        if (err instanceof RegistryNotFoundError) {
          // 并发删除 race:findRepoByName 与 updateRepo 之间被删
          return reply.code(404).send({
            error: err.code,
            message: err.message,
          })
        }
        if (err instanceof RegistryWriteError) {
          req.log.error({ err, name }, 'updateRepo write failed')
          return reply.code(500).send({
            error: 'E_REGISTRY_WRITE_FAILED',
            message: err.message,
          })
        }
        throw err
      }

      return reply.code(200).send(updated)
    },
  )

  // ==========================================================================
  // DELETE /api/repos/:name —— 移除仓库条目(不动 codebase/)
  // ==========================================================================
  app.delete<{ Params: { name: string }; Querystring: { force?: string } }>(
    '/api/repos/:name',
    async (req, reply) => {
      const { name } = req.params
      const force = req.query.force === 'true'

      // 1. 存在性
      const existing = await workspace.findRepoByName(name)
      if (!existing) {
        return reply.code(404).send({
          error: 'E_REPO_NOT_FOUND',
          message: `仓库 ${name} 不存在`,
        })
      }

      // 2. 检查被多少需求使用(.pending-<name> 视作克隆中,不计入 usage)
      const usage = await workspace.findCodebaseUsage(name)
      if (usage.length > 0 && !force) {
        return reply.code(409).send({
          error: 'E_REPO_IN_USE',
          message: `该仓库被 ${usage.length} 个需求使用`,
          usage,
        })
      }

      // 3. 写盘
      try {
        await workspace.removeRepo(name)
      } catch (err) {
        if (err instanceof RegistryNotFoundError) {
          // 并发删除 race
          return reply.code(404).send({
            error: err.code,
            message: err.message,
          })
        }
        if (err instanceof RegistryWriteError) {
          req.log.error({ err, name }, 'removeRepo write failed')
          return reply.code(500).send({
            error: 'E_REGISTRY_WRITE_FAILED',
            message: err.message,
          })
        }
        throw err
      }

      return reply.code(204).send()
    },
  )

  // ==========================================================================
  // GET /api/repos/:name/usage —— issue 07 / ADR-0030 D6
  // 「该仓库被哪些需求使用」派生端点,供 /repos 列表页 + /repos/[name] 详情页使用。
  //
  // 设计:
  // - 注册表无此 name → 404 E_REPO_NOT_FOUND(前端需要明确知道,避免静默返空)
  // - 有但 usage=[] → 200 {repoName, usage: []}(列表页要显示「0 个需求使用」)
  // - .pending-<name> 标记存在 → 跳过该 req(与 DELETE 语义一致,克隆中不算关联)
  // ==========================================================================
  app.get<{ Params: { name: string } }>(
    '/api/repos/:name/usage',
    async (req, reply) => {
      const { name } = req.params

      const existing = await workspace.findRepoByName(name)
      if (!existing) {
        return reply.code(404).send({
          error: 'E_REPO_NOT_FOUND',
          message: `仓库 ${name} 不存在`,
        })
      }

      const usage = await workspace.findCodebaseUsage(name)
      const body = RepoUsageResponseSchema.parse({ repoName: name, usage })
      return reply.code(200).send(body)
    },
  )
}