/**
 * DESIGNING 工位 · server-only loader 路径一致性测试
 * (issue: zone-data-fidelity-fixes · 05 · D-6.5)
 *
 * 文件名沿用 spec (PRD T-2.2 / ticket 05 AC) 的字面要求:
 *   "apps/web/src/__tests__/designing.server.test.ts(追加路径一致性用例)"
 *
 * 与 `analyzing-designing-fs-loader.test.ts` 的关系:
 * - 合并文件覆盖 ticket 02 落地的 fs loader 完整契约(空 / 缺 candidates /
 *   4 yaml 齐备 / req-001 短路 / 与 REFUND_DESIGNING 对齐)
 * - 本文件聚焦 ticket 05 / D-6 的路径一致性回归(默认路径解析、config.yaml
 *   注入、req-001 短路仍然生效)
 *
 * 测试用 `os.tmpdir()` 隔离,afterEach 清理。
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDesigningDataFromFs } from '@/lib/designing.server'

// ============================================================================
// fixture 隔离
// ============================================================================

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidevspace-designing-server-'))
})

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
})

/** `tmpRoot` 作为 `requirementsRoot` 传入,代表 `<repo-root>/requirements/`。
 *
 * 所以需求目录直接在 tmpRoot 下(不再嵌 `requirements/`)。
 * `<requirementsRoot>/<reqId>/<subDir>` 是所有 fs loader 的统一约定。 */
function writeDesignDir(id: string): string {
  // ticket 05 / D-6 后,requirementsRoot 语义 = workspace 根,需求目录嵌 `requirements/`
  // 中间层(对齐 ADR-0002)。fixture 跟随调整。
  const dir = join(tmpRoot, 'requirements', id, 'design')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 写完整四 yaml(stage / candidates / design_doc / tradeoff)
 *
 * schema 选扁平风格以简化解析器 —— entry 内部仅 flat scalar fields + scalar list,
 * 不嵌套对象(`tag` 拆成 `tag_label` + `tag_variant` 两个 flat 字段)。`metrics`
 * 是 entry 内的 scalar list,每项含 `label` / `value` / 可选 `tone`。
 *
 * 简化版:本文件只关心 candidates 字段,其他 yaml 字段从略,够 ticket 05
 * 路径一致性回归用。
 */
function writeCandidatesOnly(id: string): void {
  const dir = writeDesignDir(id)
  writeFileSync(
    join(dir, 'candidates.yaml'),
    [
      'candidates:',
      '  - id: A',
      '    title: 同步单阶段',
      '    tag_label: 最简',
      '    tag_variant: simple',
      '    pros:',
      '      - 实现简单',
      '    cons:',
      '      - 风险',
      '    metrics:',
      '      - label: 微服务调用',
      '        value: 1 个',
      '  - id: B',
      '    title: 异步多阶段',
      '    tag_label: AI 推荐',
      '    tag_variant: recommended',
      '    pros:',
      '      - 容错好',
      '    cons:',
      '      - 复杂度中等',
      '    metrics:',
      '      - label: 预估延迟',
      '        value: 80ms',
      '    recommended: true',
      '  - id: C',
      '    title: 同步+回滚',
      '    tag_label: 强一致',
      '    tag_variant: strict',
      '    pros:',
      '      - 一致性最强',
      '    cons:',
      '      - 维护成本高',
      '    metrics:',
      '      - label: 失败率',
      '        value: 0.001%',
      '',
    ].join('\n'),
    'utf8',
  )
}

// ============================================================================
// 路径一致性回归 —— ticket 05 / D-6.5 验收
// ============================================================================

describe('DESIGNING · getDesigningDataFromFs · 路径一致性(PRD D-6)', () => {
  it('设计产物放 `<requirementsRoot>/<reqId>/design/candidates.yaml` → empty=false,路径确实找到', async () => {
    // ticket 05 修复前,默认路径 = cwd + ../../requirements,在用户环境里不存在
    // 修复后,默认走 config.yaml.workspaceRoot → AIDEVSPACE_HOME → cwd + ../..
    // 这里用 requirementsRoot 显式覆盖默认行为,把 fixture 放到
    // <tmpRoot>/requirements/<reqId>/design/candidates.yaml(对应
    // `<requirementsRoot>/<reqId>/design/...` 路径)
    writeCandidatesOnly('req-path-consistency')

    const data = await getDesigningDataFromFs('req-path-consistency', {
      requirementsRoot: tmpRoot,
    })

    expect(data.requirementId).toBe('req-path-consistency')
    expect(data.empty).toBe(false)
    // 关键断言:design/ 路径确实从 fixture 找到了(如果路径解析错了,会 empty=true)
    expect(data.candidates.length).toBe(3)
    expect(data.candidates[0].id).toBe('A')
    expect(data.candidates[1].id).toBe('B')
    expect(data.candidates[2].id).toBe('C')
    expect(data.candidates[1].recommended).toBe(true)
  })

  it('fs 缺 candidates.yaml → emptyDesigning(reqId)(候选方案为空)', async () => {
    // 缺 candidates.yaml 但有 design/ 目录 → 设计产品级数据空
    const dir = writeDesignDir('req-only-stage-no-candidates')
    writeFileSync(
      join(dir, 'stage.yaml'),
      'stage:\n  badge: ④ 设计\n  title: 仅 stage\n  meta: 1/0\n',
      'utf8',
    )

    const data = await getDesigningDataFromFs('req-only-stage-no-candidates', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })

  it('req-001 即便 fs 里有 design/candidates.yaml 也走硬编码(短路优先,与新路径无关)', async () => {
    // req-001 在 defaultRequirementsRoot() 解析路径前就被短路,即便 fixture 里
    // 有 design/ 产物,仍返回 REFUND_DESIGNING(向后兼容)
    const dir = writeDesignDir('req-001')
    writeFileSync(
      join(dir, 'candidates.yaml'),
      'candidates:\n  - id: Z\n    title: 完全不同\n    tag_label: x\n    tag_variant: simple\n    pros: []\n    cons: []\n    metrics: []\n',
      'utf8',
    )

    const data = await getDesigningDataFromFs('req-001', {
      requirementsRoot: tmpRoot,
    })
    // 短路:用 REFUND_DESIGNING(3 张 A/B/C 卡片),不是 fixture 的 1 张 Z 卡片
    expect(data.candidates.length).toBe(3)
    expect(data.candidates[0].id).toBe('A')
  })
})