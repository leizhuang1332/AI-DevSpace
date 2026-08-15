/**
 * 仓库注册表契约(.scratch/repo-registry-clone/issues/01-shared-schema.md 1.2)
 *
 * Agent `GET /api/repos` 端点的响应 schema —— 跨 web/agent 共享。
 * 真相源 = `~/.aidevspace/repos.yaml`(独立单文件),与 ADR-0016 时代的物理目录 readdir 决裂。
 *
 * 字段最小集(决策 105):
 * - `name`:全局唯一标识,文件名安全(也是 `requirements/<req-id>/codebase/<name>/` 目录名)
 * - `gitUrl`:可被 `git ls-remote --heads` 验证可达的 Git 地址
 * - `description`:可空,迁移期由旧 `repos/<name>/` 读不到的元数据补空
 *
 * **不**返回默认分支 / 语言 / SSH URL 等元数据 —— clone 用 remote HEAD,不读 base;
 * 元数据留给后续 yaml 扩展提案(ADR-0030 D1 显式排除)。
 *
 * **不**校验 `id` 字段 —— name 即标识,删除既有 `repo-<dirname>` slug 派生链;
 * 但 schema 必须能吞下历史 yaml 里残留的 `id` / `defaultBranch` 字段(FR-1.2 多余字段忽略)。
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// 单条 repo 形态
// ---------------------------------------------------------------------------

/**
 * 仓库注册表中的一项 —— 由 Agent 读 `~/.aidevspace/repos.yaml` 派生。
 *
 * 与 web 端 `DraftingRepo` 形态对齐(name + gitUrl + description),便于前端 chip / 列表渲染。
 *
 * Zod 行为:多余字段(id / defaultBranch / ...)不报错但忽略,FR-1.2「平滑吃下历史 yaml」。
 */
export const RepoRegistryEntrySchema = z.object({
  name: z.string().min(1).max(100),
  gitUrl: z.string().min(1).max(500),
  description: z.string().max(500),
})
export type RepoRegistryEntry = z.infer<typeof RepoRegistryEntrySchema>

// ---------------------------------------------------------------------------
// 顶层 yaml 文件结构
// ---------------------------------------------------------------------------

/**
 * `~/.aidevspace/repos.yaml` 顶层结构 —— `version: 1` 用于未来 schema 演进。
 *
 * 与 GET 响应分离:yoga 文件本体 = `version + repos[]`,HTTP 响应 = `repos[]`
 * (响应不带 version,因为 GET 调用方不关心 yaml 内部版本号)。
 */
export const RepoRegistrySchema = z.object({
  version: z.literal(1),
  repos: z.array(RepoRegistryEntrySchema),
})
export type RepoRegistry = z.infer<typeof RepoRegistrySchema>

// ---------------------------------------------------------------------------
// 顶层 HTTP 响应
// ---------------------------------------------------------------------------

/**
 * `GET /api/repos` 响应 schema。
 *
 * - `repos` 可为空数组(yaml 不存在 / `repos: []`)
 * - 不带分页 / 不带总数 —— 仓库数通常 < 100,扁平返回最简单(决策 74 仍延续:每次实时读 yaml)
 */
export const RepoRegistryResponseSchema = z.object({
  repos: z.array(RepoRegistryEntrySchema),
})
export type RepoRegistryResponse = z.infer<typeof RepoRegistryResponseSchema>

// ---------------------------------------------------------------------------
// Route-level request schemas —— issue 02-repos-route-crud.md 2.2 / 2.3
// ---------------------------------------------------------------------------

/**
 * POST /api/repos body —— 创建新仓库条目。
 *
 * 必跑 `git ls-remote --heads <gitUrl>` 验证可达 + 凭据可用(决策 Q5),
 * 失败 → 401 / 502 / 408,不写 yaml。
 *
 * description 可空(issue 01-shared-schema 决策:迁移期允许空串)。
 */
export const PostRepoRegistryRequestSchema = z.object({
  name: z.string().min(1).max(100),
  gitUrl: z.string().min(1).max(500),
  description: z.string().max(500),
})
export type PostRepoRegistryRequest = z.infer<typeof PostRepoRegistryRequestSchema>

/**
 * PUT /api/repos/:name body —— 改 gitUrl / description(不允许改 name,name 是标识)。
 *
 * 两个字段都可省略;改了 gitUrl 时 route 必跑 ls-remote 重新验证(Q5 + 决策 111),
 * 不改 gitUrl 不跑(原 description 不动 → 跳过)。
 */
export const PutRepoRegistryRequestSchema = z
  .object({
    gitUrl: z.string().min(1).max(500).optional(),
    description: z.string().max(500).optional(),
  })
  .refine(
    (v) => v.gitUrl !== undefined || v.description !== undefined,
    { message: 'gitUrl / description 至少传一个' },
  )
export type PutRepoRegistryRequest = z.infer<typeof PutRepoRegistryRequestSchema>

// ---------------------------------------------------------------------------
// Service-level contract —— issue 02 / 04 (workspace service 暴露的形态)
// ---------------------------------------------------------------------------

/**
 * 单条 codebase 使用记录 —— DELETE /api/repos/:name 二次确认 + 列表页「被 N 个需求使用」派生。
 *
 * `requirementId` 是 `~/.aidevspace/requirements/<id>/` 目录名;`branch` 是
 * 用户当初关联时起的统一分支名(从 meta.yaml 派生);`codebasePath` 是
 * `requirements/<id>/codebase/<repo-name>/` 的真实路径,前端用来在 UI 显示本地路径。
 */
export const CodebaseUsageEntrySchema = z.object({
  requirementId: z.string().min(1),
  branch: z.string(), // 读不到 meta.yaml 时返 ''(空串也合法)
  codebasePath: z.string().min(1),
})
export type CodebaseUsageEntry = z.infer<typeof CodebaseUsageEntrySchema>

/**
 * `GET /api/repos/:name/usage` 响应 schema —— issue 07 列表 / 详情页派生「被 N 个需求使用」。
 *
 * - `repoName` 回显,便于前端在多仓库并发请求时按 name 对号入座
 * - `usage` 可为空数组(无人使用 / 注册表有但未关联)
 *
 * 复用 CodebaseUsageEntrySchema,与 DELETE /api/repos/:name 的 409 响应 body
 * (`usage` 字段)形态一致,前端可共用类型。
 */
export const RepoUsageResponseSchema = z.object({
  repoName: z.string().min(1),
  usage: z.array(CodebaseUsageEntrySchema),
})
export type RepoUsageResponse = z.infer<typeof RepoUsageResponseSchema>