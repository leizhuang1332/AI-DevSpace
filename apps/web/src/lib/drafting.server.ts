/**
 * DRAFTING 工位 — server-only 数据层(issue: zone-data-fidelity-fixes · 01)
 *
 * 设计动机(对齐 `analyzing.server.ts` 的 .server.ts 命名约定):
 *
 * `drafting.ts` 同时被两类消费者引用:
 * 1. server component(RSC,例如 `app/(workspace)/requirements/[id]/[zone]/page.tsx`)
 *    — 通过 `getDraftingData(reqId)` 拉 server 端数据
 * 2. client component(`'use client'`,例如 `components/drafting-zone.tsx`)
 *    — 调用 `getDraftingData` 拉初始 props(SSR 阶段)
 *
 * 当两类代码都从同一个文件 `import` 时,如果未来 `getDraftingData` 引入 `node:fs`
 * IO,Next.js/webpack 会把整段 IO 拉进客户端 bundle 并抛:
 *   `UnhandledSchemeError: Reading from "node:fs" is not handled by plugins`
 *
 * 修复方案(本文件):
 *
 * - `drafting.ts` 保留原有 mock 形态(`getDraftingData(reqId)` → REFUND_DRAFTING /
 *   emptyDrafting),client-safe,组件测试继续依赖,本文件**不删不改**它
 * - 本文件专存 server-only IO:`getDraftingDataFromFs(reqId)` 走真实文件系统
 *   读 `requirements/{id}/requirement.md`,作为 RSC 入口的**新**调用
 * - 仅被 RSC(`page.tsx`)和 vitest(同进程 Node.js)引用;client component 不应
 *   import 本文件(避免 fs IO 漏入 client bundle)
 * - 命名约定遵循 Next.js 的 `.server.ts`(项目当前未安装 `server-only` npm 包;
 *   若以后装了,把 `import 'server-only'` 放文件顶部即可获得编译期越界保护)
 *
 * 数据契约:
 * - `req-001` → 命中硬编码 REFUND_DRAFTING(向后兼容;即使目录里没有
 *   `requirement.md` 也能拿到完整样例数据)
 * - 其他 reqId → 读 `requirement.md`:
 *   - 文件存在且内容字节数 > 10(对齐后端 `RequirementService.DRAFTING_CONTENT_MIN_BYTES`,
 *     跟 `deriveStatus` 阈值一致)→ 构造非空 `DraftingData`(`prdMarkdown` = 文件内容,
 *     `title` 从 `meta.yaml.title` 提取)
 *   - 否则 → `emptyDrafting(reqId)`(空草稿态;组件侧生成骨架)
 *
 * 路径解析(对照 PRD D-6 · ticket 05):
 * - 默认 `<requirementsRoot>` 由 `resolveRequirementsRoot()` 解析
 *   (config.yaml.workspaceRoot → AIDEVSPACE_HOME → cwd + ../.. 三层 fallback)
 * - 与后端 `RequirementService.root` 在 dev/production 都对齐到
 *   `~/.aidevspace`(dev)或 `AIDEVSPACE_HOME`(production),前端 loader 不再
 *   硬编码 `cwd + ../../requirements`
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  emptyDrafting,
  getDraftingData,
  type DraftingData,
  type DraftingRepo,
} from './drafting'
import { resolveRequirementsRoot } from './requirements-root.server'
import { parseFlatMap, readYamlFileOrNull } from './yaml.server'

// ---------------------------------------------------------------------------
// 后端 `deriveStatus` 阈值(对齐后端 `RequirementService.DRAFTING_CONTENT_MIN_BYTES`,
// 见 apps/agent/src/services/RequirementService.ts:422)
// 文件字节数 ≤ 该阈值 → 视为空草稿,走 emptyDrafting;否则取文件内容构造
// 非空 DraftingData。
//
// 命名:`PRD_EMPTY_THRESHOLD_BYTES`(而不是 PRD_MIN_BYTES)反映这里的语义是
// "低于/等于该阈值 = 空草稿",与 `<=` 比较一致;避免下次有人误以为该常量是
// "非空所需的最小字节"而误用 `>` 比较。
// ---------------------------------------------------------------------------
const PRD_EMPTY_THRESHOLD_BYTES = 10

/** req-001 命中硬编码 REFUND_DRAFTING(向后兼容,见本文件 header) */
const HARD_CODED_REQ_ID = 'req-001'

/**
 * `getDraftingDataFromFs` options —— 主要为测试方便注入 fs 路径 + config 路径。
 *
 * - `requirementsRoot`:覆盖默认的 requirements 根。生产部署路径不一致时,
 *   后续 ticket 通过 AIDEVSPACE_ROOT env 或调用方注入解决(本期不动)。
 *   测试也用该字段指向 fixture 目录。
 * - `configPath`:覆盖 `resolveRequirementsRoot` 用的 config.yaml 路径,
 *   主要为测试方便注入 fixture config(避免依赖 `~/.aidevspace/config.yaml`)。
 */
export interface GetDraftingDataFromFsOptions {
  requirementsRoot?: string
  configPath?: string
}

