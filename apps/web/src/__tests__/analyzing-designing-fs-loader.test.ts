/**
 * ANALYZING + DESIGNING fs loader 测试
 * (对应 issue: zone-data-fidelity-fixes · 02)
 *
 * 文件名带 `analyzing-designing` 子串是为了让 ticket 字面验收命令
 * `pnpm --filter web test analyzing-designing` 能匹配到本文件。
 *
 * 验收点(对应 ticket 02 / ANALYZING 部分):
 * - caller 不传 options 时,自动注入 analysisDir = <requirementsRoot>/<reqId>/analysis
 *   + analysisSessionsDir = analysis/sessions
 * - 显式传 options 仍可覆盖(后续 agent API 接管的入口)
 * - req-001 命中硬编码 mock 的短路仍在 default options 注入**之前**
 *
 * 验收点(对应 ticket 02 / DESIGNING 部分):
 * - design/ 目录不存在 → emptyDesigning(reqId)
 * - design/ 存在但 candidates.yaml 缺失 → emptyDesigning(reqId)
 * - 4 个 yaml(stage / candidates / design_doc / tradeoff)齐备且非空 → 非空
 *   + 字段名跟 REFUND_DESIGNING 内部硬编码逐字段对齐,adapter 做 camelCase 转换
 * - req-001 走硬编码 mock(向后兼容),短路在 fs 检查之前
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
import { getAnalyzingData } from '@/lib/analyzing.server'
import { getDesigningDataFromFs } from '@/lib/designing.server'
import { emptyDesigning } from '@/lib/designing'

// ============================================================================
// fixture 隔离
// ============================================================================

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidevspace-zone-data-'))
})

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
})

/** `tmpRoot` 作为 `requirementsRoot` 传入,代表 `<repo-root>/requirements/`。
 *
 * 所以需求目录直接在 tmpRoot 下(不再嵌 `requirements/`)。两个工位的 fs
 * loader 都遵循同一约定:`<requirementsRoot>/<reqId>/<subDir>`。 */
function writeAnalysisBundle(id: string, opts: { skipIndex?: boolean; skipChunks?: boolean } = {}): void {
  // ticket 05 / D-6 后,requirementsRoot 语义 = workspace 根,需求目录嵌 `requirements/`
  // 中间层(对齐 ADR-0002)。fixture 跟随调整。
  const sessionsDir = join(tmpRoot, 'requirements', id, 'analysis', 'sessions')
  mkdirSync(sessionsDir, { recursive: true })

  if (!opts.skipIndex) {
    writeFileSync(
      join(sessionsDir, '_index.yaml'),
      [
        'sessions:',
        '  - id: sess-arch',
        '    label: 架构',
        '    angle: architecture',
        '    detected_count: 3',
        '    is_streaming: false',
        '',
      ].join('\n'),
      'utf8',
    )
  }

  if (!opts.skipChunks) {
    const sessionDir = join(sessionsDir, 'sess-arch')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      [
        JSON.stringify({
          id: 'c-1',
          ts: '14:23:01',
          label: 'START',
          text: '从 fixture 加载的会话',
          kind: 'narration',
          tone: 'info',
        }),
        '',
      ].join('\n'),
      'utf8',
    )
  }
}

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
 */
