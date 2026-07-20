/**
 * 仓库池契约(.scratch/new-requirement-modal/issues/06-attach-repos-real-pool.md)
 *
 * Agent `GET /api/repos` 端点的响应 schema —— 跨 web/agent 共享。
 *
 * 字段最小集(决策 75 / ADR-0016 D3):
 * - `id`:仓库的稳定标识符,形如 `repo-<dirname>`(沿用既有 GLOBAL_REPO_POOL 的 slug 命名)
 * - `name`:仓库目录名(展示用,UI 直接渲染在 chip / checkbox 列表上)
 *
 * **不**返回默认分支 / 语言 / SSH URL 等元数据 —— 留给后续
 * `~/.aidevspace/repos/<name>/.aidevspace/repo.yaml` 提案(ADR-0016 D3 显式排除)。
 * **不**校验 `.git/` 存在 —— 误 mkdir 是用户自己的责任(决策 75)。
 *
 * 全新安装(目录不存在)→ 仍返 `{repos: []}` 200,前端走"暂无可选仓库"分支
 * (决策 78 / ADR-0016 D6)。
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// 单条 repo 形态
// ---------------------------------------------------------------------------

/**
 * 仓库池中的一项 —— 由 Agent 读 `~/.aidevspace/repos/` 子目录派生。
 *
 * 与 web 端 `DraftingRepo` 形态一致(id + name 最小集),便于直接复用前端 chip / checkbox 渲染。
 */
export const RepoPoolEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})
export type RepoPoolEntry = z.infer<typeof RepoPoolEntrySchema>

// ---------------------------------------------------------------------------
// 顶层响应
// ---------------------------------------------------------------------------

/**
 * `GET /api/repos` 响应 schema。
 *
 * - `repos` 可为空数组(全新安装 / 目录存在但无子目录)
 * - 不带分页 / 不带总数 —— 仓库池通常 < 100,扁平返回最简单
 *   (决策 74:每次实时 readdir,无缓存)
 */
export const ReposResponseSchema = z.object({
  repos: z.array(RepoPoolEntrySchema),
})
export type ReposResponse = z.infer<typeof ReposResponseSchema>