/**
 * 默认 requirements 根:走 `resolveRequirementsRoot()` 三层 fallback
 * (config.yaml.workspaceRoot → AIDEVSPACE_HOME → cwd + ../..),
 * 与后端 `RequirementService.root` 完全对齐(见 PRD D-6)
 */
function defaultRequirementsRoot(): string {
  return resolveRequirementsRoot()
}

/**
 * 拉取 DRAFTING 工位数据(SSR 期 mock —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(`req-001`)→ REFUND_DRAFTING 样例数据(空 PRD 字段已存,组件不填充)
 * - 其他 id:
 *   - `<requirementsRoot>/<reqId>/requirement.md` 存在 + 字节数 > 10 →
 *     构造非空 `DraftingData`(`prdMarkdown` 取文件内容,`title` 从
 *     同目录 `meta.yaml` 的 `title` 字段取)
 *   - 否则 → `emptyDrafting(reqId)`(组件侧 detect 后调用 `generatePrdSkeleton`)
 *
 * 与原 `getDraftingData(reqId)` 的差异:
 * - 原版对所有非 `req-001` id 直接 `emptyDrafting`,丢掉了真实需求数据;
 *   本版读 fs,新建需求只要 `requirement.md` 超过阈值就拿到非空数据
 * - 本版异步语义保持(签名 `Promise<DraftingData>`)→ 调用方切换无感
 */
export async function getDraftingDataFromFs(
  requirementId: string,
  options: GetDraftingDataFromFsOptions = {},
): Promise<DraftingData> {
  // 1) `req-001` 走硬编码 mock(向后兼容;即便目录里没有 requirement.md)
  // 通过调 `getDraftingData('req-001')` 复用现有 mock 装配,无需把
  // REFUND_DRAFTING 私有常量提到 client-safe 模块外(向 ticket 的"不删
  // 不改 drafting.ts"约束靠拢)。
  if (requirementId === HARD_CODED_REQ_ID) {
    return getDraftingData(HARD_CODED_REQ_ID)
  }

  const root =
    options.requirementsRoot ??
    (options.configPath
      ? resolveRequirementsRoot({ configPath: options.configPath })
      : defaultRequirementsRoot())
  // 路径:`<root>/requirements/<reqId>/requirement.md`(对齐 ADR-0002 文件系统结构)
  const file = resolve(root, 'requirements', requirementId, 'requirement.md')
  const metaFile = resolve(root, 'requirements', requirementId, 'meta.yaml')

  // 2) 文件不存在 / 读取失败 → emptyDrafting(容错)
  let content: string | null = null
  if (existsSync(file)) {
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      content = null
    }
  }

// 3) 字节数 ≤ 阈值 → emptyDrafting(对齐后端 `deriveStatus`)
  //    注意:这里**不**读 meta.yaml —— 空态语义不应有 title 字段(对齐
  //    `emptyDrafting` 默认行为)
  //    但 `repos` 仍要派生成真实仓库池(issue 06 / ADR-0016 D1):空草稿态的
  //    RepoBar 也要展示用户本机真实仓库,而不是 GLOBAL_REPO_POOL 写死 mock。
  if (content === null || Buffer.byteLength(content, 'utf8') <= PRD_EMPTY_THRESHOLD_BYTES) {
    // 空草稿态仍要派生:repos(避免 mock)+ lockedBranchName(用户可能已经
    // attach 过,只是 PRD 还在写)—— 不读 title(空态语义不应有 title)
    return {
      ...emptyDrafting(requirementId),
      repos: readWorkspaceRepoPool(root),
      lockedBranchName: readMetaBranchName(metaFile),
    }
  }

// 4) 构造非空 DraftingData:
  // - prdMarkdown = 文件内容
  // - title = meta.yaml 的 `title` 字段(读不到 → '',向后兼容)
  // - selectedRepoIds = 派生 `<reqDir>/repos/` 子目录列表(issue 06 / ticket 02
  //   落盘的 worktree 目录),对齐 backend `RequirementService.deriveRepos` 的语义。
  //   每个子目录 dirname → `repo-<dirname>` 形式的 id(对齐 issue 06 引入的
  //   `id = 'repo-' + dirname` 契约)。
  // - repos = workspace 级全局仓库池(issue 06 / ADR-0016 D1-D3):
  //   派生 `<root>/repos/` 子目录列表(对齐 backend `apps/agent/src/routes/repos.ts`
  //   的 readRepoPool 逻辑),不走 GLOBAL_REPO_POOL 写死 mock。
  //   走 fs 直读而非 HTTP `fetchRepoPool` —— SSR 期不绕 HTTP 减少开销 + 不依赖 cookie。
  // - lockedBranchName = 派生 meta.yaml.branchName(issue 06 ticket 06 SSR 持久化):
  //   首次 attach 时后端把 branchName 写入 meta.yaml;SSR 读它让客户端任何重挂载
  //   (F5 / 路由切换 / 父组件 unmount)都能恢复"统一分支名已锁定"语义。
  // - 顶部 toolbar.crumb = 单元素面包屑,反映"我在写这个 req 的草稿"
  // - 其他字段(auxFiles / skills / statusText / autosaveIntervalMs / lastSavedAt)
  //   沿用 emptyDrafting 行为(空 auxFiles / 空 statusText)
  const title = readMetaTitle(metaFile)
  const selectedRepoIds = readAttachedRepoIds(
    resolve(root, 'requirements', requirementId),
  )
  const repos = readWorkspaceRepoPool(root)
  const lockedBranchName = readMetaBranchName(metaFile)
  return {
    ...emptyDrafting(requirementId),
    prdMarkdown: content,
    title,
    selectedRepoIds,
    repos,
    lockedBranchName,
    toolbar: {
      crumb: [
        { label: requirementId },
        { label: '/' },
        { label: '草稿', current: true },
      ],
      statusText: '',
    },
    empty: false,
  }
}

