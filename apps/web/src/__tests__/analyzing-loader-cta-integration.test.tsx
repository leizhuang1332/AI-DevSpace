/**
 * server loader → AnalyzingZone → 「开始分析」CTA 端到端集成测试
 * (audit-2026-07-26 关键阻塞项 #1 / #2)
 *
 * 为什么需要这一层:既有 ticket 05 单测用**手工构造**的 `sessions: []` 验证
 * CTA 渲染条件,完全绕过了真实的 `getAnalyzingData()` → 组件数据链路。
 * 审计发现真实首次访问其实拿到 `sessions.length === 1`(loader 合成默认会话),
 * 于是 CTA 永远不显示 —— 用户没有任何入口启动分析,而单测全绿。
 *
 * 本文件从**真实文件系统**出发:写 requirement.md / chunks.jsonl,调
 * `getAnalyzingData()`,把返回值直接喂给 `<AnalyzingZone>`,断言用户可见行为。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnalyzingZone } from '@/components/analyzing-zone'
import { getAnalyzingData } from '@/lib/analyzing.server'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'analyzing-cta-'))
})

afterEach(() => {
  cleanup()
  rmSync(root, { recursive: true, force: true })
})

/** 只写 requirement.md —— 模拟"DRAFTING 已完成、还没跑过任何分析"的真实首次访问 */
function seedRequirementOnly(id: string): void {
  const dir = join(root, 'requirements', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'requirement.md'), '# 退款优化\n\n退款单笔金额上限 ≤ 1000 元\n', 'utf8')
}

/** 往 `analysis/sessions/<sid>/chunks.jsonl` 追加行(形态对齐 agent appendChunkToJsonl) */
function seedChunks(id: string, sessionId: string, rows: Record<string, unknown>[]): void {
  const dir = join(root, 'requirements', id, 'analysis', 'sessions', sessionId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'chunks.jsonl'),
    rows.map((r) => JSON.stringify({ ...r, session_id: sessionId })).join('\n') + '\n',
    'utf8',
  )
  writeFileSync(
    join(root, 'requirements', id, 'analysis', 'sessions', '_index.yaml'),
    ['sessions:', `  - id: ${sessionId}`, '    label: 架构', '    angle: architecture', ''].join('\n'),
    'utf8',
  )
}

describe('真实 loader → CTA(audit #1 · issue 01 改造)', () => {
  it('有 requirement.md、无任何 session → 主区渲染且「开始分析」按钮可见', async () => {
    const id = 'req-cta-first-visit'
    seedRequirementOnly(id)

    const data = await getAnalyzingData(id, { requirementsRoot: root })
    // loader 契约:phase active + 真正的空 sessions
    expect(data.phase).toBe('active')
    expect(data.sessions).toEqual([])

    render(<AnalyzingZone data={data} />)
    // issue 01 改造:AdmissionDashboard → AnalysisSkillSelector
    // 注意:tmpdir 没 analysis-skills 目录,SSR 返空集合 → 渲染"无可用 Skill"空态 + 禁用按钮
    expect(screen.getByTestId('analysis-skill-selector-empty')).toBeInTheDocument()
    const btn = screen.getByTestId('admission-start-btn')
    expect(btn).toBeInTheDocument()
    expect(btn.getAttribute('data-state')).toBe('idle')
    expect(btn).toBeDisabled()
  })

  it('无 requirement.md → 走 DRAFTING 引导空态,不显示「开始分析」', async () => {
    const data = await getAnalyzingData('req-cta-no-prd', { requirementsRoot: root })
    expect(data.phase).toBe('empty')
    render(<AnalyzingZone data={data} />)
    expect(screen.getByText('ANALYZING 工位暂无内容')).toBeInTheDocument()
    expect(screen.queryByTestId('admission-start-btn')).toBeNull()
  })

  it('已有 session + admission chunks → CTA 仍可见(常驻)', async () => {
    // issue 01 改造:AdmissionDashboard → AnalysisSkillSelector
    // 按钮常驻语义保留(再点 = 再开一轮新分析);五维卡 / data-phase 概念
    // 已废弃(被 Analysis Skill 单选器替代),相关断言不再适用。
    const id = 'req-cta-analyzed'
    seedRequirementOnly(id)
    const dims = [
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
    ]
    seedChunks(id, 'sess-arch', [
      ...dims.map((dim, i) => ({
        id: `c-${i}`,
        ts: '10:00:0' + i,
        label: 'DETECT',
        tone: 'info',
        text: `${dim} 评估`,
        kind: 'narration',
        admission: { dim, verdict: i === 0 ? 'warn' : 'pass' },
      })),
      {
        id: 'c-verdict',
        ts: '10:00:09',
        label: 'COMPLETE',
        tone: 'warn',
        text: '⚠️ 待裁决',
        kind: 'narration',
        admission: { overall: 'pending', pendingCount: 3 },
      },
    ])

    const data = await getAnalyzingData(id, { requirementsRoot: root })
    // 旧:五维卡 count / verdict / 待裁决数派生(issue 01 仍 SSR 注入但 UI 不再展示)
    expect(data.admission.dimensions.map((d) => d.count)).toEqual([1, 1, 1, 1, 1])
    expect(data.admission.verdict).toBe('pending')
    expect(data.admission.pendingAdjudicationCount).toBe(3)

    render(<AnalyzingZone data={data} />)
    // ticket 08 语义保留:按钮常驻 → 即使已有 chunks 也可见
    expect(screen.getByTestId('admission-start-btn')).toBeInTheDocument()
    // issue 01:tmpdir 没 analysis-skills → 空态(无 Skill 不可启动)
    expect(screen.getByTestId('analysis-skill-selector-empty')).toBeInTheDocument()
  })
})

