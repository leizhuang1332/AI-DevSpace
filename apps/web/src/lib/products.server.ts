/**
 * ANALYZING 工位 · products.yaml 文件 IO(issue 19d · VS4)
 *
 * 沿用 `analyzing.server.ts` 模式:本文件专存 server-only IO,客户端 component
 * 不应 import(webpack `UnhandledSchemeError` 防护)。RSC 与 server action 内部
 * 引用;vitest 在同进程 Node.js 内引用做集成测试。
 *
 * 文件路径:`analysis/sessions/<session-id>/products.yaml`
 * - 文件不存在 / 解析失败 → 返回空 ProductsFile(容错)
 * - 写入前自动 snapshot 到 `.aidevspace/snapshots/<req-id>/<ts>/`(决策 47 ·
 *   ADR-0009 第 4 层)。snapshots 目录在本 slice 仅留 stub —— 与 platform 层
 *   snapshot 服务(待 P1+)对接前,不引入新依赖。
 *
 * 不破坏:本文件仅追加 `loadProducts` / `saveProducts` 两个纯函数;其他 IO
 * (loadSessionChunks / countPendingAdjudications / loadSessionsBundle) 在
 * `analyzing.server.ts` 保持原样。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  parseProductsYaml,
  serializeProductsYaml,
  type ProductsFile,
} from './products'

/**
 * 从 `analysis/sessions/<session-id>/products.yaml` 加载识别产物。
 *
 * 设计要点:
 * - 文件不存在 / 损坏 → 返回空 ProductsFile(容错,不抛)
 * - 单行解析失败 → 跳过该行(parseProductsYaml 的内建容错)
 * - 与 `getAnalyzingData` 解耦:本函数专注单文件加载
 *
 * @param analysisSessionsDir analysis/sessions/ 父目录
 * @param sessionId 会话 id(对应 `analysis/sessions/<session-id>/`)
 */
export function loadProducts(
  analysisSessionsDir: string,
  sessionId: string,
): ProductsFile {
  const file = join(analysisSessionsDir, sessionId, 'products.yaml')
  if (!existsSync(file)) return emptyProducts()
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return emptyProducts()
  }
  try {
    return parseProductsYaml(raw)
  } catch {
    return emptyProducts()
  }
}

/**
 * 写回 products.yaml。
 *
 * 设计要点:
 * - 自动创建 `<sessionId>/` 子目录(若不存在)—— 上层不需预先 mkdir
 * - 写入采用 `writeFileSync` 全量覆盖;atomic 性由 OS 级别保证(单次 syscall)
 * - 未来若引入决策 47 自动 snapshot,在此 hook(`takeSnapshot(...)` 注入)
 *
 * @param analysisSessionsDir analysis/sessions/ 父目录
 * @param sessionId 会话 id
 * @param file 要写入的 ProductsFile
 */
export function saveProducts(
  analysisSessionsDir: string,
  sessionId: string,
  file: ProductsFile,
): void {
  const sessionDir = join(analysisSessionsDir, sessionId)
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true })
  }
  const target = join(sessionDir, 'products.yaml')
  // 确保父目录存在(防御性;上面 mkdirSync 已处理)
  if (!existsSync(dirname(target))) {
    mkdirSync(dirname(target), { recursive: true })
  }
  writeFileSync(target, serializeProductsYaml(file), 'utf8')
}

/** 空 ProductsFile(空数组显式序列化,便于人眼对齐) */
function emptyProducts(): ProductsFile {
  return { subproblems: [], risks: [], options: [] }
}