import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyAnalyzing,
  summarizeAnalyzingStats,
  resolveAdmissionDimensions,
  deriveProducts,
  type AnalyzingChunk,
  type AnalyzingData,
} from '@/lib/analyzing'
import {
  getAnalyzingData,
  countPendingAdjudications,
  loadSessionChunks,
} from '@/lib/analyzing.server'

// ============================================================================
// summarizeAnalyzingStats — 纯函数(从 chunks 聚合 stats)
// ============================================================================

describe('summarizeAnalyzingStats', () => {
  it('空数组 → 全 0', () => {
    expect(summarizeAnalyzingStats([])).toEqual({
      subproblems: 0,
      risks: 0,
      options: 0,
      total: 0,
    })
  })

  it('按 kind 计数 subproblem / risk / option;narration 不计入', () => {
    const chunks: AnalyzingChunk[] = [
      mk('c1', 'narration'),
      mk('c2', 'subproblem'),
      mk('c3', 'subproblem'),
      mk('c4', 'risk'),
      mk('c5', 'option'),
      mk('c6', 'narration'),
    ]
    const stats = summarizeAnalyzingStats(chunks)
    expect(stats.subproblems).toBe(2)
    expect(stats.risks).toBe(1)
    expect(stats.options).toBe(1)
    expect(stats.total).toBe(4)
  })

  it('只统计 subproblem / risk / option 三类,其他 kind 视为 narration 不计入', () => {
    // 故意混入未知 kind(TS 编译不阻止的话,在运行时退化为 narration 分支)
    const chunks = [
      mk('c1', 'narration'),
      mk('c2', 'subproblem'),
    ] as AnalyzingChunk[]
    const stats = summarizeAnalyzingStats(chunks)
    expect(stats.subproblems).toBe(1)
    expect(stats.risks).toBe(0)
    expect(stats.options).toBe(0)
    expect(stats.total).toBe(1)
  })

  it('不会因 input 非数组崩:接受 readonly 数组', () => {
    const arr: readonly AnalyzingChunk[] = Object.freeze([
      mk('c1', 'option'),
    ])
    expect(summarizeAnalyzingStats(arr).options).toBe(1)
  })
})

// ============================================================================
// emptyAnalyzing — 空态构造器
// ============================================================================

describe('emptyAnalyzing', () => {
  it('返回 empty=true,requirementId 回填', () => {
    const data = emptyAnalyzing('NEW-REQ')
    expect(data.empty).toBe(true)
    expect(data.requirementId).toBe('NEW-REQ')
  })

  it('所有 chunks 为空,stats 全 0,streamMeta 反映无流', () => {
    const data = emptyAnalyzing('X')
    expect(data.chunks).toEqual([])
    expect(data.stats).toEqual({
      subproblems: 0,
      risks: 0,
      options: 0,
      total: 0,
    })
    expect(data.streamMeta.totalChunks).toBe(0)
    expect(data.streamMeta.isStreaming).toBe(false)
  })

  it('toolbar / summary 字段都为空字符串或空数组', () => {
    const data = emptyAnalyzing('X')
    expect(data.toolbar.crumb).toEqual([])
    expect(data.toolbar.actions).toEqual([])
    expect(data.summary.icon).toBe('')
    expect(data.summary.title).toBe('')
    expect(data.summary.description).toBe('')
  })
})

// ============================================================================
// getAnalyzingData — mock 拉取(后续接 agent API 时替换函数体)
// ============================================================================

