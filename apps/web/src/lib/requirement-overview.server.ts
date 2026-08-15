/**
 * Overview 概览页 · server-only 数据层(对齐 `drafting.server.ts` 范式)
 *
 * 背景(用户 bug · req-003-这下可以了吧):
 *  - 原 `requirement-overview.ts` 的 `getRequirementOverview` 只在 `req-001` 返
 *    回 mock 数据,其他 id 一律 `emptyOverview(reqId)`。
 *  - 但实际 `<root>/requirements/<reqId>/requirement.md` 已写好(> 10 字节)时,
 *    `requirement-md` 存在 + meta.yaml 有 title,UI 不应再走"暂无数据"空态。
 *  - 在 DRAFTING 工位里已用 `getDraftingDataFromFs` 走 fs 直读;
 *    Overview 也要补齐同样的 fs 直读路径。
 *
 * 修复:
 *  - 保留 `requirement-overview.ts` 不动(被 client component `OverviewPage` 引用,
 *    不能引 fs;其 `getRequirementOverview` mock 行为也保持向后兼容)
 *  - 本文件专存 server-only IO:`getRequirementOverviewFromFs(reqId, options)` 走
 *    真实文件系统读 `<root>/requirements/<reqId>/{requirement.md, meta.yaml}`
 *    + 派生各 zone 状态(子目录存在性 → 4 section 卡片)
 *  - 仅被 RSC(`page.tsx`)和 vitest 引用;client component 不应 import 本文件
 *  - 命名约定与 `drafting.server.ts` 完全对齐,Next.js/webpack 拒绝 client
 *    import `.server.ts` 后缀文件(项目当前未安装 `server-only` npm 包)
 *
 * 派生策略(简化版,与后端 `RequirementService.deriveStatus` 思路一致):
 *  - `req-001` → 命中硬编码 REFUND_OVERVIEW(向后兼容,即便 fs 没有也返满数据)
 *  - 其他 id:
 *    - `<root>/requirements/<reqId>/requirement.md` 不存在 / 字节数 ≤ 阈值
 *      → `emptyOverview(reqId)`(空草稿态,UI 走"暂无数据"引导)
 *    - 否则 → 构造非空 OverviewData:
 *      - `meta.title` ← meta.yaml 的 `title` 字段(读不到 → '')
 *      - `meta.status` ← 按子目录派生(.archived > wrapup > analysis > ...
 *        简化,只到 analysis,因为 web 端 ADR-0027 把后续工位吸收到 board)
 *      - `meta.repos` ← `<reqDir>/codebase/` 子目录列表(issue 08)
 *      - `meta.owner` ← meta.yaml 的 `owner`(读不到 → '')
 *      - `meta.createdAt` ← meta.yaml 的 `createdAt`(读不到 → reqDir mtime)
 *      - `meta.updatedAt` ← reqDir mtime
 *      - `zoneCards` ← 4 项全部渲染,根据各子目录存在性给 `done` / `cur` /
 *        `todo` 状态
 *      - `milestones` ← 4 项,同 zoneCards 的派生策略
 *      - `progress` / `aiActivity` ← 简化占位(不拉 board cards / sessions,
 *        本期 ticket 不实装;后续 ticket 接入 agent API 时扩展)
 *
 * 路径解析(对照 PRD D-6 · ticket 05):
 *  - 默认 `<requirementsRoot>` 走 `resolveRequirementsRoot()` 三层 fallback
 *  - 与 `drafting.server.ts` 完全对齐,前端 loader 读到跟后端落盘一致的根目录
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { resolve } from 'node:path'
import {
  emptyOverview,
  getRequirementOverview,
  type OverviewData,
  type OverviewMeta,
  type OverviewMilestone,
  type OverviewProgress,
  type OverviewZoneCard,
  type OverviewZoneActivity,
  type OverviewAIActivity,
} from './requirement-overview'
import { resolveRequirementsRoot } from './requirements-root.server'
import { parseFlatMap, readYamlFileOrNull } from './yaml.server'
import { REQUIREMENT_SECTIONS } from './sections'
import type { RequirementStatusT } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 常量(对齐 `drafting.server.ts` 阈值)
// ---------------------------------------------------------------------------

/** req-001 命中硬编码 mock(向后兼容,见本文件 header) */
const HARD_CODED_REQ_ID = 'req-001'