function writeFullDesignBundle(id: string): void {
  const dir = writeDesignDir(id)

  writeFileSync(
    join(dir, 'stage.yaml'),
    [
      'stage:',
      '  badge: ④ 设计',
      '  title: 退款功能优化 · DESIGNING',
      '  meta: 等选 3 / 3',
      '',
    ].join('\n'),
    'utf8',
  )

  writeFileSync(
    join(dir, 'candidates.yaml'),
    [
      'candidates:',
      '  - id: A',
      '    title: 同步单阶段',
      '    tag_label: 最简',
      '    tag_variant: simple',
      '    pros:',
      '      - 实现简单,链路短',
      '      - 易于调试与回归',
      '      - 团队上手成本最低',
      '    cons:',
      '      - 高并发下性能差',
      '      - 失败率受雪崩影响',
      '    metrics:',
      '      - label: 微服务调用',
      '        value: 3 个',
      '      - label: 预估延迟',
      '        value: 250ms',
      '      - label: 失败率',
      '        value: 0.1%',
      '  - id: B',
      '    title: 异步多阶段',
      '    tag_label: AI 推荐',
      '    tag_variant: recommended',
      '    pros:',
      '      - 容错好,可重试补偿',
      '      - 性能优,吞吐高',
      '      - 生产级可观测',
      '    cons:',
      '      - 复杂度中等,需补一套事件总线',
      '      - 调试链路较长',
      '    metrics:',
      '      - label: 微服务调用',
      '        value: 7 个',
      '      - label: 预估延迟',
      '        value: 80ms',
      '        tone: good',
      '      - label: 失败率',
      '        value: 0.01%',
      '        tone: good',
      '    recommended: true',
      '  - id: C',
      '    title: 同步+回滚',
      '    tag_label: 强一致',
      '    tag_variant: strict',
      '    pros:',
      '      - 一致性最强,事务完整',
      '      - 失败率极低',
      '    cons:',
      '      - 复杂度与维护成本高',
      '      - 对团队强事务经验有要求',
      '    metrics:',
      '      - label: 微服务调用',
      '        value: 5 个',
      '      - label: 预估延迟',
      '        value: 320ms',
      '      - label: 失败率',
      '        value: 0.001%',
      '',
    ].join('\n'),
    'utf8',
  )

  writeFileSync(
    join(dir, 'design_doc.yaml'),
    [
      'design_doc:',
      '  title: 退款功能 · 设计文档',
      '  markdown: |',
      '    ## 问题背景',
      '    退款链路当前调用 5 个微服务,平均耗时 12 分钟。',
      '    ## 范围',
      '    覆盖三种候选方案的取舍。',
      '  toc:',
      '    - id: 问题背景',
      '      label: 问题背景',
      '      level: 0',
      '    - id: 范围',
      '      label: 范围',
      '      level: 0',
      '',
    ].join('\n'),
    'utf8',
  )

  writeFileSync(
    join(dir, 'tradeoff.yaml'),
    [
      'tradeoff:',
      '  rows:',
      '    - candidate_id: A',
      '      summary: 简单但性能差,适合低频场景',
      '    - candidate_id: B',
      '      summary: 复杂度中等但生产级,容错与性能兼顾',
      '    - candidate_id: C',
      '      summary: 强一致但维护成本高',
      '  recommendation_candidate_id: B',
      '  recommendation_reason: 综合性能 + 容错,推荐 B(异步多阶段)',
      '',
    ].join('\n'),
    'utf8',
  )
}

// ============================================================================
// ANALYZING · 默认 options 自动注入(核心 seam)
// ============================================================================

describe('ANALYZING · getAnalyzingData · 默认 options 自动注入', () => {
  it('不传 options 时,自动从 requirementsRoot 注入 analysisDir + analysisSessionsDir', async () => {
    writeAnalysisBundle('req-fs-1')

    const data = await getAnalyzingData('req-fs-1', { requirementsRoot: tmpRoot })

    // sessions 来自 fs 的 _index.yaml(1 条)而非默认单会话
    expect(data.empty).toBe(false) // 装配过的非空
    expect(data.sessions.length).toBe(1)
    expect(data.sessions[0].id).toBe('sess-arch')
    expect(data.sessions[0].label).toBe('架构')
    expect(data.activeSessionId).toBe('sess-arch')
  })

  it('默认注入的 sessionsDir 解析到 analysis/sessions 子目录(chunks.jsonl 可读)', async () => {
    writeAnalysisBundle('req-fs-2')
    const data = await getAnalyzingData('req-fs-2', { requirementsRoot: tmpRoot })
    // sessions 列表成功加载即说明默认 analysisSessionsDir 路径生效
    expect(data.sessions[0].id).toBe('sess-arch')
  })

  it('不传 options 且 fs 不存在 → 退回到 defaultSessionsBundle()(id="default")', async () => {
    const data = await getAnalyzingData('req-fs-missing', { requirementsRoot: tmpRoot })
    expect(data.sessions.length).toBe(1)
    expect(data.sessions[0].id).toBe('default')
    expect(data.activeSessionId).toBe('default')
  })

  it('不传 options 且 _index.yaml 不存在 → 退回 defaultSessionsBundle()', async () => {
    writeAnalysisBundle('req-fs-noindex', { skipIndex: true })
    const data = await getAnalyzingData('req-fs-noindex', { requirementsRoot: tmpRoot })
    expect(data.sessions[0].id).toBe('default')
  })
})

// ============================================================================
// ANALYZING · 显式 options 仍可覆盖(后续 agent API 入口)
// ============================================================================

