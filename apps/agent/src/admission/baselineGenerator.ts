/**
 * baselineGenerator —— ADR-0021 D13 + D14
 *
 * 职责:在 workspace 内首次需要 admission pack 时,自动生成 baseline-5dim。
 *
 * 形态:
 *   应用 bundle 不携带 pack(K-B 形态)。首次 ensure 时:
 *     ~/.aidevspace/admission/packs/baseline-5dim/
 *       manifest.yaml
 *       units/loss_prevention.yaml
 *       units/performance.yaml
 *       units/arch_conflict.yaml
 *       units/business_reasonable.yaml
 *       units/context_query.yaml
 *       algorithm.yaml
 *
 * 幂等性:
 *   - 已有 baseline-5dim 目录 → noop(created=false)
 *   - 用户手工改 manifest/units/algorithm → 不会覆盖(尊重用户内容)
 *   - 缺失某些文件(只建了目录没 manifest)→ 重写整个 pack
 *
 * 与"原 admission-check Skill 行为等价"(ADR-0021 D7 / 风险缓解):
 *   - 5 个维度(loss_prevention / performance / arch_conflict / business_reasonable /
 *     context_query)+ 5 级 severity 表(🔴🟠🟡🟢💬)+ 任一 🔴 fail → ❌ 规则
 *   - baseline-equivalence 测试在后续 ticket(07)覆盖;此处只保证生成形态正确
 */

import { existsSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import yaml from 'yaml'
import type { AdmissionPack } from '@ai-devspace/shared'
import { loadAdmissionPack, type LoadResult } from './packLoader.js'

/** baseline-5dim 是与原 admission-check Skill 等价的默认 pack id */
export const BASELINE_PACK_ID = 'baseline-5dim'

/** 算法 id —— 默认宽松策略(任一 🔴 fail → ❌;任一 warn → ⚠️;else ✅) */
export const BASELINE_ALGORITHM_ID = 'baseline-loose'

export interface EnsureResult {
  /** 装载后的 AdmissionPack */
  pack: AdmissionPack
  /** 本次调用是否真写了盘(true = 新建;false = 已存在 noop) */
  created: boolean
  /** loader 返回的语义警告(若有) */
  warnings: LoadResult['warnings']
}

/** 幂等地确保 baseline-5dim 存在于 workspace */
export async function ensureBaselinePack(workspaceRoot: string): Promise<EnsureResult> {
  const packRoot = join(workspaceRoot, 'admission', 'packs', BASELINE_PACK_ID)
  const manifestPath = join(packRoot, 'manifest.yaml')

  // 已存在(以 manifest.yaml 存在为"已建"判据) → 不覆盖,直接 load
  if (existsSync(manifestPath)) {
    const loaded = await loadAdmissionPack(packRoot)
    return { pack: loaded.pack, created: false, warnings: loaded.warnings }
  }

  // 缺失 → 写盘整套(用 writeFileAtomic 模式:tmp + rename,避免半写损坏)
  await mkdir(join(packRoot, 'units'), { recursive: true })
  await writeFileAtomic(join(packRoot, 'manifest.yaml'), renderBaselineManifest())

  for (const u of BASELINE_UNITS) {
    await writeFileAtomic(
      join(packRoot, 'units', `${u.id}.yaml`),
      renderUnit(u),
    )
  }

  await writeFileAtomic(join(packRoot, 'algorithm.yaml'), renderBaselineAlgorithm())

  // 自验证 —— 装载一遍确认生成的内容合法
  const loaded = await loadAdmissionPack(packRoot)
  return { pack: loaded.pack, created: true, warnings: loaded.warnings }
}

/** 原子写文件 —— 与 WorkspaceService.writeFileAtomic 保持一致(避免半写损坏) */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = path + '.tmp'
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

// ---------------------------------------------------------------------------
// 内容模板
// ---------------------------------------------------------------------------

interface BaselineUnitSeed {
  id: string
  displayName: string
  severityIcon: string
  outputMarker: string
  /** 评估重点描述 —— 注入 system prompt */
  description: string
}

const BASELINE_UNITS: BaselineUnitSeed[] = [
  {
    id: 'loss_prevention',
    displayName: '资损安全',
    severityIcon: '🔴',
    outputMarker: '[DIM loss_prevention]',
    description:
      '聚焦资金流 / 资产扣减 / 退款 / 优惠券 / 余额等路径,识别 PRD 是否引入新的资金风险点。',
  },
  {
    id: 'performance',
    displayName: '性能',
    severityIcon: '🟠',
    outputMarker: '[DIM performance]',
    description:
      '聚焦 RT / 吞吐量 / 长尾延迟 / 资源占用等指标,识别 PRD 是否引入性能瓶颈。',
  },
  {
    id: 'arch_conflict',
    displayName: '架构冲突',
    severityIcon: '🟡',
    outputMarker: '[DIM arch_conflict]',
    description:
      '聚焦现有架构 / 上下游契约 / 服务边界,识别 PRD 是否引入架构冲突或技术债。',
  },
  {
    id: 'business_reasonable',
    displayName: '业务合理性',
    severityIcon: '🟢',
    outputMarker: '[DIM business_reasonable]',
    description:
      '聚焦业务目标 / 边界 / 一致性 / 异常路径,识别 PRD 是否存在业务逻辑漏洞。',
  },
  {
    id: 'context_query',
    displayName: '上下文确认',
    severityIcon: '💬',
    outputMarker: '[DIM context_query]',
    description:
      '聚焦 PRD 中定义模糊 / 需要业务确认的项,列出待裁决问题。',
  },
]

function renderBaselineManifest(): string {
  const obj = {
    id: BASELINE_PACK_ID,
    displayName: '默认 5 维度基线',
    version: '1.0.0',
    description:
      '与原 admission-check Skill 行为等价;任一 🔴 fail → ❌;任一 warn → ⚠️;其余 ✅。',
    tags: ['baseline', '5dim'],
    units: BASELINE_UNITS.map((u) => ({
      id: u.id,
      file: `units/${u.id}.yaml`,
    })),
    algorithm: 'algorithm.yaml',
    displayHints: {
      primaryBlockers: ['loss_prevention'],
      recommendedAngle: ['architecture'],
    },
  }
  return yaml.stringify(obj, { indent: 2, lineWidth: 0 })
}

function renderUnit(u: BaselineUnitSeed): string {
  const obj = {
    id: u.id,
    displayName: u.displayName,
    severityIcon: u.severityIcon,
    outputMarker: u.outputMarker,
    admissionPrompt: u.description,
    outputSchema: {
      verdict: { type: 'enum', options: ['pass', 'warn', 'fail'] },
      evidence: { type: 'string', maxChars: 80 },
      pending: { type: 'string?', optional: true },
      quote: { type: 'string?', optional: true },
    },
  }
  return yaml.stringify(obj, { indent: 2, lineWidth: 0 })
}

function renderBaselineAlgorithm(): string {
  const obj = {
    id: BASELINE_ALGORITHM_ID,
    displayName: '默认宽松策略',
    rules: [
      {
        id: 'blocker_fail',
        when: 'any(units[]; .severity == "🔴" and .verdict == "fail")',
        result: '❌',
        reason: '存在红线级 fail',
      },
      {
        id: 'any_warn',
        when: 'any(units[]; .verdict == "warn")',
        result: '⚠️',
        reason: '存在 warn 维度',
      },
    ],
    else: {
      result: '✅',
      reason: '全部维度 pass',
    },
  }
  return yaml.stringify(obj, { indent: 2, lineWidth: 0 })
}