describe('getAnalyzingData', () => {
  it('req-001 → 返回示例数据,empty=false', async () => {
    const data = await getAnalyzingData('req-001')
    expect(data.empty).toBe(false)
    expect(data.requirementId).toBe('req-001')
  })

  it('req-001 → toolbar 含 copy + pause + reset 三动作(按 variant 渲染)', async () => {
    const data = await getAnalyzingData('req-001')
    expect(data.toolbar.actions.length).toBe(3)
    const labels = data.toolbar.actions.map((a) => a.label)
    expect(labels.some((l) => l?.includes('复制'))).toBe(true)
    expect(labels.some((l) => l?.includes('暂停'))).toBe(true)
    expect(labels.some((l) => l?.includes('重置'))).toBe(true)
  })

  it('req-001 → summary 含 icon + title + description 三字段', async () => {
    const data = await getAnalyzingData('req-001')
    expect(data.summary.icon).toBe('🧠')
    expect(data.summary.title.length).toBeGreaterThan(0)
    expect(data.summary.description.length).toBeGreaterThan(0)
  })

  it('req-001 → 17 个 chunks,含 5 subproblem + 3 risk + 2 option', async () => {
    const data = await getAnalyzingData('req-001')
    expect(data.chunks.length).toBe(17)
    const stats = summarizeAnalyzingStats(data.chunks)
    expect(stats.subproblems).toBe(5)
    expect(stats.risks).toBe(3)
    expect(stats.options).toBe(2)
  })

  it('req-001 → streamMeta.totalChunks 与 chunks.length 一致', async () => {
    const data = await getAnalyzingData('req-001')
    expect(data.streamMeta.totalChunks).toBe(data.chunks.length)
    expect(data.streamMeta.isStreaming).toBe(true)
    expect(data.streamMeta.startedAt.length).toBeGreaterThan(0)
    expect(data.streamMeta.endedAt).toBeNull()
  })

  it('req-001 → 最后一 chunk 为 COMPLETE,kind=narration', async () => {
    const data = await getAnalyzingData('req-001')
    const last = data.chunks[data.chunks.length - 1]
    expect(last.label).toBe('COMPLETE')
    expect(last.kind).toBe('narration')
  })

  it('未知 id → empty=true', async () => {
    const data = await getAnalyzingData('UNKNOWN-ID')
    expect(data.empty).toBe(true)
    expect(data.requirementId).toBe('UNKNOWN-ID')
  })

  it('未知 id 不抛错,正常返回', async () => {
    await expect(getAnalyzingData('any-string')).resolves.toBeDefined()
  })
})

// ============================================================================
// 边界:输入异常不应让后续聚合函数崩
// ============================================================================

describe('AnalyzingData · 极端输入', () => {
  it('空 toolbar / 空 chunks 的 partial 对象也能跑 summarize', () => {
    const partial: Pick<AnalyzingData, 'chunks'> = { chunks: [] }
    expect(summarizeAnalyzingStats(partial.chunks).total).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function mk(id: string, kind: AnalyzingChunk['kind']): AnalyzingChunk {
  return {
    id,
    ts: '14:23:00',
    label: 'START',
    text: 'x',
    kind,
    tone: 'info',
  }
}

// ============================================================================
// resolveAdmissionDimensions — Skill frontmatter 维度装配(ADR-0013 D10)
// ============================================================================

describe('resolveAdmissionDimensions', () => {
  it('Skill 未提供 override → 默认 5 维度按 DEFAULT_ADMISSION_DIMENSIONS 顺序', () => {
    const dims = resolveAdmissionDimensions(undefined)
    expect(dims).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
    ])
  })

  it('Skill override.skip 跳过默认维度 → 跳过的不渲染', () => {
    const dims = resolveAdmissionDimensions({
      admission_override: { add: [], skip: ['business_reasonable'] },
    })
    expect(dims).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'context_query',
    ])
    expect(dims).not.toContain('business_reasonable')
  })

  it('Skill override.add 新增维度 → 排在默认维度之后', () => {
    const dims = resolveAdmissionDimensions({
      admission_override: { add: ['coupon_consistency'], skip: [] },
    })
    expect(dims).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
      'coupon_consistency',
    ])
  })

  it('Skill 同时 add + skip → 默认 - skip + add', () => {
    const dims = resolveAdmissionDimensions({
      admission_override: {
        add: ['coupon_consistency', 'refund_window'],
        skip: ['business_reasonable', 'context_query'],
      },
    })
    expect(dims).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'coupon_consistency',
      'refund_window',
    ])
  })

  it('Skill admission_dimensions 声明关注的维度(子集化)→ 仅取该子集,保持声明顺序', () => {
    // 允许 Skill 显式声明它关心的维度(不依赖全局默认 5 维度)
    const dims = resolveAdmissionDimensions({
      admission_dimensions: ['loss_prevention', 'arch_conflict'],
    })
    expect(dims).toEqual(['loss_prevention', 'arch_conflict'])
  })

  it('Skill admission_dimensions + override.skip → 子集 - skip', () => {
    const dims = resolveAdmissionDimensions({
      admission_dimensions: [
        'loss_prevention',
        'performance',
        'arch_conflict',
        'business_reasonable',
      ],
      admission_override: { add: [], skip: ['business_reasonable'] },
    })
    expect(dims).toEqual(['loss_prevention', 'performance', 'arch_conflict'])
  })

  it('空 frontmatter → 等同 undefined,默认 5 维度', () => {
    const dims = resolveAdmissionDimensions({})
    expect(dims).toHaveLength(5)
  })

  it('add 含重复项 → 去重(保持首次出现位置)', () => {
    const dims = resolveAdmissionDimensions({
      admission_override: { add: ['coupon_consistency', 'coupon_consistency'], skip: [] },
    })
    expect(dims.filter((d) => d === 'coupon_consistency')).toHaveLength(1)
  })
})

