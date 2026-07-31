/**
 * packLoader 单测 —— ADR-0021 D5/D11/D14
 *
 * 装载流程:
 *   1. 读 `<packRoot>/manifest.yaml` → schema 校验
 *   2. 读 `manifest.units[i].file` → 读每个 unit yaml → schema 校验
 *   3. 读 `manifest.algorithm` → 读 algorithm yaml → schema + 语义校验
 *   4. 合并成 AdmissionPack
 *
 * V-3 装载校验:
 *   - 结构错 → fail-fast(throw PackStructureError)
 *   - 语义错 → 降级(log warning + 跳过坏规则 / 重复 unit + 仍返回 pack)
 *
 * 物理布局:
 *   ~/.aidevspace/admission/packs/<id>/
 *     manifest.yaml
 *     units/<id>.yaml
 *     algorithm.yaml
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAdmissionPack, PackStructureError, type LoadOptions } from '../packLoader.js'

// ---------------------------------------------------------------------------
// helpers —— 写一个完整的 pack 到 tmp 目录
// ---------------------------------------------------------------------------

const VALID_MANIFEST_YAML = `
id: baseline-5dim
displayName: 默认 5 维度基线
version: 1.0.0
description: 与原 admission-check Skill 行为等价
units:
  - id: loss_prevention
    file: units/loss_prevention.yaml
  - id: performance
    file: units/performance.yaml
  - id: arch_conflict
    file: units/arch_conflict.yaml
  - id: business_reasonable
    file: units/business_reasonable.yaml
  - id: context_query
    file: units/context_query.yaml
algorithm: algorithm.yaml
displayHints:
  primaryBlockers: [loss_prevention]
  recommendedAngle: [architecture]
`

const VALID_UNIT_YAML = (id: string, severity: string, marker: string) => `
id: ${id}
displayName: ${id}
severityIcon: '${severity}'
outputMarker: '${marker}'
admissionPrompt: |
  评估 ${id} 维度。
outputSchema:
  verdict:
    type: enum
    options: [pass, warn, fail]
  evidence:
    type: string
    maxChars: 80
  pending:
    type: string?
    optional: true
  quote:
    type: string?
    optional: true
`

const VALID_ALGORITHM_YAML = `
id: baseline-loose
displayName: 默认宽松策略
rules:
  - id: blocker_fail
    when: 'any(units[]; .severity == "🔴" and .verdict == "fail")'
    result: '❌'
    reason: 存在红线级 fail
  - id: any_warn
    when: 'any(units[]; .verdict == "warn")'
    result: '⚠️'
    reason: 存在 warn 维度
else:
  result: '✅'
  reason: 全部维度 pass
`

interface SeededPack {
  packRoot: string
}

function seedPack(root: string, opts?: {
  manifest?: string
  units?: Record<string, string>
  algorithm?: string
}): SeededPack {
  const packId = 'baseline-5dim'
  const packRoot = join(root, 'packs', packId)
  mkdirSync(join(packRoot, 'units'), { recursive: true })

  writeFileSync(
    join(packRoot, 'manifest.yaml'),
    opts?.manifest ?? VALID_MANIFEST_YAML,
    'utf8',
  )

  const units = opts?.units ?? {
    'units/loss_prevention.yaml': VALID_UNIT_YAML('loss_prevention', '🔴', '[DIM loss_prevention]'),
    'units/performance.yaml': VALID_UNIT_YAML('performance', '🟠', '[DIM performance]'),
    'units/arch_conflict.yaml': VALID_UNIT_YAML('arch_conflict', '🟡', '[DIM arch_conflict]'),
    'units/business_reasonable.yaml': VALID_UNIT_YAML('business_reasonable', '🟢', '[DIM business_reasonable]'),
    'units/context_query.yaml': VALID_UNIT_YAML('context_query', '💬', '[DIM context_query]'),
  }
  for (const [rel, body] of Object.entries(units)) {
    writeFileSync(join(packRoot, rel), body, 'utf8')
  }

  writeFileSync(
    join(packRoot, 'algorithm.yaml'),
    opts?.algorithm ?? VALID_ALGORITHM_YAML,
    'utf8',
  )

  return { packRoot }
}

describe('loadAdmissionPack — 完整合法 pack', () => {
  let root: string
  let packRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-pack-'))
    packRoot = seedPack(root).packRoot
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('合法 baseline-5dim → 返 AdmissionPack + 0 warning', async () => {
    const result = await loadAdmissionPack(packRoot)
    expect(result.pack.id).toBe('baseline-5dim')
    expect(result.pack.displayName).toBe('默认 5 维度基线')
    expect(result.pack.version).toBe('1.0.0')
    expect(result.pack.units).toHaveLength(5)
    expect(result.pack.units.map((u) => u.id)).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
    ])
    expect(result.pack.algorithm.id).toBe('baseline-loose')
    expect(result.pack.algorithm.rules).toHaveLength(2)
    expect(result.warnings).toHaveLength(0)
    expect(result.pack.displayHints?.primaryBlockers).toEqual(['loss_prevention'])
    expect(result.pack.displayHints?.recommendedAngle).toEqual(['architecture'])
  })

  it('装载源目录塞到 pack.sourcePath', async () => {
    const result = await loadAdmissionPack(packRoot)
    expect(result.pack.sourcePath).toBe(packRoot)
  })

  it('单元顺序与 manifest.units 一致', async () => {
    const result = await loadAdmissionPack(packRoot)
    // manifest 顺序: loss_prevention → performance → arch_conflict → business_reasonable → context_query
    expect(result.pack.units[0]?.id).toBe('loss_prevention')
    expect(result.pack.units[4]?.id).toBe('context_query')
  })
})

// ---------------------------------------------------------------------------
// 结构错 → fail-fast(PackStructureError)
// ---------------------------------------------------------------------------

describe('loadAdmissionPack — 结构错 fail-fast', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-pack-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('manifest.yaml YAML parse 失败 → fail-fast', async () => {
    const packRoot = join(root, 'packs', 'broken')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(join(packRoot, 'manifest.yaml'), ':\n  - this is: not valid yaml: ::', 'utf8')

    await expect(loadAdmissionPack(packRoot)).rejects.toBeInstanceOf(PackStructureError)
  })

  it('manifest 缺必填字段 id → fail-fast', async () => {
    const packRoot = join(root, 'packs', 'no-id')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(
      join(packRoot, 'manifest.yaml'),
      `
displayName: 缺 id 的 manifest
units: []
algorithm: algorithm.yaml
`,
      'utf8',
    )

    await expect(loadAdmissionPack(packRoot)).rejects.toBeInstanceOf(PackStructureError)
  })

  it('manifest 引用 unit 文件缺失 → fail-fast', async () => {
    const packRoot = join(root, 'packs', 'missing-unit')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(
      join(packRoot, 'manifest.yaml'),
      `
id: missing-unit
displayName: 缺 unit 文件
units:
  - id: ghost
    file: units/ghost.yaml
algorithm: algorithm.yaml
`,
      'utf8',
    )

    await expect(loadAdmissionPack(packRoot)).rejects.toBeInstanceOf(PackStructureError)
  })

  it('manifest 引用 algorithm 文件缺失 → fail-fast', async () => {
    const packRoot = join(root, 'packs', 'missing-alg')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(
      join(packRoot, 'manifest.yaml'),
      `
id: missing-alg
displayName: 缺 algorithm
units: []
algorithm: algorithm.yaml
`,
      'utf8',
    )
    // 不写 algorithm.yaml

    await expect(loadAdmissionPack(packRoot)).rejects.toBeInstanceOf(PackStructureError)
  })

  it('unit 缺 admissionPrompt → fail-fast', async () => {
    const packRoot = join(root, 'packs', 'no-prompt')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(
      join(packRoot, 'manifest.yaml'),
      `
id: no-prompt
displayName: unit 缺 admissionPrompt
units:
  - id: foo
    file: units/foo.yaml
algorithm: algorithm.yaml
`,
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'units/foo.yaml'),
      `
id: foo
displayName: foo
severityIcon: '🟢'
outputMarker: '[DIM foo]'
# admissionPrompt 缺失
outputSchema:
  verdict:
    type: enum
    options: [pass, warn, fail]
  evidence:
    type: string
    maxChars: 80
`,
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'algorithm.yaml'),
      `
id: passthrough
displayName: 直通
rules: []
else:
  result: '✅'
  reason: 默认通过
`,
      'utf8',
    )

    await expect(loadAdmissionPack(packRoot)).rejects.toBeInstanceOf(PackStructureError)
  })

  it('outputMarker 跨 unit 冲突 → fail-fast', async () => {
    const packRoot = join(root, 'packs', 'collision')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(
      join(packRoot, 'manifest.yaml'),
      `
id: collision
displayName: marker 冲突
units:
  - id: a
    file: units/a.yaml
  - id: b
    file: units/b.yaml
algorithm: algorithm.yaml
`,
      'utf8',
    )
    // a 和 b 共用同一 marker
    writeFileSync(
      join(packRoot, 'units/a.yaml'),
      VALID_UNIT_YAML('a', '🟢', '[DIM SHARED]'),
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'units/b.yaml'),
      VALID_UNIT_YAML('b', '🟡', '[DIM SHARED]'),
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'algorithm.yaml'),
      `
id: passthrough
displayName: 直通
rules: []
else:
  result: '✅'
  reason: ok
`,
      'utf8',
    )

    await expect(loadAdmissionPack(packRoot)).rejects.toBeInstanceOf(PackStructureError)
  })
})

// ---------------------------------------------------------------------------
// 语义错 → 降级(warning + best-effort pack)
// ---------------------------------------------------------------------------

describe('loadAdmissionPack — 语义错降级', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-pack-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('algorithm 表达式 syntax 错 → warning + 仍返 pack(规则被跳过)', async () => {
    const packRoot = join(root, 'packs', 'syntax-broken')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(
      join(packRoot, 'manifest.yaml'),
      `
id: syntax-broken
displayName: 算法 syntax 错
units:
  - id: a
    file: units/a.yaml
algorithm: algorithm.yaml
`,
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'units/a.yaml'),
      VALID_UNIT_YAML('a', '🟢', '[DIM a]'),
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'algorithm.yaml'),
      `
id: mixed
displayName: 混合
rules:
  - id: good
    when: 'any(units[]; .verdict == "fail")'
    result: '❌'
    reason: good
  - id: broken
    when: 'unclosed('
    result: '❌'
    reason: broken
else:
  result: '✅'
  reason: else
`,
      'utf8',
    )

    const result = await loadAdmissionPack(packRoot)
    expect(result.pack.id).toBe('syntax-broken')
    // 仍返 pack
    expect(result.pack.algorithm.id).toBe('mixed')
    // warning 含 algorithm_syntax
    const w = result.warnings.find((x) => x.category === 'algorithm_syntax')
    expect(w).toBeDefined()
    expect(w?.target).toContain('broken')
  })

  it('algorithm 规则 id 重复 → warning + 仍返 pack', async () => {
    const packRoot = join(root, 'packs', 'rule-dup')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(
      join(packRoot, 'manifest.yaml'),
      `
id: rule-dup
displayName: 规则 id 重复
units:
  - id: a
    file: units/a.yaml
algorithm: algorithm.yaml
`,
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'units/a.yaml'),
      VALID_UNIT_YAML('a', '🟢', '[DIM a]'),
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'algorithm.yaml'),
      `
id: rule-dup-alg
displayName: 重复规则
rules:
  - id: dup
    when: 'true'
    result: '⚠️'
    reason: first
  - id: dup
    when: 'false'
    result: '❌'
    reason: second
else:
  result: '✅'
  reason: ok
`,
      'utf8',
    )

    const result = await loadAdmissionPack(packRoot)
    expect(result.pack.id).toBe('rule-dup')
    const w = result.warnings.find((x) => x.category === 'rule_id_collision')
    expect(w).toBeDefined()
  })

  it('unit id 在 manifest 内重复 → warning', async () => {
    const packRoot = join(root, 'packs', 'unit-dup')
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    writeFileSync(
      join(packRoot, 'manifest.yaml'),
      `
id: unit-dup
displayName: 单元 id 重复
units:
  - id: foo
    file: units/foo.yaml
  - id: foo
    file: units/foo.yaml
algorithm: algorithm.yaml
`,
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'units/foo.yaml'),
      VALID_UNIT_YAML('foo', '🟢', '[DIM foo]'),
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'algorithm.yaml'),
      `
id: passthrough
displayName: 直通
rules: []
else:
  result: '✅'
  reason: ok
`,
      'utf8',
    )

    const result = await loadAdmissionPack(packRoot)
    const w = result.warnings.find((x) => x.category === 'unit_id_collision')
    expect(w).toBeDefined()
  })

  it('pack 整体 OK → warnings = []', async () => {
    const packRoot = seedPack(root).packRoot
    const result = await loadAdmissionPack(packRoot)
    expect(result.warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// manifest id 与目录名一致性
// ---------------------------------------------------------------------------

describe('loadAdmissionPack — manifest id 与目录名一致性', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-pack-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('manifest.id 与 packRoot 末段目录名一致 → OK', async () => {
    seedPack(root)
    const packRoot = join(root, 'packs', 'baseline-5dim')
    const result = await loadAdmissionPack(packRoot)
    expect(result.pack.id).toBe('baseline-5dim')
  })
})

// ---------------------------------------------------------------------------
// LoadOptions (注入 hook —— 测试用)
// ---------------------------------------------------------------------------

describe('loadAdmissionPack — LoadOptions', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-pack-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('支持自定义 readFile —— 把 fs 抽出来方便测', async () => {
    const packRoot = seedPack(root).packRoot
    const calls: string[] = []
    const opts: LoadOptions = {
      readFile: async (p) => {
        calls.push(p)
        const fs = await import('node:fs/promises')
        return fs.readFile(p, 'utf8')
      },
    }
    await loadAdmissionPack(packRoot, opts)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some((c) => c.endsWith('manifest.yaml'))).toBe(true)
    expect(calls.some((c) => c.endsWith('algorithm.yaml'))).toBe(true)
  })
})