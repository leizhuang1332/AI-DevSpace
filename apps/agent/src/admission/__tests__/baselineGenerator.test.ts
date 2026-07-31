/**
 * baselineGenerator 单测 —— ADR-0021 D13 + D14
 *
 * 职责:`baseline-5dim` pack 在 workspace 内首次被需要时自动生成。
 *
 *   - 应用 bundle 不携带 pack(K-B 形态)
 *   - 首次 ensure → 写 ~/.aidevspace/admission/packs/baseline-5dim/{manifest,units/*,algorithm}
 *   - 已存在 → 不覆盖(幂等)
 *
 * 设计要点:
 *   - ensureIfMissing(workspaceRoot):幂等;missing 时写盘,present 时 noop
 *   - 写盘后用 packLoader 装载回 AdmissionPack(自验证)
 *   - enabled_packs 默认 ['baseline-5dim'] 在 workspace 初始化时一并注入(本期本 ticket 不做;
 *     由后续 ticket 处理 `analysis.enabled_packs` 字段)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureBaselinePack, BASELINE_PACK_ID } from '../baselineGenerator.js'
import { loadAdmissionPack } from '../packLoader.js'

describe('ensureBaselinePack —— baseline-5dim 自动生成', () => {
  let root: string

  beforeEach(() => {
    root = mkdirWorkspaceRoot()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('workspace 无 pack → ensureBaselinePack 写入完整目录结构', async () => {
    expect(existsSync(join(root, 'admission', 'packs'))).toBe(false)

    const out = await ensureBaselinePack(root)
    expect(out.created).toBe(true)
    expect(out.pack.id).toBe('baseline-5dim')

    // 物理文件就位
    const packRoot = join(root, 'admission', 'packs', BASELINE_PACK_ID)
    expect(existsSync(join(packRoot, 'manifest.yaml'))).toBe(true)
    for (const u of ['loss_prevention', 'performance', 'arch_conflict', 'business_reasonable', 'context_query']) {
      expect(existsSync(join(packRoot, 'units', `${u}.yaml`))).toBe(true)
    }
    expect(existsSync(join(packRoot, 'algorithm.yaml'))).toBe(true)
  })

  it('已存在 pack → 幂等,不重写', async () => {
    const packRoot = join(root, 'admission', 'packs', BASELINE_PACK_ID)
    mkdirSync(join(packRoot, 'units'), { recursive: true })

    // 写一个"用户改过的"完整 pack —— displayName / units / algorithm 都改了
    const userManifest = `id: ${BASELINE_PACK_ID}
displayName: 用户手动改过的
units:
  - id: foo
    file: units/foo.yaml
algorithm: algorithm.yaml
`
    writeFileSync(join(packRoot, 'manifest.yaml'), userManifest, 'utf8')
    writeFileSync(
      join(packRoot, 'units/foo.yaml'),
      `id: foo
displayName: 用户自定义单元
severityIcon: '🟢'
outputMarker: '[DIM foo]'
admissionPrompt: 用户定义的单元
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
`,
      'utf8',
    )
    writeFileSync(
      join(packRoot, 'algorithm.yaml'),
      `id: user-algo
displayName: 用户策略
rules: []
else:
  result: '✅'
  reason: 默认通过
`,
      'utf8',
    )

    const out = await ensureBaselinePack(root)
    expect(out.created).toBe(false)
    expect(out.pack.id).toBe(BASELINE_PACK_ID)
    expect(out.pack.displayName).toBe('用户手动改过的')

    // 用户改的 manifest 仍在
    const onDisk = readFileSync(join(packRoot, 'manifest.yaml'), 'utf8')
    expect(onDisk).toBe(userManifest)
  })

  it('首次写入的 pack 装载可成功(packLoader 端到端验证)', async () => {
    await ensureBaselinePack(root)
    const result = await loadAdmissionPack(
      join(root, 'admission', 'packs', BASELINE_PACK_ID),
    )
    expect(result.pack.id).toBe('baseline-5dim')
    expect(result.pack.units).toHaveLength(5)
    expect(result.pack.units.map((u) => u.severityIcon)).toEqual([
      '🔴',
      '🟠',
      '🟡',
      '🟢',
      '💬',
    ])
    expect(result.warnings).toEqual([])
  })

  it('默认算法 = baseline-loose:任一 🔴 fail → ❌;任一 warn → ⚠️;else ✅', async () => {
    const { pack } = await ensureBaselinePack(root)
    expect(pack.algorithm.id).toBe('baseline-loose')
    expect(pack.algorithm.rules[0]?.id).toBe('blocker_fail')
    expect(pack.algorithm.rules[0]?.result).toBe('❌')
    expect(pack.algorithm.rules[1]?.id).toBe('any_warn')
    expect(pack.algorithm.rules[1]?.result).toBe('⚠️')
    expect(pack.algorithm.else.result).toBe('✅')
  })

  it('manifest.primaryBlockers 标 loss_prevention;recommendedAngle 标 architecture', async () => {
    const { pack } = await ensureBaselinePack(root)
    expect(pack.displayHints?.primaryBlockers).toEqual(['loss_prevention'])
    expect(pack.displayHints?.recommendedAngle).toEqual(['architecture'])
  })
})

describe('ensureBaselinePack —— 边界', () => {
  let root: string

  beforeEach(() => {
    root = mkdirWorkspaceRoot()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('pack 目录在但缺 manifest(用户误删)→ 视为缺失,重写整个 pack', async () => {
    const packRoot = join(root, 'admission', 'packs', BASELINE_PACK_ID)
    mkdirSync(join(packRoot, 'units'), { recursive: true })
    // 没有 manifest.yaml / units / algorithm

    const out = await ensureBaselinePack(root)
    expect(out.created).toBe(true)
    expect(existsSync(join(packRoot, 'manifest.yaml'))).toBe(true)
  })

  it('连续调用两次 → 第二次 created=false', async () => {
    const r1 = await ensureBaselinePack(root)
    expect(r1.created).toBe(true)
    const r2 = await ensureBaselinePack(root)
    expect(r2.created).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mkdirWorkspaceRoot(): string {
  const root = join(
    tmpdir(),
    `aidevsp-baseline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  mkdirSync(root, { recursive: true })
  return root
}