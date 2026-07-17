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
 *     跟 `deriveStatus` 阈值一致)→ 构造非空 `DraftingData`(`prdMarkdown` = 文件内容)
 *   - 否则 → `emptyDrafting(reqId)`(空草稿态;组件侧生成骨架)
 *
 * 路径解析(对照 PRD N-2 · TODO):
 * - dev: `path.resolve(process.cwd(), '../../requirements/{reqId}/requirement.md')`
 *   (cwd = `<repo-root>/apps/web/`,所以路径指向 `<repo-root>/requirements/`)
 * - production: cwd 可能是仓库根或子目录,**留 TODO**,由后续部署 ticket 解决
 *   (本期假设 dev 路径正确 —— 后端 agent 当前并未真的在 `<repo-root>/requirements/`
 *   落盘,而是写到 `~/.aidevspace/requirements/`,本期 D-1.1 仅修复"进入 DRAFTING
 *   不闪骨架"的最小路径;后续接 agent 的统一落盘路径时再统一修正)
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  emptyDrafting,
  getDraftingData,
  type DraftingData,
} from './drafting'

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
 * `getDraftingDataFromFs` options —— 主要为测试方便注入 fs 路径。
 *
 * - `requirementsRoot`:覆盖 dev 默认的 `<repo-root>/requirements/`。生产部署
 *   路径不一致时,后续 ticket 通过 AIDEVSPACE_ROOT env 或调用方注入解决
 *   (本期不动)
 */
export interface GetDraftingDataFromFsOptions {
  requirementsRoot?: string
}

/**
 * 默认 requirements 根的父目录:dev 时 cwd = `<repo-root>/apps/web/`,
 * 所以 `../..` 即 `<repo-root>/`。本函数返回的是 `requirements/` 的**父目录**,
 * 后续在 `getDraftingDataFromFs` 内会拼上 `requirements/<reqId>/requirement.md`,
 * 拼好后恰好等于 spec 字面要求的:
 *   `path.resolve(process.cwd(), '../../requirements/{reqId}/requirement.md')`
 *
 * TODO(PRD N-2 · production 部署):production cwd 可能不同,留待后续部署 ticket
 * 决定走 env var 还是调用方注入;本期假设 dev 路径。
 */
function defaultRequirementsRoot(): string {
  return resolve(process.cwd(), '../..')
}

/**
 * 拉取 DRAFTING 工位数据(SSR 期 mock —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(`req-001`)→ REFUND_DRAFTING 样例数据(空 PRD 字段已存,组件不填充)
 * - 其他 id:
 *   - `<requirementsRoot>/<reqId>/requirement.md` 存在 + 字节数 > 10 →
 *     构造非空 `DraftingData`(`prdMarkdown` 取文件内容)
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

  const root = options.requirementsRoot ?? defaultRequirementsRoot()
  // 路径:`<root>/requirements/<reqId>/requirement.md`(对齐 ADR-0002 文件系统结构)
  // 与 spec 字面要求 `path.resolve(process.cwd(), '../../requirements/{reqId}/requirement.md')` 完全等价
  const file = resolve(root, 'requirements', requirementId, 'requirement.md')

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
  if (content === null || Buffer.byteLength(content, 'utf8') <= PRD_EMPTY_THRESHOLD_BYTES) {
    return emptyDrafting(requirementId)
  }

  // 4) 构造非空 DraftingData:
  // - prdMarkdown = 文件内容
  // - 顶部 toolbar.crumb = 单元素面包屑,反映"我在写这个 req 的草稿"
  // - 其他字段(auxFiles / repos / selectedRepoIds / skills / title / statusText /
  //   autosaveIntervalMs / lastSavedAt)沿用 emptyDrafting 行为(空 auxFiles / 空
  //   selectedRepoIds / 全局仓库池 / 空 title),不引入 fs 的虚假数据
  return {
    ...emptyDrafting(requirementId),
    prdMarkdown: content,
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