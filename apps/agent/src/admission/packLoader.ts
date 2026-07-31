/**
 * packLoader —— ADR-0021 D5/D11/D14 V-3 装载校验
 *
 * 物理布局:
 *   <packRoot>/
 *     manifest.yaml           # 元数据 + units 顺序 + algorithm 引用
 *     units/<id>.yaml         # 每个评估单元
 *     algorithm.yaml          # verdict 算法
 *
 * V-3 装载校验:
 *   - 结构错(失败立即 throw PackStructureError)
 *     - YAML parse 失败
 *     - 缺必填字段(manifest / unit / algorithm)
 *     - manifest id 与目录名不一致
 *     - unit / algorithm 文件缺失
 *     - unit 缺 admissionPrompt
 *     - outputMarker 跨 unit 冲突
 *
 *   - 语义错(降级 → 返回 AdmissionPack + warnings[])
 *     - algorithm 表达式 syntax 错(validator 已拦,这里再做兜底)
 *     - algorithm 规则 id 重复
 *     - unit id 在 manifest 内重复
 *
 * 设计要点:
 *   - readFile 通过 LoadOptions 注入(测试可换内存读)
 *   - warnings 在 result.warnings 字段列出,调用方 log + 提示用户
 *   - "skip bad rule"语义:对 algorithm 语法错,validator 报错;loader 收到错
 *     仍把整个算法塞进 pack(warning 标错位置);调用方(本期无 caller)
 *     决定如何处置 —— ADR-0021 D14 V-3 描述为"降级 + 跳过该规则"
 *
 * 后期若需要真"跳过单条坏规则":
 *   - loader 应接收 ok/坏规则 list,调用方在 runAlgorithm 时只跑 ok 那部分
 *   - 本期 ticket 01 不实装,先全量保留 + warning
 */

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import yaml from 'yaml'
import {
  AdmissionAlgorithmSchema,
  AdmissionPackManifestSchema,
  AdmissionUnitSchema,
  type AdmissionPack,
  type AdmissionPackManifest,
  type AdmissionPackWarning,
  type AdmissionUnit,
} from '@ai-devspace/shared'
import {
  validateAlgorithm,
  AlgorithmValidationError,
} from './algorithmValidator.js'

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export type PackStructureErrorCode =
  | 'manifest_missing'
  | 'manifest_yaml_parse'
  | 'manifest_schema'
  | 'manifest_id_mismatch'
  | 'unit_missing'
  | 'unit_yaml_parse'
  | 'unit_schema'
  | 'algorithm_missing'
  | 'algorithm_yaml_parse'
  | 'algorithm_schema'
  | 'output_marker_collision'

/** 结构错 —— loader 直接抛出(ADR-0021 D14:结构 fail-fast) */
export class PackStructureError extends Error {
  public readonly code: PackStructureErrorCode
  public readonly detail: string
  constructor(code: PackStructureErrorCode, detail: string) {
    super(`pack structure error [${code}]: ${detail}`)
    this.name = 'PackStructureError'
    this.code = code
    this.detail = detail
  }
}

// ---------------------------------------------------------------------------
// 装载结果
// ---------------------------------------------------------------------------

export interface LoadResult {
  pack: AdmissionPack
  /** 语义警告清单 —— 调用方 log + 提示用户 */
  warnings: AdmissionPackWarning[]
}

export interface LoadOptions {
  /** 文件读取函数;默认 node:fs/promises.readFile */
  readFile?: (path: string) => Promise<string>
}

// ---------------------------------------------------------------------------
// 装载入口
// ---------------------------------------------------------------------------