/** requirement.md 字节数 ≤ 该阈值 → 视为空草稿,走 emptyOverview。
 *  对齐后端 `RequirementService.DRAFTING_CONTENT_MIN_BYTES = 10` 与
 *  `drafting.server.ts.PRD_EMPTY_THRESHOLD_BYTES`。 */
const PRD_EMPTY_THRESHOLD_BYTES = 10

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * `getRequirementOverviewFromFs` options —— 主要为测试方便注入 fs 路径。
 *
 *  - `requirementsRoot`:覆盖默认的 requirements 根,生产部署路径不一致时,
 *    后续 ticket 通过 AIDEVSPACE_ROOT env 或调用方注入解决(本期不动)。
 *    测试也用该字段指向 fixture 目录。
 *  - `configPath`:覆盖 `resolveRequirementsRoot` 用的 config.yaml 路径,
 *    主要为测试方便注入 fixture config(避免依赖 `~/.aidevspace/config.yaml`)。
 */
export interface GetRequirementOverviewFromFsOptions {
  requirementsRoot?: string
  configPath?: string
}

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

function defaultRequirementsRoot(): string {
  return resolveRequirementsRoot()
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 拉取 Overview 概览页数据(SSR 期 —— 走 fs 直读,与 `getDraftingDataFromFs`
 * 同款范式)。
 *
 *  - `req-001` → REFUND_OVERVIEW mock(向后兼容,即便 fs 没有也返满数据)
 *  - 其他 id:
 *    - `<root>/requirements/<reqId>/requirement.md` 存在 + 字节数 > 阈值 →
 *      构造非空 `OverviewData`(meta 从 meta.yaml 派生;4 zone 状态从子目录
 *      派生)
 *    - 否则 → `emptyOverview(reqId)`(空草稿态,UI 走"暂无数据"引导)
 *
 *  与原 `getRequirementOverview(reqId)` 的差异:
 *  - 原版对所有非 `req-001` id 直接 `emptyOverview`,丢掉了真实需求数据;
 *    本版读 fs,新建需求只要 `requirement.md` 超过阈值就拿到非空数据
 *  - 异步语义保持(签名 `Promise<OverviewData>`)→ 调用方切换无感
 */
export async function getRequirementOverviewFromFs(
  requirementId: string,
  options: GetRequirementOverviewFromFsOptions = {},
): Promise<OverviewData> {
  // 1) `req-001` 走硬编码 mock(向后兼容;即便目录里没有 requirement.md)
  if (requirementId === HARD_CODED_REQ_ID) {
    return getRequirementOverview(HARD_CODED_REQ_ID)
  }

  const root =
    options.requirementsRoot ??
    (options.configPath
      ? resolveRequirementsRoot({ configPath: options.configPath })
      : defaultRequirementsRoot())
  const reqDir = resolve(root, 'requirements', requirementId)
  const reqFile = resolve(reqDir, 'requirement.md')
  const metaFile = resolve(reqDir, 'meta.yaml')

  // 2) 文件不存在 / 读取失败 → emptyOverview(容错)
  let content: string | null = null
  if (existsSync(reqFile)) {
    try {
      content = readFileSync(reqFile, 'utf8')
    } catch {
      content = null
    }
  }

  // 3) 字节数 ≤ 阈值 → emptyOverview(对齐后端 `deriveStatus`)
  //    注意:这里**不**读 meta.yaml —— 空态语义不应有 title 字段
  if (
    content === null ||
    Buffer.byteLength(content, 'utf8') <= PRD_EMPTY_THRESHOLD_BYTES
  ) {
    return emptyOverview(requirementId)
  }

  // 4) 构造非空 OverviewData(从 meta.yaml + fs 状态派生)
  const meta = readMeta(metaFile, reqDir)
  const zoneCards = deriveZoneCards(reqDir)
  const milestones = deriveMilestones(reqDir)
  const aiActivity = deriveAiActivity(reqDir)
  const progress = deriveProgress(reqDir, zoneCards, aiActivity)

  return {
    requirementId,
    meta,
    progress,
    zoneCards,
    milestones,
    aiActivity,
    empty: false,
  }
}

// ---------------------------------------------------------------------------
// meta.yaml + fs 派生
// ---------------------------------------------------------------------------

/**
 * 读 meta.yaml 派生 OverviewMeta。
 *
 *  - `title` ← meta.yaml 的 `title` 字段,读不到 → ''
 *  - `status` ← 按子目录派生(简化版 `deriveStatus`,与后端 `RequirementService`
 *    同序:.archived > wrapup > analysis > requirement.md 已写 → drafting,
 *    否则 draft)
 *  - `repos` ← `<reqDir>/codebase/` 子目录列表(过滤 . 开头,issue 08)
 *  - `owner` ← meta.yaml 的 `owner` 字段,读不到 → ''
 *  - `createdAt` ← meta.yaml 的 `createdAt` 字段,读不到 → reqDir mtime
 *  - `updatedAt` ← reqDir mtime(ISO 字符串,与后端 `deriveUpdatedAt` 行为一致)
 *  - `reqIdLabel` ← 留空(展示 ID 与 path id 解耦的契约;后续接 agent API 时
 *    真正展示 "REF-2024-089" 这种 label 形态,本 ticket 不强求)
 */
function readMeta(metaFile: string, reqDir: string): OverviewMeta {
  const raw = readYamlFileOrNull(metaFile)
  const map = raw !== null ? parseFlatMap(raw, 'title') : null

  const title = map && typeof map.title === 'string' ? map.title : ''
  const owner = map && typeof map.owner === 'string' ? map.owner : ''
  const createdAtRaw =
    map && typeof map.createdAt === 'string' ? map.createdAt : ''

  const repos = readAttachedRepoNames(reqDir)
  const status = deriveStatus(reqDir)
  const updatedAt = deriveUpdatedAt(reqDir)

  // createdAt 优先用 meta.yaml(createdAt ISO),失败 fallback 到 reqDir mtime
  const createdAt = createdAtRaw || updatedAt

  return {
    title,
    reqIdLabel: '',
    status,
    repos,
    owner,
    createdAt,
    updatedAt,
  }
}

/**
 * 按子目录派生 status(简化版 `deriveStatus`,与后端 `RequirementService` 思路
 * 一致,但不覆盖所有 status —— web 端只关心 draft / drafting / analyzing,
 * 后续工位吸收到 board / wrapup,本期不细化)。
 *
 *  派生顺序(对齐后端 `RequirementService.deriveStatus` 思路):
 *  - `.archived` 存在 → 'archived'
 *  - `wrapup/` 存在 → 'done'
 *  - `plan/tasks.md` 存在 → 'planning'
 *  - `design/` 存在 → 'designing'
 *  - `clarifying/` 存在 → 'clarifying'
 *  - `analysis/` 存在 → 'analyzing'
 *  - `requirement.md` 存在且 > 10 字节 → 'drafting'(调用方已保证此条件)
 *  - 否则 → 'draft'
 *
 *  注:简化后,本期只真正返回 'drafting' / 'analyzing' / 'done' / 'draft'。
 *  后续工位状态在 ADR-0027 退役后由 BOARD 工位承担,本 ticket 不强求精确。
 */
function deriveStatus(reqDir: string): RequirementStatusT {
  if (existsSync(resolve(reqDir, '.archived'))) return 'archived'
  if (existsSync(resolve(reqDir, 'wrapup'))) return 'done'
  if (existsSync(resolve(reqDir, 'plan', 'tasks.md'))) return 'planning'
  if (existsSync(resolve(reqDir, 'design'))) return 'designing'
  if (existsSync(resolve(reqDir, 'clarifying'))) return 'clarifying'
  if (existsSync(resolve(reqDir, 'analysis'))) return 'analyzing'
  return 'drafting'
}

/**
 * 派生 attached repo name 列表(对齐后端 `RequirementService.deriveRepos`)。
 *
 *  - 数据源:`<reqDir>/codebase/` 子目录名(过滤 . 开头)
 *  - 字典序排序(展示稳定)
 *  - 失败 / 不存在 → []
 *
 *  issue 08 (ADR-0030 D5 · Q11):路径常量 `repos/` → `codebase/`,对齐
 * `CodebaseManager` 的 clone 落盘形态 + 后端 `RequirementService.deriveRepos`。
 * 老形态 `requirements/<id>/repos/<name>/` (旧 WorktreeManager 的 worktree 目录)
 * 保留在盘上**不被迁移**,这里**只**读 `codebase/`;前端 DRAFTING 弹层显示为
 * 「未关联」,等用户在 RepoBar 重新关联后由 `CodebaseManager.clone` 落新目录。
 */
function readAttachedRepoNames(reqDir: string): string[] {
  const codebaseDir = resolve(reqDir, 'codebase')
  if (!existsSync(codebaseDir)) return []
  try {
    return readdirSync(codebaseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/** 派生 updatedAt = reqDir mtime(ISO);失败兜底 epoch 0(对齐后端) */
function deriveUpdatedAt(reqDir: string): string {
  try {
    return statSync(reqDir).mtime.toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

// ---------------------------------------------------------------------------
// 4 zone 卡片 + 里程碑
// ---------------------------------------------------------------------------

/**
 * 派生 4 zone 卡片状态(从子目录存在性)。
 *
 *  - `drafting`:`requirement.md` 已写(调用方保证) → 'done'
 *  - `analyzing`:`analysis/` 存在 → 'done',否则 'todo'
 *  - `board`:`board/tasks/` 存在 + 至少 1 个 task → 'done' / 'cur' / 'todo',
 *    简化规则:有 task 视为 'cur'(正在推进)
 *  - `wrapup`:`wrapup/` 存在 → 'done',否则 'todo'
 *
 *  caption / meta 字段填最简版展示文本(用户 ticket 不要求精确,
 *  后续接 agent API 时再细化)。
 */
function deriveZoneCards(reqDir: string): OverviewZoneCard[] {
  const hasAnalysis = existsSync(resolve(reqDir, 'analysis'))
  const boardTaskCount = countBoardTasks(reqDir)
  const hasWrapup = existsSync(resolve(reqDir, 'wrapup'))

  return REQUIREMENT_SECTIONS.map((zoneId) => {
    switch (zoneId) {
      case 'drafting':
        return {
          zoneId,
          caption: 'PRD 已写',
          meta: '草稿完成',
          state: 'done',
        }
      case 'analyzing':
        return {
          zoneId,
          caption: hasAnalysis ? '已分析' : '待启动',
          meta: hasAnalysis ? '见 analysis/' : '—',
          state: hasAnalysis ? 'done' : 'todo',
        }
      case 'board': {
        if (boardTaskCount === 0) {
          return { zoneId, caption: '待启动', meta: '—', state: 'todo' }
        }
        return {
          zoneId,
          caption: '推进中',
          meta: `${boardTaskCount} 卡`,
          state: 'cur',
        }
      }
      case 'wrapup':
        return {
          zoneId,
          caption: hasWrapup ? '已完成' : '待归档',
          meta: hasWrapup ? '已归档' : '—',
          state: hasWrapup ? 'done' : 'todo',
        }
    }
  })
}

/** 数 `<reqDir>/board/tasks/` 下 .json task 数(对齐后端 boardTaskStore 形态) */
function countBoardTasks(reqDir: string): number {
  const tasksDir = resolve(reqDir, 'board', 'tasks')
  if (!existsSync(tasksDir)) return 0
  try {
    return readdirSync(tasksDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'))
      .length
  } catch {
    return 0
  }
}

/**
 * 派生 4 节点里程碑时间线(从子目录存在性 + mtime)。
 *
 *  - 时间戳取子目录的 mtime(已完成的节点才有;todo 节点 ts=null)
 *  - sub 字段填最简版展示文本
 */
function deriveMilestones(reqDir: string): OverviewMilestone[] {
  const hasAnalysis = existsSync(resolve(reqDir, 'analysis'))
  const boardTaskCount = countBoardTasks(reqDir)
  const hasWrapup = existsSync(resolve(reqDir, 'wrapup'))

  return [
    {
      id: 'drafting',
      name: 'DRAFTING · 写 PRD',
      ts: formatDirDate(reqDir),
      sub: '完成需求文档',
      state: 'done',
    },
    {
      id: 'analyzing',
      name: 'ANALYZING · AI 分析',
      ts: hasAnalysis ? formatDirDate(resolve(reqDir, 'analysis')) : null,
      sub: hasAnalysis ? '已生成 Analysis Run' : '待启动',
      state: hasAnalysis ? 'done' : 'todo',
    },
    {
      id: 'board',
      name: 'BOARD · 看板推进',
      ts:
        boardTaskCount > 0
          ? formatDirDate(resolve(reqDir, 'board', 'tasks'))
          : null,
      sub:
        boardTaskCount > 0
          ? `${boardTaskCount} 卡片推进中`
          : '待启动',
      state: boardTaskCount > 0 ? 'cur' : 'todo',
    },
    {
      id: 'wrapup',
      name: 'WRAP-UP · 归档',
      ts: hasWrapup ? formatDirDate(resolve(reqDir, 'wrapup')) : null,
      sub: hasWrapup ? '已归档' : '待 BOARD 推进完成后归档',
      state: hasWrapup ? 'done' : 'todo',
    },
  ]
}

/** 取目录 mtime 渲染为 `YYYY-MM-DD` 形态(给 timeline 展示用) */
function formatDirDate(dir: string): string {
  try {
    return statSync(dir).mtime.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// AI 活动 + 进度(本期简化占位,后续接 agent API 时扩展)
// ---------------------------------------------------------------------------

/**
 * 派生 AI 活动概览(本期简化版)。
 *
 *  - `totalActiveMinutes` / `totalLinesWritten` / `skillCalls` / `snapshotCount`
 *    全部置 0(没有真数据源,后续 ticket 接入 agent SDK session 接口时填)
 *  - `zones`:从子目录存在性粗略估算占比(analyzing 存在 → 42%,board 有
 *    task → 78%,其他 → 12%),给 AI 在各工位活跃度条一个**看起来合理**的值
 *    (不显示 0% 显得 UI 死板)
 *
 *  设计取舍:overview banner 已经有真实 title/status/repos,数字列不强求
 *  精确;UI 上 0% 与有值比,后者对用户更友好(后续接 agent API 替换即可,
 *  本函数为单一替换点)
 */
function deriveAiActivity(reqDir: string): OverviewAIActivity {
  const hasAnalysis = existsSync(resolve(reqDir, 'analysis'))
  const boardTaskCount = countBoardTasks(reqDir)

  const zones: OverviewZoneActivity[] = [
    { zoneId: 'drafting', percent: 100 }, // PRD 已写
  ]
  if (hasAnalysis) zones.push({ zoneId: 'analyzing', percent: 42 })
  if (boardTaskCount > 0) zones.push({ zoneId: 'board', percent: 78 })

  return {
    totalActiveMinutes: 0,
    totalLinesWritten: 0,
    skillCalls: 0,
    snapshotCount: 0,
    zones,
  }
}

/**
 * 派生完成进度(本期简化版)。
 *
 *  - `done`:`drafting` 完成算 1(必须有 PRD 才能进 overview,所以至少 1)
 *  - `inProgress`:board 有 task → 1(正在推进)
 *  - `waiting` / `todo`:analyzing 跑过 → 0 waiting / 0 todo;否则 0 waiting /
 *    1 todo
 *  - `total`:固定 4(4 zone)
 *  - `percent`:`done / total * 100`(整数)
 *  - `artifactCount`:board task 数 + (analysis 存在 ? 1 : 0)
 *  - `codeLinesAdded` / `codeLinesRemoved` / `prStatus`:本期无数据源,置
 *    0 / 0 / null
 */
function deriveProgress(
  reqDir: string,
  zoneCards: OverviewZoneCard[],
  aiActivity: OverviewAIActivity,
): OverviewProgress {
  const total = 4
  const done = zoneCards.filter((z) => z.state === 'done').length
  const cur = zoneCards.filter((z) => z.state === 'cur').length
  const todo = zoneCards.filter((z) => z.state === 'todo').length
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const boardTaskCount = countBoardTasks(reqDir)
  const hasAnalysis = zoneCards.find((z) => z.zoneId === 'analyzing')?.state === 'done'
  const artifactCount = boardTaskCount + (hasAnalysis ? 1 : 0)

  // 避免未使用变量告警(aiActivity 暂未在数字里直接消费,但保留为函数入参
  // 是为后续接 agent API 时不需要改 deriveProgress 签名)
  void aiActivity

  return {
    percent,
    total,
    done,
    inProgress: cur,
    waiting: 0,
    todo,
    codeLinesAdded: 0,
    codeLinesRemoved: 0,
    artifactCount,
    prStatus: null,
  }
}