describe('ANALYZING · getAnalyzingData · 显式 options 覆盖', () => {
  it('显式传 analysisSessionsDir 时,默认注入不生效(用调用方路径)', async () => {
    const customDir = join(tmpRoot, 'custom-sessions')
    mkdirSync(customDir, { recursive: true })
    writeFileSync(
      join(customDir, '_index.yaml'),
      [
        'sessions:',
        '  - id: sess-custom',
        '    label: 自定义会话',
        '    angle: custom',
        '    detected_count: 1',
        '    is_streaming: false',
        '',
      ].join('\n'),
      'utf8',
    )

    const data = await getAnalyzingData('req-custom-dir', {
      analysisSessionsDir: customDir,
      requirementsRoot: tmpRoot,
    })

    expect(data.sessions.length).toBe(1)
    expect(data.sessions[0].id).toBe('sess-custom')
    expect(data.sessions[0].label).toBe('自定义会话')
  })

  it('显式 lastSessionId 命中 sessions 列表 → activeSessionId 取显式值', async () => {
    mkdirSync(join(tmpRoot, 'requirements', 'req-multi', 'analysis', 'sessions'), { recursive: true })
    writeFileSync(
      join(tmpRoot, 'requirements', 'req-multi', 'analysis', 'sessions', '_index.yaml'),
      [
        'sessions:',
        '  - id: sess-a',
        '    label: A',
        '    angle: architecture',
        '    detected_count: 1',
        '    is_streaming: false',
        '  - id: sess-b',
        '    label: B',
        '    angle: data',
        '    detected_count: 2',
        '    is_streaming: false',
        '',
      ].join('\n'),
      'utf8',
    )

    const data = await getAnalyzingData('req-multi', {
      lastSessionId: 'sess-b',
      requirementsRoot: tmpRoot,
    })

    expect(data.sessions.length).toBe(2)
    expect(data.activeSessionId).toBe('sess-b')
  })

  it('lastSessionId 不在 sessions 列表中 → 退到 sessions[0].id(透传逻辑不变)', async () => {
    writeAnalysisBundle('req-multi-fallback')
    const data = await getAnalyzingData('req-multi-fallback', {
      lastSessionId: 'sess-不存在',
      requirementsRoot: tmpRoot,
    })
    expect(data.activeSessionId).toBe('sess-arch')
  })
})

// ============================================================================
// ANALYZING · req-001 硬编码 mock 仍在 default options 注入之前判定
// ============================================================================

describe('ANALYZING · getAnalyzingData · req-001 硬编码 mock 短路', () => {
  it('req-001 即使 requirementsRoot 下没有 fs 内容,也走 REFUND_ANALYZING(短路优先)', async () => {
    const data = await getAnalyzingData('req-001', { requirementsRoot: tmpRoot })

    expect(data.requirementId).toBe('req-001')
    expect(data.empty).toBe(false)
    expect(data.sessions.length).toBe(3)
    expect(data.activeSessionId).toBe('sess-data')
  })

  it('req-001 即便 fs 里有 _index.yaml,也不读 fs(短路在 default options 注入之前)', async () => {
    writeAnalysisBundle('req-001')
    const data = await getAnalyzingData('req-001', { requirementsRoot: tmpRoot })
    expect(data.sessions.length).toBe(3)
    expect(data.sessions[0].id).toBe('sess-arch')
    expect(data.activeSessionId).toBe('sess-data')
  })
})

// ============================================================================
// DESIGNING · 状态 1:design/ 目录不存在
// ============================================================================