// ============================================================================
// countPendingAdjudications — 读 analysis/adjudication.md 计数 applied: false 项
// ============================================================================

// ============================================================================
// deriveProducts — 从 chunks 派生识别产物(issue 19b VS2 只读视图)
// ============================================================================

describe('deriveProducts', () => {
  it('空 chunks → 三类均为空', () => {
    const g = deriveProducts([])
    expect(g.subproblems).toEqual([])
    expect(g.risks).toEqual([])
    expect(g.options).toEqual([])
  })

  it('按 kind 分类:subproblem → subproblems,risk → risks,option → options', () => {
    const g = deriveProducts([
      mk('q1', 'subproblem'),
      mk('q2', 'subproblem'),
      mk('r1', 'risk'),
      mk('o1', 'option'),
    ])
    expect(g.subproblems).toHaveLength(2)
    expect(g.risks).toHaveLength(1)
    expect(g.options).toHaveLength(1)
  })

  it('narration 不被归入任一产品桶(仅作为思考流可见)', () => {
    const g = deriveProducts([mk('n1', 'narration'), mk('n2', 'narration')])
    expect(g.subproblems).toHaveLength(0)
    expect(g.risks).toHaveLength(0)
    expect(g.options).toHaveLength(0)
  })

  it('severity 从 tone 反查:warn→orange / err→red / success→green / info→blue', () => {
    const g = deriveProducts([
      { ...mk('q1', 'subproblem'), tone: 'warn' },
      { ...mk('r1', 'risk'), tone: 'err' },
      { ...mk('o1', 'option'), tone: 'success' },
    ])
    expect(g.subproblems[0].severity).toBe('orange')
    expect(g.risks[0].severity).toBe('red')
    expect(g.options[0].severity).toBe('green')
  })

  it('单行 text → title = text,无 description', () => {
    const g = deriveProducts([{ ...mk('q1', 'subproblem'), text: '退款金额上限?' }])
    expect(g.subproblems[0].title).toBe('退款金额上限?')
    expect(g.subproblems[0].description).toBeUndefined()
  })

  it('多行 text → title = 第一行,description = 余下', () => {
    const g = deriveProducts([
      {
        ...mk('r1', 'risk'),
        text: '退款幂等键冲突\n可能导致重复退款\n影响金额计算',
      },
    ])
    const item = g.risks[0]
    expect(item.title).toBe('退款幂等键冲突')
    expect(item.description).toBe('可能导致重复退款\n影响金额计算')
  })

  it('id 与原 chunk.id 一致(便于后续 VS4 编辑/删除)', () => {
    const g = deriveProducts([mk('q-stable', 'subproblem')])
    expect(g.subproblems[0].id).toBe('q-stable')
  })

  it('req-001 mock 样例 → 5 子问题 + 3 风险 + 2 方案(与 stats 一致)', async () => {
    const data = await getAnalyzingData('req-001')
    const g = deriveProducts(data.chunks)
    expect(g.subproblems).toHaveLength(5)
    expect(g.risks).toHaveLength(3)
    expect(g.options).toHaveLength(2)
  })
})

