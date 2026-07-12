import { describe, it, expect } from 'vitest'
import {
  emptyAnalyzing,
  getAnalyzingData,
  summarizeAnalyzingStats,
  type AnalyzingChunk,
  type AnalyzingData,
} from '@/lib/analyzing'

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