describe('DESIGNING · getDesigningDataFromFs · design/ 目录不存在', () => {
  it('目录里没有 design/ → emptyDesigning(reqId)', async () => {
    const data = await getDesigningDataFromFs('req-no-design', {
      requirementsRoot: tmpRoot,
    })
    expect(data.requirementId).toBe('req-no-design')
    expect(data.empty).toBe(true)
    expect(data.candidates).toEqual([])
    expect(data.designDoc.markdown).toBe('')
    expect(data.tradeoff.rows).toEqual([])
  })

  it('requirements/ 目录根本不存在 → emptyDesigning', async () => {
    const data = await getDesigningDataFromFs('req-no-requirements', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })
})

// ============================================================================
// DESIGNING · 状态 2:design/ 存在但 candidates.yaml 缺失
// ============================================================================

describe('DESIGNING · getDesigningDataFromFs · design/ 存在但 candidates.yaml 缺失', () => {
  it('只建 design/ 空目录 → emptyDesigning', async () => {
    writeDesignDir('req-empty-design')
    const data = await getDesigningDataFromFs('req-empty-design', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })

  it('design/ 里只写 design_doc.yaml 但缺 candidates.yaml → emptyDesigning', async () => {
    const dir = writeDesignDir('req-only-design-doc')
    writeFileSync(join(dir, 'design_doc.yaml'), 'design_doc:\n  title: x\n  markdown: y\n', 'utf8')
    const data = await getDesigningDataFromFs('req-only-design-doc', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })

  it('candidates.yaml 存在但为空 → emptyDesigning(必需 yaml 非空判定)', async () => {
    const dir = writeDesignDir('req-empty-yaml')
    writeFileSync(join(dir, 'candidates.yaml'), '', 'utf8')
    const data = await getDesigningDataFromFs('req-empty-yaml', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })
})

// ============================================================================
// DESIGNING · 状态 3:四个 yaml 齐备且非空 → 非空,字段名对齐 REFUND_DESIGNING
// ============================================================================

describe('DESIGNING · getDesigningDataFromFs · 四 yaml 齐备且非空', () => {
  it('stage + candidates + design_doc + tradeoff 齐备 → empty=false,字段正确解析', async () => {
    writeFullDesignBundle('req-full')

    const data = await getDesigningDataFromFs('req-full', {
      requirementsRoot: tmpRoot,
    })

    expect(data.requirementId).toBe('req-full')
    expect(data.empty).toBe(false)

    // stage 字段
    expect(data.stage.badge).toBe('④ 设计')
    expect(data.stage.title).toContain('DESIGNING')
    expect(data.stage.meta).toBe('等选 3 / 3')

    // candidates 字段 — 3 张卡片,id 顺序 A/B/C
    expect(data.candidates.length).toBe(3)
    expect(data.candidates[0].id).toBe('A')
    expect(data.candidates[0].title).toBe('同步单阶段')
    expect(data.candidates[0].tag.variant).toBe('simple')
    expect(data.candidates[0].pros.length).toBeGreaterThan(0)
    expect(data.candidates[0].cons.length).toBeGreaterThan(0)
    expect(data.candidates[0].metrics.length).toBe(3)
    expect(data.candidates[0].metrics[0].label).toBe('微服务调用')
    expect(data.candidates[0].recommended).toBeFalsy()

    // B 是 AI 推荐
    expect(data.candidates[1].id).toBe('B')
    expect(data.candidates[1].recommended).toBe(true)
    expect(data.candidates[1].tag.variant).toBe('recommended')
    // B 的 metrics 中含 tone: good 的项(adapter 把 snake_case 'tone' 字段保留为 'tone')
    const goodMetric = data.candidates[1].metrics.find((m) => m.tone === 'good')
    expect(goodMetric).toBeDefined()

    // designDoc 字段
    expect(data.designDoc.title).toBe('退款功能 · 设计文档')
    expect(data.designDoc.markdown).toContain('问题背景')
    expect(data.designDoc.markdown).toContain('范围')
    expect(data.designDoc.toc.length).toBeGreaterThanOrEqual(2)

    // tradeoff 字段 — 3 行 + AI 推荐 B
    expect(data.tradeoff.rows.length).toBe(3)
    expect(data.tradeoff.rows[0].candidateId).toBe('A')
    expect(data.tradeoff.rows[1].candidateId).toBe('B')
    expect(data.tradeoff.rows[2].candidateId).toBe('C')
    expect(data.tradeoff.recommendation.candidateId).toBe('B')
    expect(data.tradeoff.recommendation.reason).toContain('B')
  })

  it('selectedCandidateId 默认 null(组件 useState 接管)', async () => {
    writeFullDesignBundle('req-selected')
    const data = await getDesigningDataFromFs('req-selected', {
      requirementsRoot: tmpRoot,
    })
    expect(data.selectedCandidateId).toBeNull()
  })

  it('toolbar crumb 反映 reqId + 方案评审(current)', async () => {
    writeFullDesignBundle('req-crumb')
    const data = await getDesigningDataFromFs('req-crumb', {
      requirementsRoot: tmpRoot,
    })
    expect(data.toolbar.crumb.length).toBeGreaterThan(0)
    const current = data.toolbar.crumb.find((c) => c.current)
    expect(current).toBeDefined()
    expect(current!.label).toBe('方案评审')
  })

  it('缺 design_doc.yaml → 仍可能非空(candidates + tradeoff 存在即可)', async () => {
    // 验收点写"任一必需 yaml 缺失 → emptyDesigning";但 candidates.yaml 是
    // 单一必需判定项(空 = 没方案);design_doc.yaml / tradeoff.yaml / stage.yaml
    // 缺失 → 用空兜底,数据本身仍算"非空"(对齐 PRD D-1.2 / T-2.2:仅
    // candidates.yaml 必需,其他 3 个走空兜底)
    const dir = writeDesignDir('req-only-candidates')
    writeFileSync(
      join(dir, 'candidates.yaml'),
      [
        'candidates:',
        '  - id: A',
        '    title: 单方案',
        '    tag_label: 最简',
        '    tag_variant: simple',
        '    pros:',
        '      - 简单',
        '    cons:',
        '      - 风险',
        '    metrics:',
        '      - label: 微服务调用',
        '        value: 1 个',
        '',
      ].join('\n'),
      'utf8',
    )

    const data = await getDesigningDataFromFs('req-only-candidates', {
      requirementsRoot: tmpRoot,
    })

    expect(data.empty).toBe(false)
    expect(data.candidates.length).toBe(1)
    // design_doc / tradeoff / stage 缺失 → 走空兜底
    expect(data.designDoc.title).toBe('')
    expect(data.tradeoff.rows).toEqual([])
  })
})

// ============================================================================
// DESIGNING · 状态 4:req-001 硬编码 mock 短路
// ============================================================================

describe('DESIGNING · getDesigningDataFromFs · req-001 硬编码 mock', () => {
  it('即使 requirementsRoot 下没有 design/ 目录,仍拿到完整 REFUND_DESIGNING', async () => {
    const data = await getDesigningDataFromFs('req-001', {
      requirementsRoot: tmpRoot,
    })

    expect(data.requirementId).toBe('req-001')
    expect(data.empty).toBe(false)
    expect(data.candidates.length).toBe(3)
    expect(data.candidates[0].id).toBe('A')
    expect(data.candidates[1].recommended).toBe(true)
    expect(data.designDoc.title).toContain('设计文档')
    expect(data.tradeoff.rows.length).toBe(3)
  })

  it('req-001 即便 fs 里有 design/ 内容,也不读 fs(短路在 fs 检查之前)', async () => {
    const dir = writeDesignDir('req-001')
    writeFileSync(
      join(dir, 'candidates.yaml'),
      'candidates:\n  - id: Z\n    title: 完全不同的内容\n    tag_label: 最简\n    tag_variant: simple\n    pros: []\n    cons: []\n    metrics: []\n',
      'utf8',
    )

    const data = await getDesigningDataFromFs('req-001', {
      requirementsRoot: tmpRoot,
    })

    expect(data.candidates.length).toBe(3)
    expect(data.candidates[0].id).toBe('A')
    expect(data.candidates[2].id).toBe('C')
  })
})

// ============================================================================
// DESIGNING · 与 designing.ts 原 getDesigningData 行为对齐
// ============================================================================

describe('DESIGNING · getDesigningDataFromFs · 与原 getDesigningData 行为对齐', () => {
  it('req-001 走 fs loader 与原 getDesigningData(req-001) 返回等价(向后兼容)', async () => {
    const { getDesigningData } = await import('@/lib/designing')
    const a = await getDesigningData('req-001')
    const b = await getDesigningDataFromFs('req-001', { requirementsRoot: tmpRoot })

    expect(a.candidates.length).toBe(b.candidates.length)
    expect(a.candidates.map((c) => c.id)).toEqual(b.candidates.map((c) => c.id))
    expect(a.tradeoff.rows.length).toBe(b.tradeoff.rows.length)
  })

  it('非 req-001 且 fs 没有 → emptyDesigning(reqId)(语义与 emptyDesigning("NEW-REQ")一致)', async () => {
    const fromFs = await getDesigningDataFromFs('NEW-REQ', { requirementsRoot: tmpRoot })
    const baseline = emptyDesigning('NEW-REQ')
    expect(fromFs.empty).toBe(baseline.empty)
    expect(fromFs.candidates).toEqual(baseline.candidates)
    expect(fromFs.designDoc.markdown).toBe(baseline.designDoc.markdown)
  })
})

// 注:ticket 05 / D-6.5 的 DESIGNING 路径一致性用例迁出到独立文件
// `apps/web/src/__tests__/designing.server.test.ts`,符合 PRD T-2.2 / ticket 05 AC
// "追加用例:fixture `design/candidates.yaml` + config 指向 fixture,断言读到非空
// candidates 时 `empty === false`(路径确实找到了)"的文件路径要求。