describe('countPendingAdjudications', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'analyzing-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('文件不存在 → 0', () => {
    expect(countPendingAdjudications(tmpDir)).toBe(0)
  })

  it('空文件 → 0', () => {
    writeFileSync(join(tmpDir, 'adjudication.md'), '')
    expect(countPendingAdjudications(tmpDir)).toBe(0)
  })

  it('文件含 2 项 applied:false + 1 项 applied:true → 计数 2', () => {
    writeFileSync(
      join(tmpDir, 'adjudication.md'),
      [
        '---',
        'created: 2026-07-12T14:23:01+08:00',
        '---',
        '',
        '# 待裁决项',
        '',
        '## 待裁决',
        '',
        '- item_id: q-1',
        '  question: 退款金额上限?',
        '  answer: 5000',
        '  applied: false',
        '',
        '- item_id: q-2',
        '  question: 退款审核流?',
        '  answer: 自动',
        '  applied: false',
        '',
        '## 已裁决',
        '',
        '- item_id: q-0',
        '  question: 退款币种?',
        '  answer: CNY',
        '  applied: true',
        '',
      ].join('\n'),
    )
    expect(countPendingAdjudications(tmpDir)).toBe(2)
  })

  it('未提供 applied 字段的行 → 视为待裁决(保守计数)', () => {
    writeFileSync(
      join(tmpDir, 'adjudication.md'),
      '- item_id: q-1\n  question: foo?\n  answer: bar\n',
    )
    expect(countPendingAdjudications(tmpDir)).toBe(1)
  })

  it('所有项 applied:true → 0', () => {
    writeFileSync(
      join(tmpDir, 'adjudication.md'),
      '- item_id: q-1\n  applied: true\n- item_id: q-2\n  applied: true\n',
    )
    expect(countPendingAdjudications(tmpDir)).toBe(0)
  })

  it('混合 applied:true / applied:false / 无字段 → 仅 false + 无字段计入', () => {
    writeFileSync(
      join(tmpDir, 'adjudication.md'),
      [
        '- item_id: q-1',
        '  applied: true',
        '- item_id: q-2',
        '  applied: false',
        '- item_id: q-3',
        '  answer: x',
        '',
      ].join('\n'),
    )
    expect(countPendingAdjudications(tmpDir)).toBe(2)
  })
})

// ============================================================================
// loadSessionChunks — 读 analysis/sessions/<session-id>/chunks.jsonl(issue 19b 验收 #12)
// ============================================================================

describe('loadSessionChunks', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'analyzing-chunks-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('会话文件不存在 → 返回空数组(容错)', () => {
    expect(loadSessionChunks(tmpDir, 'sess-arch')).toEqual([])
  })

  it('空文件 → 返回空数组', () => {
    const sessionDir = join(tmpDir, 'sess-arch')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'chunks.jsonl'), '')
    expect(loadSessionChunks(tmpDir, 'sess-arch')).toEqual([])
  })

  it('3 行 JSONL → 3 条 chunk,字段正确还原', () => {
    const sessionDir = join(tmpDir, 'sess-arch')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      [
        JSON.stringify({ id: 'c-1', ts: '14:23:01', label: 'START', kind: 'narration', tone: 'info', text: 'a' }),
        JSON.stringify({ id: 'c-2', ts: '14:23:02', label: 'DETECT', kind: 'subproblem', tone: 'success', text: 'b' }),
        JSON.stringify({ id: 'c-3', ts: '14:23:03', label: 'RISK', kind: 'risk', tone: 'warn', text: 'c' }),
      ].join('\n'),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-arch')
    expect(chunks).toHaveLength(3)
    expect(chunks[0].id).toBe('c-1')
    expect(chunks[1].kind).toBe('subproblem')
    expect(chunks[2].tone).toBe('warn')
  })

  it('中间一行 JSON 损坏 → 跳过该行,继续读后续', () => {
    const sessionDir = join(tmpDir, 'sess-arch')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      [
        JSON.stringify({ id: 'c-1', ts: '14:23:01', label: 'START', kind: 'narration', tone: 'info', text: 'a' }),
        'NOT-JSON{',
        JSON.stringify({ id: 'c-3', ts: '14:23:03', label: 'RISK', kind: 'risk', tone: 'warn', text: 'c' }),
      ].join('\n'),
    )
    const chunks = loadSessionChunks(tmpDir, 'sess-arch')
    expect(chunks).toHaveLength(2)
    expect(chunks.map((c) => c.id)).toEqual(['c-1', 'c-3'])
  })

  it('最小字段集校验:缺关键字段 → 跳过该行', () => {
    const sessionDir = join(tmpDir, 'sess-arch')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chunks.jsonl'),
      [
        JSON.stringify({ id: 'c-1', ts: '14:23:01', label: 'START', kind: 'narration', tone: 'info', text: 'a' }),
        // 缺 text → 跳过
        JSON.stringify({ id: 'c-2', ts: '14:23:02', label: 'DETECT', kind: 'subproblem', tone: 'success' }),
        JSON.stringify({ id: 'c-3', ts: '14:23:03', label: 'RISK', kind: 'risk', tone: 'warn', text: 'c' }),
      ].join('\n'),
    )
    expect(loadSessionChunks(tmpDir, 'sess-arch').map((c) => c.id)).toEqual(['c-1', 'c-3'])
  })

  it('不同 sessionId → 互不干扰', () => {
    const archDir = join(tmpDir, 'sess-arch')
    const dataDir = join(tmpDir, 'sess-data')
    mkdirSync(archDir, { recursive: true })
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(
      join(archDir, 'chunks.jsonl'),
      JSON.stringify({ id: 'c-arch-1', ts: '14:23:01', label: 'START', kind: 'narration', tone: 'info', text: 'arch' }),
    )
    writeFileSync(
      join(dataDir, 'chunks.jsonl'),
      JSON.stringify({ id: 'c-data-1', ts: '14:23:01', label: 'START', kind: 'narration', tone: 'info', text: 'data' }),
    )
    expect(loadSessionChunks(tmpDir, 'sess-arch').map((c) => c.id)).toEqual(['c-arch-1'])
    expect(loadSessionChunks(tmpDir, 'sess-data').map((c) => c.id)).toEqual(['c-data-1'])
  })
})

