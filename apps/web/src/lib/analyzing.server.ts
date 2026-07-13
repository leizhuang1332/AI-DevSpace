/**
 * ANALYZING 工位 — server-only 数据层
 *
 * 设计动机(issue 19a/19b · Webpack `UnhandledSchemeError` 修复):
 *
 * `analyzing.ts` 同时被两类消费者引用:
 * 1. server component(RSC,例如 `app/(workspace)/requirements/[id]/[zone]/page.tsx`)
 *    — 通过 `getAnalyzingData(reqId)` 拉 server 端数据
 * 2. client component(`'use client'`,例如 `components/analyzing-zone.tsx`)
 *    — 通过 `deriveProducts(chunks)` 在客户端实时派生识别产物
 *
 * 当两类代码都从同一个文件 `import` 时,Next.js/webpack 会把整个模块拉进
 * *所有* 引用方的 bundle。`getAnalyzingData` 内部用 `node:fs` 读
 * `analysis/sessions/<id>/chunks.jsonl` 走文件系统 IO —— 这部分代码一旦误入
 * 客户端 bundle,webpack 会抛:
 *   `UnhandledSchemeError: Reading from "node:fs" is not handled by plugins`
 *
 * 修复方案(本文件):
 *
 * - `analyzing.ts` 只留 types + 纯函数 + mock 数据(纯函数可被客户端与 SSR 共用)
 * - 本文件专存 server-only IO + 数据获取,通过 Next.js `.server.ts` 命名约定
 *   标记(项目当前未安装 `server-only` npm 包;若以后装了,把 `import 'server-only'`
 *   放文件顶部即可获得编译期越界保护)
 * - 仅被 RSC(`page.tsx`)和 vitest(同进程 Node.js)引用;client component 不应
 *   import 本文件
 * - 本文件 `import type { ... } from './analyzing'` 仅带类型,TS 编译后是零字节,
 *   不会触发 webpack 模块解析,不会泄露 client 数据
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AnalyzingChunk,
  AnalyzingData,
  SkillAdmissionFrontmatter,
} from './analyzing'
import {
  REFUND_ANALYZING,
  buildAdmissionData,
  emptyAnalyzing,
  resolveAdmissionDimensions,
} from './analyzing'

// ---------------------------------------------------------------------------
// analysis/sessions/<session-id>/chunks.jsonl 数据源(issue 19b · 验收 #12)
// ---------------------------------------------------------------------------

/**
 * 从 `analysis/sessions/<session-id>/chunks.jsonl` 加载会话思考流。
 *
 * 文件格式:每行一个 JSON 对象,字段 `{ id, ts, label, tone, text, session_id }`,
 * 按写入顺序追加(新 chunk 写在末尾 → 自然成为打字机下一条)。
 *
 * 设计要点:
 * - 文件不存在 / 解析失败 → 返回 `[]`(容错)
 * - 单行 JSON 解析失败 → 跳过该行,继续读后续(避免 1 行损坏毁全文件)
 * - 与 `getAnalyzingData` 解耦:`getAnalyzingData` 负责顶层数据契约,本函数专注单文件加载
 */
