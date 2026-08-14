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