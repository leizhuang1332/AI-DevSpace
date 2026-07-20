/**
 * GET /api/repos —— 仓库池扫描(issue 06 / ADR-0016)
 *
 * 数据源:`<workspaceRoot>/repos/` 物理目录的**子目录列表**(决策 73)。
 *
 * 行为(对照 ADR-0016 D2-D6):
 * - 每次请求实时 readdir,**无**缓存(决策 74)
 * - 子目录名 → `{id: 'repo-<dirname>', name: '<dirname>'}`(决策 α 沿用既有 slug)
 * - **不**校验 `.git/` 存在 —— 误 mkdir 是用户自己的责任(决策 75)
 * - 目录不存在 → 返 `{repos: []}` 200,**不** 404(决策 78)
 * - 目录存在但无子目录 → 返 `{repos: []}` 200
 * - 读取失败(权限等) → 500 + `{error: 'E_REPO_DIR_READ_FAILED'}`
 *
 * 命名空间(决策 77):workspace 顶层资源,不复用 `/api/workspace/repos`
 * (workspace 命名空间当前未启用)。
 *
 * 历史背景(决策 / issue tracker):
 * - issue 06 ticket:本期实装 GET /api/repos(轻量端点,无 service 依赖)
 * - 与 `POST /api/requirement/:id/repos`(issue 02 · `requirement.ts`)
 *   形成"全局池 vs 需求关联"对照:本端点**只读**,不创建任何状态。
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import {
  ReposResponseSchema,
  type RepoPoolEntry,
  type ReposResponse,
} from '@ai-devspace/shared'

export interface ReposRouteDeps {
  /** Workspace 根目录;repos 目录位于 `<root>/repos/` */
  workspaceRoot: string
}

/** 单点真相:`<workspaceRoot>/repos/` 绝对路径。route + 纯函数共享。 */
export function reposDirFor(workspaceRoot: string): string {
  return join(workspaceRoot, 'repos')
}

/**
 * 纯函数:把 `repos/` 子目录列表转为 `RepoPoolEntry[]`。
 *
 * 抽出便于单测,不必启动 Fastify。
 *
 * - dirent.name → `{id: 'repo-' + dirent.name, name: dirent.name}`
 * - **不**校验 `.git/`(决策 75)
 * - 排序:按 `name` 字典序,便于前端展示稳定
 */
export function readRepoPool(workspaceRoot: string): RepoPoolEntry[] {
  const entries = readdirSync(reposDirFor(workspaceRoot), { withFileTypes: true })
  return entries
    .filter((d) => d.isDirectory())
    .map((d) => ({
      id: `repo-${d.name}`,
      name: d.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function reposRoutes(
  app: FastifyInstance,
  deps: ReposRouteDeps,
): Promise<void> {
  app.get('/api/repos', async (_req, reply) => {
    let entries: RepoPoolEntry[]
    try {
      entries = readRepoPool(deps.workspaceRoot)
    } catch (err) {
      // readdirSync 在 ENOENT(目录不存在)也会抛;与权限 / IO 错一并
      // 区分对待:ENOENT → 返空(决策 78);其余 → 500
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        const body: ReposResponse = { repos: [] }
        return reply.code(200).send(body)
      }
      _req.log.error(
        { err, dir: reposDirFor(deps.workspaceRoot) },
        'read repo pool failed',
      )
      return reply.code(500).send({
        error: 'E_REPO_DIR_READ_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }

    const body = ReposResponseSchema.parse({ repos: entries })
    return reply.code(200).send(body)
  })
}