/**
 * 派生 attached repo id 列表(issue 06 / ticket 02 落盘 worktree → SSR 持久化)
 *
 * 数据源:`<reqDir>/repos/` 子目录列表 —— ticket 02 attach 成功后真实
 * worktree 目录位于此(对齐 backend `RequirementService.deriveRepos`)。
 *
 * 映射:`dirname → 'repo-' + dirname`(对齐 issue 06 引入的 id 契约,
 * 也是 POST /api/repos 响应里 `id` 的形态)。
 *
 * 容错:
 * - `<reqDir>/repos/` 不存在(全新需求未关联任何 repo)→ `[]`(合法空态,
 *   触发 banner + RepoBar N=0 空态)
 * - readdir 抛错 → `[]`,不阻塞 SSR(决策 30 容错)
 *
 * 过滤:`.` 前缀的子目录忽略 —— 与后端 `deriveRepos` 行为完全一致
 * (`RequirementService.ts:738` 注释"过滤 . 开头")。
 */
function readAttachedRepoIds(reqDir: string): string[] {
  const reposDir = resolve(reqDir, 'repos')
  if (!existsSync(reposDir)) return []
  try {
    return readdirSync(reposDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => `repo-${d.name}`)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * 读 `<reqDir>/meta.yaml` 的 `title` 字段。
 *
 * - 文件不存在 / 解析失败 / 无 `title` 字段 → ''(向后兼容,沿用 `emptyDrafting.title`)
 * - title 是字符串 → 原样返回(去除引号由 `parseFlatMap` 处理)
 *
 * 实现要点:
 * - 只在 `requirement.md` 已被判为非空后调用(`getDraftingDataFromFs` 主体保证);
 *   空态时**不**读 meta.yaml —— 空态语义不应有 title
 * - 故意不报错:meta.yaml 缺失时降级到 `''`,避免脏数据毁非空判定
 */
function readMetaTitle(metaFile: string): string {
  const raw = readYamlFileOrNull(metaFile)
  if (raw === null) return ''
  const map = parseFlatMap(raw, 'title')
  if (!map) return ''
  const title = map.title
  return typeof title === 'string' ? title : ''
}

/**
 * 读 `<reqDir>/meta.yaml` 的 `branchName` 字段(issue 06 ticket 06 SSR 持久化)
 *
 * - 文件不存在 / 解析失败 / 无 `branchName` 字段 → `undefined`(语义:未锁定)
 * - branchName 是字符串 → 原样返回(对齐后端 `RequirementService.attachRepos`
 *   写入的形态)
 *
 * 不报错,与 readMetaTitle 同款容错策略 —— meta.yaml 缺失时降级,
 * 不阻塞 SSR。
 */
function readMetaBranchName(metaFile: string): string | undefined {
  const raw = readYamlFileOrNull(metaFile)
  if (raw === null) return undefined
  const map = parseFlatMap(raw, 'branchName')
  if (!map) return undefined
  const branchName = map.branchName
  return typeof branchName === 'string' && branchName.length > 0
    ? branchName
    : undefined
}

/**
 * 派生 workspace 级全局仓库池(issue 06 / ADR-0016 D1-D3)
 *
 * 数据源:`<root>/repos/` 子目录列表 —— 与 backend
 * `apps/agent/src/routes/repos.ts` 的 `readRepoPool` 逻辑完全一致:
 * - 走 fs 直读,**不**经 HTTP `fetchRepoPool`(SSR 期节省 cookie / token 复杂度)
 * - `dirname → 'repo-' + dirname` id 形态(对齐 issue 06 / ADR-0016 D3)
 * - **不**校验 `.git/` 存在(决策 75 / ADR-0016 D3)
 * - 字典序排序(展示稳定)
 *
 * 容错:
 * - `<root>/repos/` 不存在(全新安装)→ `[]`(合法空态,前端走"暂无可选仓库")
 * - readdir 抛错 → `[]`,不阻塞 SSR(决策 30 容错)
 */
function readWorkspaceRepoPool(workspaceRoot: string): DraftingRepo[] {
  const reposDir = resolve(workspaceRoot, 'repos')
  if (!existsSync(reposDir)) return []
  try {
    return readdirSync(reposDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ id: `repo-${d.name}`, name: d.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}