export async function loadAdmissionPack(
  packRoot: string,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const read = options.readFile ?? defaultReadFile

  // 1. manifest
  const manifestRaw = await readSafe(read, join(packRoot, 'manifest.yaml'), 'manifest_missing')
  const manifestParsed = parseYaml(manifestRaw, packRoot, 'manifest_yaml_parse')
  const manifestResult = AdmissionPackManifestSchema.safeParse(manifestParsed)
  if (!manifestResult.success) {
    throw new PackStructureError(
      'manifest_schema',
      `manifest schema validation failed: ${manifestResult.error.message}`,
    )
  }
  const manifest = manifestResult.data

  // 2. manifest.id 与目录名一致性
  const dirName = basename(packRoot)
  if (manifest.id !== dirName) {
    throw new PackStructureError(
      'manifest_id_mismatch',
      `manifest.id '${manifest.id}' does not match directory name '${dirName}'`,
    )
  }

  const warnings: AdmissionPackWarning[] = []

  // 3. units(读 manifest.units[i].file → AdmissionUnit)
  const units = await loadUnits(read, packRoot, manifest, warnings)

  // 4. outputMarker 跨 unit 冲突
  const markerSet = new Map<string, string>()
  for (const u of units) {
    const existing = markerSet.get(u.outputMarker)
    if (existing && existing !== u.id) {
      throw new PackStructureError(
        'output_marker_collision',
        `outputMarker '${u.outputMarker}' used by both '${existing}' and '${u.id}'`,
      )
    }
    markerSet.set(u.outputMarker, u.id)
  }

  // 5. algorithm
  const algorithmRaw = await readSafe(read, join(packRoot, manifest.algorithm), 'algorithm_missing')
  const algorithmParsed = parseYaml(algorithmRaw, join(packRoot, manifest.algorithm), 'algorithm_yaml_parse')
  const algorithmResult = AdmissionAlgorithmSchema.safeParse(algorithmParsed)
  if (!algorithmResult.success) {
    throw new PackStructureError(
      'algorithm_schema',
      `algorithm schema validation failed: ${algorithmResult.error.message}`,
    )
  }
  const algorithm = algorithmResult.data

  // 6. 算法语义校验:失败则降级 + warning(从 structured 字段拿 ruleId,不解析 detail)
  const validation = validateAlgorithm(algorithm)
  if (!validation.ok) {
    const err = validation.error
    const target = err.ruleId ?? err.detail
    if (err.code === 'rule_syntax_error') {
      warnings.push({
        category: 'algorithm_syntax',
        target,
        message: err.detail,
      })
    } else if (err.code === 'rule_id_collision') {
      warnings.push({
        category: 'rule_id_collision',
        target,
        message: err.detail,
      })
    }
  }

  // 7. 拼 AdmissionPack
  const pack: AdmissionPack = {
    id: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    description: manifest.description,
    tags: manifest.tags,
    units,
    algorithm,
    displayHints: manifest.displayHints
      ? {
          primaryBlockers: manifest.displayHints.primaryBlockers,
          recommendedAngle: manifest.displayHints.recommendedAngle,
        }
      : undefined,
    sourcePath: packRoot,
  }

  return { pack, warnings }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function readSafe(
  read: (path: string) => Promise<string>,
  path: string,
  missingCode: PackStructureErrorCode,
): Promise<string> {
  try {
    return await read(path)
  } catch (err) {
    throw new PackStructureError(missingCode, `cannot read '${path}': ${String(err)}`)
  }
}

function parseYaml(raw: string, path: string, errCode: PackStructureErrorCode): unknown {
  try {
    return yaml.parse(raw)
  } catch (err) {
    throw new PackStructureError(errCode, `cannot parse YAML at '${path}': ${String(err)}`)
  }
}

async function defaultReadFile(p: string): Promise<string> {
  return readFile(p, 'utf8')
}

/** 读 manifest.units[i].file → AdmissionUnit,失败 throw */
async function loadUnits(
  read: (path: string) => Promise<string>,
  packRoot: string,
  manifest: AdmissionPackManifest,
  warnings: AdmissionPackWarning[],
): Promise<AdmissionUnit[]> {
  // 1. manifest 内 unit id 重复检查(语义警告)
  const seenUnitIds = new Set<string>()
  for (const entry of manifest.units) {
    if (seenUnitIds.has(entry.id)) {
      warnings.push({
        category: 'unit_id_collision',
        target: entry.id,
        message: `duplicate unit id '${entry.id}' in manifest; later one wins`,
      })
    }
    seenUnitIds.add(entry.id)
  }

  // 2. 逐个读 unit YAML
  const out: AdmissionUnit[] = []
  for (const entry of manifest.units) {
    // entry.file 必须是 pack 内相对路径(避免越界 pack 边界读其他目录文件)
    if (entry.file.startsWith('/') || entry.file.includes('..')) {
      throw new PackStructureError(
        'unit_schema',
        `unit '${entry.id}' file path must be relative to pack root (no leading '/' or '..'); got '${entry.file}'`,
      )
    }
    const absPath = join(packRoot, entry.file)
    const raw = await readSafe(read, absPath, 'unit_missing')
    const parsed = parseYaml(raw, absPath, 'unit_yaml_parse')
    const uResult = AdmissionUnitSchema.safeParse(parsed)
    if (!uResult.success) {
      throw new PackStructureError(
        'unit_schema',
        `unit '${entry.id}' schema validation failed: ${uResult.error.message}`,
      )
    }
    out.push(uResult.data)
  }
  return out
}

// re-export 给上层用 AlgorithmValidationError
export { AlgorithmValidationError }