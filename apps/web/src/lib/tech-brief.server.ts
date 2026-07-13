/**
 * ANALYZING 工位 · technical-brief.md + modules.yaml 文件 IO(issue 19e · VS5)
 *
 * 沿用 products.server.ts 模式:server-only IO,客户端 component 不应 import。
 * RSC 与 server action 内部引用;vitest 在同进程 Node.js 内引用做集成测试。
 *
 * 文件路径(对照 ADR-0013 D8 + 决策 71):
 *   requirements/<req-id>/analysis/technical-brief.md
 *   requirements/<req-id>/analysis/modules.yaml
 *
 * 写入策略(决策 47 + ADR-0009 第 4 层 + 决策 71):
 * - 写前 snapshot 到 .aidevspace/snapshots/<req-id>/<ts>/<file>
 * - 配置 AIDEVSPACE_SNAPSHOT_DIR 时启用;未配置时静默跳过
 * - snapshot best-effort,失败不阻塞主流程
 *
 * 不破坏:本文件仅追加 load/save 双产物 IO;products.server.ts / analyzing.server.ts 行为不变。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseModulesYaml, serializeModulesYaml, type TechBriefModulesFile } from './tech-brief'

/** 解析 analysis 目录:AIDEVSPACE_ROOT/requirements/<reqId>/analysis */
export function resolveAnalysisDir(requirementId: string): string {
  const root = process.env.AIDEVSPACE_ROOT ?? defaultRoot()
  return join(root, 'requirements', requirementId, 'analysis')
}

function defaultRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { homedir } = require('node:os') as typeof import('node:os')
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}

/** 加载 technical-brief.md;文件不存在 → null(区分"未生成") */
export function loadTechBrief(analysisDir: string): string | null {
  const file = join(analysisDir, 'technical-brief.md')
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** 加载 modules.yaml;文件不存在/损坏 → 空 modules(容错) */
export function loadModules(analysisDir: string): TechBriefModulesFile {
  const file = join(analysisDir, 'modules.yaml')
  if (!existsSync(file)) return { modules: [] }
  try {
    const raw = readFileSync(file, 'utf8')
    return parseModulesYaml(raw)
  } catch {
    return { modules: [] }
  }
}

export interface SaveResult {
  ok: boolean
  /** snapshot 路径(若启用);best-effort,失败为 null */
  snapshotPath: string | null
}

/** 写 technical-brief.md + 写前 snapshot */
export function saveTechBriefWithSnapshot(
  analysisDir: string,
  content: string,
): SaveResult {
  ensureDir(analysisDir)
  const snapPath = snapshotBeforeWrite(analysisDir, 'technical-brief.md')
  try {
    const target = join(analysisDir, 'technical-brief.md')
    writeFileSync(target, content, 'utf8')
    return { ok: true, snapshotPath: snapPath }
  } catch {
    return { ok: false, snapshotPath: null }
  }
}

/** 写 modules.yaml + 写前 snapshot */
export function saveModulesWithSnapshot(
  analysisDir: string,
  file: TechBriefModulesFile,
): SaveResult {
  ensureDir(analysisDir)
  const snapPath = snapshotBeforeWrite(analysisDir, 'modules.yaml')
  try {
    const target = join(analysisDir, 'modules.yaml')
    writeFileSync(target, serializeModulesYaml(file), 'utf8')
    return { ok: true, snapshotPath: snapPath }
  } catch {
    return { ok: false, snapshotPath: null }
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const parent = dirname(dir)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
}

/**
 * 写前 snapshot hook(决策 47 · ADR-0009 第 4 层)。
 * 配置 AIDEVSPACE_SNAPSHOT_DIR 时,把当前文件(若存在)拷贝到
 * `<snapshotDir>/<req-id>/<ts>/<file>`;失败静默(best-effort)。
 *
 * @returns snapshot 文件路径(若成功落盘);否则 null
 */
function snapshotBeforeWrite(analysisDir: string, fileName: string): string | null {
  const snapshotDir = process.env.AIDEVSPACE_SNAPSHOT_DIR
  if (!snapshotDir) return null
  try {
    const reqId = extractRequirementId(analysisDir)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const snapDir = join(snapshotDir, reqId, ts)
    mkdirSync(snapDir, { recursive: true })
    const source = join(analysisDir, fileName)
    if (existsSync(source)) {
      const target = join(snapDir, fileName)
      writeFileSync(target, readFileSync(source))
      return target
    }
    return null
  } catch {
    return null
  }
}

/** 从 analysisDir 反推 requirementId(末二级目录的父目录名) */
function extractRequirementId(analysisDir: string): string {
  // analysisDir = <root>/requirements/<req-id>/analysis
  // 拆分后 [-1] = 'analysis', [-2] = req-id
  const parts = analysisDir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 2] ?? 'unknown'
}