// ============================================================================
// getAnalyzingData — admission 段集成(issue 19a 验收)
// ============================================================================

describe('getAnalyzingData · admission 段', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'analyzing-get-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('未知 id → admission.pendingAdjudicationCount: 0 + verdict: pending + 5 维度', async () => {
    // issue 19a 验收:"文件不存在时 → pendingAdjudicationCount: 0 + verdict: pending"
    // 未知 id 走 emptyAnalyzing,文件不存在 → 0
    const data = await getAnalyzingData('UNKNOWN-FOR-ADMISSION')
    expect(data.admission.pendingAdjudicationCount).toBe(0)
    expect(data.admission.verdict).toBe('pending')
    expect(data.admission.dimensions.length).toBe(5)
  })

  it('默认 5 维度按 DEFAULT_ADMISSION_DIMENSIONS 顺序渲染(已知 id)', async () => {
    const data = await getAnalyzingData('req-001')
    expect(data.admission.dimensions.map((d) => d.id)).toEqual([
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
    ])
  })

  it('req-001 mock 样例 admission 段含真实 count + verdict=fail(因 2 资损)', async () => {
    const data = await getAnalyzingData('req-001')
    expect(data.admission.dimensions.find((d) => d.id === 'loss_prevention')?.count).toBe(2)
    expect(data.admission.verdict).toBe('fail')
  })

  it('未知 id + 传入 analysisDir 含 applied:false → 真从文件计数', async () => {
    const dir = join(tmpDir, 'UNKNOWN-WITH-FILE')
    mkdirSync(dir)
    writeFileSync(
      join(dir, 'adjudication.md'),
      '- item_id: q-1\n  applied: false\n- item_id: q-2\n  applied: false\n',
    )
    const data = await getAnalyzingData('UNKNOWN-WITH-FILE', { analysisDir: dir })
    expect(data.admission.pendingAdjudicationCount).toBe(2)
  })

  it('未知 id + analysisDir 不存在 → pendingAdjudicationCount: 0(容错)', async () => {
    const data = await getAnalyzingData('UNKNOWN-NO-DIR', { analysisDir: '/nonexistent/path' })
    expect(data.admission.pendingAdjudicationCount).toBe(0)
    expect(data.admission.verdict).toBe('pending')
  })

  it('未知 id + skillFrontmatter.admission_override.skip → 跳过维度', async () => {
    const data = await getAnalyzingData('UNKNOWN-SKILL', {
      skillFrontmatter: {
        admission_override: { add: [], skip: ['business_reasonable'] },
      },
    })
    expect(data.admission.dimensions.map((d) => d.id)).not.toContain('business_reasonable')
    expect(data.admission.dimensions).toHaveLength(4)
  })
})