export function loadSessionChunks(
  analysisSessionsDir: string,
  sessionId: string,
): AnalyzingChunk[] {
  const file = join(analysisSessionsDir, sessionId, 'chunks.jsonl')
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const result: AnalyzingChunk[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as Partial<AnalyzingChunk>
      // 校验最小字段集(避免脏行污染下游)
      if (
        typeof obj.id === 'string' &&
        typeof obj.ts === 'string' &&
        typeof obj.label === 'string' &&
        typeof obj.text === 'string' &&
        typeof obj.kind === 'string' &&
        typeof obj.tone === 'string'
      ) {
        result.push(obj as AnalyzingChunk)
      }
    } catch {
      /* 单行损坏,跳过;继续读后续行 */
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// analysis/adjudication.md 计数(SSR 期 mock 路径由调用方注入)
// ---------------------------------------------------------------------------

/**
 * 从 analysisDir 读 adjudication.md,计数未裁决项(`applied: false` 或未标 applied)。
 * 文件不存在 / 解析失败 → 0(容错)。
 */
export function countPendingAdjudications(analysisDir: string): number {
  try {
    const file = join(analysisDir, 'adjudication.md')
    if (!existsSync(file)) return 0
    const text = readFileSync(file, 'utf8')
    return countUnresolvedItems(text)
  } catch {
    return 0
  }
}

/**
 * 纯函数:从 Markdown 文本里统计 `- item_id:` 起的 bullet,
 * 若该 bullet 内 `applied: false` 或无 `applied:` 字段 → 计 1(视为待裁决)。
 */
export function countUnresolvedItems(text: string): number {
  if (!text.trim()) return 0
  let count = 0
  // 按 bullet 行分割(- 开头,可能含 2 空格缩进)
  const lines = text.split('\n')
  let inItem = false
  let hasAppliedFalse = false
  let hasAppliedTrue = false
  let hasAppliedField = false

  const flush = () => {
    if (inItem) {
      // 保守策略:有 applied:true → 不计;其余(applied:false 或无 applied)→ 计
      if (!hasAppliedTrue || hasAppliedFalse) {
        count++
      }
    }
    inItem = false
    hasAppliedFalse = false
    hasAppliedTrue = false
    hasAppliedField = false
  }

  for (const line of lines) {
    // bullet 起点
    if (/^\s*-\s+item_id\s*:/.test(line)) {
      flush()
      inItem = true
      hasAppliedFalse = false
      hasAppliedTrue = false
      hasAppliedField = false
      continue
    }
    if (!inItem) continue

    // bullet 内行
    if (/^\s+applied\s*:\s*true\b/.test(line)) {
      hasAppliedField = true
      hasAppliedTrue = true
    } else if (/^\s+applied\s*:\s*false\b/.test(line)) {
      hasAppliedField = true
      hasAppliedFalse = true
    }
  }
  flush()
  return count
}

// ---------------------------------------------------------------------------
// RSC 数据入口
//
// Mock 数据源常量 `REFUND_ANALYZING` 在 `analyzing.ts`(client-safe)里声明,
// 原因:它的 `chunks` + `stats` 也被客户端组件(analyzing-zone.test.tsx 等)测试
// 使用;server 文件仅在运行时按 id 命中时浅拷贝它,不在此重复定义。
// ---------------------------------------------------------------------------

/**
 * 拉取 ANALYZING 工位数据(SSR 期 mock —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001)→ REFUND_ANALYZING 样例数据
 * - 未知 id / 新建需求 → emptyAnalyzing(id)
 *
 * options 用于接入真实数据源(后续 VS 接 server action):
 * - `skillFrontmatter`: Skill SKILL.md frontmatter(读 admission_dimensions + admission_override)
 * - `analysisDir`: 需求 analysis 目录(读 adjudication.md 计数)
 *
 * 不传 options 时,返回默认 5 维度 + 0 待裁决 + pending verdict。
 */
export async function getAnalyzingData(
  requirementId: string,
  options?: GetAnalyzingDataOptions,
): Promise<AnalyzingData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_ANALYZING, requirementId }
  }
  // 未知 id / 新建需求 → 走 emptyAnalyzing,但仍通过装配函数(保留 wiring)
  return emptyAnalyzingWithOptions(requirementId, options)
}

/** getAnalyzingData options —— 后续切 server action 时注入真实数据源 */
export interface GetAnalyzingDataOptions {
  skillFrontmatter?: SkillAdmissionFrontmatter
  analysisDir?: string
}

/**
 * emptyAnalyzing 的"接装配"版本 —— 即使是空需求,维度也走 resolveAdmissionDimensions,
 * pendingAdjudicationCount 也走 countPendingAdjudications(容错返回 0)。
 *
 * 拆分函数而非 inline:让 getAnalyzingData 主线保持直白,装配逻辑单测容易。
 */
function emptyAnalyzingWithOptions(
  requirementId: string,
  options?: GetAnalyzingDataOptions,
): AnalyzingData {
  const dims = resolveAdmissionDimensions(options?.skillFrontmatter)
  const pending = options?.analysisDir
    ? countPendingAdjudications(options.analysisDir)
    : 0
  return {
    ...emptyAnalyzing(requirementId),
    admission: buildAdmissionData({
      dimensions: dims,
      pendingAdjudicationCount: pending,
      verdict: 'pending',
    }),
  }
}