describe('真实 loader → ProductList 三桶(audit #2)', () => {
  it('三桶 chunk 落盘 → SSR 装载后 ProductList 与顶部 stats 都有产物', async () => {
    const id = 'req-products'
    seedRequirementOnly(id)
    seedChunks(id, 'sess-arch', [
      {
        id: 'c-sub-1',
        ts: '10:00:01',
        label: 'DETECT',
        tone: 'info',
        text: '单笔退款上限是否随用户等级差异化?',
        kind: 'subproblem',
        source_refs: [{ kind: 'prd', lineRange: [2, 3], quote: '退款单笔金额上限 ≤ 1000 元' }],
      },
      {
        id: 'c-risk-1',
        ts: '10:00:02',
        label: 'RISK',
        tone: 'warn',
        text: '并发退款可能重复入账。',
        kind: 'risk',
      },
      {
        id: 'c-opt-1',
        ts: '10:00:03',
        label: 'OPTION',
        tone: 'success',
        text: '幂等网关 + 异步多阶段事件。',
        kind: 'option',
      },
    ])

    const data = await getAnalyzingData(id, { requirementsRoot: root })
    expect(data.stats).toEqual({ subproblems: 1, risks: 1, options: 1, total: 3 })
    expect(data.chunks).toHaveLength(3)
    expect(data.chunks[0].source_refs).toEqual([
      { kind: 'prd', lineRange: [2, 3], quote: '退款单笔金额上限 ≤ 1000 元' },
    ])

    render(<AnalyzingZone data={data} />)
    expect(screen.getAllByTestId('product-subproblems-item')).toHaveLength(1)
    expect(screen.getAllByTestId('product-risks-item')).toHaveLength(1)
    expect(screen.getAllByTestId('product-options-item')).toHaveLength(1)
  })

  it('损坏的 admission 字段被丢弃,不产出非法 verdict', async () => {
    const id = 'req-dirty-admission'
    seedRequirementOnly(id)
    seedChunks(id, 'sess-arch', [
      {
        id: 'c-dirty',
        ts: '10:00:01',
        label: 'DETECT',
        tone: 'info',
        text: '脏行',
        kind: 'narration',
        admission: { dim: 'loss_prevention', verdict: 'maybe', overall: 'unknown', pendingCount: -1 },
      },
    ])
    const data = await getAnalyzingData(id, { requirementsRoot: root })
    // dim 合法 → count 计入;verdict/overall/pendingCount 非法 → 丢弃回落默认
    expect(data.admission.dimensions.find((d) => d.id === 'loss_prevention')?.count).toBe(1)
    expect(data.admission.verdict).toBe('pending')
    expect(data.admission.pendingAdjudicationCount).toBe(0)
  })
})
